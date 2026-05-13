# ──────────────────────────────────────────────────────────────────────────────
# Stage 1 – Build / dependency layer
# ──────────────────────────────────────────────────────────────────────────────
FROM python:3.13-slim AS builder

WORKDIR /build

# System deps needed to compile asyncpg / cffi
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libffi-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --upgrade pip \
    && pip install --no-cache-dir --prefix=/install -r requirements.txt


# ──────────────────────────────────────────────────────────────────────────────
# Stage 2 – Runtime image (lean)
# ──────────────────────────────────────────────────────────────────────────────
FROM python:3.13-slim AS runtime

# Non-root user for security
RUN addgroup --system appgroup && adduser --system --ingroup appgroup appuser

WORKDIR /app

# Copy installed packages from builder
COPY --from=builder /install /usr/local

# Copy application source
COPY --chown=appuser:appgroup . .

# Remove dev artefacts that must not ship in production
RUN rm -rf venv __pycache__ .env nohup.out start.bat tests/

USER appuser

EXPOSE 8000

# ENVIRONMENT is overridden at runtime via docker-compose / -e flags
ENV ENVIRONMENT=PROD \
    PORT=8000 \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# Use exec form so signals propagate correctly (graceful shutdown)
CMD ["uvicorn", "main:app", \
     "--host", "0.0.0.0", \
     "--port", "8000", \
     "--proxy-headers", \
     "--forwarded-allow-ips=*"]
