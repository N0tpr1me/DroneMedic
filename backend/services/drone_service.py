"""DroneMedic — Drone state cache service.

The simulator/controller is the source of truth for live telemetry.
This service stores the latest cached snapshot for API/UI/logging.
"""

from __future__ import annotations

import asyncio
import logging

from config import SUPABASE_URL
from backend.domain.enums import DroneStatus, EventType
from backend.domain.errors import DroneNotFoundError
from backend.domain.models import Drone, TelemetrySnapshot
from backend.services.event_service import EventService

logger = logging.getLogger("DroneMedic.DroneService")


def _db_enabled() -> bool:
    return bool(SUPABASE_URL)


def _persist(coro) -> None:
    if not _db_enabled():
        return
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(coro)
    except RuntimeError:
        try:
            _loop = asyncio.new_event_loop()
            _loop.run_until_complete(coro)
            _loop.close()
        except Exception:
            pass


class DroneService:

    def __init__(self, drone_names: list[str], event_service: EventService) -> None:
        self._drones: dict[str, Drone] = {
            name: Drone(id=name) for name in drone_names
        }
        self._events = event_service

    # ── Queries ────────────────────────────────────────────────────────

    def get(self, drone_id: str) -> Drone:
        drone = self._drones.get(drone_id)
        if not drone:
            raise DroneNotFoundError(drone_id)
        return drone

    def get_all(self) -> list[Drone]:
        return list(self._drones.values())

    def get_available(self) -> list[Drone]:
        return [d for d in self._drones.values() if d.status == DroneStatus.idle]

    # ── Mutations ──────────────────────────────────────────────────────

    def update_from_telemetry(self, snapshot: TelemetrySnapshot) -> None:
        """Merge live telemetry from simulator into cached drone state."""
        drone = self._drones.get(snapshot.drone_id)
        if not drone:
            return
        drone.position = snapshot.position
        drone.battery = snapshot.battery
        drone.speed = snapshot.speed
        drone.altitude = snapshot.altitude
        self._events.publish(EventType.drone_position_updated, {
            "drone_id": drone.id,
            "position": snapshot.position,
            "battery": snapshot.battery,
            "current_location": drone.current_location,
            "speed": snapshot.speed,
        })

        # Persist telemetry snapshot to Supabase
        from backend.db import repository as repo
        _persist(repo.save_telemetry(snapshot.model_dump(mode="json")))

    def set_status(self, drone_id: str, status: DroneStatus) -> None:
        drone = self.get(drone_id)
        old = drone.status
        drone.status = status
        if old != status:
            self._events.publish(EventType.drone_status_changed, {
                "drone_id": drone_id,
                "old_status": old.value,
                "new_status": status.value,
            })
            if status == DroneStatus.emergency:
                logger.warning(f"[DRONE] {drone_id} entered EMERGENCY state")

            # Persist drone status change
            from backend.db import repository as repo
            _persist(repo.update_drone(drone_id, {"status": status.value}))

    def set_location(self, drone_id: str, location: str) -> None:
        self.get(drone_id).current_location = location

    def set_mission(self, drone_id: str, mission_id: str | None) -> None:
        self.get(drone_id).current_mission_id = mission_id

    def check_battery_low(self, drone_id: str, threshold: float = 25.0) -> bool:
        drone = self.get(drone_id)
        if drone.battery <= threshold:
            self._events.publish(EventType.drone_battery_low, {
                "drone_id": drone_id,
                "battery": drone.battery,
            })
            return True
        return False
