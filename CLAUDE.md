# CLAUDE.md

## Project Overview

DroneMedic is an AI-powered drone delivery simulation for medical supplies in London. It uses PX4 SITL + Gazebo Harmonic for realistic drone simulation, MAVLink MCP for AI-controlled flight, Google OR-Tools for VRP route optimization, and a React + FastAPI dashboard for real-time monitoring. The system adapts mid-flight to weather, no-fly zones, obstacles, and new urgent deliveries.

## Tech Stack

- **PX4 SITL + Gazebo Harmonic** — realistic drone simulation with physics, GPS, and sensor models
- **MAVLink MCP** — MCP server exposing drone control as AI-callable tools (arm, takeoff, goto, land)
- **MAVSDK (Python)** — MAVLink SDK for programmatic drone control and telemetry
- **OR-Tools** — VRP/TSP route optimization with priority weighting, battery constraints, no-fly zone penalties
- **Claude API** — LLM for natural language mission coordination, task parsing, and reasoning
- **React + Tailwind + Google Maps** — real-time dashboard with live drone tracking
- **FastAPI** — backend API with WebSocket telemetry streaming
- **Supabase** — auth and persistent data
- **OpenWeatherMap** — weather data (optional, mock mode default)

## Architecture

```
User Input (natural language)
        |
        v
  Claude LLM Coordinator ──MCP──► MAVLinkMCP ──MAVLink──► PX4 SITL
        |                                                      |
        v                                                  Gazebo Harmonic
  OR-Tools VRP Solver                                   (dronemedic_world.sdf)
        |                                                      |
        v                                                      v
  FastAPI Backend ◄──── MAVSDK Telemetry ◄──── MAVLink UDP:14540
        |
        v
  WebSocket (ws://localhost:8765)
        |
        v
  React Dashboard (Google Maps)
```

Modules are independent. All share config.py for locations, settings, and constants. Never mix layers — parsing, routing, simulation, and UI are strictly separated.

## Codebase Structure

```
ai/                            — LLM coordination, task parsing, demand forecasting
  task_parser.py               — NL → JSON (locations, priorities, supplies, constraints)
  coordinator.py               — Mission orchestration with Claude API
  flight_agent.py              — AI flight agent with tool use

backend/                       — API, routing, weather, geofencing, scheduling
  api.py                       — FastAPI REST endpoints + WebSocket streaming
  route_planner.py             — OR-Tools VRP solver with no-fly/weather penalties
  scheduler.py                 — Multi-drone mission scheduler with event broadcasting
  weather_service.py           — OpenWeatherMap API + simulated weather events
  geofence.py                  — No-fly zone point-in-polygon checks, route safety
  physics.py                   — Aerospace physics (energy, thrust, wind models)
  safety.py                    — Real-time safety monitor (battery, geofence, weather)
  metrics.py                   — Evaluation metrics (distance/time, throughput, robustness)

simulation/                    — Drone simulation layer
  drone_control.py             — DroneController (PX4 / Mock) + FleetController
  px4_adapter.py               — MAVSDK async wrapper for PX4 SITL
  telemetry_bridge.py          — WebSocket bridge: PX4 telemetry → browser
  mock_telemetry.py            — Synthetic flight simulator (no PX4 needed)
  MAVLinkMCP/                  — MCP server for AI-controlled drone flight
  gazebo/                      — Gazebo world, ROS 2 launch file, docs
    dronemedic_world.sdf       — 9 buildings, 2 no-fly zones, London coordinates
    launch_dronemedic.launch.py — ROS 2 launch: PX4 + Gazebo + MAVROS
  scripts/                     — Launch scripts and VM setup
    setup_vm.sh                — One-shot Ubuntu 22.04 VM installer
    launch_px4.sh              — PX4 SITL with Gazebo Harmonic
    start_sim.sh               — Full stack launcher
    launch_mavlinkmcp.sh       — MAVLink MCP server startup

web/                           — React frontend (Vite + TypeScript)
  src/pages/                   — Landing, Login, Dashboard, Deploy
  src/components/              — Map, drone status, mission panels
  src/hooks/                   — useLiveMission, usePhysicsSimulation

config.py                      — Central config: locations, no-fly zones, drone specs
main.py                        — CLI orchestrator with demo modes
```

## Running the Project

### Simulation (PX4 + Gazebo on remote VM)

