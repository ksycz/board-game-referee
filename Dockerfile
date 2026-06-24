FROM node:22-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
# Hybrid deploy: VITE_DEMO_MODE=1 (default) lets the SPA fail open to demo if /api/config is briefly unreachable.
# Personal-only Docker builds: docker build --build-arg VITE_DEMO_MODE=0 .
# Do not set VITE_API_ACCESS_KEY in production images — use ?access= at runtime instead.
ARG VITE_DEMO_MODE=1
ARG VITE_API_ACCESS_KEY=
ENV VITE_API_URL=
ENV VITE_DEMO_MODE=$VITE_DEMO_MODE
ENV VITE_API_ACCESS_KEY=$VITE_API_ACCESS_KEY
RUN npm run build

FROM python:3.12-slim
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    tesseract-ocr \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./backend/
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

WORKDIR /app/backend
ENV DATA_DIR=/data
ENV ENVIRONMENT=production
ENV OCR_FALLBACK=1
VOLUME /data

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
