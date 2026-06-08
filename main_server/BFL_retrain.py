"""
BFL_retrain.py
==============
Drop this next to backend.py.

KEY CHANGES vs original
------------------------
1. Single annotation directory  — all images+labels live under ONE root
   (RETRAIN_DATA_DIR).  Sub-dirs defective/ and retrain/ are still kept for
   the stats API, but the training code now scans both automatically without
   hard-coding three separate label dirs.

2. Early stopping              — stops training when val loss doesn't improve
   for PATIENCE consecutive epochs (default 10, configurable via env var).

3. patience_counter in progress — frontend can show "patience 3/10" live.

4. early_stopped flag in done  — frontend can explain why training ended.

5. ReduceLROnPlateau scheduler — already present, kept.

6. Stop signal                 — already present, kept.
"""

import os
import json
import shutil
import random
import time
from datetime import datetime

import cv2
import numpy as np
import torch
import segmentation_models_pytorch as smp
import albumentations as A
from torch.utils.data import Dataset, DataLoader


# ══════════════════════════════════════════════════════════════════════════════
# ENV CONFIG
# ══════════════════════════════════════════════════════════════════════════════

# ── CHANGE 1: single root dir ─────────────────────────────────────────────────
# All training data lives under RETRAIN_DATA_DIR.
# Expected layout (created automatically by the import endpoint):
#
#   retrain_data/
#     defective/
#       images/   ← defective blade images
#       labels/   ← matching YOLO .txt files
#     retrain/
#       images/   ← model-correction images
#       labels/   ← matching YOLO .txt files
#
# The script scans BOTH sub-dirs so you only need one place to put data.
# Previously the script also had an "approved" dir; that is removed here
# because the UI only exposes defective + retrain queues.

RETRAIN_DATA_DIR = os.environ.get('RETRAIN_DATA_DIR',
                                  os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                               'retrain_data'))

# Individual sub-dirs (derived — don't need to set these manually)
DEFECTIVE_IMG_DIR = os.path.join(RETRAIN_DATA_DIR, 'defective', 'images')
DEFECTIVE_LBL_DIR = os.path.join(RETRAIN_DATA_DIR, 'defective', 'labels')
RETRAIN_IMG_DIR   = os.path.join(RETRAIN_DATA_DIR, 'retrain',   'images')
RETRAIN_LBL_DIR   = os.path.join(RETRAIN_DATA_DIR, 'retrain',   'labels')

# ── Training hyper-params ──────────────────────────────────────────────────────
EPOCHS     = int(os.environ.get('RETRAIN_EPOCHS',     '50'))
BATCH_SIZE = int(os.environ.get('RETRAIN_BATCH_SIZE', '4'))
LR         = float(os.environ.get('RETRAIN_LR',       '0.0003'))

# ── CHANGE 2: patience env var ────────────────────────────────────────────────
PATIENCE = int(os.environ.get('RETRAIN_PATIENCE', '10'))

# ── File paths ────────────────────────────────────────────────────────────────
OUTPUT_MODEL   = os.environ.get('RETRAIN_OUTPUT_MODEL',  'hr_net_retrained.pth')
EXISTING_MODEL = os.environ.get('RETRAIN_BASE_MODEL',    'hr_net.pth')
PROGRESS_FILE  = os.environ.get('RETRAIN_PROGRESS_FILE', 'retrain_progress.json')
STOP_FILE      = os.environ.get('RETRAIN_STOP_FILE',     'retrain_stop.signal')

# ── Dataset split dirs (auto-created) ─────────────────────────────────────────
DATASET_DIR = os.path.join(RETRAIN_DATA_DIR, 'dataset')
TRAIN_IMG   = os.path.join(DATASET_DIR, 'images', 'train')
VAL_IMG     = os.path.join(DATASET_DIR, 'images', 'val')
TRAIN_LBL   = os.path.join(DATASET_DIR, 'labels', 'train')
VAL_LBL     = os.path.join(DATASET_DIR, 'labels', 'val')
for _d in [TRAIN_IMG, VAL_IMG, TRAIN_LBL, VAL_LBL]:
    os.makedirs(_d, exist_ok=True)

