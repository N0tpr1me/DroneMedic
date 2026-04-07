# DroneMedic — Deep Research Brief

> Paste this into ChatGPT Deep Research to get expanded project outlines for Frontend, Backend, and AI.

---

## What I Need

I'm building **DroneMedic** — an AI-powered autonomous medical drone delivery platform for a hackathon (AR26 HackXelerator, deadline April 10, 2026). Judges are from NVIDIA, Meta, and PyTorch Foundation.

I need you to **expand the project outlines** for three areas:
1. **Frontend** — What features to add, UX improvements, demo polish, new pages/components
2. **Backend** — What services/endpoints to add, architecture improvements, scalability patterns
3. **AI** — What AI capabilities to add beyond NL parsing (autonomous decision-making, predictive models, computer vision, etc.)

Consider what would **impress hackathon judges** from NVIDIA/Meta/PyTorch — they care about AI innovation, scalability, real-world impact, and technical depth.

---

## Project Overview

DroneMedic is a full-stack drone delivery simulation for medical supplies. Users describe deliveries in natural language ("Deliver O- plasma to Royal London Hospital urgently"), the AI parses the request, OR-Tools optimizes the route, and drones execute the mission with real-time monitoring, safety decisions, weather rerouting, and chain-of-custody tracking.

**Team**: 4 developers (Zain: frontend/integration, Karim: simulation, Hakimi: backend/routing, Haseeb: AI/parsing)

---

## Current Tech Stack

### Frontend (React 19 + TypeScript + Vite 8)
- **Maps**: Google Maps API + Deck.gl overlays + Leaflet fallback
- **3D**: Three.js (wireframe globe, drone scene)
- **Charts**: Recharts + D3.js
- **Animation**: Framer Motion
- **Styling**: Tailwind CSS v4, glass morphism design
- **Auth**: Supabase Auth (email/password)
- **Real-time**: WebSocket (/ws/live) + Supabase Realtime subscriptions
- **State**: React hooks + localStorage

### Backend (Python FastAPI + Uvicorn)
- **Route Optimization**: Google OR-Tools VRP solver with priority weighting, battery constraints, no-fly zone penalties
- **Simulation**: AirSim + PX4 SITL + Mock mode
- **Drone SDK**: MAVSDK for hardware-in-loop
- **Database**: Supabase PostgreSQL (full schema, see below)
- **Weather**: OpenWeatherMap API + mock mode
- **Physics**: Custom aerospace physics engine (6-rotor hex, 800Wh battery, climb/descent rates)
- **Architecture**: Service-oriented with pub/sub event bus

### AI (Claude + OpenAI APIs)
- **Task Parsing**: Natural language -> structured JSON (locations, priorities, supplies, constraints)
- **Orchestration**: Few-shot prompting + chain-of-thought + confidence gating
- **Validation**: Semantic validation, fuzzy location matching, constraint resolution

---

## Current Pages & What They Do

| Page | Purpose | Key Features |
|------|---------|-------------|
| **Landing** | Public home page | Starfield animation, 3D rotating globe, feature tabs, CTA |
| **Login/Signup** | Auth | Email/password, demo bypass, email verification |
| **Dashboard** | Live mission ops center | Real-time map with drone position, flight log with safety events, weather overlay, dual-drone fleet monitoring, chat panel, custody timeline |
| **Deploy** | NL mission planner | Chat-based input, AI task parsing, route visualization, one-click deploy |
| **Logs** | Flight history | Paginated events, severity color-coding, chain-of-custody, export |
| **Analytics** | Performance metrics | KPI cards, time/distance/battery charts, cost analysis (drone vs ambulance vs helicopter) |
| **Settings** | Configuration | Profile, base location picker, simulation toggles, API config |

---

## Backend API Endpoints (all exist)

