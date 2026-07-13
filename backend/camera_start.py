import subprocess,sys,os,shutil
from datetime import datetime
from dotenv import load_dotenv
def _launch_camera_app(cam1_path,save_path=None):
    """Spawn pic_clicker.py as a subprocess."""
    _camera_process = None
    cam_path = os.path.join(cam1_path, "pic_clicker.py")
    if not os.path.exists(cam_path):
        print("[Camera] pic_clicker.py not found — skipping auto-launch.")
        return
    print("[Camera] Launching pic_clicker.py...")
    _camera_process = subprocess.Popen([sys.executable, cam_path], cwd=save_path)
    today = datetime.now().strftime('%Y-%m-%d')
    print(f"[Camera] pic_clicker.py launched (PID {_camera_process.pid})")
    return _camera_process