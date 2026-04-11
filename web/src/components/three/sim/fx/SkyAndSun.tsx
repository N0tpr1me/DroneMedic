// SkyAndSun — time-of-day sky + sun position for the 3D cockpit.
// Uses drei's <Sky> component with sun direction computed from the local
// London time at load. Simple solar position approximation good enough for
// a demo: latitude, day of year, hour angle.
//
// Also exports helpers so the main scene's directional light can share the
// sky's sun direction + color for a coherent lighting/sky match.

import { useMemo } from 'react';
import { Sky } from '@react-three/drei';
import { Color, Vector3 } from 'three';
import { DEPOT_LAT, DEG } from '../enuFrame';

interface SkyAndSunProps {
  now?: Date;
}

export interface SunState {
  /** Direction vector from the origin toward the sun (unit length). */
  direction: Vector3;
  /** Far-away world-space position of the sun (direction * distance). */
  position: Vector3;
  /** Normalized elevation in [0, 1]; 0 = horizon, 1 = zenith. */
  elevation: number;
  /** Warm sun color tuned to elevation. */
  color: Color;
  /** Suggested directional-light intensity tuned to elevation. */
  intensity: number;
}

/** Default drei <Sky> distance used by the component below. */
export const SKY_DISTANCE = 450_000;

// Cached intermediate colors so we avoid allocating every frame.
const NOON_COLOR = new Color('#fff3de'); // warm white
const SUNSET_COLOR = new Color('#ffb880'); // warm amber

function computeSunDirectionVector(date: Date): Vector3 {
  // Simplified NOAA approximation (identical to the previous implementation,
  // just returned as a Vector3 so downstream helpers can consume it).
  const dayOfYear = (() => {
    const start = Date.UTC(date.getUTCFullYear(), 0, 0);
    const diff = date.getTime() - start;
    return Math.floor(diff / 86_400_000);
  })();
  const decl = 23.44 * Math.sin(((360 / 365) * (dayOfYear - 81)) * DEG);
  const hour = date.getUTCHours() + date.getUTCMinutes() / 60;
  const hourAngle = (hour - 12) * 15; // degrees
  const lat = DEPOT_LAT;

  const sinAlt =
    Math.sin(lat * DEG) * Math.sin(decl * DEG) +
    Math.cos(lat * DEG) * Math.cos(decl * DEG) * Math.cos(hourAngle * DEG);
  const altitude = Math.asin(sinAlt); // radians
  const cosAz =
    (Math.sin(decl * DEG) - Math.sin(altitude) * Math.sin(lat * DEG)) /
    (Math.cos(altitude) * Math.cos(lat * DEG));
  const azimuth = Math.acos(Math.max(-1, Math.min(1, cosAz))); // radians

  const azimuthSigned = hourAngle > 0 ? 2 * Math.PI - azimuth : azimuth;
  const r = Math.cos(altitude);
  const x = r * Math.sin(azimuthSigned);
  const y = Math.max(Math.sin(altitude), 0.05);
  const z = -r * Math.cos(azimuthSigned);
  return new Vector3(x, y, z);
}

/**
 * Compute the sky/sun lighting state the main scene should use.
 *
 * @param date Simulation time (defaults to now).
 * @param distance Sun distance — must match the `<Sky>` distance below.
 */
export function getSunState(
  date: Date = new Date(),
  distance: number = SKY_DISTANCE,
): SunState {
  const direction = computeSunDirectionVector(date).normalize();

  // direction.y is effectively sin(altitude). Clamp to [0, 1] for elevation.
  const elevation = Math.min(1, Math.max(0, direction.y));

  // Warm white at high sun, warm amber at low sun. Use a soft curve so the
  // transition stays visible well before the horizon.
  const t = Math.pow(elevation, 0.65); // 0 at horizon, 1 at zenith
  const color = SUNSET_COLOR.clone().lerp(NOON_COLOR, t);

  // Intensity ramps from 1.2 at horizon to 2.2 at zenith — matches the
  // "warm bright noon look" called out by the lighting spec.
  const intensity = 1.2 + 1.0 * t;

  const position = direction.clone().multiplyScalar(distance);

  return {
    direction,
    position,
    elevation,
    color,
    intensity,
  };
}

export function SkyAndSun({ now }: SkyAndSunProps = {}) {
  const sunPos = useMemo<[number, number, number]>(() => {
    const dir = computeSunDirectionVector(now ?? new Date());
    return [dir.x, dir.y, dir.z];
  }, [now]);
  return (
    <Sky
      sunPosition={sunPos}
      distance={SKY_DISTANCE}
      turbidity={4}
      rayleigh={2}
      mieCoefficient={0.005}
      mieDirectionalG={0.82}
    />
  );
}
