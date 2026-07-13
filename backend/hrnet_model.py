import torch
import segmentation_models_pytorch as smp
import numpy as np
import cv2
import json

# LABELS_FILE = "labels.json"

# with open(LABELS_FILE) as f:
#     CLASS_NAMES = json.load(f)
CLASS_NAMES = [
    "Cutter marks and fish marks",
    "Fingerprints and stains",
    "Ink marks",
    "Jig Marks",
    "Machining Marks",
    "Overcut",
    "Pocket",
    "Scratches and Black spots",
]
NUM_CLASSES = len(CLASS_NAMES)

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

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
_model = None  # singleton — keeps backend.py working as-is



def initialize_model(weights_path="hr_net.pth"):
    global _model
    _model = smp.FPN(
        encoder_name="timm-regnety_032",
        encoder_weights=None,
        in_channels=3,
        classes=NUM_CLASSES,
    )
    state = torch.load(weights_path, map_location=DEVICE)
    _model.load_state_dict(state)
    _model.to(DEVICE)
    _model.eval()
    print(f"HRNet model loaded from {weights_path} on {DEVICE}")


def reload_model(weights_path):
    """Hot-swap the weights without restarting the server."""
    global _model
    print(f"[HRNET] Reloading model from {weights_path}")
    _model = smp.FPN(
        encoder_name="timm-regnety_032",
        encoder_weights=None,
        in_channels=3,
        classes=NUM_CLASSES,
    )
    state = torch.load(weights_path, map_location=DEVICE)
    _model.load_state_dict(state)
    _model.to(DEVICE)
    _model.eval()
    print("[HRNET] Model reloaded successfully")


def _apply_clahe(bgr_image, clip_limit=2.0, tile_grid_size=(8, 8)):
    """Apply CLAHE to the L channel of a BGR image."""
    lab = cv2.cvtColor(bgr_image, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=clip_limit, tileGridSize=tile_grid_size)
    l = clahe.apply(l)
    return cv2.cvtColor(cv2.merge((l, a, b)), cv2.COLOR_LAB2BGR)


def _preprocess(image_bgr, img_size=512):
    """
    CLAHE → resize → normalise → tensor.
    Returns (tensor, enhanced_bgr) where enhanced_bgr is the CLAHE-enhanced
    image at original resolution (used for visualisation).
    """
    enhanced = _apply_clahe(image_bgr)
    resized  = cv2.resize(enhanced, (img_size, img_size))
    rgb      = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
    tensor   = torch.tensor(rgb).permute(2, 0, 1).unsqueeze(0).to(DEVICE)
    # cv2.imwrite("enhanced_image.jpg", enhanced)  # Saving the enhanced image for debugging
    return tensor, enhanced


def _postprocess(pred_probs, enhanced_bgr, img_size, threshold, min_area):
    """
    Convert raw sigmoid probabilities → detections + annotated BGR image.

    pred_probs  : numpy array (C, img_size, img_size)
    enhanced_bgr: CLAHE-enhanced BGR image at original resolution
    min_area    : minimum contour area in pixels (original resolution);
                  predictions smaller than this are skipped
    """
    h_orig, w_orig = enhanced_bgr.shape[:2]
    vis = cv2.cvtColor(enhanced_bgr, cv2.COLOR_BGR2RGB).copy()
    detections = []
    class_masks = []

    for c_idx in range(NUM_CLASSES):
        mask = (pred_probs[c_idx] > threshold).astype(np.uint8)

        if mask.shape != (h_orig, w_orig):
            mask = cv2.resize(mask, (w_orig, h_orig), interpolation=cv2.INTER_NEAREST)

        if np.sum(mask) == 0:
            class_masks.append(None)
            continue

        kernel = np.ones((3, 3), np.uint8)
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
        class_masks.append(mask)

        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        color = tuple(int(c) for c in COLORS[c_idx % len(COLORS)])

        for cnt in contours:
            if cv2.contourArea(cnt) < min_area:
                continue

            x, y, w_box, h_box = cv2.boundingRect(cnt)
            scale_x = img_size / w_orig
            scale_y = img_size / h_orig
            x_m = min(int(x * scale_x), img_size - 1)
            y_m = min(int(y * scale_y), img_size - 1)
            w_m = max(1, min(int(w_box * scale_x), img_size - x_m))
            h_m = max(1, min(int(h_box * scale_y), img_size - y_m))

            region_prob = pred_probs[c_idx][y_m:y_m + h_m, x_m:x_m + w_m]
            confidence = float(np.max(region_prob)) if region_prob.size > 0 else 0.0
            accepted = confidence < 0.75

            detections.append({
                "class_name": CLASS_NAMES[c_idx],
                "confidence": round(confidence, 4),
                "bbox": [x, y, w_box, h_box],
                "accepted": accepted,
            })

            cv2.drawContours(vis, [cnt], -1, color, 2)
            cv2.rectangle(vis, (x, y), (x + w_box, y + h_box), color, 2)

            label = f"{CLASS_NAMES[c_idx]} {confidence:.2f}"
            font_scale = max(0.5, min(h_orig, w_orig) / 600)
            thickness = max(1, int(font_scale * 2))
            (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, font_scale, thickness)
            y_text = y if y >= th + 10 else y + th + 10
            cv2.rectangle(vis, (x, y_text - th - 6), (x + tw + 6, y_text), color, -1)
            cv2.putText(
                vis, label, (x + 3, y_text - 3),
                cv2.FONT_HERSHEY_SIMPLEX, font_scale, (255, 255, 255), thickness,
                cv2.LINE_AA,
            )

    vis_bgr = cv2.cvtColor(vis, cv2.COLOR_RGB2BGR)
    return vis_bgr, detections, class_masks


