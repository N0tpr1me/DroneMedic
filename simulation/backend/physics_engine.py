"""
DroneMedic - Aerospace Physics Engine (Simulation Module)

Re-exports the core physics engine from backend/physics.py and adds
simulation-specific helpers for running physics-aware mock flights.

All equations, constants, and models are defined in backend/physics.py.
This module extends them with simulation utilities.
"""

from __future__ import annotations

import logging
import math
import time
from dataclasses import dataclass, field
from typing import Optional

# Re-export everything from the core physics engine
from backend.physics import (
    # Constants
    GRAVITY,
    AIR_DENSITY_SEA_LEVEL,
    AIRFRAME_MASS_KG,
    BATTERY_MASS_KG,
    BATTERY_CAPACITY_WH,
    USABLE_BATTERY_FRACTION,
    RESERVE_BATTERY_FRACTION,
    MAX_PAYLOAD_KG,
    NUM_ROTORS,
    PROP_DIAMETER_M,
    TOTAL_DISK_AREA_M2,
    PROPULSIVE_EFFICIENCY,
    MAX_THRUST_PER_MOTOR_N,
    MIN_TWR,
    PREFERRED_TWR,
    CRUISE_SPEED_MS,
    MAX_ENDURANCE_SPEED_MS,
    CLIMB_RATE_MS,
    DESCENT_RATE_MS,
    CRUISE_ALTITUDE_M,
    CRUISE_POWER_RATIO,
    CLIMB_POWER_MULTIPLIER,
    DESCENT_POWER_MULTIPLIER,
    HOVER_TIME_PER_STOP_S,
    MAX_FLIGHT_TIME_S,
    MAX_WEATHER_PENALTY,
    MIN_OPERATING_TEMP_C,
    MAX_OPERATING_TEMP_C,
    MAX_SAFE_WIND_MS,
    # Dataclasses
    DroneSpec,
    FlightConditions,
    EnergyBudget,
    WeatherPenalty,
    # Functions
    compute_mtom,
    compute_twr,
    check_thrust_feasibility,
    compute_hover_power,
    compute_cruise_power,
    compute_climb_power,
    compute_descent_power,
    compute_energy_per_km,
    compute_vertical_energy,
    compute_hover_energy,
    compute_hover_energy_per_minute,
    compute_weather_penalty,
    haversine_m,
    route_distance_m,
    compute_mission_energy,
    compute_divert_energy,
    find_nearest_safe_point,
)

from config import LOCATIONS

logger = logging.getLogger("DroneMedic.Sim.Physics")


# ═══════════════════════════════════════════════════════════════════════
# Simulation-specific data classes
# ═══════════════════════════════════════════════════════════════════════

@dataclass
class SimTelemetry:
    """Real-time telemetry snapshot for physics simulation."""
    timestamp: float = 0.0
    position_lat: float = 0.0
    position_lon: float = 0.0
    altitude_m: float = 0.0
    ground_speed_ms: float = 0.0
    air_speed_ms: float = 0.0
    heading_deg: float = 0.0
    battery_wh: float = 0.0
    battery_pct: float = 0.0
    power_draw_w: float = 0.0
    energy_consumed_wh: float = 0.0
    flight_phase: str = "ground"  # ground, climb, cruise, hover, descent, landed
    payload_kg: float = 0.0
    wind_speed_ms: float = 0.0
    temperature_c: float = 18.0
    twr: float = 0.0
    motor_rpm: list = field(default_factory=lambda: [0] * 6)


@dataclass
class PhysicsSimResult:
    """Result of a full mission physics simulation."""
    feasible: bool = False
    energy_budget: Optional[EnergyBudget] = None
    telemetry_log: list = field(default_factory=list)
    segments: list = field(default_factory=list)
    total_energy_wh: float = 0.0
    total_time_s: float = 0.0
    total_distance_m: float = 0.0
    battery_final_pct: float = 0.0
    weather_penalty: Optional[WeatherPenalty] = None
    warnings: list = field(default_factory=list)


# ═══════════════════════════════════════════════════════════════════════
# Segment-level simulation
# ═══════════════════════════════════════════════════════════════════════

