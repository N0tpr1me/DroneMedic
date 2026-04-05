"""DroneMedic — Legacy API routes for frontend backward compatibility.

Preserves the exact endpoint paths and response shapes from api/server.py
so the React frontend continues to work unchanged.
"""

from __future__ import annotations

import hashlib
import json
import logging
import time
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from config import LOCATIONS, VALID_LOCATIONS
from backend.route_planner import compute_route, recompute_route
from backend.weather_service import (
    get_all_location_weather,
    simulate_weather_event,
    clear_weather_overrides,
)
from backend.geofence import check_route_safety, get_no_fly_zones
from backend.metrics import compute_metrics, compute_naive_baseline
from backend.facilities import search_facilities, get_facility_by_name
from simulation.drone_control import DroneController
from backend.api.dependencies import get_ai

logger = logging.getLogger("DroneMedic.Legacy")

router = APIRouter(tags=["Legacy (frontend compat)"])


# ── Request models (matching api/server.py exactly) ────────────────────

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


# ── Endpoints ──────────────────────────────────────────────────────────

@router.get("/api/health")
async def health_check():
    """Enhanced health check with dependency status."""
    from backend.app import APP_START_TIME
    from backend.api.dependencies import get_drones

    checks: dict = {}

    # Check Supabase
    try:
        from backend.db.supabase_client import get_supabase
        sb = get_supabase()
        if sb:
            start = time.time()
            sb.table("drones").select("id").limit(1).execute()
            checks["database"] = {"status": "connected", "latency_ms": round((time.time() - start) * 1000)}
        else:
            checks["database"] = {"status": "not_configured"}
    except Exception as e:
        checks["database"] = {"status": "error", "error": str(e)}

    # Check weather API
    try:
        from config import WEATHER_ENABLED, OPENWEATHER_API_KEY
        if WEATHER_ENABLED and OPENWEATHER_API_KEY:
            checks["weather_api"] = {"status": "configured", "enabled": True}
        else:
            checks["weather_api"] = {"status": "mock_mode", "enabled": False}
    except Exception:
        checks["weather_api"] = {"status": "unknown"}

    # Check LLM API
    try:
        from config import OPENAI_API_KEY
        checks["llm_api"] = {"status": "configured" if OPENAI_API_KEY else "not_configured"}
    except Exception:
        checks["llm_api"] = {"status": "unknown"}

    # Check simulator mode
    from config import AIRSIM_ENABLED, PX4_ENABLED
    sim_mode = "airsim" if AIRSIM_ENABLED else "px4" if PX4_ENABLED else "mock"
    checks["simulator"] = {"status": "active", "mode": sim_mode}

    # Fleet status
    drone_svc = get_drones()
    drones = drone_svc.get_all() if drone_svc else []
    checks["fleet"] = {
        "total_drones": len(drones),
        "available": len([d for d in drones if d.status.value == "idle"]),
    }

    overall = "healthy" if all(
        c.get("status") not in ("error",) for c in checks.values()
    ) else "degraded"

    return {
        "status": overall,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "uptime_seconds": round(time.time() - APP_START_TIME),
        "version": "2.0.0",
        "dependencies": checks,
    }


@router.get("/api/locations")
def get_locations():
    return {"locations": LOCATIONS, "valid_names": list(LOCATIONS.keys())}


@router.post("/api/parse-task")
def parse_task(req: ParseTaskRequest, ai=Depends(get_ai)):
    try:
        result = ai.parse_task(req.user_input)
        return {"task": result}
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI parsing failed: {e}")


@router.post("/api/compute-route")
def api_compute_route(req: ComputeRouteRequest):
    for loc in req.locations:
        if loc not in VALID_LOCATIONS:
            raise HTTPException(status_code=400, detail=f"Unknown location: {loc}")
    result = compute_route(req.locations, req.priorities, num_drones=req.num_drones)
    return {"route": result}


@router.post("/api/recompute-route")
def api_recompute_route(req: RecomputeRouteRequest):
    result = recompute_route(
        req.current_location, req.remaining_locations,
        req.new_locations, req.priorities,
    )
    return {"route": result}


