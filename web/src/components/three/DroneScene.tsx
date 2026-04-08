import { Canvas, useFrame } from '@react-three/fiber';
import { Float, Sparkles, OrbitControls, Line, useGLTF } from '@react-three/drei';
import { useRef, useMemo } from 'react';
import * as THREE from 'three';
import type { PX4Telemetry } from '../../hooks/usePX4Telemetry';

// ── GPS → Local coordinate conversion ──
// Depot is the origin. Scale: ~1 unit = 100m for a nice scene size.

const DEPOT_LAT = 51.5074;
const DEPOT_LON = -0.1278;
const SCENE_SCALE = 0.01; // meters → scene units

function gpsToLocal(lat: number, lon: number, alt: number): [number, number, number] {
  const x = (lon - DEPOT_LON) * 111320 * Math.cos(DEPOT_LAT * Math.PI / 180) * SCENE_SCALE;
  const z = (lat - DEPOT_LAT) * 110540 * SCENE_SCALE;
  const y = alt * SCENE_SCALE;
  return [x, y, -z]; // negate z for Three.js coordinate system
}

// Waypoint data matching config.py LOCATIONS
const SIM_WAYPOINTS = [
  { name: 'Depot', lat: 51.5074, lon: -0.1278 },
  { name: 'Clinic A', lat: 51.5124, lon: -0.1200 },
  { name: 'Clinic B', lat: 51.5174, lon: -0.1350 },
  { name: 'Clinic C', lat: 51.5044, lon: -0.1100 },
  { name: 'Clinic D', lat: 51.5000, lon: -0.1400 },
];

// ── Hexacopter Drone Model ──

// 6 motor arm positions (hexagonal layout, 60-degree increments)
const HEX_ARMS = Array.from({ length: 6 }, (_, i) => {
  const angle = (i * Math.PI * 2) / 6;
  return {
    x: Math.cos(angle) * 0.9,
    z: Math.sin(angle) * 0.9,
    angle,
  };
});

