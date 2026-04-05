import { TripsLayer } from '@deck.gl/geo-layers';
import { useCallback, useEffect, useRef, useState } from 'react';

// ── Types ──

interface Waypoint {
  lat: number;
  lon: number;
  timestamp: number; // unix seconds
  battery: number;   // 0-100
}

interface FlightPathLayerProps {
  waypoints?: Waypoint[];
  currentTime?: number;  // animated timestamp
  playing?: boolean;
}

// ── Demo Data ──

export const DEMO_FLIGHT_PATH: Waypoint[] = [
  { lat: 51.5074, lon: -0.1278, timestamp: 0, battery: 100 },    // Depot
  { lat: 51.5100, lon: -0.1200, timestamp: 60, battery: 92 },
  { lat: 51.5130, lon: -0.1100, timestamp: 120, battery: 84 },
  { lat: 51.5160, lon: -0.0800, timestamp: 200, battery: 72 },
  { lat: 51.5185, lon: -0.0590, timestamp: 300, battery: 58 },   // Royal London
  { lat: 51.5150, lon: -0.0900, timestamp: 400, battery: 45 },
  { lat: 51.5074, lon: -0.1278, timestamp: 560, battery: 32 },   // Return depot
];

// ── Battery → Color ──

function batteryToColor(battery: number): [number, number, number, number] {
  if (battery > 60) {
    // Green
    return [34, 197, 94, 220];
  }
  if (battery > 30) {
    // Amber
    const t = (battery - 30) / 30;
    return [
      Math.round(245 - t * 211),
      Math.round(158 + t * 39),
      Math.round(11 + t * 83),
      220,
    ];
  }
  // Red
  return [239, 68, 68, 220];
}

// ── Hook: animated time ──

export function useFlightAnimation(
  waypoints: Waypoint[],
  playing: boolean,
  speed: number = 1,
) {
  const maxTime = waypoints.length > 0
    ? waypoints[waypoints.length - 1].timestamp
    : 0;

  const [currentTime, setCurrentTime] = useState(0);
  const rafRef = useRef<number>(0);
  const lastFrameRef = useRef<number>(0);

  const tick = useCallback(
    (now: number) => {
      if (lastFrameRef.current === 0) {
        lastFrameRef.current = now;
      }
      const delta = (now - lastFrameRef.current) / 1000; // seconds
      lastFrameRef.current = now;

      setCurrentTime((prev) => {
        const next = prev + delta * speed;
        return next > maxTime ? 0 : next;
      });

      rafRef.current = requestAnimationFrame(tick);
    },
    [maxTime, speed],
  );

  useEffect(() => {
    if (playing && maxTime > 0) {
      lastFrameRef.current = 0;
      rafRef.current = requestAnimationFrame(tick);
    }
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [playing, tick, maxTime]);

  return { currentTime, maxTime };
}

// ── Build layer config ──

function buildTripData(waypoints: Waypoint[]) {
  return [
    {
      path: waypoints.map((wp) => [wp.lon, wp.lat]),
      timestamps: waypoints.map((wp) => wp.timestamp),
      batteries: waypoints.map((wp) => wp.battery),
    },
  ];
}

export function createFlightPathLayer({
  waypoints = DEMO_FLIGHT_PATH,
  currentTime = 0,
}: FlightPathLayerProps) {
  const tripData = buildTripData(waypoints);

  // Interpolate battery at currentTime for head dot color
  let headBattery = 100;
  for (let i = 0; i < waypoints.length - 1; i++) {
    if (
      currentTime >= waypoints[i].timestamp &&
      currentTime <= waypoints[i + 1].timestamp
    ) {
      const t =
        (currentTime - waypoints[i].timestamp) /
        (waypoints[i + 1].timestamp - waypoints[i].timestamp);
      headBattery =
        waypoints[i].battery + t * (waypoints[i + 1].battery - waypoints[i].battery);
      break;
    }
  }

  const headColor = batteryToColor(headBattery);

  return new TripsLayer({
    id: 'flight-path-layer',
    data: tripData,
    getPath: (d: (typeof tripData)[0]) => d.path as any,
    getTimestamps: (d: (typeof tripData)[0]) => d.timestamps as any,
    getColor: headColor,
    widthMinPixels: 4,
    widthMaxPixels: 6,
    capRounded: true,
    jointRounded: true,
    trailLength: 200,
    currentTime,
    shadowEnabled: false,
  });
}

// ── Convenience wrapper component ──

export function FlightPathLayer({
  waypoints = DEMO_FLIGHT_PATH,
  currentTime,
  playing = true,
}: FlightPathLayerProps) {
  const animation = useFlightAnimation(waypoints, playing, 40);
  const time = currentTime ?? animation.currentTime;

  return createFlightPathLayer({ waypoints, currentTime: time, playing });
}

export type { FlightPathLayerProps, Waypoint };
export default FlightPathLayer;
