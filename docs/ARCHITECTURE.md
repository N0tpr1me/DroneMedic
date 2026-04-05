# DroneMedic Architecture

## System Overview

DroneMedic is a full-stack medical drone delivery platform that combines AI-powered natural language task parsing, aerospace-grade physics simulation, VRP route optimization, and real-time 3D visualization. The system is designed for autonomous medical supply delivery in urban environments with dynamic obstacle avoidance, no-fly zone enforcement, and weather-adaptive re-routing.

## C4 Context Diagram

```mermaid
graph TB
    Operator[Operator/Clinician] -->|Natural language| Frontend[React Frontend]
    Frontend -->|REST + WebSocket| Backend[FastAPI Backend]
    Backend -->|VRP Solver| ORTools[Google OR-Tools]
    Backend -->|NL Parsing| LLM[Claude/OpenAI API]
    Backend -->|Persistence| Supabase[Supabase PostgreSQL]
    Backend -->|Simulation| Simulator[AirSim/PX4/Mock]
    Backend -->|Weather| OWM[OpenWeatherMap]
    Supabase -->|Realtime| Frontend
    Frontend -->|Auth| Supabase
```

## Service Architecture

```mermaid
graph LR
    subgraph Frontend
        Pages[Pages: Dashboard, Deploy, Fleet, Logs, Analytics, Status]
        Hooks[Hooks: useLiveMission, useDrones, useRealtimeMission]
        Components[Components: MapView, FlightLog, ChatPanel, DroneScene]
    end

    subgraph Backend
        API[FastAPI Routes]
        MS[MissionService]
        DS[DroneService]
        ES[EventService]
        SS[SchedulerService]
        RS[RouteService]
        TS[TelemetryService]
    end

    subgraph AI
        Parser[Task Parser]
        Agent[Flight Agent]
        Maint[Predictive Maintenance]
        Forecast[Demand Forecast]
        CV[YOLOv8 Detector]
    end

    subgraph Data
        SB[(Supabase)]
        PostGIS[PostGIS]
        pgvector[pgvector]
        Realtime[Realtime]
    end
```

## Data Flow

```mermaid
sequenceDiagram
    participant U as Operator
    participant FE as React Frontend
    participant BE as FastAPI Backend
    participant AI as Task Parser (LLM)
    participant VRP as OR-Tools Solver
    participant SIM as Drone Simulator
    participant DB as Supabase

    U->>FE: "Send blood packs to Royal London, urgent"
    FE->>BE: POST /missions/create
    BE->>AI: Parse natural language
    AI-->>BE: {destinations, priorities, supplies}
    BE->>VRP: Solve VRP with constraints
    VRP-->>BE: Optimal route + ETA
    BE->>DB: Create mission + deliveries
    DB-->>FE: Realtime subscription fires
    BE->>SIM: Execute flight plan
    SIM-->>BE: Telemetry stream
    BE->>DB: Update drone position
    DB-->>FE: Live position updates
    FE->>U: 3D map + flight log + ETA
```

## Module Dependency Graph

```mermaid
graph TD
    config[config.py] --> GP[geofence.py]
    config --> RP[route_planner.py]
    config --> WS[weather_service.py]
    config --> DC[drone_control.py]
    config --> PH[physics.py]

    GP --> RP
    WS --> RP
    PH --> RP
    PH --> SA[safety.py]

    RP --> MS[MissionService]
    DC --> MS
    SA --> MS

    MS --> API[FastAPI Routes]
    DS[DroneService] --> API
    ES[EventService] --> API

    API --> FE[React Frontend]
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript, Vite 8, Tailwind v4, Three.js, Deck.gl |
| Backend | Python 3.9+, FastAPI, Google OR-Tools, MAVSDK |
| AI/ML | Claude API, OpenAI SDK, PyTorch, YOLOv8, LSTM Autoencoder |
| Physics | Custom aerospace engine (actuator disk theory, energy budgets) |
| Database | Supabase PostgreSQL + PostGIS + pgvector |
| Realtime | WebSocket + Supabase Realtime |
| Simulation | AirSim, PX4 SITL, Mock mode |
| Infrastructure | Docker, GitHub Actions CI/CD |

## Key Design Decisions

1. **Deterministic routing over AI**: OR-Tools handles all route optimization. The LLM is used only for natural language parsing -- never for route decisions.

2. **Physics-first feasibility**: Every mission passes through an aerospace physics engine (actuator disk theory, energy budgets, thrust-to-weight checks) before launch.

3. **Mock everything**: Weather, obstacles, AirSim, and PX4 all have mock mode fallbacks. The system runs fully offline for development and demos.

4. **Strict module separation**: Parsing, routing, simulation, and UI are independent layers connected through `config.py`. No cross-layer imports.

5. **Backward compatible**: All new function parameters have defaults. Existing calls never break.

## Supabase Features Used (20)

Auth, Database (9 tables), RLS, Realtime, PostGIS, pgvector, pg_cron, pg_trgm, pg_net, Vault, Storage (3 buckets), Edge Functions (4), DB Triggers, RPC Functions (8), Analytics Views (7), TypeScript Types, Python Client, React Hooks, GraphQL (pg_graphql), User Profiles

## Directory Structure

```
DroneMedic/
  ai/                    Task parser (LLM NL -> JSON)
  backend/
    domain/              Pydantic models + enums
    services/            MissionService, DroneService, EventService
    db/                  Supabase client + migrations
    geofence.py          No-fly zone ray-casting
    route_planner.py     OR-Tools VRP solver
    weather_service.py   OpenWeatherMap + mock
    physics.py           Aerospace energy/thrust model
    safety.py            Preflight checks
    metrics.py           Post-flight evaluation
  simulation/
    drone_control.py     AirSim/PX4/Mock drone controller
    obstacle_detector.py Simulated obstacle detection
    unity/               Unity 3D simulation project
  web/
    src/
      pages/             Dashboard, Deploy, Fleet, Logs, Analytics, Status
      components/        MapView, ChatPanel, DroneScene, FlightLog
      hooks/             useLiveMission, useDrones, useRealtimeMission
      lib/               Supabase client, API helpers
  frontend/
    dashboard.py         Streamlit legacy dashboard
  tests/                 pytest smoke tests
  config.py              Central configuration
  main.py                CLI orchestrator
```