function HexaDroneModel({ scale = 1 }: { scale?: number }) {
  const bodyRef = useRef<THREE.Group>(null);
  const propRefs = useRef<THREE.Mesh[]>([]);

  useFrame((state, delta) => {
    if (bodyRef.current) {
      bodyRef.current.rotation.y = state.clock.elapsedTime * 0.3;
    }
    // Spin all prop discs
    propRefs.current.forEach((prop) => {
      if (prop) prop.rotation.y += delta * 25;
    });
  });

  return (
    <Float speed={2} rotationIntensity={0.2} floatIntensity={0.8}>
      <group ref={bodyRef} scale={scale}>
        {/* Central body — rounded cylinder */}
        <mesh>
          <cylinderGeometry args={[0.35, 0.38, 0.18, 24]} />
          <meshStandardMaterial color="#0d1020" metalness={0.6} roughness={0.3} />
        </mesh>
        {/* Dome sensor housing */}
        <mesh position={[0, 0.15, 0]}>
          <sphereGeometry args={[0.22, 20, 20, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color="#00daf3" metalness={0.6} roughness={0.3} transparent opacity={0.55} />
        </mesh>

        {/* 6 motor arms + motors + prop discs */}
        {HEX_ARMS.map((arm, i) => (
          <group key={i}>
            {/* Arm — thin cylinder rotated to point outward */}
            <mesh
              position={[arm.x * 0.5, 0, arm.z * 0.5]}
              rotation={[0, 0, Math.PI / 2]}
            >
              <cylinderGeometry args={[0.035, 0.035, 0.9, 8]} />
              <meshStandardMaterial color="#1a1a30" metalness={0.7} roughness={0.3} />
            </mesh>
            {/* Rotate arm to correct direction */}
            <group rotation={[0, -arm.angle + Math.PI / 2, 0]}>
              <mesh position={[0, 0, 0]} />
            </group>

            {/* Motor housing */}
            <mesh position={[arm.x, 0.08, arm.z]}>
              <cylinderGeometry args={[0.07, 0.07, 0.12, 12]} />
              <meshStandardMaterial color="#222" metalness={0.9} roughness={0.1} />
            </mesh>

            {/* Prop disc (spinning) */}
            <mesh
              ref={(el) => { if (el) propRefs.current[i] = el; }}
              position={[arm.x, 0.16, arm.z]}
              rotation={[Math.PI / 2, 0, 0]}
            >
              <circleGeometry args={[0.3, 24]} />
              <meshStandardMaterial
                color="#00daf3"
                transparent
                opacity={0.1}
                side={THREE.DoubleSide}
              />
            </mesh>
          </group>
        ))}

        {/* Landing gear — 3 legs (every other arm position) */}
        {[0, 2, 4].map((idx) => {
          const arm = HEX_ARMS[idx];
          return (
            <group key={`leg-${idx}`}>
              {/* Vertical strut */}
              <mesh position={[arm.x * 0.6, -0.2, arm.z * 0.6]}>
                <cylinderGeometry args={[0.02, 0.02, 0.25, 6]} />
                <meshStandardMaterial color="#1a1a30" metalness={0.7} roughness={0.3} />
              </mesh>
              {/* Foot */}
              <mesh position={[arm.x * 0.6, -0.32, arm.z * 0.6]} rotation={[0, 0, Math.PI / 2]}>
                <cylinderGeometry args={[0.015, 0.015, 0.15, 6]} />
                <meshStandardMaterial color="#1a1a30" metalness={0.7} roughness={0.3} />
              </mesh>
            </group>
          );
        })}

        {/* LED lights */}
        {/* Cyan belly light */}
        <pointLight position={[0, -0.25, 0]} intensity={0.6} color="#00daf3" distance={2.5} />
        <mesh position={[0, -0.1, 0]}>
          <cylinderGeometry args={[0.15, 0.15, 0.015, 16]} />
          <meshStandardMaterial color="#00daf3" emissive="#00daf3" emissiveIntensity={0.5} />
        </mesh>
        {/* Red rear LED */}
        <pointLight position={[0, 0, -0.4]} intensity={0.3} color="#ff3333" distance={1.5} />
        <mesh position={[0, 0.02, -0.38]}>
          <sphereGeometry args={[0.04, 8, 8]} />
          <meshStandardMaterial color="#ff3333" emissive="#ff3333" emissiveIntensity={0.6} />
        </mesh>
      </group>
    </Float>
  );
}

// Keep backward-compatible name — now uses custom GLB model
function DroneModel({ scale = 1 }: { scale?: number }) {
  return (
    <Float speed={2} rotationIntensity={0.2} floatIntensity={0.8}>
      <CustomDroneModel scale={scale * 0.5} />
    </Float>
  );
}

// ── Route Lines (for routes scene) ──

function RouteLines() {
  const points = useMemo(() => {
    const locations = [
      [0, 0, 0], [3, 0.5, 2], [-2, 0.3, 3], [4, 0.4, -1], [-3, 0.2, -2],
    ];
    const lines: THREE.Vector3[][] = [];
    for (let i = 0; i < locations.length; i++) {
      for (let j = i + 1; j < locations.length; j++) {
        if (Math.random() > 0.4) {
          const from = new THREE.Vector3(...locations[i]);
          const to = new THREE.Vector3(...locations[j]);
          const mid = new THREE.Vector3().lerpVectors(from, to, 0.5);
          mid.y += 1;
          const curve = new THREE.QuadraticBezierCurve3(from, mid, to);
          lines.push(curve.getPoints(32));
        }
      }
    }
    return lines;
  }, []);

  return (
    <>
      {points.map((pts, i) => (
        <Line key={i} points={pts} color="#00daf3" lineWidth={1.5} transparent opacity={0.4} />
      ))}
      {[[0, 0, 0], [3, 0, 2], [-2, 0, 3], [4, 0, -1], [-3, 0, -2]].map((pos, i) => (
        <mesh key={`marker-${i}`} position={pos as [number, number, number]}>
          <sphereGeometry args={[0.1, 12, 12]} />
          <meshStandardMaterial color={i === 0 ? '#b3c5ff' : '#00daf3'} emissive={i === 0 ? '#b3c5ff' : '#00daf3'} emissiveIntensity={2} />
        </mesh>
      ))}
    </>
  );
}

// ── Rain Particles (for weather scene) ──

function RainParticles() {
  const ref = useRef<THREE.Points>(null);
  const count = 500;
  const positions = useMemo(() => {
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 12;
      pos[i * 3 + 1] = Math.random() * 8;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 12;
    }
    return pos;
  }, []);

  useFrame(() => {
    if (!ref.current) return;
    const pos = ref.current.geometry.attributes.position.array as Float32Array;
    for (let i = 0; i < count; i++) {
      pos[i * 3 + 1] -= 0.08;
      if (pos[i * 3 + 1] < -1) pos[i * 3 + 1] = 8;
    }
    ref.current.geometry.attributes.position.needsUpdate = true;
  });

  return (
    <points ref={ref}>
      <bufferGeometry><bufferAttribute attach="attributes-position" args={[positions, 3]} /></bufferGeometry>
      <pointsMaterial color="#aaccff" size={0.03} transparent opacity={0.5} />
    </points>
  );
}

// ── Fleet (multiple drones) ──

function FleetDrones() {
  return (
    <group>
      <group position={[0, 0, 0]}><DroneModel scale={0.7} /></group>
      <group position={[-2.5, 0.3, -1.5]}><DroneModel scale={0.5} /></group>
      <group position={[2.5, 0.2, -1.5]}><DroneModel scale={0.5} /></group>
    </group>
  );
}

// ── Ground Plane ──

function GroundPlane() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.5, 0]}>
      <planeGeometry args={[30, 30]} />
      <meshStandardMaterial color="#06060f" metalness={0.5} roughness={0.8} />
    </mesh>
  );
}

