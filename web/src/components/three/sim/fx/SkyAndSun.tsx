// SkyAndSun — time-of-day sky + sun position for the 3D cockpit.
// Uses drei's <Sky> component with sun direction computed from the local
// London time at load. Simple solar position approximation good enough for
// a demo: latitude, day of year, hour angle.

import { useMemo } from 'react';
import { Sky } from '@react-three/drei';
import { DEPOT_LAT, DEG } from '../enuFrame';

interface SkyAndSunProps {
  now?: Date;
}

function computeSunDirection(date: Date): [number, number, number] {
  // Simplified NOAA approximation.
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
  return [x, y, z];
}

export function SkyAndSun({ now }: SkyAndSunProps = {}) {
  const sunPos = useMemo(() => computeSunDirection(now ?? new Date()), [now]);
  return (
    <Sky
      sunPosition={sunPos}
      distance={450_000}
      turbidity={4}
      rayleigh={2}
      mieCoefficient={0.005}
      mieDirectionalG={0.82}
    />
  );
}
