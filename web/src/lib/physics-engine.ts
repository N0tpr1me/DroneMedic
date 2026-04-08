/**
 * DroneMedic - Browser Physics Engine (TypeScript)
 *
 * Port of backend/physics.py for 60fps client-side simulation.
 * Actuator-disk hover model, energy budgeting, haversine nav, and
 * a per-frame step function that drives the 3D dashboard drone.
 */

// ===================================================================
// Constants
// ===================================================================

export const DRONE = {
  airframeMass: 8.0,
  batteryMass: 4.0,
  batteryCapacity: 800,
  usableFraction: 0.80,
  reserveFraction: 0.15,
  numRotors: 6,
  propDiameter: 0.457,
  maxThrustPerMotor: 60,
  cruiseSpeed: 15.0,
  climbRate: 3.0,
  descentRate: 2.0,
  cruiseAltitude: 80.0,
  maxWind: 12.0,
  maxBankAngle: 30,
  propulsiveEfficiency: 0.60,
  gravity: 9.81,
  airDensity: 1.225,
  cruisePowerRatio: 0.70,
  climbPowerRatio: 1.30,
  descentPowerRatio: 0.50,
  maxAcceleration: 3.0,
  maxDeceleration: 2.0,
} as const;

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;
const EARTH_R = 6_371_000; // metres

// ===================================================================
// Interfaces
// ===================================================================

export interface DroneState {
  lat: number;
  lon: number;
  alt: number;
  vx: number;
  vy: number;
  vz: number;
  speed: number;
  heading: number;
  bank: number;
  pitch: number;
  battery_wh: number;
  battery_pct: number;
  power_w: number;
  phase: 'preflight' | 'climb' | 'cruise' | 'descend' | 'hover' | 'landed';
  payloadKg: number;
}

export interface WindVector {
  speed: number;
  direction: number;
}

export interface EnergyBudget {
  cruise_wh: number;
  hover_wh: number;
  climb_wh: number;
  descent_wh: number;
  total_wh: number;
  available_wh: number;
  reserve_wh: number;
  ratio: number;
  feasible: boolean;
  max_range_km: number;
  flight_time_s: number;
}

// ===================================================================
// Helpers
// ===================================================================

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function toRad(d: number): number {
  return d * DEG;
}

function toDeg(r: number): number {
  return r * RAD;
}

/** Disk area for all rotors combined (m^2). */
function diskArea(): number {
  const r = DRONE.propDiameter / 2;
  return DRONE.numRotors * Math.PI * r * r;
}

// ===================================================================
// Core physics (matching backend/physics.py)
// ===================================================================

/** Maximum take-off mass (kg). */
export function computeMTOM(payloadKg: number): number {
  return DRONE.airframeMass + DRONE.batteryMass + payloadKg;
}

/** Thrust-to-weight ratio at given payload. */
export function computeTWR(payloadKg: number): number {
  const mtom = computeMTOM(payloadKg);
  const weightN = mtom * DRONE.gravity;
  return (DRONE.numRotors * DRONE.maxThrustPerMotor) / weightN;
}

/**
 * Hover power (W) via actuator disk theory.
 *
 *   P = (MTOM * g)^1.5 / sqrt(2 * rho * A_disk) / eta
 */
export function computeHoverPower(payloadKg: number): number {
  const mtom = computeMTOM(payloadKg);
  const weightN = mtom * DRONE.gravity;
  const pIdeal =
    Math.pow(weightN, 1.5) /
    Math.sqrt(2 * DRONE.airDensity * diskArea());
  return pIdeal / DRONE.propulsiveEfficiency;
}

/** Cruise power (W) -- hover * 0.70. */
export function computeCruisePower(payloadKg: number): number {
  return computeHoverPower(payloadKg) * DRONE.cruisePowerRatio;
}

/** Climb power (W) -- hover * 1.30. */
export function computeClimbPower(payloadKg: number): number {
  return computeHoverPower(payloadKg) * DRONE.climbPowerRatio;
}

/** Descent power (W) -- hover * 0.50. */
export function computeDescentPower(payloadKg: number): number {
  return computeHoverPower(payloadKg) * DRONE.descentPowerRatio;
}

/**
 * Energy per kilometre of ground travel (Wh/km).
 *
 *   E = P_cruise / v_ground * (1000 / 3600)
 */