def simulate_segment(
    spec: DroneSpec,
    payload_kg: float,
    from_loc: str,
    to_loc: str,
    conditions: FlightConditions = None,
) -> dict:
    """
    Simulate a single flight segment between two locations.

    Returns detailed breakdown: distance, time, energy for each phase
    (climb, cruise, descent).
    """
    if conditions is None:
        conditions = FlightConditions()

    loc_from = LOCATIONS.get(from_loc, LOCATIONS["Depot"])
    loc_to = LOCATIONS.get(to_loc, LOCATIONS["Depot"])

    dist_m = haversine_m(loc_from, loc_to)
    ground_speed = max(spec.cruise_speed_ms - abs(conditions.headwind_ms), 1.0)

    # Phase 1: Climb (if starting from ground)
    t_climb = spec.cruise_altitude_m / spec.climb_rate_ms
    p_climb = compute_climb_power(spec, payload_kg, conditions.air_density)
    e_climb = p_climb * t_climb / 3600

    # Phase 2: Cruise
    cruise_dist = max(dist_m - 50, 0)  # subtract approach distance
    t_cruise = cruise_dist / ground_speed if ground_speed > 0 else 0
    p_cruise = compute_cruise_power(spec, payload_kg, conditions.air_density)
    e_cruise = p_cruise * t_cruise / 3600

    # Phase 3: Descent
    t_descent = spec.cruise_altitude_m / spec.descent_rate_ms
    p_descent = compute_descent_power(spec, payload_kg, conditions.air_density)
    e_descent = p_descent * t_descent / 3600

    total_time = t_climb + t_cruise + t_descent
    total_energy = e_climb + e_cruise + e_descent

    return {
        "from": from_loc,
        "to": to_loc,
        "distance_m": round(dist_m, 1),
        "ground_speed_ms": round(ground_speed, 1),
        "phases": {
            "climb": {
                "time_s": round(t_climb, 1),
                "power_w": round(p_climb, 1),
                "energy_wh": round(e_climb, 1),
            },
            "cruise": {
                "time_s": round(t_cruise, 1),
                "power_w": round(p_cruise, 1),
                "energy_wh": round(e_cruise, 1),
                "distance_m": round(cruise_dist, 1),
            },
            "descent": {
                "time_s": round(t_descent, 1),
                "power_w": round(p_descent, 1),
                "energy_wh": round(e_descent, 1),
            },
        },
        "total_time_s": round(total_time, 1),
        "total_energy_wh": round(total_energy, 1),
    }


def simulate_hover_stop(
    spec: DroneSpec,
    payload_kg: float,
    location: str,
    hover_duration_s: float = HOVER_TIME_PER_STOP_S,
) -> dict:
    """Simulate energy cost of a delivery stop (hover + payload drop)."""
    p_hover = compute_hover_power(spec, payload_kg)
    e_hover = p_hover * hover_duration_s / 3600

    return {
        "location": location,
        "hover_duration_s": round(hover_duration_s, 1),
        "hover_power_w": round(p_hover, 1),
        "energy_wh": round(e_hover, 1),
    }


# ═══════════════════════════════════════════════════════════════════════
# Full mission simulation
# ═══════════════════════════════════════════════════════════════════════

def simulate_mission(
    route: list[str],
    payload_kg: float = 2.5,
    conditions: FlightConditions = None,
    spec: DroneSpec = None,
) -> PhysicsSimResult:
    """
    Run a complete physics simulation of a mission.

    Computes segment-by-segment energy, generates telemetry log,
    and tracks battery state throughout the flight.
    """
    if spec is None:
        spec = DroneSpec()
    if conditions is None:
        conditions = FlightConditions()

    # Check weather first
    wp = compute_weather_penalty(conditions)
    if not wp.flyable:
        return PhysicsSimResult(
            feasible=False,
            weather_penalty=wp,
            warnings=[f"Weather NO-GO: {'; '.join(wp.reasons)}"],
        )

    battery_wh = spec.mission_energy_wh
    total_energy = 0.0
    total_time = 0.0
    total_distance = 0.0
    segments = []
    telemetry = []
    warnings = []
    sim_time = 0.0

    for i in range(len(route) - 1):
        from_loc = route[i]
        to_loc = route[i + 1]

        # Flight segment
        seg = simulate_segment(spec, payload_kg, from_loc, to_loc, conditions)
        segments.append(seg)

        total_energy += seg["total_energy_wh"]
        total_time += seg["total_time_s"]
        total_distance += seg["distance_m"]
        battery_wh -= seg["total_energy_wh"]

        sim_time += seg["total_time_s"]
        loc_data = LOCATIONS.get(to_loc, LOCATIONS["Depot"])

        telemetry.append(SimTelemetry(
            timestamp=sim_time,
            position_lat=loc_data["lat"],
            position_lon=loc_data["lon"],
            altitude_m=spec.cruise_altitude_m,
            ground_speed_ms=seg["ground_speed_ms"],
            air_speed_ms=spec.cruise_speed_ms,
            battery_wh=round(battery_wh, 1),
            battery_pct=round((battery_wh / spec.battery_capacity_wh) * 100, 1),
            power_draw_w=seg["phases"]["cruise"]["power_w"],
            energy_consumed_wh=round(total_energy, 1),
            flight_phase="cruise",
            payload_kg=payload_kg,
            wind_speed_ms=abs(conditions.headwind_ms),
            temperature_c=conditions.temperature_c,
            twr=round(compute_twr(spec, payload_kg), 2),
        ))

        # Battery warning
        if battery_wh < spec.reserve_energy_wh:
            warnings.append(f"Battery below reserve at segment {from_loc} -> {to_loc}")

        # Delivery stop (hover) — skip for Depot
        if to_loc != "Depot" and to_loc != route[-1]:
            stop = simulate_hover_stop(spec, payload_kg, to_loc)
            segments.append(stop)
            total_energy += stop["energy_wh"]
            total_time += stop["hover_duration_s"]
            battery_wh -= stop["energy_wh"]
            sim_time += stop["hover_duration_s"]

    # Energy budget
    budget = compute_mission_energy(spec, payload_kg, route, conditions)

    battery_final_pct = max(0, (battery_wh / spec.battery_capacity_wh) * 100)

    return PhysicsSimResult(
        feasible=battery_wh > 0,
        energy_budget=budget,
        telemetry_log=[t.__dict__ for t in telemetry],
        segments=segments,
        total_energy_wh=round(total_energy, 1),
        total_time_s=round(total_time, 1),
        total_distance_m=round(total_distance, 1),
        battery_final_pct=round(battery_final_pct, 1),
        weather_penalty=wp,
        warnings=warnings,
    )


