"""Multi-drone airspace deconfliction to prevent mid-air collisions."""

import logging
import math
import time
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)

EARTH_RADIUS_M = 6_371_000.0


@dataclass
class DroneState:
    drone_id: str
    lat: float
    lon: float
    alt_m: float
    heading_deg: float = 0.0
    speed_ms: float = 0.0
    last_update: float = 0.0  # timestamp


@dataclass
class ConflictAlert:
    drone_a: str
    drone_b: str
    horizontal_dist_m: float
    vertical_dist_m: float
    severity: str  # "warning", "critical"
    resolution: str  # "hold_a", "altitude_change", "reroute"


class AirspaceManager:
    """Tracks all active drones and detects / resolves proximity conflicts."""

    def __init__(
        self,
        safety_radius_m: float = 50.0,
        vertical_sep_m: float = 30.0,
    ) -> None:
        self._safety_radius = safety_radius_m
        self._vertical_sep = vertical_sep_m
        self._drones: dict[str, DroneState] = {}
        self._altitude_layers: dict[str, float] = {}

    # ------------------------------------------------------------------
    # Registration helpers
    # ------------------------------------------------------------------

    def register_drone(
        self, drone_id: str, lat: float, lon: float, alt_m: float
    ) -> None:
        """Register a new drone in the airspace."""
        state = DroneState(
            drone_id=drone_id,
            lat=lat,
            lon=lon,
            alt_m=alt_m,
            last_update=time.time(),
        )
        self._drones[drone_id] = state
        self._altitude_layers[drone_id] = alt_m
        logger.info("Registered drone %s at (%.6f, %.6f, %.1fm)", drone_id, lat, lon, alt_m)

    def update_position(
        self, drone_id: str, lat: float, lon: float, alt_m: float
    ) -> None:
        """Update the position of an already-registered drone."""
        if drone_id not in self._drones:
            logger.warning("update_position called for unknown drone %s – registering", drone_id)
            self.register_drone(drone_id, lat, lon, alt_m)
            return
        state = self._drones[drone_id]
        # Build a new DroneState (immutable-style update)
        self._drones[drone_id] = DroneState(
            drone_id=drone_id,
            lat=lat,
            lon=lon,
            alt_m=alt_m,
            heading_deg=state.heading_deg,
            speed_ms=state.speed_ms,
            last_update=time.time(),
        )

    def unregister_drone(self, drone_id: str) -> None:
        """Remove a drone from the airspace tracker."""
        removed = self._drones.pop(drone_id, None)
        self._altitude_layers.pop(drone_id, None)
        if removed:
            logger.info("Unregistered drone %s", drone_id)
        else:
            logger.warning("Attempted to unregister unknown drone %s", drone_id)

    # ------------------------------------------------------------------
    # Conflict detection
    # ------------------------------------------------------------------

    def check_conflict(
        self,
        drone_id: str,
        target_lat: float,
        target_lon: float,
        target_alt: float,
    ) -> list[ConflictAlert]:
        """Check whether *drone_id* moving to the target position would
        violate separation minima with any other drone.

        Returns a list of ``ConflictAlert`` objects (empty if safe).
        """
        alerts: list[ConflictAlert] = []

        for other_id, other_state in self._drones.items():
            if other_id == drone_id:
                continue

            h_dist = self._haversine_m(target_lat, target_lon, other_state.lat, other_state.lon)
            v_dist = abs(target_alt - other_state.alt_m)

            if h_dist < self._safety_radius and v_dist < self._vertical_sep:
                severity = "critical" if h_dist < self._safety_radius / 2 else "warning"

                # Pick the simplest resolution strategy
                if v_dist < self._vertical_sep:
                    resolution = "altitude_change"
                else:
                    resolution = "hold_a"

                alert = ConflictAlert(
                    drone_a=drone_id,
                    drone_b=other_id,
                    horizontal_dist_m=round(h_dist, 2),
                    vertical_dist_m=round(v_dist, 2),
                    severity=severity,
                    resolution=resolution,
                )
                alerts.append(alert)
                logger.warning(
                    "Conflict detected: %s ↔ %s  h=%.1fm  v=%.1fm  severity=%s",
                    drone_id,
                    other_id,
                    h_dist,
                    v_dist,
                    severity,
                )

        return alerts

    # ------------------------------------------------------------------
    # Conflict resolution
    # ------------------------------------------------------------------

    def resolve_conflict(self, alert: ConflictAlert) -> dict:
        """Return an action dict that the flight controller can execute.

        Strategies (in priority order):
        1. **altitude_change** – assign the lower-priority drone to the next
           free altitude layer (30 m increments).
        2. **hold_a** – instruct drone_a to hover in place until drone_b
           clears the area.
        3. **reroute** – flag that a full re-plan is needed (fallback).
        """
        if alert.resolution == "altitude_change":
            new_alt = self.assign_altitude_layer(alert.drone_a)
            logger.info(
                "Resolving conflict: moving %s to altitude %.1fm",
                alert.drone_a,
                new_alt,
            )
            return {
                "action": "altitude_change",
                "details": {
                    "drone_id": alert.drone_a,
                    "new_altitude_m": new_alt,
                },
            }

        if alert.resolution == "hold_a":
            logger.info("Resolving conflict: holding %s in place", alert.drone_a)
            return {
                "action": "hold",
                "details": {
                    "drone_id": alert.drone_a,
                    "hold_seconds": 10,
                },
            }

        # Fallback: reroute
        logger.info("Resolving conflict: requesting reroute for %s", alert.drone_a)
        return {
            "action": "reroute",
            "details": {
                "drone_id": alert.drone_a,
                "reason": f"proximity to {alert.drone_b}",
            },
        }

    # ------------------------------------------------------------------
    # Altitude-layer management
    # ------------------------------------------------------------------

    def assign_altitude_layer(self, drone_id: str) -> float:
        """Assign a unique altitude layer to *drone_id*.

        Layers are spaced by ``_vertical_sep`` metres starting at the
        separation minimum (e.g. 30 m, 60 m, 90 m …).
        """
        occupied = {
            alt for did, alt in self._altitude_layers.items() if did != drone_id
        }

        layer = self._vertical_sep
        while layer in occupied:
            layer += self._vertical_sep

        self._altitude_layers[drone_id] = layer

        # Update the stored drone state to reflect the new altitude
        if drone_id in self._drones:
            s = self._drones[drone_id]
            self._drones[drone_id] = DroneState(
                drone_id=s.drone_id,
                lat=s.lat,
                lon=s.lon,
                alt_m=layer,
                heading_deg=s.heading_deg,
                speed_ms=s.speed_ms,
                last_update=time.time(),
            )

        logger.info("Assigned altitude layer %.1fm to drone %s", layer, drone_id)
        return layer

    # ------------------------------------------------------------------
    # Queries
    # ------------------------------------------------------------------

    def get_all_positions(self) -> dict[str, DroneState]:
        """Return a snapshot (copy) of every tracked drone's state."""
        return dict(self._drones)

    # ------------------------------------------------------------------
    # Geometry
    # ------------------------------------------------------------------

    @staticmethod
    def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        """Return the great-circle distance in metres between two points."""
        lat1_r, lon1_r = math.radians(lat1), math.radians(lon1)
        lat2_r, lon2_r = math.radians(lat2), math.radians(lon2)

        dlat = lat2_r - lat1_r
        dlon = lon2_r - lon1_r

        a = (
            math.sin(dlat / 2) ** 2
            + math.cos(lat1_r) * math.cos(lat2_r) * math.sin(dlon / 2) ** 2
        )
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
        return EARTH_RADIUS_M * c


