"""
DroneMedic - Aerospace Physics Engine

Credible engineering model for multirotor UAV flight feasibility.
Computes thrust, power, energy, range, and endurance from first principles.
All equations are conservative, real-world-grounded estimates.

Reference airframe: industrial hex-copter (6 motors, 18" props).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from config import LOCATIONS


# ═══════════════════════════════════════════════════════════════════════
# Constants
# ═══════════════════════════════════════════════════════════════════════

GRAVITY = 9.81  # m/s²
AIR_DENSITY_SEA_LEVEL = 1.225  # kg/m³

# ── Airframe defaults (conservative industrial hex) ──────────────────

AIRFRAME_MASS_KG = 8.0            # carbon-fibre hex frame + avionics
BATTERY_MASS_KG = 4.0             # 2× high-density LiPo packs
BATTERY_CAPACITY_WH = 800.0       # nominal energy at pack level
USABLE_BATTERY_FRACTION = 0.80    # LiPo safe discharge to ~20% SoC
RESERVE_BATTERY_FRACTION = 0.15   # of usable — untouchable for emergency divert + landing
MAX_PAYLOAD_KG = 5.0              # structural and thrust limit

# ── Propulsion ───────────────────────────────────────────────────────

NUM_ROTORS = 6
PROP_DIAMETER_M = 0.457           # 18-inch props
TOTAL_DISK_AREA_M2 = NUM_ROTORS * math.pi * (PROP_DIAMETER_M / 2) ** 2  # ~0.985 m²
PROPULSIVE_EFFICIENCY = 0.60      # motor + ESC + prop combined
MAX_THRUST_PER_MOTOR_N = 60.0     # at full throttle
MIN_TWR = 1.5                     # minimum thrust-to-weight ratio for safe flight
PREFERRED_TWR = 2.0               # preferred for wind tolerance

# ── Flight profile ───────────────────────────────────────────────────

CRUISE_SPEED_MS = 15.0            # optimal cruise (m/s)
MAX_ENDURANCE_SPEED_MS = 11.0     # slower = less ground speed but saves power
CLIMB_RATE_MS = 3.0               # vertical climb
DESCENT_RATE_MS = 2.0             # controlled descent
CRUISE_ALTITUDE_M = 80.0          # operating altitude AGL

# ── Cruise power ratio ───────────────────────────────────────────────
# For a multirotor, forward flight at optimal speed uses ~60-75% of hover power
CRUISE_POWER_RATIO = 0.70
CLIMB_POWER_MULTIPLIER = 1.30     # climb uses 130% of hover power
DESCENT_POWER_MULTIPLIER = 0.50   # controlled descent uses 50% of hover power

# ── Mission constraints ──────────────────────────────────────────────

HOVER_TIME_PER_STOP_S = 120.0     # 2 minutes per delivery stop (land, drop, takeoff)
MAX_FLIGHT_TIME_S = 2400.0        # hard cap: 40 minutes for battery health
MAX_WEATHER_PENALTY = 3.0         # auto no-go above this

# ── Temperature ──────────────────────────────────────────────────────

MIN_OPERATING_TEMP_C = -10.0
MAX_OPERATING_TEMP_C = 45.0

# ── Wind ─────────────────────────────────────────────────────────────

MAX_SAFE_WIND_MS = 12.0           # sustained — beyond this, abort


# ═══════════════════════════════════════════════════════════════════════
# Data classes
# ═══════════════════════════════════════════════════════════════════════

@dataclass
class DroneSpec:
    """Physical specification of a drone airframe."""
    airframe_mass_kg: float = AIRFRAME_MASS_KG
    battery_mass_kg: float = BATTERY_MASS_KG
    battery_capacity_wh: float = BATTERY_CAPACITY_WH
    usable_fraction: float = USABLE_BATTERY_FRACTION
    reserve_fraction: float = RESERVE_BATTERY_FRACTION
    max_payload_kg: float = MAX_PAYLOAD_KG
    num_rotors: int = NUM_ROTORS
    prop_diameter_m: float = PROP_DIAMETER_M
    max_thrust_per_motor_n: float = MAX_THRUST_PER_MOTOR_N
    cruise_speed_ms: float = CRUISE_SPEED_MS
    endurance_speed_ms: float = MAX_ENDURANCE_SPEED_MS
    climb_rate_ms: float = CLIMB_RATE_MS
    descent_rate_ms: float = DESCENT_RATE_MS
    cruise_altitude_m: float = CRUISE_ALTITUDE_M

    @property
    def disk_area_m2(self) -> float:
        return self.num_rotors * math.pi * (self.prop_diameter_m / 2) ** 2

    @property
    def max_total_thrust_n(self) -> float:
        return self.num_rotors * self.max_thrust_per_motor_n

    @property
    def usable_energy_wh(self) -> float:
        return self.battery_capacity_wh * self.usable_fraction

    @property
    def reserve_energy_wh(self) -> float:
        return self.usable_energy_wh * self.reserve_fraction

    @property
    def mission_energy_wh(self) -> float:
        """Energy available for the mission (usable minus reserve)."""
        return self.usable_energy_wh - self.reserve_energy_wh


@dataclass
class FlightConditions:
    """Current environmental conditions."""
    headwind_ms: float = 0.0
    crosswind_ms: float = 0.0
    precipitation_mmh: float = 0.0
    temperature_c: float = 18.0
    turbulence: str = "calm"  # calm, light, moderate, severe
    air_density: float = AIR_DENSITY_SEA_LEVEL


@dataclass
class EnergyBudget:
    """Complete energy breakdown for a mission."""
    cruise_wh: float = 0.0
    hover_wh: float = 0.0
    climb_wh: float = 0.0
    descent_wh: float = 0.0
    total_wh: float = 0.0
    available_wh: float = 0.0
    reserve_wh: float = 0.0
    ratio: float = 0.0            # available / total_needed
    feasible: bool = False
    flight_time_s: float = 0.0
    max_range_km: float = 0.0
    details: dict = field(default_factory=dict)


@dataclass
class WeatherPenalty:
    """Breakdown of weather-related energy penalties."""
    k_wind: float = 1.0
    k_precip: float = 1.0
    k_temp: float = 1.0
    k_turbulence: float = 1.0
    k_total: float = 1.0
    flyable: bool = True
    reasons: list = field(default_factory=list)


# ═══════════════════════════════════════════════════════════════════════
# Core physics functions
# ═══════════════════════════════════════════════════════════════════════

def compute_mtom(spec: DroneSpec, payload_kg: float) -> float:
    """Maximum takeoff mass (kg)."""
    return spec.airframe_mass_kg + spec.battery_mass_kg + payload_kg


def compute_twr(spec: DroneSpec, payload_kg: float) -> float:
    """Thrust-to-weight ratio at given payload."""
    mtom = compute_mtom(spec, payload_kg)
    weight_n = mtom * GRAVITY
    return spec.max_total_thrust_n / weight_n


def check_thrust_feasibility(spec: DroneSpec, payload_kg: float) -> dict:
    """
    Check if the drone can generate enough thrust at the given payload.
    Returns dict with twr, feasible flag, and margin info.
    """
    twr = compute_twr(spec, payload_kg)
    mtom = compute_mtom(spec, payload_kg)
    weight_n = mtom * GRAVITY
    required_thrust_n = weight_n * MIN_TWR
    preferred_thrust_n = weight_n * PREFERRED_TWR

    # Motor-out survivability (hex loses 1 motor)
    motor_out_thrust = spec.max_total_thrust_n * (spec.num_rotors - 1) / spec.num_rotors
    motor_out_twr = motor_out_thrust / weight_n

    return {
        "mtom_kg": round(mtom, 2),
        "weight_n": round(weight_n, 1),
        "max_thrust_n": round(spec.max_total_thrust_n, 1),
        "twr": round(twr, 2),
        "min_twr": MIN_TWR,
        "preferred_twr": PREFERRED_TWR,
        "feasible": twr >= MIN_TWR,
        "preferred": twr >= PREFERRED_TWR,
        "motor_out_twr": round(motor_out_twr, 2),
        "motor_out_survivable": motor_out_twr >= 1.0,
        "required_thrust_n": round(required_thrust_n, 1),
        "thrust_margin_pct": round((twr / MIN_TWR - 1) * 100, 1),
    }


def compute_hover_power(spec: DroneSpec, payload_kg: float,
                        air_density: float = AIR_DENSITY_SEA_LEVEL) -> float:
    """
    Hover power in watts using actuator disk theory + efficiency losses.

    P_hover = (MTOM × g)^(3/2) / sqrt(2 × ρ × A_disk) / η
    """
    mtom = compute_mtom(spec, payload_kg)
    weight_n = mtom * GRAVITY

    # Ideal actuator disk power
    p_ideal = (weight_n ** 1.5) / math.sqrt(2 * air_density * spec.disk_area_m2)

    # Real power from battery (accounting for propulsive efficiency)
    p_real = p_ideal / PROPULSIVE_EFFICIENCY

    return p_real


def compute_cruise_power(spec: DroneSpec, payload_kg: float,
                         air_density: float = AIR_DENSITY_SEA_LEVEL) -> float:
    """
    Cruise power at optimal forward speed.
    Multirotors are more efficient in forward flight: ~70% of hover power.
    """
    p_hover = compute_hover_power(spec, payload_kg, air_density)
    return p_hover * CRUISE_POWER_RATIO


def compute_climb_power(spec: DroneSpec, payload_kg: float,
                        air_density: float = AIR_DENSITY_SEA_LEVEL) -> float:
    """Power during vertical climb."""
    p_hover = compute_hover_power(spec, payload_kg, air_density)
    return p_hover * CLIMB_POWER_MULTIPLIER


def compute_descent_power(spec: DroneSpec, payload_kg: float,
                          air_density: float = AIR_DENSITY_SEA_LEVEL) -> float:
    """Power during controlled descent."""
    p_hover = compute_hover_power(spec, payload_kg, air_density)
    return p_hover * DESCENT_POWER_MULTIPLIER


def compute_energy_per_km(spec: DroneSpec, payload_kg: float,
                          ground_speed_ms: float = None,
                          air_density: float = AIR_DENSITY_SEA_LEVEL) -> float:
    """
    Energy consumption per km of ground travel (Wh/km).

    E_per_km = P_cruise / v_ground  (W / (m/s) = J/m = Wh/km × 3.6)
    """
    if ground_speed_ms is None:
        ground_speed_ms = spec.cruise_speed_ms

    if ground_speed_ms <= 0:
        return float('inf')  # can't make forward progress

    p_cruise = compute_cruise_power(spec, payload_kg, air_density)
    # W / (m/s) gives J/m, multiply by 1000/3600 = 1/3.6 to get Wh/km
    return (p_cruise / ground_speed_ms) * (1000 / 3600)


def compute_vertical_energy(spec: DroneSpec, payload_kg: float,
                            altitude_m: float, num_cycles: int = 1) -> float:
    """
    Energy for climb + descent cycles (Wh).
    Each cycle = one ascent to altitude_m + one descent from altitude_m.
    """
    p_climb = compute_climb_power(spec, payload_kg)
    p_descent = compute_descent_power(spec, payload_kg)

    t_climb_s = altitude_m / spec.climb_rate_ms
    t_descent_s = altitude_m / spec.descent_rate_ms

    e_climb = (p_climb * t_climb_s / 3600) * num_cycles
    e_descent = (p_descent * t_descent_s / 3600) * num_cycles

    return e_climb + e_descent


def compute_hover_energy(spec: DroneSpec, payload_kg: float,
                         hover_time_s: float) -> float:
    """Energy consumed while hovering for a given duration (Wh)."""
    p_hover = compute_hover_power(spec, payload_kg)
    return p_hover * hover_time_s / 3600


def compute_hover_energy_per_minute(spec: DroneSpec, payload_kg: float) -> float:
    """Energy cost per minute of unplanned hovering (Wh)."""
    return compute_hover_energy(spec, payload_kg, 60.0)


# ═══════════════════════════════════════════════════════════════════════
# Weather penalty model
# ═══════════════════════════════════════════════════════════════════════

def compute_weather_penalty(conditions: FlightConditions) -> WeatherPenalty:
    """
    Compute compound weather penalty factor.

    effective_energy = base_energy × K_wind × K_precip × K_temp × K_turbulence
    """
    reasons = []

    # ── Wind penalty ─────────────────────────────────────────────────
    # Headwind: K = (v_cruise / (v_cruise - v_headwind))²
    # Ground speed drops, time in air increases, drag increases
    v_cruise = CRUISE_SPEED_MS
    v_head = abs(conditions.headwind_ms)

    if v_head >= v_cruise:
        # Drone cannot make forward progress
        return WeatherPenalty(
            k_wind=float('inf'), k_total=float('inf'),
            flyable=False, reasons=["Headwind exceeds cruise speed — no forward progress"]
        )

    if v_head >= MAX_SAFE_WIND_MS:
        return WeatherPenalty(
            k_wind=float('inf'), k_total=float('inf'),
            flyable=False, reasons=[f"Wind {v_head:.1f} m/s exceeds safe limit {MAX_SAFE_WIND_MS} m/s"]
        )

    k_wind = (v_cruise / (v_cruise - v_head)) ** 2
    # Crosswind adds a smaller penalty
    v_cross = abs(conditions.crosswind_ms)
    k_crosswind = 1.0 + 0.3 * (v_cross / v_cruise) ** 2
    k_wind *= k_crosswind

    if k_wind > 1.05:
        reasons.append(f"Wind penalty ×{k_wind:.2f} (head={v_head:.1f}, cross={v_cross:.1f} m/s)")

    # ── Precipitation penalty ────────────────────────────────────────
    precip = conditions.precipitation_mmh
    if precip > 10.0:
        return WeatherPenalty(
            k_precip=float('inf'), k_total=float('inf'),
            flyable=False, reasons=["Storm/heavy precipitation — NO-GO"]
        )
    elif precip > 5.0:
        k_precip = 1.30
        reasons.append(f"Heavy rain ({precip:.1f} mm/h): ×1.30 penalty")
    elif precip > 2.0:
        k_precip = 1.15
        reasons.append(f"Moderate rain ({precip:.1f} mm/h): ×1.15 penalty")
    elif precip > 0.5:
        k_precip = 1.05
        reasons.append(f"Light rain ({precip:.1f} mm/h): ×1.05 penalty")
    else:
        k_precip = 1.0

    # ── Temperature penalty ──────────────────────────────────────────
    temp = conditions.temperature_c
    if temp < MIN_OPERATING_TEMP_C or temp > MAX_OPERATING_TEMP_C:
        return WeatherPenalty(
            k_temp=float('inf'), k_total=float('inf'),
            flyable=False,
            reasons=[f"Temperature {temp:.1f}°C outside safe range [{MIN_OPERATING_TEMP_C}, {MAX_OPERATING_TEMP_C}]"]
        )
    elif temp < 0:
        k_temp = 1.25
        reasons.append(f"Sub-zero ({temp:.1f}°C): ×1.25 (battery capacity loss + icing risk)")
    elif temp < 10:
        k_temp = 1.12
        reasons.append(f"Cold ({temp:.1f}°C): ×1.12 (battery capacity reduced ~10–15%)")
    elif temp < 20:
        k_temp = 1.05
        reasons.append(f"Cool ({temp:.1f}°C): ×1.05 (mild cold penalty)")
    elif temp > 40:
        k_temp = 1.08
        reasons.append(f"Hot ({temp:.1f}°C): ×1.08 (lower air density, motor heat)")
    else:
        k_temp = 1.0

    # ── Turbulence penalty ───────────────────────────────────────────
    turb_map = {"calm": 1.0, "light": 1.05, "moderate": 1.15, "severe": float('inf')}
    k_turbulence = turb_map.get(conditions.turbulence, 1.0)

    if conditions.turbulence == "severe":
        return WeatherPenalty(
            k_turbulence=float('inf'), k_total=float('inf'),
            flyable=False, reasons=["Severe turbulence — structural / control risk — NO-GO"]
        )
    if k_turbulence > 1.0:
        reasons.append(f"Turbulence ({conditions.turbulence}): ×{k_turbulence:.2f}")

    # ── Compound total ───────────────────────────────────────────────
    k_total = k_wind * k_precip * k_temp * k_turbulence
    flyable = k_total <= MAX_WEATHER_PENALTY

    if not flyable:
        reasons.append(f"Combined weather penalty ×{k_total:.2f} exceeds limit ×{MAX_WEATHER_PENALTY:.1f} — NO-GO")

    return WeatherPenalty(
        k_wind=round(k_wind, 3),
        k_precip=round(k_precip, 3),
        k_temp=round(k_temp, 3),
        k_turbulence=round(k_turbulence, 3),
        k_total=round(k_total, 3),
        flyable=flyable,
        reasons=reasons,
    )


# ═══════════════════════════════════════════════════════════════════════
# Distance helpers
# ═══════════════════════════════════════════════════════════════════════

def haversine_m(loc1: dict, loc2: dict) -> float:
    """Distance in meters between two locations using GPS coords."""
    R = 6371000
    lat1, lon1 = math.radians(loc1["lat"]), math.radians(loc1["lon"])
    lat2, lon2 = math.radians(loc2["lat"]), math.radians(loc2["lon"])
    dlat, dlon = lat2 - lat1, lon2 - lon1
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def route_distance_m(route: list[str]) -> float:
    """Total route distance in meters (GPS-based)."""
    total = 0.0
    for i in range(len(route) - 1):
        if route[i] in LOCATIONS and route[i + 1] in LOCATIONS:
            total += haversine_m(LOCATIONS[route[i]], LOCATIONS[route[i + 1]])
    return total


# ═══════════════════════════════════════════════════════════════════════
# Mission energy budget
# ═══════════════════════════════════════════════════════════════════════

def compute_mission_energy(
    spec: DroneSpec,
    payload_kg: float,
    route: list[str],
    conditions: FlightConditions = None,
    num_stops: int = None,
) -> EnergyBudget:
    """
    Compute full energy budget for a mission.

    Accounts for cruise, hover at stops, vertical ascent/descent,
    and weather penalties.
    """
    if conditions is None:
        conditions = FlightConditions()

    # Weather penalty
    wp = compute_weather_penalty(conditions)

    if not wp.flyable:
        return EnergyBudget(
            feasible=False,
            available_wh=spec.mission_energy_wh,
            reserve_wh=spec.reserve_energy_wh,
            details={"weather_penalty": wp.__dict__, "reason": "Weather NO-GO"},
        )

    # Route distance
    total_dist_m = route_distance_m(route)
    total_dist_km = total_dist_m / 1000.0

    # Ground speed accounting for headwind
    ground_speed = max(spec.cruise_speed_ms - abs(conditions.headwind_ms), 1.0)

    # Cruise energy
    e_per_km = compute_energy_per_km(spec, payload_kg, ground_speed, conditions.air_density)
    e_cruise = e_per_km * total_dist_km

    # Number of stops (excluding depot at start and end)
    if num_stops is None:
        num_stops = max(len(set(route)) - 1, 0)  # unique non-depot stops
        if "Depot" in route:
            num_stops = max(num_stops - 1, 0)

    # Hover energy at delivery stops
    e_hover = compute_hover_energy(spec, payload_kg, HOVER_TIME_PER_STOP_S * num_stops)

    # Vertical energy: climb/descent at each stop + initial takeoff + final landing
    num_vertical_cycles = num_stops + 1  # takeoff + each stop has ascent/descent
    e_vertical = compute_vertical_energy(spec, payload_kg, spec.cruise_altitude_m, num_vertical_cycles)

    # Total base energy
    e_base = e_cruise + e_hover + e_vertical

    # Apply weather penalty (only to cruise, not hover/vertical which are already affected)
    # The weather penalty captures headwind in cruise, but we already used ground_speed.
    # Apply remaining precipitation/temp/turbulence to total
    k_non_wind = wp.k_precip * wp.k_temp * wp.k_turbulence
    e_total = e_cruise + (e_hover * k_non_wind) + (e_vertical * k_non_wind)

    # Available energy
    e_available = spec.mission_energy_wh
    e_reserve = spec.reserve_energy_wh

    # Feasibility ratio
    ratio = e_available / e_total if e_total > 0 else float('inf')
    feasible = ratio >= 1.0

    # Flight time estimate
    cruise_time_s = (total_dist_m / ground_speed) if ground_speed > 0 else float('inf')
    hover_time_s = HOVER_TIME_PER_STOP_S * num_stops
    vertical_time_s = num_vertical_cycles * (
        spec.cruise_altitude_m / spec.climb_rate_ms +
        spec.cruise_altitude_m / spec.descent_rate_ms
    )
    total_time_s = cruise_time_s + hover_time_s + vertical_time_s

    # Max range at current conditions
    max_range_km = (e_available / e_per_km) if e_per_km > 0 else 0

    return EnergyBudget(
        cruise_wh=round(e_cruise, 1),
        hover_wh=round(e_hover, 1),
        climb_wh=round(e_vertical / 2, 1),
        descent_wh=round(e_vertical / 2, 1),
        total_wh=round(e_total, 1),
        available_wh=round(e_available, 1),
        reserve_wh=round(e_reserve, 1),
        ratio=round(ratio, 3),
        feasible=feasible,
        flight_time_s=round(total_time_s, 1),
        max_range_km=round(max_range_km, 1),
        details={
            "route_distance_m": round(total_dist_m, 1),
            "route_distance_km": round(total_dist_km, 2),
            "ground_speed_ms": round(ground_speed, 1),
            "energy_per_km_wh": round(e_per_km, 1),
            "num_stops": num_stops,
            "num_vertical_cycles": num_vertical_cycles,
            "hover_power_w": round(compute_hover_power(spec, payload_kg), 1),
            "cruise_power_w": round(compute_cruise_power(spec, payload_kg), 1),
            "weather_penalty": wp.__dict__,
            "hover_cost_per_min_wh": round(compute_hover_energy_per_minute(spec, payload_kg), 1),
        },
    )


def compute_divert_energy(
    spec: DroneSpec,
    payload_kg: float,
    current_position: dict,
    safe_point: dict,
    conditions: FlightConditions = None,
    safety_margin: float = 1.3,
) -> float:
    """
    Energy needed to divert from current position to a safe landing point.
    Includes a 1.3× safety margin.
    """
    if conditions is None:
        conditions = FlightConditions()

    dist_m = haversine_m(current_position, safe_point)
    ground_speed = max(spec.cruise_speed_ms - abs(conditions.headwind_ms), 1.0)
    e_per_km = compute_energy_per_km(spec, payload_kg, ground_speed, conditions.air_density)
    e_cruise = e_per_km * (dist_m / 1000.0)

    # One descent to land
    e_descent = compute_vertical_energy(spec, payload_kg, spec.cruise_altitude_m, 1) / 2

    return (e_cruise + e_descent) * safety_margin


def find_nearest_safe_point(current_position: dict) -> tuple[str, dict]:
    """Find the nearest location to the current position (for emergency divert)."""
    best_name = "Depot"
    best_dist = float('inf')

    for name, loc in LOCATIONS.items():
        d = haversine_m(current_position, loc)
        if d < best_dist:
            best_dist = d
            best_name = name

    return best_name, LOCATIONS[best_name]


# ═══════════════════════════════════════════════════════════════════════
# Quick self-test
# ═══════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    spec = DroneSpec()
    payload = 2.5

    print("=== DroneMedic Physics Engine ===\n")

    print(f"Airframe: {spec.airframe_mass_kg} kg")
    print(f"Battery: {spec.battery_mass_kg} kg / {spec.battery_capacity_wh} Wh")
    print(f"Usable energy: {spec.usable_energy_wh:.0f} Wh")
    print(f"Reserve: {spec.reserve_energy_wh:.0f} Wh")
    print(f"Mission energy: {spec.mission_energy_wh:.0f} Wh")
    print(f"Payload: {payload} kg")
    print(f"MTOM: {compute_mtom(spec, payload):.1f} kg\n")

    thrust = check_thrust_feasibility(spec, payload)
    print(f"TWR: {thrust['twr']} (min: {thrust['min_twr']})")
    print(f"Thrust feasible: {thrust['feasible']}")
    print(f"Motor-out survivable: {thrust['motor_out_survivable']}\n")

    print(f"Hover power: {compute_hover_power(spec, payload):.0f} W")
    print(f"Cruise power: {compute_cruise_power(spec, payload):.0f} W")
    print(f"Energy/km: {compute_energy_per_km(spec, payload):.1f} Wh/km")
    print(f"Hover cost/min: {compute_hover_energy_per_minute(spec, payload):.1f} Wh\n")

    route = ["Depot", "Clinic B", "Clinic A", "Clinic C", "Depot"]
    budget = compute_mission_energy(spec, payload, route)
    print(f"Route: {' -> '.join(route)}")
    print(f"Distance: {budget.details['route_distance_km']:.2f} km")
    print(f"Energy needed: {budget.total_wh:.0f} Wh")
    print(f"Energy available: {budget.available_wh:.0f} Wh")
    print(f"Ratio: {budget.ratio:.2f}")
    print(f"Feasible: {budget.feasible}")
    print(f"Flight time: {budget.flight_time_s:.0f}s ({budget.flight_time_s/60:.1f} min)")