# ── Classes ────────────────────────────────────────────────────────────────────
CLASS_NAMES_FILE = os.environ.get('RETRAIN_CLASS_NAMES_FILE',
                                  os.path.join(RETRAIN_DATA_DIR, 'class_names.json'))
DEFAULT_CLASSES = [
    'Cutter marks and fish marks',
    'Scratches and Black spots',
    'Fingerprints and stains',
    'Ink marks',
    'Jig Marks',
    'Machining Marks',
    'Overcut',
    'Pocket',
]
if os.path.exists(CLASS_NAMES_FILE):
    with open(CLASS_NAMES_FILE) as _f:
        CLASS_NAMES = json.load(_f)
    print(f'Loaded {len(CLASS_NAMES)} classes from {CLASS_NAMES_FILE}')
else:
    CLASS_NAMES = DEFAULT_CLASSES
    print(f'Using {len(CLASS_NAMES)} default classes')

NUM_CLASSES = len(CLASS_NAMES)
IMG_SIZE    = 512
device      = 'cuda' if torch.cuda.is_available() else 'cpu'


# ══════════════════════════════════════════════════════════════════════════════
# HELPERS
# ══════════════════════════════════════════════════════════════════════════════

def count_images(d: str) -> int:
    """Return number of image files in directory d (non-recursive)."""
    if not os.path.isdir(d):
        return 0
    return len([f for f in os.listdir(d)
                if f.lower().endswith(('.png', '.jpg', '.jpeg'))])


# ── CHANGE 3: progress writer now includes patience_counter + early_stopped ───
def write_progress(status: str,
                   epoch: int = 0,
                   epochs: int = EPOCHS,
                   train_loss=None,
                   val_loss=None,
                   best_val=None,
                   message: str = '',
                   history=None,
                   patience_counter: int = 0,   # NEW — live patience countdown
                   early_stopped: bool = False,  # NEW — true when ES fired
                   stopped_epoch: int = 0,       # NEW — epoch ES fired at
                   **extra):
    data = {
        'status':           status,
        'epoch':            epoch,
        'total_epochs':     epochs,
        'train_loss':       round(train_loss, 5) if train_loss is not None else None,
        'val_loss':         round(val_loss,   5) if val_loss   is not None else None,
        'best_val':         round(best_val,   5) if best_val   is not None else None,
        'message':          message,
        'history':          history or [],
        'timestamp':        datetime.now().isoformat(),
        # ── NEW fields ──────────────────────────────────────────────────────
        'patience_counter': patience_counter,
        'patience_limit':   PATIENCE,
        'early_stopped':    early_stopped,
        'stopped_epoch':    stopped_epoch,
    }
    data.update(extra)
    try:
        with open(PROGRESS_FILE, 'w') as _f:
            json.dump(data, _f)
    except Exception as e:
        print(f'[progress] Could not write progress file: {e}')


# ══════════════════════════════════════════════════════════════════════════════
# STARTUP LOG
# ══════════════════════════════════════════════════════════════════════════════

write_progress('starting', message='Initializing...')
print(f'Device        : {device}')
print(f'Data root     : {RETRAIN_DATA_DIR}')
print(f'Defective     : {count_images(DEFECTIVE_IMG_DIR)}')
print(f'Retrain queue : {count_images(RETRAIN_IMG_DIR)}')
print(f'Epochs={EPOCHS}  Batch={BATCH_SIZE}  LR={LR}  Patience={PATIENCE}')
print(f'Num classes   : {NUM_CLASSES}')
print(f'Output model  : {OUTPUT_MODEL}')


