#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

# Install Python deps if needed
if ! python3 -c "import fastapi" 2>/dev/null; then
  echo "Installing Python dependencies..."
  pip install -r requirements.txt
fi

echo "Starting DroneMedic backend on port 8000..."
PYTHONPATH=. python3 -m uvicorn backend.app:app --host 0.0.0.0 --port 8000 --reload
