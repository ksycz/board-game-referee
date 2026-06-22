#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/backend"

if [ ! -d .venv ]; then
  echo "Missing backend/.venv — run backend setup first (see README)." >&2
  exit 1
fi

# shellcheck disable=SC1091
source .venv/bin/activate

export E2E_STUB_LLM=1
export ANTHROPIC_API_KEY=e2e-stub
export CORS_ORIGINS="http://localhost:5174"
export DATA_DIR="${E2E_DATA_DIR:-$(mktemp -d)/data}"
export PATH="/opt/homebrew/bin:/usr/local/bin:${PATH}"

exec uvicorn main:app --host 127.0.0.1 --port 8001
