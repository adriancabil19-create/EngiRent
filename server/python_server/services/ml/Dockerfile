FROM python:3.12-slim

WORKDIR /app

# libgl1-mesa-glx was renamed to libgl1 in Debian Trixie.
# opencv-python-headless doesn't need OpenGL — only libglib2.0-0 is required.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 \
    libgl1 \
    tesseract-ocr \
    && rm -rf /var/lib/apt/lists/*

# Install CPU-only torch first (GPU build is ~800MB, CPU is ~200MB)
# Strip torch/torchvision from requirements.txt then install separately
COPY requirements.txt .
RUN grep -v "^torch\|^torchvision" requirements.txt > requirements_base.txt && \
    pip install --no-cache-dir \
        torch==2.5.1+cpu \
        torchvision==0.20.1+cpu \
        --index-url https://download.pytorch.org/whl/cpu && \
    pip install --no-cache-dir -r requirements_base.txt

COPY app/ ./app/

EXPOSE 8001

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8001}"]
