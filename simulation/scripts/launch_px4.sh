#!/bin/bash
# DroneMedic PX4 SITL Launch Script
# Sets drone home position to match Depot coordinates in config.py

export PX4_HOME_LAT=51.5074
export PX4_HOME_LON=-0.1278
export PX4_HOME_ALT=0
export CMAKE_PREFIX_PATH="/opt/homebrew/opt/qt@5:${CMAKE_PREFIX_PATH}"
export LIBRARY_PATH="/opt/homebrew/lib:${LIBRARY_PATH}"

echo "Starting PX4 SITL + Gazebo Harmonic..."
echo "Drone home: lat=$PX4_HOME_LAT lon=$PX4_HOME_LON"
echo "Press Ctrl+C to stop"

cd ~/PX4-Autopilot
make px4_sitl gz_x500
