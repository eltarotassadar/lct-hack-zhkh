# FastAPI backend for Cloud Run
# Builds from repo root; runs `backend.main:app` on port 8080.

FROM python:3.11-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONPATH=/app

WORKDIR /app

# Upgrade pip and install Poetry for dependency export
RUN pip install --upgrade pip setuptools wheel \
    && pip install poetry poetry-plugin-export

# Copy only backend dependency manifests first for better layer caching
COPY backend/pyproject.toml backend/poetry.lock ./backend/

# Export Poetry lock to requirements and install
RUN set -eux; \
    cd backend; \
    # Use poetry-plugin-export; prefer groups if available, else fall back. If export is unavailable, install via PEP 517.
    (poetry export -f requirements.txt -o /tmp/requirements.txt --without-hashes --only main \
      || poetry export -f requirements.txt -o /tmp/requirements.txt --without-hashes --without dev); \
    (pip install --no-cache-dir -r /tmp/requirements.txt || pip install --no-cache-dir .)

# Copy application code and synthetic data used by the API
COPY backend ./backend
COPY data ./data

ENV PORT=8080
EXPOSE 8080

# Start the ASGI server
CMD ["python", "-m", "uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8080"]
