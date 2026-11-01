FROM node:22-bookworm-slim AS frontend
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.ts tsconfig.json ./
COPY src ./src
COPY public ./public
RUN npm run build

FROM python:3.12-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_NO_CACHE=1 \
    STATIC_DIR=/app/frontend \
    PORT=8000
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir uv==0.11.32
WORKDIR /app/backend
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev
COPY backend/*.py ./
COPY --from=frontend /build/dist /app/frontend
RUN useradd --uid 10001 --create-home appuser && mkdir -p /app/data && chown appuser:appuser /app/data
ENV BOLCANVAS_DB_PATH=/app/data/bolcanvas.sqlite3
USER appuser
EXPOSE 8000
CMD ["sh", "-c", "exec .venv/bin/uvicorn main:app --host 0.0.0.0 --port \"${PORT:-8000}\""]
