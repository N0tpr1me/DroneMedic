// ProximityRing — obstacle proximity warning torus around the drone.
// Colour/opacity shift from green (safe) → yellow (caution) → red (danger)
// based on the nearest LiDAR obstacle distance. Red state pulses.

import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, DoubleSide, MeshBasicMaterial } from 'three';
import type { Mesh } from 'three';
import { useSimCockpit } from '../SimCockpitContext';
import { subscribeLidarFrame } from '../lidarBus';
import { enuFromLatLon } from '../enuFrame';

const GREEN = new Color('#22c55e');
const YELLOW = new Color('#f5a623');
const RED = new Color('#ff3355');

const OPACITY_SAFE = 0.04;
const OPACITY_WARN = 0.12;
const OPACITY_DANGER = 0.28;

const LERP_SPEED = 4; // colour transition speed (per second)

export function ProximityRing() {
  const { subscribeTelemetry } = useSimCockpit();

  const meshRef = useRef<Mesh>(null);
  const dronePos = useRef({ x: 0, y: 60, z: 0 });
  const nearestDist = useRef<number>(Infinity);

  // Target visual state (set from lidar frames).
  const targetColor = useRef(GREEN.clone());
  const targetOpacity = useRef(OPACITY_SAFE);

  // Subscribe to telemetry for position.
  useEffect(() => {
    return subscribeTelemetry((t) => {
      if (!t) return;
      const enu = enuFromLatLon(t.lat, t.lon, t.relative_alt_m ?? 60);
      dronePos.current.x = enu.east;
      dronePos.current.y = enu.up;
      dronePos.current.z = -enu.north;
    });
  }, [subscribeTelemetry]);

  // Subscribe to LiDAR frames for obstacle proximity.
  useEffect(() => {
    return subscribeLidarFrame((frame) => {
      const obstacles = frame.obstacles;
      if (obstacles.length === 0) {
        nearestDist.current = Infinity;
        targetColor.current.copy(GREEN);
        targetOpacity.current = OPACITY_SAFE;
        return;
      }
      let minDist = Infinity;
      for (const obs of obstacles) {
        if (obs.distance < minDist) minDist = obs.distance;
      }
      nearestDist.current = minDist;

      if (minDist > 30) {
        targetColor.current.copy(GREEN);
        targetOpacity.current = OPACITY_SAFE;
      } else if (minDist > 15) {
        targetColor.current.copy(YELLOW);
        targetOpacity.current = OPACITY_WARN;
      } else {
        targetColor.current.copy(RED);
        targetOpacity.current = OPACITY_DANGER;
      }
    });
  }, []);

  useFrame((state, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const dt = Math.min(delta, 0.1);
    const dp = dronePos.current;

    // Position follows drone.
    mesh.position.set(dp.x, dp.y, dp.z);
    // Lay the torus flat (XZ plane).
    mesh.rotation.x = Math.PI / 2;

    const mat = mesh.material as MeshBasicMaterial;

    // Lerp colour toward target.
    mat.color.lerp(targetColor.current, LERP_SPEED * dt);

    // Lerp opacity toward target, with pulse when in danger zone.
    let goalOpacity = targetOpacity.current;
    if (nearestDist.current < 15) {
      // Pulse using sin wave.
      const pulse = 0.5 + 0.5 * Math.sin(state.clock.elapsedTime * 6);
      goalOpacity = OPACITY_WARN + (OPACITY_DANGER - OPACITY_WARN) * pulse;
    }
    mat.opacity += (goalOpacity - mat.opacity) * LERP_SPEED * dt;

    mat.needsUpdate = true;
  });

  return (
    <mesh ref={meshRef} frustumCulled={false}>
      <torusGeometry args={[12, 0.3, 32, 64]} />
      <meshBasicMaterial
        color={GREEN}
        opacity={OPACITY_SAFE}
        transparent
        depthWrite={false}
        side={DoubleSide}
      />
    </mesh>
  );
}
