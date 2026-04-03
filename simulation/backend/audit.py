"""
DroneMedic - Delivery audit trail with chain of custody and cold-chain monitoring.

Tracks every delivery from request through departure, in-flight position,
temperature readings, reroutes, and final arrival or failure. Supports
JSON and CSV export for post-flight analysis and regulatory compliance.
"""

from __future__ import annotations

import csv
import json
import logging
import math
import os
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger("DroneMedic.Audit")


# ── Helpers ───────────────────────────────────────────────────────────

def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _short_id() -> str:
    return uuid.uuid4().hex[:8]


# ── Cold-Chain Temperature Simulation ─────────────────────────────────

def simulate_temperature(
    ambient_c: float = 20.0,
    insulation_factor: float = 0.95,
    target_c: float = 4.0,
    elapsed_minutes: float = 0.0,
) -> float:
    """
    Simulate cold-chain temperature drift over time.

    Medical supplies (vaccines, blood) must stay between 2-8 C.
    The insulated container slowly drifts toward ambient temperature.

    Args:
        ambient_c: Outside air temperature in Celsius.
        insulation_factor: 0-1 where 1.0 = perfect insulation, 0.0 = no insulation.
        target_c: Starting / target internal temperature.
        elapsed_minutes: Time since container was sealed.

    Returns:
        Current estimated internal temperature in Celsius.
    """
    if insulation_factor < 0 or insulation_factor > 1:
        raise ValueError(f"insulation_factor must be 0-1, got {insulation_factor}")
    if elapsed_minutes < 0:
        raise ValueError(f"elapsed_minutes must be >= 0, got {elapsed_minutes}")

    # Exponential drift toward ambient: T(t) = T_ambient - (T_ambient - T_target) * e^(-k*t)
    # k is derived from insulation: worse insulation = faster drift
    k = (1 - insulation_factor) * 0.05  # decay constant per minute
    drift = (ambient_c - target_c) * (1 - math.exp(-k * elapsed_minutes))
    current_temp = target_c + drift
    return round(current_temp, 2)


# ── Delivery Record ──────────────────────────────────────────────────

VALID_STATUSES = {"pending", "in_transit", "delivered", "failed", "returned"}


@dataclass
class DeliveryRecord:
    """Full audit record for a single delivery."""

    delivery_id: str = field(default_factory=_short_id)
    drone_id: str = ""
    origin: str = ""
    destination: str = ""
    supplies: list[str] = field(default_factory=list)
    payload_kg: float = 0.0
    requested_at: Optional[datetime] = None
    departed_at: Optional[datetime] = None
    arrived_at: Optional[datetime] = None
    status: str = "pending"
    temperature_log: list[dict] = field(default_factory=list)
    tamper_status: bool = False
    route_taken: list[dict] = field(default_factory=list)
    re_routes: int = 0
    country: str = "GB"
    compliance_violations: list[str] = field(default_factory=list)

    def duration_seconds(self) -> Optional[float]:
        """Return flight duration in seconds, or None if not completed."""
        if self.departed_at and self.arrived_at:
            return (self.arrived_at - self.departed_at).total_seconds()
        return None

    def is_cold_chain_safe(self, min_c: float = 2.0, max_c: float = 8.0) -> bool:
        """Check if all recorded temperatures stayed within the safe range."""
        if not self.temperature_log:
            return True  # no readings = no violation detected
        return all(
            min_c <= entry.get("temp_c", min_c) <= max_c
            for entry in self.temperature_log
        )


# ── Audit Log ─────────────────────────────────────────────────────────

