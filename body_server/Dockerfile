FROM python:3.10-bookworm

WORKDIR /app

RUN apt-get update --allow-releaseinfo-change && \
    apt-get install -y --no-install-recommends \
    build-essential \
    gcc \
    g++ \
    git \
    libgl1 \
    libglib2.0-0 \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 5001
CMD ["python", "body_server.py"]