```
POST   /api/deploy              — One-shot: create deliveries + schedule + start missions
POST   /api/deliveries          — Create batch deliveries
GET    /api/deliveries          — List deliveries
GET    /api/missions            — List missions
GET    /api/missions/{id}       — Get mission + deliveries
POST   /api/missions/{id}/start — Start mission
POST   /api/missions/start-all  — Start all planning missions
POST   /api/missions/{id}/pause — Pause (hover)
POST   /api/missions/{id}/resume — Resume
POST   /api/missions/{id}/abort — Emergency abort
POST   /api/missions/{id}/reroute — Reroute around obstacles
GET    /api/drones              — List fleet
GET    /api/drones/{id}         — Drone status
GET    /api/facilities          — Search facilities
GET    /api/weather             — Current weather
GET    /api/geofence/zones      — No-fly zones
GET    /api/metrics/{mission_id} — Performance metrics
WS     /ws/live                 — WebSocket: live mission events
GET    /api/stream              — SSE: mission event stream
GET    /api/events              — Event history
POST   /api/simulate/weather    — Inject weather event
POST   /api/simulate/obstacle   — Inject obstacle
POST   /api/simulate/scenario   — Run scenario
POST   /api/chat                — AI chat
POST   /api/generate-report     — AI mission report
POST   /api/risk-score          — AI risk assessment
POST   /api/narrate             — AI event narration
POST   /api/payload-status      — Payload temperature/integrity
POST   /api/mission-comparison  — Cost comparison vs ambulance/helicopter
POST   /api/confirm-delivery    — Delivery confirmation with recipient
POST   /api/weather-briefing    — AI weather briefing
```

---

## Backend Services

| Service | Role |
|---------|------|
| **MissionService** | Mission lifecycle state machine (create/start/pause/resume/abort/reroute) |
| **DroneService** | Drone state cache, telemetry updates |
| **RouteService** | OR-Tools VRP solver wrapper, geofence validation |
| **EventService** | Pub/sub event bus, WebSocket broadcast |
| **SchedulerService** | Delivery-to-drone assignment |
| **MetricsService** | Performance analysis (time, distance, battery, cost) |
| **TelemetryService** | Telemetry ingestion pipeline |
| **ScenarioService** | Demo scenario runner |

---

## AI Modules

| Module | Purpose |
|--------|---------|
| **task_parser.py** | NL -> JSON task parsing with few-shot prompts |
| **orchestrator.py** | Pipeline: Parse -> Validate -> Confidence Gate -> Resolve -> Output |
| **coordinator.py** | Multi-step CoT reasoning |
| **validator.py** | Semantic validation of parsed tasks |
| **confidence.py** | Confidence scoring with thresholds |
| **constraint_bridge.py** | NLP constraints -> geofence zones |
| **preprocessor.py** | Input normalization, fuzzy location matching |
| **conversation.py** | Multi-turn context management |
| **evaluation.py** | Output quality evaluation |
| **prompts.py** | System prompts and few-shot examples |

---

## Supabase Integration (just completed)

### Database Schema (9 tables)
- **facilities** — 9 hospitals/clinics with PostGIS geometry (lat/lon + AirSim coords)
- **drones** — Fleet registry (id, status, battery, position, mission assignment)
- **missions** — Full lifecycle (status, route, waypoints, metrics, timestamps)
- **deliveries** — Per-item tracking (destination, supply, priority, status)
- **waypoints** — Ordered mission stops with reached/ETA tracking
- **telemetry** — Time-series drone data (position, battery, speed, altitude)
- **events** — 22 event types (mission/drone/delivery/environment lifecycle)
- **no_fly_zones** — Geofence polygons (AirSim + GPS coords)
- **profiles** — User profiles with roles (operator/admin/viewer)

### PostgreSQL Extensions Enabled
- **PostGIS** — `nearest_facilities()`, `check_no_fly_zone()`, `route_distance_km()`
- **pgvector** — Semantic search on events/missions via embeddings (1536-dim)
- **pg_cron** — Auto-cleanup telemetry (7d), events (30d), stale mission timeout
- **pg_trgm** — Fuzzy facility name search
- **pg_net** — Async HTTP webhooks
- **Vault** — Secure API key storage

### Edge Functions (4 deployed)
- `emergency-alert` — Logs emergency, updates drone/mission, finds nearest facilities via PostGIS
- `mission-summary` — Full dashboard summary with fleet health + performance grade
- `dispatch-drone` — Finds best available drone, checks NFZ, calculates route distance
- `embed-event` — Generates embeddings for semantic search via OpenAI API

### Analytics Views
- `fleet_health` — Drone availability, battery health, mission counts
- `telemetry_hourly` — 24hr aggregated telemetry for charts
- `event_timeline` — Enriched events with severity classification
- `daily_operations` — Daily mission/delivery summary
- `mission_analytics` — Per-user mission stats
- `delivery_analytics` — Per-user delivery stats
- `operator_leaderboard` — Ranked operators by performance

