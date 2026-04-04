"""
DroneMedic - Mock Telemetry Generator

Generates realistic drone telemetry without PX4 SITL.
Simulates a drone flying between waypoints from config.py at realistic
speed with battery drain. Used by telemetry_bridge.py as a fallback.
"""

import asyncio
import logging
import math
import time
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger("DroneMedic.MockTelemetry")

# Depot origin for GPS → local conversion
_DEPOT_LAT = 51.5074
_DEPOT_LON = -0.1278

# Default waypoints (lat, lon, name) — loaded from config if available
_DEFAULT_WAYPOINTS: list[tuple[float, float, str]] = [
    (51.5074, -0.1278, "Depot"),
    (51.5124, -0.1200, "Clinic A"),
    (51.5174, -0.1350, "Clinic B"),
    (51.5044, -0.1100, "Clinic C"),
    (51.5000, -0.1400, "Clinic D"),
    (51.5074, -0.1278, "Depot"),  # return home
]


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in metres."""
    R = 6_371_000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return 2 * R * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _bearing_deg(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Initial bearing in degrees from point 1 to point 2."""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dlam = math.radians(lon2 - lon1)
    x = math.sin(dlam) * math.cos(phi2)
    y = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(dlam)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


def _lerp_gps(
    lat1: float, lon1: float, lat2: float, lon2: float, t: float
) -> tuple[float, float]:
    """Linear interpolation between two GPS points (good enough for <5 km)."""
    return (lat1 + (lat2 - lat1) * t, lon1 + (lon2 - lon1) * t)


@dataclass
class MockTelemetryState:
    """Mutable state for the mock flight simulation."""

    lat: float = _DEPOT_LAT
    lon: float = _DEPOT_LON
    alt_m: float = 0.0
    battery_pct: float = 100.0
    heading_deg: float = 0.0
    speed_m_s: float = 0.0
    is_armed: bool = False
    is_flying: bool = False
    flight_mode: str = "IDLE"
    current_waypoint_idx: int = 0
    segment_progress: float = 0.0  # 0..1 within current segment
    phase: str = "idle"  # idle, takeoff, transit, hover, land, complete
    waypoints: list[tuple[float, float, str]] = field(default_factory=list)


