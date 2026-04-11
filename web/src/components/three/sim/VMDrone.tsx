// VMDrone — GLB drone model with Suspense fallback to procedural hexacopter,
// driven by telemetry refs from SimCockpitContext. Includes blinking
// navigation lights (port red, starboard green, white strobe).

import { Suspense, useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { useSimCockpit } from './SimCockpitContext';
import { enuFromLatLon } from './enuFrame';
import type { PX4Telemetry } from '../../../hooks/usePX4Telemetry';

interface VMDroneProps {
  scale?: number;
  tilt?: boolean;
}

const ARM_COUNT = 6;

/* ------------------------------------------------------------------ */
/*  GLB Model                                                         */
/* ------------------------------------------------------------------ */

function GLBDrone() {
  const { scene } = useGLTF('/models/drone-medic.glb');
  const clonedScene = useMemo(() => scene.clone(true), [scene]);
  const propMeshes = useRef<THREE.Object3D[]>([]);

  // Traverse once to find propeller-like meshes for spinning.
  useEffect(() => {
    const props: THREE.Object3D[] = [];
    clonedScene.traverse((node) => {
      const name = node.name.toLowerCase();
      if (name.includes('prop') || name.includes('rotor') || name.includes('blade')) {
        props.push(node);
      }
    });
    propMeshes.current = props;
  }, [clonedScene]);

  useFrame((_, delta) => {
    for (const prop of propMeshes.current) {
      prop.rotation.y += delta * 30;
    }
  });

  return <primitive object={clonedScene} />;
}

useGLTF.preload('/models/drone-medic.glb');

/* ------------------------------------------------------------------ */
/*  Procedural Fallback (original hexacopter)                         */
/* ------------------------------------------------------------------ */

function ProceduralDrone() {
  const propRefs = useRef<(THREE.Mesh | null)[]>([]);

  const arms = useMemo(
    () =>
      Array.from({ length: ARM_COUNT }, (_, i) => {
        const angle = (i / ARM_COUNT) * Math.PI * 2;
        return { angle, x: Math.cos(angle), z: Math.sin(angle) };
      }),
    [],
  );

  useFrame((_, delta) => {
    propRefs.current.forEach((prop) => {
      if (prop) prop.rotation.y += delta * 30;
    });
  });

  return (
    <group>
      {/* Central body — wide flat hexagonal disc */}
      <mesh castShadow>
        <cylinderGeometry args={[1.1, 1.2, 0.35, 24]} />
        <meshStandardMaterial
          color="#0e1322"
          metalness={0.75}
          roughness={0.25}
          emissive="#00131c"
          emissiveIntensity={0.4}
        />
      </mesh>
      {/* Cyan dome sensor */}
      <mesh position={[0, 0.28, 0]} castShadow>
        <sphereGeometry
          args={[0.65, 24, 20, 0, Math.PI * 2, 0, Math.PI / 2]}
        />
        <meshStandardMaterial
          color="#00daf3"
          emissive="#00e0ff"
          emissiveIntensity={1}
          metalness={0.4}
          roughness={0.2}
          transparent
          opacity={0.75}
        />
      </mesh>

      {arms.map((arm, i) => (
        <group key={i} rotation={[0, -arm.angle, 0]}>
          {/* arm shaft */}
          <mesh position={[1.3, 0, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[0.13, 0.13, 2.2, 10]} />
            <meshStandardMaterial color="#20283e" metalness={0.7} roughness={0.4} />
          </mesh>
          {/* motor */}
          <mesh position={[2.4, 0.12, 0]} castShadow>
            <cylinderGeometry args={[0.3, 0.3, 0.25, 14]} />
            <meshStandardMaterial color="#1a1f30" metalness={0.9} roughness={0.1} />
          </mesh>
          {/* prop disc */}
          <mesh
            ref={(el) => {
              propRefs.current[i] = el;
            }}
            position={[2.4, 0.28, 0]}
            rotation={[Math.PI / 2, 0, 0]}
          >
            <circleGeometry args={[1.1, 24]} />
            <meshStandardMaterial
              color="#00daf3"
              transparent
              opacity={0.22}
              side={THREE.DoubleSide}
              emissive="#00e0ff"
              emissiveIntensity={0.35}
            />
          </mesh>
        </group>
      ))}

      {/* Landing skids */}
      <mesh position={[0, -0.5, 0]}>
        <boxGeometry args={[2.2, 0.08, 0.08]} />
        <meshStandardMaterial color="#1a2030" metalness={0.6} roughness={0.3} />
      </mesh>
      <mesh position={[0, -0.5, 0]} rotation={[0, Math.PI / 2, 0]}>
        <boxGeometry args={[2.2, 0.08, 0.08]} />
        <meshStandardMaterial color="#1a2030" metalness={0.6} roughness={0.3} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/*  Navigation Lights                                                 */
/* ------------------------------------------------------------------ */

function NavLights() {
  const portRef = useRef<THREE.PointLight>(null);
  const starboardRef = useRef<THREE.PointLight>(null);
  const strobeRef = useRef<THREE.PointLight>(null);

  const PORT_INTENSITY = 2;
  const STARBOARD_INTENSITY = 2;
  const STROBE_INTENSITY = 4;

  useFrame((state) => {
    const t = state.clock.elapsedTime;

    // Port & starboard: ~1 Hz blink
    const blink = Math.sin(t * Math.PI * 2) > 0 ? 1 : 0;
    if (portRef.current) portRef.current.intensity = blink * PORT_INTENSITY;
    if (starboardRef.current) starboardRef.current.intensity = blink * STARBOARD_INTENSITY;

    // White strobe: double-flash every 2 seconds.
    // Two 50ms flashes separated by 100ms, then off for ~1.8s.
    const cycle = t % 2; // 0..2
    const flash1 = cycle >= 0 && cycle < 0.05;
    const flash2 = cycle >= 0.15 && cycle < 0.2;
    const strobeOn = flash1 || flash2;
    if (strobeRef.current) strobeRef.current.intensity = strobeOn ? STROBE_INTENSITY : 0;
  });

  return (
    <>
      {/* Port (left) — red */}
      <pointLight
        ref={portRef}
        position={[-2.5, 0, 0]}
        color="#ff0000"
        intensity={PORT_INTENSITY}
        distance={15}
      />
      {/* Starboard (right) — green */}
      <pointLight
        ref={starboardRef}
        position={[2.5, 0, 0]}
        color="#00ff00"
        intensity={STARBOARD_INTENSITY}
        distance={15}
      />
      {/* Top strobe — white double-flash */}
      <pointLight
        ref={strobeRef}
        position={[0, 0.5, 0]}
        color="#ffffff"
        intensity={0}
        distance={20}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  VMDrone — main component                                          */
/* ------------------------------------------------------------------ */

export function VMDrone({ scale = 3, tilt = true }: VMDroneProps) {
  const { subscribeTelemetry } = useSimCockpit();

  const groupRef = useRef<THREE.Group>(null);
  const targetPos = useRef(new THREE.Vector3(0, 30, 0));
  const targetYaw = useRef(0);
  const lastPos = useRef<THREE.Vector3>(new THREE.Vector3(0, 30, 0));

  // Subscribe imperatively so context state updates don't reconcile the canvas.
  useEffect(() => {
    const unsub = subscribeTelemetry((t: PX4Telemetry | null) => {
      if (
        !t ||
        !Number.isFinite(t.lat) ||
        !Number.isFinite(t.lon) ||
        (Math.abs(t.lat) < 0.1 && Math.abs(t.lon) < 0.1)
      ) {
        // no useful GPS — leave the drone hovering at the depot.
        return;
      }
      const { east, north, up } = enuFromLatLon(
        t.lat,
        t.lon,
        t.relative_alt_m ?? 0,
      );
      targetPos.current.set(east, Math.max(up, 10), -north);
      targetYaw.current = -((t.heading_deg ?? 0) * Math.PI) / 180;
    });
    return unsub;
  }, [subscribeTelemetry]);

  // Initialize drone at depot so it's visible before telemetry arrives
  useEffect(() => {
    const DEPOT_LAT = 51.5074;
    const DEPOT_LON = -0.1278;
    const { east, north } = enuFromLatLon(DEPOT_LAT, DEPOT_LON, 30);
    targetPos.current.set(east, 30, -north);
  }, []);

  useFrame((state, delta) => {
    const group = groupRef.current;
    if (!group) return;

    // Gentle hover bob if no telemetry yet so the drone isn't frozen.
    const hoverBob = Math.sin(state.clock.elapsedTime * 1.3) * 0.4;
    const lerpAmount = Math.min(delta * 6, 1);
    group.position.lerp(targetPos.current, lerpAmount);
    group.position.y += hoverBob * delta;

    // Yaw interpolation, shortest-path.
    const currentYaw = group.rotation.y;
    const desiredYaw = targetYaw.current;
    let diff = desiredYaw - currentYaw;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    group.rotation.y = currentYaw + diff * Math.min(delta * 3, 1);

    if (tilt) {
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
    <group ref={groupRef} name="vm-drone" position={[0, 30, 0]} scale={scale}>
      {/* Drone mesh — GLB with procedural fallback */}
      <Suspense fallback={<ProceduralDrone />}>
        <GLBDrone />
      </Suspense>

      {/* Navigation lights (outside Suspense so they always render) */}
      <NavLights />

      {/* Running lights */}
      <pointLight
        position={[0, -0.3, 0]}
        intensity={3}
        color="#00e0ff"
        distance={20}
      />
      <pointLight
        position={[-1.5, 0.2, 0]}
        intensity={2}
        color="#ff3333"
        distance={12}
      />
    </group>
  );
}
