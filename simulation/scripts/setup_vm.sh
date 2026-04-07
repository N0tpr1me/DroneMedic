#!/bin/bash
# DroneMedic — Ubuntu 22.04 VM Setup (Bare Metal)
#
# One-shot setup for PX4 SITL + Gazebo Harmonic + ROS 2 Humble + MAVLink MCP.
# Idempotent — safe to re-run. Skips steps that are already complete.
#
# Usage:
#   bash simulation/scripts/setup_vm.sh
#   bash simulation/scripts/setup_vm.sh --dronemedic-dir /path/to/DroneMedic
#
# What it installs (in order):
#   1. System dependencies (cmake, ninja, build-essential, etc.)
#   2. XFCE desktop for VNC
#   3. ROS 2 Humble + MAVROS
#   4. Gazebo Harmonic + ros-gzharmonic bridge
#   5. PX4-Autopilot (cloned + initial build)
#   6. Python packages (mavsdk, pymavlink, mcp, fastapi, etc.)
#   7. VNC server (TigerVNC + noVNC)
#   8. Shell environment (bashrc exports)
#
# Prerequisites:
#   - Ubuntu 22.04 (jammy) amd64
#   - sudo access
#   - Internet connection

set -e

DRONEMEDIC_DIR=""
TOTAL_STEPS=10

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
    case "$1" in
        --dronemedic-dir)
            DRONEMEDIC_DIR="$2"
            shift 2
            ;;
        --help|-h)
            echo "Usage: $0 [--dronemedic-dir <path>]"
            echo ""
            echo "Options:"
            echo "  --dronemedic-dir <path>  Path to DroneMedic repo (installs requirements.txt)"
            exit 0
            ;;
        *)
            echo "ERROR: Unknown argument: $1"
            echo "Run '$0 --help' for usage."
            exit 1
            ;;
    esac
done

if [ -n "$DRONEMEDIC_DIR" ] && [ ! -d "$DRONEMEDIC_DIR" ]; then
    echo "ERROR: DroneMedic directory not found: $DRONEMEDIC_DIR"
    exit 1
fi

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
stamp() {
    echo ""
    echo "============================================"
    echo "  [$1/$TOTAL_STEPS] $2"
    echo "============================================"
    echo ""
}

already() {
    echo "  -> Already installed, skipping."
}

# Verify we are on Ubuntu 22.04
if [ -f /etc/os-release ]; then
    . /etc/os-release
    if [ "$VERSION_CODENAME" != "jammy" ]; then
        echo "WARNING: This script targets Ubuntu 22.04 (jammy)."
        echo "         Detected: $PRETTY_NAME ($VERSION_CODENAME)"
        echo "         Continuing anyway — some packages may not resolve."
        echo ""
    fi
fi

echo "============================================"
echo "  DroneMedic — VM Setup"
echo "============================================"
echo ""
echo "  Target:  Ubuntu 22.04 (jammy) amd64"
echo "  Steps:   $TOTAL_STEPS"
if [ -n "$DRONEMEDIC_DIR" ]; then
    echo "  Project: $DRONEMEDIC_DIR"
fi
echo ""
echo "============================================"
echo ""

# ===========================================================================
# [1/10] System dependencies
# ===========================================================================
stamp 1 "System dependencies"

sudo apt-get update -qq
sudo apt-get install -y --no-install-recommends \
    git \
    curl \
    wget \
    cmake \
    build-essential \
    python3-pip \
    python3-venv \
    ninja-build \
    lsb-release \
    gnupg2 \
    software-properties-common

echo "  -> System dependencies installed."

# ===========================================================================
# [2/10] XFCE desktop for VNC
# ===========================================================================
stamp 2 "XFCE desktop environment"

if dpkg -l xfce4 &>/dev/null; then
    already
else
    sudo apt-get install -y --no-install-recommends \
        xfce4 \
        xfce4-goodies \
        dbus-x11
    echo "  -> XFCE desktop installed."
fi

# ===========================================================================
# [3/10] ROS 2 Humble
# ===========================================================================
stamp 3 "ROS 2 Humble + MAVROS"

ROS_KEYRING="/usr/share/keyrings/ros-archive-keyring.gpg"
ROS_LIST="/etc/apt/sources.list.d/ros2.list"

# Add repo key (idempotent — overwrites existing keyring)
if [ ! -f "$ROS_KEYRING" ]; then
    curl -sSL https://raw.githubusercontent.com/ros/rosdistro/master/ros.asc \
        | sudo gpg --dearmor -o "$ROS_KEYRING"
    echo "  -> ROS 2 GPG key added."
else
    echo "  -> ROS 2 GPG key already present."
fi

# Add apt source
if [ ! -f "$ROS_LIST" ]; then
    echo "deb [arch=amd64 signed-by=$ROS_KEYRING] http://packages.ros.org/ros2/ubuntu jammy main" \
        | sudo tee "$ROS_LIST" > /dev/null
    sudo apt-get update -qq
    echo "  -> ROS 2 apt source added."
