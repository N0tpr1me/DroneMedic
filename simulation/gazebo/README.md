# DroneMedic Gazebo Simulation

PX4 SITL + Gazebo Harmonic + MAVLink MCP simulation for medical drone delivery.

## Architecture

```
PX4 SITL (gz_x500)  ──MAVLink UDP:14540──►  MAVROS (ROS 2 topics)
       │                                         │
Gazebo Harmonic                            MAVLinkMCP (MCP tools)
(dronemedic_world.sdf)                          │
                                         Telemetry Bridge
                                         (ws://localhost:8765)
                                                │
                                         React Dashboard
```

## Prerequisites

- Ubuntu 22.04 LTS (bare metal or VM)
- 8+ cores, 32 GB RAM
- NVIDIA GPU with 4GB+ VRAM (for Gazebo rendering)
- Public IPv4 with SSH access

## Quick Start

### 1. Setup the VM (one-time)

```bash
# SSH into your server
ssh root@<server-ip>

# Clone the repo
git clone <your-repo-url> ~/DroneMedic

# Run the setup script (~20-40 min)
sudo bash ~/DroneMedic/simulation/scripts/setup_vm.sh --dronemedic-dir ~/DroneMedic

# Source the new environment
source ~/.bashrc
```

### 2. Start VNC (to see Gazebo GUI)

```bash
# Set VNC password (first time only)
vncpasswd

# Start VNC server
vncserver -geometry 1920x1080 -depth 24 :1

# Start noVNC web bridge
novnc --vnc localhost:5901 --listen 6080 &

# Access in your browser: http://<server-ip>:6080/vnc.html
```

### 3. Launch the simulation

```bash
# Option A: Full stack with one command (ROS 2 launch)
ros2 launch ~/DroneMedic/simulation/gazebo/launch_dronemedic.launch.py

# Option B: Headless (no Gazebo GUI)
ros2 launch ~/DroneMedic/simulation/gazebo/launch_dronemedic.launch.py headless:=true

# Option C: Without telemetry bridge
ros2 launch ~/DroneMedic/simulation/gazebo/launch_dronemedic.launch.py launch_bridge:=false
```

### 4. Connect MAVLink MCP

In a separate terminal:

```bash
cd ~/DroneMedic
bash simulation/scripts/launch_mavlinkmcp.sh
```

## Launch Arguments

| Argument | Default | Description |
|----------|---------|-------------|
| `px4_dir` | `~/PX4-Autopilot` | Path to PX4-Autopilot source |
| `headless` | `false` | Run without Gazebo GUI |
| `launch_bridge` | `true` | Start telemetry WebSocket bridge |

## Environment Variables

| Variable | Default | Used By |
|----------|---------|---------|
| `PX4_HOME_LAT` | `51.5074` | PX4 SITL — drone home latitude |
| `PX4_HOME_LON` | `-0.1278` | PX4 SITL — drone home longitude |
| `PX4_HOME_ALT` | `0` | PX4 SITL — drone home altitude |
| `PX4_GZ_WORLD` | `dronemedic` | PX4 — custom Gazebo world name |
| `MAVLINK_ADDRESS` | `""` (localhost) | MAVLinkMCP — PX4 host |
| `MAVLINK_PORT` | `14540` | MAVLinkMCP — PX4 MAVLink port |
| `PX4_CONNECTION` | `udp://:14540` | Telemetry bridge — PX4 URL |
| `TELEMETRY_WS_PORT` | `8765` | Telemetry bridge — WebSocket port |

## World File

`dronemedic_world.sdf` contains:

- **9 buildings** at GPS-accurate positions (London area)
- **2 no-fly zones** (Military Zone Alpha, Airport Exclusion) as red overlays
- **Spherical coordinates** matching `config.py` Depot location
- Ground plane covering all locations (~25 km x 15 km)

### GPS-to-ENU Coordinate Mapping

Home position: Depot (51.5074 N, 0.1278 W)

| Location | Lat | Lon | East (m) | North (m) |
|----------|-----|-----|----------|-----------|
| Depot | 51.5074 | -0.1278 | 0 | 0 |
| Clinic A | 51.5124 | -0.1200 | 542 | 556 |
| Clinic B | 51.5174 | -0.1350 | -501 | 1112 |
| Clinic C | 51.5044 | -0.1100 | 1237 | -334 |
| Clinic D | 51.5000 | -0.1400 | -848 | -823 |
| Royal London | 51.5185 | -0.0590 | 4783 | 1234 |
| Homerton | 51.5468 | -0.0456 | 5715 | 4381 |
| Newham General | 51.5155 | 0.0285 | 10860 | 900 |
| Whipps Cross | 51.5690 | 0.0066 | 9337 | 6850 |

## Adding New Locations

1. Add GPS coordinates to `config.py` LOCATIONS dict
2. Convert to ENU: `east = (lon - (-0.1278)) * cos(51.5074 * pi/180) * 111320`, `north = (lat - 51.5074) * 111320`
3. Add a `<model>` block in `dronemedic_world.sdf` with the ENU pose

## Troubleshooting

**PX4 build fails:**
```bash
cd ~/PX4-Autopilot
make distclean
make px4_sitl gz_x500
```

**MAVROS can't connect (timeout):**
- Ensure PX4 is running first (wait ~15s after launch)
- Check: `ros2 topic list | grep mavros`
- Verify port: `ss -ulnp | grep 14540`

**GeographicLib datasets missing:**
```bash
sudo /opt/ros/humble/lib/mavros/install_geographiclib_datasets.sh
ls /usr/share/GeographicLib/geoids/  # should not be empty
```

**Gazebo won't render (GPU issues):**
```bash
# Check GPU driver
nvidia-smi
# If missing, install:
sudo apt install nvidia-driver-535
sudo reboot
```

**Can't see Gazebo via VNC:**
```bash
# Restart VNC
vncserver -kill :1
vncserver -geometry 1920x1080 -depth 24 :1
# Then launch Gazebo inside the VNC session
```
