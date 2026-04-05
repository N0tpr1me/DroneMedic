"""Physics API — exposes drone specs, energy budget, and trajectory simulation."""
from __future__ import annotations

import math

from fastapi import APIRouter
from pydantic import BaseModel

from backend.physics import (
    DroneSpec,
    compute_hover_power,
    compute_cruise_power,
    compute_climb_power,
    compute_descent_power,
    compute_mtom,
    compute_twr,
    compute_mission_energy,
    compute_energy_per_km,
    haversine_m,
    route_distance_m,
    CRUISE_POWER_RATIO,
    CLIMB_POWER_MULTIPLIER,
)
from config import (
    LOCATIONS,
    PHYSICS_AIRFRAME_MASS_KG,
    PHYSICS_BATTERY_MASS_KG,
    PHYSICS_BATTERY_CAPACITY_WH,
    PHYSICS_NUM_ROTORS,
    PHYSICS_PROP_DIAMETER_M,
    PHYSICS_MAX_THRUST_PER_MOTOR_N,
    PHYSICS_CRUISE_SPEED_MS,
    PHYSICS_CRUISE_ALTITUDE_M,
    PHYSICS_CLIMB_RATE_MS,
    PHYSICS_DESCENT_RATE_MS,
    PHYSICS_MAX_SAFE_WIND_MS,
)

router = APIRouter(tags=["physics"])


def _max_range_km(spec: DroneSpec, payload_kg: float) -> float:
    """Compute maximum one-way range in km at cruise speed with no wind."""
    e_per_km = compute_energy_per_km(spec, payload_kg)
    if e_per_km <= 0:
        return 0.0
    return spec.mission_energy_wh / e_per_km


@router.get("/api/physics/drone-specs")
async def get_drone_specs():
    """Return all drone physical specifications."""
    spec = DroneSpec()
    payload = 2.0  # default payload
    return {
        "airframe_mass_kg": PHYSICS_AIRFRAME_MASS_KG,
        "battery_mass_kg": PHYSICS_BATTERY_MASS_KG,
        "battery_capacity_wh": PHYSICS_BATTERY_CAPACITY_WH,
        "usable_wh": PHYSICS_BATTERY_CAPACITY_WH * 0.80,
        "num_rotors": PHYSICS_NUM_ROTORS,
        "prop_diameter_m": PHYSICS_PROP_DIAMETER_M,
        "max_thrust_total_n": PHYSICS_MAX_THRUST_PER_MOTOR_N * PHYSICS_NUM_ROTORS,
        "cruise_speed_ms": PHYSICS_CRUISE_SPEED_MS,
        "cruise_altitude_m": PHYSICS_CRUISE_ALTITUDE_M,
        "climb_rate_ms": PHYSICS_CLIMB_RATE_MS,
        "descent_rate_ms": PHYSICS_DESCENT_RATE_MS,
        "max_wind_ms": PHYSICS_MAX_SAFE_WIND_MS,
        "mtom_kg": compute_mtom(spec, payload),
        "twr": compute_twr(spec, payload),
        "hover_power_w": compute_hover_power(spec, payload),
        "cruise_power_w": compute_cruise_power(spec, payload),
        "max_range_km": _max_range_km(spec, payload),
    }


class EnergyBudgetRequest(BaseModel):
    route: list[str]
    payload_kg: float = 2.0
    wind_speed_ms: float = 0
    wind_direction_deg: float = 0


@router.post("/api/physics/energy-budget")
async def get_energy_budget(req: EnergyBudgetRequest):
    """Compute detailed energy budget for a route."""
    spec = DroneSpec()

    # Use the physics engine's route-based mission energy computation
    budget = compute_mission_energy(spec, req.payload_kg, req.route)
    total_dist = route_distance_m(req.route)

    return {
        "route": req.route,
        "route_distance_m": round(total_dist, 1),
        "cruise_wh": budget.cruise_wh,
        "hover_wh": budget.hover_wh,
        "climb_wh": budget.climb_wh,
        "descent_wh": budget.descent_wh,
        "total_wh": budget.total_wh,
        "available_wh": budget.available_wh,
        "reserve_wh": budget.reserve_wh,
        "ratio": budget.ratio,
        "feasible": budget.feasible,
        "flight_time_s": budget.flight_time_s,
        "max_range_km": budget.max_range_km,
    }


