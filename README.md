# DroneMedic: AI-Controlled Medical Delivery Drone

DroneMedic is an AI-powered multi-agent UAV delivery system that plans multi-stop routes and adapts on-the-fly to changes in weather, no-fly zones, and emergencies. It uses realistic simulators and open data to prototype autonomous medical supply delivery to remote and disaster-hit areas, optimising last-mile healthcare logistics with minimal human input.

## Key Features

- **AI Mission Coordinator** -- LLM-based agent that interprets natural language delivery requests and converts them into structured flight plans
- **Multi-Stop Route Optimisation** -- Google OR-Tools VRP solver computes optimal routes across multiple drones with battery and time constraints
- **Dynamic Re-Routing** -- Real-time adaptation to weather changes, no-fly zone updates, and new high-priority deliveries mid-flight
- **Vision-Based Obstacle Detection** -- YOLO-based computer vision models detect obstacles on the drone's camera feed and trigger evasive manoeuvres
- **Real-Time Telemetry Dashboard** -- Web-based interface with live drone tracking, route visualisation, and status monitoring

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Flight Simulator | AirSim (Unreal Engine) / Gazebo + PX4 |
| Route Planning | Google OR-Tools (VRP/TSP solver) |
| LLM Coordinator | Claude API |
| Obstacle Detection | YOLOv5/v8 (PyTorch) |
| Maps & Geospatial | OpenStreetMap, Overpass API, Leaflet |
| Weather Data | OpenWeatherMap API |
| Terrain Data | NASA SRTM |
| No-Fly Zones | FAA / PDOK open datasets |
| Flight Control | MAVSDK (Python) / MAVLink |
| Frontend | React, Tailwind CSS, Framer Motion |
| Backend | FastAPI (Python) |
| Auth & Database | Supabase |

## System Architecture

```
User Input (natural language)
        |
        v
  LLM Coordinator (Claude API)
        |
        v
  Structured Delivery Tasks (JSON)
        |
        v
  OR-Tools VRP Solver --> Optimal Routes
        |
        v
  Flight Controller (MAVSDK / MAVLink)
        |
        v
  AirSim / Gazebo Simulator
        |
        v
  CV Obstacle Detection (YOLO) --> Re-routing if needed
        |
        v
  Telemetry Dashboard (React)
```

## Data Sources

- **OpenStreetMap** -- Base maps, clinic/depot locations via Overpass API
- **NASA SRTM** -- Digital elevation model for terrain-aware flight planning
- **OpenWeatherMap** -- Real-time weather conditions, forecasts, and severe weather alerts
- **FAA / PDOK** -- No-fly zone geofence polygons for regulatory compliance

## Getting Started

### Prerequisites

- Python 3.10+
- Node.js 18+
- AirSim or Gazebo + PX4 (for simulation)

### Installation

```bash
# Clone the repository
git clone https://github.com/your-org/DroneMedic.git
cd DroneMedic

# Install Python dependencies
pip install -r requirements.txt

# Install frontend dependencies
cd web
npm install

# Start the frontend
npm run dev

# Start the backend (in a separate terminal)
cd server
uvicorn main:app --reload
```

## Project Structure

```
DroneMedic/
├── src/                    # Core Python modules
│   ├── coordinator/        # LLM mission coordinator
│   ├── routing/            # OR-Tools VRP solver
│   ├── weather/            # Weather API integration
│   ├── geofence/           # No-fly zone management
│   ├── detection/          # CV obstacle detection
│   └── metrics/            # Performance metrics
├── web/                    # React frontend (dashboard)
│   └── src/
│       ├── pages/          # Landing, Login, Dashboard, Deploy
│       ├── components/     # Reusable UI components
│       └── hooks/          # Custom React hooks
├── server/                 # FastAPI backend
├── data/                   # Map data, geofences, configs
└── docs/                   # Documentation
```

## Evaluation Metrics

- **Delivery Time Reduction** -- Optimised multi-stop plan vs naive sequential approach
- **Throughput** -- Deliveries completed per simulation run
- **Re-routing Success Rate** -- Percentage of disrupted deliveries completed after re-routing
- **Robustness** -- Collision avoidance success rate with random obstacles
- **Coverage** -- Patient-km of medicine delivery achieved

## Authors

- **Zain Ali** -- Author
- **Haseeb Januja** -- Co-Author
- **Usman Hakimi** -- Co-Author
- **Karim Khalifa** -- Co-Author

## License

This project was built for a university hackathon.
