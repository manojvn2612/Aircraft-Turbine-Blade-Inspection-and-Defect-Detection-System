"""
Add these routes to main.py. They implement a simple in-memory job that the
frontend can poll for progress. Replace the body of _run_retraining_job with
your actual training loop, updating _retrain_state as it progresses.

Requires these imports already present (add if missing):
    import threading
    import time
"""

import threading
import time
from fastapi import BackgroundTasks

# Simple in-memory retraining state. For multi-worker/production deployments,
# replace this with a proper job queue (Celery, RQ, etc.) or a DB-backed
# status table, since in-memory state won't be shared across processes.
_retrain_state = {
    "status": "idle",     # "idle" | "running" | "done" | "failed"
    "progress": 0,        # 0-100
    "message": "",
}
_retrain_lock = threading.Lock()


def _run_retraining_job():
    """
    Replace this body with your actual training logic. Update
    _retrain_state periodically (e.g. after each epoch/batch) so the
    frontend's polling shows live progress.
    """
    try:
        with _retrain_lock:
            _retrain_state["status"] = "running"
            _retrain_state["progress"] = 0
            _retrain_state["message"] = "Starting training..."

        total_steps = 10  # e.g. number of epochs

        for step in range(1, total_steps + 1):
            # --- replace this sleep with real training work for this step ---
            time.sleep(2)
            # ------------------------------------------------------------------

            with _retrain_lock:
                _retrain_state["progress"] = int((step / total_steps) * 100)
                _retrain_state["message"] = f"Epoch {step}/{total_steps} complete"

        with _retrain_lock:
            _retrain_state["status"] = "done"
            _retrain_state["progress"] = 100
            _retrain_state["message"] = "Retraining finished successfully."

    except Exception as e:
        with _retrain_lock:
            _retrain_state["status"] = "failed"
            _retrain_state["message"] = f"Retraining failed: {e}"


@app.post("/retrain")
def start_retraining(
    background_tasks: BackgroundTasks,
    session_data: tuple = Depends(verify_and_refresh_session),
):
    with _retrain_lock:
        if _retrain_state["status"] == "running":
            raise HTTPException(status_code=409, detail="Retraining already in progress")

        _retrain_state["status"] = "running"
        _retrain_state["progress"] = 0
        _retrain_state["message"] = "Queued"

    background_tasks.add_task(_run_retraining_job)

    return {"status": "started"}


@app.get("/retrain-status")
def get_retrain_status(
    session_data: tuple = Depends(verify_and_refresh_session),
):
    with _retrain_lock:
        return dict(_retrain_state)