#!/bin/bash
# DroneMedic — Launch MAVLinkMCP Server
#
# MAVLinkMCP is an MCP server that lets LLMs control drones via MAVLink.
# It exposes tools: arm_drone, takeoff, land, get_position, move_to_relative,
# initiate_mission, get_flight_mode, get_imu, print_mission_progress
#
# Prerequisites:
#   1. PX4 SITL must be running (bash simulation/scripts/launch_px4.sh)
#   2. pip install mcp mavsdk
#
# Usage:
#   bash simulation/scripts/launch_mavlinkmcp.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
MCP_DIR="$PROJECT_DIR/simulation/MAVLinkMCP"

if [ ! -f "$MCP_DIR/src/server/mavlinkmcp.py" ]; then
    echo "ERROR: MAVLinkMCP not found. Clone it:"
    echo "  git clone https://github.com/ion-g-ion/MAVLinkMCP.git simulation/MAVLinkMCP"
    exit 1
fi

# MAVLink connection — defaults to PX4 SITL standard port
export MAVLINK_ADDRESS="${MAVLINK_ADDRESS:-}"
export MAVLINK_PORT="${MAVLINK_PORT:-14540}"

echo "============================================"
echo "  DroneMedic — MAVLinkMCP Server"
echo "============================================"
echo ""
echo "  MAVLink:  udp://${MAVLINK_ADDRESS:-localhost}:${MAVLINK_PORT}"
echo "  Transport: stdio (for MCP client integration)"
echo ""
echo "  Available MCP tools:"
echo "    arm_drone, takeoff, land"
echo "    get_position, get_flight_mode, get_imu"
echo "    move_to_relative, initiate_mission"
echo "    print_mission_progress, print_status_text"
echo ""
echo "============================================"

cd "$MCP_DIR"
python src/server/mavlinkmcp.py
