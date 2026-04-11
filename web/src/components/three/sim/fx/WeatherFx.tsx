// WeatherFx — rain and wind streak particle systems for the London 3D sim.
// Always active because... it's London.
//
// Two particle groups:
//   1. Rain  (~1500 particles) — falling drops in a 400m cube following the drone
//   2. Wind  (~150 particles)  — horizontal streaks in a 600m cube

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, BufferAttribute, Points } from 'three';
import type { BufferGeometry } from 'three';
import { useSimCockpit } from '../SimCockpitContext';
import { enuFromLatLon } from '../enuFrame';

const RAIN_COUNT = 1500;
const RAIN_CUBE = 400; // metres
const RAIN_HALF = RAIN_CUBE / 2;

const WIND_COUNT = 150;
const WIND_CUBE = 600;
const WIND_HALF = WIND_CUBE / 2;

function randomInRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export function WeatherFx() {
  const { subscribeTelemetry } = useSimCockpit();

  // Mutable drone position read imperatively each frame.
  const dronePos = useRef({ x: 0, y: 60, z: 0 });

  useEffect(() => {
    return subscribeTelemetry((t) => {
      if (!t) return;
      const enu = enuFromLatLon(t.lat, t.lon, t.relative_alt_m ?? 60);
      dronePos.current.x = enu.east;
      dronePos.current.y = enu.up;
      dronePos.current.z = -enu.north;
    });
  }, [subscribeTelemetry]);

  // ---- Rain ----
  const rainRef = useRef<Points>(null);
  const rainSpeeds = useRef<Float32Array>(null!);

  const rainPositions = useMemo(() => {
    const arr = new Float32Array(RAIN_COUNT * 3);
    const speeds = new Float32Array(RAIN_COUNT);
    for (let i = 0; i < RAIN_COUNT; i++) {
      arr[i * 3] = randomInRange(-RAIN_HALF, RAIN_HALF);
      arr[i * 3 + 1] = randomInRange(0, RAIN_CUBE);
      arr[i * 3 + 2] = randomInRange(-RAIN_HALF, RAIN_HALF);
      speeds[i] = randomInRange(9, 12);
    }
    rainSpeeds.current = speeds;
    return arr;
  }, []);

  // ---- Wind streaks ----
  const windRef = useRef<Points>(null);
  const windSpeeds = useRef<Float32Array>(null!);

  const windPositions = useMemo(() => {
    const arr = new Float32Array(WIND_COUNT * 3);
    const speeds = new Float32Array(WIND_COUNT);
    for (let i = 0; i < WIND_COUNT; i++) {
      arr[i * 3] = randomInRange(-WIND_HALF, WIND_HALF);
      arr[i * 3 + 1] = randomInRange(10, WIND_CUBE);
      arr[i * 3 + 2] = randomInRange(-WIND_HALF, WIND_HALF);
      speeds[i] = randomInRange(5, 8);
    }
    windSpeeds.current = speeds;
    return arr;
  }, []);

  useFrame((_, delta) => {
    const dp = dronePos.current;
    const dt = Math.min(delta, 0.1); // clamp large frame gaps

    // --- Rain update ---
    if (rainRef.current) {
      const geo = rainRef.current.geometry as BufferGeometry;
      const pos = geo.attributes.position as BufferAttribute;
      const arr = pos.array as Float32Array;
      const speeds = rainSpeeds.current;

      for (let i = 0; i < RAIN_COUNT; i++) {
        const ix = i * 3;
        // Fall down + slight wind drift
        arr[ix] += 2 * dt; // wind drift +x
        arr[ix + 1] -= speeds[i] * dt;
        // Recycle below ground
        if (arr[ix + 1] < 0) {
          arr[ix] = randomInRange(-RAIN_HALF, RAIN_HALF);
          arr[ix + 1] = RAIN_CUBE;
          arr[ix + 2] = randomInRange(-RAIN_HALF, RAIN_HALF);
        }
      }
      pos.needsUpdate = true;

      // Follow drone
      rainRef.current.position.set(dp.x, dp.y - RAIN_HALF, dp.z);
    }

    // --- Wind update ---
    if (windRef.current) {
      const geo = windRef.current.geometry as BufferGeometry;
      const pos = geo.attributes.position as BufferAttribute;
      const arr = pos.array as Float32Array;
      const speeds = windSpeeds.current;

      for (let i = 0; i < WIND_COUNT; i++) {
        const ix = i * 3;
        arr[ix] += speeds[i] * dt;
        // Recycle when exiting cube
        if (arr[ix] > WIND_HALF) {
          arr[ix] = -WIND_HALF;
          arr[ix + 1] = randomInRange(10, WIND_CUBE);
          arr[ix + 2] = randomInRange(-WIND_HALF, WIND_HALF);
        }
      }
      pos.needsUpdate = true;

      windRef.current.position.set(dp.x, dp.y - WIND_HALF, dp.z);
    }
  });

  return (
    <>
      {/* Rain */}
      <points ref={rainRef} frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            array={rainPositions}
            count={RAIN_COUNT}
            itemSize={3}
          />
        </bufferGeometry>
        <pointsMaterial
          size={1.2}
          color="#8ab4f8"
          opacity={0.35}
          transparent
          sizeAttenuation
          depthWrite={false}
        />
      </points>

      {/* Wind streaks */}
      <points ref={windRef} frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            array={windPositions}
            count={WIND_COUNT}
            itemSize={3}
          />
        </bufferGeometry>
        <pointsMaterial
          size={0.8}
          color="#ffffff"
          opacity={0.15}
          transparent
          depthWrite={false}
          blending={AdditiveBlending}
        />
      </points>
    </>
  );
}