# ══════════════════════════════════════════════════════════════════════════════
# CHANGE 4: DATA COLLECTION — single helper scans BOTH sub-dirs
# ══════════════════════════════════════════════════════════════════════════════

write_progress('starting', message='Collecting images from all annotation directories...')


def collect_from(img_dir: str, lbl_dir: str) -> list:
    """
    Scan img_dir for images, pair each with its label file in lbl_dir.
    Returns list of (image_path, label_dir, image_filename) tuples.
    Only images whose label file EXISTS and is non-empty are included;
    images without labels are logged and skipped so training doesn't
    silently train on unannotated data.
    """
    entries = []
    skipped = []
    if not os.path.isdir(img_dir):
        print(f'  [collect] Directory not found, skipping: {img_dir}')
        return entries

    for fn in sorted(os.listdir(img_dir)):
        if not fn.lower().endswith(('.png', '.jpg', '.jpeg')):
            continue
        base      = os.path.splitext(fn)[0]
        lbl_path  = os.path.join(lbl_dir, base + '.txt')
        img_path  = os.path.join(img_dir, fn)

        if os.path.exists(lbl_path) and os.path.getsize(lbl_path) > 0:
            entries.append((img_path, lbl_dir, fn))
        else:
            skipped.append(fn)

    if skipped:
        print(f'  [collect] {img_dir}: skipped {len(skipped)} images '
              f'(missing/empty label): {skipped[:5]}{"..." if len(skipped) > 5 else ""}')
    print(f'  [collect] {img_dir}: {len(entries)} trainable images')
    return entries


# Collect from BOTH annotation directories — this is the key change.
# Previously backend code used APPROVED_DIR too; that queue is removed.
all_images = (
    collect_from(DEFECTIVE_IMG_DIR, DEFECTIVE_LBL_DIR) +
    collect_from(RETRAIN_IMG_DIR,   RETRAIN_LBL_DIR)
)

total_found = count_images(DEFECTIVE_IMG_DIR) + count_images(RETRAIN_IMG_DIR)
print(f'Total images on disk : {total_found}')
print(f'Trainable (annotated): {len(all_images)}')

if not all_images:
    write_progress('error',
                   message='No annotated training images found. '
                            'Import a YOLO zip and make sure every image has a label file.')
    raise SystemExit('No annotated training images found.')


# ══════════════════════════════════════════════════════════════════════════════
# TRAIN / VAL SPLIT
# ══════════════════════════════════════════════════════════════════════════════

random.seed(42)
random.shuffle(all_images)
split_idx  = max(1, int(len(all_images) * 0.8))
train_list = all_images[:split_idx]
val_list   = all_images[split_idx:] if len(all_images) > 1 else all_images[:1]

# Clear stale split dirs before populating
for _folder in [TRAIN_IMG, VAL_IMG, TRAIN_LBL, VAL_LBL]:
    for _fn in os.listdir(_folder):
        try:
            os.remove(os.path.join(_folder, _fn))
        except Exception:
            pass


def copy_to_split(img_list: list, img_dst: str, lbl_dst: str) -> None:
    for src_path, lbl_dir, img_name in img_list:
        shutil.copy2(src_path, os.path.join(img_dst, img_name))
        base    = os.path.splitext(img_name)[0]
        src_lbl = os.path.join(lbl_dir, base + '.txt')
        dst_lbl = os.path.join(lbl_dst, base + '.txt')
        if os.path.exists(src_lbl):
            shutil.copy2(src_lbl, dst_lbl)
        else:
            # Shouldn't happen after collect_from filters, but be safe
            open(dst_lbl, 'w').close()


copy_to_split(train_list, TRAIN_IMG, TRAIN_LBL)
copy_to_split(val_list,   VAL_IMG,   VAL_LBL)

print(f'Split — Total: {len(all_images)} | Train: {len(train_list)} | Val: {len(val_list)}')
write_progress('starting',
               message=f'Data ready: {len(train_list)} train, {len(val_list)} val')


