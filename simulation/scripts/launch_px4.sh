#!/bin/bash
# DroneMedic PX4 SITL Launch Script
# Sets drone home position to match Depot coordinates in config.py
#
# Usage:
#   From WSL or Linux:  bash simulation/scripts/launch_px4.sh
#   From Windows:       wsl bash simulation/scripts/launch_px4.sh
#
# Prerequisites:
#   1. PX4-Autopilot cloned to ~/PX4-Autopilot
#   2. Gazebo Harmonic installed
#   3. MAVSDK tools installed
#
# PX4 Installation (Ubuntu/WSL):
#   git clone https://github.com/PX4/PX4-Autopilot.git --recursive ~/PX4-Autopilot
#   bash ~/PX4-Autopilot/Tools/setup/ubuntu.sh
#   sudo apt install ros-humble-ros-gzharmonic  # if using ROS2

set -e

# Depot coordinates (must match config.py)
export PX4_HOME_LAT=51.5074
export PX4_HOME_LON=-0.1278
export PX4_HOME_ALT=0

# PX4 source directory
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
echo "  DroneMedic — PX4 SITL + Gazebo Harmonic"
echo "============================================"
echo ""
echo "  Home position: lat=$PX4_HOME_LAT lon=$PX4_HOME_LON"
echo "  MAVLink port:  udp://:14540"
echo "  PX4 source:    $PX4_DIR"
echo ""
echo "  Connect DroneMedic backend with:"
echo "    PX4_ENABLED=true"
echo "    PX4_CONNECTION=udp://:14540"
echo ""
echo "  Press Ctrl+C to stop"
echo "============================================"
echo ""

cd "$PX4_DIR"
make px4_sitl gz_x500