# ----------------------------------------------------------------------
# Quick self-test
# ----------------------------------------------------------------------
if __name__ == "__main__":
    logging.basicConfig(level=logging.DEBUG, format="%(levelname)s | %(message)s")

    mgr = AirspaceManager(safety_radius_m=100.0, vertical_sep_m=30.0)

    # Register two drones at nearby positions
    mgr.register_drone("drone-0", lat=51.5074, lon=-0.1278, alt_m=30.0)
    mgr.register_drone("drone-1", lat=51.5075, lon=-0.1277, alt_m=30.0)

    # Check if drone-0 flying towards drone-1 causes a conflict
    alerts = mgr.check_conflict("drone-0", target_lat=51.5075, target_lon=-0.1277, target_alt=30.0)
    print(f"\n--- Conflict alerts ({len(alerts)}) ---")
    for a in alerts:
        print(f"  {a}")
        resolution = mgr.resolve_conflict(a)
        print(f"  Resolution → {resolution}")

    # Assign altitude layers
    for did in ("drone-0", "drone-1", "drone-2"):
        if did not in mgr.get_all_positions():
            mgr.register_drone(did, lat=51.508, lon=-0.128, alt_m=30.0)
        alt = mgr.assign_altitude_layer(did)
        print(f"  {did} → {alt}m")

    # Verify positions
    print("\n--- All positions ---")
    for did, state in mgr.get_all_positions().items():
        print(f"  {did}: lat={state.lat:.6f} lon={state.lon:.6f} alt={state.alt_m:.1f}m")

    # Haversine sanity check (London to ~11m away)
    d = AirspaceManager._haversine_m(51.5074, -0.1278, 51.5075, -0.1277)
    print(f"\nHaversine test: {d:.2f}m (expect ~13m)")
