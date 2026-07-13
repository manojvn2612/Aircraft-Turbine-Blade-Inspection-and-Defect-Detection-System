from collections import Counter
import os
import cv2
import numpy as np
from ultralytics import YOLO
from dotenv import load_dotenv
from hrnet_model import CLASS_NAMES, HRNetInference,reload_model
import torch
from torch.utils.data import Dataset,DataLoader
import torch.nn.functional as F
# load_dotenv()
blade_model = None
hr_model = None
load_dotenv("../.env")
WORK_DIR = os.getenv("WORK_DIR", "..")
RETRAIN_DIR = os.getenv("RETRAIN_DIR","retrain")
SECRET_KEY = os.getenv("SECRET_KEY")
# ALGORITHM = "HS256"
STORAGE_DIR = os.path.join(WORK_DIR, os.getenv("STORAGE_DIR", "storage"))
RESULT_DIR = os.path.join(STORAGE_DIR, os.getenv("RESULT_DIR", "results"))
UPLOAD_DIR = os.path.join(STORAGE_DIR, os.getenv("UPLOAD_DIR", "uploads"))
RETRAIN_DIR = os.path.join(STORAGE_DIR,RETRAIN_DIR)
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(RESULT_DIR, exist_ok=True)
os.makedirs(RETRAIN_DIR,exist_ok=True)

def _get_models():
    global blade_model, hr_model

    if blade_model is None:
        blade_model = YOLO("models/blade_detect.pt")

    if hr_model is None:
        hr_model = HRNetInference()
        hr_model.load_model("models/hr_net.pth")

    return blade_model, hr_model


def get_blade_mask(image_path: str, target_shape):
    model, _ = _get_models()
    results = model(image_path)

    for r in results:
        if len(r) == 0:
            continue

        c = r[0]
        mask = np.zeros(target_shape[:2], dtype=np.uint8)

        try:
            if hasattr(c, "masks") and c.masks is not None and len(c.masks.xy) > 0:
                contour = c.masks.xy[0].astype(np.int32).reshape(-1, 1, 2)
                cv2.drawContours(mask, [contour], -1, 255, cv2.FILLED)
            else:
                x1, y1, x2, y2 = map(int, c.boxes.xyxy[0].cpu().numpy())
                cv2.rectangle(mask, (x1, y1), (x2, y2), 255, -1)
        except Exception:
            continue

        ys, xs = np.where(mask > 0)
        if len(xs) == 0 or len(ys) == 0:
            continue

        x1, x2 = int(xs.min()), int(xs.max())
        y1, y2 = int(ys.min()), int(ys.max())
        return mask, (x1, y1, x2, y2)

    return None, None


def get_blade(image_path: str, target_img):
    mask, _ = get_blade_mask(image_path, target_img.shape)
    if mask is None:
        return None

    isolated = cv2.bitwise_and(target_img, target_img, mask=mask)
    ys, xs = np.where(mask > 0)
    if len(xs) == 0 or len(ys) == 0:
        return None

    x1, x2 = int(xs.min()), int(xs.max())
    y1, y2 = int(ys.min()), int(ys.max())
    return isolated[y1:y2, x1:x2]


