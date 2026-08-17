# syntax=docker/dockerfile:1
# Single Fly app: API (FastAPI) + SPA static files on one process / one hostname

# ── frontend build ───────────────────────────────────────────────
FROM node:20-alpine AS frontend
WORKDIR /app/frontend
# Empty VITE_API_URL → browser uses same origin (/api, /ws)
ARG VITE_API_URL=
ENV VITE_API_URL=$VITE_API_URL
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install --include=dev
COPY frontend/ ./
RUN npm run build

# ── backend runtime ──────────────────────────────────────────────
FROM python:3.11-slim
WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8000

RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/app ./app
COPY --from=frontend /app/frontend/dist ./static

EXPOSE 8000
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}
