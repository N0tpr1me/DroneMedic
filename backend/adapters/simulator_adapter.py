"""DroneMedic — Simulator adapter.

The ONLY module that talks to DroneController.
After each command, pushes a TelemetrySnapshot to the TelemetryService.

Mode selection: DroneController auto-detects from config.py env vars:
  PX4_ENABLED=true  → PX4 SITL via MAVSDK
  AIRSIM_ENABLED=true → AirSim
  Neither → Mock mode
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from config import DRONE_NAMES
from backend.domain.errors import DroneNotFoundError
from backend.domain.models import TelemetrySnapshot
from backend.services.telemetry_service import TelemetryService
from simulation.drone_control import DroneController

logger = logging.getLogger("DroneMedic.SimAdapter")


class SimulatorAdapter:
    """Wraps DroneController instances. Pushes telemetry after every action."""

    def __init__(
        self,
        drone_names: list[str],
        telemetry_service: TelemetryService,
        mode: str | None = None,
    ) -> None:
        # Let DroneController auto-detect mode from config (PX4/AirSim/Mock)
        # unless an explicit mode override is passed.
        self._controllers: dict[str, DroneController] = {
            name: DroneController(mode=mode) for name in drone_names
        }
        self._telemetry = telemetry_service
        resolved = next(iter(self._controllers.values())).mode if self._controllers else "none"
        logger.info(f"SimulatorAdapter initialized: {len(drone_names)} drones, mode={resolved}")

    def _ctrl(self, drone_id: str) -> DroneController:
        ctrl = self._controllers.get(drone_id)
        if not ctrl:
            raise DroneNotFoundError(drone_id)
        return ctrl

    # ── Flight commands ────────────────────────────────────────────────

    def connect(self, drone_id: str) -> None:
        self._ctrl(drone_id).connect()

    def takeoff(self, drone_id: str) -> None:
        self._ctrl(drone_id).takeoff()
        self._push_telemetry(drone_id)

    def move_to(self, drone_id: str, location: str) -> bool:
        result = self._ctrl(drone_id).move_to(location)
        self._push_telemetry(drone_id)
        return result

    def pause(self, drone_id: str) -> None:
        self._ctrl(drone_id).pause()

    def resume(self, drone_id: str) -> None:
        self._ctrl(drone_id).resume()

    def land(self, drone_id: str) -> None:
        self._ctrl(drone_id).land()
        self._push_telemetry(drone_id)

    # ── Queries (read from controller — source of truth) ──────────────

    def get_position(self, drone_id: str) -> dict:
        return self._ctrl(drone_id).get_position()

    def get_battery(self, drone_id: str) -> float:
        return self._ctrl(drone_id).get_battery()

    def get_current_location(self, drone_id: str) -> str:
        return self._ctrl(drone_id).get_current_location()

    def check_battery_for_return(self, drone_id: str) -> bool:
        return self._ctrl(drone_id).check_battery_for_return()

    def get_flight_log(self, drone_id: str) -> list[dict]:
        return self._ctrl(drone_id).get_flight_log()

    # ── Telemetry push ─────────────────────────────────────────────────

    def _push_telemetry(self, drone_id: str) -> None:
        """Read current state from controller and push to TelemetryService."""
        ctrl = self._ctrl(drone_id)
        snapshot = TelemetrySnapshot(
            drone_id=drone_id,
            position=ctrl.get_position(),
            battery=ctrl.get_battery(),
            timestamp=datetime.now(timezone.utc),
        )
        self._telemetry.push(snapshot)
