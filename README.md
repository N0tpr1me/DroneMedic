# DroneMedic: AI-Controlled Medical Delivery Drone

DroneMedic is an AI-powered autonomous drone delivery system for medical supplies in London. It uses **PX4 SITL + Gazebo Harmonic** for realistic drone simulation, **MAVLink MCP** for AI-controlled flight, **Google OR-Tools** for multi-stop route optimisation, and a **React + FastAPI** dashboard for real-time monitoring. The system adapts mid-flight to weather changes, no-fly zones, and emergency deliveries.

## Key Features

- **AI Mission Coordinator** -- Claude-powered agent that interprets natural language delivery requests and directly controls drones via MAVLink MCP
- **Realistic Drone Simulation** -- PX4 autopilot firmware running in SITL mode with Gazebo Harmonic physics, GPS, and sensor models
- **Multi-Stop Route Optimisation** -- Google OR-Tools VRP solver computes optimal routes across multiple drones with battery and time constraints
- **Dynamic Re-Routing** -- Real-time adaptation to weather changes, no-fly zone updates, and new high-priority deliveries mid-flight
- **Real-Time Telemetry Dashboard** -- React dashboard with Google Maps, live drone tracking, and WebSocket telemetry streaming
- **MAVLink MCP Integration** -- AI models can arm, takeoff, navigate, and land drones through MCP tool calls

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Flight Simulator | PX4 SITL + Gazebo Harmonic |
| Flight Control | MAVSDK (Python) / MAVLink protocol |
| AI Drone Control | MAVLink MCP (MCP server for LLM tool use) |
| Route Planning | Google OR-Tools (VRP/TSP solver) |
| LLM Coordinator | Claude API |
| Maps & Visualisation | Google Maps API, React |
| Weather Data | OpenWeatherMap API |
| No-Fly Zones | Custom geofence polygons (ray-casting) |
| Frontend | React, TypeScript, Tailwind CSS, Framer Motion |
| Backend | FastAPI (Python), WebSocket telemetry |
| Auth & Database | Supabase |
| Simulation Server | Ubuntu 22.04, NVIDIA A40 GPU, ROS 2 Humble |

## System Architecture

```
User Input (natural language)
        |
        v
  Claude LLM Coordinator ──MCP──► MAVLinkMCP Server
        |                              |
        v                          MAVLink UDP:14540
  OR-Tools VRP Solver                  |
        |                              v
        v                         PX4 SITL Autopilot
  FastAPI Backend                      |
        |                         Gazebo Harmonic
        v                     (dronemedic_world.sdf)
  WebSocket Telemetry                  |
  (ws://localhost:8765)                v
        |                     9 London locations
        v                     2 no-fly zones
  React Dashboard              GPS-accurate physics
  (Google Maps)
```

## Simulation Environment

The Gazebo world (`simulation/gazebo/dronemedic_world.sdf`) models Central London with:

- **9 delivery locations** -- 1 depot, 4 clinics, 4 hospitals with GPS-accurate positions
- **2 no-fly zones** -- Military Zone Alpha and Airport Exclusion (visual red overlays)
- **PX4 x500 quadcopter** -- spawned automatically with full sensor suite (IMU, GPS, barometer, magnetometer)
- **Spherical coordinates** -- world origin at Depot (51.5074 N, 0.1278 W) for GPS-accurate simulation

| Location | GPS Coordinates | Type |
|----------|----------------|------|
| Depot | 51.5074, -0.1278 | Base station |
| Clinic A | 51.5124, -0.1200 | General medical |
| Clinic B | 51.5174, -0.1350 | Emergency care |
| Clinic C | 51.5044, -0.1100 | Rural outpost |
| Clinic D | 51.5000, -0.1400 | Relief camp |
| Royal London | 51.5185, -0.0590 | Major trauma centre |
| Homerton | 51.5468, -0.0456 | Urgent care |
| Newham General | 51.5155, 0.0285 | Trauma resupply |
| Whipps Cross | 51.5690, 0.0066 | Cardiac unit |

## Getting Started

### Prerequisites

