#!/usr/bin/env bash
# ============================================================================
# DroneMedic Full Stack Launcher
# ============================================================================
# Starts everything needed for the PX4 Live demo:
#   1. SSH tunnel to VM (telemetry bridge on port 8765)
#   2. Backend API server (FastAPI on port 8000)
#   3. Frontend dev server (Vite on port 5173)
#
# The VM side (PX4 SITL + Gazebo + telemetry_bridge) must be started separately:
#   ssh root@144.202.12.168
#   ros2 launch simulation/gazebo/launch_dronemedic.launch.py headless:=true
#
# Or for quick testing without VM (mock telemetry):
#   ./start_full_stack.sh --mock
#
# Usage:
#   ./simulation/scripts/start_full_stack.sh          # Full stack with VM
#   ./simulation/scripts/start_full_stack.sh --mock    # Mock mode (no VM needed)
#   ./simulation/scripts/start_full_stack.sh --no-tunnel  # Skip SSH tunnel
# ============================================================================

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$PROJECT_ROOT"

# -- Parse arguments --
USE_MOCK=false
SKIP_TUNNEL=false
VM_IP="144.202.12.168"
SSH_KEY="$HOME/.ssh/id_ed25519_vultr"

for arg in "$@"; do
    case "$arg" in
        --mock)       USE_MOCK=true; SKIP_TUNNEL=true ;;
        --no-tunnel)  SKIP_TUNNEL=true ;;
        --help|-h)
            echo "Usage: $0 [--mock] [--no-tunnel]"
            echo "  --mock        Use mock telemetry (no VM needed)"
            echo "  --no-tunnel   Skip SSH tunnel (direct network to VM)"
            exit 0
            ;;
    esac
done

# -- Cleanup on exit --
PIDS=()
cleanup() {
    echo ""
    echo "[DroneMedic] Shutting down..."
    for pid in "${PIDS[@]}"; do
        kill "$pid" 2>/dev/null || true
    done
    wait 2>/dev/null
    echo "[DroneMedic] All processes stopped."
}
trap cleanup EXIT INT TERM

echo "============================================"
echo "  DroneMedic Full Stack Launcher"
echo "============================================"
echo "  Mode: $([ "$USE_MOCK" = true ] && echo "MOCK (no VM)" || echo "PX4 LIVE")"
echo "  Project: $PROJECT_ROOT"
echo "============================================"
echo ""

# -- 1. SSH Tunnel (if not mock and not skipping) --
if [ "$USE_MOCK" = false ] && [ "$SKIP_TUNNEL" = false ]; then
    echo "[1/4] Starting SSH tunnel to VM ($VM_IP:8765 → localhost:8765)..."
    ssh -f -N -L 8765:localhost:8765 -i "$SSH_KEY" "root@$VM_IP" 2>/dev/null && \
        echo "  ✓ SSH tunnel established" || \
        echo "  ✗ SSH tunnel failed — is the VM running?"
    # ssh -f backgrounds itself, no PID to track
else
    echo "[1/4] SSH tunnel skipped ($([ "$USE_MOCK" = true ] && echo "mock mode" || echo "--no-tunnel"))"
fi

# -- 2. Mock Telemetry Bridge (if mock mode) --
if [ "$USE_MOCK" = true ]; then
    echo "[2/4] Starting mock telemetry bridge..."
    PYTHONPATH="$PROJECT_ROOT" python3 -m simulation.telemetry_bridge &
    PIDS+=($!)
    echo "  ✓ Mock telemetry on ws://localhost:8765 (PID: ${PIDS[-1]})"
else
    echo "[2/4] Telemetry bridge running on VM (via SSH tunnel)"
fi

# -- 3. Backend API --
echo "[3/4] Starting FastAPI backend on port 8000..."
PYTHONPATH="$PROJECT_ROOT" python3 -m uvicorn backend.api:app --host 0.0.0.0 --port 8000 --reload --log-level info &
PIDS+=($!)
echo "  ✓ Backend API at http://localhost:8000 (PID: ${PIDS[-1]})"

# -- 4. Frontend Dev Server --
echo "[4/4] Starting Vite frontend on port 5173..."
cd "$PROJECT_ROOT/web" && npm run dev -- --host 0.0.0.0 &
PIDS+=($!)
cd "$PROJECT_ROOT"
echo "  ✓ Frontend at http://localhost:5173 (PID: ${PIDS[-1]})"

echo ""
echo "============================================"
echo "  All services running!"
echo "============================================"
echo ""
echo "  Dashboard:   http://localhost:5173"
echo "  Backend API: http://localhost:8000"
echo "  Telemetry:   ws://localhost:8765"
echo ""
echo "  Unity: Open the project, run DroneMedic → Setup PX4 Live Mode, then Play"
echo ""
echo "  Press Ctrl+C to stop all services"
echo "============================================"
echo ""

# Wait for all background processes
wait
