/**
 * usePhysicsSimulation - React hook driving the DroneMedic physics engine.
 *
 * Runs a requestAnimationFrame loop at ~60 fps, advancing drone state
 * through a list of waypoints using stepPhysics().
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  type DroneState,
  DRONE,
  type EnergyBudget,
  type WindVector,
  computeEnergyBudget,
  createInitialState,
  haversineM,
  stepPhysics,
} from '../lib/physics-engine';

export interface Waypoint {
  lat: number;
  lon: number;
  name: string;
  alt?: number;
}

export interface PhysicsSimulationOptions {
  timeScale?: number;
  paused?: boolean;
}

export interface PhysicsSimulationResult {
  droneState: DroneState;
  currentWaypoint: number;
  missionProgress: number;
  energyBudget: EnergyBudget;
  isComplete: boolean;
  telemetryHistory: DroneState[];
  start: () => void;
  pause: () => void;
  resume: () => void;
  setTimeScale: (s: number) => void;
}

export function usePhysicsSimulation(
  waypoints: Waypoint[],
  wind: WindVector,
  payloadKg: number,
  options?: PhysicsSimulationOptions,
): PhysicsSimulationResult {
  // Derive initial position from the first waypoint (or London default)
  const originLat = waypoints.length > 0 ? waypoints[0].lat : 51.5074;
  const originLon = waypoints.length > 0 ? waypoints[0].lon : -0.1278;

  const [droneState, setDroneState] = useState<DroneState>(() =>
    createInitialState(originLat, originLon, payloadKg),
  );
  const [currentWaypoint, setCurrentWaypoint] = useState(0);
  const [isComplete, setIsComplete] = useState(false);
  const [telemetryHistory, setTelemetryHistory] = useState<DroneState[]>([]);
  const [paused, setPaused] = useState(options?.paused ?? true);

  const timeScaleRef = useRef(options?.timeScale ?? 1);
  const currentWaypointRef = useRef(0);
  const isCompleteRef = useRef(false);
  const lastTelemetryRef = useRef(0);

  // Keep refs in sync with state
  useEffect(() => {
    currentWaypointRef.current = currentWaypoint;
  }, [currentWaypoint]);

  useEffect(() => {
    isCompleteRef.current = isComplete;
  }, [isComplete]);

  // Sync external option changes
  useEffect(() => {
    if (options?.timeScale !== undefined) {
      timeScaleRef.current = options.timeScale;
    }
  }, [options?.timeScale]);

  useEffect(() => {
    if (options?.paused !== undefined) {
      setPaused(options.paused);
    }
  }, [options?.paused]);

  // ── Compute total route distance for energy budget ───────────────
  const routeDistanceM = waypoints.reduce((sum, wp, i) => {
    if (i === 0) return 0;
    const prev = waypoints[i - 1];
    return sum + haversineM(prev.lat, prev.lon, wp.lat, wp.lon);
  }, 0);

  const numStops = Math.max(waypoints.length - 1, 0);

  const energyBudget = computeEnergyBudget(
    routeDistanceM,
    numStops,
    payloadKg,
    wind.speed,
  );

  // ── Animation loop ──────────────────────────────────────────────
  useEffect(() => {
    if (paused || isComplete || waypoints.length === 0) return;

    let lastTime = performance.now();
    let animFrame: number;

    const loop = (now: number) => {
      const rawDt = (now - lastTime) / 1000;
      // Cap dt to prevent huge jumps when tab is backgrounded
      const cappedDt = Math.min(rawDt, 0.1);
      const dt = cappedDt * timeScaleRef.current;
      lastTime = now;

      const wpIdx = currentWaypointRef.current;
      if (wpIdx >= waypoints.length || isCompleteRef.current) {
        return;
      }

      const target = waypoints[wpIdx];
      const targetPos = {
        lat: target.lat,
        lon: target.lon,
        alt: target.alt ?? DRONE.cruiseAltitude,
      };

      setDroneState((prev) => {
        const next = stepPhysics(prev, targetPos, wind, dt);

        // Check if we reached the waypoint
        const dist = haversineM(next.lat, next.lon, target.lat, target.lon);
        const altClose =
          target.alt !== undefined
            ? Math.abs(next.alt - target.alt) < 5
            : true;

        if (dist < 10 && (next.phase === 'hover' || next.phase === 'cruise') && altClose) {
          if (wpIdx < waypoints.length - 1) {
            const nextIdx = wpIdx + 1;
            currentWaypointRef.current = nextIdx;
            setCurrentWaypoint(nextIdx);
          } else {
            isCompleteRef.current = true;
            setIsComplete(true);
          }
        }

        // Record telemetry every 500ms
        if (now - lastTelemetryRef.current > 500) {
          lastTelemetryRef.current = now;
          setTelemetryHistory((h) => [...h, next]);
        }

        return next;
      });

      animFrame = requestAnimationFrame(loop);
    };

    animFrame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animFrame);
  }, [waypoints, wind, payloadKg, paused, isComplete]);

  // ── Controls ────────────────────────────────────────────────────
  const start = useCallback(() => {
    const lat = waypoints.length > 0 ? waypoints[0].lat : 51.5074;
    const lon = waypoints.length > 0 ? waypoints[0].lon : -0.1278;
    setDroneState(createInitialState(lat, lon, payloadKg));
    setCurrentWaypoint(0);
    currentWaypointRef.current = 0;
    setIsComplete(false);
    isCompleteRef.current = false;
    setTelemetryHistory([]);
    lastTelemetryRef.current = 0;
    setPaused(false);
  }, [waypoints, payloadKg]);

  const pause = useCallback(() => {
    setPaused(true);
  }, []);

  const resume = useCallback(() => {
    setPaused(false);
  }, []);

  const setTimeScale = useCallback((s: number) => {
    timeScaleRef.current = s;
  }, []);

  const missionProgress =
    waypoints.length > 0
      ? (currentWaypoint / waypoints.length) * 100
      : 0;

  return {
    droneState,
    currentWaypoint,
    missionProgress,
    energyBudget,
    isComplete,
    telemetryHistory,
    start,
    pause,
    resume,
    setTimeScale,
  };
}
