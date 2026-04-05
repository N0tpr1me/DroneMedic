#!/bin/bash
# DroneMedic — Start Full Simulation Stack
#
# Launches:
#   1. PX4 SITL headless (in background)
#   2. Telemetry WebSocket bridge
#
# Usage:  bash simulation/scripts/start_sim.sh
#         bash simulation/scripts/start_sim.sh --mock   # skip PX4, mock only
#
# The telemetry bridge auto-falls back to mock if PX4 isn't available,
# so --mock just skips the PX4 launch step.

set -e

PROJECT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$PROJECT_DIR"

MOCK_ONLY=false
if [ "$1" = "--mock" ]; then
    MOCK_ONLY=true
fi

echo "============================================"
echo "  DroneMedic — Simulation Stack"
echo "============================================"
echo ""

# --- Step 1: PX4 SITL (optional) ---
if [ "$MOCK_ONLY" = false ]; then
    PX4_DIR="${PX4_DIR:-$HOME/PX4-Autopilot}"
    if [ -d "$PX4_DIR" ]; then
        echo "[1/2] Starting PX4 SITL headless..."
        export PX4_HOME_LAT=51.5074
        export PX4_HOME_LON=-0.1278
        export PX4_HOME_ALT=0
        (cd "$PX4_DIR" && make px4_sitl none_iris) &
        PX4_PID=$!
        echo "      PX4 PID: $PX4_PID"
        echo "      Waiting 10s for PX4 to initialize..."
        sleep 10
    else
        echo "[1/2] PX4 not found at $PX4_DIR — bridge will use mock telemetry"
    fi
else
    echo "[1/2] Skipped PX4 (--mock mode)"
fi

# --- Step 2: Telemetry Bridge ---
echo "[2/2] Starting telemetry bridge on ws://localhost:8765..."
echo ""

# Activate px4-env if it exists
if [ -d "simulation/px4-env" ]; then
    source simulation/px4-env/bin/activate
fi

python simulation/telemetry_bridge.py

# Cleanup on exit
if [ -n "$PX4_PID" ]; then
    echo "Stopping PX4 (PID $PX4_PID)..."
    kill "$PX4_PID" 2>/dev/null || true
fi
