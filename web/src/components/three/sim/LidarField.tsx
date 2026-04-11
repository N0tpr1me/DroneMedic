// LidarField — r3f component that renders the LiDAR point cloud as a single
// THREE.Points mesh. Subscribes to the lidarBus and maintains a ring buffer of
// the last few frames so points appear to persist briefly (fade-over-age),
// while keeping GPU upload cost capped at one buffer update per frame.

import { useEffect, useMemo, useRef, type ReactElement } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  subscribeLidarFrame,
  type LidarFrame,
  type LidarObstacle,
} from './lidarBus';

// ─ Tunables ───────────────────────────────────────────────────────────

const MAX_POINTS_PER_FRAME = 256;
const RING_BUFFER_SIZE = 4;
const MAX_POINTS_TOTAL = MAX_POINTS_PER_FRAME * RING_BUFFER_SIZE;

// Colors used to tint points. Newest scan is full-cyan; obstacles are red.
const BASE_COLOR = new THREE.Color(0x00daf3);
const OBSTACLE_COLOR = new THREE.Color(0xff3b5c);

// An obstacle "claims" any point whose bearing is within this window (rad).
const OBSTACLE_BEARING_WINDOW = Math.PI / 8; // ±22.5°

// ─ Helpers ────────────────────────────────────────────────────────────

function isPointInObstacle(
  localX: number,
  localZ: number,
  obstacles: readonly LidarObstacle[],
): boolean {
  if (obstacles.length === 0) return false;
  const pointBearing = Math.atan2(localX, -localZ);
  for (const o of obstacles) {
    let diff = pointBearing - o.bearing;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    if (Math.abs(diff) < OBSTACLE_BEARING_WINDOW) return true;
  }
  return false;
}

// ─ Component ──────────────────────────────────────────────────────────

export function LidarField(): ReactElement {
  // Preallocated typed arrays for the full ring buffer. Never reallocated.
  const positions = useMemo<Float32Array>(
    () => new Float32Array(MAX_POINTS_TOTAL * 3),
    [],
  );
  const colors = useMemo<Float32Array>(
    () => new Float32Array(MAX_POINTS_TOTAL * 3),
    [],
  );

  const geomRef = useRef<THREE.BufferGeometry>(null);

  // Ring buffer of the most recent frames. `ringIndex` is the write slot for
  // the NEXT incoming frame. Entries may be null while warming up.
  const ringRef = useRef<(LidarFrame | null)[]>(
    Array.from({ length: RING_BUFFER_SIZE }, () => null),
  );
  const ringWriteIndexRef = useRef<number>(0);

  // Scratch vector for world-space transform, avoids per-frame allocation.
  const scratchVecRef = useRef<THREE.Vector3>(new THREE.Vector3());

  useEffect(() => {
    const unsubscribe = subscribeLidarFrame((frame: LidarFrame) => {
      const idx = ringWriteIndexRef.current;
      ringRef.current[idx] = frame;
      ringWriteIndexRef.current = (idx + 1) % RING_BUFFER_SIZE;
    });
    return () => {
      unsubscribe();
    };
  }, []);

  useFrame(() => {
    const geom = geomRef.current;
    if (!geom) return;

    const posAttr = geom.getAttribute('position') as
      | THREE.BufferAttribute
      | null;
    const colAttr = geom.getAttribute('color') as
      | THREE.BufferAttribute
      | null;
    if (!posAttr || !colAttr) return;

    const posArr = posAttr.array as Float32Array;
    const colArr = colAttr.array as Float32Array;
    const scratch = scratchVecRef.current;

    let writeOffset = 0;

    // Walk from oldest → newest so older points end up earlier in the buffer
    // and get a dimmer color. age = 0 (newest) → brightest.
    for (let age = RING_BUFFER_SIZE - 1; age >= 0; age--) {
      const frameSlot =
        (ringWriteIndexRef.current - 1 - age + RING_BUFFER_SIZE * 2) %
        RING_BUFFER_SIZE;
      const frame = ringRef.current[frameSlot];
      if (!frame) continue;

      // Newest frame has fadeFactor 1.0, oldest ~0.25. Linear ramp.
      const fadeFactor = 1 - age / RING_BUFFER_SIZE;

      // Rebuild the world-space transform from frame metadata.
      const heading = frame.droneHeading;
      const cosH = Math.cos(heading);
      const sinH = Math.sin(heading);
      const dx = frame.dronePosition.x;
      const dy = frame.dronePosition.y;
      const dz = frame.dronePosition.z;

      const framePoints = frame.points;
      const maxThisFrame = Math.min(framePoints.length, MAX_POINTS_PER_FRAME);

      for (let i = 0; i < maxThisFrame; i++) {
        if (writeOffset >= MAX_POINTS_TOTAL) break;
        const p = framePoints[i];
        if (!p) continue;

        // Rotate drone-local → world around the drone's yaw axis. The
        // SyntheticLidar producer stores points already rotated into the
        // drone's local frame via the inverse quaternion, so we rotate by
        // +heading here to get back to world space (ignoring roll/pitch,
        // which is acceptable for a 2D-ish point cloud preview).
        const worldX = p.x * cosH + p.z * sinH + dx;
        const worldY = p.y + dy;
        const worldZ = -p.x * sinH + p.z * cosH + dz;

        scratch.set(worldX, worldY, worldZ);
        const base = writeOffset * 3;
        posArr[base] = scratch.x;
        posArr[base + 1] = scratch.y;
        posArr[base + 2] = scratch.z;

        const isObstacle = isPointInObstacle(p.x, p.z, frame.obstacles);
        const color = isObstacle ? OBSTACLE_COLOR : BASE_COLOR;
        colArr[base] = color.r * fadeFactor;
        colArr[base + 1] = color.g * fadeFactor;
        colArr[base + 2] = color.b * fadeFactor;

        writeOffset += 1;
      }
    }

    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    geom.setDrawRange(0, writeOffset);
  });

  return (
    <points
      name="lidar-field"
      userData={{ skipLidar: true }}
      frustumCulled={false}
    >
      <bufferGeometry ref={geomRef}>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
          count={MAX_POINTS_TOTAL}
        />
        <bufferAttribute
          attach="attributes-color"
          args={[colors, 3]}
          count={MAX_POINTS_TOTAL}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.8}
        sizeAttenuation
        vertexColors
        transparent
        depthWrite={false}
      />
    </points>
  );
}