export function computeEnergyPerKm(
  payloadKg: number,
  headwindMs: number = 0,
): number {
  const groundSpeed = Math.max(DRONE.cruiseSpeed - Math.abs(headwindMs), 1);
  if (groundSpeed <= 0) return Infinity;
  const pCruise = computeCruisePower(payloadKg);
  return (pCruise / groundSpeed) * (1000 / 3600);
}

/** Theoretical max range (km) given remaining battery energy. */
export function computeMaxRange(
  batteryWh: number,
  payloadKg: number,
): number {
  const ePerKm = computeEnergyPerKm(payloadKg);
  return ePerKm > 0 ? batteryWh / ePerKm : 0;
}

/**
 * Full mission energy budget (matches compute_mission_energy in physics.py).
 */
export function computeEnergyBudget(
  routeDistanceM: number,
  numStops: number,
  payloadKg: number,
  windMs: number = 0,
): EnergyBudget {
  const groundSpeed = Math.max(DRONE.cruiseSpeed - Math.abs(windMs), 1);
  const ePerKm = computeEnergyPerKm(payloadKg, windMs);
  const distKm = routeDistanceM / 1000;

  // Cruise energy
  const cruiseWh = ePerKm * distKm;

  // Hover energy at delivery stops (2 min each)
  const hoverTimeS = 120 * numStops;
  const hoverWh = (computeHoverPower(payloadKg) * hoverTimeS) / 3600;

  // Vertical cycles: takeoff + one per stop
  const numCycles = numStops + 1;
  const tClimb = DRONE.cruiseAltitude / DRONE.climbRate;
  const tDescend = DRONE.cruiseAltitude / DRONE.descentRate;
  const climbWh =
    (computeClimbPower(payloadKg) * tClimb * numCycles) / 3600;
  const descentWh =
    (computeDescentPower(payloadKg) * tDescend * numCycles) / 3600;

  const totalWh = cruiseWh + hoverWh + climbWh + descentWh;

  const usable = DRONE.batteryCapacity * DRONE.usableFraction;
  const reserve = usable * DRONE.reserveFraction;
  const available = usable - reserve;
  const ratio = totalWh > 0 ? available / totalWh : Infinity;

  // Flight time
  const cruiseTimeS = groundSpeed > 0 ? routeDistanceM / groundSpeed : Infinity;
  const verticalTimeS =
    numCycles * (tClimb + tDescend);
  const flightTimeS = cruiseTimeS + hoverTimeS + verticalTimeS;

  const maxRangeKm = ePerKm > 0 ? available / ePerKm : 0;

  return {
    cruise_wh: Math.round(cruiseWh * 10) / 10,
    hover_wh: Math.round(hoverWh * 10) / 10,
    climb_wh: Math.round(climbWh * 10) / 10,
    descent_wh: Math.round(descentWh * 10) / 10,
    total_wh: Math.round(totalWh * 10) / 10,
    available_wh: Math.round(available * 10) / 10,
    reserve_wh: Math.round(reserve * 10) / 10,
    ratio: Math.round(ratio * 1000) / 1000,
    feasible: ratio >= 1.0,
    max_range_km: Math.round(maxRangeKm * 10) / 10,
    flight_time_s: Math.round(flightTimeS * 10) / 10,
  };
}

// ===================================================================
// Geo helpers
// ===================================================================

/** Great-circle distance in metres (haversine). */
export function haversineM(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Initial bearing in degrees (0 = north, 90 = east). */
export function bearing(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLon = toRad(lon2 - lon1);
  const la1 = toRad(lat1);
  const la2 = toRad(lat2);
  const x = Math.sin(dLon) * Math.cos(la2);
  const y =
    Math.cos(la1) * Math.sin(la2) -
    Math.sin(la1) * Math.cos(la2) * Math.cos(dLon);
  return ((toDeg(Math.atan2(x, y)) % 360) + 360) % 360;
}

/** Project a new lat/lon from an origin given distance (m) and bearing (deg). */
export function moveLatLon(
  lat: number,
  lon: number,
  distM: number,
  bearingDeg: number,
): { lat: number; lon: number } {
  const brng = toRad(bearingDeg);
  const la1 = toRad(lat);
  const lo1 = toRad(lon);
  const angDist = distM / EARTH_R;

  const la2 = Math.asin(
    Math.sin(la1) * Math.cos(angDist) +
      Math.cos(la1) * Math.sin(angDist) * Math.cos(brng),
  );
  const lo2 =
    lo1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(angDist) * Math.cos(la1),
      Math.cos(angDist) - Math.sin(la1) * Math.sin(la2),
    );

  return { lat: toDeg(la2), lon: toDeg(lo2) };
}

