"""
DroneMedic - FastAPI Server

Thin REST wrapper over existing Python backend modules.
Exposes route planning, weather, geofence, drone control, and AI parsing as HTTP endpoints.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from config import LOCATIONS, VALID_LOCATIONS, NO_FLY_ZONES
from backend.route_planner import compute_route, recompute_route
from backend.weather_service import (
    get_all_location_weather,
    simulate_weather_event,
    clear_weather_overrides,
)
from backend.geofence import check_route_safety, get_no_fly_zones
from backend.metrics import compute_metrics, compute_naive_baseline
from simulation.drone_control import DroneController
from simulation.obstacle_detector import check_for_obstacle, reset_obstacles

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("DroneMedic.API")

# --- Active drone session (single-user hackathon demo) ---
_drone: DroneController | None = None
_mission_state: dict[str, Any] = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("DroneMedic API starting")
    yield
    logger.info("DroneMedic API shutting down")


app = FastAPI(title="DroneMedic API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Request / Response Models ──────────────────────────────────────

class ParseTaskRequest(BaseModel):
    user_input: str


class ComputeRouteRequest(BaseModel):
    locations: list[str]
    priorities: dict[str, str] = {}
    num_drones: int = 1


class RecomputeRouteRequest(BaseModel):
    current_location: str
    remaining_locations: list[str]
    new_locations: list[str]
    priorities: dict[str, str] = {}


class SimulateWeatherRequest(BaseModel):
    event_type: str
    affected_locations: list[str] = []


class CheckRouteSafetyRequest(BaseModel):
    route: list[str]


class StartDeliveryRequest(BaseModel):
    route: list[str]


class MetricsRequest(BaseModel):
    flight_log: list[dict]
    optimized_route: dict
    locations: list[str]
    reroute_count: int = 0
    reroute_successes: int = 0
    obstacles_avoided: int = 0
    obstacles_total: int = 0


# ── Endpoints ──────────────────────────────────────────────────────

@app.get("/api/locations")
def get_locations() -> dict:
    """Return all known locations with coordinates."""
    return {"locations": LOCATIONS, "valid_names": VALID_LOCATIONS}


@app.post("/api/parse-task")
def parse_task(req: ParseTaskRequest) -> dict:
    """Parse natural language delivery request via Claude API."""
    try:
        from ai.task_parser import parse_delivery_request
        result = parse_delivery_request(req.user_input)
        return {"task": result}
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI parsing failed: {e}")


@app.post("/api/compute-route")
def api_compute_route(req: ComputeRouteRequest) -> dict:
    """Compute optimal delivery route using OR-Tools VRP solver."""
    for loc in req.locations:
        if loc not in VALID_LOCATIONS:
            raise HTTPException(status_code=400, detail=f"Unknown location: {loc}")
    result = compute_route(req.locations, req.priorities, num_drones=req.num_drones)
    return {"route": result}


@app.post("/api/recompute-route")
def api_recompute_route(req: RecomputeRouteRequest) -> dict:
    """Recompute route mid-flight for dynamic re-routing."""
    result = recompute_route(
        req.current_location,
        req.remaining_locations,
        req.new_locations,
        req.priorities,
    )
    return {"route": result}


@app.get("/api/weather")
def api_get_weather() -> dict:
    """Get weather for all locations."""
    return {"weather": get_all_location_weather()}


@app.post("/api/simulate-weather")
def api_simulate_weather(req: SimulateWeatherRequest) -> dict:
    """Simulate a weather event for demo."""
    event = simulate_weather_event(req.event_type, req.affected_locations or None)
    return {"event": event, "all_weather": get_all_location_weather()}


@app.post("/api/clear-weather")
def api_clear_weather() -> dict:
    """Clear all weather overrides."""
    clear_weather_overrides()
    return {"status": "cleared", "all_weather": get_all_location_weather()}


@app.get("/api/no-fly-zones")
def api_get_no_fly_zones() -> dict:
    """Return all no-fly zones."""
    return {"zones": get_no_fly_zones()}


@app.post("/api/check-route-safety")
def api_check_route_safety(req: CheckRouteSafetyRequest) -> dict:
    """Check route for no-fly zone violations."""
    violations = check_route_safety(req.route)
    return {"safe": len(violations) == 0, "violations": violations}


@app.post("/api/start-delivery")
def api_start_delivery(req: StartDeliveryRequest) -> dict:
    """
    Execute a delivery route in mock mode.
    Returns the full flight log and final state.
    """
    global _drone, _mission_state

    drone = DroneController(use_airsim=False)
    drone.connect()
    drone.takeoff()

    visited = []
    for i, location in enumerate(req.route):
        if location == "Depot" and i == 0:
            continue
        drone.move_to(location)
        visited.append(location)

    drone.land()

    _drone = drone
    _mission_state = {
        "route": req.route,
        "visited": visited,
        "battery": drone.get_battery(),
        "flight_log": drone.get_flight_log(),
    }

    return {
        "status": "completed",
        "visited": visited,
        "battery": drone.get_battery(),
        "flight_log": drone.get_flight_log(),
    }


@app.post("/api/metrics")
def api_compute_metrics(req: MetricsRequest) -> dict:
    """Compute delivery performance metrics."""
    result = compute_metrics(
        flight_log=req.flight_log,
        optimized_route=req.optimized_route,
        locations=req.locations,
        reroute_count=req.reroute_count,
        reroute_successes=req.reroute_successes,
        obstacles_avoided=req.obstacles_avoided,
        obstacles_total=req.obstacles_total,
    )
    return {"metrics": result}


@app.get("/api/naive-baseline")
def api_naive_baseline(locations: str) -> dict:
    """Compute naive baseline for comparison. Pass locations as comma-separated."""
    loc_list = [loc.strip() for loc in locations.split(",")]
    result = compute_naive_baseline(loc_list)
    return {"baseline": result}


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "service": "DroneMedic API"}