class AuditLog:
    """
    In-memory audit log with JSON/CSV export.

    Thread-safe for reads; concurrent writes should be externally synchronized
    (the scheduler runs deliveries on separate threads but audit calls are
    serialized through the scheduler's event log).
    """

    def __init__(self, log_dir: str = "data") -> None:
        self._records: dict[str, DeliveryRecord] = {}
        self._log_dir = log_dir
        self._log_file = os.path.join(log_dir, "audit_log.json")

    # ── Create ────────────────────────────────────────────────────────

    def create_delivery(
        self,
        drone_id: str,
        origin: str,
        destination: str,
        supplies: list[str],
        payload_kg: float,
        country: str = "GB",
    ) -> DeliveryRecord:
        """Create a new delivery record in pending state."""
        record = DeliveryRecord(
            drone_id=drone_id,
            origin=origin,
            destination=destination,
            supplies=list(supplies),
            payload_kg=payload_kg,
            requested_at=_utcnow(),
            country=country,
        )
        self._records[record.delivery_id] = record
        logger.info(
            f"[AUDIT] Created delivery {record.delivery_id}: "
            f"{origin} -> {destination} ({', '.join(supplies)})"
        )
        return record

    # ── Lifecycle Events ──────────────────────────────────────────────

    def record_departure(self, delivery_id: str) -> None:
        """Mark delivery as departed / in transit."""
        record = self._get_record(delivery_id)
        record.departed_at = _utcnow()
        record.status = "in_transit"
        logger.info(f"[AUDIT] Delivery {delivery_id} departed at {record.departed_at.isoformat()}")

    def record_arrival(self, delivery_id: str) -> None:
        """Mark delivery as arrived / delivered."""
        record = self._get_record(delivery_id)
        record.arrived_at = _utcnow()
        record.status = "delivered"
        duration = record.duration_seconds()
        logger.info(
            f"[AUDIT] Delivery {delivery_id} arrived at {record.arrived_at.isoformat()} "
            f"(duration: {duration:.0f}s)" if duration else
            f"[AUDIT] Delivery {delivery_id} arrived"
        )

    def record_failure(self, delivery_id: str, reason: str) -> None:
        """Mark delivery as failed with a reason."""
        record = self._get_record(delivery_id)
        record.status = "failed"
        record.compliance_violations.append(f"FAILURE: {reason}")
        logger.warning(f"[AUDIT] Delivery {delivery_id} failed: {reason}")

    # ── In-Flight Tracking ────────────────────────────────────────────

    def record_position(self, delivery_id: str, lat: float, lon: float) -> None:
        """Append a GPS position to the delivery's route trail."""
        record = self._get_record(delivery_id)
        entry = {
            "lat": lat,
            "lon": lon,
            "timestamp": _utcnow().isoformat(),
        }
        record.route_taken.append(entry)

    def record_temperature(self, delivery_id: str, temp_c: float) -> None:
        """Append a temperature reading to the cold-chain log."""
        record = self._get_record(delivery_id)
        entry = {
            "temp_c": round(temp_c, 2),
            "timestamp": _utcnow().isoformat(),
        }
        record.temperature_log.append(entry)

        # Warn if outside safe range
        if temp_c < 2.0 or temp_c > 8.0:
            logger.warning(
                f"[COLD-CHAIN] Delivery {delivery_id}: temperature {temp_c:.1f}C "
                f"outside safe range (2-8C)"
            )

    def record_reroute(self, delivery_id: str, reason: str) -> None:
        """Increment reroute counter and log the reason."""
        record = self._get_record(delivery_id)
        record.re_routes += 1
        record.compliance_violations.append(f"REROUTE: {reason}")
        logger.info(f"[AUDIT] Delivery {delivery_id} rerouted (#{record.re_routes}): {reason}")

    def record_tamper(self, delivery_id: str) -> None:
        """Flag that tamper detection was triggered."""
        record = self._get_record(delivery_id)
        record.tamper_status = True
        record.compliance_violations.append("TAMPER: tamper seal broken")
        logger.warning(f"[AUDIT] Delivery {delivery_id}: TAMPER DETECTED")

    # ── Queries ───────────────────────────────────────────────────────

    def get_delivery(self, delivery_id: str) -> DeliveryRecord:
        """Retrieve a single delivery record."""
        return self._get_record(delivery_id)

    def get_all(self) -> list[DeliveryRecord]:
        """Return all delivery records sorted by request time (newest first)."""
        return sorted(
            self._records.values(),
            key=lambda r: r.requested_at or datetime.min.replace(tzinfo=timezone.utc),
            reverse=True,
        )

    def get_by_status(self, status: str) -> list[DeliveryRecord]:
        """Return deliveries filtered by status."""
        return [r for r in self._records.values() if r.status == status]

    def get_by_drone(self, drone_id: str) -> list[DeliveryRecord]:
        """Return deliveries assigned to a specific drone."""
        return [r for r in self._records.values() if r.drone_id == drone_id]

    # ── Export ────────────────────────────────────────────────────────

    def export_json(self, path: Optional[str] = None) -> str:
        """
        Export all records to JSON.

        Args:
            path: File path to write. Defaults to data/audit_log.json.

        Returns:
            The JSON string.
        """
        target = path or self._log_file
        records_data = []
        for record in self.get_all():
            d = asdict(record)
            # Convert datetimes to ISO strings for JSON
            for key in ("requested_at", "departed_at", "arrived_at"):
                val = d.get(key)
                if val is not None and isinstance(val, datetime):
                    d[key] = val.isoformat()
            records_data.append(d)

        json_str = json.dumps(records_data, indent=2, default=str)

        os.makedirs(os.path.dirname(target) or ".", exist_ok=True)
        with open(target, "w", encoding="utf-8") as f:
            f.write(json_str)
        logger.info(f"[AUDIT] Exported {len(records_data)} records to {target}")
        return json_str

    def export_csv(self, path: str) -> None:
        """
        Export summary rows to CSV (one row per delivery).

        Args:
            path: File path to write.
        """
        records = self.get_all()
        if not records:
            logger.warning("[AUDIT] No records to export")
            return

        fieldnames = [
            "delivery_id", "drone_id", "origin", "destination",
            "supplies", "payload_kg", "status", "country",
            "requested_at", "departed_at", "arrived_at",
            "duration_s", "re_routes", "tamper_status",
            "cold_chain_safe", "num_positions", "num_temp_readings",
        ]

        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        with open(path, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            for record in records:
                writer.writerow({
                    "delivery_id": record.delivery_id,
                    "drone_id": record.drone_id,
                    "origin": record.origin,
                    "destination": record.destination,
                    "supplies": "|".join(record.supplies),
                    "payload_kg": record.payload_kg,
                    "status": record.status,
                    "country": record.country,
                    "requested_at": record.requested_at.isoformat() if record.requested_at else "",
                    "departed_at": record.departed_at.isoformat() if record.departed_at else "",
                    "arrived_at": record.arrived_at.isoformat() if record.arrived_at else "",
                    "duration_s": record.duration_seconds() or "",
                    "re_routes": record.re_routes,
                    "tamper_status": record.tamper_status,
                    "cold_chain_safe": record.is_cold_chain_safe(),
                    "num_positions": len(record.route_taken),
                    "num_temp_readings": len(record.temperature_log),
                })
        logger.info(f"[AUDIT] Exported {len(records)} records to {path}")

    # ── Internal ──────────────────────────────────────────────────────

    def _get_record(self, delivery_id: str) -> DeliveryRecord:
        """Retrieve record or raise ValueError."""
        record = self._records.get(delivery_id)
        if record is None:
            raise ValueError(f"Delivery not found: {delivery_id}")
        return record


# ── Quick test ────────────────────────────────────────────────────────

if __name__ == "__main__":
    import time

    logging.basicConfig(level=logging.INFO, format="%(message)s")

    audit = AuditLog(log_dir="data")

    print("=== Creating Deliveries ===")
    d1 = audit.create_delivery(
        drone_id="Drone1",
        origin="Depot",
        destination="Clinic A",
        supplies=["vaccine_kit", "blood_pack"],
        payload_kg=0.8,
        country="GB",
    )
    d2 = audit.create_delivery(
        drone_id="Drone2",
        origin="Depot",
        destination="Clinic B",
        supplies=["defibrillator"],
        payload_kg=2.0,
        country="DE",
    )

    print(f"\n=== Simulating Delivery {d1.delivery_id} ===")
    audit.record_departure(d1.delivery_id)
    time.sleep(0.1)

    # Simulate in-flight positions
    audit.record_position(d1.delivery_id, 51.5080, -0.1260)
    audit.record_position(d1.delivery_id, 51.5100, -0.1230)
    audit.record_position(d1.delivery_id, 51.5124, -0.1200)

    # Simulate cold-chain readings
    for minutes in [0, 5, 10, 15, 20]:
        temp = simulate_temperature(
            ambient_c=22.0, insulation_factor=0.95,
            target_c=4.0, elapsed_minutes=minutes,
        )
        audit.record_temperature(d1.delivery_id, temp)
        print(f"  t={minutes}min  temp={temp}C")

    audit.record_arrival(d1.delivery_id)

    print(f"\n=== Simulating Delivery {d2.delivery_id} (with reroute) ===")
    audit.record_departure(d2.delivery_id)
    audit.record_reroute(d2.delivery_id, "weather: storm at Clinic B")
    audit.record_position(d2.delivery_id, 51.5100, -0.1300)
    audit.record_failure(d2.delivery_id, "low battery after reroute")

    print("\n=== Cold-Chain Safety ===")
    print(f"  {d1.delivery_id} safe: {d1.is_cold_chain_safe()}")
    print(f"  {d2.delivery_id} safe: {d2.is_cold_chain_safe()}")

    print("\n=== Summary ===")
    for record in audit.get_all():
        duration = record.duration_seconds()
        print(
            f"  {record.delivery_id}  {record.origin} -> {record.destination}  "
            f"status={record.status}  reroutes={record.re_routes}  "
            f"duration={f'{duration:.0f}s' if duration else 'N/A'}  "
            f"tamper={record.tamper_status}"
        )

    print("\n=== Extreme Temperature Test ===")
    # Simulate poor insulation in hot climate
    for minutes in [0, 10, 30, 60, 120]:
        temp = simulate_temperature(
            ambient_c=40.0, insulation_factor=0.80,
            target_c=4.0, elapsed_minutes=minutes,
        )
        safe = "OK" if 2.0 <= temp <= 8.0 else "BREACH"
        print(f"  t={minutes}min  temp={temp}C  [{safe}]")

    # Export
    print("\n=== Export ===")
    json_str = audit.export_json()
    print(f"  JSON exported ({len(json_str)} bytes)")
    audit.export_csv("data/audit_log.csv")
    print("  CSV exported")