// ===================================================================
// Per-frame step function
// ===================================================================

/**
 * Advance the drone state by `dt` seconds towards `target`.
 *
 * Called at 60 fps (dt ~ 0.016 s, or scaled for time-warp).
 *
 *  1. Distance / bearing to target
 *  2. Flight phase (climb / cruise / descend / hover)
 *  3. Desired velocity (accelerate / cruise / brake)
 *  4. Wind displacement
 *  5. Bank angle for turns
 *  6. Pitch for accel / decel
 *  7. Position update
 *  8. Power & battery drain
 */
export function stepPhysics(
  state: DroneState,
  target: { lat: number; lon: number; alt: number },
  wind: WindVector,
  dt: number,
): DroneState {
  if (dt <= 0) return state;

  const dist = haversineM(state.lat, state.lon, target.lat, target.lon);
  const altDiff = target.alt - state.alt;
  const tgtBearing = bearing(state.lat, state.lon, target.lat, target.lon);

  // ── 1. Determine phase ──────────────────────────────────────────
  let phase: DroneState['phase'];
  if (state.phase === 'preflight' || state.phase === 'landed') {
    // Transition to climb when we have a target to reach
    phase = dist > 2 || Math.abs(altDiff) > 2 ? 'climb' : 'landed';
  } else if (state.alt < target.alt - 2) {
    phase = 'climb';
  } else if (state.alt > target.alt + 2) {
    phase = 'descend';
  } else if (dist > 5) {
    phase = 'cruise';
  } else {
    phase = 'hover';
  }

  // ── 2. Vertical velocity ────────────────────────────────────────
  let vz = 0;
  if (phase === 'climb') {
    vz = DRONE.climbRate;
  } else if (phase === 'descend') {
    vz = -DRONE.descentRate;
  }

  // ── 3. Horizontal speed target & accel / brake ──────────────────
  let desiredSpeed: number;
  if (phase === 'climb' || phase === 'descend') {
    // Fly horizontally while climbing/descending if target is far
    desiredSpeed = dist > 30 ? DRONE.cruiseSpeed : 0;
  } else if (phase === 'cruise') {
    // Braking distance: v^2 / (2 * a_decel)
    const brakeDist =
      (state.speed * state.speed) / (2 * DRONE.maxDeceleration);
    desiredSpeed = dist > brakeDist + 10 ? DRONE.cruiseSpeed : 0;
  } else {
    desiredSpeed = 0;
  }

  // Acceleration / deceleration
  let speed: number;
  if (desiredSpeed > state.speed) {
    speed = Math.min(
      state.speed + DRONE.maxAcceleration * dt,
      desiredSpeed,
    );
  } else if (desiredSpeed < state.speed) {
    speed = Math.max(
      state.speed - DRONE.maxDeceleration * dt,
      desiredSpeed,
    );
  } else {
    speed = state.speed;
  }

  // ── 4. Wind displacement ────────────────────────────────────────
  // Wind direction is "from", so displacement is in the opposite direction
  const windAngle = toRad(wind.direction + 180);
  const windX = wind.speed * Math.sin(windAngle); // east component
  const windY = wind.speed * Math.cos(windAngle); // north component

  // Drone velocity components (north-east frame)
  const headingRad = toRad(tgtBearing);
  const droneVx = speed * Math.sin(headingRad) + windX;
  const droneVy = speed * Math.cos(headingRad) + windY;

  const groundSpeed = Math.sqrt(droneVx * droneVx + droneVy * droneVy);
  const actualHeading =
    ((toDeg(Math.atan2(droneVx, droneVy)) % 360) + 360) % 360;

  // ── 5. Bank angle (coordinated turn) ────────────────────────────
  let headingDelta = tgtBearing - state.heading;
  // Normalise to [-180, 180]
  if (headingDelta > 180) headingDelta -= 360;
  if (headingDelta < -180) headingDelta += 360;

  const turnRate = dt > 0 ? headingDelta / Math.max(dt, 0.001) : 0;
  // bank = atan(v^2 / (R * g)), approximate via turn-rate
  // R = v / omega => bank = atan(v * omega / g)
  const omegaRad = toRad(turnRate);
  let bankAngle = toDeg(
    Math.atan((speed * Math.abs(omegaRad)) / DRONE.gravity),
  );
  bankAngle = clamp(bankAngle, -DRONE.maxBankAngle, DRONE.maxBankAngle);
  if (headingDelta < 0) bankAngle = -bankAngle;

  // ── 6. Pitch angle ─────────────────────────────────────────────
  let pitch = 0;
  if (speed > state.speed + 0.1) {
    pitch = -5; // nose down during acceleration
  } else if (speed < state.speed - 0.1) {
    pitch = 5; // nose up during braking
  }

  // ── 7. Position update ──────────────────────────────────────────
  const horizDist = groundSpeed * dt;
  const newPos =
    horizDist > 0.001
      ? moveLatLon(state.lat, state.lon, horizDist, actualHeading)
      : { lat: state.lat, lon: state.lon };
  const newAlt = state.alt + vz * dt;

  // ── 8. Power & battery ─────────────────────────────────────────
  let powerW: number;
  switch (phase) {
    case 'climb':
      powerW = computeClimbPower(state.payloadKg);
      break;
    case 'descend':
      powerW = computeDescentPower(state.payloadKg);
      break;
    case 'cruise':
      powerW = computeCruisePower(state.payloadKg);
      break;
    case 'hover':
      powerW = computeHoverPower(state.payloadKg);
      break;
    default:
      powerW = 0;
  }

  const energyUsedWh = (powerW * dt) / 3600;
  const newBatteryWh = Math.max(state.battery_wh - energyUsedWh, 0);
  const newBatteryPct = (newBatteryWh / DRONE.batteryCapacity) * 100;

  return {
    lat: newPos.lat,
    lon: newPos.lon,
    alt: newAlt,
    vx: droneVx,
    vy: droneVy,
    vz,
    speed,
    heading: actualHeading,
    bank: bankAngle,
    pitch,
    battery_wh: newBatteryWh,
    battery_pct: newBatteryPct,
    power_w: powerW,
    phase,
    payloadKg: state.payloadKg,
  };
}

