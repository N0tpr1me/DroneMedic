// CinematicIntro — a 3-second scripted camera orbit played the first time
// the 3D panel opens in a session. Writes directly to camera.position and
// then yields control back to CameraRig by flipping the preset back to the
// user's pick (default chase).

import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useSimCockpit } from '../SimCockpitContext';
import { enuFromLatLon } from '../enuFrame';

const DURATION = 3.2; // seconds

let _playedOnce = false;

export function CinematicIntro() {
  const { camera } = useThree();
  const { telemetryRef, setCameraPreset, reducedMotion } = useSimCockpit();
  const time = useRef(0);
  const active = useRef(!_playedOnce && !reducedMotion);
  const startPos = useRef(new THREE.Vector3());
  const finished = useRef(false);

  useEffect(() => {
    if (!active.current) return;
    startPos.current.copy(camera.position);
  }, [camera]);

  useFrame((_state, delta) => {
    if (!active.current || finished.current) return;
    time.current += delta;
    const progress = Math.min(time.current / DURATION, 1);

    // Circle around the drone, high → closer.
    const t = telemetryRef.current;
    const target = t
      ? (() => {
          const { east, north, up } = enuFromLatLon(
            t.lat,
            t.lon,
            Math.max(t.relative_alt_m, 25),
          );
          return new THREE.Vector3(east, up, -north);
        })()
      : new THREE.Vector3(0, 25, 0);

    const angle = Math.PI * 0.9 * progress;
    const radius = THREE.MathUtils.lerp(220, 45, progress);
    const height = THREE.MathUtils.lerp(260, 28, progress);
    const cx = target.x + Math.cos(angle) * radius;
    const cz = target.z + Math.sin(angle) * radius;
    camera.position.set(cx, height, cz);
    camera.lookAt(target);

    if (progress >= 1) {
      finished.current = true;
      active.current = false;
      _playedOnce = true;
      setCameraPreset('chase');
    }
  });

  return null;
}
