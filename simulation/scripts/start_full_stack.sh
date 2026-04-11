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
#   ./simulation/scripts/start_full_stack.sh --vm     # Full stack with VM (alias, sets telemetry mode + POV + vision tunnels)
#   ./simulation/scripts/start_full_stack.sh --mock   # Mock mode (no VM needed)
#   ./simulation/scripts/start_full_stack.sh --no-tunnel  # Skip SSH tunnel
# ============================================================================

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$PROJECT_ROOT"

# -- Parse arguments --
USE_MOCK=false
SKIP_TUNNEL=false
VM_MODE=false
VM_IP="${DRONEMEDIC_VM_IP:-144.202.12.168}"
SSH_KEY="${DRONEMEDIC_SSH_KEY:-$HOME/.ssh/id_ed25519_vultr}"

for arg in "$@"; do
    case "$arg" in
        --mock)       USE_MOCK=true; SKIP_TUNNEL=true ;;
        --vm)         VM_MODE=true ;;
        --no-tunnel)  SKIP_TUNNEL=true ;;
        --help|-h)
            echo "Usage: $0 [--vm|--mock|--no-tunnel]"
            echo "  --vm          Full VM stack: telemetry + POV + vision tunnels + px4_vm mode"
            echo "  --mock        Use mock telemetry (no VM needed)"
            echo "  --no-tunnel   Skip SSH tunnel (direct network to VM)"
            exit 0
            ;;
    esac
done

# When --vm is set, export the env vars the backend proxies use, plus flip
# the frontend telemetry mode to px4_vm so usePX4Telemetry opens the
# proxied /ws/px4 WebSocket.
if [ "$VM_MODE" = true ]; then
    export PX4_BRIDGE_WS_URL="${PX4_BRIDGE_WS_URL:-ws://localhost:8765}"
    export POV_BRIDGE_WS_URL="${POV_BRIDGE_WS_URL:-ws://localhost:8766}"
    export VISION_BRIDGE_WS_URL="${VISION_BRIDGE_WS_URL:-ws://localhost:8767}"
    export VITE_TELEMETRY_MODE="${VITE_TELEMETRY_MODE:-px4_vm}"
    export VITE_VISION_ENABLED="${VITE_VISION_ENABLED:-true}"
fi

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
    if [ "$VM_MODE" = true ]; then
        echo "[1/4] Starting VM tunnel (telemetry :8765 + POV :8766 + vision :8767)..."
        ssh -f -N \
            -L 8765:localhost:8765 \
            -L 8766:localhost:8766 \
            -L 8767:localhost:8767 \
            -i "$SSH_KEY" "root@$VM_IP" 2>/dev/null && \
            echo "  ✓ Tunnels established on :8765 / :8766 / :8767" || \
            echo "  ✗ SSH tunnel failed — is the VM running and the SSH key path right?"
    else
        echo "[1/4] Starting SSH tunnel to VM ($VM_IP:8765 → localhost:8765)..."
        ssh -f -N -L 8765:localhost:8765 -i "$SSH_KEY" "root@$VM_IP" 2>/dev/null && \
            echo "  ✓ SSH tunnel established" || \
            echo "  ✗ SSH tunnel failed — is the VM running?"
    fi
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
