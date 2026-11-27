#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
XV6_PATH="${XV6_PATH:-$HOME/xv6}"

if [[ ! -f "$BACKEND_DIR/app.py" ]]; then
  printf 'Backend app not found at %s\n' "$BACKEND_DIR/app.py" >&2
  exit 1
fi
if [[ ! -f "$XV6_PATH/Makefile" ]]; then
  printf 'xv6 Makefile not found at %s (set XV6_PATH to your xv6 checkout)\n' "$XV6_PATH" >&2
  exit 1
fi

export XV6_PATH
PORT="${PORT:-5000}"
export PORT

if [[ -x "$BACKEND_DIR/.venv/bin/python" ]]; then
  PYTHON="$BACKEND_DIR/.venv/bin/python"
else
  PYTHON="$(command -v python3 || true)"
  if [[ -z "$PYTHON" ]]; then
    printf 'python3 is required to run the backend\n' >&2
    exit 1
  fi
fi

BACKEND_PID=
FRONTEND_PID=

stop_group() {
  local pid="$1"
  [[ -n "$pid" ]] || return 0
  kill -TERM -- "-$pid" 2>/dev/null || true
}

shutdown() {
  trap - EXIT INT TERM
  stop_group "$FRONTEND_PID"
  stop_group "$BACKEND_PID"
  [[ -z "$FRONTEND_PID" ]] || wait "$FRONTEND_PID" 2>/dev/null || true
  [[ -z "$BACKEND_PID" ]] || wait "$BACKEND_PID" 2>/dev/null || true
}
trap shutdown EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

printf 'Starting xv6 dashboard backend (XV6_PATH=%s)\n' "$XV6_PATH"
setsid "$PYTHON" "$BACKEND_DIR/app.py" &
BACKEND_PID=$!

if [[ -d "$FRONTEND_DIR" ]]; then
  if [[ ! -f "$FRONTEND_DIR/package.json" ]]; then
    printf 'Frontend directory exists but package.json is missing: %s\n' "$FRONTEND_DIR" >&2
    exit 1
  fi
  if ! command -v npm >/dev/null 2>&1; then
    printf 'npm is required because the frontend directory exists\n' >&2
    exit 1
  fi
  printf 'Starting frontend from %s\n' "$FRONTEND_DIR"
  setsid bash -c 'cd "$1" && exec npm run dev -- --host 127.0.0.1' _ "$FRONTEND_DIR" &
  FRONTEND_PID=$!
else
  printf 'No frontend directory found; starting backend only.\n'
fi

printf 'Press Ctrl-C to stop the dashboard.\n'
wait "$BACKEND_PID"
