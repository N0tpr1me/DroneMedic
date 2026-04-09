/**
 * useFleetPhysics — Multi-drone physics manager hook.
 *
 * Runs a single requestAnimationFrame loop that steps physics for every
 * active drone each frame.  Positions live in refs (no 60 fps re-renders);
 * a ~15 Hz throttled setState feeds the HUD.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  type DroneState,
  type EnergyBudget,
  type FlightConditions,
  type WeatherPenalty,
  type WindVector,
  DEFAULT_CONDITIONS,
  DRONE,
  checkThrustFeasibility,
  computeCruisePower,
  computeEnergyBudget,
  computeHoverPower,
  computeMTOM,
  computeTWR,
  computeWeatherPenalty,
  createInitialState,
  haversineM,
  stepPhysicsWithConditions,
} from '../lib/physics-engine';

// ===================================================================
// Supply weights (mirrors SupplyPicker catalog from config)
// ===================================================================

export const SUPPLY_WEIGHTS: Record<string, number> = {
  blood_pack: 0.5,
  vaccine_kit: 0.3,
  defibrillator: 2.0,
  first_aid: 1.0,
  medication: 0.2,
  insulin: 0.1,
  antivenom: 0.4,
  surgical_kit: 1.5,
  oxygen_tank: 3.0,
};

// ===================================================================
// Interfaces
// ===================================================================

export interface FleetConfig {
  id: string;
  homeLat: number;
  homeLon: number;
  color: string;
  homeName: string;
}

export interface FleetDrone {
  id: string;
  config: FleetConfig;
  state: DroneState;
  waypoints: ReadonlyArray<{ lat: number; lon: number; name: string }>;
  currentWaypointIdx: number;
  missionActive: boolean;
  missionId: string | null;
  payloadKg: number;
  elapsedFlightTimeS: number;
}

/** Matches what DroneMapOverlay expects. */
export interface DroneMapData {
  id: string;
  lat: number;
  lng: number;
  altitude: number;
  heading: number;
  color: string;
  status: string;
}

export interface FleetEvent {
  type:
    | 'takeoff'
    | 'waypoint_reached'
    | 'phase_change'
    | 'battery_milestone'
    | 'landed'
    | 'mission_complete'
    | 'wind_change'
    | 'battery_warning';
  droneId: string;
  data: Record<string, unknown>;
  timestamp: number;
}

export interface DroneTelemetry {
  lat: number;
  lon: number;
  alt: number;
  speed_ms: number;
  ground_speed_ms: number;
  heading: number;
  bank: number;
  pitch: number;
  battery_pct: number;
  battery_wh: number;
  power_w: number;
  phase: string;
  payloadKg: number;
  total_mass_kg: number;
  twr: number;
  wind: { speed: number; direction: number };
  energy_budget: EnergyBudget;
  weather_penalty: WeatherPenalty;
  hover_power_w: number;
  cruise_power_w: number;
  motor_out_survivable: boolean;
  currentWaypointIdx: number;
  totalWaypoints: number;
  missionProgress: number;
  missionActive: boolean;
}

// ===================================================================
// Default fleet configuration (3 drones)
// ===================================================================

export const DEFAULT_FLEET_CONFIG: readonly FleetConfig[] = [
  {
    id: 'drone-1',
    homeLat: 51.5074,
    homeLon: -0.1278,
    color: 'cyan',
    homeName: 'Central Depot',
  },
  {
    id: 'drone-2',
    homeLat: 51.5185,
    homeLon: -0.059,
    color: 'amber',
    homeName: 'Royal London',
  },
  {
    id: 'drone-3',
    homeLat: 51.5468,
    homeLon: -0.0456,
    color: 'purple',
    homeName: 'Homerton',
  },
] as const;

// ===================================================================
// Internal helpers
// ===================================================================

const HUD_INTERVAL_MS = 1000 / 15; // ~15 Hz

/** Battery milestone thresholds that fire events exactly once per crossing. */
const BATTERY_MILESTONES = [75, 50, 25, 10] as const;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function randomWalk(current: number, step: number, lo: number, hi: number): number {
  const delta = (Math.random() * 2 - 1) * step;
  return clamp(current + delta, lo, hi);
}

