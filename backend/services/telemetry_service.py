"""DroneMedic — Telemetry ingestion service.

Single write path from SimulatorAdapter → DroneService cache.
"""

from __future__ import annotations

from backend.domain.models import TelemetrySnapshot
from backend.services.drone_service import DroneService
from backend.services.event_service import EventService


class TelemetryService:

    def __init__(self, drone_service: DroneService, event_service: EventService) -> None:
        self._drone_service = drone_service
        self._events = event_service

    def push(self, snapshot: TelemetrySnapshot) -> None:
        """Receive telemetry from the simulator adapter and update drone cache."""
        self._drone_service.update_from_telemetry(snapshot)