else
    echo "  -> ROS 2 apt source already present."
fi

# Install ROS 2 packages
if ! dpkg -l ros-humble-desktop &>/dev/null; then
    sudo apt-get install -y \
        ros-humble-desktop \
        ros-humble-mavros \
        ros-humble-mavros-extras
    echo "  -> ROS 2 Humble packages installed."
else
    echo "  -> ROS 2 Humble packages already installed."
fi

# Install GeographicLib datasets (required by MAVROS)
if [ ! -d "/usr/share/GeographicLib/geoids" ] || [ -z "$(ls -A /usr/share/GeographicLib/geoids 2>/dev/null)" ]; then
    echo "  -> Installing GeographicLib datasets..."
    sudo /opt/ros/humble/lib/mavros/install_geographiclib_datasets.sh
    echo "  -> GeographicLib datasets installed."
else
    echo "  -> GeographicLib datasets already present."
fi

# Verify datasets
if [ ! -d "/usr/share/GeographicLib/geoids" ]; then
    echo "ERROR: GeographicLib datasets not found at /usr/share/GeographicLib/geoids/"
    echo "       MAVROS will not work correctly."
    exit 1
fi
echo "  -> GeographicLib datasets verified at /usr/share/GeographicLib/geoids/"

# ===========================================================================
# [4/10] Gazebo Harmonic
# ===========================================================================
stamp 4 "Gazebo Harmonic"

GZ_KEYRING="/usr/share/keyrings/pkgs-osrf-archive-keyring.gpg"
GZ_LIST="/etc/apt/sources.list.d/gazebo-stable.list"

# Add OSRF repo key
if [ ! -f "$GZ_KEYRING" ]; then
    sudo wget -q https://packages.osrfoundation.org/gazebo.gpg \
        -O "$GZ_KEYRING"
    echo "  -> Gazebo GPG key added."
else
    echo "  -> Gazebo GPG key already present."
fi

# Add apt source
if [ ! -f "$GZ_LIST" ]; then
    echo "deb [arch=amd64 signed-by=$GZ_KEYRING] http://packages.osrfoundation.org/gazebo/ubuntu-stable jammy main" \
        | sudo tee "$GZ_LIST" > /dev/null
    sudo apt-get update -qq
    echo "  -> Gazebo apt source added."
else
    echo "  -> Gazebo apt source already present."
fi

# Install Gazebo Harmonic and ROS bridge
if ! dpkg -l gz-harmonic &>/dev/null; then
    sudo apt-get install -y \
        gz-harmonic \
        ros-humble-ros-gzharmonic
    echo "  -> Gazebo Harmonic + ROS bridge installed."
else
    echo "  -> Gazebo Harmonic already installed."
fi

# ===========================================================================
# [5/10] PX4-Autopilot
# ===========================================================================
stamp 5 "PX4-Autopilot"

PX4_DIR="$HOME/PX4-Autopilot"

if [ -d "$PX4_DIR" ]; then
    echo "  -> PX4-Autopilot already exists at $PX4_DIR, skipping clone."
else
    echo "  -> Cloning PX4-Autopilot (this may take a while)..."
    git clone https://github.com/PX4/PX4-Autopilot.git --recursive "$PX4_DIR"
    echo "  -> PX4-Autopilot cloned."
fi

# Run PX4 dependency installer
echo "  -> Running PX4 ubuntu.sh setup (--no-nuttx)..."
bash "$PX4_DIR/Tools/setup/ubuntu.sh" --no-nuttx

# Initial build (no launch)
echo "  -> Building PX4 SITL gz_x500 (initial build, no launch)..."
(cd "$PX4_DIR" && DONT_RUN=1 make px4_sitl gz_x500)
echo "  -> PX4 SITL build complete."

# ===========================================================================
# [6/10] Python packages
# ===========================================================================
stamp 6 "Python packages"

pip3 install --upgrade pip
pip3 install \
    mavsdk \
    pymavlink \
    websockets \
    mcp \
    fastapi \
    uvicorn

echo "  -> Python packages installed."

# ===========================================================================
# [7/10] DroneMedic requirements (optional)
# ===========================================================================
stamp 7 "DroneMedic requirements"

if [ -n "$DRONEMEDIC_DIR" ]; then
    REQ_FILE="$DRONEMEDIC_DIR/requirements.txt"
    if [ -f "$REQ_FILE" ]; then
        pip3 install -r "$REQ_FILE"
        echo "  -> DroneMedic requirements installed from $REQ_FILE"
    else
        echo "  WARNING: requirements.txt not found at $REQ_FILE"
    fi
else
    echo "  -> Skipped (no --dronemedic-dir provided)."
fi

# ===========================================================================
# [8/10] VNC setup
# ===========================================================================
stamp 8 "VNC server (TigerVNC + noVNC)"

sudo apt-get install -y --no-install-recommends \
    tigervnc-standalone-server \
    novnc \
    websockify

