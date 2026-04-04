"""
DroneMedic - Safety & Decision Layer

Battery conservation policy (GREEN / AMBER / RED), go/no-go checks,
disaster-response logic, delivery triage, and route acceptance rules.

This module is the "safety brain" of the system — it answers:
"Can this drone complete its mission and land safely, right now?"
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

from config import LOCATIONS
from backend.physics import (
    DroneSpec,
    FlightConditions,
    WeatherPenalty,
    EnergyBudget,
    compute_mission_energy,
    compute_divert_energy,
    compute_weather_penalty,
    compute_hover_power,
    compute_mtom,
    compute_twr,
    check_thrust_feasibility,
    haversine_m,
    route_distance_m,
    find_nearest_safe_point,
    MIN_TWR,
    MAX_SAFE_WIND_MS,
    MAX_WEATHER_PENALTY,
    MAX_FLIGHT_TIME_S,
    MIN_OPERATING_TEMP_C,
    MAX_OPERATING_TEMP_C,
    MAX_PAYLOAD_KG,
)

logger = logging.getLogger("DroneMedic.Safety")


# ═══════════════════════════════════════════════════════════════════════
# Enums
# ═══════════════════════════════════════════════════════════════════════

class BatteryState(str, Enum):
    GREEN = "GREEN"    # ratio ≥ 1.4 — full capability
    AMBER = "AMBER"    # 1.0 ≤ ratio < 1.4 — conserve energy
    RED = "RED"        # ratio < 1.0 — abort / divert


class MissionAction(str, Enum):
    LAUNCH = "LAUNCH"
    CONTINUE = "CONTINUE"
    CONSERVE = "CONSERVE"         # reduce speed, drop low-priority stops
    REROUTE = "REROUTE"
    RETURN_TO_BASE = "RETURN_TO_BASE"
    DIVERT = "DIVERT"             # land at nearest safe point
    ABORT = "ABORT"               # immediate controlled descent
    NO_GO = "NO_GO"               # do not launch


class DeliveryPriority(str, Enum):
    P1_LIFE_CRITICAL = "P1"       # blood for trauma, epi, antivenin
    P2_URGENT = "P2"              # insulin, antibiotics, surgical
    P3_ROUTINE = "P3"             # bandages, vitamins, non-urgent


class DisasterSeverity(str, Enum):
    MINOR = "MINOR"
    MAJOR = "MAJOR"
    CRITICAL = "CRITICAL"


# ═══════════════════════════════════════════════════════════════════════
# Battery thresholds
# ═══════════════════════════════════════════════════════════════════════

GREEN_RATIO_THRESHOLD = 1.4       # comfortable margin
AMBER_RATIO_THRESHOLD = 1.0       # feasible but tight


# ═══════════════════════════════════════════════════════════════════════
# Data classes
# ═══════════════════════════════════════════════════════════════════════

@dataclass
class GoNoGoResult:
    """Result of pre-flight go/no-go assessment."""
    decision: str                  # "GO" or "NO_GO"
    checks: list = field(default_factory=list)
    failed_checks: list = field(default_factory=list)
    energy_budget: Optional[EnergyBudget] = None
    weather_penalty: Optional[WeatherPenalty] = None
    battery_state: Optional[BatteryState] = None
    recommendations: list = field(default_factory=list)

    @property
    def is_go(self) -> bool:
        return self.decision == "GO"


@dataclass
class SafetyAssessment:
    """Real-time safety assessment during flight."""
    battery_state: BatteryState
    action: MissionAction
    energy_budget: EnergyBudget
    divert_energy_wh: float
    divert_location: str
    weather: WeatherPenalty
    reasons: list = field(default_factory=list)
    dropped_stops: list = field(default_factory=list)


@dataclass
class DisasterEvent:
    """Represents an in-flight emergency event."""
    event_type: str               # "new_p1_delivery", "lz_blocked", "new_nfz", "comms_lost", "infrastructure_damage"
    severity: DisasterSeverity
    affected_location: str = ""
    new_delivery: Optional[dict] = None  # for new delivery requests
    description: str = ""


@dataclass
class DisasterResponse:
    """System response to a disaster event."""
    action: MissionAction
    new_route: Optional[list] = None
    dropped_stops: list = field(default_factory=list)
    added_stops: list = field(default_factory=list)
    reasoning: str = ""
    energy_feasible: bool = True


# ═══════════════════════════════════════════════════════════════════════
# Battery state classification
# ═══════════════════════════════════════════════════════════════════════

def classify_battery_state(ratio: float) -> BatteryState:
    """Classify mission feasibility ratio into battery state."""
    if ratio >= GREEN_RATIO_THRESHOLD:
        return BatteryState.GREEN
    elif ratio >= AMBER_RATIO_THRESHOLD:
        return BatteryState.AMBER
    else:
        return BatteryState.RED


def get_battery_policy(state: BatteryState) -> dict:
    """Return the operational policy for a given battery state."""
    policies = {
        BatteryState.GREEN: {
            "state": "GREEN",
            "description": "Normal operations — full mission capability",
            "cruise_speed_ms": 15.0,
            "allow_route_changes": True,
            "allow_new_deliveries": True,
            "allow_hover_delays": True,
            "max_hover_wait_s": 300,     # 5 min
            "action": MissionAction.CONTINUE,
        },
        BatteryState.AMBER: {
            "state": "AMBER",
            "description": "Conservation mode — energy is tight",
            "cruise_speed_ms": 11.0,     # max-endurance speed
            "allow_route_changes": False,
            "allow_new_deliveries": False,
            "allow_hover_delays": False,
            "max_hover_wait_s": 60,      # 1 min max
            "action": MissionAction.CONSERVE,
        },
        BatteryState.RED: {
            "state": "RED",
            "description": "Emergency — abort and divert immediately",
            "cruise_speed_ms": 15.0,     # fastest to safe point
            "allow_route_changes": False,
            "allow_new_deliveries": False,
            "allow_hover_delays": False,
            "max_hover_wait_s": 0,
            "action": MissionAction.DIVERT,
        },
    }
    return policies[state]


# ═══════════════════════════════════════════════════════════════════════
# Pre-flight go/no-go assessment
# ═══════════════════════════════════════════════════════════════════════

def preflight_check(
    route: list[str],
    payload_kg: float,
    conditions: FlightConditions = None,
    spec: DroneSpec = None,
) -> GoNoGoResult:
    """
    Evaluate all 12 go/no-go criteria before launch.

    Every single rule must pass. One failure = NO_GO.
    """
    if spec is None:
        spec = DroneSpec()
    if conditions is None:
        conditions = FlightConditions()

    checks = []
    failed = []
    recommendations = []

    def check(rule_id: int, name: str, passed: bool, detail: str):
        entry = {"rule": rule_id, "name": name, "passed": passed, "detail": detail}
        checks.append(entry)
        if not passed:
            failed.append(entry)

    # Rule 1: Payload within safe limit
    check(1, "Payload mass",
          payload_kg <= spec.max_payload_kg,
          f"{payload_kg:.1f} kg (max: {spec.max_payload_kg} kg)")

    # Rule 2: Thrust margin
    twr = compute_twr(spec, payload_kg)
    check(2, "Thrust margin",
          twr >= MIN_TWR,
          f"TWR = {twr:.2f} (min: {MIN_TWR})")

    # Rule 3: Weather — wind
    wind_total = math.sqrt(conditions.headwind_ms ** 2 + conditions.crosswind_ms ** 2)
    check(3, "Wind speed",
          wind_total < MAX_SAFE_WIND_MS,
          f"{wind_total:.1f} m/s (max: {MAX_SAFE_WIND_MS} m/s)")

    # Rule 4: Weather — precipitation
    check(4, "Precipitation",
          conditions.precipitation_mmh <= 10.0,
          f"{conditions.precipitation_mmh:.1f} mm/h (storm limit: 10.0)")

    # Rule 5: Temperature
    check(5, "Temperature",
          MIN_OPERATING_TEMP_C <= conditions.temperature_c <= MAX_OPERATING_TEMP_C,
          f"{conditions.temperature_c:.1f}°C (range: [{MIN_OPERATING_TEMP_C}, {MAX_OPERATING_TEMP_C}])")

    # Rule 6: Weather penalty total
    wp = compute_weather_penalty(conditions)
    check(6, "Weather penalty",
          wp.flyable and wp.k_total <= MAX_WEATHER_PENALTY,
          f"K_total = {wp.k_total:.2f} (max: {MAX_WEATHER_PENALTY})")

    # Rule 7: Energy for mission + reserve
    budget = compute_mission_energy(spec, payload_kg, route, conditions)
    check(7, "Mission energy budget",
          budget.ratio >= AMBER_RATIO_THRESHOLD,
          f"Ratio = {budget.ratio:.2f} (min: {AMBER_RATIO_THRESHOLD})")

    # Rule 8: Energy for GREEN (preferred)
    is_green = budget.ratio >= GREEN_RATIO_THRESHOLD
    check(8, "GREEN battery threshold (preferred)",
          is_green,
          f"Ratio = {budget.ratio:.2f} (GREEN: >= {GREEN_RATIO_THRESHOLD})")
    if not is_green and budget.ratio >= AMBER_RATIO_THRESHOLD:
        recommendations.append("Mission feasible in AMBER mode — tight margins, conservation active")

    # Rule 9: Divert energy
    _, safe_loc = find_nearest_safe_point(LOCATIONS.get(route[0], LOCATIONS["Depot"]))
    e_divert = compute_divert_energy(
        spec, payload_kg,
        LOCATIONS.get(route[len(route) // 2], LOCATIONS["Depot"]),  # mid-route worst case
        safe_loc, conditions
    )
    check(9, "Divert energy reserve",
          spec.reserve_energy_wh >= e_divert,
          f"Reserve = {spec.reserve_energy_wh:.0f} Wh, divert needs = {e_divert:.0f} Wh")

    if spec.reserve_energy_wh < e_divert:
        recommendations.append(f"Increase reserve to {e_divert:.0f} Wh or reduce route length")

    # Rule 10: Flight time
    check(10, "Flight time limit",
          budget.flight_time_s <= MAX_FLIGHT_TIME_S,
          f"{budget.flight_time_s:.0f}s ({budget.flight_time_s/60:.1f} min, max: {MAX_FLIGHT_TIME_S/60:.0f} min)")

    # Rule 11: Landing zones accessible (simplified — check all stops exist)
    all_lz_ok = all(loc in LOCATIONS for loc in route)
    check(11, "Landing zones accessible",
          all_lz_ok,
          "All locations in route are known")

    # Rule 12: Comms verified (always true in simulation)
    check(12, "Communications link",
          True,
          "Ground link verified (simulation)")

    # Final decision
    decision = "GO" if len(failed) == 0 else "NO_GO"
    battery_state = classify_battery_state(budget.ratio)

    # Override: if only rule 8 failed (GREEN preferred) but rule 7 passed, still GO
    if len(failed) == 1 and failed[0]["rule"] == 8:
        decision = "GO"
        recommendations.append("Launching in AMBER — monitor battery closely")

    return GoNoGoResult(
        decision=decision,
        checks=checks,
        failed_checks=[f for f in failed if f["rule"] != 8],  # rule 8 is advisory
        energy_budget=budget,
        weather_penalty=wp,
        battery_state=battery_state,
        recommendations=recommendations,
    )


# ═══════════════════════════════════════════════════════════════════════
# In-flight safety assessment
# ═══════════════════════════════════════════════════════════════════════

def inflight_assessment(
    current_position: dict,
    remaining_route: list[str],
    payload_kg: float,
    battery_remaining_wh: float,
    conditions: FlightConditions = None,
    spec: DroneSpec = None,
) -> SafetyAssessment:
    """
    Real-time safety check during flight (runs every control cycle).

    Determines battery state, divert feasibility, and recommended action.
    """
    if spec is None:
        spec = DroneSpec()
    if conditions is None:
        conditions = FlightConditions()

    reasons = []

    # Weather check
    wp = compute_weather_penalty(conditions)
    if not wp.flyable:
        safe_name, safe_loc = find_nearest_safe_point(current_position)
        return SafetyAssessment(
            battery_state=BatteryState.RED,
            action=MissionAction.DIVERT,
            energy_budget=EnergyBudget(available_wh=battery_remaining_wh),
            divert_energy_wh=0,
            divert_location=safe_name,
            weather=wp,
            reasons=[f"Weather NO-GO: {'; '.join(wp.reasons)}"],
        )

    # Divert energy
    safe_name, safe_loc = find_nearest_safe_point(current_position)
    e_divert = compute_divert_energy(spec, payload_kg, current_position, safe_loc, conditions)

    # Hard safety: can we even reach a safe point?
    if battery_remaining_wh < e_divert:
        return SafetyAssessment(
            battery_state=BatteryState.RED,
            action=MissionAction.ABORT,
            energy_budget=EnergyBudget(available_wh=battery_remaining_wh),
            divert_energy_wh=e_divert,
            divert_location=safe_name,
            weather=wp,
            reasons=[f"Battery {battery_remaining_wh:.0f} Wh < divert needs {e_divert:.0f} Wh — ABORT"],
        )

    # Mission energy (for remaining route)
    budget = compute_mission_energy(spec, payload_kg, remaining_route, conditions)

    # Override available energy with actual remaining
    effective_available = battery_remaining_wh - e_divert
    ratio = effective_available / budget.total_wh if budget.total_wh > 0 else float('inf')

    battery_state = classify_battery_state(ratio)
    policy = get_battery_policy(battery_state)
    action = policy["action"]

    if battery_state == BatteryState.AMBER:
        reasons.append(f"Battery ratio {ratio:.2f} — entering conservation mode")
        reasons.append(f"Cruise speed reduced to {policy['cruise_speed_ms']} m/s")

    if battery_state == BatteryState.RED:
        reasons.append(f"Battery ratio {ratio:.2f} — aborting mission, diverting to {safe_name}")
        action = MissionAction.RETURN_TO_BASE

    return SafetyAssessment(
        battery_state=battery_state,
        action=action,
        energy_budget=budget,
        divert_energy_wh=e_divert,
        divert_location=safe_name,
        weather=wp,
        reasons=reasons,
    )


# ═══════════════════════════════════════════════════════════════════════
# Delivery triage
# ═══════════════════════════════════════════════════════════════════════

def classify_delivery(supply_type: str, priority_hint: str = "normal") -> DeliveryPriority:
    """Classify a delivery into P1/P2/P3 based on supply type and priority hint."""
    p1_supplies = {"blood_pack", "antivenom", "defibrillator", "epinephrine"}
    p2_supplies = {"insulin", "medication", "surgical_kit", "vaccine_kit", "antibiotics"}

    supply_lower = supply_type.lower().replace(" ", "_")

    if priority_hint == "high" or priority_hint == "critical":
        if supply_lower in p1_supplies:
            return DeliveryPriority.P1_LIFE_CRITICAL
        return DeliveryPriority.P2_URGENT

    if supply_lower in p1_supplies:
        return DeliveryPriority.P1_LIFE_CRITICAL
    elif supply_lower in p2_supplies:
        return DeliveryPriority.P2_URGENT
    else:
        return DeliveryPriority.P3_ROUTINE


def triage_route(
    route: list[str],
    supplies: dict[str, str],
    priorities: dict[str, str],
    energy_available_wh: float,
    spec: DroneSpec = None,
    payload_kg: float = 2.5,
    conditions: FlightConditions = None,
) -> dict:
    """
    Triage route by dropping lowest-priority stops until feasible.

    Returns dict with triaged_route, dropped_stops, and final energy ratio.
    """
    if spec is None:
        spec = DroneSpec()
    if conditions is None:
        conditions = FlightConditions()

    # Classify each stop
    stop_priorities = []
    for stop in route:
        if stop == "Depot":
            continue
        supply = supplies.get(stop, "unknown")
        hint = priorities.get(stop, "normal")
        prio = classify_delivery(supply, hint)
        stop_priorities.append((stop, prio))

    # Sort: P3 first (most droppable), then P2, then P1
    stop_priorities.sort(key=lambda x: x[1].value, reverse=True)

    current_stops = [s for s, _ in stop_priorities]
    dropped = []

    while current_stops:
        candidate_route = ["Depot"] + current_stops + ["Depot"]
        budget = compute_mission_energy(spec, payload_kg, candidate_route, conditions)

        # Check against actual available energy
        ratio = energy_available_wh / budget.total_wh if budget.total_wh > 0 else float('inf')

        if ratio >= AMBER_RATIO_THRESHOLD:
            return {
                "triaged_route": candidate_route,
                "dropped_stops": dropped,
                "kept_stops": current_stops,
                "ratio": round(ratio, 3),
                "battery_state": classify_battery_state(ratio).value,
                "energy_needed_wh": round(budget.total_wh, 1),
                "energy_available_wh": round(energy_available_wh, 1),
            }

        # Drop lowest priority stop (last in sorted order = P3 first)
        drop_candidate = None
        for stop, prio in reversed(stop_priorities):
            if stop in current_stops:
                drop_candidate = (stop, prio)
                break

        if drop_candidate is None:
            break

        stop_name, stop_prio = drop_candidate
        current_stops.remove(stop_name)
        dropped.append({"stop": stop_name, "priority": stop_prio.value, "supply": supplies.get(stop_name, "unknown")})
        logger.info(f"[TRIAGE] Dropping {stop_prio.value} stop: {stop_name}")

    # Nothing left or still infeasible
    return {
        "triaged_route": ["Depot", "Depot"],
        "dropped_stops": dropped,
        "kept_stops": [],
        "ratio": 0.0,
        "battery_state": BatteryState.RED.value,
        "energy_needed_wh": 0,
        "energy_available_wh": round(energy_available_wh, 1),
    }


# ═══════════════════════════════════════════════════════════════════════
# Disaster response
# ═══════════════════════════════════════════════════════════════════════

def handle_disaster_event(
    event: DisasterEvent,
    current_position: dict,
    remaining_route: list[str],
    battery_remaining_wh: float,
    payload_kg: float,
    supplies: dict[str, str] = None,
    priorities: dict[str, str] = None,
    spec: DroneSpec = None,
    conditions: FlightConditions = None,
) -> DisasterResponse:
    """
    Handle a disaster event mid-flight.

    Policy:
    1. CRITICAL + insufficient energy → immediate divert
    2. MAJOR → drop P3 stops, recalculate with P1+P2
    3. MINOR → attempt route adjustment, accept if still GREEN
    4. Always preserve divert energy
    """
    if spec is None:
        spec = DroneSpec()
    if conditions is None:
        conditions = FlightConditions()
    if supplies is None:
        supplies = {}
    if priorities is None:
        priorities = {}

    safe_name, safe_loc = find_nearest_safe_point(current_position)
    e_divert = compute_divert_energy(spec, payload_kg, current_position, safe_loc, conditions)

    # ── CRITICAL: immediate divert if energy insufficient ──
    if event.severity == DisasterSeverity.CRITICAL:
        if battery_remaining_wh < e_divert * 1.3:
            return DisasterResponse(
                action=MissionAction.DIVERT,
                new_route=[safe_name],
                reasoning=f"CRITICAL disaster + low energy — diverting to {safe_name}",
                energy_feasible=False,
            )

    # ── NEW P1 DELIVERY ──
    if event.event_type == "new_p1_delivery" and event.new_delivery:
        new_loc = event.new_delivery.get("location", "")
        if new_loc and new_loc in LOCATIONS:
            # Try inserting the P1 delivery
            new_route = remaining_route.copy()
            if new_loc not in new_route:
                # Insert after current position
                insert_idx = 1 if len(new_route) > 1 else 0
                new_route.insert(insert_idx, new_loc)

            budget = compute_mission_energy(spec, payload_kg, new_route, conditions)
            effective_available = battery_remaining_wh - e_divert
            ratio = effective_available / budget.total_wh if budget.total_wh > 0 else 0

            if ratio >= AMBER_RATIO_THRESHOLD:
                return DisasterResponse(
                    action=MissionAction.REROUTE,
                    new_route=new_route,
                    added_stops=[new_loc],
                    reasoning=f"P1 delivery to {new_loc} accepted (ratio: {ratio:.2f})",
                    energy_feasible=True,
                )
            else:
                # Try dropping P3 stops to make room
                result = triage_route(
                    new_route, supplies, {**priorities, new_loc: "critical"},
                    effective_available, spec, payload_kg, conditions
                )
                if result["ratio"] >= AMBER_RATIO_THRESHOLD:
                    return DisasterResponse(
                        action=MissionAction.REROUTE,
                        new_route=result["triaged_route"],
                        added_stops=[new_loc],
                        dropped_stops=[d["stop"] for d in result["dropped_stops"]],
                        reasoning=f"P1 delivery accepted after dropping {len(result['dropped_stops'])} stops",
                        energy_feasible=True,
                    )
                else:
                    return DisasterResponse(
                        action=MissionAction.CONTINUE,
                        reasoning=f"Cannot accept P1 delivery to {new_loc} — insufficient energy even after triage",
                        energy_feasible=False,
                    )

    # ── LANDING ZONE BLOCKED ──
    if event.event_type == "lz_blocked":
        new_route = [s for s in remaining_route if s != event.affected_location]
        return DisasterResponse(
            action=MissionAction.REROUTE,
            new_route=new_route,
            dropped_stops=[event.affected_location],
            reasoning=f"LZ blocked at {event.affected_location} — skipping stop",
            energy_feasible=True,
        )

    # ── NEW NO-FLY ZONE ──
    if event.event_type == "new_nfz":
        # Remove affected location from route if present
        new_route = [s for s in remaining_route if s != event.affected_location]
        budget = compute_mission_energy(spec, payload_kg, new_route, conditions)
        effective_available = battery_remaining_wh - e_divert
        ratio = effective_available / budget.total_wh if budget.total_wh > 0 else 0

        if ratio >= AMBER_RATIO_THRESHOLD:
            return DisasterResponse(
                action=MissionAction.REROUTE,
                new_route=new_route,
                dropped_stops=[event.affected_location] if event.affected_location in remaining_route else [],
                reasoning=f"Re-routed around new NFZ near {event.affected_location}",
                energy_feasible=True,
            )
        else:
            return DisasterResponse(
                action=MissionAction.RETURN_TO_BASE,
                new_route=["Depot"],
                reasoning="New NFZ makes route infeasible — returning to base",
                energy_feasible=False,
            )

    # ── COMMS LOST ──
    if event.event_type == "comms_lost":
        return DisasterResponse(
            action=MissionAction.RETURN_TO_BASE,
            new_route=["Depot"],
            reasoning="Communications lost >60s — executing contingency RTB",
            energy_feasible=battery_remaining_wh >= e_divert,
        )

    # ── MAJOR: drop P3/P2 and continue ──
    if event.severity == DisasterSeverity.MAJOR:
        effective_available = battery_remaining_wh - e_divert
        result = triage_route(
            remaining_route, supplies, priorities,
            effective_available, spec, payload_kg, conditions
        )
        return DisasterResponse(
            action=MissionAction.REROUTE if result["dropped_stops"] else MissionAction.CONTINUE,
            new_route=result["triaged_route"],
            dropped_stops=[d["stop"] for d in result["dropped_stops"]],
            reasoning=f"MAJOR event — triaged route, dropped {len(result['dropped_stops'])} stops",
            energy_feasible=result["ratio"] >= AMBER_RATIO_THRESHOLD,
        )

    # ── MINOR: continue if possible ──
    return DisasterResponse(
        action=MissionAction.CONTINUE,
        reasoning=f"MINOR event: {event.description} — continuing mission",
        energy_feasible=True,
    )


# ═══════════════════════════════════════════════════════════════════════
# Convenience: weather dict → FlightConditions
# ═══════════════════════════════════════════════════════════════════════

def weather_to_conditions(weather: dict) -> FlightConditions:
    """Convert a weather service dict to FlightConditions dataclass."""
    wind = weather.get("wind_speed", 0.0)
    # Assume headwind is dominant (conservative)
    return FlightConditions(
        headwind_ms=wind * 0.7,       # 70% headwind component (conservative)
        crosswind_ms=wind * 0.3,      # 30% crosswind component
        precipitation_mmh=weather.get("precipitation", 0.0),
        temperature_c=weather.get("temperature", 18.0),
        turbulence="moderate" if wind > 10 else ("light" if wind > 5 else "calm"),
    )


# ═══════════════════════════════════════════════════════════════════════
# Quick self-test
# ═══════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    print("=== Pre-flight Check: Calm Weather ===")
    result = preflight_check(
        route=["Depot", "Clinic B", "Clinic A", "Clinic C", "Depot"],
        payload_kg=2.5,
    )
    print(f"Decision: {result.decision}")
    print(f"Battery state: {result.battery_state}")
    for c in result.checks:
        status = "PASS" if c["passed"] else "FAIL"
        print(f"  [{status}] Rule {c['rule']}: {c['name']} - {c['detail']}")
    if result.recommendations:
        print(f"Recommendations: {result.recommendations}")

    print("\n=== Pre-flight Check: 5 m/s Headwind + Light Rain ===")
    result2 = preflight_check(
        route=["Depot", "Clinic B", "Clinic A", "Clinic C", "Depot"],
        payload_kg=2.5,
        conditions=FlightConditions(headwind_ms=5.0, precipitation_mmh=1.5, temperature_c=15.0),
    )
    print(f"Decision: {result2.decision}")
    print(f"Battery state: {result2.battery_state}")
    for c in result2.failed_checks:
        print(f"  FAILED: Rule {c['rule']}: {c['name']} — {c['detail']}")

    print("\n=== Delivery Triage ===")
    triage = triage_route(
        route=["Depot", "Clinic B", "Clinic A", "Clinic C", "Depot"],
        supplies={"Clinic B": "blood_pack", "Clinic A": "insulin", "Clinic C": "bandages"},
        priorities={"Clinic B": "high"},
        energy_available_wh=400.0,
    )
    print(f"Triaged route: {triage['triaged_route']}")
    print(f"Dropped: {triage['dropped_stops']}")
    print(f"Ratio: {triage['ratio']}")
    print(f"State: {triage['battery_state']}")
