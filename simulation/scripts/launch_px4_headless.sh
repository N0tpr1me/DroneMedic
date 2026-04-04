#!/bin/bash
# DroneMedic — PX4 SITL Headless (No Gazebo)
# Runs PX4 flight controller simulation without a 3D renderer.
# Works on macOS (Apple Silicon) without Gazebo dependency.
#
# Usage:  bash simulation/scripts/launch_px4_headless.sh
#
# The drone's telemetry is available via MAVLink on udp://:14540.
# Connect the telemetry bridge to stream data to the browser.

set -e

# Depot coordinates (must match config.py)
export PX4_HOME_LAT=51.5074
export PX4_HOME_LON=-0.1278
export PX4_HOME_ALT=0

PX4_DIR="${PX4_DIR:-$HOME/PX4-Autopilot}"

if [ ! -d "$PX4_DIR" ]; then
    echo "ERROR: PX4-Autopilot not found at $PX4_DIR"
    echo ""
    echo "Install PX4 SITL:"
    echo "  git clone https://github.com/PX4/PX4-Autopilot.git --recursive ~/PX4-Autopilot"
    echo "  bash ~/PX4-Autopilot/Tools/setup/ubuntu.sh"
    exit 1
fi

echo "============================================"
echo "  DroneMedic — PX4 SITL (Headless)"
echo "============================================"
echo ""
echo "  Home position: lat=$PX4_HOME_LAT lon=$PX4_HOME_LON"
echo "  MAVLink port:  udp://:14540"
echo "  Mode:          Headless (no Gazebo)"
echo ""
echo "  Connect telemetry bridge:"
echo "    python simulation/telemetry_bridge.py"
echo ""
echo "  Press Ctrl+C to stop"
echo "============================================"
echo ""

cd "$PX4_DIR"
make px4_sitl none_iris