```bash
# SSH into simulation server
ssh -i ~/.ssh/id_ed25519_vultr root@144.202.12.168

# Launch PX4 + Gazebo (headless)
source /opt/ros/humble/setup.bash
export PX4_HOME_LAT=51.5074 PX4_HOME_LON=-0.1278 PX4_GZ_WORLD=dronemedic HEADLESS=1
cd ~/PX4-Autopilot && make px4_sitl gz_x500

# In another terminal: start MAVLink MCP
bash simulation/scripts/launch_mavlinkmcp.sh

# In another terminal: start telemetry bridge
python3 simulation/telemetry_bridge.py
```

### Backend + Frontend (local)

```bash
# Backend
pip install -r requirements.txt
PYTHONPATH=. uvicorn backend.api:app --reload --port 8000

# Frontend
cd web && npm install && npm run dev

# CLI demos (no simulation needed)
PYTHONPATH=. python3 main.py --skip-ai              # Basic demo
PYTHONPATH=. python3 main.py --demo-weather          # Weather re-routing
PYTHONPATH=. python3 main.py --demo-full             # All scenarios
PYTHONPATH=. python3 main.py --multi-drone           # 2-drone VRP
```

## Simulation Stack

| Component | Purpose | Port/Protocol |
|-----------|---------|---------------|
| PX4 SITL | Autopilot firmware (SITL mode) | MAVLink UDP:14540 |
| Gazebo Harmonic | Physics engine, sensors, 3D world | gz-transport |
| MAVROS | MAVLink ↔ ROS 2 bridge | ROS 2 topics |
| MAVLink MCP | AI tool interface for drone control | MCP stdio |
| Telemetry Bridge | PX4 telemetry → browser WebSocket | ws://localhost:8765 |

## Core Principles

- **Deterministic over AI** — OR-Tools handles routing, LLM handles coordination only
- **Mock everything** — weather, telemetry, PX4 all have mock modes. Real APIs are optional.
- **Backward compatible** — new function params always have defaults. Existing calls never break.
- **Modular** — each file is independently testable with `if __name__ == "__main__"` blocks
- **Simple over clever** — ray-casting for geofence (no shapely), haversine for distance

## Team & Branches

- **Karim** (karim/simulation) — PX4, Gazebo, drone_control.py
- **Hakimi** (hakimi/backend) — route_planner.py, OR-Tools tuning, FastAPI
- **Haseeb** (haseeb/ai) — task_parser.py, Claude prompts, AI coordination
- **Zain** (zain/frontend) — React dashboard, integration, main.py

Branch protection on main — PRs required with 1 approval.

## Key Config (config.py)

- `LOCATIONS` — 9 locations (4 clinics + 4 hospitals + depot) with GPS lat/lon
- `NO_FLY_ZONES` — 2 polygon zones (Military Zone Alpha, Airport Exclusion)
- `PX4_CONNECTION = "udp://:14540"` — PX4 SITL MAVLink endpoint
- `PX4_HOME_LAT/LON = 51.5074, -0.1278` — Depot in Central London
- `BATTERY_DRAIN_RATE = 0.08` — percent per meter (max range ~1250m)
- `PRIORITY_WEIGHT = 0.3` — high-priority locations appear 70% closer to solver
- `NUM_DRONES = 2` — multi-drone VRP

## Env Vars (.env)

```
OPENAI_API_KEY=               # For AI parsing
GOOGLE_MAPS_API_KEY=          # Google Maps in React dashboard
PX4_ENABLED=false             # Set true when PX4 SITL is running
PX4_CONNECTION=udp://:14540   # PX4 MAVLink endpoint
MAVLINK_ADDRESS=              # MAVLink MCP host (empty = localhost)
MAVLINK_PORT=14540            # MAVLink MCP port
OPENWEATHER_API_KEY=          # Optional, mock weather works without it
VITE_GOOGLE_MAPS_API_KEY=     # Frontend Google Maps key
VITE_SUPABASE_URL=            # Supabase project URL
VITE_SUPABASE_ANON_KEY=       # Supabase anonymous key
```

## Simulation Server

- **IP**: 144.202.12.168
- **SSH**: `ssh -i ~/.ssh/id_ed25519_vultr root@144.202.12.168`
- **Specs**: 6 vCPUs, 30 GB RAM, NVIDIA A40 12GB VRAM, Ubuntu 22.04
- **Stack**: ROS 2 Humble + Gazebo Harmonic + PX4 + MAVROS + MAVSDK

## Workflow

Plan → Build → Test → Review. Break complex tasks into steps. Validate outputs before finalising. Keep it simple — this is a hackathon, not production software.

## Avoid

- Overengineering (no abstractions for one-time operations)
- Real weather/CV APIs unless explicitly needed for demo
- Pushing directly to main (use branches + PRs)
- Tight coupling between modules (everything goes through config.py)
