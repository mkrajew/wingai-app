# FROM pytorch/pytorch:2.9.1-cuda12.8-cudnn9-runtime
FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/


RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/backend

COPY pyproject.toml uv.lock ./

RUN uv sync --locked

COPY ./main.py .
COPY ./wings/ ./wings/

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
