#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_PID=""
FRONTEND_PID=""

cleanup() {
  trap - INT TERM EXIT
  if [ -n "$FRONTEND_PID" ]; then
    kill "$FRONTEND_PID" 2>/dev/null || true
  fi
  if [ -n "$BACKEND_PID" ]; then
    kill "$BACKEND_PID" 2>/dev/null || true
  fi
}

trap cleanup INT TERM EXIT

if [ ! -d "$ROOT/backend/.venv" ]; then
  echo "Missing backend/.venv — run setup in backend/ first (see README)."
  exit 1
fi

if [ ! -d "$ROOT/frontend/node_modules" ]; then
  echo "Missing frontend/node_modules — run: cd frontend && npm install"
  exit 1
fi

echo "Starting backend on http://localhost:8000"
(
  cd "$ROOT/backend"
  source .venv/bin/activate
  export PATH="/opt/homebrew/bin:/usr/local/bin:${PATH}"
  exec uvicorn main:app --reload --port 8000
) &
BACKEND_PID=$!

echo "Starting frontend on http://localhost:5173"
(
  cd "$ROOT/frontend"
  exec npm run dev
) &
FRONTEND_PID=$!

echo "Press Ctrl+C to stop both servers."
wait
