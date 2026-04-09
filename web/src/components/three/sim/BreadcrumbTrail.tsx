// BreadcrumbTrail — a ring buffer of the last N telemetry samples rendered as
// a single BufferGeometry line with per-vertex alpha from bright cyan (newest)
// to dark gray (oldest). Updated in useFrame by mutating the underlying buffer
// directly so the Canvas tree never re-renders.

import { useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useSimCockpit } from './SimCockpitContext';
import { enuFromLatLon } from './enuFrame';

interface BreadcrumbTrailProps {
  maxPoints?: number;
  minDistanceMeters?: number;
}

interface TrailBuffers {
  positions: Float32Array;
  colors: Float32Array;
}

function makeBuffers(n: number): TrailBuffers {
  const positions = new Float32Array(n * 3);
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const t = i / n;
    colors[i * 3] = 0.05 + 0.0 * t;
    colors[i * 3 + 1] = 0.4 + 0.5 * t;
    colors[i * 3 + 2] = 0.55 + 0.45 * t;
  }
  return { positions, colors };
}

export function BreadcrumbTrail({
  maxPoints = 300,
  minDistanceMeters = 2,
}: BreadcrumbTrailProps) {
  const { telemetryRef } = useSimCockpit();

  // Allocate once via useState's lazy initializer. Buffers are owned by the
  // three.js BufferAttribute after the first render; we mutate the array
  // through the geometry handle, not through this reference.
  const [buffers] = useState<TrailBuffers>(() => makeBuffers(maxPoints));

  const geomRef = useRef<THREE.BufferGeometry>(null);
  const writeIndex = useRef<number>(0);
  const count = useRef<number>(0);
  const lastWritten = useRef(new THREE.Vector3());
  const accumulator = useRef<number>(0);

  useFrame((_state, delta) => {
    accumulator.current += delta;
    if (accumulator.current < 0.1) return; // sample at 10 Hz
    accumulator.current = 0;

    const telemetry = telemetryRef.current;
    const geom = geomRef.current;
    if (!telemetry || !geom) return;
    const { east, north, up } = enuFromLatLon(
      telemetry.lat,
      telemetry.lon,
      Math.max(telemetry.relative_alt_m, 0.5),
    );
    const newPoint = new THREE.Vector3(east, up, -north);
    if (count.current > 0 && newPoint.distanceTo(lastWritten.current) < minDistanceMeters) {
      return;
    }
    const idx = writeIndex.current;
    const positionsAttr = geom.getAttribute('position') as THREE.BufferAttribute | null;
    if (!positionsAttr) return;
    const arr = positionsAttr.array as Float32Array;
    arr[idx * 3] = newPoint.x;
    arr[idx * 3 + 1] = newPoint.y;
    arr[idx * 3 + 2] = newPoint.z;
    writeIndex.current = (idx + 1) % maxPoints;
    count.current = Math.min(count.current + 1, maxPoints);
    lastWritten.current.copy(newPoint);

    positionsAttr.needsUpdate = true;
    geom.setDrawRange(0, count.current);
  });

  return (
    <line>
      <bufferGeometry ref={geomRef}>
        <bufferAttribute
          attach="attributes-position"
          args={[buffers.positions, 3]}
          count={maxPoints}
        />
        <bufferAttribute
          attach="attributes-color"
          args={[buffers.colors, 3]}
          count={maxPoints}
        />
      </bufferGeometry>
      <lineBasicMaterial
        vertexColors
        transparent
        opacity={0.85}
        depthWrite={false}
      />
    </line>
  );
}