// ===================================================================
// Factory for initial drone state
// ===================================================================

export function createInitialState(
  lat: number,
  lon: number,
  payloadKg: number = 0,
): DroneState {
  const usable = DRONE.batteryCapacity * DRONE.usableFraction;
  return {
    lat,
    lon,
    alt: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    speed: 0,
    heading: 0,
    bank: 0,
    pitch: 0,
    battery_wh: usable,
    battery_pct: (usable / DRONE.batteryCapacity) * 100,
    power_w: 0,
    phase: 'preflight',
    payloadKg,
  };
}

// ===================================================================
// Flight conditions & weather penalty model
// (Ported from backend/physics.py)
// ===================================================================

export interface FlightConditions {
  headwind_ms: number;
  crosswind_ms: number;
  precipitation_mmh: number;
  temperature_c: number;
  turbulence: 'calm' | 'light' | 'moderate' | 'severe';
  air_density: number;
}

export const DEFAULT_CONDITIONS: FlightConditions = {
  headwind_ms: 0,
  crosswind_ms: 0,
  precipitation_mmh: 0,
  temperature_c: 18,
  turbulence: 'calm',
  air_density: 1.225,
};

export interface WeatherPenalty {
  k_wind: number;
  k_crosswind: number;
  k_precip: number;
  k_temp: number;
  k_turbulence: number;
  k_total: number;
  flyable: boolean;
  reasons: string[];
}

const MAX_SAFE_WIND = 12.0;
const MAX_WEATHER_PENALTY = 3.0;
const MIN_OPERATING_TEMP = -10;
const MAX_OPERATING_TEMP = 45;
const MAX_FLIGHT_TIME_S = 2400; // 40 min hard cap for LiPo health

/**
 * Compute compound weather penalty factor.
 * Matches backend/physics.py compute_weather_penalty exactly.
 */
