"""DroneMedic — Pydantic domain models."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, Field

from backend.domain.enums import (
    DeliveryStatus, DroneStatus, EventSource, EventType, MissionStatus,
)


# ── Helpers ────────────────────────────────────────────────────────────

def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _new_id() -> str:
    return uuid.uuid4().hex[:12]


# ── Core Domain Models ─────────────────────────────────────────────────

class Waypoint(BaseModel):
    location_name: str
    coordinates: dict = Field(default_factory=dict)  # {x, y, z, lat, lon}
    is_depot: bool = False
    reached: bool = False
    reached_at: datetime | None = None
    eta_seconds: float | None = None


class Drone(BaseModel):
    id: str
    status: DroneStatus = DroneStatus.idle
    battery: float = 100.0
    position: dict = Field(default_factory=lambda: {"x": 0.0, "y": 0.0, "z": 0.0})
    current_location: str = "Depot"
    current_mission_id: str | None = None
    payload: str | None = None
    speed: float = 0.0
    altitude: float = 0.0


class Mission(BaseModel):
    id: str = Field(default_factory=_new_id)
    status: MissionStatus = MissionStatus.planning
    drone_id: str = ""
    delivery_ids: list[str] = Field(default_factory=list)
    planned_route: list[str] = Field(default_factory=list)
    waypoints: list[Waypoint] = Field(default_factory=list)
    current_waypoint_index: int = 0
    reroute_count: int = 0
    route_distance: float = 0
    battery_usage: float = 0
    estimated_time: int = 0
    created_at: datetime = Field(default_factory=_utcnow)
    started_at: datetime | None = None
    completed_at: datetime | None = None
    failed_reason: str | None = None


class Delivery(BaseModel):
    id: str = Field(default_factory=_new_id)
    destination: str
    supply: str = ""
    priority: Literal["high", "normal"] = "normal"
    time_window_minutes: int | None = None
    recipient: str | None = None           # "Dr. Amara Osei"
    recipient_role: str | None = None      # "Trauma Surgeon"
    patient_count: int | None = None       # 3
    status: DeliveryStatus = DeliveryStatus.pending
    assigned_drone: str | None = None
    assigned_mission: str | None = None
    created_at: datetime = Field(default_factory=_utcnow)
    delivered_at: datetime | None = None


class TelemetrySnapshot(BaseModel):
    drone_id: str
    position: dict = Field(default_factory=dict)
    battery: float = 100.0
    speed: float = 0.0
    altitude: float = 0.0
    timestamp: datetime = Field(default_factory=_utcnow)


class Event(BaseModel):
    id: str = Field(default_factory=_new_id)
    type: EventType
    data: dict = Field(default_factory=dict)
    source: EventSource = EventSource.system
    timestamp: datetime = Field(default_factory=_utcnow)


# ── Request Schemas ────────────────────────────────────────────────────

class DeliveryItem(BaseModel):
    destination: str
    supply: str = ""
    priority: Literal["high", "normal"] = "normal"
    time_window_minutes: int | None = None
    recipient: str | None = None
    recipient_role: str | None = None
    patient_count: int | None = None


class CreateBatchRequest(BaseModel):
    deliveries: list[DeliveryItem]


class RerouteRequest(BaseModel):
    reason: str = ""
    new_deliveries: list[DeliveryItem] | None = None


class WeatherEventRequest(BaseModel):
    event_type: str
    locations: list[str]


class ScenarioRequest(BaseModel):
    scenario_name: str
    mission_id: str
