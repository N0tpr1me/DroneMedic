// CameraRig — five camera presets for the 3D cockpit.
//
//   chase      : behind-and-above the drone, looking at it.
//   cockpit    : first-person from the drone's front sensor.
//   topdown    : high altitude straight-down satellite view.
//   cinematic  : slow orbit at medium radius.
//   free       : user-controlled OrbitControls (no scripted motion).
//
// The rig reads telemetry via the context's telemetryRef so it does not
// re-render at frame rate. Smooth transitions between presets use simple
// vector lerps.

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import { useSimCockpit } from './SimCockpitContext';
import { enuFromLatLon } from './enuFrame';

const CHASE_OFFSET = new THREE.Vector3(-25, 18, 25);
const COCKPIT_OFFSET = new THREE.Vector3(0, 1.2, 0);
const TOPDOWN_OFFSET = new THREE.Vector3(0, 280, 0);
const CINEMATIC_RADIUS = 40;
const CINEMATIC_HEIGHT = 18;

export function CameraRig() {
  const { camera } = useThree();
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const { telemetryRef, cameraPreset, reducedMotion } = useSimCockpit();

  const tmpTarget = useMemo(() => new THREE.Vector3(), []);
  const desiredPos = useMemo(() => new THREE.Vector3(20, 60, 30), []);
  const time = useRef(0);

  useEffect(() => {
    if (!controlsRef.current) return;
    controlsRef.current.enabled = cameraPreset === 'free';
  }, [cameraPreset]);

  useFrame((_state, delta) => {
    time.current += delta;
    const t = telemetryRef.current;
    const dronePos = tmpTarget;
    if (t) {
      const { east, north, up } = enuFromLatLon(t.lat, t.lon, Math.max(t.relative_alt_m, 2));
      dronePos.set(east, up, -north);
    } else {
      dronePos.set(0, 30, 0);
    }

    if (cameraPreset === 'free') {
      if (controlsRef.current) {
        controlsRef.current.target.lerp(dronePos, Math.min(delta * 2, 1));
        controlsRef.current.update();
      }
      return;
    }

    if (cameraPreset === 'chase') {
      desiredPos.copy(dronePos).add(CHASE_OFFSET);
    } else if (cameraPreset === 'cockpit') {
      desiredPos.copy(dronePos).add(COCKPIT_OFFSET);
      const heading = t?.heading_deg ?? 0;
      const rad = -heading * (Math.PI / 180);
      const forward = new THREE.Vector3(Math.sin(rad), 0, -Math.cos(rad));
      const look = dronePos.clone().add(forward.multiplyScalar(80));
      look.y += 2;
      camera.position.lerp(desiredPos, Math.min(delta * 6, 1));
      camera.lookAt(look);
      return;
    } else if (cameraPreset === 'topdown') {
      desiredPos.copy(dronePos).add(TOPDOWN_OFFSET);
    } else if (cameraPreset === 'cinematic') {
      const angle = time.current * (reducedMotion ? 0.05 : 0.15);
      desiredPos.set(
        dronePos.x + Math.cos(angle) * CINEMATIC_RADIUS,
        dronePos.y + CINEMATIC_HEIGHT,
        dronePos.z + Math.sin(angle) * CINEMATIC_RADIUS,
      );
    }

    camera.position.lerp(desiredPos, Math.min(delta * 3, 1));
    camera.lookAt(dronePos);
  });

  return (
    <OrbitControls
      ref={controlsRef}
      enableDamping
      dampingFactor={0.08}
      enabled={cameraPreset === 'free'}
      minDistance={20}
      maxDistance={5000}
      maxPolarAngle={Math.PI / 2.05}
    />
  );
}
