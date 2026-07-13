import os
import shutil
import uuid
import zipfile
from datetime import datetime, timedelta, timezone
import cv2
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Security, UploadFile, File, Response, Depends, Cookie, status
from fastapi.security import APIKeyCookie
from fastapi.responses import JSONResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
import subprocess, jwt, sys
import platform

# Renamed on import to avoid colliding with the /predict route function below.
from model import predict as run_prediction, retrain, save_model as save_trained_model

from camera_start import _launch_camera_app

load_dotenv("../.env")
WORK_DIR = os.getenv("WORK_DIR", "..")

SECRET_KEY = os.getenv("SECRET_KEY")
ALGORITHM = "HS256"
STORAGE_DIR = os.path.join(WORK_DIR, os.getenv("STORAGE_DIR", "storage"))
RESULT_DIR = os.path.join(STORAGE_DIR, os.getenv("RESULT_DIR", "results"))
UPLOAD_DIR = os.path.join(STORAGE_DIR, os.getenv("UPLOAD_DIR", "uploads"))
RETRAIN_DIR = os.getenv("RETRAIN_DIR","retrain")
RETRAIN_DIR = os.path.join(STORAGE_DIR,RETRAIN_DIR)
QUICK_UPLOAD_DIR = os.path.join(WORK_DIR, "quick_uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(RESULT_DIR, exist_ok=True)
os.makedirs(RETRAIN_DIR,exist_ok=True)
os.makedirs(QUICK_UPLOAD_DIR, exist_ok=True)

cookie_scheme = APIKeyCookie(name="session_token", auto_error=False)


def create_session_token(session_id: str):
    """Encodes the session ID and an expiration time into a signed JWT."""
    payload = {
        "session_id": session_id,
        "exp": datetime.now(timezone.utc) + timedelta(hours=2)
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def verify_and_refresh_session(token: str = Security(cookie_scheme)):
    """
    Decodes the token. If expired, automatically generates a new session ID
    and signals the endpoint to refresh the user's cookie.
    """
    if not token:
        raise HTTPException(status_code=401, detail="Missing session token")
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload["session_id"], False  # (session_id, needs_refresh_flag)
    except jwt.ExpiredSignatureError:
        new_session_id = uuid.uuid4().hex
        return new_session_id, True  # Return the new ID and flag it for a refresh
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid session token")


def set_session_cookie(response: Response, token: str):
    response.set_cookie(
        key="session_token",
        value=token,
        httponly=True,
        samesite="none",
        secure=True,
        max_age=7200
    )


def get_session_folder_name(session_id: str) -> str:
    date_str = datetime.now().strftime("%Y-%m-%d")
    return f"{date_str}_{session_id}"


app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def start(response: Response, session_token: str = Cookie(None)):
    if session_token:
        try:
            payload = jwt.decode(
                session_token,
                SECRET_KEY,
                algorithms=[ALGORITHM]
            )

            session_id = payload["session_id"]

            return {
                "Hello": "World",
                "session_id": session_id,
                "status": "existing_session"
            }

        except jwt.ExpiredSignatureError:
            print("Cookie expired")

        except jwt.InvalidTokenError:
            print("Invalid cookie")

    session_id = uuid.uuid4().hex
    token = create_session_token(session_id)
    set_session_cookie(response, token)

    return {
        "Hello": "World",
        "session_id": session_id,
        "status": "new_session"
    }


@app.post("/upload-image")
async def upload_image(
    response: Response,
    file: UploadFile = File(...),
    session_data: tuple = Depends(verify_and_refresh_session)
):
    """Creates a date_session_id folder and saves the file inside it."""
    session_id, needs_refresh = session_data

    if needs_refresh:
        new_token = create_session_token(session_id)
        set_session_cookie(response, new_token)

    folder_name = get_session_folder_name(session_id)
    session_folder_path = os.path.join(UPLOAD_DIR, folder_name)
    os.makedirs(session_folder_path, exist_ok=True)
    file_path = os.path.join(session_folder_path, file.filename)

    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    return {
        "message": "Image uploaded successfully",
        "folder_name": folder_name,
        "saved_folder": folder_name,
        "saved_path": file_path,
        "session_status": "refreshed" if needs_refresh else "active"
    }


_camera_process = None


@app.post("/camera")
def camera_start(
    response: Response,
    session_data: tuple = Depends(verify_and_refresh_session)
):
    global _camera_process

    session_id, needs_refresh = session_data

    if needs_refresh:
        new_token = create_session_token(session_id)
        set_session_cookie(response, new_token)

    folder_name = get_session_folder_name(session_id)
    session_folder_path = os.path.join(UPLOAD_DIR, folder_name)
    os.makedirs(session_folder_path, exist_ok=True)

    if _camera_process and _camera_process.poll() is None:
        _camera_process.terminate()
        try:
            _camera_process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            _camera_process.kill()

        _camera_process = None

        return {"status": "stopped", "folder_name": folder_name}

    _camera_process = _launch_camera_app(
        os.getcwd(),
        save_path=session_folder_path
    )

    return {
        "status": "started",
        "folder_name": folder_name,
        "save_path": session_folder_path,
        "pid": _camera_process.pid if _camera_process else None
    }


@app.get("/images")
async def list_images(session_data: tuple = Depends(verify_and_refresh_session)):
    session_id, needs_refresh = session_data
    folder_name = get_session_folder_name(session_id)
    session_folder_path = os.path.join(UPLOAD_DIR, folder_name)

    if not os.path.exists(session_folder_path):
        return {"images": []}

    images = [
        f for f in os.listdir(session_folder_path)
        if os.path.isfile(os.path.join(session_folder_path, f))
    ]
    return {"images": images}


@app.get("/images/{filename}")
async def get_image(
    filename: str,
    session_data: tuple = Depends(verify_and_refresh_session),
):
    session_id, needs_refresh = session_data
    folder_name = get_session_folder_name(session_id)
    session_folder_path = os.path.join(UPLOAD_DIR, folder_name)

    # Guard against path traversal (e.g. "../../etc/passwd")
    safe_filename = os.path.basename(filename)
    file_path = os.path.join(session_folder_path, safe_filename)

    if not os.path.abspath(file_path).startswith(os.path.abspath(session_folder_path)):
        raise HTTPException(status_code=400, detail="Invalid filename")

    if not os.path.isfile(file_path):
        raise HTTPException(status_code=404, detail="Image not found")

    return FileResponse(file_path)


@app.get("/results/{filename}")
async def get_result_image(
    filename: str,
    session_data: tuple = Depends(verify_and_refresh_session),
):
    """Serves a predicted/annotated image from this session's results folder."""
    session_id, needs_refresh = session_data
    folder_name = get_session_folder_name(session_id)
    result_folder_path = os.path.join(RESULT_DIR, folder_name)

    safe_filename = os.path.basename(filename)
    file_path = os.path.join(result_folder_path, safe_filename)

    if not os.path.abspath(file_path).startswith(os.path.abspath(result_folder_path)):
        raise HTTPException(status_code=400, detail="Invalid filename")

    if not os.path.isfile(file_path):
        raise HTTPException(status_code=404, detail="Result image not found")

    return FileResponse(file_path)


@app.post("/predict")
def predict_all(
    session_data: tuple = Depends(verify_and_refresh_session)
):
    session_id, needs_refresh = session_data
    folder_name = get_session_folder_name(session_id)
    session_folder_path = os.path.join(UPLOAD_DIR, folder_name)

    if not os.path.exists(session_folder_path):
        raise HTTPException(status_code=404, detail="No uploaded images found for this session")

    result_folder_path = os.path.join(RESULT_DIR, folder_name)
    os.makedirs(result_folder_path, exist_ok=True)

    items = [
        f for f in os.listdir(session_folder_path)
        if os.path.isfile(os.path.join(session_folder_path, f))
    ]

    results = []

    for item in items:
        item_path = os.path.join(session_folder_path, item)

        prediction = run_prediction(item_path)


        annotated_vis = prediction.get("hrnet_output")
        output_filename = f"predicted_{item}"

        if annotated_vis is not None:
            output_path = os.path.join(result_folder_path, output_filename)
            cv2.imwrite(output_path, annotated_vis)
        result_entry = dict(prediction)
        result_entry["filename"] = item
        result_entry["result_filename"] = output_filename
        result_entry.pop("hrnet_output", None)  # raw array isn't JSON-serializable
        result_entry.pop("blade_image", None)   # raw array isn't JSON-serializable

        results.append(result_entry)

    return {
        "message": "Prediction completed",
        "result_folder": result_folder_path,
        "results": results,
    }

@app.post("/start-labeling")
def start_labeling_endpoint(
    response: Response,
    session_data: tuple = Depends(verify_and_refresh_session)
):
    session_id, needs_refresh = session_data

    if needs_refresh:
        new_token = create_session_token(session_id)
        set_session_cookie(response, new_token)

    script_path = os.path.abspath(os.path.join(os.getcwd(), "labeling.py"))
    if not os.path.exists(script_path):
        raise HTTPException(status_code=404, detail="Labeling script not found")

    try:
        process = subprocess.Popen(
            [sys.executable, script_path],
            cwd=os.getcwd(),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            stdin=subprocess.DEVNULL,
            start_new_session=True,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not start labeling tool: {exc}") from exc

    return {
        "message": "Labeling tool started successfully",
        "pid": process.pid,
    }


@app.post("/open-quick-upload")
def open_quick_upload_folder(
    response: Response,
    session_data: tuple = Depends(verify_and_refresh_session)
):
    session_id, needs_refresh = session_data

    if needs_refresh:
        new_token = create_session_token(session_id)
        set_session_cookie(response, new_token)

    os.makedirs(QUICK_UPLOAD_DIR, exist_ok=True)

    try:
        if platform.system() == "Windows":
            os.startfile(QUICK_UPLOAD_DIR)
        elif platform.system() == "Darwin":
            subprocess.Popen(["open", QUICK_UPLOAD_DIR])
        else:
            subprocess.Popen(["xdg-open", QUICK_UPLOAD_DIR])
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not open folder: {exc}") from exc

    return {
        "message": "Quick upload folder opened",
        "folder": QUICK_UPLOAD_DIR,
    }


@app.post("/retrain")
def retrain_endpoint(
    session_data: tuple = Depends(verify_and_refresh_session)
):
    session_id, needs_refresh = session_data

    result = retrain()

    return {
        "message": "Retraining completed",
        "status": "done" if result["is_updated"] else "scrapped",
        "is_updated": result["is_updated"],
        "response": result["response"]
    }


@app.post("/save-model")
def save_model_endpoint(
    session_data: tuple = Depends(verify_and_refresh_session)
):
    session_id, needs_refresh = session_data

    result = save_trained_model()

    if result.get("saved"):
        return {
            "message": result["message"],
            "saved": True,
        }

    return {
        "message": result["message"],
        "saved": False,
    }, 404


@app.post("/upload-retrain-zip")
def upload_retrain_zip(
    file: UploadFile = File(...),
    session_data: tuple = Depends(verify_and_refresh_session)
):
    session_id, needs_refresh = session_data

    if not file.filename or not file.filename.lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="Please upload a .zip file")

    os.makedirs(RETRAIN_DIR, exist_ok=True)

    temp_zip_path = os.path.join(RETRAIN_DIR, f"{uuid.uuid4().hex}_{file.filename}")
    with open(temp_zip_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    try:
        with zipfile.ZipFile(temp_zip_path, "r") as zf:
            zf.extractall(RETRAIN_DIR)
    except Exception as exc:
        os.remove(temp_zip_path)
        raise HTTPException(status_code=400, detail=f"Failed to extract zip file: {exc}") from exc

    os.remove(temp_zip_path)

    return {
        "message": "Retraining dataset uploaded and extracted successfully",
        "folder": RETRAIN_DIR,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)