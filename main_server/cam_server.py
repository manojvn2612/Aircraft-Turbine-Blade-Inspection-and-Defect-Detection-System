# cam_server.py — Headless uvcham camera server (port 5002)
# No PyQt5 needed. backend.py proxies /camera/* routes here.

import sys, os, time, threading, json
from datetime import datetime

import numpy as np
import cv2
from flask import Flask, jsonify, request, Response
from flask_cors import CORS

try:
    import uvcham
except ImportError:
    print("[CamServer] ERROR: uvcham not found.")
    sys.exit(1)

app = Flask(__name__)
CORS(app)

PORT      = 5002
SNAP_BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "captures")
os.makedirs(SNAP_BASE, exist_ok=True)

# ─── Shared state ─────────────────────────────────────────────────────────────
_cam_lock      = threading.Lock()
_hcam          = None
_img_width     = 0
_img_height    = 0
_pData         = None

_frame_lock         = threading.Lock()
_latest_jpeg: bytes = None

_settings_lock = threading.Lock()
_settings = {
    "open": False, "cam_id": "",
    "flash": 0, "zoom": 1.5, "focus": 0,
    "auto_expo": False, "expo_time": 0, "expo_gain": 0,
    "auto_focus": False,
}

# ─── Frame callback (fires from uvcham internal thread) ───────────────────────
def _on_event(nEvent, ctx):
    if uvcham.UVCHAM_EVENT_IMAGE & nEvent:
        _pull_frame()
    elif uvcham.UVCHAM_EVENT_ERROR & nEvent:
        print("[CamServer] Camera error.")
        _close_camera_internal()
    elif uvcham.UVCHAM_EVENT_DISCONNECT & nEvent:
        print("[CamServer] Camera disconnected.")
        _close_camera_internal()

def _pull_frame():
    global _latest_jpeg
    with _cam_lock:
        if _hcam is None or _pData is None:
            return
        try:
            _hcam.pull(_pData)
            img = np.frombuffer(_pData, dtype=np.uint8)
            if img.size == _img_width * _img_height * 3:
                rgb = img.reshape((_img_height, _img_width, 3))
                bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
            elif img.size == _img_width * _img_height * 3 // 2:
                yuv = img.reshape((int(_img_height * 1.5), _img_width))
                bgr = cv2.cvtColor(yuv, cv2.COLOR_YUV2BGR_I420)
            else:
                return
            _, buf = cv2.imencode('.jpg', bgr, [cv2.IMWRITE_JPEG_QUALITY, 82])
            jpeg = buf.tobytes()
        except Exception as e:
            print(f"[CamServer] Frame error: {e}")
            return
    with _frame_lock:
        _latest_jpeg = jpeg

# ─── Open / Close ─────────────────────────────────────────────────────────────
def _open_camera_internal(cam_id: str):
    global _hcam, _img_width, _img_height, _pData
    with _cam_lock:
        if _hcam is not None:
            try: _hcam.close()
            except: pass
            _hcam = None

        hcam = uvcham.Uvcham.open(cam_id)
        if not hcam:
            return f"Failed to open camera id={cam_id}"
        try:
            hcam.put(uvcham.UVCHAM_FORMAT, 2)
            res    = hcam.get(uvcham.UVCHAM_RES)
            width  = hcam.get(uvcham.UVCHAM_WIDTH  | res)
            height = hcam.get(uvcham.UVCHAM_HEIGHT | res)
            pData  = bytes(uvcham.TDIBWIDTHBYTES(width * 24) * height)
            hcam.start(None, _on_event, None)
        except Exception as e:
            try: hcam.close()
            except: pass
            return str(e)
        _hcam = hcam; _img_width = width; _img_height = height; _pData = pData

    with _settings_lock:
        _settings["open"]   = True
        _settings["cam_id"] = cam_id
        try: _settings["expo_time"] = _hcam.get(uvcham.UVCHAM_EXPOTIME)
        except: pass
        try: _settings["expo_gain"] = _hcam.get(uvcham.UVCHAM_AGAIN)
        except: pass
        try: _settings["auto_expo"] = bool(_hcam.get(uvcham.UVCHAM_AEXPO))
        except: pass
    print(f"[CamServer] Opened: {cam_id} ({width}x{height})")
    return None

def _close_camera_internal():
    global _hcam, _pData
    with _cam_lock:
        if _hcam:
            try: _hcam.put(uvcham.UVCHAM_LIGHT_ADJUSTMENT, 0)
            except: pass
            try: _hcam.put(uvcham.UVCHAM_AFMODE, 0)
            except: pass
            try: _hcam.close()
            except: pass
            _hcam = None; _pData = None
    with _settings_lock:
        _settings["open"] = False
    print("[CamServer] Closed.")

def _apply_setting(key, value):
    with _cam_lock:
        if _hcam is None:
            return
        try:
            if   key == "flash":         _hcam.put(uvcham.UVCHAM_LIGHT_ADJUSTMENT, int(value))
            elif key == "zoom":          _hcam.put(uvcham.UVCHAM_ZOOM, int(float(value) * 10))
            elif key == "focus":         _hcam.put(uvcham.UVCHAM_AFPOSITION, int(value))
            elif key == "auto_expo":     _hcam.put(uvcham.UVCHAM_AEXPO, 1 if value else 0)
            elif key == "expo_time":     _hcam.put(uvcham.UVCHAM_EXPOTIME, int(value))
            elif key == "expo_gain":     _hcam.put(uvcham.UVCHAM_AGAIN, int(value))
            elif key == "auto_focus":    _hcam.put(uvcham.UVCHAM_AFMODE, 1 if value else 0)
            elif key == "white_balance": _hcam.put(uvcham.UVCHAM_WBMODE, 3)
        except Exception as e:
            print(f"[CamServer] Set {key}={value} failed: {e}")

