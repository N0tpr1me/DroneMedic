"""
DroneMedic - Mission Controller

Real-time control loop that decides whether to launch, continue,
re-route, return to base, divert to safe landing, or abort.

Combines: battery state + weather changes + mission priority +
route feasibility + emergency conditions.

This is the module that runs every control cycle during flight.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Optional

from config import LOCATIONS
from backend.physics import (
    DroneSpec,
    FlightConditions,
    EnergyBudget,
    compute_mission_energy,
    compute_divert_energy,
    compute_weather_penalty,
    compute_hover_energy_per_minute,
    haversine_m,
    find_nearest_safe_point,
    route_distance_m,
    MAX_SAFE_WIND_MS,
    MAX_WEATHER_PENALTY,
)
from backend.safety import (
    BatteryState,
    MissionAction,
    DeliveryPriority,
    DisasterEvent,
    DisasterSeverity,
    DisasterResponse,
    SafetyAssessment,
    GoNoGoResult,
    classify_battery_state,
    get_battery_policy,
    preflight_check,
    inflight_assessment,
    handle_disaster_event,
    triage_route,
    weather_to_conditions,
    GREEN_RATIO_THRESHOLD,
    AMBER_RATIO_THRESHOLD,
)

logger = logging.getLogger("DroneMedic.MissionCtrl")


# ═══════════════════════════════════════════════════════════════════════
# Mission state
# ═══════════════════════════════════════════════════════════════════════

@dataclass
class MissionState:
    """Full state of an active mission."""
    # Identity
    mission_id: str = ""
    drone_id: str = "Drone1"

    # Route
    planned_route: list = field(default_factory=list)
    remaining_route: list = field(default_factory=list)
    visited: list = field(default_factory=list)
    current_location: str = "Depot"

    # Position & battery
    position: dict = field(default_factory=lambda: {"lat": 51.5074, "lon": -0.1278})
    battery_wh: float = 544.0        # mission-available energy
    battery_pct: float = 100.0

    # Payload
    payload_kg: float = 0.0
    supplies: dict = field(default_factory=dict)   # {location: supply_type}
    priorities: dict = field(default_factory=dict)  # {location: "high" | "normal"}

    # Status
    status: str = "idle"             # idle, preflight, flying, paused, completed, aborted
    battery_state: BatteryState = BatteryState.GREEN
    action: MissionAction = MissionAction.LAUNCH
    is_flying: bool = False

    # Weather
    conditions: FlightConditions = field(default_factory=FlightConditions)

    # Metrics
    reroute_count: int = 0
    reroute_successes: int = 0
    stops_dropped: list = field(default_factory=list)
    emergency_events: list = field(default_factory=list)
    control_log: list = field(default_factory=list)

    # Timing
    launch_time: float = 0.0
    last_update: float = 0.0


# ═══════════════════════════════════════════════════════════════════════
# Mission Controller
# ═══════════════════════════════════════════════════════════════════════

class MissionController:
    """
    Physics-aware mission controller.

    Implements the decision loop from the aerospace review:
    - Pre-flight go/no-go
    - Real-time battery/weather/emergency monitoring
    - Automatic triage, re-routing, and abort decisions
    """

    def __init__(self, spec: DroneSpec = None):
        self.spec = spec or DroneSpec()
        self.state = MissionState()
        self._emergency_queue: list[DisasterEvent] = []

    # ── Pre-flight ───────────────────────────────────────────────────

    def prepare_mission(
        self,
        route: list[str],
        payload_kg: float,
        supplies: dict[str, str] = None,
        priorities: dict[str, str] = None,
        conditions: FlightConditions = None,
    ) -> GoNoGoResult:
        """
        Prepare and validate a mission before launch.
        Returns full go/no-go assessment.
        """
        if conditions is None:
            conditions = FlightConditions()

        self.state = MissionState(
            mission_id=f"MSN-{int(time.time())}",
            planned_route=route,
            remaining_route=route.copy(),
            payload_kg=payload_kg,
            supplies=supplies or {},
            priorities=priorities or {},
            conditions=conditions,
            battery_wh=self.spec.mission_energy_wh,
            status="preflight",
        )

        result = preflight_check(route, payload_kg, conditions, self.spec)

        self.state.battery_state = result.battery_state or BatteryState.GREEN
        self.state.action = MissionAction.LAUNCH if result.is_go else MissionAction.NO_GO

        self._log_control("preflight", {
            "decision": result.decision,
            "battery_state": self.state.battery_state.value,
            "energy_ratio": result.energy_budget.ratio if result.energy_budget else 0,
            "checks_passed": sum(1 for c in result.checks if c["passed"]),
            "checks_total": len(result.checks),
        })

        return result

    # ── Launch ───────────────────────────────────────────────────────

    def launch(self) -> dict:
        """Mark mission as launched (after successful preflight)."""
        if self.state.action != MissionAction.LAUNCH:
            return {"success": False, "reason": f"Cannot launch: action is {self.state.action.value}"}

        self.state.status = "flying"
        self.state.is_flying = True
        self.state.launch_time = time.time()
        self.state.last_update = time.time()

        self._log_control("launch", {"mission_id": self.state.mission_id})
        return {"success": True, "mission_id": self.state.mission_id}

    # ── Main control loop tick ───────────────────────────────────────

    def control_tick(
        self,
        current_position: dict = None,
        battery_wh: float = None,
        battery_pct: float = None,
        conditions: FlightConditions = None,
        current_location: str = None,
    ) -> dict:
        """
        Main control loop — call every 1 second during flight.

        Returns decision dict with action, battery_state, reasons, etc.
        """
        if not self.state.is_flying:
            return {"action": MissionAction.NO_GO.value, "reason": "Not flying"}

        # Update state
        if current_position:
            self.state.position = current_position
        if battery_wh is not None:
            self.state.battery_wh = battery_wh
        if battery_pct is not None:
            self.state.battery_pct = battery_pct
        if conditions:
            self.state.conditions = conditions
        if current_location:
            self.state.current_location = current_location

        self.state.last_update = time.time()

        # ── Step 1: Hard safety checks ──
        wp = compute_weather_penalty(self.state.conditions)

        # Wind check
        wind_total = (self.state.conditions.headwind_ms ** 2 +
                      self.state.conditions.crosswind_ms ** 2) ** 0.5
        if wind_total > MAX_SAFE_WIND_MS:
            return self._emergency_action(
                MissionAction.DIVERT,
                f"Wind {wind_total:.1f} m/s exceeds limit {MAX_SAFE_WIND_MS} m/s"
            )

        # Weather penalty check
        if not wp.flyable or wp.k_total > MAX_WEATHER_PENALTY:
            return self._emergency_action(
                MissionAction.DIVERT,
                f"Weather penalty ×{wp.k_total:.2f} — NO-GO"
            )

        # Divert energy check
        safe_name, safe_loc = find_nearest_safe_point(self.state.position)
        e_divert = compute_divert_energy(
            self.spec, self.state.payload_kg,
            self.state.position, safe_loc, self.state.conditions
        )

        if self.state.battery_wh < e_divert:
            return self._emergency_action(
                MissionAction.ABORT,
                f"Battery {self.state.battery_wh:.0f} Wh < divert needs {e_divert:.0f} Wh"
            )

        # ── Step 2: Handle emergency queue ──
        emergency_results = []
        while self._emergency_queue:
            event = self._emergency_queue.pop(0)
            self.state.emergency_events.append(event)
            response = handle_disaster_event(
                event,
                self.state.position,
                self.state.remaining_route,
                self.state.battery_wh,
                self.state.payload_kg,
                self.state.supplies,
                self.state.priorities,
                self.spec,
                self.state.conditions,
            )
            emergency_results.append(response)

            if response.action in (MissionAction.DIVERT, MissionAction.ABORT):
                return self._emergency_action(response.action, response.reasoning)

            if response.new_route:
                self.state.remaining_route = response.new_route
                self.state.reroute_count += 1
                if response.energy_feasible:
                    self.state.reroute_successes += 1
                self.state.stops_dropped.extend(response.dropped_stops)

        # ── Step 3: Compute energy budget ──
        budget = compute_mission_energy(
            self.spec, self.state.payload_kg,
            self.state.remaining_route, self.state.conditions
        )

        effective_available = self.state.battery_wh - e_divert
        ratio = effective_available / budget.total_wh if budget.total_wh > 0 else float('inf')
        battery_state = classify_battery_state(ratio)
        policy = get_battery_policy(battery_state)

        self.state.battery_state = battery_state

        reasons = []
        dropped = []

        # ── Step 4: Battery state management ──
        if battery_state == BatteryState.GREEN:
            action = MissionAction.CONTINUE

        elif battery_state == BatteryState.AMBER:
            action = MissionAction.CONSERVE
            reasons.append(f"Battery ratio {ratio:.2f} — conservation mode")

            # Try to recover to GREEN by dropping P3 stops
            triage = triage_route(
                self.state.remaining_route,
                self.state.supplies,
                self.state.priorities,
                effective_available,
                self.spec,
                self.state.payload_kg,
                self.state.conditions,
            )
            if triage["dropped_stops"] and triage["ratio"] >= GREEN_RATIO_THRESHOLD:
                self.state.remaining_route = triage["triaged_route"]
                dropped = [d["stop"] for d in triage["dropped_stops"]]
                self.state.stops_dropped.extend(dropped)
                reasons.append(f"Dropped {len(dropped)} P3 stops to recover GREEN")
                action = MissionAction.CONTINUE
                battery_state = BatteryState.GREEN

        else:  # RED
            action = MissionAction.RETURN_TO_BASE
            reasons.append(f"Battery ratio {ratio:.2f} — aborting remaining deliveries")
            self.state.remaining_route = [self.state.current_location, "Depot"]

        self.state.action = action

        result = {
            "action": action.value,
            "battery_state": battery_state.value,
            "battery_wh": round(self.state.battery_wh, 1),
            "battery_pct": round(self.state.battery_pct, 1),
            "energy_ratio": round(ratio, 3),
            "energy_needed_wh": round(budget.total_wh, 1),
            "divert_energy_wh": round(e_divert, 1),
            "divert_location": safe_name,
            "cruise_speed_ms": policy["cruise_speed_ms"],
            "remaining_route": self.state.remaining_route,
            "dropped_stops": dropped,
            "reasons": reasons,
            "weather_penalty": round(wp.k_total, 3),
            "weather_flyable": wp.flyable,
            "emergency_responses": [
                {"action": r.action.value, "reasoning": r.reasoning}
                for r in emergency_results
            ],
        }

        self._log_control("tick", result)
        return result

    # ── Emergency queue ──────────────────────────────────────────────

    def add_emergency(self, event: DisasterEvent):
        """Queue an emergency event for processing in the next control tick."""
        self._emergency_queue.append(event)
        logger.warning(f"[EMERGENCY] Queued: {event.event_type} ({event.severity.value})")

    # ── Waypoint visited ─────────────────────────────────────────────

    def mark_waypoint_visited(self, location: str):
        """Mark a waypoint as visited and remove from remaining route."""
        self.state.visited.append(location)
        self.state.current_location = location
        if location in self.state.remaining_route:
            self.state.remaining_route.remove(location)

        self._log_control("waypoint", {"location": location, "remaining": len(self.state.remaining_route)})

    # ── Mission completion ───────────────────────────────────────────

    def complete_mission(self) -> dict:
        """Finalize and return mission summary."""
        self.state.status = "completed"
        self.state.is_flying = False

        elapsed = time.time() - self.state.launch_time if self.state.launch_time > 0 else 0

        summary = {
            "mission_id": self.state.mission_id,
            "status": self.state.status,
            "planned_route": self.state.planned_route,
            "visited": self.state.visited,
            "stops_dropped": self.state.stops_dropped,
            "battery_final_wh": round(self.state.battery_wh, 1),
            "battery_final_pct": round(self.state.battery_pct, 1),
            "reroute_count": self.state.reroute_count,
            "reroute_successes": self.state.reroute_successes,
            "emergency_events": len(self.state.emergency_events),
            "elapsed_s": round(elapsed, 1),
            "control_log_entries": len(self.state.control_log),
        }

        self._log_control("completed", summary)
        return summary

    # ── Abort ────────────────────────────────────────────────────────

    def abort_mission(self, reason: str = "Manual abort") -> dict:
        """Abort the mission."""
        self.state.status = "aborted"
        self.state.is_flying = False
        self.state.action = MissionAction.ABORT

        self._log_control("abort", {"reason": reason})
        return {"status": "aborted", "reason": reason}

    # ── State getters ────────────────────────────────────────────────

    def get_state(self) -> dict:
        """Return current mission state as serializable dict."""
        return {
            "mission_id": self.state.mission_id,
            "status": self.state.status,
            "battery_state": self.state.battery_state.value,
            "action": self.state.action.value,
            "battery_wh": round(self.state.battery_wh, 1),
            "battery_pct": round(self.state.battery_pct, 1),
            "current_location": self.state.current_location,
            "remaining_route": self.state.remaining_route,
            "visited": self.state.visited,
            "reroute_count": self.state.reroute_count,
            "stops_dropped": self.state.stops_dropped,
            "payload_kg": self.state.payload_kg,
            "is_flying": self.state.is_flying,
        }

    def get_control_log(self) -> list:
        """Return the full control decision log."""
        return self.state.control_log.copy()

    # ── Internal ─────────────────────────────────────────────────────

    def _emergency_action(self, action: MissionAction, reason: str) -> dict:
        """Execute an emergency action."""
        safe_name, _ = find_nearest_safe_point(self.state.position)

        self.state.action = action
        self.state.battery_state = BatteryState.RED

        if action == MissionAction.DIVERT:
            self.state.remaining_route = [safe_name]
            self.state.status = "diverting"
        elif action == MissionAction.ABORT:
            self.state.status = "aborting"
        elif action == MissionAction.RETURN_TO_BASE:
            self.state.remaining_route = ["Depot"]
            self.state.status = "returning"

        result = {
            "action": action.value,
            "battery_state": BatteryState.RED.value,
            "reason": reason,
            "divert_location": safe_name,
            "remaining_route": self.state.remaining_route,
        }

        logger.warning(f"[EMERGENCY] {action.value}: {reason}")
        self._log_control("emergency", result)
        return result

    def _log_control(self, event: str, data: dict):
        """Log a control decision."""
        self.state.control_log.append({
            "timestamp": time.time(),
            "event": event,
            **data,
        })


# ═══════════════════════════════════════════════════════════════════════
# Quick self-test
# ═══════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(message)s", datefmt="%H:%M:%S")

    ctrl = MissionController()

    print("=== Mission Controller Test ===\n")

    # Prepare mission
    route = ["Depot", "Clinic B", "Clinic A", "Clinic C", "Depot"]
    result = ctrl.prepare_mission(
        route=route,
        payload_kg=2.5,
        supplies={"Clinic B": "blood_pack", "Clinic A": "insulin", "Clinic C": "bandages"},
        priorities={"Clinic B": "high"},
    )
    print(f"Pre-flight: {result.decision} ({result.battery_state})")
    if not result.is_go:
        print(f"Failed checks: {[c['name'] for c in result.failed_checks]}")
        print(f"Recommendations: {result.recommendations}")

    # Launch
    if result.is_go:
        launch_result = ctrl.launch()
        print(f"Launch: {launch_result}")

        # Simulate flight ticks
        for i, loc in enumerate(route[1:]):
            tick = ctrl.control_tick(
                current_position=LOCATIONS.get(loc, LOCATIONS["Depot"]),
                battery_wh=ctrl.spec.mission_energy_wh * (1 - 0.2 * (i + 1)),
                battery_pct=100 * (1 - 0.2 * (i + 1)),
                current_location=loc,
            )
            ctrl.mark_waypoint_visited(loc)
            print(f"  -> {loc}: {tick['action']} ({tick['battery_state']}, ratio={tick['energy_ratio']:.2f})")

        summary = ctrl.complete_mission()
        print(f"\nMission complete: {summary['visited']}")
        print(f"  Reroutes: {summary['reroute_count']}, Dropped: {summary['stops_dropped']}")
