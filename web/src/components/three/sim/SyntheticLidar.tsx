// SyntheticLidar — headless r3f producer that raycasts the scene around the
// drone at 10 Hz and publishes `LidarFrame`s onto the shared lidarBus. No
// visual output of its own. Lives inside the <Canvas> tree so `useThree`
// resolves to the active scene and `useFrame` drives the scan cadence.

import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import {
  publishLidarFrame,
  type LidarFrame,
  type LidarObstacle,
  type LidarPoint,
} from './lidarBus';

// ─ Tunables ───────────────────────────────────────────────────────────

const SCAN_PERIOD_SECONDS = 0.1; // 10 Hz
const RAYCAST_NEAR_METERS = 4; // ignore anything stuck to the drone itself
const RAYCAST_FAR_METERS = 60;
const HORIZONTAL_BEAMS = 32;
const VERTICAL_BEAMS = 8;
const VERTICAL_SPAN_RADIANS = (30 * Math.PI) / 180; // ±15° elevation
const TARGET_REFRESH_INTERVAL_SECONDS = 3;
const CLUSTER_BUCKET_COUNT = 8;
const CLUSTER_MIN_DISTANCE_METERS = 5; // suppress ghost 1-3m hits on nearby helper geometry
const CLUSTER_MAX_DISTANCE_METERS = 30;
const SEVERITY_CRITICAL_METERS = 12;
const SEVERITY_WARNING_METERS = 22;

// Names (or ancestor names) that should never become raycast targets. These
// prevent the scanner from either hitting its own helper meshes or the drone
// body.
const EXCLUDED_NAMES: ReadonlySet<string> = new Set([
  'vm-drone',
  'Sky',
  'Clouds',
  'lidar-field',
]);

// ─ Helpers ────────────────────────────────────────────────────────────

function bearingToCardinal(bearing: number): string {
  // Normalize to [0, 2π).
  const twoPi = Math.PI * 2;
  let b = bearing % twoPi;
  if (b < 0) b += twoPi;
  const octant = Math.round(b / (Math.PI / 4)) % 8;
  const labels: readonly string[] = [
    'N',
    'NE',
    'E',
    'SE',
    'S',
    'SW',
    'W',
    'NW',
  ];
  return labels[octant] ?? 'N';
}

function hasExcludedAncestor(object: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (EXCLUDED_NAMES.has(current.name)) return true;
    if (current.userData && current.userData.skipLidar === true) return true;
    current = current.parent;
  }
  return false;
}

function collectTargets(scene: THREE.Scene): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  scene.traverse((obj) => {
    // Skip anything that isn't a mesh, or is a Points cloud.
    if ((obj as THREE.Points).isPoints === true) return;
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh !== true) return;
    if (!mesh.geometry) return;
    if (hasExcludedAncestor(mesh)) return;
    out.push(mesh);
  });
  return out;
}

// ─ Component ──────────────────────────────────────────────────────────