### RPC Functions
- `get_fleet_status()` — One-call fleet dashboard data
- `get_mission_details()` — Mission + deliveries + waypoints
- `mission_performance_score()` — 0-100 performance grading
- `nearest_facilities()` — PostGIS nearest-neighbor
- `check_no_fly_zone()` — Point-in-polygon geofence check
- `route_distance_km()` — Haversine route distance via PostGIS
- `search_facilities()` — Fuzzy text search
- `search_events_semantic()` — pgvector cosine similarity search
- `find_similar_missions()` — Find historically similar missions

### Database Triggers
- Mission status change -> auto-creates event (mission_completed/failed/aborted)
- Drone battery < 20% -> auto-creates drone_battery_low event
- Drone update -> auto-sets updated_at
- Auth signup -> auto-creates user profile

### Storage Buckets
- `mission-reports` (private, PDF/JSON/CSV, 10MB)
- `flight-logs` (private, JSON/CSV, 50MB)
- `drone-imagery` (public read, PNG/JPEG/WEBP, 5MB)

### Realtime
- Live subscriptions on: drones, missions, deliveries, events, profiles
- Frontend React hooks: `useDrones()`, `useMissions()`, `useDeliveries()`, `useEvents()`, `useFacilities()`, `useMissionAnalytics()`, `useDeliveryAnalytics()`, `useRealtimeMission(missionId)`

---

## Drone Specifications (from physics engine)

- Airframe: 8kg carbon-fibre hex frame
- Battery: 2x LiPo, 800Wh, 80% usable, 15% reserve
- 6 rotors, 18-inch props, 60N max thrust per motor
- Cruise speed: 15 m/s (~54 km/h)
- Cruise altitude: 80m AGL
- Climb: 3 m/s, Descent: 2 m/s
- Max wind: 12 m/s sustained
- Operating temp: -10C to 45C
- Max payload: 5kg

---

## Medical Supplies Supported

blood_pack (0.5kg), vaccine_kit (0.3kg), defibrillator (2.0kg), first_aid (1.0kg), medication (0.2kg), insulin (0.1kg), antivenom (0.4kg), surgical_kit (1.5kg), oxygen_tank (3.0kg)

---

## What's Working Today

- Full NL -> route -> deploy -> monitor pipeline (with mock drone)
- Real-time dashboard with map, flight log, weather, battery tracking
- Dual-drone fleet management
- Route optimization with OR-Tools (priority weighting, battery constraints, NFZ penalties)
- Safety decision injection (rerouting, emergency divert, battery conservation)
- Chain-of-custody tracking (9 steps from packed to received)
- Cost analysis vs traditional transport
- Supabase auth + full database persistence + Realtime subscriptions
- PostGIS spatial queries (nearest facility, geofence checking)
- Semantic search via pgvector embeddings

---

## What I Want You to Research & Expand

For each of the 3 areas (Frontend, Backend, AI), give me:

1. **Feature expansion ideas** — What to add that would impress NVIDIA/Meta/PyTorch judges
2. **Architecture improvements** — How to make it more production-ready
3. **Demo-ready features** — Quick wins that look impressive in a 10-min demo
4. **Technical differentiation** — What makes this stand out from other hackathon projects
5. **Integration opportunities** — How the 3 areas can leverage each other better

### Frontend-specific questions:
- What new pages/views would add value? (e.g., fleet management, admin panel, public status page)
- How to make the 3D visualizations more impressive? (drone model, flight path animation, terrain)
- What real-time features would wow judges? (live telemetry dashboard, predictive ETA, heatmaps)
- Mobile-first or desktop-first for demo?

### Backend-specific questions:
- What services are missing? (notification service, audit service, compliance service)
- How to handle multi-tenant fleet management?
- What would make the route optimization more impressive? (dynamic rerouting, multi-objective optimization, fleet coordination)
- How to add resilience? (circuit breakers, retry logic, graceful degradation)

### AI-specific questions:
- Beyond NL parsing, what AI capabilities would impress? (autonomous flight decisions, predictive maintenance, demand forecasting)
- How to use PyTorch for something meaningful? (obstacle detection, weather prediction, delivery time estimation)
- How to demonstrate AI safety/alignment? (constraint satisfaction, explainable decisions, confidence thresholds)
- What makes the AI "agentic" vs just a parser?
