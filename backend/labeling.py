import os
import time
import subprocess
import webbrowser
from pathlib import Path
import dotenv

WORK_DIR  = os.getenv("WORK_DIR", os.path.join(os.getcwd(),".."))
# Environment variables
HOST = os.getenv("HOST", "localhost")
PORT = int(os.getenv("PORT", "8080"))

os.environ["DJANGO_ALLOWED_HOSTS"] = os.getenv("DJANGO_ALLOWED_HOSTS", "*")
os.environ["SECRET_KEY"] = os.getenv("secret_key", "BFL")

dotenv.load_dotenv(WORK_DIR + "/.env")
# Label Studio data directory
mkdir = os.path.join(WORK_DIR, "label_studio_data")
data_path = os.getenv("data_path",os.path.join(WORK_DIR, "label_studio_data"))
if not data_path:
    raise ValueError("data_path not found in .env")
DATA_DIR = Path(data_path)
DATA_DIR.mkdir(parents=True, exist_ok=True)

os.environ["LABEL_STUDIO_BASE_DATA_DIR"] = str(DATA_DIR)

# Start Label Studio
label_studio_process = subprocess.Popen([
    "label-studio",
    "start",
    "--host",
    HOST,
    "--port",
    str(PORT),
])

print(f"[Label Studio] Launched on http://{HOST}:{PORT}")

# Wait for Label Studio to start
time.sleep(5)

# Open browser
webbrowser.open(f"http://{HOST}:{PORT}")

try:
    print("Server running. Press Ctrl+C to stop.")
    while True:
        time.sleep(1)

except KeyboardInterrupt:
    print("\nShutting down...")

    label_studio_process.terminate()
    label_studio_process.wait()

    print("Stopped cleanly.")