# Create VNC xstartup
VNC_DIR="$HOME/.vnc"
XSTARTUP="$VNC_DIR/xstartup"

mkdir -p "$VNC_DIR"

if [ -f "$XSTARTUP" ]; then
    echo "  -> $XSTARTUP already exists, skipping."
else
    cat > "$XSTARTUP" << 'XSTARTUP_EOF'
#!/bin/bash
unset SESSION_MANAGER
unset DBUS_SESSION_BUS_ADDRESS
export XKL_XMODMAP_DISABLE=1
exec startxfce4
XSTARTUP_EOF
    chmod +x "$XSTARTUP"
    echo "  -> Created $XSTARTUP"
fi

echo "  -> VNC server installed."
echo "  -> To start VNC:  vncserver :1 -geometry 1920x1080 -depth 24"
echo "  -> To start noVNC: websockify --web=/usr/share/novnc 6080 localhost:5901"

# ===========================================================================
# [9/10] Shell environment (~/.bashrc)
# ===========================================================================
stamp 9 "Shell environment"

BASHRC="$HOME/.bashrc"
MARKER="# >>> DroneMedic VM setup >>>"

if grep -qF "$MARKER" "$BASHRC" 2>/dev/null; then
    echo "  -> DroneMedic block already present in $BASHRC, skipping."
else
    cat >> "$BASHRC" << 'BASHRC_EOF'

# >>> DroneMedic VM setup >>>
source /opt/ros/humble/setup.bash
export PX4_HOME_LAT=51.5074
export PX4_HOME_LON=-0.1278
export PX4_HOME_ALT=0
export GZ_SIM_RESOURCE_PATH=~/PX4-Autopilot/Tools/simulation/gz/models:$GZ_SIM_RESOURCE_PATH
# <<< DroneMedic VM setup <<<
BASHRC_EOF
    echo "  -> Appended environment variables to $BASHRC"
fi

# Source for current session
source /opt/ros/humble/setup.bash
export PX4_HOME_LAT=51.5074
export PX4_HOME_LON=-0.1278
export PX4_HOME_ALT=0
export GZ_SIM_RESOURCE_PATH=~/PX4-Autopilot/Tools/simulation/gz/models:${GZ_SIM_RESOURCE_PATH:-}

# ===========================================================================
# [10/10] Validation
# ===========================================================================
stamp 10 "Validation"

ERRORS=0

# Gazebo
if command -v gz &>/dev/null; then
    GZ_VERSION=$(gz sim --version 2>/dev/null | head -1 || echo "installed")
    echo "  [OK] Gazebo:  $GZ_VERSION"
else
    echo "  [FAIL] gz command not found"
    ERRORS=$((ERRORS + 1))
fi

# ROS 2
if command -v ros2 &>/dev/null; then
    echo "  [OK] ROS 2:   $(ros2 --version 2>/dev/null || echo 'installed')"
else
    echo "  [FAIL] ros2 command not found"
    ERRORS=$((ERRORS + 1))
fi

# MAVROS
if ros2 pkg list 2>/dev/null | grep -q mavros; then
    echo "  [OK] MAVROS:  available"
else
    echo "  [FAIL] mavros package not found in ROS 2"
    ERRORS=$((ERRORS + 1))
fi

# Python mavsdk
if python3 -c "import mavsdk" 2>/dev/null; then
    echo "  [OK] mavsdk:  $(python3 -c 'import mavsdk; print(mavsdk.__version__)' 2>/dev/null || echo 'installed')"
else
    echo "  [FAIL] python3 -c 'import mavsdk' failed"
    ERRORS=$((ERRORS + 1))
fi

# PX4 build artifact
if [ -f "$HOME/PX4-Autopilot/build/px4_sitl_default/bin/px4" ]; then
    echo "  [OK] PX4:     built at ~/PX4-Autopilot"
else
    echo "  [FAIL] PX4 build artifact not found"
    ERRORS=$((ERRORS + 1))
fi

echo ""

if [ "$ERRORS" -gt 0 ]; then
    echo "  $ERRORS validation check(s) failed. Review output above."
    exit 1
fi

# ===========================================================================
# Summary
# ===========================================================================
echo "============================================"
echo "  DroneMedic — Setup Complete"
echo "============================================"
echo ""
echo "  All $TOTAL_STEPS steps passed."
echo ""
echo "  Next steps:"
echo "    1. Open a new terminal (or run: source ~/.bashrc)"
echo "    2. Start PX4 SITL:"
echo "         bash simulation/scripts/launch_px4.sh"
echo "    3. In another terminal, start the telemetry bridge:"
echo "         python simulation/telemetry_bridge.py"
echo "    4. (Optional) Start VNC for Gazebo GUI:"
echo "         vncserver :1 -geometry 1920x1080 -depth 24"
echo "         websockify --web=/usr/share/novnc 6080 localhost:5901"
echo "         Then open http://localhost:6080 in your browser."
echo ""
echo "============================================"
