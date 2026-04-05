"""
DroneMedic - Safety Monitor (Simulation Module)

Real-time safety monitoring for simulated flights.
Wraps the core safety layer (backend/safety.py) with simulation-specific
features: continuous monitoring loop, event injection, and telemetry logging.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Optional

from config import LOCATIONS
from backend.physics import (
    DroneSpec, FlightConditions, compute_weather_penalty,
    compute_divert_energy, find_nearest_safe_point,
    compute_hover_energy_per_minute, MAX_SAFE_WIND_MS,
)
from backend.safety import (
    BatteryState, MissionAction, DeliveryPriority,
    DisasterEvent, DisasterSeverity, DisasterResponse,
    GoNoGoResult, SafetyAssessment,
    classify_battery_state, get_battery_policy,
    preflight_check, inflight_assessment,
    handle_disaster_event, triage_route,
    classify_delivery, weather_to_conditions,
    GREEN_RATIO_THRESHOLD, AMBER_RATIO_THRESHOLD,
)
from backend.mission_controller import MissionController, MissionState

logger = logging.getLogger("DroneMedic.Sim.Safety")


# ═══════════════════════════════════════════════════════════════════════
# Safety Monitor
# ═══════════════════════════════════════════════════════════════════════

class SafetyMonitor:
    """
    Continuous safety monitoring for simulated drone flights.

    Runs alongside the drone controller, checking safety at each tick
    and logging all decisions. Can inject disaster events for testing.

    Usage:
        monitor = SafetyMonitor()

        # Pre-flight
        go_nogo = monitor.run_preflight(route, payload_kg, conditions)

        # During flight (each tick)
        decision = monitor.check(position, battery_wh, battery_pct, conditions, location)

        # Inject events
        monitor.inject_event("new_p1_delivery", severity="MAJOR",
                            new_delivery={"location": "Clinic D"})

        # Post-flight
        report = monitor.get_report()
    """

    def __init__(self, spec: DroneSpec = None):
        self.controller = MissionController(spec or DroneSpec())
        self.spec = self.controller.spec
        self._tick_count = 0
        self._safety_log: list[dict] = []
        self._active = False

    # ── Pre-flight ───────────────────────────────────────────────────

    def run_preflight(
        self,
        route: list[str],
        payload_kg: float,
        supplies: dict[str, str] = None,
        priorities: dict[str, str] = None,
        conditions: FlightConditions = None,
    ) -> GoNoGoResult:
        """Run full 12-rule pre-flight safety check."""
        result = self.controller.prepare_mission(
            route, payload_kg, supplies, priorities, conditions
        )
        self._log_safety("preflight", {
            "decision": result.decision,
            "battery_state": result.battery_state.value if result.battery_state else None,
            "checks_passed": sum(1 for c in result.checks if c["passed"]),
            "checks_total": len(result.checks),
            "energy_ratio": result.energy_budget.ratio if result.energy_budget else 0,
            "recommendations": result.recommendations,
        })
        return result

    def activate(self) -> dict:
        """Activate monitoring (call after successful preflight)."""
        result = self.controller.launch()
        if result.get("success"):
            self._active = True
        return result

    # ── In-flight monitoring ─────────────────────────────────────────

    def check(
        self,
        position: dict = None,
        battery_wh: float = None,
        battery_pct: float = None,
        conditions: FlightConditions = None,
        current_location: str = None,
    ) -> dict:
        """
        Run one safety monitoring tick.

        Call this every second during simulated flight.
        Returns decision dict with action, battery state, and reasons.
        """
        if not self._active:
            return {"action": "NOT_ACTIVE", "reason": "Monitor not activated"}

        self._tick_count += 1

        decision = self.controller.control_tick(
            current_position=position,
            battery_wh=battery_wh,
            battery_pct=battery_pct,
            conditions=conditions,
            current_location=current_location,
        )

        self._log_safety("tick", {
            "tick": self._tick_count,
            "action": decision.get("action"),
            "battery_state": decision.get("battery_state"),
            "energy_ratio": decision.get("energy_ratio"),
            "battery_wh": decision.get("battery_wh"),
            "weather_penalty": decision.get("weather_penalty"),
            "reasons": decision.get("reasons", []),
        })

        return decision

    def mark_visited(self, location: str):
        """Mark a waypoint as visited."""
        self.controller.mark_waypoint_visited(location)

    # ── Event injection ──────────────────────────────────────────────

    def inject_event(
        self,
        event_type: str,
        severity: str = "MINOR",
        affected_location: str = "",
        new_delivery: dict = None,
        description: str = "",
    ):
        """
        Inject a disaster event into the safety monitor.

        Event types: "new_p1_delivery", "lz_blocked", "new_nfz",
                     "comms_lost", "infrastructure_damage"

        Severity: "MINOR", "MAJOR", "CRITICAL"
        """
        sev_map = {
            "MINOR": DisasterSeverity.MINOR,
            "MAJOR": DisasterSeverity.MAJOR,
            "CRITICAL": DisasterSeverity.CRITICAL,
        }

        event = DisasterEvent(
            event_type=event_type,
            severity=sev_map.get(severity, DisasterSeverity.MINOR),
            affected_location=affected_location,
            new_delivery=new_delivery,
            description=description or f"{event_type} at {affected_location}",
        )

        self.controller.add_emergency(event)

        self._log_safety("event_injected", {
            "type": event_type,
            "severity": severity,
            "location": affected_location,
            "description": description,
        })

        logger.warning(f"[SAFETY] Event injected: {event_type} ({severity}) at {affected_location}")

    # ── Scenario presets ─────────────────────────────────────────────

    def inject_weather_degradation(self, wind_ms: float = 8.0, precip_mmh: float = 3.0):
        """Simulate sudden weather degradation."""
        self.inject_event(
            "weather_degradation",
            severity="MAJOR",
            description=f"Weather degrading: wind {wind_ms} m/s, precip {precip_mmh} mm/h",
        )

    def inject_new_urgent_delivery(self, location: str, supply: str = "blood_pack"):
        """Simulate a new P1 life-critical delivery request."""
        self.inject_event(
            "new_p1_delivery",
            severity="MAJOR",
            affected_location=location,
            new_delivery={"location": location, "supply": supply, "priority": "critical"},
            description=f"URGENT: {supply} needed at {location}",
        )

    def inject_landing_zone_blocked(self, location: str):
        """Simulate a blocked landing zone."""
        self.inject_event(
            "lz_blocked",
            severity="MINOR",
            affected_location=location,
            description=f"Landing zone blocked at {location}",
        )

    def inject_no_fly_zone(self, location: str):
        """Simulate a new no-fly zone declaration."""
        self.inject_event(
            "new_nfz",
            severity="MAJOR",
            affected_location=location,
            description=f"New no-fly zone declared near {location}",
        )

    def inject_comms_loss(self):
        """Simulate communications loss."""
        self.inject_event(
            "comms_lost",
            severity="CRITICAL",
            description="Ground station communications lost >60s",
        )

    # ── Post-flight report ───────────────────────────────────────────

    def complete(self) -> dict:
        """Complete monitoring and return mission summary."""
        self._active = False
        summary = self.controller.complete_mission()
        self._log_safety("completed", summary)
        return summary

    def abort(self, reason: str = "Safety abort") -> dict:
        """Abort the mission."""
        self._active = False
        result = self.controller.abort_mission(reason)
        self._log_safety("abort", result)
        return result

    def get_report(self) -> dict:
        """Get full safety monitoring report."""
        state = self.controller.get_state()
        return {
            "mission_state": state,
            "total_ticks": self._tick_count,
            "safety_log": self._safety_log,
            "control_log": self.controller.get_control_log(),
            "battery_state_history": self._extract_battery_history(),
        }

    def get_state(self) -> dict:
        """Get current mission state."""
        return self.controller.get_state()

    # ── Internal ─────────────────────────────────────────────────────

    def _log_safety(self, event: str, data: dict):
        self._safety_log.append({
            "timestamp": time.time(),
            "event": event,
            **data,
        })

    def _extract_battery_history(self) -> list[dict]:
        """Extract battery state transitions from the safety log."""
        history = []
        last_state = None
        for entry in self._safety_log:
            state = entry.get("battery_state")
            if state and state != last_state:
                history.append({
                    "timestamp": entry["timestamp"],
                    "tick": entry.get("tick", 0),
                    "state": state,
                    "energy_ratio": entry.get("energy_ratio", 0),
                })
                last_state = state
        return history


# ═══════════════════════════════════════════════════════════════════════
# Convenience: run a full monitored simulation
# ═══════════════════════════════════════════════════════════════════════

def run_monitored_simulation(
    route: list[str],
    payload_kg: float = 2.5,
    conditions: FlightConditions = None,
    inject_events: list[dict] = None,
) -> dict:
    """
    Run a complete mission simulation with safety monitoring.

    Args:
        route: Delivery route including Depot start/end
        payload_kg: Total payload weight
        conditions: Weather/environment conditions
        inject_events: List of dicts with event injection config:
            [{"at_stop": 1, "type": "lz_blocked", "location": "Clinic A"}, ...]

    Returns:
        Full simulation report with safety data.
    """
    if conditions is None:
        conditions = FlightConditions()
    if inject_events is None:
        inject_events = []

    monitor = SafetyMonitor()
    spec = monitor.spec

    # Pre-flight
    go_nogo = monitor.run_preflight(
        route, payload_kg, conditions=conditions
    )

    if not go_nogo.is_go:
        return {
            "launched": False,
            "preflight": {
                "decision": go_nogo.decision,
                "failed_checks": go_nogo.failed_checks,
                "recommendations": go_nogo.recommendations,
            },
            "report": monitor.get_report(),
        }

    # Launch
    monitor.activate()

    # Simulate flight through each waypoint
    stop_count = 0
    decisions = []

    for i, loc in enumerate(route[1:], 1):
        # Check for event injection at this stop
        for evt in inject_events:
            if evt.get("at_stop") == stop_count:
                monitor.inject_event(
                    evt.get("type", "lz_blocked"),
                    severity=evt.get("severity", "MINOR"),
                    affected_location=evt.get("location", loc),
                    new_delivery=evt.get("new_delivery"),
                    description=evt.get("description", ""),
                )

        # Simulate battery drain
        remaining_fraction = 1.0 - (i / len(route))
        battery_wh = spec.mission_energy_wh * remaining_fraction
        battery_pct = (battery_wh / spec.battery_capacity_wh) * 100

        loc_data = LOCATIONS.get(loc, LOCATIONS["Depot"])

        decision = monitor.check(
            position={"lat": loc_data["lat"], "lon": loc_data["lon"]},
            battery_wh=battery_wh,
            battery_pct=battery_pct,
            conditions=conditions,
            current_location=loc,
        )
        decisions.append({"location": loc, **decision})
        monitor.mark_visited(loc)

        if loc != "Depot":
            stop_count += 1

        # Check for abort/divert
        action = decision.get("action", "")
        if action in ("DIVERT", "ABORT", "RETURN_TO_BASE"):
            break

    # Complete
    summary = monitor.complete()

    return {
        "launched": True,
        "preflight": {
            "decision": go_nogo.decision,
            "battery_state": go_nogo.battery_state.value if go_nogo.battery_state else None,
            "energy_ratio": go_nogo.energy_budget.ratio if go_nogo.energy_budget else 0,
        },
        "decisions": decisions,
        "summary": summary,
        "report": monitor.get_report(),
    }


# ═══════════════════════════════════════════════════════════════════════
# Quick self-test
# ═══════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    print("=== Monitored Simulation: Normal Flight ===\n")
    result = run_monitored_simulation(
        route=["Depot", "Clinic B", "Clinic A", "Clinic C", "Depot"],
        payload_kg=2.5,
    )
    print(f"Launched: {result['launched']}")
    print(f"Preflight: {result['preflight']['decision']}")
    for d in result.get("decisions", []):
        print(f"  {d['location']}: {d['action']} ({d.get('battery_state', '?')})")
    print(f"Summary: visited={result['summary']['visited']}")

    print("\n=== Monitored Simulation: With LZ Blocked ===\n")
    result2 = run_monitored_simulation(
        route=["Depot", "Clinic B", "Clinic A", "Clinic C", "Depot"],
        payload_kg=2.5,
        inject_events=[{"at_stop": 1, "type": "lz_blocked", "location": "Clinic A"}],
    )
    print(f"Launched: {result2['launched']}")
    for d in result2.get("decisions", []):
        print(f"  {d['location']}: {d['action']} ({d.get('battery_state', '?')})")
    print(f"Dropped: {result2['summary'].get('stops_dropped', [])}")

    print("\n=== Monitored Simulation: Bad Weather (NO-GO) ===\n")
    result3 = run_monitored_simulation(
        route=["Depot", "Clinic B", "Clinic A", "Depot"],
        payload_kg=2.5,
        conditions=FlightConditions(headwind_ms=10.0, precipitation_mmh=6.0, temperature_c=2.0),
    )
    print(f"Launched: {result3['launched']}")
    if not result3['launched']:
        print(f"Failed checks: {[c['name'] for c in result3['preflight'].get('failed_checks', [])]}")