export function SyntheticLidar(): null {
  const { scene } = useThree();

  // Preallocated scratch objects. Never reallocated inside useFrame.
  const raycasterRef = useRef<THREE.Raycaster>(new THREE.Raycaster());
  const dronePositionRef = useRef<THREE.Vector3>(new THREE.Vector3());
  const droneQuaternionRef = useRef<THREE.Quaternion>(new THREE.Quaternion());
  const droneInverseQuaternionRef = useRef<THREE.Quaternion>(
    new THREE.Quaternion(),
  );
  const forwardRef = useRef<THREE.Vector3>(new THREE.Vector3());
  const rayDirectionRef = useRef<THREE.Vector3>(new THREE.Vector3());
  const hitLocalRef = useRef<THREE.Vector3>(new THREE.Vector3());
  const targetsRef = useRef<THREE.Mesh[]>([]);
  const targetsAgeRef = useRef<number>(Number.POSITIVE_INFINITY);
  const scanAccumulatorRef = useRef<number>(0);

  useEffect(() => {
    const raycaster = raycasterRef.current;
    raycaster.far = RAYCAST_FAR_METERS;
    raycaster.near = RAYCAST_NEAR_METERS;
    // Seed the target list immediately so the first scan has something to
    // raycast against.
    targetsRef.current = collectTargets(scene);
    targetsAgeRef.current = 0;
  }, [scene]);

  useFrame((_state, delta) => {
    scanAccumulatorRef.current += delta;
    targetsAgeRef.current += delta;

    if (scanAccumulatorRef.current < SCAN_PERIOD_SECONDS) return;
    scanAccumulatorRef.current = 0;

    // Refresh the cached mesh list every ~3 seconds in case the scene graph
    // has grown (e.g. mission overlays spawning).
    if (targetsAgeRef.current >= TARGET_REFRESH_INTERVAL_SECONDS) {
      targetsRef.current = collectTargets(scene);
      targetsAgeRef.current = 0;
    }

    const drone = scene.getObjectByName('vm-drone');
    if (!drone) return;

    const raycaster = raycasterRef.current;
    const dronePos = dronePositionRef.current;
    const droneQuat = droneQuaternionRef.current;
    const droneInvQuat = droneInverseQuaternionRef.current;
    const forward = forwardRef.current;
    const rayDir = rayDirectionRef.current;
    const hitLocal = hitLocalRef.current;
    const targets = targetsRef.current;

    drone.getWorldPosition(dronePos);
    drone.getWorldQuaternion(droneQuat);
    droneInvQuat.copy(droneQuat).invert();

    // Forward vector in world space, then derive yaw heading.
    forward.set(0, 0, -1).applyQuaternion(droneQuat);
    const heading = Math.atan2(forward.x, -forward.z);

    const timestamp = Date.now();
    const points: LidarPoint[] = [];

    for (let h = 0; h < HORIZONTAL_BEAMS; h++) {
      const hAngle = (h / HORIZONTAL_BEAMS) * Math.PI * 2;
      for (let v = 0; v < VERTICAL_BEAMS; v++) {
        // Map [0 .. VERTICAL_BEAMS-1] to [-0.5 .. +0.5] across the elevation
        // span. With VERTICAL_BEAMS = 8 this gives 8 tilt angles straddling
        // the horizon.
        const vRatio = v / (VERTICAL_BEAMS - 1) - 0.5;
        const vAngle = vRatio * VERTICAL_SPAN_RADIANS;

        // Build direction in drone-local frame: forward is -Z, right is +X,
        // up is +Y. hAngle rotates around Y (yaw) from forward.
        const cosV = Math.cos(vAngle);
        const localX = Math.sin(hAngle) * cosV;
        const localY = Math.sin(vAngle);
        const localZ = -Math.cos(hAngle) * cosV;
        rayDir.set(localX, localY, localZ).applyQuaternion(droneQuat);
        rayDir.normalize();

        raycaster.set(dronePos, rayDir);
        // We want the first opaque hit — raycaster returns sorted by distance.
        const intersections = raycaster.intersectObjects(targets, false);
        if (intersections.length === 0) continue;

        const hit = intersections[0];
        if (!hit) continue;
        const distance = hit.distance;
        if (distance < RAYCAST_NEAR_METERS || distance > RAYCAST_FAR_METERS) continue;

        // Transform world hit into drone-local coordinates.
        hitLocal
          .copy(hit.point)
          .sub(dronePos)
          .applyQuaternion(droneInvQuat);

        const intensity = Math.max(0, 1 - distance / RAYCAST_FAR_METERS);
        points.push({
          x: hitLocal.x,
          y: hitLocal.y,
          z: hitLocal.z,
          distance,
          intensity,
        });
      }
    }

    // ─ Cluster into obstacles by angular bucket ──────────────────────
    const bucketSize = Math.PI / (CLUSTER_BUCKET_COUNT / 2); // = π/4
    const bucketPoints: LidarPoint[][] = Array.from(
      { length: CLUSTER_BUCKET_COUNT },
      () => [],
    );

    for (const p of points) {
      if (p.distance >= CLUSTER_MAX_DISTANCE_METERS) continue;
      if (p.distance < CLUSTER_MIN_DISTANCE_METERS) continue;
      // Bearing from drone nose: 0 = forward (-Z local), +π/2 = right (+X).
      const bearing = Math.atan2(p.x, -p.z);
      let normalized = bearing;
      const twoPi = Math.PI * 2;
      if (normalized < 0) normalized += twoPi;
      const rawBucket = Math.floor(normalized / bucketSize);
      const bucket =
        ((rawBucket % CLUSTER_BUCKET_COUNT) + CLUSTER_BUCKET_COUNT) %
        CLUSTER_BUCKET_COUNT;
      const list = bucketPoints[bucket];
      if (list) list.push(p);
    }

    const obstacles: LidarObstacle[] = [];
    for (let bucket = 0; bucket < CLUSTER_BUCKET_COUNT; bucket++) {
      const list = bucketPoints[bucket];
      if (!list || list.length === 0) continue;

      let minDistance = Number.POSITIVE_INFINITY;
      let bearingSumSin = 0;
      let bearingSumCos = 0;
      for (const p of list) {
        if (p.distance < minDistance) minDistance = p.distance;
        const b = Math.atan2(p.x, -p.z);
        bearingSumSin += Math.sin(b);
        bearingSumCos += Math.cos(b);
      }
      // Circular mean avoids the wraparound bug at 0/2π.
      const meanBearing = Math.atan2(bearingSumSin, bearingSumCos);

      const severity: LidarObstacle['severity'] =
        minDistance < SEVERITY_CRITICAL_METERS
          ? 'critical'
          : minDistance < SEVERITY_WARNING_METERS
            ? 'warning'
            : 'info';

      const cardinal = bearingToCardinal(meanBearing);
      const label = `Obstacle @${minDistance.toFixed(0)}m ${cardinal}`;

      obstacles.push({
        id: `lidar-b${bucket}-${timestamp}`,
        bearing: meanBearing,
        distance: minDistance,
        label,
        severity,
        timestamp,
      });
    }

    const frame: LidarFrame = {
      timestamp,
      source: 'synthetic',
      points,
      obstacles,
      dronePosition: { x: dronePos.x, y: dronePos.y, z: dronePos.z },
      droneHeading: heading,
    };
    publishLidarFrame(frame);
  });

  return null;
}
