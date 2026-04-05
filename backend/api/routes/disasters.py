"""DroneMedic — Disaster intelligence API routes."""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from backend.services.disaster_service import DisasterIntelligenceService

router = APIRouter(tags=["disasters"])

# Module-level singleton (created once, shared across requests)
_disaster_service = DisasterIntelligenceService()


def get_disaster_service() -> DisasterIntelligenceService:
    """Expose the singleton for use by other modules (e.g. mission_service)."""
    return _disaster_service


class InjectDisasterRequest(BaseModel):
    disaster_type: str  # wildfires, severeStorms, earthquakes, floods, military
    lat: float
    lon: float


@router.get("/api/disasters/active")
async def get_active_threats() -> dict:
    """Get all active disaster threats."""
    threats = _disaster_service.get_active_threats()
    return {"threats": threats, "count": len(threats)}


@router.post("/api/disasters/inject")
async def inject_disaster(req: InjectDisasterRequest) -> dict:
    """Inject a simulated disaster for demo."""
    result = _disaster_service.inject_demo_disaster(
        req.disaster_type, req.lat, req.lon
    )
    return {"status": "injected", "threat": result}


@router.post("/api/disasters/clear")
async def clear_disasters() -> dict:
    """Clear all demo disasters."""
    _disaster_service.clear_demo_threats()
    return {"status": "cleared"}


@router.get("/api/disasters/eonet")
async def fetch_eonet_events(days: int = 30, limit: int = 20) -> dict:
    """Fetch real EONET events from NASA."""
    events = await _disaster_service.poll_eonet(days=days, limit=limit)
    # Convert to threat zones
    threats = []
    for event in events:
        zone = _disaster_service.event_to_threat_zone(event)
        if zone:
            threats.append(zone)
    return {"events": events, "threat_zones": threats, "count": len(threats)}
