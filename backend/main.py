import os
import shutil
import uuid
from datetime import datetime, timedelta, timezone
import cv2
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Security, UploadFile, File, Response, Depends, Cookie, status
from fastapi.security import APIKeyCookie
from fastapi.responses import JSONResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
import subprocess, jwt, sys

# Renamed on import to avoid colliding with the /predict route function below.
from model import predict as run_prediction

from camera_start import _launch_camera_app

load_dotenv("../.env")
WORK_DIR = os.getenv("WORK_DIR", "..")

SECRET_KEY = os.getenv("SECRET_KEY")
ALGORITHM = "HS256"
STORAGE_DIR = os.path.join(WORK_DIR, os.getenv("STORAGE_DIR", "storage"))
RESULT_DIR = os.path.join(STORAGE_DIR, os.getenv("RESULT_DIR", "results"))
UPLOAD_DIR = os.path.join(STORAGE_DIR, os.getenv("UPLOAD_DIR", "uploads"))
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(RESULT_DIR, exist_ok=True)

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

@app.post("/retrain")
def retrain(
    session_data: tuple = Depends(verify_and_refresh_session)
):
    session_id, needs_refresh = session_data
    folder_name = get_session_folder_name(session_id)
    result_folder_path = os.path.join(RESULT_DIR, folder_name)
    models = _get

    return {
        "message": "Retraining started",
        "result_folder": result_folder_path,
        "status": "retraining_in_progress"
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)