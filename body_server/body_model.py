# body_model.py — client that calls body_server on port 5001
import requests
import numpy as np
import cv2
import base64

BODY_SERVER_URL = "http://127.0.0.1:5001/detect"

def initialize_model(weights_path=None):
    print("Body model running as external service on port 5001")

def detect_bodies(image):
    _, buffer = cv2.imencode('.png', image)
    files = {'image': ('image.png', buffer.tobytes(), 'image/png')}
    response = requests.post(BODY_SERVER_URL, files=files)
    response.raise_for_status()
    response_json = response.json()

    # body_server now returns {"message": str|None, "detections": [...]}
    # Handle both old (plain list) and new (dict envelope) formats.
    if isinstance(response_json, dict):
        body_message   = response_json.get("message")
        detections_raw = response_json.get("detections", [])
    else:
        body_message   = None
        detections_raw = response_json

    # Body not isolated — fall back to full image as the crop so defect
    # detection still runs. body_message is carried through to the UI.
    if body_message:
        h, w = image.shape[:2]
        return {
            "message": body_message,
            "detections": [{
                "box":           [0, 0, w, h],
                "confidence":    0.0,
                "cropped_image": image.copy(),
            }]
        }

    detections = []
    for d in detections_raw:
        img_data  = base64.b64decode(d["cropped_image_b64"])
        img_array = np.frombuffer(img_data, np.uint8)
        cropped   = cv2.imdecode(img_array, cv2.IMREAD_COLOR)
        detections.append({
            "box":           d["box"],
            "confidence":    d["confidence"],
            "cropped_image": cropped,
        })

    return detections