# ══════════════════════════════════════════════════════════════════════════════
# TRANSFORMS
# ══════════════════════════════════════════════════════════════════════════════

train_transform = A.Compose([
    A.HorizontalFlip(p=0.5),

    A.RandomBrightnessContrast(p=0.3),

    A.GaussNoise(std_range=(0.04, 0.2), p=0.3),

    A.Affine(
        translate_percent=0.0625,
        scale=(0.9, 1.1),
        rotate=(-15, 15),
        border_mode=cv2.BORDER_CONSTANT,
        fill=0,
        p=0.5
    ),

    A.Resize(256, 256)
])
val_transform = A.Compose([A.Resize(IMG_SIZE, IMG_SIZE)])


# ══════════════════════════════════════════════════════════════════════════════
# DATASET
# ══════════════════════════════════════════════════════════════════════════════

class YOLOSegDataset(Dataset):
    def __init__(self, img_dir: str, label_dir: str,
                 img_size: int = 512, transform=None):
        self.img_dir   = img_dir
        self.label_dir = label_dir
        self.img_size  = img_size
        self.transform = transform
        self.images    = sorted([
            f for f in os.listdir(img_dir)
            if f.lower().endswith(('.jpg', '.jpeg', '.png'))
        ])

    def __len__(self):
        return len(self.images)

    def _polygon_to_mask(self, poly: list, h: int, w: int) -> np.ndarray:
        mask = np.zeros((h, w), dtype=np.uint8)
        pts  = np.array(poly).reshape(-1, 2)
        pts[:, 0] *= w
        pts[:, 1] *= h
        cv2.fillPoly(mask, [pts.astype(np.int32)], 1)
        return mask

    def __getitem__(self, idx):
        img_name   = self.images[idx]
        img_path   = os.path.join(self.img_dir, img_name)
        base       = os.path.splitext(img_name)[0]
        label_path = os.path.join(self.label_dir, base + '.txt')

        img = cv2.imread(img_path)
        if img is None:
            img = np.zeros((self.img_size, self.img_size, 3), dtype=np.uint8)
        else:
            img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)

        h_orig, w_orig = img.shape[:2]
        mask = np.zeros((h_orig, w_orig, NUM_CLASSES), dtype=np.uint8)

        if os.path.exists(label_path):
            with open(label_path) as f:
                for line in f:
                    parts = line.strip().split()
                    if len(parts) < 5:
                        continue
                    try:
                        cls  = int(parts[0])
                        poly = list(map(float, parts[1:]))
                    except Exception:
                        continue
                    if 0 <= cls < NUM_CLASSES and len(poly) >= 6:
                        m = self._polygon_to_mask(poly, h_orig, w_orig)
                        mask[:, :, cls] = np.maximum(mask[:, :, cls], m)

        if self.transform:
            aug  = self.transform(image=img, mask=mask)
            img  = aug['image']
            mask = aug['mask']

        if img.shape[0] != self.img_size or img.shape[1] != self.img_size:
            img  = cv2.resize(img, (self.img_size, self.img_size))
            mask = cv2.resize(mask, (self.img_size, self.img_size),
                              interpolation=cv2.INTER_NEAREST)

        img  = torch.tensor(img).permute(2, 0, 1).float() / 255.0
        mask = torch.tensor(mask).permute(2, 0, 1).float()
        return img, mask


train_dataset = YOLOSegDataset(TRAIN_IMG, TRAIN_LBL, IMG_SIZE, train_transform)
val_dataset   = YOLOSegDataset(VAL_IMG,   VAL_LBL,   IMG_SIZE, val_transform)
train_loader  = DataLoader(train_dataset, batch_size=BATCH_SIZE, shuffle=True,
                           num_workers=0, pin_memory=(device == 'cuda'))