def predict(image_bgr, img_size=512, threshold=0.6, min_area=200, return_masks=False):
    """
    Main prediction entry-point used by model.py.

    Pipeline: image → preprocess → model → postprocess → (vis_bgr, detections)

    Args:
        image_bgr : BGR numpy array (any resolution)
        img_size  : internal inference resolution (default 512)
        threshold : per-class probability threshold (default 0.6)
        min_area  : minimum contour area in pixels to keep a detection (default 50)

    Returns:
        vis_bgr    — BGR image with contours, boxes and labels drawn
        detections — list of dicts:
                     {class_name, confidence, bbox: [x,y,w,h], accepted: bool}
    """
    if _model is None:
        raise RuntimeError("Call initialize_model() before predict()")

    tensor, enhanced_bgr = _preprocess(image_bgr, img_size)

    with torch.no_grad():
        output = _model(tensor)

    pred_probs = torch.sigmoid(output).squeeze(0).cpu().numpy()  # (C, H, W)

    result = _postprocess(pred_probs, enhanced_bgr, img_size, threshold, min_area)
    if return_masks:
        vis_bgr, detections, class_masks = result
        return vis_bgr, detections, class_masks
    return result


class HRNetInference:
    def __init__(self):
        self.NUM_CLASSES = NUM_CLASSES
        self.CLASS_NAMES = CLASS_NAMES
        self.COLORS = COLORS
        self.device = DEVICE

    def load_model(self, weights_path="hr_net.pth"):
        initialize_model(weights_path)

    def predict(self, image_bgr, img_size=512, threshold=0.8, min_area=200, return_masks=False):
        """
        Predict directly from a NumPy BGR image.
        """
        if image_bgr is None:
            raise ValueError("Input image is None.")

        return predict(
            image_bgr,
            img_size=img_size,
            threshold=threshold,
            min_area=min_area,
            return_masks=return_masks,
        )

    def predict_from_path(self, image_path, img_size=512, threshold=0.8, min_area=200, return_masks=False):
        """
        Predict from an image path.
        """
        image_bgr = cv2.imread(image_path)

        if image_bgr is None:
            raise FileNotFoundError(f"Image not found: {image_path}")

        return predict(
            image_bgr,
            img_size=img_size,
            threshold=threshold,
            min_area=min_area,
            return_masks=return_masks,
        )

if __name__ == "__main__":
    inference = HRNetInference()
    inference.load_model("models/hr_net.pth")

    image_path          = r"C:\Users\HP\Downloads\drive-download-20260708T162158Z-3-001\0d275df7-Sayli_19_241.jpg"
    inference_threshold = 0.8

    vis_bgr, detections = inference.predict_from_path(
        image_path,
        img_size=512,
        threshold=inference_threshold,
    )

    # cv2.imwrite("final_output.png", vis_bgr)
    # print(f"Saved final_output.png — {len(detections)} detection(s)")
    for d in detections:
        status = "ACCEPTED" if d["accepted"] else "REJECTED"
        print(f"  {d['class_name']} | conf={d['confidence']} | {status} | bbox={d['bbox']}")