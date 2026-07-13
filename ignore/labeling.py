from http.server import HTTPServer, BaseHTTPRequestHandler
import logging, ngrok
import time
import dotenv
import os
import subprocess
from pathlib import Path
dotenv.load_dotenv()
os.environ["DJANGO_ALLOWED_HOSTS"] = os.getenv("DJANGO_ALLOWED_HOSTS")
os.environ["CSRF_TRUSTED_ORIGINS"] = os.getenv("CSRF_TRUSTED_ORIGINS")
os.environ['SECRET_KEY'] = os.getenv("secret_key")
#show the folder
data_path = os.getenv("data_path") #who ever is seeing this if u are using this inside the github repo pls dont change i have added it into .gitignore
DATA_DIR = Path(data_path)
DATA_DIR.mkdir(parents=True, exist_ok=True)
os.environ["LABEL_STUDIO_BASE_DATA_DIR"] = str(DATA_DIR)
label_studio_process = subprocess.Popen(
    ["label-studio", "start", "--port", "8080"]
)
#connect to ngrok for public url (i'll send the .env file if u want on github or just ping me :) )
'''keep the structure as
ng_grok_auth_token = "<ur auth token from ngrok>" 
data_path = "path to the folder where u want to save the data for label studio"
secret_key = "BFL"
CSRF_TRUSTED_ORIGINS = "<link u will get when u run labeling.py for the first time after setting up ngrok so copy it and paste it here in .env>"
DJANGO_ALLOWED_HOSTS = "*" #keep it same for development but for production change it to the url of your server
'''
USE_ENFORCE_CSRF_CHECKS=False
NGROK_AUTH_TOKEN = os.getenv("ng_grok_auth_token") 
if not NGROK_AUTH_TOKEN:
    raise ValueError("ng_grok_auth_token not found in .env")
ngrok.set_auth_token(NGROK_AUTH_TOKEN)

logging.basicConfig(level=logging.INFO)

public_url = ngrok.connect(8080, "http")
logging.info(f"ngrok tunnel established: {public_url}")

try:
    logging.info("Server running. Press Ctrl+C to stop.")
    while True:
        time.sleep(1)

except KeyboardInterrupt:
    logging.info("Shutting down...")

    ngrok.kill()
    label_studio_process.terminate()

    logging.info("Stopped cleanly.")