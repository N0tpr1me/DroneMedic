// ProceduralFallbackScene — visual filler used when Google Photorealistic
// 3D Tiles are disabled or unavailable. Renders a dark grid, mission
// waypoints as beacon columns, and a soft ground plane. Designed to live
// inside the same ENU frame as the tiles scene so drone coordinates stay
// consistent.

import { useMemo } from 'react';
import * as THREE from 'three';
import { MissionOverlays } from './MissionOverlays';

export function ProceduralFallbackScene() {
  const grid = useMemo(() => {
    const g = new THREE.GridHelper(2000, 40, '#2a3a55', '#0f1622');
    g.position.y = 0.1;
    return g;
  }, []);

  return (
    <group>
      <primitive object={grid} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[4000, 4000]} />
        <meshStandardMaterial
          color="#080c14"
          metalness={0.1}
          roughness={0.9}
          emissive="#020409"
          emissiveIntensity={0.3}
        />
      </mesh>
      <MissionOverlays />
    </group>
  );
}
