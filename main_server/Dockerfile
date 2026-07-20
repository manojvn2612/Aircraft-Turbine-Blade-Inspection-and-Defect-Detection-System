# ============================================================================
# Main Server — HRNet defect detection + full API backend (port 5000)
# Includes: uvcham SDK, cam_server, pic_clicker, BFL_retrain, all configs
# NOTE: Place hr_net.pth AND body_model.pt in this directory before building.
# ============================================================================
FROM python:3.10-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# ── System dependencies ────────────────────────────────────────────────────
# libusb: required by uvcham camera SDK
# libgl1/libglib2.0: required by OpenCV
# ffmpeg: image/video processing
RUN apt-get update --allow-releaseinfo-change && \
    apt-get install -y --no-install-recommends \
        build-essential gcc g++ git \
        libgl1 libglib2.0-0 ffmpeg \
        libusb-1.0-0 libusb-1.0-0-dev \
    && rm -rf /var/lib/apt/lists/*

# ── Python dependencies ────────────────────────────────────────────────────
RUN pip install --upgrade pip setuptools wheel

# Install PyTorch CPU variant (avoids multi-GB CUDA download)
RUN pip install --no-cache-dir \
    torch torchvision \
    --index-url https://download.pytorch.org/whl/cpu

# Filter out Windows-only packages and torch (already installed above)
COPY requirements.txt .
RUN grep -ivE "^(torch==|torchvision==|pywin32|pywinpty|PyQt5==|PyQt5-Qt5|PyQt5.sip|PyQt5_sip)" \
        requirements.txt > /tmp/req.txt && \
    pip install --no-cache-dir -r /tmp/req.txt && \
    rm /tmp/req.txt

# ── Application code ───────────────────────────────────────────────────────
# Copies everything: backend.py, body_model.py, hrnet_model.py, cam_server.py,
# pic_clicker.py, uvcham.py, uvcham.dll, BFL_retrain.py, shots.json,
# labels.json, Blade_angles.xlsx, parts_configuration files, model weights, etc.
COPY . .

# ── Pre-create required directory structure ─────────────────────────────────
RUN mkdir -p \
    outputs \
    captures \
    retrain_data/approved/images   retrain_data/approved/labels \
    retrain_data/defective/images  retrain_data/defective/labels \
    retrain_data/retrain/images    retrain_data/retrain/labels \
    retrain_data/upload_staging/images retrain_data/upload_staging/labels \
    retrain_data/label_studio_data

# Patch Flask to bind 0.0.0.0 (required for Docker container networking)
RUN sed -i "s/app\.run(debug=False, port=5000)/app.run(host='0.0.0.0', debug=False, port=5000)/" backend.py

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=10s --retries=5 --start-period=180s \
    CMD python -c "import socket; s=socket.create_connection(('localhost',5000),timeout=5); s.close()" || exit 1

CMD ["python", "backend.py"]