# ═══════════════════════════════════════════════════════════════════════
# Scenario comparison (best / expected / worst case)
# ═══════════════════════════════════════════════════════════════════════

def simulate_scenarios(
    route: list[str],
    payload_kg: float = 2.5,
    spec: DroneSpec = None,
) -> dict:
    """
    Run best-case, expected-case, and worst-case simulations.

    Returns comparison table matching the aerospace review format.
    """
    if spec is None:
        spec = DroneSpec()

    scenarios = {
        "best_case": FlightConditions(
            headwind_ms=0.0, crosswind_ms=0.0,
            precipitation_mmh=0.0, temperature_c=20.0, turbulence="calm",
        ),
        "expected_case": FlightConditions(
            headwind_ms=3.0, crosswind_ms=1.5,
            precipitation_mmh=0.5, temperature_c=15.0, turbulence="light",
        ),
        "worst_case": FlightConditions(
            headwind_ms=7.0, crosswind_ms=3.0,
            precipitation_mmh=3.0, temperature_c=5.0, turbulence="moderate",
        ),
    }

    results = {}
    for name, conditions in scenarios.items():
        sim = simulate_mission(route, payload_kg, conditions, spec)
        wp = compute_weather_penalty(conditions)
        results[name] = {
            "feasible": sim.feasible,
            "total_energy_wh": sim.total_energy_wh,
            "total_time_s": sim.total_time_s,
            "total_distance_m": sim.total_distance_m,
            "battery_final_pct": sim.battery_final_pct,
            "weather_penalty": wp.k_total,
            "energy_ratio": sim.energy_budget.ratio if sim.energy_budget else 0,
            "max_range_km": sim.energy_budget.max_range_km if sim.energy_budget else 0,
            "warnings": sim.warnings,
        }

    return results


# ═══════════════════════════════════════════════════════════════════════
# Quick self-test
# ═══════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    route = ["Depot", "Clinic B", "Clinic A", "Clinic C", "Depot"]
    payload = 2.5

    print("=== Full Mission Simulation ===\n")
    result = simulate_mission(route, payload)
    print(f"Feasible: {result.feasible}")
    print(f"Total energy: {result.total_energy_wh} Wh")
    print(f"Total time: {result.total_time_s:.0f}s ({result.total_time_s/60:.1f} min)")
    print(f"Total distance: {result.total_distance_m:.0f}m ({result.total_distance_m/1000:.2f} km)")
    print(f"Battery final: {result.battery_final_pct:.1f}%")

    print(f"\nSegments ({len(result.segments)}):")
    for seg in result.segments:
        if "from" in seg:
            print(f"  {seg['from']} -> {seg['to']}: {seg['distance_m']}m, "
                  f"{seg['total_energy_wh']} Wh, {seg['total_time_s']}s")
        else:
            print(f"  HOVER at {seg['location']}: {seg['energy_wh']} Wh, {seg['hover_duration_s']}s")

    print("\n=== Scenario Comparison ===\n")
    scenarios = simulate_scenarios(route, payload)
    for name, data in scenarios.items():
        print(f"{name}:")
        print(f"  Feasible: {data['feasible']}, Energy: {data['total_energy_wh']} Wh, "
              f"Penalty: x{data['weather_penalty']:.2f}, Ratio: {data['energy_ratio']:.2f}")