class MockTelemetrySource:
    """
    Generates mock telemetry that mimics a real PX4 drone.

    Usage:
        source = MockTelemetrySource()
        source.start_mission()  # begin automated flight
        while True:
            data = await source.get_telemetry()
    """

    def __init__(
        self,
        waypoints: Optional[list[tuple[float, float, str]]] = None,
        cruise_speed_ms: float = 15.0,
        cruise_alt_m: float = 30.0,
        battery_drain_per_m: float = 0.008,
        update_hz: float = 5.0,
    ) -> None:
        self._state = MockTelemetryState()
        self._state.waypoints = list(waypoints or _DEFAULT_WAYPOINTS)
        self._cruise_speed = cruise_speed_ms
        self._cruise_alt = cruise_alt_m
        self._drain_per_m = battery_drain_per_m
        self._interval = 1.0 / update_hz
        self._mission_active = False
        self._goto_target: Optional[tuple[float, float, float]] = None

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def start_mission(self) -> None:
        """Begin automated waypoint mission."""
        self._state.phase = "takeoff"
        self._state.current_waypoint_idx = 0
        self._state.segment_progress = 0.0
        self._state.is_armed = True
        self._state.flight_mode = "TAKEOFF"
        self._mission_active = True
        logger.info("Mock mission started")

    def command_takeoff(self) -> None:
        """Manual takeoff command."""
        self._state.phase = "takeoff"
        self._state.is_armed = True
        self._state.flight_mode = "TAKEOFF"

    def command_goto(self, lat: float, lon: float, alt: float) -> None:
        """Manual goto command."""
        self._goto_target = (lat, lon, alt)
        self._state.flight_mode = "OFFBOARD"

    def command_land(self) -> None:
        """Manual land command."""
        self._state.phase = "land"
        self._state.flight_mode = "LAND"

    def command_hold(self) -> None:
        """Hold / hover at current position."""
        self._state.phase = "hover"
        self._state.flight_mode = "HOLD"
        self._state.speed_m_s = 0.0

    async def get_telemetry(self) -> dict:
        """Advance simulation by one tick and return telemetry dict."""
        await asyncio.sleep(self._interval)
        self._tick()
        return {
            "type": "telemetry",
            "source": "mock",
            "lat": round(self._state.lat, 7),
            "lon": round(self._state.lon, 7),
            "alt_m": round(self._state.alt_m, 1),
            "relative_alt_m": round(self._state.alt_m, 1),
            "battery_pct": round(self._state.battery_pct, 1),
            "flight_mode": self._state.flight_mode,
            "is_armed": self._state.is_armed,
            "is_flying": self._state.is_flying,
            "heading_deg": round(self._state.heading_deg, 1),
            "speed_m_s": round(self._state.speed_m_s, 1),
            "timestamp": time.time(),
        }

    # ------------------------------------------------------------------
    # Simulation tick
    # ------------------------------------------------------------------

    def _tick(self) -> None:
        dt = self._interval
        phase = self._state.phase

        if phase == "idle":
            return

        if phase == "takeoff":
            self._tick_takeoff(dt)
        elif phase == "transit":
            self._tick_transit(dt)
        elif phase == "hover":
            pass  # hold position
        elif phase == "land":
            self._tick_land(dt)
        elif phase == "complete":
            pass

    def _tick_takeoff(self, dt: float) -> None:
        climb_rate = 3.0  # m/s
        self._state.alt_m += climb_rate * dt
        self._state.speed_m_s = climb_rate
        self._state.is_flying = True
        self._state.flight_mode = "TAKEOFF"

        if self._state.alt_m >= self._cruise_alt:
            self._state.alt_m = self._cruise_alt
            if self._mission_active:
                self._state.phase = "transit"
                self._state.segment_progress = 0.0
                self._state.flight_mode = "MISSION"
            elif self._goto_target:
                self._state.phase = "transit"
                self._state.flight_mode = "OFFBOARD"
            else:
                self._state.phase = "hover"
                self._state.flight_mode = "HOLD"
                self._state.speed_m_s = 0.0

    def _tick_transit(self, dt: float) -> None:
        wps = self._state.waypoints
        idx = self._state.current_waypoint_idx

        if self._goto_target:
            target_lat, target_lon, target_alt = self._goto_target
        elif idx + 1 < len(wps):
            target_lat, target_lon = wps[idx + 1][0], wps[idx + 1][1]
            target_alt = self._cruise_alt
        else:
            # No more waypoints
            self._state.phase = "land"
            self._state.flight_mode = "LAND"
            return

        # Distance and heading to target
        dist = _haversine_m(self._state.lat, self._state.lon, target_lat, target_lon)
        self._state.heading_deg = _bearing_deg(
            self._state.lat, self._state.lon, target_lat, target_lon
        )
        self._state.speed_m_s = self._cruise_speed

        # Move toward target
        move_dist = self._cruise_speed * dt
        if dist <= move_dist:
            # Arrived at waypoint
            self._state.lat = target_lat
            self._state.lon = target_lon
            self._state.alt_m = target_alt
            self._state.battery_pct -= dist * self._drain_per_m

            if self._goto_target:
                self._goto_target = None
                self._state.phase = "hover"
                self._state.flight_mode = "HOLD"
                self._state.speed_m_s = 0.0
            else:
                self._state.current_waypoint_idx = idx + 1
                self._state.segment_progress = 0.0
                if idx + 2 >= len(wps):
                    # Last waypoint reached
                    self._state.phase = "land"
                    self._state.flight_mode = "LAND"
                    logger.info("Mock mission: all waypoints reached, landing")
                else:
                    logger.info(f"Mock mission: arrived at {wps[idx + 1][2]}")
        else:
            # Interpolate position
            t = move_dist / dist
            new_lat, new_lon = _lerp_gps(
                self._state.lat, self._state.lon, target_lat, target_lon, t
            )
            self._state.battery_pct -= move_dist * self._drain_per_m
            self._state.lat = new_lat
            self._state.lon = new_lon

    def _tick_land(self, dt: float) -> None:
        descent_rate = 2.0  # m/s
        self._state.alt_m -= descent_rate * dt
        self._state.speed_m_s = descent_rate
        self._state.flight_mode = "LAND"

        if self._state.alt_m <= 0:
            self._state.alt_m = 0.0
            self._state.is_flying = False
            self._state.is_armed = False
            self._state.speed_m_s = 0.0
            self._state.phase = "complete"
            self._state.flight_mode = "IDLE"
            self._mission_active = False
            logger.info("Mock mission: landed")
