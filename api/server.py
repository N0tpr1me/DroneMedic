"""
DroneMedic - FastAPI Server

Thin REST wrapper over existing Python backend modules.
Exposes route planning, weather, geofence, drone control, and AI parsing as HTTP endpoints.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import time
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Any

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
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
from backend.physics import (
    DroneSpec, FlightConditions, compute_mission_energy, compute_weather_penalty,
    check_thrust_feasibility, compute_hover_power, compute_cruise_power,
    compute_energy_per_km, compute_hover_energy_per_minute, compute_mtom,
)
from backend.safety import (
    preflight_check, inflight_assessment, triage_route, weather_to_conditions,
    classify_delivery, BatteryState, MissionAction,
)
from backend.mission_controller import MissionController
from simulation.drone_control import DroneController
from simulation.obstacle_detector import check_for_obstacle, reset_obstacles
from simulation.backend.voice_command import router as voice_router
from simulation.backend.reasoning_stream import router as reasoning_router

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("DroneMedic.API")

# --- Active drone session (single-user hackathon demo) ---
_drone: DroneController | None = None
_mission_state: dict[str, Any] = {}
_mission_ctrl: MissionController = MissionController()

# --- WebSocket live clients ---
ws_clients: set[WebSocket] = set()

# --- AI chat session persistence ---
_coordinators: dict[str, "MissionCoordinator"] = {}  # noqa: F821


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

app.include_router(voice_router)
app.include_router(reasoning_router)


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
    session_id: str = "main"


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


class DeployItem(BaseModel):
    destination: str
    supply: str = "medical_supplies"
    priority: str = "normal"
    time_window_minutes: float = 60.0


class DeployRequest(BaseModel):
    deliveries: list[DeployItem]


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
    """Chat with the AI Mission Coordinator. Reuses coordinator per session_id."""
    try:
        from ai.coordinator import MissionCoordinator

        session_id = req.session_id or "main"
        if session_id not in _coordinators:
            _coordinators[session_id] = MissionCoordinator()

        coordinator = _coordinators[session_id]
        result = coordinator.converse(req.message)
        return {"reply": result["response"], "session_id": session_id}
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


# ── Physics / Safety Request Models ───────────────────────────────────

class PhysicsCheckRequest(BaseModel):
    route: list[str]
    payload_kg: float = 2.5
    headwind_ms: float = 0.0
    crosswind_ms: float = 0.0
    precipitation_mmh: float = 0.0
    temperature_c: float = 18.0
    turbulence: str = "calm"


class TriageRequest(BaseModel):
    route: list[str]
    supplies: dict[str, str] = {}
    priorities: dict[str, str] = {}
    energy_available_wh: float = 544.0
    payload_kg: float = 2.5
    headwind_ms: float = 0.0


class WeatherPenaltyRequest(BaseModel):
    headwind_ms: float = 0.0
    crosswind_ms: float = 0.0
    precipitation_mmh: float = 0.0
    temperature_c: float = 18.0
    turbulence: str = "calm"


class PrepareMissionRequest(BaseModel):
    route: list[str]
    payload_kg: float = 2.5
    supplies: dict[str, str] = {}
    priorities: dict[str, str] = {}
    headwind_ms: float = 0.0
    crosswind_ms: float = 0.0
    precipitation_mmh: float = 0.0
    temperature_c: float = 18.0
    turbulence: str = "calm"


class ControlTickRequest(BaseModel):
    lat: float = 51.5074
    lon: float = -0.1278
    battery_wh: float = 544.0
    battery_pct: float = 100.0
    current_location: str = "Depot"
    headwind_ms: float = 0.0
    crosswind_ms: float = 0.0
    precipitation_mmh: float = 0.0
    temperature_c: float = 18.0
    turbulence: str = "calm"


# ── Physics / Safety Endpoints ────────────────────────────────────────

@app.post("/api/physics/preflight")
def api_preflight_check(req: PhysicsCheckRequest) -> dict:
    """Run full 12-rule pre-flight go/no-go check with physics model."""
    conditions = FlightConditions(
        headwind_ms=req.headwind_ms,
        crosswind_ms=req.crosswind_ms,
        precipitation_mmh=req.precipitation_mmh,
        temperature_c=req.temperature_c,
        turbulence=req.turbulence,
    )
    result = preflight_check(req.route, req.payload_kg, conditions)
    return {
        "decision": result.decision,
        "battery_state": result.battery_state.value if result.battery_state else None,
        "checks": result.checks,
        "failed_checks": result.failed_checks,
        "recommendations": result.recommendations,
        "energy_budget": result.energy_budget.__dict__ if result.energy_budget else None,
        "weather_penalty": result.weather_penalty.__dict__ if result.weather_penalty else None,
    }


@app.post("/api/physics/energy-budget")
def api_energy_budget(req: PhysicsCheckRequest) -> dict:
    """Compute full mission energy budget using aerospace physics model."""
    spec = DroneSpec()
    conditions = FlightConditions(
        headwind_ms=req.headwind_ms,
        crosswind_ms=req.crosswind_ms,
        precipitation_mmh=req.precipitation_mmh,
        temperature_c=req.temperature_c,
        turbulence=req.turbulence,
    )
    budget = compute_mission_energy(spec, req.payload_kg, req.route, conditions)
    return {
        "feasible": budget.feasible,
        "ratio": budget.ratio,
        "total_energy_wh": budget.total_wh,
        "available_energy_wh": budget.available_wh,
        "reserve_wh": budget.reserve_wh,
        "cruise_wh": budget.cruise_wh,
        "hover_wh": budget.hover_wh,
        "climb_wh": budget.climb_wh,
        "descent_wh": budget.descent_wh,
        "flight_time_s": budget.flight_time_s,
        "max_range_km": budget.max_range_km,
        "details": budget.details,
    }


@app.post("/api/physics/weather-penalty")
def api_weather_penalty(req: WeatherPenaltyRequest) -> dict:
    """Compute weather penalty factors for current conditions."""
    conditions = FlightConditions(
        headwind_ms=req.headwind_ms,
        crosswind_ms=req.crosswind_ms,
        precipitation_mmh=req.precipitation_mmh,
        temperature_c=req.temperature_c,
        turbulence=req.turbulence,
    )
    wp = compute_weather_penalty(conditions)
    return {
        "flyable": wp.flyable,
        "k_wind": wp.k_wind,
        "k_precip": wp.k_precip,
        "k_temp": wp.k_temp,
        "k_turbulence": wp.k_turbulence,
        "k_total": wp.k_total,
        "reasons": wp.reasons,
    }


@app.get("/api/physics/drone-specs")
def api_drone_specs() -> dict:
    """Return current drone physical specifications."""
    spec = DroneSpec()
    return {
        "airframe_mass_kg": spec.airframe_mass_kg,
        "battery_mass_kg": spec.battery_mass_kg,
        "battery_capacity_wh": spec.battery_capacity_wh,
        "usable_energy_wh": spec.usable_energy_wh,
        "reserve_energy_wh": spec.reserve_energy_wh,
        "mission_energy_wh": spec.mission_energy_wh,
        "max_payload_kg": spec.max_payload_kg,
        "num_rotors": spec.num_rotors,
        "disk_area_m2": round(spec.disk_area_m2, 4),
        "max_thrust_n": spec.max_total_thrust_n,
        "cruise_speed_ms": spec.cruise_speed_ms,
        "endurance_speed_ms": spec.endurance_speed_ms,
        "cruise_altitude_m": spec.cruise_altitude_m,
    }


@app.post("/api/physics/thrust-check")
def api_thrust_check(payload_kg: float = 2.5) -> dict:
    """Check thrust feasibility at given payload."""
    return check_thrust_feasibility(DroneSpec(), payload_kg)


@app.post("/api/physics/triage")
def api_triage_route(req: TriageRequest) -> dict:
    """Triage route by dropping lowest-priority stops until energy-feasible."""
    conditions = FlightConditions(headwind_ms=req.headwind_ms) if req.headwind_ms > 0 else None
    result = triage_route(
        req.route, req.supplies, req.priorities,
        req.energy_available_wh, DroneSpec(), req.payload_kg, conditions,
    )
    return result


@app.get("/api/physics/power-profile")
def api_power_profile(payload_kg: float = 2.5) -> dict:
    """Return power consumption at different flight phases."""
    spec = DroneSpec()
    return {
        "payload_kg": payload_kg,
        "mtom_kg": compute_mtom(spec, payload_kg),
        "hover_power_w": round(compute_hover_power(spec, payload_kg), 1),
        "cruise_power_w": round(compute_cruise_power(spec, payload_kg), 1),
        "energy_per_km_wh": round(compute_energy_per_km(spec, payload_kg), 1),
        "hover_cost_per_min_wh": round(compute_hover_energy_per_minute(spec, payload_kg), 1),
    }


# ── Mission Controller Endpoints ─────────────────────────────────────

@app.post("/api/mission/prepare")
def api_prepare_mission(req: PrepareMissionRequest) -> dict:
    """Prepare mission with full go/no-go preflight check via MissionController."""
    conditions = FlightConditions(
        headwind_ms=req.headwind_ms,
        crosswind_ms=req.crosswind_ms,
        precipitation_mmh=req.precipitation_mmh,
        temperature_c=req.temperature_c,
        turbulence=req.turbulence,
    )
    result = _mission_ctrl.prepare_mission(
        route=req.route,
        payload_kg=req.payload_kg,
        supplies=req.supplies,
        priorities=req.priorities,
        conditions=conditions,
    )
    return {
        "decision": result.decision,
        "battery_state": result.battery_state.value if result.battery_state else None,
        "checks": result.checks,
        "failed_checks": result.failed_checks,
        "recommendations": result.recommendations,
        "energy_budget": result.energy_budget.__dict__ if result.energy_budget else None,
    }


@app.post("/api/mission/launch")
def api_launch_mission() -> dict:
    """Launch the prepared mission."""
    return _mission_ctrl.launch()


@app.post("/api/mission/control-tick")
def api_control_tick(req: ControlTickRequest) -> dict:
    """Real-time control loop tick — call every ~1s during flight."""
    conditions = FlightConditions(
        headwind_ms=req.headwind_ms,
        crosswind_ms=req.crosswind_ms,
        precipitation_mmh=req.precipitation_mmh,
        temperature_c=req.temperature_c,
        turbulence=req.turbulence,
    )
    return _mission_ctrl.control_tick(
        current_position={"lat": req.lat, "lon": req.lon},
        battery_wh=req.battery_wh,
        battery_pct=req.battery_pct,
        conditions=conditions,
        current_location=req.current_location,
    )


@app.post("/api/mission/waypoint/{location}")
def api_mark_waypoint(location: str) -> dict:
    """Mark a waypoint as visited."""
    _mission_ctrl.mark_waypoint_visited(location)
    return _mission_ctrl.get_state()


@app.post("/api/mission/complete")
def api_complete_mission() -> dict:
    """Finalize the mission and get summary."""
    return _mission_ctrl.complete_mission()


@app.get("/api/mission/state")
def api_mission_state() -> dict:
    """Get current mission state."""
    return _mission_ctrl.get_state()


# ── WebSocket Live Feed ─────────────────────────────────────────────


@app.websocket("/ws/live")
async def ws_live(ws: WebSocket):
    """Real-time event stream for the React dashboard."""
    await ws.accept()
    ws_clients.add(ws)
    try:
        while True:
            await ws.receive_text()  # keep connection alive; ignore inbound messages
    except WebSocketDisconnect:
        ws_clients.discard(ws)


async def broadcast_event(event: dict) -> None:
    """Send an event dict to every connected WebSocket client."""
    dead: set[WebSocket] = set()
    for ws in ws_clients:
        try:
            await ws.send_json(event)
        except Exception:
            dead.add(ws)
    ws_clients -= dead


# ── Deploy Endpoint ─────────────────────────────────────────────────


async def _run_deploy_flight(
    route: list[str],
    supplies: dict[str, str],
    priorities: dict[str, str],
) -> None:
    """Background coroutine that simulates a deploy flight with WS broadcasts."""
    drone_id = _mission_ctrl.state.drone_id
    mission_id = _mission_ctrl.state.mission_id

    # Broadcast mission_started
    await broadcast_event({
        "type": "mission_started",
        "drone_id": drone_id,
        "route": route,
        "timestamp": time.time(),
    })

    await broadcast_event({
        "type": "drone_status_changed",
        "drone_id": drone_id,
        "status": "flying",
        "timestamp": time.time(),
    })

    # Launch via mission controller
    _mission_ctrl.launch()

    # Simulate flight through each waypoint
    total_stops = len(route)
    battery_pct = 100.0
    for idx, location in enumerate(route):
        if location == "Depot" and idx == 0:
            continue

        # Simulate flight time to this waypoint
        await asyncio.sleep(3)

        # Drain battery proportionally
        battery_pct = max(5.0, battery_pct - (80.0 / max(total_stops - 1, 1)))

        # Get location coords if available
        loc_data = LOCATIONS.get(location, {})
        lat = loc_data.get("lat", 51.5074)
        lon = loc_data.get("lon", -0.1278)

        # Run control tick
        tick_result = _mission_ctrl.control_tick(
            current_position={"lat": lat, "lon": lon},
            battery_wh=battery_pct / 100.0 * 544.0,
            battery_pct=battery_pct,
            current_location=location,
        )

        _mission_ctrl.mark_waypoint_visited(location)

        # Broadcast waypoint_reached
        await broadcast_event({
            "type": "waypoint_reached",
            "drone_id": drone_id,
            "location": location,
            "waypoint": location,
            "position": {"lat": lat, "lon": lon},
            "battery": battery_pct,
            "timestamp": time.time(),
        })

        # Broadcast drone_position_updated
        await broadcast_event({
            "type": "drone_position_updated",
            "drone_id": drone_id,
            "lat": lat,
            "lon": lon,
            "alt": 120.0,
            "battery_pct": battery_pct,
            "battery": battery_pct,
            "speed": 15.0,
            "heading": 0.0,
            "current_location": location,
            "position": {"x": lat, "y": lon, "z": 120.0},
            "status": "flying",
            "timestamp": time.time(),
        })

        # Broadcast safety_decision from control tick
        await broadcast_event({
            "type": "safety_decision",
            "battery_state": tick_result.get("battery_state", "GREEN"),
            "action": tick_result.get("action", "CONTINUE"),
            "reasons": tick_result.get("reasons", []),
            "divert_location": tick_result.get("divert_location"),
            "remaining_battery_pct": battery_pct,
            "timestamp": time.time(),
        })

        # Check for low battery
        if battery_pct < 20.0:
            await broadcast_event({
                "type": "drone_battery_low",
                "drone_id": drone_id,
                "battery_pct": battery_pct,
                "timestamp": time.time(),
            })

        # Broadcast delivery_completed for non-depot stops
        await broadcast_event({
            "type": "delivery_completed",
            "drone_id": drone_id,
            "location": location,
            "timestamp": time.time(),
        })

    # Complete mission
    summary = _mission_ctrl.complete_mission()

    await broadcast_event({
        "type": "drone_status_changed",
        "drone_id": drone_id,
        "status": "completed",
        "timestamp": time.time(),
    })

    await broadcast_event({
        "type": "mission_completed",
        "drone_id": drone_id,
        "summary": summary,
        "timestamp": time.time(),
    })


@app.post("/api/deploy")
async def api_deploy(req: DeployRequest) -> dict:
    """
    One-shot mission deployment.
    Prepares a mission, kicks off a background flight simulation with WS broadcasts,
    and returns immediately.
    """
    # Build route from delivery items
    destinations = [item.destination for item in req.deliveries]
    route = ["Depot"] + destinations + ["Depot"]

    supplies = {item.destination: item.supply for item in req.deliveries}
    priorities = {item.destination: item.priority for item in req.deliveries}

    # Prepare mission via mission controller
    _mission_ctrl.prepare_mission(
        route=route,
        payload_kg=2.5,
        supplies=supplies,
        priorities=priorities,
    )

    # Launch flight loop as a background task
    asyncio.create_task(
        _run_deploy_flight(route, supplies, priorities)
    )

    return {
        "status": "deploying",
        "deliveries": [
            {
                "destination": item.destination,
                "supply": item.supply,
                "priority": item.priority,
            }
            for item in req.deliveries
        ],
        "missions": [
            {
                "mission_id": _mission_ctrl.state.mission_id,
                "drone_id": _mission_ctrl.state.drone_id,
                "route": route,
            }
        ],
    }


# ── Health ──────────────────────────────────────────────────────────


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "service": "DroneMedic API"}