def _annotate_defects(vis_bgr, defects):
    annotated = vis_bgr.copy()
    for idx, defect in enumerate(defects):
        x, y, w, h = defect["bbox"]
        color = (0, 255, 0)
        cv2.rectangle(annotated, (x, y), (x + w, y + h), color, 2)
        label = f"{defect['defect_name']} {idx + 1}"
        cv2.putText(
            annotated,
            label,
            (x, max(0, y - 5)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.5,
            color,
            1,
            cv2.LINE_AA,
        )
    return annotated


def _filter_detections_by_blade(detections, blade_mask):
    if blade_mask is None:
        return []

    filtered = []
    h, w = blade_mask.shape[:2]

    for det in detections:
        x, y, box_w, box_h = det.get("bbox", [0, 0, 0, 0])
        x2 = min(w - 1, max(0, x + box_w))
        y2 = min(h - 1, max(0, y + box_h))
        x1 = min(w - 1, max(0, x))
        y1 = min(h - 1, max(0, y))

        if x2 <= x1 or y2 <= y1:
            continue

        region = blade_mask[y1:y2, x1:x2]
        if region.size > 0 and np.any(region > 0):
            filtered.append(det)

    return filtered


def _name_defects_in_blade(blade_mask, class_masks, detections):
    if blade_mask is None:
        return []

    defects = []
    if class_masks is None:
        class_masks = []

    for class_idx, class_mask in enumerate(class_masks):
        if class_mask is None:
            continue

        inside_mask = cv2.bitwise_and(class_mask.astype(np.uint8), blade_mask)
        if np.count_nonzero(inside_mask) == 0:
            continue

        contours, _ = cv2.findContours(inside_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        class_name = CLASS_NAMES[class_idx] if class_idx < len(CLASS_NAMES) else f"Defect Class {class_idx + 1}"

        for cnt in contours:
            area = cv2.contourArea(cnt)
            if area < 25:
                continue

            x, y, w, h = cv2.boundingRect(cnt)
            confidence = None
            for det in detections:
                if det.get("class_name") == class_name:
                    confidence = det.get("confidence")
                    break

            defects.append({
                "defect_name": class_name,
                "bbox": [int(x), int(y), int(w), int(h)],
                "area": int(area),
                "confidence": confidence,
            })

    return defects


def process_image(image_path: str):
    img = cv2.imread(image_path)
    COLORS = [
    (255, 0, 0),
    (0, 255, 0),
    (0, 0, 255),
    (255, 255, 0),
    (255, 0, 255),
    (0, 255, 255),
    (128, 128, 0),
    (128, 0, 128),
    ]

    if img is None:
        raise ValueError("Could not read image.")

    _, hr_model_instance = _get_models()#load models
    _, detections, class_masks = hr_model_instance.predict(
        img,
        return_masks=True,
    )
    #find blade and make mask to segregate
    blade_mask, blade_bbox = get_blade_mask(image_path, img.shape)

    if blade_mask is None:
        raise ValueError("No blade detected.")
    #extract blade
    blade = cv2.bitwise_and(img, img, mask=blade_mask)

    if blade_bbox is not None:
        x1, y1, x2, y2 = blade_bbox
        blade = blade[y1:y2, x1:x2]
    #make annotation
    annotated_vis = img.copy()

    defects = []
    #draw defects
    for class_idx, class_mask in enumerate(class_masks):

        if class_mask is None:
            continue

        # Keep only defect pixels inside blade
        inside_mask = cv2.bitwise_and(
            class_mask.astype(np.uint8),
            blade_mask,
        )

        if np.count_nonzero(inside_mask) == 0:
            continue

        contours, _ = cv2.findContours(
            inside_mask,
            cv2.RETR_EXTERNAL,
            cv2.CHAIN_APPROX_SIMPLE,
        )

        color = COLORS[class_idx % len(COLORS)]
        class_name = CLASS_NAMES[class_idx]

        for cnt in contours:

            area = cv2.contourArea(cnt)

            if area < 25:
                continue

            x, y, w, h = cv2.boundingRect(cnt)

            confidence = None

            for det in detections:
                if det["class_name"] == class_name:
                    confidence = det["confidence"]
                    break

            # Draw contour
            cv2.drawContours(
                annotated_vis,
                [cnt],
                -1,
                color,
                2,
            )

            # Draw bounding box
            cv2.rectangle(
                annotated_vis,
                (x, y),
                (x + w, y + h),
                color,
                2,
            )

            label = (
                f"{class_name} {confidence:.2f}"
                if confidence is not None
                else class_name
            )
            font_scale = 1.0     
            thickness = 3         

            cv2.putText(
                annotated_vis,
                label,
                (x, max(35, y - 10)),
                cv2.FONT_HERSHEY_SIMPLEX,
                font_scale,
                color,
                thickness,
                cv2.LINE_AA,
            )

            defects.append(
                {
                    "defect_name": class_name,
                    "bbox": [x, y, w, h],
                    "area": int(area),
                    "confidence": confidence,
                }
            )

    annotated_vis = cv2.bitwise_and(
        annotated_vis,
        annotated_vis,
        mask=blade_mask,
    )

    defect_count_by_type = Counter(
        defect["defect_name"] for defect in defects
    )

    return {
        "blade_image": blade,
        "hrnet_output": annotated_vis,
        "detections": defects,
        "all_detections": detections,
        "defects": defects,
        "defect_count": len(defects),
        "defect_names": [d["defect_name"] for d in defects],
        "defect_count_by_type": dict(defect_count_by_type),
        "blade_bbox": blade_bbox,
        "blade_detected": True,
    }

def predict(image_path: str):
    return process_image(image_path)
#loss function
def dice_loss(pred, target, smooth=1):
    pred = torch.sigmoid(pred)

    pred = pred.view(pred.size(0), -1)
    target = target.view(target.size(0), -1)

    intersection = (pred * target).sum(dim=1)
    dice = (2. * intersection + smooth) / (pred.sum(dim=1) + target.sum(dim=1) + smooth)

    return 1 - dice.mean()
def focal_loss(pred, target, alpha=0.8, gamma=2):
    pred = torch.sigmoid(pred)

    bce = F.binary_cross_entropy(pred, target, reduction='none')
    pt = torch.exp(-bce)

    focal = alpha * (1 - pt) ** gamma * bce
    return focal.mean()
def loss_fn(pred, target):
    return 0.4 * focal_loss(pred, target) + 0.6 * dice_loss(pred, target)
#convert yolo to hr_net output
class YOLOSegDataset(Dataset):
    def __init__(self, img_dir, label_dir, img_size=512, transform=None):
        self.img_dir = img_dir
        self.label_dir = label_dir
        self.img_size = img_size
        self.images = sorted(os.listdir(img_dir))
        self.transform = transform

    def __len__(self):
        return len(self.images)

    def polygon_to_mask(self, poly, h, w):
        mask = np.zeros((h, w), dtype=np.uint8)
        poly = np.array(poly).reshape(-1, 2)
        poly[:, 0] *= w
        poly[:, 1] *= h
        poly = poly.astype(np.int32)
        cv2.fillPoly(mask, [poly], 1)
        return mask

    def __getitem__(self, idx):
        img_name = self.images[idx]
        img_path = os.path.join(self.img_dir, img_name)
        label_path = os.path.join(self.label_dir, img_name.replace(".jpg", ".txt"))

        img = cv2.imread(img_path)
        img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)

        h_orig, w_orig = img.shape[:2]

        mask = np.zeros((h_orig, w_orig, len(CLASS_NAMES)), dtype=np.uint8)

        if os.path.exists(label_path):
            with open(label_path) as f:
                for line in f:
                    data = list(map(float, line.strip().split()))
                    cls = int(data[0])
                    poly = data[1:]
                    m = self.polygon_to_mask(poly, h_orig, w_orig)
                    mask[:, :, cls] = np.maximum(mask[:, :, cls], m)

        if self.transform:
            augmented = self.transform(image=img, mask=mask)
            img = augmented['image']
            mask = augmented['mask']
            # Resize after augmentation if not already done by transform
            if img.shape[0] != self.img_size or img.shape[1] != self.img_size:
                img = cv2.resize(img, (self.img_size, self.img_size))
                mask = cv2.resize(mask, (self.img_size, self.img_size), interpolation=cv2.INTER_NEAREST)

            img = torch.tensor(img).permute(2, 0, 1).float() / 255.0
            mask = torch.tensor(mask).permute(2, 0, 1).float()

            return img, mask
def transform():
    import albumentations as A

    train_transform = A.Compose([
        A.Resize(512, 512),
        A.HorizontalFlip(p=0.5),
        A.VerticalFlip(p=0.3),
        A.RandomBrightnessContrast(p=0.5),
        A.GaussNoise(p=0.3),
        A.Rotate(limit=10, p=0.5),
        A.CLAHE(
        clip_limit=1.5,
        tile_grid_size=(4,4),
        p=0.2
    ),
        A.ShiftScaleRotate(shift_limit=0.0625, scale_limit=0.1, rotate_limit=15, p=0.5, border_mode=cv2.BORDER_CONSTANT, value=0)
    ])

    val_transform = A.Compose([
        A.Resize(512, 512)
    ])
    return train_transform, val_transform
import numpy as np

# 8 classes example
COLORS = [
    (255, 0, 0),    # Cutter
    (0, 255, 0),    # Fingerprint
    (0, 0, 255),    # Ink
    (255, 255, 0),  # Jig
    (255, 0, 255),  # Machining
    (0, 255, 255),  # Overcut
    (128, 128, 0),  # Pocket
    (128, 0, 128)   # Scratches
]
import cv2

def mask_to_color(mask):
    # mask shape: [C, H, W]
    mask = mask.cpu().numpy()
    C, H, W = mask.shape

    color_mask = np.zeros((H, W, 3), dtype=np.uint8)

    for c in range(C):
        color_mask[mask[c] > 0.5] = COLORS[c]

    return color_mask

def validation():
    
    model = _get_models("hrnet_new")[1]
    def compute_hrnet_iou(pred, target, threshold=0.15):
        # Ensure pred and target are on the same device
        pred = pred.to(target.device)

        pred = (torch.sigmoid(pred) > threshold).float()

        ious = []
        for c in range(pred.shape[1]): # Iterate over classes
            p = pred[:, c].contiguous().view(pred.size(0), -1) # Flatten each class mask per batch
            t = target[:, c].contiguous().view(target.size(0), -1) # Flatten each class mask per batch

            intersection = (p * t).sum(dim=1) # Sum intersection over flattened pixels for each image in batch
            union = (p + t).clamp(0, 1).sum(dim=1) # Sum union over flattened pixels for each image in batch

            # Handle cases where union is zero to avoid division by zero
            iou = torch.where(union == 0, torch.tensor(1.0).to(target.device), intersection / union)
            ious.extend(iou.cpu().numpy().tolist())

        return np.array(ious)

    def compute_hrnet_precision_recall(pred, target, threshold=0.15):
        # Ensure pred and target are on the same device
        pred = pred.to(target.device)

        pred = (torch.sigmoid(pred) > threshold).float()

        precisions = []
        recs = []
        for c in range(pred.shape[1]): # Iterate over classes
            p = pred[:, c].contiguous().view(pred.size(0), -1)
            t = target[:, c].contiguous().view(target.size(0), -1)

            tp = (p * t).sum(dim=1)
            fp = ((1 - t) * p).sum(dim=1)
            fn = ((1 - p) * t).sum(dim=1)

            # Precision: TP / (TP + FP)
            precision = torch.where((tp + fp) == 0, torch.tensor(1.0).to(target.device), tp / (tp + fp))
            precisions.extend(precision.cpu().numpy().tolist())

            # Recall: TP / (TP + FN)
            recall = torch.where((tp + fn) == 0, torch.tensor(1.0).to(target.device), tp / (tp + fn))
            recs.extend(recall.cpu().numpy().tolist())

        return np.array(precisions), np.array(recs)


    # Reload the model and validation loader if not already available in scope
    # (Assuming `model`, `val_ds`, `device`, `NUM_CLASSES` are defined in previous cells)


    # Load the saved HRNet model weights
    # model.load_state_dict(torch.load("/content/drive/MyDrive/BFL/Main_models/hr_net.pth", map_location=device))
    # model.to(device)
    model.eval() # Set model to evaluation mode

    val_loader = DataLoader(val_ds, batch_size=4)

    all_ious = []
    all_precisions = []
    all_recalls = []

    print("\nStarting HRNet accuracy evaluation...")

    with torch.no_grad():
        for imgs, masks in val_loader:
            imgs, masks = imgs.to(device), masks.to(device)
            out = model(imgs)
            batch_ious = compute_hrnet_iou(out, masks, threshold=0.5) # Using the same threshold as visualize
            batch_precisions, batch_recalls = compute_hrnet_precision_recall(out, masks, threshold=0.15)
            all_ious.extend(batch_ious)
            all_precisions.extend(batch_precisions)
            all_recalls.extend(batch_recalls)

    # Reshape metrics to be (num_images, NUM_CLASSES)
    all_ious_reshaped = np.array(all_ious).reshape(-1, NUM_CLASSES)
    all_precisions_reshaped = np.array(all_precisions).reshape(-1, NUM_CLASSES)
    all_recalls_reshaped = np.array(all_recalls).reshape(-1, NUM_CLASSES)

    # Calculate mean IoU for each class
    mean_iou_per_class = np.nanmean(all_ious_reshaped, axis=0) # Use nanmean to handle potential NaN values
    overall_mIoU = np.nanmean(mean_iou_per_class) # Calculate mean of class IoUs

    # Calculate mean Precision and Recall for each class
    mean_precision_per_class = np.nanmean(all_precisions_reshaped, axis=0)
    mean_recall_per_class = np.nanmean(all_recalls_reshaped, axis=0)

    print("\n--- HRNet Evaluation Results ---")
    print("Mean IoU per class:")
    for i, iou in enumerate(mean_iou_per_class):
        # Assuming CLASS_NAMES are available from the UNet part, if not, generalize
        class_name = CLASS_NAMES[i] if 'CLASS_NAMES' in globals() and i < len(CLASS_NAMES) else f"Class {i}"
        print(f"  {class_name}: {iou:.4f}")
    print(f"Overall Mean Intersection over Union (mIoU): {overall_mIoU:.4f}")

    print("\nMean Precision per class:")
    for i, precision in enumerate(mean_precision_per_class):
        class_name = CLASS_NAMES[i] if 'CLASS_NAMES' in globals() and i < len(CLASS_NAMES) else f"Class {i}"
        print(f"  {class_name}: {precision:.4f}")

    print("\nMean Recall per class:")
    for i, recall in enumerate(mean_recall_per_class):
        class_name = CLASS_NAMES[i] if 'CLASS_NAMES' in globals() and i < len(CLASS_NAMES) else f"Class {i}"
        print(f"  {class_name}: {recall:.4f}")
def train_hrnet_model(epochs = 10,):
    from torch.utils.data import DataLoader
    models = _get_models()[1]
    train_transform, val_transform = transform()
    train_ds = YOLOSegDataset(os.path.join(os.path.join(STORAGE_DIR,RETRAIN_DIR),"images","train"), os.path.join(os.path.join(STORAGE_DIR,RETRAIN_DIR),"labels","train"), img_size=512, transform=train_transform)
    val_ds   = YOLOSegDataset(os.path.join(os.path.join(STORAGE_DIR,RETRAIN_DIR),"images","val"), os.path.join(os.path.join(STORAGE_DIR,RETRAIN_DIR),"labels","val"), img_size=512, transform=val_transform)

    train_loader = DataLoader(train_ds, batch_size=4, shuffle=True)
    val_loader   = DataLoader(val_ds, batch_size=4)

    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = models.to(device)

    optimizer = torch.optim.AdamW(model.parameters(), lr=3e-4)

    best_val_loss = float('inf')
    patience = 10
    counter = 0

    train_losses_history = []
    val_losses_history = []

    for epoch in range(epochs):
        models.train()
        train_loss = 0

        for imgs, masks in train_loader:
            imgs, masks = imgs.to(device), masks.to(device)

            optimizer.zero_grad()
            out = model(imgs)

            loss = loss_fn(out, masks)
            loss.backward()
            optimizer.step()

            train_loss += loss.item()

        model.eval()
        val_loss = 0
        with torch.no_grad():
            for imgs, masks in val_loader:
                imgs, masks = imgs.to(device), masks.to(device)
                out = model(imgs)
                loss = loss_fn(out, masks)
                val_loss += loss.item()

        train_loss /= len(train_loader)
        val_loss /= len(val_loader)

        train_losses_history.append(train_loss)
        val_losses_history.append(val_loss)

        print(f"Epoch {epoch} Train Loss: {train_loss:.4f} Val Loss: {val_loss:.4f}")

        if val_loss < best_val_loss:
            best_val_loss = val_loss
            counter = 0
            torch.save(model.state_dict(),os.path.join(WORK_DIR,"models","hrnet_new.pth"))
        else:
            counter += 1
            if counter >= patience:
                print(f"Early stopping after {patience} epochs without improvement.")
                break
        
            
def retrain():
    train_hrnet_model()
    # reload_model()
    
if __name__ == "__main__":
    image = r"C:\Users\HP\Downloads\drive-download-20260708T162158Z-3-001\0d275df7-Sayli_19_241.jpg"

    result = predict(image)

    cv2.namedWindow("Blade", cv2.WINDOW_NORMAL)
    cv2.imshow("Blade", result["blade_image"])

    cv2.namedWindow("HRNet Output", cv2.WINDOW_NORMAL)
    cv2.setWindowProperty(
        "HRNet Output",
        cv2.WND_PROP_FULLSCREEN,
        cv2.WINDOW_FULLSCREEN,
    )
    cv2.imshow("HRNet Output", result["hrnet_output"])

    print("\nDefect Summary:")
    print(f"Detected defects: {result['defect_count']}")
    print(f"Defect names: {result['defect_names']}")
    print(f"Counts by type: {result['defect_count_by_type']}")

    cv2.waitKey(0)
    cv2.destroyAllWindows()