val_loader    = DataLoader(val_dataset,   batch_size=BATCH_SIZE, shuffle=False,
                           num_workers=0, pin_memory=(device == 'cuda'))
print(f'Train batches: {len(train_loader)} | Val batches: {len(val_loader)}')


# ══════════════════════════════════════════════════════════════════════════════
# MODEL
# ══════════════════════════════════════════════════════════════════════════════

write_progress('starting', message='Building model...')

model = smp.FPN(
    encoder_name='timm-regnety_032',
    encoder_weights='imagenet',
    in_channels=3,
    classes=NUM_CLASSES,
).to(device)

if os.path.exists(EXISTING_MODEL):
    try:
        state = torch.load(EXISTING_MODEL, map_location=device)
        missing, unexpected = model.load_state_dict(state, strict=False)
        print(f'Fine-tuning from {EXISTING_MODEL} '
              f'(missing={len(missing)}, unexpected={len(unexpected)})')
        write_progress('starting',
                       message=f'Fine-tuning from existing model: {EXISTING_MODEL}')
    except Exception as e:
        print(f'Could not load existing model ({e}) — using imagenet weights.')
        write_progress('starting',
                       message='Starting from imagenet weights (existing model incompatible).')
else:
    print(f'No existing model at {EXISTING_MODEL} — using imagenet weights.')
    write_progress('starting', message='Starting from imagenet weights.')

print('Model ready.')


# ══════════════════════════════════════════════════════════════════════════════
# LOSS & OPTIMIZER
# ══════════════════════════════════════════════════════════════════════════════

dice_loss_fn  = smp.losses.DiceLoss(mode='multilabel')
focal_loss_fn = smp.losses.FocalLoss(mode='multilabel')


def loss_fn(pred, target):
    return 0.6 * dice_loss_fn(pred, target) + 0.4 * focal_loss_fn(pred, target)


optimizer = torch.optim.AdamW(model.parameters(), lr=LR)
scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(
    optimizer, mode='min', patience=3, factor=0.5,
)
print('Loss / optimizer ready.')


# ══════════════════════════════════════════════════════════════════════════════
# TRAINING LOOP
# ══════════════════════════════════════════════════════════════════════════════

best_val_loss    = float('inf')
history          = []
train_loss       = 0.0
val_loss         = 0.0

# ── CHANGE 5: patience counter ────────────────────────────────────────────────
patience_counter = 0   # increments each epoch without improvement; resets on best

# Clear any stale stop signal from a previous run
if os.path.exists(STOP_FILE):
    os.remove(STOP_FILE)

write_progress('training', epoch=0, epochs=EPOCHS,
               best_val=None, message='Training started...',
               patience_counter=0)
print('\nTRAINING STARTED\n')

stopped_early  = False
early_stop_hit = False   # True when patience limit reached (vs manual stop)