// ── Custom GLB Drone Model ──

function CustomDroneModel({ scale = 1 }: { scale?: number }) {
  const { scene } = useGLTF('/models/drone.glb');
  const cloned = useMemo(() => scene.clone(), [scene]);
  return <primitive object={cloned} scale={scale} />;
}

// Preload the model
useGLTF.preload('/models/drone.glb');

// ── Simulation Drone (positioned by telemetry) ──

function SimDrone({ telemetry }: { telemetry: PX4Telemetry | null }) {
  const groupRef = useRef<THREE.Group>(null);
  const targetPos = useRef(new THREE.Vector3(0, 0, 0));

  useFrame((_state, delta) => {
    if (!groupRef.current) return;

    // Update target position from telemetry
    if (telemetry) {
      const [x, y, z] = gpsToLocal(telemetry.lat, telemetry.lon, telemetry.relative_alt_m);
      targetPos.current.set(x, y, z);
    }

    // Smooth interpolation toward target
    groupRef.current.position.lerp(targetPos.current, Math.min(delta * 5, 1));

    // Rotate to heading
    if (telemetry) {
      const targetRot = -telemetry.heading_deg * (Math.PI / 180);
      groupRef.current.rotation.y += (targetRot - groupRef.current.rotation.y) * Math.min(delta * 3, 1);
    }
  });

  return (
    <group ref={groupRef}>
      <CustomDroneModel scale={0.5} />
      {/* LED lights for visibility */}
      <pointLight position={[0, -0.25, 0]} intensity={0.6} color="#00daf3" distance={2.5} />
      <pointLight position={[0, 0, -0.4]} intensity={0.3} color="#ff3333" distance={1.5} />
    </group>
  );
}

// ── Simulation Ground Grid ──

function SimGround() {
  return (
    <group>
      <gridHelper args={[40, 40, '#1a2030', '#0f1520']} position={[0, 0, 0]} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
        <planeGeometry args={[40, 40]} />
        <meshStandardMaterial color="#080c14" metalness={0.3} roughness={0.9} />
      </mesh>
    </group>
  );
}

// ── Simulation Waypoint Markers ──

function SimWaypoints() {
  return (
    <>
      {SIM_WAYPOINTS.map((wp) => {
        const [x, , z] = gpsToLocal(wp.lat, wp.lon, 0);
        const isDepot = wp.name === 'Depot';
        return (
          <group key={wp.name} position={[x, 0.1, z]}>
            {/* Marker pillar */}
            <mesh>
              <cylinderGeometry args={[0.08, 0.08, 0.3, 8]} />
              <meshStandardMaterial color={isDepot ? '#b3c5ff' : '#00daf3'} emissive={isDepot ? '#b3c5ff' : '#00daf3'} emissiveIntensity={1.5} />
            </mesh>
            {/* Pulsing ring on ground */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.09, 0]}>
              <ringGeometry args={[0.2, 0.35, 24]} />
              <meshStandardMaterial color={isDepot ? '#b3c5ff' : '#00daf3'} emissive={isDepot ? '#b3c5ff' : '#00daf3'} emissiveIntensity={0.8} transparent opacity={0.4} />
            </mesh>
          </group>
        );
      })}
    </>
  );
}

// ── Simulation Route Lines ──

function SimRouteLines() {
  const lines = useMemo(() => {
    const result: THREE.Vector3[][] = [];
    for (let i = 0; i < SIM_WAYPOINTS.length; i++) {
      const next = (i + 1) % SIM_WAYPOINTS.length;
      const [x1, , z1] = gpsToLocal(SIM_WAYPOINTS[i].lat, SIM_WAYPOINTS[i].lon, 0);
      const [x2, , z2] = gpsToLocal(SIM_WAYPOINTS[next].lat, SIM_WAYPOINTS[next].lon, 0);
      const from = new THREE.Vector3(x1, 0.05, z1);
      const to = new THREE.Vector3(x2, 0.05, z2);
      const mid = new THREE.Vector3().lerpVectors(from, to, 0.5);
      mid.y += 0.5;
      const curve = new THREE.QuadraticBezierCurve3(from, mid, to);
      result.push(curve.getPoints(24));
    }
    return result;
  }, []);

  return (
    <>
      {lines.map((pts, i) => (
        <Line key={i} points={pts} color="#00daf3" lineWidth={1} transparent opacity={0.25} />
      ))}
    </>
  );
}

