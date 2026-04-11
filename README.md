# DroneMedic — AI-Controlled Medical Delivery Drones

DroneMedic is an AI-powered autonomous drone delivery platform for medical supplies in London. A Claude-driven mission coordinator turns natural-language requests into optimised multi-stop flight plans, dispatches drones across a simulated Central London fleet, and monitors every mission in real time from a live-ops dashboard. The system handles dynamic re-routing around weather, no-fly zones, and mid-flight emergencies.

Built for the **AR26 HackXelerator** university hackathon.

---

## Highlights

- **Natural-language mission planning** — describe a delivery in plain English, Claude parses it into structured tasks, and OR-Tools computes the optimal multi-stop route.
- **Deterministic routing, AI coordination** — OR-Tools VRP solver owns the math; the LLM owns the conversation, reasoning, and mid-flight decisions.
- **Full-physics drone simulation** — PX4 SITL + Gazebo Harmonic run a real x500 quadcopter with GPS, IMU, and aerodynamic drag on a Central London SDF world. A mock telemetry mode runs without the simulator for local dev.
- **Live-ops dashboard** — React + TypeScript dashboard with Google Maps satellite layer, animated drone marker, chain-of-custody timeline, cold-chain payload temperature, and a 10 Hz physics-driven HUD. Mission state persists across page navigation.
- **Dynamic re-routing** — real-time adaptation to weather changes (OpenWeatherMap or simulated), no-fly zone updates, and new high-priority requests mid-flight.
- **MAVLink MCP integration** — Claude can arm, takeoff, goto, and land drones through Model Context Protocol tool calls, bridging LLM reasoning to real autopilot commands.
- **NASA EONET integration** — natural-hazard overlays (wildfires, storms, floods) rendered as map markers to illustrate real-world adaptability.
- **Multi-drone fleet** — configurable fleet with per-drone battery physics, payload weight tracking, and VRP-based load balancing.

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Flight simulator** | PX4 SITL + Gazebo Harmonic (GPS-accurate SDF world) |
| **Flight control** | MAVSDK (Python async), MAVLink protocol |
| **AI drone control** | MAVLink MCP server (LLM tool use) |
| **Route optimisation** | Google OR-Tools VRP/TSP solver with priority weighting, battery constraints, no-fly-zone penalties |
| **LLM coordinator** | Anthropic Claude API (with tool use) |
| **Vision / CV** | YOLOv8 obstacle detection (optional) |
| **Backend** | FastAPI, WebSocket telemetry streaming, Pydantic schemas |
| **Frontend** | React 19 + TypeScript, Vite, Tailwind CSS, Framer Motion, Google Maps JS API, Three.js / React Three Fiber, deck.gl, Recharts |
| **State** | MissionContext (React Context) with provider-level physics + temperature loops so state survives page navigation |
| **Auth + persistence** | Supabase (auth, chat history, mission logs) |
| **Weather** | OpenWeatherMap API (with mock fallback) |
| **Natural events** | NASA EONET API |
| **No-fly zones** | Custom polygon geofence (ray-casting, no external deps) |
| **Simulation server** | Ubuntu 22.04 + ROS 2 Humble, NVIDIA A40 GPU |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                   USER (natural language + dashboard)               │
└──────────────┬───────────────────────────────────┬──────────────────┘
               │                                   │
               ▼                                   ▼
      ┌─────────────────┐                 ┌───────────────────┐
      │  Claude LLM     │                 │  React Dashboard  │
      │  Coordinator    │                 │  (Vite + TS)      │
      └────────┬────────┘                 └─────────┬─────────┘
               │                                    │
      ┌────────┴────────┐                           │ WebSocket +
      │                 │                           │ REST
      ▼                 ▼                           ▼