export function computeWeatherPenalty(conditions: FlightConditions): WeatherPenalty {
  const reasons: string[] = [];
  const vCruise = DRONE.cruiseSpeed;
  const vHead = Math.abs(conditions.headwind_ms);

  // Wind penalty — headwind
  if (vHead >= vCruise) {
    return { k_wind: Infinity, k_crosswind: 1, k_precip: 1, k_temp: 1, k_turbulence: 1, k_total: Infinity, flyable: false, reasons: ['Headwind exceeds cruise speed — no forward progress'] };
  }
  if (vHead >= MAX_SAFE_WIND) {
    return { k_wind: Infinity, k_crosswind: 1, k_precip: 1, k_temp: 1, k_turbulence: 1, k_total: Infinity, flyable: false, reasons: [`Wind ${vHead.toFixed(1)} m/s exceeds safe limit ${MAX_SAFE_WIND} m/s`] };
  }

  let k_wind = (vCruise / (vCruise - vHead)) ** 2;

  // Crosswind adds smaller penalty
  const vCross = Math.abs(conditions.crosswind_ms);
  const k_crosswind = 1.0 + 0.3 * (vCross / vCruise) ** 2;
  k_wind *= k_crosswind;

  if (k_wind > 1.05) {
    reasons.push(`Wind penalty ×${k_wind.toFixed(2)} (head=${vHead.toFixed(1)}, cross=${vCross.toFixed(1)} m/s)`);
  }

  // Precipitation penalty
  const precip = conditions.precipitation_mmh;
  let k_precip = 1.0;
  if (precip > 10.0) {
    return { k_wind, k_crosswind, k_precip: Infinity, k_temp: 1, k_turbulence: 1, k_total: Infinity, flyable: false, reasons: ['Storm/heavy precipitation — NO-GO'] };
  } else if (precip > 5.0) {
    k_precip = 1.30;
    reasons.push(`Heavy rain (${precip.toFixed(1)} mm/h): ×1.30 penalty`);
  } else if (precip > 2.0) {
    k_precip = 1.15;
    reasons.push(`Moderate rain (${precip.toFixed(1)} mm/h): ×1.15 penalty`);
  } else if (precip > 0.5) {
    k_precip = 1.05;
    reasons.push(`Light rain (${precip.toFixed(1)} mm/h): ×1.05 penalty`);
  }

  // Temperature penalty
  const temp = conditions.temperature_c;
  let k_temp = 1.0;
  if (temp < MIN_OPERATING_TEMP || temp > MAX_OPERATING_TEMP) {
    return { k_wind, k_crosswind, k_precip, k_temp: Infinity, k_turbulence: 1, k_total: Infinity, flyable: false, reasons: [`Temperature ${temp.toFixed(1)}°C outside safe range [${MIN_OPERATING_TEMP}, ${MAX_OPERATING_TEMP}]`] };
  } else if (temp < 0) {
    k_temp = 1.25;
    reasons.push(`Sub-zero (${temp.toFixed(1)}°C): ×1.25 (battery capacity loss + icing risk)`);
  } else if (temp < 10) {
    k_temp = 1.12;
    reasons.push(`Cold (${temp.toFixed(1)}°C): ×1.12 (battery capacity reduced ~10–15%)`);
  } else if (temp < 20) {
    k_temp = 1.05;
    reasons.push(`Cool (${temp.toFixed(1)}°C): ×1.05 (mild cold penalty)`);
  } else if (temp > 40) {
    k_temp = 1.08;
    reasons.push(`Hot (${temp.toFixed(1)}°C): ×1.08 (lower air density, motor heat)`);
  }

  // Turbulence penalty
  const turbMap: Record<string, number> = { calm: 1.0, light: 1.05, moderate: 1.15, severe: Infinity };
  const k_turbulence = turbMap[conditions.turbulence] ?? 1.0;

  if (conditions.turbulence === 'severe') {
    return { k_wind, k_crosswind, k_precip, k_temp, k_turbulence: Infinity, k_total: Infinity, flyable: false, reasons: ['Severe turbulence — structural/control risk — NO-GO'] };
  }
  if (k_turbulence > 1.0) {
    reasons.push(`Turbulence (${conditions.turbulence}): ×${k_turbulence.toFixed(2)}`);
  }

  // Compound total
  const k_total = k_wind * k_precip * k_temp * k_turbulence;
  const flyable = k_total <= MAX_WEATHER_PENALTY;

  if (!flyable) {
    reasons.push(`Combined weather penalty ×${k_total.toFixed(2)} exceeds limit ×${MAX_WEATHER_PENALTY} — NO-GO`);
  }

  return {
    k_wind: Math.round(k_wind * 1000) / 1000,
    k_crosswind: Math.round(k_crosswind * 1000) / 1000,
    k_precip: Math.round(k_precip * 1000) / 1000,
    k_temp: Math.round(k_temp * 1000) / 1000,
    k_turbulence: Math.round(k_turbulence * 1000) / 1000,
    k_total: Math.round(k_total * 1000) / 1000,
    flyable,
    reasons,
  };
}

// ===================================================================
// Motor-out survivability
// ===================================================================

export interface ThrustFeasibility {
  mtom_kg: number;
  weight_n: number;
  max_thrust_n: number;
  twr: number;
  feasible: boolean;
  motorOutTwr: number;
  motorOutSurvivable: boolean;
  thrustMarginPct: number;
}

