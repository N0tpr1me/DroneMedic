// AmbientParticles — atmospheric dust motes and distant birds for scene life.
//
// Two particle groups:
//   1. Dust motes (~400) — gentle sine-wave drift in a 2000m static cube
//   2. Birds     (~25)   — slow circular paths at 200-500m altitude

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { BufferAttribute, Points } from 'three';
import type { BufferGeometry } from 'three';

const DUST_COUNT = 400;
const DUST_CUBE = 2000;
const DUST_HALF = DUST_CUBE / 2;

const BIRD_COUNT = 25;

function randomInRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export function AmbientParticles() {
  // ---- Dust motes ----
  const dustRef = useRef<Points>(null);

  const dustPositions = useMemo(() => {
    const arr = new Float32Array(DUST_COUNT * 3);
    for (let i = 0; i < DUST_COUNT; i++) {
      arr[i * 3] = randomInRange(-DUST_HALF, DUST_HALF);
      arr[i * 3 + 1] = randomInRange(5, 400);
      arr[i * 3 + 2] = randomInRange(-DUST_HALF, DUST_HALF);
    }
    return arr;
  }, []);

  // Store the base positions so sine drift is relative.
  const dustBase = useRef<Float32Array>(null!);
  if (dustBase.current === null) {
    dustBase.current = new Float32Array(dustPositions);
  }

  // ---- Birds ----
  const birdRef = useRef<Points>(null);

  // Per-bird orbit parameters: centerX, centerZ, radius, speed, altitude, phase
  const birdParams = useMemo(() => {
    const params = new Float32Array(BIRD_COUNT * 6);
    for (let i = 0; i < BIRD_COUNT; i++) {
      const ix = i * 6;
      params[ix] = randomInRange(-500, 500);     // centerX
      params[ix + 1] = randomInRange(-500, 500); // centerZ
      params[ix + 2] = randomInRange(100, 300);  // radius
      params[ix + 3] = randomInRange(0.02, 0.05); // speed (rad/s)
      params[ix + 4] = randomInRange(200, 500);  // altitude
      params[ix + 5] = randomInRange(0, Math.PI * 2); // phase
    }
    return params;
  }, []);

  const birdPositions = useMemo(() => {
    const arr = new Float32Array(BIRD_COUNT * 3);
    // Initial positions computed from params.
    for (let i = 0; i < BIRD_COUNT; i++) {
      const ix = i * 6;
      const cx = birdParams[ix];
      const cz = birdParams[ix + 1];
      const r = birdParams[ix + 2];
      const phase = birdParams[ix + 5];
      const alt = birdParams[ix + 4];
      arr[i * 3] = cx + r * Math.cos(phase);
      arr[i * 3 + 1] = alt;
      arr[i * 3 + 2] = cz + r * Math.sin(phase);
    }
    return arr;
  }, [birdParams]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;

    // --- Dust drift ---
    if (dustRef.current) {
      const geo = dustRef.current.geometry as BufferGeometry;
      const pos = geo.attributes.position as BufferAttribute;
      const arr = pos.array as Float32Array;
      const base = dustBase.current;

      for (let i = 0; i < DUST_COUNT; i++) {
        const ix = i * 3;
        const phase = i * 0.37; // unique per particle
        arr[ix] = base[ix] + Math.sin(t * 0.15 + phase) * 3;
        arr[ix + 1] = base[ix + 1] + Math.sin(t * 0.1 + phase * 1.3) * 2;
        arr[ix + 2] = base[ix + 2] + Math.cos(t * 0.12 + phase * 0.7) * 3;
      }
      pos.needsUpdate = true;
    }

    // --- Bird orbits ---
    if (birdRef.current) {
      const geo = birdRef.current.geometry as BufferGeometry;
      const pos = geo.attributes.position as BufferAttribute;
      const arr = pos.array as Float32Array;

      for (let i = 0; i < BIRD_COUNT; i++) {
        const px = i * 6;
        const cx = birdParams[px];
        const cz = birdParams[px + 1];
        const r = birdParams[px + 2];
        const spd = birdParams[px + 3];
        const alt = birdParams[px + 4];
        const phase = birdParams[px + 5];
        const angle = phase + t * spd;

        arr[i * 3] = cx + r * Math.cos(angle);
        arr[i * 3 + 1] = alt + Math.sin(t * 0.3 + phase) * 5; // gentle bob
        arr[i * 3 + 2] = cz + r * Math.sin(angle);
      }
      pos.needsUpdate = true;
    }
  });

  return (
    <>
      {/* Dust motes */}
      <points ref={dustRef} frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            array={dustPositions}
            count={DUST_COUNT}
            itemSize={3}
          />
        </bufferGeometry>
        <pointsMaterial
          size={2.5}
          color="#ffd089"
          opacity={0.25}
          transparent
          sizeAttenuation
          depthWrite={false}
        />
      </points>

      {/* Birds */}
      <points ref={birdRef} frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            array={birdPositions}
            count={BIRD_COUNT}
            itemSize={3}
          />
        </bufferGeometry>
        <pointsMaterial
          size={8}
          color="#2a2a2a"
          opacity={0.6}
          sizeAttenuation
          depthWrite={false}
        />
      </points>
    </>
  );
}