// ── Camera Follow (for sim scene) ──

function CameraFollow({ telemetry }: { telemetry: PX4Telemetry | null }) {
  useFrame(({ camera }) => {
    if (!telemetry) return;
    const [x, y, z] = gpsToLocal(telemetry.lat, telemetry.lon, telemetry.relative_alt_m);
    const target = new THREE.Vector3(x, y, z);
    const offset = new THREE.Vector3(3, 2.5, 3);
    const desired = target.clone().add(offset);
    camera.position.lerp(desired, 0.02);
    camera.lookAt(target);
  });
  return null;
}

// ── Scene Configurations ──

type SceneType = 'hero' | 'routes' | 'weather' | 'ai' | 'fleet' | 'sim';

function SceneContent({ scene, telemetry }: { scene: SceneType; telemetry?: PX4Telemetry | null }) {
  switch (scene) {
    case 'hero':
      return (
        <>
          <DroneModel scale={1.2} />
          <Sparkles count={200} scale={14} size={1.5} speed={0.3} color="#00daf3" opacity={0.3} />
        </>
      );
    case 'routes':
      return (
        <>
          <DroneModel scale={0.8} />
          <RouteLines />
          <GroundPlane />
          <Sparkles count={80} scale={12} size={1} speed={0.2} color="#b3c5ff" opacity={0.2} />
        </>
      );
    case 'weather':
      return (
        <>
          <DroneModel scale={0.9} />
          <RainParticles />
          <GroundPlane />
          <pointLight position={[0, 3, 0]} intensity={0.5} color="#ff6600" />
        </>
      );
    case 'ai':
      return (
        <>
          <DroneModel scale={0.9} />
          <Sparkles count={300} scale={10} size={2} speed={0.5} color="#8b5cf6" opacity={0.4} />
          <Sparkles count={100} scale={8} size={1} speed={0.8} color="#00daf3" opacity={0.3} />
          <GroundPlane />
        </>
      );
    case 'fleet':
      return (
        <>
          <FleetDrones />
          <Sparkles count={150} scale={14} size={1.2} speed={0.3} color="#00daf3" opacity={0.25} />
          <GroundPlane />
        </>
      );
    case 'sim':
      return (
        <>
          <SimDrone telemetry={telemetry ?? null} />
          <SimGround />
          <SimWaypoints />
          <SimRouteLines />
          <CameraFollow telemetry={telemetry ?? null} />
          <Sparkles count={60} scale={20} size={0.8} speed={0.1} color="#00daf3" opacity={0.15} />
        </>
      );
  }
}

// ── Main Export ──

interface DroneSceneProps {
  scene?: SceneType;
  telemetry?: PX4Telemetry | null;
}

export function DroneScene({ scene = 'hero', telemetry }: DroneSceneProps) {
  const isSim = scene === 'sim';
  return (
    <Canvas
      camera={{ position: isSim ? [5, 4, 5] : [3.5, 2.5, 3.5], fov: isSim ? 50 : 42 }}
      style={{ width: '100%', height: '100%' }}
    >
      <color attach="background" args={['#06060f']} />
      <fog attach="fog" args={['#06060f', isSim ? 20 : 8, isSim ? 50 : 22]} />

      <ambientLight intensity={isSim ? 0.35 : 0.25} />
      <pointLight position={[5, 5, 5]} intensity={0.6} color="#ffffff" />
      <pointLight position={[-3, 2, -3]} intensity={0.4} color="#00daf3" />
      <pointLight position={[0, -2, 0]} intensity={0.2} color="#3b3bff" />

      <SceneContent scene={scene} telemetry={telemetry} />

      {!isSim && (
        <OrbitControls
          enableZoom={false}
          enablePan={false}
          autoRotate
          autoRotateSpeed={0.4}
          maxPolarAngle={Math.PI / 2.2}
          minPolarAngle={Math.PI / 4}
        />
      )}
      {isSim && (
        <OrbitControls
          enableZoom
          enablePan
          autoRotate={!telemetry?.is_flying}
          autoRotateSpeed={0.2}
          maxPolarAngle={Math.PI / 2.1}
          minPolarAngle={Math.PI / 8}
        />
      )}
    </Canvas>
  );
}