- Python 3.10+
- Node.js 18+
- For simulation: Ubuntu 22.04 VM with GPU (or use remote server at 144.202.12.168)

### Installation

```bash
# Clone the repository
git clone https://github.com/N0tpr1me/DroneMedic.git
cd DroneMedic

# Install Python dependencies
pip install -r requirements.txt

# Install frontend dependencies
cd web && npm install

# Start the backend
PYTHONPATH=. uvicorn backend.api:app --reload --port 8000

# Start the frontend (separate terminal)
cd web && npm run dev
```

### Running the Simulation

```bash
# SSH into the simulation server
ssh -i ~/.ssh/id_ed25519_vultr root@144.202.12.168

# Launch PX4 + Gazebo
source /opt/ros/humble/setup.bash
export PX4_HOME_LAT=51.5074 PX4_HOME_LON=-0.1278 PX4_GZ_WORLD=dronemedic HEADLESS=1
cd ~/PX4-Autopilot && make px4_sitl gz_x500

# Start MAVLink MCP server (separate terminal)
bash simulation/scripts/launch_mavlinkmcp.sh

# Start telemetry bridge (separate terminal)
python3 simulation/telemetry_bridge.py
```

### CLI Demos (no simulation needed)

```bash
PYTHONPATH=. python3 main.py --skip-ai         # Basic route demo
PYTHONPATH=. python3 main.py --demo-weather     # Weather re-routing
PYTHONPATH=. python3 main.py --demo-full        # All scenarios
PYTHONPATH=. python3 main.py --multi-drone      # 2-drone VRP
```

## Project Structure

```
DroneMedic/
├── ai/                         # LLM coordination and AI agents
│   ├── task_parser.py          # NL → structured delivery tasks
│   ├── coordinator.py          # Mission orchestration with Claude
│   └── flight_agent.py         # AI flight agent with tool use
├── backend/                    # FastAPI backend
│   ├── api.py                  # REST endpoints + WebSocket streaming
│   ├── route_planner.py        # OR-Tools VRP solver
│   ├── scheduler.py            # Multi-drone mission scheduler
│   ├── geofence.py             # No-fly zone management
│   ├── weather_service.py      # Weather API integration
│   ├── physics.py              # Aerospace physics engine
│   └── safety.py               # Real-time safety monitor
├── simulation/                 # Drone simulation layer
│   ├── drone_control.py        # DroneController (PX4 / Mock)
│   ├── px4_adapter.py          # MAVSDK wrapper for PX4 SITL
│   ├── telemetry_bridge.py     # WebSocket telemetry bridge
│   ├── mock_telemetry.py       # Synthetic flight simulator
│   ├── MAVLinkMCP/             # MCP server for AI drone control
│   ├── gazebo/                 # Gazebo world + ROS 2 launch
│   └── scripts/                # Launch & VM setup scripts
├── web/                        # React frontend (Vite + TypeScript)
│   └── src/
│       ├── pages/              # Landing, Login, Dashboard, Deploy
│       ├── components/         # Map, drone status, mission panels
│       └── hooks/              # Live mission & physics hooks
├── config.py                   # Central configuration
├── main.py                     # CLI orchestrator
└── requirements.txt            # Python dependencies
```

## Evaluation Metrics

- **Delivery Time Reduction** -- Optimised multi-stop plan vs naive sequential approach
- **Throughput** -- Deliveries completed per simulation run
- **Re-routing Success Rate** -- Percentage of disrupted deliveries completed after re-routing
- **Robustness** -- Safety system response to no-fly zone violations and weather events
- **Coverage** -- Patient-km of medicine delivery achieved

## Authors

- **Zain Ali** -- Project Lead, Full Stack Engineering, Systems Integration
- **Haseeb Janjua** -- AI Engineering, LLM Orchestration, Prompt Design
- **Usman Hakimi** -- Backend Engineering, Route Optimisation, OR-Tools
- **Karim Khalifa** -- Simulation Engineering, PX4 Autopilot, Gazebo

## License

This project was built for the AR26 HackXelerator university hackathon.