for epoch in range(EPOCHS):

    # ── Manual stop signal ────────────────────────────────────────────────
    if os.path.exists(STOP_FILE):
        print(f'\n[STOP]  Stop signal received at epoch {epoch + 1}.')
        stopped_early = True
        write_progress(
            'stopped', epoch=epoch, epochs=EPOCHS,
            train_loss=train_loss if epoch > 0 else None,
            val_loss=val_loss     if epoch > 0 else None,
            best_val=best_val_loss if best_val_loss < float('inf') else None,
            message=(f'Stopped at epoch {epoch}/{EPOCHS}. '
                     f'Best val: {best_val_loss:.4f}')
                    if best_val_loss < float('inf')
                    else f'Stopped at epoch {epoch}/{EPOCHS}.',
            history=history,
            patience_counter=patience_counter,
        )
        break

    # ── Train ─────────────────────────────────────────────────────────────
    model.train()
    running_loss = 0.0
    for images, masks in train_loader:
        images, masks = images.to(device), masks.to(device)
        optimizer.zero_grad()
        loss = loss_fn(model(images), masks)
        loss.backward()
        optimizer.step()
        running_loss += loss.item()
    train_loss = running_loss / len(train_loader)

    # ── Validate ──────────────────────────────────────────────────────────
    model.eval()
    running_val = 0.0
    with torch.no_grad():
        for images, masks in val_loader:
            images, masks = images.to(device), masks.to(device)
            running_val += loss_fn(model(images), masks).item()
    val_loss = running_val / len(val_loader)

    scheduler.step(val_loss)

    # ── CHANGE 6: save best + update patience counter ─────────────────────
    saved_best = val_loss < best_val_loss
    if saved_best:
        best_val_loss    = val_loss
        patience_counter = 0          # improvement → reset counter
        torch.save(model.state_dict(), OUTPUT_MODEL)
        print(f'Epoch {epoch+1}/{EPOCHS} | train={train_loss:.4f} | '
              f'val={val_loss:.4f} << BEST SAVED  (patience reset)')
    else:
        patience_counter += 1         # no improvement → count up
        print(f'Epoch {epoch+1}/{EPOCHS} | train={train_loss:.4f} | '
              f'val={val_loss:.4f} | patience {patience_counter}/{PATIENCE}')

    entry = {
        'epoch':      epoch + 1,
        'train_loss': round(train_loss, 5),
        'val_loss':   round(val_loss,   5),
        'best':       saved_best,
    }
    history.append(entry)

    write_progress(
        'training', epoch=epoch + 1, epochs=EPOCHS,
        train_loss=train_loss, val_loss=val_loss, best_val=best_val_loss,
        message=(f'Epoch {epoch+1}/{EPOCHS} complete'
                 + (' — best model saved!' if saved_best
                    else f' — patience {patience_counter}/{PATIENCE}')),
        history=history,
        patience_counter=patience_counter,    # NEW
    )

    # ── CHANGE 7: early stopping gate ─────────────────────────────────────
    if patience_counter >= PATIENCE:
        print(f'\n[EARLY STOP]  Early stopping at epoch {epoch+1} '
              f'(no improvement for {PATIENCE} epochs).')
        early_stop_hit = True
        stopped_early  = True
        write_progress(
            'done', epoch=epoch + 1, epochs=EPOCHS,
            train_loss=train_loss, val_loss=val_loss, best_val=best_val_loss,
            message=(f'Early stopping at epoch {epoch+1}/{EPOCHS} — '
                     f'no improvement for {PATIENCE} epochs. '
                     f'Best val loss: {best_val_loss:.4f}. '
                     f'Model saved to: {OUTPUT_MODEL}'),
            history=history,
            patience_counter=patience_counter,
            early_stopped=True,        # NEW — UI uses this flag
            stopped_epoch=epoch + 1,   # NEW — UI shows which epoch
            retrain_used=count_images(RETRAIN_IMG_DIR),
            defective_used=count_images(DEFECTIVE_IMG_DIR),
        )
        break


# ══════════════════════════════════════════════════════════════════════════════
# FINAL STATUS  (only reached when loop runs to completion without ES / stop)
# ══════════════════════════════════════════════════════════════════════════════

if not stopped_early:
    write_progress(
        'done', epoch=EPOCHS, epochs=EPOCHS,
        train_loss=train_loss, val_loss=val_loss, best_val=best_val_loss,
        message=(f'Training complete. Best val loss: {best_val_loss:.4f}. '
                 f'Model saved to: {OUTPUT_MODEL}'),
        history=history,
        patience_counter=patience_counter,
        early_stopped=False,       # NEW — full run, no early stop
        stopped_epoch=EPOCHS,      # NEW
        retrain_used=count_images(RETRAIN_IMG_DIR),
        defective_used=count_images(DEFECTIVE_IMG_DIR),
    )
    print(f'\nTRAINING COMPLETE | best_val={best_val_loss:.4f} | saved to {OUTPUT_MODEL}')