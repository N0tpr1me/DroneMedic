"""DroneMedic — Simulation routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from backend.api.dependencies import get_events, get_scenarios
from backend.domain.models import WeatherEventRequest, ScenarioRequest
from backend.domain.enums import EventType, EventSource
from backend.domain.errors import DomainError
from backend.weather_service import simulate_weather_event

router = APIRouter(tags=["Simulation"])


@router.post("/api/simulate/weather")
def simulate_weather(req: WeatherEventRequest):
    result = simulate_weather_event(req.event_type, req.locations)
    return result


@router.post("/api/simulate/obstacle")
def simulate_obstacle(
    body: dict | None = None,
    event_service=Depends(get_events),
):
    event_service.publish(
        EventType.obstacle_detected,
        body or {"description": "Simulated obstacle detected"},
        source=EventSource.manual,
    )
    return {"status": "obstacle_event_published"}


@router.post("/api/simulate/scenario")
def simulate_scenario(
    req: ScenarioRequest,
    scenario_service=Depends(get_scenarios),
):
    try:
        result = scenario_service.run_scenario(req.scenario_name, req.mission_id)
        return result
    except DomainError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
