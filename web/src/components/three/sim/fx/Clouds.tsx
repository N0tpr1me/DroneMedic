// Clouds — volumetric cloud layers at multiple altitudes using drei's Cloud component.

import { Cloud, Clouds as DreiClouds } from '@react-three/drei';
import { MeshLambertMaterial } from 'three';

export function Clouds() {
  return (
    <DreiClouds material={MeshLambertMaterial}>
      {/* Low layer — wide, sparse */}
      <Cloud
        seed={12}
        segments={20}
        bounds={[800, 60, 800]}
        volume={180}
        opacity={0.14}
        speed={0.1}
        position={[0, 750, 0]}
        color="#ffffff"
      />
      {/* Mid layer — denser, slight blue tint */}
      <Cloud
        seed={37}
        segments={30}
        bounds={[1000, 80, 1000]}
        volume={220}
        opacity={0.16}
        speed={0.08}
        position={[200, 850, -300]}
        color="#e8eeff"
      />
      {/* High layer — wispy, subtle */}
      <Cloud
        seed={54}
        segments={25}
        bounds={[600, 50, 600]}
        volume={150}
        opacity={0.12}
        speed={0.15}
        position={[-400, 950, 200]}
        color="#ffffff"
      />
    </DreiClouds>
  );
}
