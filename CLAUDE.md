# CLAUDE.md

## Project Overview

DroneMedic is an AI-powered drone delivery simulation for medical supplies. It uses GPT-5.3 for NL task parsing, Google OR-Tools for VRP route optimization, AirSim for drone simulation, and Streamlit + Folium for visualization. The system adapts mid-flight to weather, no-fly zones, obstacles, and new urgent deliveries.

## Tech Stack

- **Python 3.9+** (all modules)
- **OR-Tools** — VRP/TSP route optimization with priority weighting, battery constraints, no-fly zone penalties
- **OpenAI SDK** — GPT-5.3 for natural language → structured JSON task parsing, reasoning, and chat
- **AirSim** — drone simulation (with mock mode fallback for dev without AirSim)
- **Streamlit + Folium** — interactive dashboard with map, metrics, flight log
- **OpenWeatherMap** — weather data (optional, mock mode default)

## Architecture

```
User Input → ai/task_parser.py → backend/route_planner.py → simulation/drone_control.py → frontend/dashboard.py
                                  backend/weather_service.py ↗
                                  backend/geofence.py ↗
                                  simulation/obstacle_detector.py ↗
                                  backend/metrics.py (post-flight)
```

Modules are independent. All share config.py for locations, settings, and constants. Never mix layers — parsing, routing, simulation, and UI are strictly separated.

## Codebase Structure

```
ai/task_parser.py          — LLM (GPT-5.3): NL → JSON (locations, priorities, supplies, constraints)
backend/route_planner.py   — OR-Tools VRP solver with no-fly/weather penalties + battery dimension
backend/weather_service.py — OpenWeatherMap API + simulated weather events (storm, wind)
backend/geofence.py        — No-fly zone point-in-polygon checks, route safety validation
backend/metrics.py         — Evaluation metrics (distance/time reduction, throughput, robustness)
simulation/drone_control.py — DroneController (AirSim + mock) + FleetController (multi-drone)
simulation/obstacle_detector.py — Simulated obstacle detection at configurable progress points
frontend/dashboard.py      — Streamlit app with map, weather, battery, metrics tabs
main.py                    — CLI orchestrator with demo modes
config.py                  — Central config: locations, API keys, battery, no-fly zones, drone settings
```

## Running the Project

```bash
# Install dependencies
pip3 install -r requirements.txt

# CLI demos (no API key needed)
PYTHONPATH=. python3 main.py --skip-ai              # Basic demo
PYTHONPATH=. python3 main.py --demo-weather          # Weather re-routing
PYTHONPATH=. python3 main.py --demo-obstacle         # Obstacle avoidance
PYTHONPATH=. python3 main.py --demo-full             # All scenarios
PYTHONPATH=. python3 main.py --multi-drone           # 2-drone VRP

# Dashboard (needs OPENAI_API_KEY in .env for Plan Route, or use CLI demos)
PYTHONPATH=. streamlit run frontend/dashboard.py --server.headless true
```

## Core Principles

- **Deterministic over AI** — OR-Tools handles routing, GPT-5.3 handles parsing only
- **Mock everything** — weather, obstacles, AirSim all have mock modes. Real APIs are optional.
- **Backward compatible** — new function params always have defaults. Existing calls never break.
- **Simple over clever** — ray-casting for geofence (no shapely), Euclidean distance (no real maps)
- **Modular** — each file is independently testable with `if __name__ == "__main__"` blocks

## Team & Branches

- **Karim** (karim/simulation) — AirSim, drone_control.py
- **Hakimi** (hakimi/backend) — route_planner.py, OR-Tools tuning
- **Haseeb** (haseeb/ai) — task_parser.py, GPT-5.3 prompts, API key management
- **Zain** (zain/frontend) — dashboard.py, integration, main.py

Branch protection on main — PRs required with 1 approval.

## Key Config (config.py)

- `LOCATIONS` — 5 predefined locations with AirSim coords + lat/lon
- `NO_FLY_ZONES` — 2 polygon zones (Military Zone Alpha, Airport Exclusion)
- `BATTERY_DRAIN_RATE = 0.08` — percent per meter (max range ~1250m)
- `PRIORITY_WEIGHT = 0.3` — high-priority locations appear 70% closer to solver
- `NUM_DRONES = 1` — set to 2+ for multi-drone VRP

## Env Vars (.env)

```
OPENAI_API_KEY=      # Required for AI parsing (Haseeb manages)
AIRSIM_ENABLED=false # Set true when AirSim is running
OPENWEATHER_API_KEY= # Optional, mock weather works without it
WEATHER_ENABLED=false
```

## Workflow

Plan → Build → Test → Review. Break complex tasks into steps. Validate outputs before finalising. Keep it simple — this is a 20-day hackathon, not production software.

## Avoid

- Overengineering (no abstractions for one-time operations)
- Real weather/CV APIs unless explicitly needed for demo
- Pushing directly to main (use branches + PRs)
- Tight coupling between modules (everything goes through config.py)
