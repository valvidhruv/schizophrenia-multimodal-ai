# docker/ai-service.Dockerfile
# Multi-stage build for the FastAPI AI service.
#
# Phase 1: CPU-only Python base. No ML frameworks (PyTorch/MONAI/MNE/NiBabel) are
# installed yet; the service only exposes health endpoints (FastAPI + Uvicorn).
#
# Future GPU-enabled model development (deliberately NOT enabled now):
#   1. Build with a CUDA/PyTorch base image:
#        docker compose build --build-arg BASE_IMAGE=pytorch/pytorch:2.1-cuda12.1-cudnn8-runtime ai-service
#      (If that base installs Python under /opt/conda instead of /usr/local, adjust the
#       `COPY --from=deps` paths below. When medical-imaging libraries are added, also
#       re-install their system dependencies: libglib2.0-0 libsm6 libxext6 libxrender-dev
#       libgl1-mesa-glx libgomp1.)
#   2. Start with the GPU override file (requires NVIDIA Container Toolkit):
#        docker compose -f docker-compose.yml -f docker-compose.gpu.yml up ai-service

ARG BASE_IMAGE=python:3.11-slim

# -------------------------------------------
# Base stage - minimal CPU-only Python
# -------------------------------------------
FROM ${BASE_IMAGE} AS base

WORKDIR /app

# curl is required by the production HEALTHCHECK; ca-certificates for HTTPS
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Set Python path
ENV PYTHONPATH=/app
ENV PYTHONUNBUFFERED=1

# -------------------------------------------
# Dependencies stage
# -------------------------------------------
FROM base AS deps

COPY ai-service/requirements.txt ai-service/requirements-dev.txt ./

# Install Python dependencies
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt && \
    pip install --no-cache-dir -r requirements-dev.txt

# -------------------------------------------
# Development stage
# -------------------------------------------
FROM base AS development

ENV PYTHON_ENV=development

COPY --from=deps /usr/local /usr/local

COPY ai-service/ ./

# Create cache directory
RUN mkdir -p /app/cache

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload", "--reload-dir", "/app"]

# -------------------------------------------
# Build stage (for production)
# -------------------------------------------
FROM base AS builder

ENV PYTHON_ENV=production

COPY --from=deps /usr/local /usr/local

COPY ai-service/ ./

# Pre-compile Python files
RUN python -m compileall /app

# -------------------------------------------
# Production stage
# -------------------------------------------
FROM base AS production

ENV PYTHON_ENV=production

# Create non-root user
RUN groupadd -r appuser && useradd -r -g appuser appuser

WORKDIR /app

COPY --from=builder --chown=appuser:appuser /usr/local /usr/local
COPY --from=builder --chown=appuser:appuser /app /app

USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:8000/health || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
