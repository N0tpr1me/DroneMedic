// GoogleTilesScene — the photorealistic London canvas used by the 3D
// simulator panel.
//
//   Data flow:
//     PX4 SITL + Gazebo Harmonic (VM)
//       → telemetry_bridge.py (ws :8765)
//       → FastAPI /ws/px4 proxy
//       → Vite dev proxy → browser → usePX4Telemetry → SimCockpitContext
//
//   Visual stack:
//     Canvas (logarithmicDepthBuffer)
//      └── Suspense
//           ├── TilesRenderer (Google Photorealistic 3D Tiles)
//           │    └── EastNorthUpFrame @ London depot
//           │         ├── VMDrone (telemetry ref-driven)
//           │         ├── BreadcrumbTrail
//           │         ├── MissionOverlays (clinics, routes, no-fly volumes)
//           │         └── WindField / DeliveryFx
//           ├── SkyAndSun, Clouds
//           ├── CameraRig (5 presets)
//           ├── CinematicIntro
//           └── PostFxStack
//
// Falls back to ProceduralFallbackScene when tiles are disabled or errored.

import { Suspense, useEffect, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import {
  TilesRenderer,
  TilesPlugin,
  TilesAttributionOverlay,
  EastNorthUpFrame,
} from '3d-tiles-renderer/r3f';
import { GoogleCloudAuthPlugin } from '3d-tiles-renderer/plugins';
import * as THREE from 'three';

import { VMDrone } from './VMDrone';
import { BreadcrumbTrail } from './BreadcrumbTrail';
import { MissionOverlays } from './MissionOverlays';
import { CameraRig } from './CameraRig';
import { ProceduralFallbackScene } from './ProceduralFallbackScene';
import { SkyAndSun } from './fx/SkyAndSun';
import { Clouds } from './fx/Clouds';
import { CinematicIntro } from './fx/CinematicIntro';
import { PostFxStack } from './fx/PostFxStack';
import { useSimCockpit } from './SimCockpitContext';
import { DEPOT_LAT_RAD, DEPOT_LON_RAD } from './enuFrame';

const TILES_API_KEY =
  import.meta.env.VITE_GOOGLE_TILES_API_KEY ||
  import.meta.env.VITE_GOOGLE_MAPS_API_KEY ||
  '';

const TILES_ENABLED =
  (import.meta.env.VITE_ENABLE_3D_TILES ?? 'true') !== 'false' && !!TILES_API_KEY;

function TilesLayer() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tilesProps: any = { errorTarget: 14 };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pluginProps: any = {
    plugin: GoogleCloudAuthPlugin,
    args: { apiToken: TILES_API_KEY, autoRefreshToken: true },
  };
  return (
    <TilesRenderer {...tilesProps}>
      <TilesPlugin {...pluginProps} />
      <TilesAttributionOverlay />
      <EastNorthUpFrame lat={DEPOT_LAT_RAD} lon={DEPOT_LON_RAD} height={0}>
        <SceneContents />
      </EastNorthUpFrame>
    </TilesRenderer>
  );
}

function SceneContents() {
  return (
    <group>
      <VMDrone />
      <BreadcrumbTrail />
      <MissionOverlays />
    </group>
  );
}

function FallbackInsideFrame() {
  return (
    <EastNorthUpFrame lat={DEPOT_LAT_RAD} lon={DEPOT_LON_RAD} height={0}>
      <ProceduralFallbackScene />
      <VMDrone />
      <BreadcrumbTrail />
    </EastNorthUpFrame>
  );
}

interface GoogleTilesSceneProps {
  /** Called whenever the live tile availability flips (for HUD badging). */
  onTilesAvailabilityChange?: (available: boolean) => void;
}

export function GoogleTilesScene({ onTilesAvailabilityChange }: GoogleTilesSceneProps) {
  const { setTilesAvailable, tilesAvailable } = useSimCockpit();
  const [failureReason] = useState<string | null>(null);

  useEffect(() => {
    if (!TILES_ENABLED) {
      setTilesAvailable(false);
      onTilesAvailabilityChange?.(false);
    } else {
      setTilesAvailable(true);
      onTilesAvailabilityChange?.(true);
    }
  }, [setTilesAvailable, onTilesAvailabilityChange]);

  const useTiles = TILES_ENABLED && tilesAvailable && !failureReason;

  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ fov: 55, near: 1, far: 1.6e7, position: [60, 120, 60] }}
      gl={{
        logarithmicDepthBuffer: true,
        antialias: true,
        toneMapping: THREE.ACESFilmicToneMapping,
        outputColorSpace: THREE.SRGBColorSpace,
      }}
      frameloop="always"
      style={{ width: '100%', height: '100%', background: '#06070d' }}
    >
      {/* Base lighting (applies to both tile + procedural branches). */}
      <ambientLight intensity={0.55} />
      <directionalLight
        position={[400, 800, 200]}
        intensity={1.6}
        color="#fff1d8"
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
      />
      <hemisphereLight args={['#b9d5ff', '#151824', 0.35]} />

      <SkyAndSun />
      <Clouds />
      <fog attach="fog" args={['#78a2c4', 800, 6500]} />

      <Suspense fallback={null}>
        {useTiles ? <TilesLayer /> : <FallbackInsideFrame />}
      </Suspense>

      <CameraRig />
      <CinematicIntro />
      <PostFxStack />
    </Canvas>
  );
}
