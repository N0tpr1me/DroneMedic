"""Detect anomalies in drone telemetry by comparing expected vs actual values."""

import logging
import math
import time
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)

EARTH_RADIUS_M = 6_371_000.0


@dataclass
class Anomaly:
    drone_id: int
    anomaly_type: str  # "battery_drain", "speed_deviation", "route_deviation", "signal_loss"
    severity: str  # "warning", "critical"
    message: str
    expected_value: float
    actual_value: float
    deviation_ratio: float
    timestamp: float = 0.0


class TelemetryBaseline:
    """Compare live telemetry against expected baselines and flag anomalies.

    Thresholds
    ----------
    * **warning_ratio** – deviation ratio at which a *warning* is raised
      (default 1.5 = 50 % above expected).
    * **critical_ratio** – deviation ratio at which a *critical* alert is
      raised (default 2.0 = 100 % above expected).
    """

    def __init__(
        self,
        expected_drain_per_meter: float = 0.08,
        expected_speed_ms: float = 15.0,
        warning_ratio: float = 1.5,
        critical_ratio: float = 2.0,
    ) -> None:
        self.expected_drain = expected_drain_per_meter
        self.expected_speed = expected_speed_ms
        self.warning_ratio = warning_ratio
        self.critical_ratio = critical_ratio
        self._anomaly_log: list[Anomaly] = []
        self._last_heartbeat: dict[int, float] = {}

    # ------------------------------------------------------------------
    # Individual checks
    # ------------------------------------------------------------------

    def check_battery_drain(
        self,
        drone_id: int,
        distance_m: float,
        battery_start: float,
        battery_now: float,
    ) -> Optional[Anomaly]:
        """Flag abnormal battery consumption over a given distance.

        Returns an ``Anomaly`` if the actual drain exceeds expected by
        more than ``warning_ratio``, else ``None``.
        """
        if distance_m <= 0:
            return None

        actual_drain = battery_start - battery_now
        expected_drain = distance_m * self.expected_drain
        if expected_drain <= 0:
            return None

        ratio = actual_drain / expected_drain
        if ratio < self.warning_ratio:
            return None

        severity = "critical" if ratio >= self.critical_ratio else "warning"
        anomaly = Anomaly(
            drone_id=drone_id,
            anomaly_type="battery_drain",
            severity=severity,
            message=(
                f"Drone {drone_id}: battery drain {actual_drain:.1f}% over "
                f"{distance_m:.0f}m is {ratio:.1f}x expected ({expected_drain:.1f}%)"
            ),
            expected_value=round(expected_drain, 2),
            actual_value=round(actual_drain, 2),
            deviation_ratio=round(ratio, 2),
            timestamp=time.time(),
        )
        self._anomaly_log.append(anomaly)
        logger.warning(anomaly.message)
        return anomaly

    def check_speed(
        self, drone_id: int, actual_speed: float
    ) -> Optional[Anomaly]:
        """Flag speed that deviates significantly from the expected cruise speed."""
        if self.expected_speed <= 0:
            return None

        ratio = actual_speed / self.expected_speed
        # We care about both too fast and too slow
        deviation = max(ratio, 1 / ratio) if ratio > 0 else float("inf")

        if deviation < self.warning_ratio:
            return None

        severity = "critical" if deviation >= self.critical_ratio else "warning"
        anomaly = Anomaly(
            drone_id=drone_id,
            anomaly_type="speed_deviation",
            severity=severity,
            message=(
                f"Drone {drone_id}: speed {actual_speed:.1f} m/s "
                f"deviates {deviation:.1f}x from expected {self.expected_speed:.1f} m/s"
            ),
            expected_value=round(self.expected_speed, 2),
            actual_value=round(actual_speed, 2),
            deviation_ratio=round(deviation, 2),
            timestamp=time.time(),
        )
        self._anomaly_log.append(anomaly)
        logger.warning(anomaly.message)
        return anomaly

    def check_route_deviation(
        self,
        drone_id: int,
        expected_lat: float,
        expected_lon: float,
        actual_lat: float,
        actual_lon: float,
        threshold_m: float = 100.0,
    ) -> Optional[Anomaly]:
        """Flag if the drone drifts more than *threshold_m* from where it
        should be on its planned route."""
        dist = self._haversine_m(expected_lat, expected_lon, actual_lat, actual_lon)

        if dist < threshold_m:
            return None

        ratio = dist / threshold_m
        severity = "critical" if ratio >= self.critical_ratio else "warning"
        anomaly = Anomaly(
            drone_id=drone_id,
            anomaly_type="route_deviation",
            severity=severity,
            message=(
                f"Drone {drone_id}: {dist:.0f}m off planned route "
                f"(threshold {threshold_m:.0f}m, ratio {ratio:.1f}x)"
            ),
            expected_value=round(threshold_m, 2),
            actual_value=round(dist, 2),
            deviation_ratio=round(ratio, 2),
            timestamp=time.time(),
        )
        self._anomaly_log.append(anomaly)
        logger.warning(anomaly.message)
        return anomaly

    def check_signal_loss(
        self,
        drone_id: int,
        timeout_s: float = 10.0,
    ) -> Optional[Anomaly]:
        """Flag if no heartbeat has been received within *timeout_s* seconds."""
        last = self._last_heartbeat.get(drone_id)
        if last is None:
            # First call — just record the timestamp
            self._last_heartbeat[drone_id] = time.time()
            return None

        gap = time.time() - last
        if gap < timeout_s:
            return None

        ratio = gap / timeout_s
        severity = "critical" if ratio >= self.critical_ratio else "warning"
        anomaly = Anomaly(
            drone_id=drone_id,
            anomaly_type="signal_loss",
            severity=severity,
            message=(
                f"Drone {drone_id}: no heartbeat for {gap:.1f}s "
                f"(timeout {timeout_s:.1f}s, ratio {ratio:.1f}x)"
            ),
            expected_value=round(timeout_s, 2),
            actual_value=round(gap, 2),
            deviation_ratio=round(ratio, 2),
            timestamp=time.time(),
        )
        self._anomaly_log.append(anomaly)
        logger.warning(anomaly.message)
        return anomaly

    def record_heartbeat(self, drone_id: int) -> None:
        """Record that a heartbeat was received from *drone_id*."""
        self._last_heartbeat[drone_id] = time.time()

    # ------------------------------------------------------------------
    # Aggregate check
    # ------------------------------------------------------------------

    def check_all(self, drone_id: int, telemetry: dict) -> list[Anomaly]:
        """Run every available check against a telemetry snapshot.

        Expected keys in *telemetry*::

            {
                "distance_m": float,
                "battery_start": float,
                "battery_now": float,
                "speed_ms": float,
                "expected_lat": float,
                "expected_lon": float,
                "actual_lat": float,
                "actual_lon": float,
            }

        Missing keys are silently skipped so partial telemetry still works.
        """
        anomalies: list[Anomaly] = []

        # Battery drain
        if all(k in telemetry for k in ("distance_m", "battery_start", "battery_now")):
            a = self.check_battery_drain(
                drone_id,
                telemetry["distance_m"],
                telemetry["battery_start"],
                telemetry["battery_now"],
            )
            if a is not None:
                anomalies.append(a)

        # Speed
        if "speed_ms" in telemetry:
            a = self.check_speed(drone_id, telemetry["speed_ms"])
            if a is not None:
                anomalies.append(a)

        # Route deviation
        if all(
            k in telemetry
            for k in ("expected_lat", "expected_lon", "actual_lat", "actual_lon")
        ):
            threshold = telemetry.get("route_threshold_m", 100.0)
            a = self.check_route_deviation(
                drone_id,
                telemetry["expected_lat"],
                telemetry["expected_lon"],
                telemetry["actual_lat"],
                telemetry["actual_lon"],
                threshold_m=threshold,
            )
            if a is not None:
                anomalies.append(a)

        # Signal loss (always checked)
        a = self.check_signal_loss(drone_id)
        if a is not None:
            anomalies.append(a)

        # Record heartbeat for this drone (telemetry arrived = alive)
        self.record_heartbeat(drone_id)

        return anomalies

    # ------------------------------------------------------------------
    # Log access
    # ------------------------------------------------------------------

    def get_anomaly_log(self) -> list[Anomaly]:
        """Return a copy of the full anomaly history."""
        return list(self._anomaly_log)

    # ------------------------------------------------------------------
    # Geometry helper
    # ------------------------------------------------------------------

    @staticmethod
    def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        """Great-circle distance in metres between two lat/lon points."""
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

    baseline = TelemetryBaseline(
        expected_drain_per_meter=0.08,
        expected_speed_ms=15.0,
        warning_ratio=1.5,
        critical_ratio=2.0,
    )

    # 1. Battery drain — normal (should return None)
    result = baseline.check_battery_drain(drone_id=0, distance_m=100, battery_start=100, battery_now=92)
    print(f"Normal drain  → {result}")

    # 2. Battery drain — excessive (should trigger warning/critical)
    result = baseline.check_battery_drain(drone_id=0, distance_m=100, battery_start=100, battery_now=76)
    print(f"High drain    → {result}")

    # 3. Speed — normal
    result = baseline.check_speed(drone_id=1, actual_speed=14.0)
    print(f"Normal speed  → {result}")

    # 4. Speed — too fast
    result = baseline.check_speed(drone_id=1, actual_speed=35.0)
    print(f"Fast speed    → {result}")

    # 5. Route deviation — on track
    result = baseline.check_route_deviation(
        drone_id=2,
        expected_lat=51.5074, expected_lon=-0.1278,
        actual_lat=51.5074, actual_lon=-0.1277,
    )
    print(f"On route      → {result}")

    # 6. Route deviation — off track (~560m away)
    result = baseline.check_route_deviation(
        drone_id=2,
        expected_lat=51.5074, expected_lon=-0.1278,
        actual_lat=51.5124, actual_lon=-0.1200,
    )
    print(f"Off route     → {result}")

    # 7. Aggregate check
    telemetry = {
        "distance_m": 200,
        "battery_start": 100,
        "battery_now": 60,
        "speed_ms": 40.0,
        "expected_lat": 51.5074,
        "expected_lon": -0.1278,
        "actual_lat": 51.5124,
        "actual_lon": -0.1200,
    }
    anomalies = baseline.check_all(drone_id=3, telemetry=telemetry)
    print(f"\n--- Aggregate check ({len(anomalies)} anomalies) ---")
    for a in anomalies:
        print(f"  [{a.severity}] {a.anomaly_type}: {a.message}")

    # 8. Full log
    print(f"\n--- Anomaly log ({len(baseline.get_anomaly_log())} total) ---")
    for a in baseline.get_anomaly_log():
        print(f"  [{a.severity}] drone-{a.drone_id} {a.anomaly_type} (ratio={a.deviation_ratio})")