┌───────────┐    ┌──────────────┐           ┌───────────────────┐
│ OR-Tools  │    │ MAVLink MCP  │◄──────────┤ FastAPI Backend   │
│ VRP / TSP │    │ Tool server  │           │ (backend/api.py)  │
└─────┬─────┘    └──────┬───────┘           └─────────┬─────────┘
      │                 │                             │
      └────────┬────────┘                             │
               ▼                                      │
      ┌─────────────────┐                             │
      │  MAVSDK Python  │                             │
      │  async wrapper  │                             │
      └────────┬────────┘                             │
               │  MAVLink UDP :14540                  │
               ▼                                      │
      ┌─────────────────┐                             │
      │  PX4 SITL       │◄────────────────────────────┘
      │  Autopilot      │     telemetry bridge
      └────────┬────────┘     (ws://:8765)
               │
               ▼
      ┌─────────────────┐
      │ Gazebo Harmonic │
      │ Central London  │
      │ SDF world       │
      └─────────────────┘
```

Modules are intentionally decoupled — parsing, routing, simulation, and UI each live behind their own interface. All shared constants (locations, no-fly zones, drone specs) live in [`config.py`](config.py).

---

## Simulation Environment

The Gazebo world ([`simulation/gazebo/dronemedic_world.sdf`](simulation/gazebo/dronemedic_world.sdf)) models Central London with:

- **9 GPS-accurate locations** — 1 depot, 4 clinics, 4 hospitals
- **2 no-fly zones** — Military Zone Alpha, Airport Exclusion (visualised as red polygons on the map)
- **PX4 x500 quadcopter** — auto-spawned with full sensor suite (IMU, GPS, barometer, magnetometer)
- **Spherical coordinates** — world origin at Depot (51.5074 N, −0.1278 W) so PX4 publishes real lat/lon

| Location | GPS Coordinates | Type |
|---|---|---|
| Depot | 51.5074, −0.1278 | Base station |
| Clinic A | 51.5124, −0.1200 | General medical |
| Clinic B | 51.5174, −0.1350 | Emergency care |
| Clinic C | 51.5044, −0.1100 | Rural outpost |
| Clinic D | 51.5000, −0.1400 | Relief camp |
| Royal London | 51.5185, −0.0590 | Major trauma centre |
| Homerton | 51.5468, −0.0456 | Urgent care |
| Newham General | 51.5155, 0.0285 | Trauma resupply |
| Whipps Cross | 51.5690, 0.0066 | Cardiac unit |

---

## Getting Started

### Prerequisites

- Python 3.10+
- Node.js 18+
- (Optional for full simulation) Ubuntu 22.04 VM with GPU, or use the remote server at `144.202.12.168`

### 1. Clone + environment

```bash
git clone https://github.com/N0tpr1me/DroneMedic.git
cd DroneMedic
cp .env.example .env
# Fill in ANTHROPIC_API_KEY, GOOGLE_MAPS_API_KEY, (optional) OPENWEATHER_API_KEY,
# and VITE_SUPABASE_* if you want auth + chat persistence.
```

### 2. Backend

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
PYTHONPATH=. uvicorn backend.api:app --reload --port 8000
```

### 3. Frontend

```bash
cd web
npm install
npm run dev    # http://localhost:5173
```

### 4. CLI demos (no simulator needed)

```bash
PYTHONPATH=. python3 main.py --skip-ai         # Basic route demo
PYTHONPATH=. python3 main.py --demo-weather    # Weather re-routing
PYTHONPATH=. python3 main.py --demo-full       # All scenarios
PYTHONPATH=. python3 main.py --multi-drone     # 2-drone VRP
```

### 5. Full simulation (optional)

```bash
# SSH into the simulation server (or your local Ubuntu 22.04 VM)
ssh -i ~/.ssh/id_ed25519_vultr root@144.202.12.168

# Launch PX4 + Gazebo (headless)
source /opt/ros/humble/setup.bash
export PX4_HOME_LAT=51.5074 PX4_HOME_LON=-0.1278 PX4_GZ_WORLD=dronemedic HEADLESS=1
cd ~/PX4-Autopilot && make px4_sitl gz_x500

# In another terminal: MAVLink MCP server
bash simulation/scripts/launch_mavlinkmcp.sh

# In another terminal: telemetry bridge (PX4 → browser WebSocket)
python3 simulation/telemetry_bridge.py
```

Set `PX4_ENABLED=true` in `.env` to switch the backend from mock telemetry to real PX4 MAVLink on `udp://:14540`.

---

## Using the Dashboard

1. **Deploy page** (`/deploy`) — describe a mission in plain English, e.g. *"Deliver blood urgently to Royal London and Newham General"*. Claude parses locations, priorities, and supplies, then OR-Tools computes the optimal route with distance, ETA, and battery cost.
2. Click **Deploy Drone** → redirects to the live-ops dashboard.
3. **Dashboard** (`/dashboard`) — watch the amber quadcopter icon glide the cyan flight path, mission progress bar and ETA count down in real time, chain-of-custody timeline advances step-by-step, cold-chain payload temperature fluctuates realistically around 4 °C.
4. Navigate to **Logs**, **Analytics**, **Fleet**, or **Status** — mission state persists; come back to the dashboard and everything is still progressing.
5. **Simulation** (`/simulation`) — 3D scene with Three.js drone models and a London globe overlay.

---

## Project Structure

```
DroneMedic/
├── ai/                              # LLM coordination + AI agents
│   ├── task_parser.py               # NL → structured delivery tasks
│   ├── coordinator.py               # Mission orchestration with Claude
│   ├── flight_agent.py              # AI flight agent with MCP tool use
│   ├── agent_orchestrator.py        # Multi-agent coordination
│   ├── vision_analyzer.py           # YOLOv8 obstacle analysis
│   ├── demand_forecast.py           # Historical demand modelling
│   ├── predictive_maintenance.py    # Drone health prediction
│   └── prompts.py / schemas.py      # Claude prompt templates + Pydantic
├── backend/                         # FastAPI backend
│   ├── api.py                       # REST endpoints + WebSocket streaming
│   ├── app.py                       # FastAPI app factory
│   ├── route_planner.py             # OR-Tools VRP solver
│   ├── scheduler.py                 # Multi-drone mission scheduler
│   ├── mission_controller.py        # Mission lifecycle state machine
│   ├── geofence.py                  # No-fly zone ray-casting
│   ├── weather_service.py           # OpenWeatherMap + mock
│   ├── physics.py                   # Aerospace physics (energy, thrust, wind)
│   ├── safety.py                    # Real-time safety monitor
│   └── metrics.py                   # Evaluation metrics
├── simulation/                      # Drone simulation layer
│   ├── drone_control.py             # DroneController (PX4 / Mock) + fleet
│   ├── px4_adapter.py               # MAVSDK async wrapper
│   ├── telemetry_bridge.py          # PX4 telemetry → browser WebSocket
│   ├── mock_telemetry.py            # Synthetic flight simulator
│   ├── cv_obstacle_detector.py      # YOLOv8 obstacle detection
│   ├── MAVLinkMCP/                  # MCP server for AI drone control
│   ├── gazebo/                      # Gazebo world + ROS 2 launch files
│   ├── unity/                       # Unity MCP integration (experimental)
│   └── scripts/                     # Launch + VM setup scripts
├── web/                             # React frontend (Vite + TS)
│   └── src/
│       ├── pages/                   # Landing, Login, Dashboard, Deploy,
│       │                            # Analytics, Fleet, Logs, Status,
│       │                            # Simulation, Technology, Settings, ...
│       ├── components/
│       │   ├── dashboard/           # MapView, CustodyTimeline, ChatPanel,
│       │   │                        # FlightLog, WeatherPanel, MetricsPanel,
│       │   │                        # PayloadMonitor, NotificationCenter, ...
│       │   ├── layout/              # SideNav, PageHeader
│       │   ├── three/               # 3D drone scene (Three.js / R3F)
│       │   └── ui/                  # shadcn-style primitives
│       ├── hooks/                   # useFleetPhysics, useLiveMission,
│       │                            # usePhysicsSimulation, usePX4Telemetry,
│       │                            # useEONET, useAuth, useSoundEffects, ...
│       ├── context/
│       │   └── MissionContext.tsx   # Provider-level live mission state
│       │                            # (survives page navigation)
│       └── lib/                     # api.ts, physics-engine.ts, utils
├── tests/                           # pytest suite + Playwright E2E
├── docs/                            # ARCHITECTURE.md, DEMO_SCRIPT.md, ...
├── data/                            # Demand datasets, flight logs
├── config.py                        # Central config — locations, drones
├── main.py                          # CLI orchestrator with demo modes
├── requirements.txt
└── Dockerfile / docker-compose.yml  # Containerised backend
```

---

## Frontend Architecture Notes

The live-ops dashboard is built around a single source of truth: [`web/src/context/MissionContext.tsx`](web/src/context/MissionContext.tsx). This provider wraps the Router and owns:

- **Fleet physics simulation** (`useFleetPhysics`) — a 60 FPS `requestAnimationFrame` loop that steps a multi-drone physics model (drag, climb, cruise, descent, battery drain, payload weight).
- **Live mission telemetry** — `droneProgress`, `missionProgress`, `liveBattery`, `simPayload` (cold-chain temperature), and a 10 Hz progress interval with a time-based fallback when the physics sim stalls.
- **Mean-reverting temperature simulation** — runs at 2 Hz, clamped to a realistic cold-chain band around 4 °C.
- **Per-drone battery memory** — persists across events so the chain-of-custody timeline never shows fake 100 % on arrival.
- **Mission reset on dispatch** — `dispatchDelivery` wipes `liveFlightLog`, per-drone battery cache, and resets progress state so back-to-back missions start clean.

Because all of this lives in the provider (not the Dashboard page), mission state **survives page navigation** — click `Logs` mid-flight, come back to `Dashboard`, and everything is still progressing.

Map rendering uses the raw Google Maps JS API with `AdvancedMarkerElement` for drones + locations, layered polylines for animated dashed flight paths, and a Three.js overlay for optional 3D drone models.

---

## Configuration

Key constants in [`config.py`](config.py):

- `LOCATIONS` — 9 London facilities with GPS coordinates
- `NO_FLY_ZONES` — polygon definitions for Military Zone Alpha and Airport Exclusion
- `PX4_CONNECTION = "udp://:14540"` — PX4 SITL MAVLink endpoint
- `BATTERY_DRAIN_RATE = 0.08` — percent per metre (max range ~1250 m)
- `PRIORITY_WEIGHT = 0.3` — high-priority locations pulled 70 % closer to the solver
- `NUM_DRONES = 2` — multi-drone VRP fleet size

Environment variables (`.env`):

```
ANTHROPIC_API_KEY=              # Claude — required for AI coordination
OPENAI_API_KEY=                 # Optional, alternative LLM
OPENWEATHER_API_KEY=            # Optional — mock works without it
WEATHER_ENABLED=false

GOOGLE_MAPS_API_KEY=            # Required for dashboard map
GOOGLE_MAPS_SIGNING_SECRET=

VITE_SUPABASE_URL=              # Optional — auth + chat history
VITE_SUPABASE_ANON_KEY=
VITE_API_URL=                   # Frontend → backend base URL

PX4_ENABLED=false               # Set true to use real PX4 SITL
PX4_CONNECTION=udp://:14540

UNITY_MCP_TOKEN=                # Optional Unity bridge
```

---

## Evaluation Metrics

Tracked in [`backend/metrics.py`](backend/metrics.py):

- **Delivery-time reduction** — optimised multi-stop vs naive sequential
- **Throughput** — deliveries completed per simulation run
- **Re-routing success rate** — percentage of disrupted deliveries completed after re-routing
- **Robustness** — safety response time for no-fly zone violations and weather events
- **Coverage** — patient-km of medicine delivered

---

## Testing

```bash
# Backend unit + integration
pytest tests/

# Frontend typecheck + build
cd web && npx tsc --noEmit && npm run build

# E2E (Playwright)
cd web && npx playwright test
```

---

## Observability

The backend exposes a runtime metrics endpoint for latency and LLM
reliability tracking:

- `GET /ops/health` — liveness probe
- `GET /ops/metrics` — rolling-window stats:
  - `request_latency_ms.{p50, p95, p99, max, samples}` — computed over the
    last 1000 requests via an ASGI middleware
  - `counters.{requests_total, requests_2xx, requests_4xx, requests_5xx}`
  - `counters.{llm_calls_total, llm_calls_success, llm_calls_error}` —
    recorded inside the mission coordinator's LLM call path
  - `llm_error_rate` — derived ratio
  - `uptime_seconds`

Implementation:
- [`backend/services/ops_metrics_service.py`](backend/services/ops_metrics_service.py) — thread-safe collector
- [`backend/utils/resilience.py`](backend/utils/resilience.py) — `OpsMetricsMiddleware`
- [`backend/api/routes/ops.py`](backend/api/routes/ops.py) — HTTP surface

---

## Production Readiness & Known Limitations

DroneMedic is a **hackathon prototype**. It intentionally prioritises
technical depth (real PX4/Gazebo simulation, OR-Tools VRP, physics-based
energy modelling, live MAVLink control) over full production hardening.
This section is an honest account of what is and isn't ready for real
deployment, so judges and contributors can see the delta at a glance.

### Already implemented for safer operation
- **Retry + circuit breaker** around external LLM and weather calls
  ([`backend/utils/resilience.py`](backend/utils/resilience.py))
- **Rate limiting** — 120 requests/minute per client IP on every HTTP
  route, via an ASGI middleware
- **Observability** — request-latency percentiles (p50/p95/p99/max) and
  LLM success/error counters exposed at `/ops/metrics`
- **Strict LLM output contracts** — the mission coordinator uses a
  Pydantic `json_schema` strict response format, so the model cannot
  return invalid JSON
- **Deterministic fallback for routing** — all routing decisions come
  from OR-Tools. The LLM never hallucinates a route; it only parses
  natural language into the VRP solver's input schema
- **Geofence safety** — point-in-polygon + segment-intersection checks
  against London no-fly zones before and during flight
- **Energy-aware planning** — aerospace physics model (thrust, drag,
  headwind) gates route feasibility, not just straight-line distance

### Still required for real-world deployment
- **Hardware-in-the-loop validation** at scale with multiple physical
  airframes
- **AuthN/AuthZ** — the API currently has no authentication. Endpoints
  are open to any client on the rate-limited network
- **Encryption at rest and in transit** for mission state and telemetry
- **Durable state** — mission state lives in process memory. A
  restart loses in-flight missions. Needs Postgres or similar
- **Distributed queueing + retries** for background scheduling under
  load, plus dead-letter handling
- **Complete audit trail** — every drone command should be logged
  immutably with operator identity for post-incident review
- **Regulatory certification** — CAA (UK) clearance, BVLOS approval,
  airworthiness certification, formal incident response runbooks
- **Chaos / soak testing** — SLO definitions, long-run stability tests,
  failure-injection tests for each external dependency

If you're evaluating DroneMedic for anything beyond a demo, assume the
"Still required" list is a hard prerequisite.

---

## Team

| | |
|---|---|
| **Zain Ali** | Project Lead · Full-Stack · Systems Integration · Frontend |
| **Haseeb Janjua** | AI Engineering · LLM Orchestration · Prompt Design |
| **Usman Hakimi** | Backend Engineering · Route Optimisation · OR-Tools |
| **Karim Khalifa** | Simulation Engineering · PX4 Autopilot · Gazebo |

---

## License

MIT — built for the **AR26 HackXelerator** university hackathon.

See [`LICENSE`](LICENSE) for details.