/**
 * Check if drone can fly at given payload, including motor-out scenario.
 * Hex loses 1 motor → remaining 5/6 thrust.
 */
export function checkThrustFeasibility(payloadKg: number): ThrustFeasibility {
  const mtom = computeMTOM(payloadKg);
  const weightN = mtom * DRONE.gravity;
  const maxThrust = DRONE.numRotors * DRONE.maxThrustPerMotor;
  const twr = maxThrust / weightN;
  const motorOutThrust = maxThrust * (DRONE.numRotors - 1) / DRONE.numRotors;
  const motorOutTwr = motorOutThrust / weightN;
  const minTwr = 1.5;

  return {
    mtom_kg: Math.round(mtom * 100) / 100,
    weight_n: Math.round(weightN * 10) / 10,
    max_thrust_n: Math.round(maxThrust * 10) / 10,
    twr: Math.round(twr * 100) / 100,
    feasible: twr >= minTwr,
    motorOutTwr: Math.round(motorOutTwr * 100) / 100,
    motorOutSurvivable: motorOutTwr >= 1.0,
    thrustMarginPct: Math.round((twr / minTwr - 1) * 1000) / 10,
  };
}

// ===================================================================
// Divert energy calculation
// ===================================================================

/**
 * Energy needed to divert from current position to a safe landing point.
 * Includes 1.3× safety margin matching backend/physics.py.
 */
export function computeDivertEnergy(
  currentLat: number, currentLon: number,
  safeLat: number, safeLon: number,
  payloadKg: number, headwindMs: number = 0,
): number {
  const distM = haversineM(currentLat, currentLon, safeLat, safeLon);
  const groundSpeed = Math.max(DRONE.cruiseSpeed - Math.abs(headwindMs), 1.0);
  const ePerKm = computeEnergyPerKm(payloadKg, headwindMs);
  const eCruise = ePerKm * (distM / 1000);

  // One descent to land
  const tDescend = DRONE.cruiseAltitude / DRONE.descentRate;
  const eDescent = (computeDescentPower(payloadKg) * tDescend) / 3600;

  const safetyMargin = 1.3;
  return (eCruise + eDescent) * safetyMargin;
}

// ===================================================================
// Hover cost per minute
// ===================================================================

/** Energy cost per minute of unplanned hovering (Wh). */
export function computeHoverCostPerMinute(payloadKg: number): number {
  return (computeHoverPower(payloadKg) * 60) / 3600;
}

// ===================================================================
// Temperature-dependent effective battery capacity
// ===================================================================

/** Effective battery capacity accounting for temperature (Wh). */
export function effectiveBatteryCapacity(temperatureC: number): number {
  let factor = 1.0;
  if (temperatureC < 0) factor = 0.75;
  else if (temperatureC < 10) factor = 0.88;
  else if (temperatureC < 20) factor = 0.95;
  return DRONE.batteryCapacity * factor;
}

// ===================================================================
// Enhanced stepPhysics with weather conditions
// ===================================================================

/**
 * stepPhysics with full weather conditions applied.
 * Multiplies power draw by weather penalties and caps flight time.
 */
export function stepPhysicsWithConditions(
  state: DroneState,
  target: { lat: number; lon: number; alt: number },
  wind: WindVector,
  conditions: FlightConditions,
  dt: number,
  elapsedFlightTimeS: number = 0,
): DroneState {
  // Hard cap — 40 min max flight time for LiPo health
  if (elapsedFlightTimeS >= MAX_FLIGHT_TIME_S && state.phase !== 'landed' && state.phase !== 'preflight') {
    // Force landing
    return stepPhysics(state, { lat: state.lat, lon: state.lon, alt: 0 }, wind, dt);
  }

  // Compute base physics
  const next = stepPhysics(state, target, wind, dt);

  // Apply weather penalty to power draw
  const penalty = computeWeatherPenalty(conditions);
  const k_nonWind = penalty.k_precip * penalty.k_temp * penalty.k_turbulence;
  const adjustedPower = next.power_w * k_nonWind;

  // Recompute energy drain with adjusted power
  const energyUsedWh = (adjustedPower * dt) / 3600;
  const effCapacity = effectiveBatteryCapacity(conditions.temperature_c);
  const newBatteryWh = Math.max(state.battery_wh - energyUsedWh, 0);
  const newBatteryPct = (newBatteryWh / effCapacity) * 100;

  return {
    ...next,
    battery_wh: newBatteryWh,
    battery_pct: clamp(newBatteryPct, 0, 100),
    power_w: adjustedPower,
  };
}
