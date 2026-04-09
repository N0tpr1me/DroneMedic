// Clouds — a single drifting translucent plane high above the scene. Cheap
// visual placeholder; not physically accurate.

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

export function Clouds() {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((_state, delta) => {
    if (!ref.current) return;
    const mat = ref.current.material as THREE.MeshBasicMaterial;
    if (mat && mat.map) {
      mat.map.offset.x += delta * 0.003;
      mat.map.offset.y += delta * 0.001;
    }
  });
  return (
    <mesh ref={ref} position={[0, 900, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[12_000, 12_000, 1, 1]} />
      <meshBasicMaterial
        color="#ffffff"
        transparent
        opacity={0.08}
        depthWrite={false}
      />
    </mesh>
  );
}
