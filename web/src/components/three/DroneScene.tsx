import { Canvas, useFrame } from '@react-three/fiber';
import { Float, Sparkles, OrbitControls, Line } from '@react-three/drei';
import { useRef, useMemo } from 'react';
import * as THREE from 'three';

// ── Drone Model ──

function DroneModel({ scale = 1 }: { scale?: number }) {
  const bodyRef = useRef<THREE.Group>(null);

  useFrame((state) => {
    if (bodyRef.current) {
      bodyRef.current.rotation.y = state.clock.elapsedTime * 0.3;
    }
  });

  return (
    <Float speed={2} rotationIntensity={0.2} floatIntensity={0.8}>
      <group ref={bodyRef} scale={scale}>
        <mesh><boxGeometry args={[1.2, 0.25, 1.2]} /><meshStandardMaterial color="#0d1020" metalness={0.8} roughness={0.2} /></mesh>
        <mesh position={[0, 0.2, 0]}><sphereGeometry args={[0.3, 16, 16, 0, Math.PI * 2, 0, Math.PI / 2]} /><meshStandardMaterial color="#00daf3" metalness={0.6} roughness={0.3} transparent opacity={0.6} /></mesh>
        {[[0.8, 0, 0.8], [-0.8, 0, 0.8], [0.8, 0, -0.8], [-0.8, 0, -0.8]].map((pos, i) => (
          <group key={i}>
            <mesh position={[pos[0] * 0.5, 0.05, pos[2] * 0.5]} rotation={[0, Math.atan2(pos[0], pos[2]), 0]}><boxGeometry args={[0.12, 0.08, 1]} /><meshStandardMaterial color="#1a1a30" metalness={0.7} roughness={0.3} /></mesh>
            <mesh position={[pos[0], 0.1, pos[2]]}><cylinderGeometry args={[0.12, 0.12, 0.15, 8]} /><meshStandardMaterial color="#222" metalness={0.9} roughness={0.1} /></mesh>
            <mesh position={[pos[0], 0.2, pos[2]]}><cylinderGeometry args={[0.35, 0.35, 0.02, 16]} /><meshStandardMaterial color="#00daf3" transparent opacity={0.12} /></mesh>
          </group>
        ))}
        <mesh position={[0, -0.15, 0]}><boxGeometry args={[0.8, 0.02, 0.8]} /><meshStandardMaterial color="#00daf3" emissive="#00daf3" emissiveIntensity={0.4} /></mesh>
        <mesh position={[0, -0.12, 0]}><boxGeometry args={[0.3, 0.01, 0.08]} /><meshStandardMaterial color="#ff3333" emissive="#ff3333" emissiveIntensity={0.3} /></mesh>
        <mesh position={[0, -0.12, 0]}><boxGeometry args={[0.08, 0.01, 0.3]} /><meshStandardMaterial color="#ff3333" emissive="#ff3333" emissiveIntensity={0.3} /></mesh>
      </group>
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

// ── Scene Configurations ──

type SceneType = 'hero' | 'routes' | 'weather' | 'ai' | 'fleet';

function SceneContent({ scene }: { scene: SceneType }) {
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
  }
}

// ── Main Export ──

interface DroneSceneProps {
  scene?: SceneType;
}

export function DroneScene({ scene = 'hero' }: DroneSceneProps) {
  return (
    <Canvas
      camera={{ position: [3.5, 2.5, 3.5], fov: 42 }}
      style={{ position: 'absolute', inset: 0 }}
    >
      <color attach="background" args={['#06060f']} />
      <fog attach="fog" args={['#06060f', 8, 22]} />

      <ambientLight intensity={0.25} />
      <pointLight position={[5, 5, 5]} intensity={0.6} color="#ffffff" />
      <pointLight position={[-3, 2, -3]} intensity={0.4} color="#00daf3" />
      <pointLight position={[0, -2, 0]} intensity={0.2} color="#3b3bff" />

      <SceneContent scene={scene} />

      <OrbitControls
        enableZoom={false}
        enablePan={false}
        autoRotate
        autoRotateSpeed={0.4}
        maxPolarAngle={Math.PI / 2.2}
        minPolarAngle={Math.PI / 4}
      />
    </Canvas>
  );
}
