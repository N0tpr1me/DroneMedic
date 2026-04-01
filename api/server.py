"""
DroneMedic - FastAPI Server

Thin REST wrapper over existing Python backend modules.
Exposes route planning, weather, geofence, drone control, and AI parsing as HTTP endpoints.
"""

from __future__ import annotations

import hashlib
import json
import logging
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from openai import OpenAI
from pydantic import BaseModel

from config import LOCATIONS, VALID_LOCATIONS, NO_FLY_ZONES, OPENAI_API_KEY, OPENAI_BASE_URL
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


class ChatRequest(BaseModel):
    message: str
    context: dict = {}


class GenerateReportRequest(BaseModel):
    metrics: dict
    mission_summary: dict = {}


class RiskScoreRequest(BaseModel):
    route: list[str]
    weather: dict = {}
    battery: float = 100.0
    payload_priority: str = "normal"


class NarrateRequest(BaseModel):
    event: dict
    context: dict = {}


class PayloadStatusRequest(BaseModel):
    payload_type: str = "blood"
    elapsed_minutes: float = 0.0
    conditions: dict = {}


class MissionComparisonRequest(BaseModel):
    route: dict = {}
    locations: list[str] = []


class ConfirmDeliveryRequest(BaseModel):
    mission_id: str = "MISSION-001"
    recipient: str
    recipient_role: str
    condition_on_arrival: str = "intact"


# ── GPT Helper ───────────────────────────────────────────────────────

def _call_gpt(system: str, user_message: str) -> str:
    client = OpenAI(api_key=OPENAI_API_KEY, base_url=OPENAI_BASE_URL)
    response = client.chat.completions.create(
        model="azure/gpt-5.3-chat",
        max_tokens=1024,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user_message},
        ],
    )
    return response.choices[0].message.content.strip()


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