@router.get("/api/weather")
def api_get_weather():
    return {"weather": get_all_location_weather()}


@router.post("/api/simulate-weather")
def api_simulate_weather(req: SimulateWeatherRequest):
    event = simulate_weather_event(req.event_type, req.affected_locations or None)
    return {"event": event, "all_weather": get_all_location_weather()}


@router.post("/api/clear-weather")
def api_clear_weather():
    clear_weather_overrides()
    return {"status": "cleared", "all_weather": get_all_location_weather()}


@router.get("/api/no-fly-zones")
def api_get_no_fly_zones():
    return {"zones": get_no_fly_zones()}


@router.post("/api/check-route-safety")
def api_check_route_safety(req: CheckRouteSafetyRequest):
    violations = check_route_safety(req.route)
    return {"safe": len(violations) == 0, "violations": violations}


@router.post("/api/start-delivery")
def api_start_delivery(req: StartDeliveryRequest):
    """Execute a delivery route synchronously (frontend expects blocking response)."""
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
    return {
        "status": "completed",
        "visited": visited,
        "battery": drone.get_battery(),
        "flight_log": drone.get_flight_log(),
    }


@router.post("/api/metrics")
def api_compute_metrics(req: MetricsRequest):
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


@router.get("/api/naive-baseline")
def api_naive_baseline(locations: str):
    loc_list = [loc.strip() for loc in locations.split(",")]
    return {"baseline": compute_naive_baseline(loc_list)}


@router.post("/api/chat")
def api_chat(req: ChatRequest, ai=Depends(get_ai)):
    try:
        reply = ai.chat(req.message, req.context)
        return {"reply": reply}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Chat failed: {e}")


@router.post("/api/generate-report")
def api_generate_report(req: GenerateReportRequest, ai=Depends(get_ai)):
    try:
        report = ai.generate_report(req.metrics, req.mission_summary)
        return {"report": report}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Report generation failed: {e}")


@router.post("/api/weather-briefing")
def api_weather_briefing(ai=Depends(get_ai)):
    try:
        weather_data = get_all_location_weather()
        briefing = ai.weather_briefing(weather_data)
        return {"briefing": briefing}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Weather briefing failed: {e}")


@router.post("/api/risk-score")
def api_risk_score(req: RiskScoreRequest, ai=Depends(get_ai)):
    try:
        result = ai.risk_score(req.route, req.weather, req.battery, req.payload_priority)
        return {"risk": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Risk scoring failed: {e}")


@router.post("/api/narrate")
def api_narrate(req: NarrateRequest, ai=Depends(get_ai)):
    try:
        narration = ai.narrate_event(req.event, req.context)
        return {"narration": narration}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Narration failed: {e}")


@router.post("/api/payload-status")
def api_payload_status(req: PayloadStatusRequest):
    from backend.services.payload_service import compute_payload_status
    return compute_payload_status(
        payload_type=req.payload_type,
        elapsed_minutes=req.elapsed_minutes,
        wind_speed=req.conditions.get("wind", 0),
    )


@router.post("/api/mission-comparison")
def api_mission_comparison(req: MissionComparisonRequest):
    drone_time = req.route.get("estimated_time", 180) / 60
    return {
        "comparison": {
            "drone": {"time_minutes": round(drone_time, 1), "cost_gbp": 340, "available": True},
            "helicopter": {"time_minutes": round(drone_time * 1.5, 1), "cost_gbp": 8200, "available": False},
            "ambulance": {"time_minutes": round(drone_time * 5, 1), "cost_gbp": 180, "available": True},
        }
    }


@router.post("/api/confirm-delivery")
def api_confirm_delivery(req: ConfirmDeliveryRequest):
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


@router.get("/api/facilities")
def api_facilities(
    query: str = Query("", description="Search by name"),
    region: str = Query("", description="Filter by region"),
    limit: int = Query(489, ge=1, le=500),
):
    return search_facilities(query=query, region=region, limit=limit)
