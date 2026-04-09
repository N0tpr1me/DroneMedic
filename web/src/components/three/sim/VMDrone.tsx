// VMDrone — drone mesh driven directly by the telemetryRef in
// SimCockpitContext. Positions via useFrame so the Canvas tree never
// re-renders at telemetry rate. Reuses the CustomDroneModel from
// web/src/components/three/DroneScene.tsx.

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { useSimCockpit } from './SimCockpitContext';
import { enuFromLatLon } from './enuFrame';
import type { PX4Telemetry } from '../../../hooks/usePX4Telemetry';

// Lazy GLB load — reuses the same file as the legacy DroneScene.
useGLTF.preload('/models/drone.glb');

interface VMDroneProps {
  scale?: number;
  tilt?: boolean; // lean into turns
}

export function VMDrone({ scale = 2.5, tilt = true }: VMDroneProps) {
  const { scene } = useGLTF('/models/drone.glb');
  const { subscribeTelemetry } = useSimCockpit();

  const groupRef = useRef<THREE.Group>(null);
  const targetPos = useRef(new THREE.Vector3(0, 10, 0));
  const targetYaw = useRef(0);
  const lastPos = useRef<THREE.Vector3>(new THREE.Vector3());

  // Clone the GLB scene once per VMDrone instance and memoize so the mesh is
  // stable across re-renders. Shadows are enabled on every mesh so the
  // directional sun light from GoogleTilesScene casts onto the tiles.
  const clonedScene = useMemo(() => {
    const cloned = scene.clone(true);
    cloned.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        mesh.castShadow = true;
        mesh.receiveShadow = false;
      }
    });
    return cloned;
  }, [scene]);

  useEffect(() => {
    const unsub = subscribeTelemetry((t: PX4Telemetry | null) => {
      if (!t) return;
      const { east, north, up } = enuFromLatLon(t.lat, t.lon, t.relative_alt_m ?? 0);
      targetPos.current.set(east, Math.max(up, 1), -north);
      targetYaw.current = -((t.heading_deg ?? 0) * Math.PI) / 180;
    });
    return unsub;
  }, [subscribeTelemetry]);

  useFrame((_state, delta) => {
    const group = groupRef.current;
    if (!group) return;

    // Smoothly move toward target pose.
    const lerpAmount = Math.min(delta * 6, 1);
    group.position.lerp(targetPos.current, lerpAmount);

    // Yaw interpolation, shortest-path.
    const currentYaw = group.rotation.y;
    const desiredYaw = targetYaw.current;
    let diff = desiredYaw - currentYaw;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    group.rotation.y = currentYaw + diff * Math.min(delta * 3, 1);

    if (tilt) {
      // Approximate bank angle from lateral velocity.
      const dx = group.position.x - lastPos.current.x;
      const dz = group.position.z - lastPos.current.z;
      const lateralSpeed = Math.sqrt(dx * dx + dz * dz) / Math.max(delta, 1e-3);
      const bank = Math.min(lateralSpeed * 0.04, 0.5);
      group.rotation.z = THREE.MathUtils.lerp(
        group.rotation.z,
        -bank * Math.sign(diff || 1),
        Math.min(delta * 4, 1),
      );
    }

    lastPos.current.copy(group.position);
  });

  return (
    <group ref={groupRef} position={[0, 10, 0]} scale={scale}>
      <primitive object={clonedScene} />
      {/* running lights */}
      <pointLight position={[0, -0.4, 0]} intensity={1.5} color="#00e0ff" distance={6} />
      <pointLight position={[0, 0.2, -0.8]} intensity={0.8} color="#ff2d2d" distance={4} />
    </group>
  );
}