@app.post("/api/chat")
def api_chat(req: ChatRequest) -> dict:
    """Chat with the AI Mission Coordinator."""
    try:
        from ai.coordinator import MissionCoordinator
        coordinator = MissionCoordinator()
        result = coordinator.converse(req.message)
        return {"reply": result["response"]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Chat failed: {e}")


@app.post("/api/generate-report")
def api_generate_report(req: GenerateReportRequest) -> dict:
    """Generate a post-flight mission report using GPT-5.3."""
    try:
        system = (
            "You are a DroneMedic post-flight analyst for NHS hospital administrators. "
            "Given performance metrics and mission data, write a concise 3-5 sentence "
            "mission report covering: delivery outcome vs clinical deadline, route "
            "efficiency, any incidents encountered, and recommendation for future "
            "operations. Be direct and data-driven."
        )
        user_message = json.dumps({"metrics": req.metrics, "mission_summary": req.mission_summary})
        report = _call_gpt(system, user_message)
        return {"report": report}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Report generation failed: {e}")


@app.post("/api/weather-briefing")
def api_weather_briefing() -> dict:
    """Generate an AI weather briefing for all locations."""
    try:
        weather_data = get_all_location_weather()
        system = (
            "You are a DroneMedic weather analyst advising hospital operations. "
            "For each location, state: flyable or not, specific risk (wind/rain/visibility), "
            "and recommended action. Be direct — lives depend on this."
        )
        user_message = json.dumps(weather_data)
        briefing = _call_gpt(system, user_message)
        return {"briefing": briefing}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Weather briefing failed: {e}")


@app.post("/api/risk-score")
def api_risk_score(req: RiskScoreRequest) -> dict:
    """Compute an AI-generated risk score for a delivery route."""
    try:
        system = (
            "You are a DroneMedic risk analyst. Given route, weather, battery, and "
            "payload priority, return a JSON object with: score (0-100 integer), "
            "level (low/medium/high/critical), factors (list of risk factor strings), "
            "recommendation (string), contingency (string describing backup plan). "
            "Return ONLY valid JSON."
        )
        user_message = json.dumps({
            "route": req.route,
            "weather": req.weather,
            "battery": req.battery,
            "payload_priority": req.payload_priority,
        })
        raw = _call_gpt(system, user_message)
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            parsed = {
                "score": 25,
                "level": "low",
                "factors": ["Unable to assess — using default"],
                "recommendation": "Proceed with caution",
                "contingency": "Backup drone on standby",
            }
        return {"risk": parsed}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Risk scoring failed: {e}")


@app.post("/api/narrate")
def api_narrate(req: NarrateRequest) -> dict:
    """Generate live flight narration for a drone event."""
    try:
        system = (
            "You are a DroneMedic flight narrator providing live mission commentary "
            "for hospital operations staff. Given a drone flight event and mission "
            "context, write a brief (1-2 sentences), professional narration. Include "
            "relevant details like payload type, location names, and any weather or "
            "obstacle factors. Be concise and informative."
        )
        user_message = json.dumps({"event": req.event, "context": req.context})
        narration = _call_gpt(system, user_message)
        return {"narration": narration}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Narration failed: {e}")


@app.post("/api/payload-status")
def api_payload_status(req: PayloadStatusRequest) -> dict:
    """Simulate payload condition based on elapsed time and conditions."""
    profiles = {
        "blood": {"safe_min": 2.0, "safe_max": 6.0, "max_time": 240, "base_temp": 4.0, "drift": 0.005},
        "insulin": {"safe_min": 2.0, "safe_max": 8.0, "max_time": 480, "base_temp": 5.0, "drift": 0.003},
    }
    default_profile = {"safe_min": 15.0, "safe_max": 25.0, "max_time": 600, "base_temp": 20.0, "drift": 0.002}
    profile = profiles.get(req.payload_type, default_profile)

    wind_speed = req.conditions.get("wind", 0)
    wind_factor = 2.0 if wind_speed > 15 else 1.0

    temp = profile["base_temp"] + (profile["drift"] * req.elapsed_minutes * wind_factor)

    safe_min = profile["safe_min"]
    safe_max = profile["safe_max"]
    if temp < safe_min or temp > safe_max:
        integrity = "compromised"
    elif temp < (safe_min + 1.0) or temp > (safe_max - 1.0):
        integrity = "warning"
    else:
        integrity = "nominal"

    remaining = profile["max_time"] - req.elapsed_minutes

    return {
        "temperature_c": round(temp, 1),
        "integrity": integrity,
        "time_remaining_minutes": round(remaining, 1),
    }


@app.post("/api/mission-comparison")
def api_mission_comparison(req: MissionComparisonRequest) -> dict:
    """Compare drone delivery against helicopter and ambulance alternatives."""
    drone_time = req.route.get("estimated_time", 180) / 60  # seconds to minutes
    drone_cost = 340  # fixed GBP

    helicopter_time = drone_time * 1.5
    helicopter_cost = 8200
    helicopter_available = False  # grounded by weather in demo

    ambulance_time = drone_time * 5
    ambulance_cost = 180

    return {
        "comparison": {
            "drone": {
                "time_minutes": round(drone_time, 1),
                "cost_gbp": drone_cost,
                "available": True,
            },
            "helicopter": {
                "time_minutes": round(helicopter_time, 1),
                "cost_gbp": helicopter_cost,
                "available": helicopter_available,
            },
            "ambulance": {
                "time_minutes": round(ambulance_time, 1),
                "cost_gbp": ambulance_cost,
                "available": True,
            },
        }
    }


@app.post("/api/confirm-delivery")
def api_confirm_delivery(req: ConfirmDeliveryRequest) -> dict:
    """Generate a delivery confirmation receipt."""
    ts = datetime.utcnow().isoformat() + "Z"
    raw = f"{req.recipient}{ts}"
    signature_id = "SIG-" + hashlib.sha256(raw.encode()).hexdigest()[:8]

    return {
        "confirmation": {
            "timestamp": ts,
            "recipient": req.recipient,
            "recipient_role": req.recipient_role,
            "condition": req.condition_on_arrival,
            "signature_id": signature_id,
        }
    }


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "service": "DroneMedic API"}
