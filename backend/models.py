"""
DroneMedic - Pydantic Models

Data models for the API and scheduler. Lean and practical —
only what's needed for request/response validation and state tracking.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field


# ── Enums ──────────────────────────────────────────────────────────────

class DeliveryStatus(str, Enum):
    PENDING = "pending"
    ASSIGNED = "assigned"
    IN_TRANSIT = "in_transit"
    DELIVERED = "delivered"
    FAILED = "failed"


class DroneStatus(str, Enum):
    IDLE = "idle"
    FLYING = "flying"
    PAUSED = "paused"
    RETURNING = "returning"
    LOW_BATTERY = "low_battery"


class MissionStatus(str, Enum):
    PLANNING = "planning"
    IN_PROGRESS = "in_progress"
    PAUSED = "paused"
    COMPLETED = "completed"
    FAILED = "failed"
    REASSIGNED = "reassigned"


# ── Core Models ────────────────────────────────────────────────────────

def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _new_id() -> str:
    return uuid.uuid4().hex[:12]


class Delivery(BaseModel):
    id: str = Field(default_factory=_new_id)
    destination: str
    supply: str = ""
    priority: Literal["high", "normal"] = "normal"
    time_window_minutes: int | None = None  # delivery deadline in minutes from mission start
    status: DeliveryStatus = DeliveryStatus.PENDING
    assigned_drone: str | None = None
    created_at: datetime = Field(default_factory=_utcnow)
    delivered_at: datetime | None = None


class DroneState(BaseModel):
    id: str
    status: DroneStatus = DroneStatus.IDLE
    battery: float = 100.0
    current_location: str = "Depot"
    current_mission_id: str | None = None


class Mission(BaseModel):
    id: str = Field(default_factory=_new_id)
    delivery_ids: list[str] = Field(default_factory=list)
    drone_id: str = ""
    route: list[str] = Field(default_factory=list)
    status: MissionStatus = MissionStatus.PLANNING
    route_distance: float = 0
    battery_usage: float = 0
    estimated_time: int = 0
    reroute_count: int = 0
    created_at: datetime = Field(default_factory=_utcnow)
    failed_reason: str | None = None


# ── Request / Response Schemas ─────────────────────────────────────────

class DeliveryItem(BaseModel):
    destination: str
    supply: str = ""
    priority: Literal["high", "normal"] = "normal"
    time_window_minutes: int | None = None  # e.g. 30 = must deliver within 30 min


class CreateBatchRequest(BaseModel):
    deliveries: list[DeliveryItem]


class RerouteRequest(BaseModel):
    reason: str = ""
    new_deliveries: list[DeliveryItem] | None = None


class WeatherEventRequest(BaseModel):
    event_type: str  # storm, high_wind, light_rain, clear
    locations: list[str]


class ScenarioRequest(BaseModel):
    scenario_name: str  # weather_disruption, low_battery, multi_event
    mission_id: str