# ─── MJPEG ────────────────────────────────────────────────────────────────────
def _generate_mjpeg():
    while True:
        with _frame_lock:
            frame = _latest_jpeg
        if frame:
            yield b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + frame + b"\r\n"
        time.sleep(1 / 30)

# ─── Routes ───────────────────────────────────────────────────────────────────
@app.route('/health')
def health():
    return jsonify({"status": "UP", "port": PORT})

@app.route('/camera/list')
def camera_list():
    try:
        cams = uvcham.Uvcham.enum()
        return jsonify({"cameras": [{"id": c.id, "name": c.displayname} for c in cams]})
    except Exception as e:
        return jsonify({"cameras": [], "error": str(e)})

@app.route('/camera/open', methods=['POST'])
def camera_open():
    data   = request.get_json(force=True) or {}
    cam_id = data.get("camera_id", "")
    if not cam_id:
        try:
            cams = uvcham.Uvcham.enum()
            if cams: cam_id = cams[0].id
        except: pass
    if not cam_id:
        return jsonify({"error": "No camera id provided and none detected"}), 400
    err = _open_camera_internal(cam_id)
    if err:
        return jsonify({"error": err}), 500
    return jsonify({"message": f"Camera {cam_id} opened", "camera_id": cam_id})

@app.route('/camera/close', methods=['POST'])
def camera_close():
    _close_camera_internal()
    return jsonify({"message": "Camera closed"})

@app.route('/camera/settings', methods=['GET'])
def camera_settings():
    with _settings_lock:
        return jsonify(dict(_settings))

@app.route('/camera/set', methods=['POST'])
def camera_set():
    data = request.get_json(force=True) or {}
    with _settings_lock:
        for k, v in data.items():
            if k in _settings: _settings[k] = v
    for k, v in data.items():
        _apply_setting(k, v)
    return jsonify({"message": "Applied", "keys": list(data.keys())})

@app.route('/camera/autofocus', methods=['POST'])
def camera_autofocus():
    data    = request.get_json(force=True) or {}
    enabled = bool(data.get("enabled", True))
    _apply_setting("auto_focus", enabled)
    with _settings_lock:
        _settings["auto_focus"] = enabled
    return jsonify({"message": f"Autofocus {'ON' if enabled else 'OFF'}"})

@app.route('/camera/white-balance', methods=['POST'])
def camera_wb():
    _apply_setting("white_balance", True)
    return jsonify({"message": "White balance triggered"})

@app.route('/camera-stream')
def camera_stream():
    return Response(_generate_mjpeg(),
                    mimetype='multipart/x-mixed-replace; boundary=frame')

@app.route('/camera-snap')
def camera_snap():
    with _frame_lock:
        frame = _latest_jpeg
    if frame is None:
        return jsonify({"error": "No frame — open camera first"}), 503
    return Response(frame, mimetype='image/jpeg')

@app.route('/camera-status')
def camera_status():
    with _frame_lock:
        available = _latest_jpeg is not None
    with _settings_lock:
        s = dict(_settings)
    return jsonify({"available": available, "open": s["open"],
                    "width": _img_width, "height": _img_height})

@app.route('/snap-and-save', methods=['POST'])
def snap_and_save():
    """
    Snap current frame and save with shot nomenclature.

    Body: {
        "blade_id":  "BLD-2024-001",     // required
        "shot_sr":   7,                  // required — shot serial number
        "part_name": "Top mid opp part"  // required
    }
    Saves to: captures/{blade_id}/{sr:02d}_{safe_part}.jpg
    """
    with _frame_lock:
        frame = _latest_jpeg
    if frame is None:
        return jsonify({"error": "No frame — open camera first"}), 503

    data      = request.get_json(force=True) or {}
    blade_id  = data.get("blade_id",  "").strip()
    shot_sr   = data.get("shot_sr")
    part_name = data.get("part_name", "").strip()

    if not blade_id:  return jsonify({"error": "blade_id required"}), 400
    if shot_sr is None: return jsonify({"error": "shot_sr required"}), 400
    if not part_name: return jsonify({"error": "part_name required"}), 400

    safe_part = part_name.lower().replace(" ", "_").replace("/", "_")
    filename  = f"{int(shot_sr):02d}_{safe_part}.jpg"
    folder    = os.path.join(SNAP_BASE, blade_id)
    os.makedirs(folder, exist_ok=True)
    filepath  = os.path.join(folder, filename)

    with open(filepath, "wb") as f:
        f.write(frame)

    print(f"[CamServer] Saved: {filepath}")
    return jsonify({
        "message":   "Saved",
        "filename":  filename,
        "path":      filepath,
        "blade_id":  blade_id,
        "shot_sr":   shot_sr,
        "part_name": part_name,
    })

# ─── Boot ─────────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    print(f"[CamServer] Starting on :{PORT}  |  captures → {SNAP_BASE}")
    app.run(host='0.0.0.0', port=PORT, debug=False, threaded=True)