class SimulateRequest(BaseModel):
    route: list[str]
    payload_kg: float = 2.0
    wind_speed_ms: float = 0
    wind_direction_deg: float = 0
    time_step_s: float = 1.0


@router.post("/api/physics/simulate")
async def simulate_mission(req: SimulateRequest):
    """Run full physics simulation and return timestamped trajectory."""
    spec = DroneSpec()
    trajectory: list[dict] = []
    usable_wh = PHYSICS_BATTERY_CAPACITY_WH * 0.80
    battery_wh = usable_wh
    cruise_power = compute_cruise_power(spec, req.payload_kg)
    hover_power = compute_hover_power(spec, req.payload_kg)
    climb_power = compute_climb_power(spec, req.payload_kg)

    t = 0.0
    for i in range(len(req.route) - 1):
        src = LOCATIONS.get(req.route[i])
        dst = LOCATIONS.get(req.route[i + 1])
        if not src or not dst:
            continue

        dist = haversine_m(src, dst)
        bearing_deg = math.degrees(
            math.atan2(dst["lon"] - src["lon"], dst["lat"] - src["lat"])
        )

        # Climb phase
        climb_time = PHYSICS_CRUISE_ALTITUDE_M / PHYSICS_CLIMB_RATE_MS
        for step in range(int(climb_time / req.time_step_s)):
            alt = PHYSICS_CLIMB_RATE_MS * step * req.time_step_s
            energy = climb_power * req.time_step_s / 3600
            battery_wh -= energy
            trajectory.append({
                "t": round(t, 1),
                "lat": src["lat"],
                "lon": src["lon"],
                "alt": round(alt, 1),
                "speed": 0,
                "heading": round(bearing_deg, 1),
                "phase": "climb",
                "power_w": round(climb_power),
                "battery_pct": round(battery_wh / usable_wh * 100, 1),
                "battery_wh": round(battery_wh, 1),
            })
            t += req.time_step_s

        # Cruise phase
        cruise_time = dist / PHYSICS_CRUISE_SPEED_MS
        steps = max(1, int(cruise_time / req.time_step_s))
        for step in range(steps):
            frac = step / steps
            lat = src["lat"] + (dst["lat"] - src["lat"]) * frac
            lon = src["lon"] + (dst["lon"] - src["lon"]) * frac
            energy = cruise_power * req.time_step_s / 3600
            battery_wh -= energy
            trajectory.append({
                "t": round(t, 1),
                "lat": round(lat, 6),
                "lon": round(lon, 6),
                "alt": PHYSICS_CRUISE_ALTITUDE_M,
                "speed": PHYSICS_CRUISE_SPEED_MS,
                "heading": round(bearing_deg, 1),
                "phase": "cruise",
                "power_w": round(cruise_power),
                "battery_pct": round(battery_wh / usable_wh * 100, 1),
                "battery_wh": round(battery_wh, 1),
            })
            t += req.time_step_s

        # Hover at waypoint (delivery stops, not return-to-depot)
        if i > 0 or req.route[i + 1] != req.route[0]:
            hover_time = 120  # 2 min per stop
            for step in range(int(hover_time / req.time_step_s)):
                energy = hover_power * req.time_step_s / 3600
                battery_wh -= energy
                trajectory.append({
                    "t": round(t, 1),
                    "lat": dst["lat"],
                    "lon": dst["lon"],
                    "alt": PHYSICS_CRUISE_ALTITUDE_M,
                    "speed": 0,
                    "heading": round(bearing_deg, 1),
                    "phase": "hover",
                    "power_w": round(hover_power),
                    "battery_pct": round(battery_wh / usable_wh * 100, 1),
                    "battery_wh": round(battery_wh, 1),
                })
                t += req.time_step_s

    return {
        "route": req.route,
        "trajectory": trajectory,
        "total_time_s": round(t, 1),
        "final_battery_pct": round(battery_wh / usable_wh * 100, 1),
        "points": len(trajectory),
    }