function wrapDegrees(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

function makeMissionId(): string {
  return `mission-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Compute total route distance from a waypoint list (metres). */
function routeDistanceM(
  waypoints: ReadonlyArray<{ lat: number; lon: number }>,
): number {
  let total = 0;
  for (let i = 1; i < waypoints.length; i++) {
    const prev = waypoints[i - 1];
    const curr = waypoints[i];
    total += haversineM(prev.lat, prev.lon, curr.lat, curr.lon);
  }
  return total;
}

// ===================================================================
// Hook
// ===================================================================

export function useFleetPhysics(
  configs: FleetConfig[],
  initialWind: WindVector,
  initialConditions: FlightConditions,
  onEvent?: (evt: FleetEvent) => void,
) {
  // ── Stable ref for the event callback ──────────────────────────
  const onEventRef = useRef(onEvent);
  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  // ── Time scale (default 10) ────────────────────────────────────
  const timeScaleRef = useRef(3); // 3x speed for demo — realistic battery drain

  // ── Wind state (ref-only, mutated in the rAF loop) ─────────────
  const windRef = useRef<WindVector>({ ...initialWind });
  const conditionsRef = useRef<FlightConditions>({ ...initialConditions });

  // ── Fleet map lives in a ref — never directly in state ─────────
  const fleetRef = useRef<Map<string, FleetDrone>>(new Map());

  // ── Per-drone tracking refs (previous phase, crossed milestones)
  const prevPhaseRef = useRef<Map<string, DroneState['phase']>>(new Map());
  const crossedMilestonesRef = useRef<Map<string, Set<number>>>(new Map());

  // ── Wind drift timer (scaled real-seconds since last drift) ────
  const windDriftAccumRef = useRef(0);

  // ── Throttled HUD state (updated at ~15 Hz) ────────────────────
  const [hudStamp, setHudStamp] = useState(0);
  const lastHudRef = useRef(0);

  // ── Initialise fleet from configs ──────────────────────────────
  useEffect(() => {
    const next = new Map<string, FleetDrone>();
    for (const cfg of configs) {
      // Preserve existing drone if already present & active
      const existing = fleetRef.current.get(cfg.id);
      if (existing) {
        next.set(cfg.id, { ...existing, config: cfg });
      } else {
        next.set(cfg.id, {
          id: cfg.id,
          config: cfg,
          state: createInitialState(cfg.homeLat, cfg.homeLon, 0),
          waypoints: [],
          currentWaypointIdx: 0,
          missionActive: false,
          missionId: null,
          payloadKg: 0,
          elapsedFlightTimeS: 0,
        });
        prevPhaseRef.current.set(cfg.id, 'preflight');
        crossedMilestonesRef.current.set(cfg.id, new Set());
      }
    }
    fleetRef.current = next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configs]);

  // ── Emit helper ────────────────────────────────────────────────
  const emit = useCallback(
    (type: FleetEvent['type'], droneId: string, data: Record<string, unknown>) => {
      onEventRef.current?.({
        type,
        droneId,
        data,
        timestamp: Date.now(),
      });
    },
    [],
  );

  // ── requestAnimationFrame loop ─────────────────────────────────
  useEffect(() => {
    let animFrame: number;
    let lastTime = performance.now();

    const loop = (now: number) => {
      const rawDt = (now - lastTime) / 1000;
      const cappedDt = Math.min(rawDt, 0.1);
      const dt = cappedDt * timeScaleRef.current;
      lastTime = now;

      // ── Wind drift (every 10 scaled seconds) ────────────────
      windDriftAccumRef.current += dt;
      if (windDriftAccumRef.current >= 10) {
        windDriftAccumRef.current -= 10;
        const prev = windRef.current;
        const newSpeed = randomWalk(prev.speed, 2, 0, 12);
        const newDir = wrapDegrees(randomWalk(prev.direction, 15, -Infinity, Infinity));
        windRef.current = { speed: newSpeed, direction: newDir };
      }

      const wind = windRef.current;
      const conditions = conditionsRef.current;

      // ── Step each active drone ──────────────────────────────
      const activeDrones = Array.from(fleetRef.current.values());
      for (const drone of activeDrones) {
        if (!drone.missionActive) continue;

        const wpIdx = drone.currentWaypointIdx;
        if (wpIdx >= drone.waypoints.length) continue;

        const wp = drone.waypoints[wpIdx];
        const target = {
          lat: wp.lat,
          lon: wp.lon,
          alt: DRONE.cruiseAltitude,
        };

        const prevState = drone.state;
        const nextState = stepPhysicsWithConditions(
          prevState,
          target,
          wind,
          conditions,
          dt,
          drone.elapsedFlightTimeS,
        );

        drone.state = nextState;
        drone.elapsedFlightTimeS += dt;

        // ── Phase change event ──────────────────────────────
        const prevPhase = prevPhaseRef.current.get(drone.id);
        if (nextState.phase !== prevPhase) {
          emit('phase_change', drone.id, {
            from: prevPhase,
            to: nextState.phase,
          });

          // Takeoff detection (preflight/landed → climb)
          if (
            (prevPhase === 'preflight' || prevPhase === 'landed') &&
            nextState.phase === 'climb'
          ) {
            emit('takeoff', drone.id, { waypointIdx: wpIdx });
          }

          // Landed detection
          if (nextState.phase === 'landed') {
            emit('landed', drone.id, {
              lat: nextState.lat,
              lon: nextState.lon,
            });
          }

          prevPhaseRef.current.set(drone.id, nextState.phase);
        }

        // ── Battery milestones ──────────────────────────────
        const crossed = crossedMilestonesRef.current.get(drone.id)!;
        for (const ms of BATTERY_MILESTONES) {
          if (prevState.battery_pct > ms && nextState.battery_pct <= ms && !crossed.has(ms)) {
            crossed.add(ms);
            const evtType = ms <= 10 ? 'battery_warning' : 'battery_milestone';
            emit(evtType, drone.id, {
              milestone: ms,
              battery_pct: nextState.battery_pct,
            });
          }
        }

        // ── Waypoint reached detection ──────────────────────
        const distToWp = haversineM(nextState.lat, nextState.lon, wp.lat, wp.lon);
        if (distToWp < 10 && (nextState.phase === 'hover' || nextState.phase === 'cruise')) {
          emit('waypoint_reached', drone.id, {
            waypointIdx: wpIdx,
            name: wp.name,
          });

          if (wpIdx < drone.waypoints.length - 1) {
            drone.currentWaypointIdx = wpIdx + 1;
          } else {
            // Final waypoint → mission complete
            drone.missionActive = false;
            drone.payloadKg = 0;
            drone.state = { ...nextState, payloadKg: 0 };
            emit('mission_complete', drone.id, {
              missionId: drone.missionId,
              elapsedTimeS: drone.elapsedFlightTimeS,
              battery_pct: nextState.battery_pct,
            });
          }
        }
      }

      // ── Throttled HUD update ────────────────────────────────
      if (now - lastHudRef.current >= HUD_INTERVAL_MS) {
        lastHudRef.current = now;
        setHudStamp(now);
      }

      animFrame = requestAnimationFrame(loop);
    };

    animFrame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animFrame);
  }, [emit]);

  // ── getDroneMapData() — read from refs, zero allocation path ───
  const getDroneMapData = useCallback((): DroneMapData[] => {
    // Touch hudStamp so callers inside render get fresh data after
    // the throttled setState fires.
    void hudStamp;

    const result: DroneMapData[] = [];
    const allDrones = Array.from(fleetRef.current.values());
    for (const drone of allDrones) {
      const { state, config, missionActive } = drone;
      result.push({
        id: drone.id,
        lat: state.lat,
        lng: state.lon,
        altitude: state.alt,
        heading: state.heading,
        color: config.color,
        status: missionActive ? state.phase : 'idle',
      });
    }
    return result;
  }, [hudStamp]);

  // ── dispatchDrone() ────────────────────────────────────────────
  const dispatchDrone = useCallback(
    (
      droneId: string,
      waypoints: ReadonlyArray<{ lat: number; lon: number; name: string }>,
      payloadKg: number,
    ) => {
      const drone = fleetRef.current.get(droneId);
      if (!drone) {
        throw new Error(`Unknown drone: ${droneId}`);
      }
      if (drone.missionActive) {
        throw new Error(`Drone ${droneId} already has an active mission`);
      }

      const missionId = makeMissionId();

      // Reset state at home position with new payload
      drone.state = createInitialState(
        drone.config.homeLat,
        drone.config.homeLon,
        payloadKg,
      );
      drone.waypoints = waypoints;
      drone.currentWaypointIdx = 0;
      drone.missionActive = true;
      drone.missionId = missionId;
      drone.payloadKg = payloadKg;
      drone.elapsedFlightTimeS = 0;

      // Reset tracking
      prevPhaseRef.current.set(droneId, 'preflight');
      crossedMilestonesRef.current.set(droneId, new Set());
    },
    [],
  );

  // ── getTelemetry() — full physics snapshot for a single drone ──
  const getTelemetry = useCallback(
    (droneId: string): DroneTelemetry | null => {
      // Touch hudStamp for reactivity
      void hudStamp;

      const drone = fleetRef.current.get(droneId);
      if (!drone) return null;

      const { state } = drone;
      const wind = windRef.current;
      const conditions = conditionsRef.current;

      const totalDistM = routeDistanceM(drone.waypoints);
      const numStops = Math.max(drone.waypoints.length - 1, 0);
      const energyBudget = computeEnergyBudget(
        totalDistM,
        numStops,
        drone.payloadKg,
        wind.speed,
      );
      const weatherPenalty = computeWeatherPenalty(conditions);
      const feasibility = checkThrustFeasibility(drone.payloadKg);

      const groundSpeed = Math.sqrt(state.vx * state.vx + state.vy * state.vy);

      return {
        lat: state.lat,
        lon: state.lon,
        alt: state.alt,
        speed_ms: state.speed,
        ground_speed_ms: groundSpeed,
        heading: state.heading,
        bank: state.bank,
        pitch: state.pitch,
        battery_pct: state.battery_pct,
        battery_wh: state.battery_wh,
        power_w: state.power_w,
        phase: state.phase,
        payloadKg: drone.payloadKg,
        total_mass_kg: computeMTOM(drone.payloadKg),
        twr: computeTWR(drone.payloadKg),
        wind: { speed: wind.speed, direction: wind.direction },
        energy_budget: energyBudget,
        weather_penalty: weatherPenalty,
        hover_power_w: computeHoverPower(drone.payloadKg),
        cruise_power_w: computeCruisePower(drone.payloadKg),
        motor_out_survivable: feasibility.motorOutSurvivable,
        currentWaypointIdx: drone.currentWaypointIdx,
        totalWaypoints: drone.waypoints.length,
        missionProgress: (() => {
          if (drone.waypoints.length <= 1) return 0;
          const totalSegments = drone.waypoints.length - 1;
          const wpIdx = drone.currentWaypointIdx;
          if (wpIdx >= totalSegments) return 100;
          // Interpolate within current segment based on distance
          const currentWp = drone.waypoints[wpIdx];
          const distToWp = haversineM(state.lat, state.lon, currentWp.lat, currentWp.lon);
          const prevWpIdx = Math.max(0, wpIdx - 1);
          const prevWp = wpIdx === 0
            ? { lat: drone.config.homeLat, lon: drone.config.homeLon }
            : drone.waypoints[prevWpIdx];
          const segmentDist = haversineM(prevWp.lat, prevWp.lon, currentWp.lat, currentWp.lon);
          const segFraction = segmentDist > 0 ? Math.max(0, 1 - distToWp / segmentDist) : 0;
          return Math.min(((wpIdx + segFraction) / totalSegments) * 100, 100);
        })(),
        missionActive: drone.missionActive,
      };
    },
    [hudStamp],
  );

  // ── setTimeScale() ─────────────────────────────────────────────
  const setTimeScale = useCallback((scale: number) => {
    timeScaleRef.current = scale;
  }, []);

  // ── setConditions() — update weather mid-flight ────────────────
  const setConditions = useCallback((c: FlightConditions) => {
    conditionsRef.current = { ...c };
  }, []);

  // ── setWind() — override wind mid-flight ───────────────────────
  const setWind = useCallback((w: WindVector) => {
    windRef.current = { ...w };
  }, []);

  return {
    getDroneMapData,
    dispatchDrone,
    getTelemetry,
    setTimeScale,
    setConditions,
    setWind,
  } as const;
}
