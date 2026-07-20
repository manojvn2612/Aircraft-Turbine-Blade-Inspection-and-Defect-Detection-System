# ============================================================================
# Body Server — YOLO body/blade segmentation microservice (port 5001)
# NOTE: Place body_model.pt in this directory before building.
# ============================================================================
FROM python:3.10-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# ── System dependencies ────────────────────────────────────────────────────
RUN apt-get update --allow-releaseinfo-change && \
    apt-get install -y --no-install-recommends \
        build-essential gcc g++ git \
        libgl1 libglib2.0-0 ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# ── Python dependencies ────────────────────────────────────────────────────
RUN pip install --upgrade pip setuptools wheel

# Install PyTorch CPU variant (avoids multi-GB CUDA download)
RUN pip install --no-cache-dir \
    torch torchvision \
    --index-url https://download.pytorch.org/whl/cpu

# Install remaining packages (filter torch/torchvision to prevent re-download)
COPY requirements.txt .
RUN grep -ivE "^(torch==|torchvision==|pywin32)" requirements.txt > /tmp/req.txt && \
    pip install --no-cache-dir -r /tmp/req.txt && \
    rm /tmp/req.txt

# ── Application code ───────────────────────────────────────────────────────
COPY . .

# Patch Flask to bind 0.0.0.0 (required for Docker container networking)
RUN sed -i "s/app\.run(port=5001, debug=False)/app.run(host='0.0.0.0', port=5001, debug=False)/" body_server.py

EXPOSE 5001

HEALTHCHECK --interval=30s --timeout=10s --retries=5 --start-period=120s \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:5001/health')" || exit 1

CMD ["python", "body_server.py"]
