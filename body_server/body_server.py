# body_server.py — run this in yoloenv on port 5001
from flask import Flask, jsonify, request
from ultralytics import YOLO
import numpy as np
import cv2
import base64

app = Flask(__name__)
model = YOLO("body_model.pt")

# ── Tuneable thresholds ────────────────────────────────────────────────────────
BODY_CONF       = 0.35    # minimum confidence for body detection
MIN_CROP_PX     = 60      # ignore detections whose crop is smaller than this (was 80)
MAX_CROP_FRAC   = 0.99    # RAISED from 0.95 → allows close-up full-frame blade shots
                           # Only reject if crop is virtually the entire image AND low conf
MASK_MIN_AREA   = 2000    # px² — masks smaller than this are noise
MASK_MAX_FRAC   = 0.95    # RAISED from 0.45 — close-up blades can fill the frame
PAD             = 6       # padding around detected crop

NO_DETECTION_MSG = (
    "The foreground background separation didn't stand out — "
    "the image may need retraining."
)


@app.route('/health', methods=['GET'])
def health():
    return jsonify({"status": "ok"})


@app.route('/detect', methods=['POST'])
def detect():
    file  = request.files['image']
    image = cv2.imdecode(np.frombuffer(file.read(), np.uint8), cv2.IMREAD_COLOR)
    image_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)

    h, w  = image.shape[:2]
    img_area = h * w

    results = model.predict(source=image_rgb, conf=BODY_CONF, verbose=False)[0]

    # ── No boxes at all → inform UI, don't discard the image ────────────────
    if results.boxes is None or len(results.boxes) == 0:
        return jsonify({"message": NO_DETECTION_MSG, "detections": []})

    # ── Pre-filter: drop tiny crops and full-frame low-conf boxes ────────────
    valid_indices = []
    for i, box in enumerate(results.boxes):
        x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())
        conf = float(box.conf[0])

        crop_area = (x2 - x1) * (y2 - y1)
        if crop_area > MAX_CROP_FRAC * img_area and conf < 0.35:
            continue
        if (x2 - x1) < MIN_CROP_PX or (y2 - y1) < MIN_CROP_PX:
            continue

        valid_indices.append(i)

    # ── If all candidates were filtered out → no usable detection ────────────
    if not valid_indices:
        return jsonify({"message": NO_DETECTION_MSG, "detections": []})

    # ── Pick the single best detection ───────────────────────────────────────
    # Primary  : highest confidence
    # Tiebreak : highest in frame (smallest y1 → negative so max() prefers it)
    best_idx = max(
        valid_indices,
        key=lambda i: (
            float(results.boxes[i].conf[0]),
            -results.boxes[i].xyxy[0][1].item()
        )
    )

    detections = []

    box = results.boxes[best_idx]
    x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())
    conf = float(box.conf[0])

    # ── Tight padding (clipped to image bounds) ──────────────────────────────
    x1p = max(0, x1 - PAD)
    y1p = max(0, y1 - PAD)
    x2p = min(w, x2 + PAD)
    y2p = min(h, y2 + PAD)

    # Default fallback: plain bbox crop
    masked_crop = image[y1p:y2p, x1p:x2p].copy()

    # ── Segmentation mask (if available) ────────────────────────────────────
    if results.masks is not None and best_idx < len(results.masks.data):
        mask = results.masks.data[best_idx].cpu().numpy()
        mask = cv2.resize(mask, (w, h), interpolation=cv2.INTER_NEAREST)
        mask = (mask > 0.5).astype(np.uint8)

        mask_area = int(np.sum(mask))

        if MASK_MIN_AREA < mask_area < MASK_MAX_FRAC * img_area:
            kernel = np.ones((5, 5), np.uint8)
            mask   = cv2.morphologyEx(mask, cv2.MORPH_OPEN,  kernel)
            mask   = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)

            ys, xs = np.where(mask > 0)
            if len(xs) and len(ys):
                mx1, my1 = int(xs.min()), int(ys.min())
                mx2, my2 = int(xs.max()), int(ys.max())

                mx1p = max(0, mx1 - PAD)
                my1p = max(0, my1 - PAD)
                mx2p = min(w, mx2 + PAD)
                my2p = min(h, my2 + PAD)

                mask_w = mx2p - mx1p
                mask_h = my2p - my1p
                box_w  = x2p  - x1p
                box_h  = y2p  - y1p
                if mask_w < 2.0 * box_w and mask_h < 2.0 * box_h:
                    masked_image = image.copy()
                    masked_image[mask == 0] = 0
                    masked_crop = masked_image[my1p:my2p, mx1p:mx2p]
                    x1p, y1p, x2p, y2p = mx1p, my1p, mx2p, my2p

    # ── Final fallback: raw bbox crop ────────────────────────────────────────
    if masked_crop.size == 0 or masked_crop.shape[0] == 0 or masked_crop.shape[1] == 0:
        masked_crop = image[y1p:y2p, x1p:x2p].copy()

    if masked_crop.size == 0:
        return jsonify({"message": NO_DETECTION_MSG, "detections": []})

    _, buffer   = cv2.imencode('.png', masked_crop)
    crop_b64    = base64.b64encode(buffer).decode('utf-8')

    detections.append({
        "box":               [x1p, y1p, x2p, y2p],
        "confidence":        conf,
        "cropped_image_b64": crop_b64,
    })

    return jsonify({"message": None, "detections": detections})


if __name__ == '__main__':
    print("Body detection server starting on port 5001...")
    app.run(port=5001, debug=False)