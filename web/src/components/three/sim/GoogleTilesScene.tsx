// GoogleTilesScene — the 3D simulator canvas.
//
// Procedural London (sky, fog, ground, buildings, river, depot beacon,
// hexacopter, mission overlays, 5-preset camera rig, cinematic intro,
// clouds, postprocessing). No tiles dependency, no GLB dependency.
//
// Wrapped in a WebGL capability probe + error boundary so that a browser
// without GPU acceleration gets an explicit diagnostic instead of a black
// void. Auto-retries once on `webglcontextrestored`.

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { Environment } from '@react-three/drei';
import * as THREE from 'three';

import { VMDrone } from './VMDrone';
import { BreadcrumbTrail } from './BreadcrumbTrail';
import { MissionOverlays } from './MissionOverlays';
import { CameraRig } from './CameraRig';
import { ProceduralFallbackScene } from './ProceduralFallbackScene';
import { SimRenderTargetCapture } from './SimRenderTargetCapture';
import { SyntheticLidar } from './SyntheticLidar';
import { LidarField } from './LidarField';
import { SkyAndSun, getSunState } from './fx/SkyAndSun';
import { Clouds } from './fx/Clouds';
import { CinematicIntro } from './fx/CinematicIntro';
import { PostFxStack } from './fx/PostFxStack';
import { WeatherFx } from './fx/WeatherFx';
import { AmbientParticles } from './fx/AmbientParticles';
import { ProximityRing } from './fx/ProximityRing';
import {
  WebGLErrorBoundary,
  WebGLDiagnostic,
  detectWebGL,
} from './WebGLProbe';

export function GoogleTilesScene() {
  const support = useMemo(() => detectWebGL(), []);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [canvasKey, setCanvasKey] = useState(0);
  const autoRetryTimer = useRef<number | null>(null);

  // Sync directional light with the drei <Sky> sun so scene lighting matches
  // the sky color/direction. Computed once per mount — the time-of-day is
  // effectively fixed for the session.
  const sun = useMemo(() => getSunState(), []);
  const sunColorHex = useMemo(() => `#${sun.color.getHexString()}`, [sun.color]);

  // When a restored context fires, clear the error; when a fresh error fires,
  // schedule a single auto-retry.
  const retryNow = () => {
    if (autoRetryTimer.current != null) {
      window.clearTimeout(autoRetryTimer.current);
      autoRetryTimer.current = null;
    }
    setRenderError(null);
    setCanvasKey((n) => n + 1);
  };

  const scheduleAutoRetry = () => {
    if (autoRetryTimer.current != null) return;
    autoRetryTimer.current = window.setTimeout(() => {
      autoRetryTimer.current = null;
      retryNow();
    }, 3000);
  };

  useEffect(() => {
    return () => {
      if (autoRetryTimer.current != null) {
        window.clearTimeout(autoRetryTimer.current);
      }
    };
  }, []);

  if (!support.supported) {
    return <WebGLDiagnostic support={support} onRetry={retryNow} />;
  }

  if (renderError) {
    return (
      <WebGLDiagnostic
        support={support}
        errorMessage={renderError}
        onRetry={retryNow}
        autoRetrying
      />
    );
  }

  return (
    <WebGLErrorBoundary
      fallback={(err) => {
        scheduleAutoRetry();
        return (
          <WebGLDiagnostic
            support={support}
            errorMessage={err.message}
            onRetry={retryNow}
            autoRetrying
          />
        );
      }}
    >
      <Canvas
        key={canvasKey}
        shadows
        dpr={[1, 2]}
        camera={{ fov: 52, near: 0.5, far: 50_000, position: [80, 120, 140] }}
        gl={{
          antialias: true,
          alpha: false,
          depth: true,
          stencil: false,
          powerPreference: 'default',
          failIfMajorPerformanceCaveat: false,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.15,
          outputColorSpace: THREE.SRGBColorSpace,
        }}
        onCreated={({ gl }) => {
          const canvas = gl.domElement;
          canvas.addEventListener('webglcontextlost', (ev) => {
            ev.preventDefault();
            setRenderError('WebGL context lost — auto-retrying in 3s…');
            scheduleAutoRetry();
          });
          canvas.addEventListener('webglcontextrestored', () => {
            setRenderError(null);
            setCanvasKey((n) => n + 1);
          });
        }}
        onError={(err) => {
          setRenderError(err instanceof Error ? err.message : String(err));
          scheduleAutoRetry();
        }}
        frameloop="always"
        style={{ width: '100%', height: '100%', background: '#0c1524' }}
      >
        {/* Lighting — bright enough to read every surface at a glance.
            Directional light direction + color come from <SkyAndSun> so the
            scene's sun matches the sky's sun. */}
        <ambientLight intensity={0.85} />
        <directionalLight
          position={[
            sun.direction.x * 900,
            Math.max(sun.direction.y, 0.25) * 900,
            sun.direction.z * 900,
          ]}
          intensity={Math.max(sun.intensity, 2.2)}
          color={sunColorHex}
          castShadow
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
          shadow-camera-near={10}
          shadow-camera-far={2500}
          shadow-camera-left={-400}
          shadow-camera-right={400}
          shadow-camera-top={400}
          shadow-camera-bottom={-400}
          shadow-bias={-0.0005}
        />
        <hemisphereLight args={['#b9d5ff', '#1a2540', 0.7]} />

        {/* Atmosphere — fog far bumped to 18km so the expanded procedural
            city (which spans ~12km × 14km to cover the full mission envelope)
            remains visible as the drone approaches distant waypoints. */}
        <SkyAndSun />
        <Clouds />
        <fog attach="fog" args={['#8fb2d4', 2500, 18000]} />

        {/* HDRI environment map — gives all metallic/glass surfaces free
            reflections and makes the water come alive. */}
        <Suspense fallback={null}>
          <Environment preset="city" background={false} />
        </Suspense>

        {/* World */}
        <Suspense fallback={null}>
          <ProceduralFallbackScene />
        </Suspense>
        <VMDrone />
        <BreadcrumbTrail />
        <MissionOverlays />

        {/* Weather, proximity, and ambient particles */}
        <WeatherFx />
        <AmbientParticles />
        <ProximityRing />

        {/* Browser-side synthetic LiDAR — raycasts the procedural scene at
            10 Hz and publishes frames to the shared lidar bus. LidarField
            renders the resulting point cloud; HUD widgets subscribe via
            useLidarStream. */}
        <SyntheticLidar />
        <LidarField />

        {/* Camera + Intro */}
        <CameraRig />
        <CinematicIntro />

        {/* Browser-side POV capture for the vision agent */}
        <SimRenderTargetCapture />

        {/* Postprocessing (quality-tier gated internally) */}
        <PostFxStack />
      </Canvas>
    </WebGLErrorBoundary>
  );
}
