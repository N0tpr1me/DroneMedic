// SimRenderTargetCapture — renders the drone POV into an off-screen
// WebGLRenderTarget at 3 Hz, reads back pixels, encodes as a JPEG, and
// publishes the latest captured DataURL on a module-level subscription bus so
// POVFeed can show the frame as its fallback picture-in-picture.
//
// Separately, at 0.4 Hz it POSTs the latest captured frame to
// /api/vision/evaluate so the reasoning ticker gets structured scene
// critiques from the backend vision analyzer even when there's no Gazebo
// camera feed on /ws/pov. The two cadences are kept independent so visual
// liveness of the POV feed is decoupled from vision LLM rate-limiting.

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useSimCockpit } from './SimCockpitContext';
import { useVisionStream } from './useVisionStream';
import { enuFromLatLon } from './enuFrame';

const CAPTURE_WIDTH = 480;
const CAPTURE_HEIGHT = 270;
// Visual POV capture cadence: 3 fps keeps the PiP feeling live.
const CAPTURE_INTERVAL_S = 0.33;
// Vision LLM evaluation cadence: unchanged from the original 2.5 s.
const VISION_EVAL_INTERVAL_S = 2.5;
// Rolling FPS window in seconds — reported as frames / window.
const FPS_WINDOW_S = 2;

// --- Module-level POV frame bus (pub/sub) -------------------------

type PovListener = (dataUrl: string) => void;
const povListeners = new Set<PovListener>();
let lastPovDataUrl: string | null = null;

function publishPovFrame(dataUrl: string): void {
  lastPovDataUrl = dataUrl;
  povListeners.forEach((fn) => fn(dataUrl));
}

export function subscribeBrowserPov(listener: PovListener): () => void {
  povListeners.add(listener);
  if (lastPovDataUrl) listener(lastPovDataUrl);
  return () => {
    povListeners.delete(listener);
  };
}

// --- Module-level FPS bus (pub/sub) --------------------------------

type FpsListener = (fps: number) => void;
const fpsListeners = new Set<FpsListener>();
let lastFps = 0;

function publishFps(fps: number): void {
  lastFps = fps;
  fpsListeners.forEach((fn) => fn(fps));
}

export function subscribeBrowserPovFps(listener: FpsListener): () => void {
  fpsListeners.add(listener);
  listener(lastFps);
  return () => {
    fpsListeners.delete(listener);
  };
}

// --- Helpers -------------------------------------------------------

/**
 * Derive the drone's horizontal forward unit vector from its quaternion.
 * Projects the rotated -Z axis onto the horizontal plane and normalizes it.
 * Uses velocity-free math so a hovering drone still reports a valid heading.
 */
function horizontalForwardFromQuaternion(
  quaternion: THREE.Quaternion,
): THREE.Vector3 {
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion);
  forward.y = 0;
  if (forward.lengthSq() < 1e-6) {
    // Degenerate case: the drone is pointing straight up or down. Fall back
    // to world -Z so we never hand out a zero vector to lookAt().
    return new THREE.Vector3(0, 0, -1);
  }
  return forward.normalize();
}

/**
 * Fallback forward vector derived from heading_deg telemetry when no drone
 * object is available in the scene graph. Matches the ENU convention used
 * elsewhere in the sim (north = -Z, east = +X).
 */
function horizontalForwardFromHeadingDeg(headingDeg: number): THREE.Vector3 {
  const rad = (headingDeg * Math.PI) / 180;
  return new THREE.Vector3(Math.sin(rad), 0, -Math.cos(rad)).normalize();
}

// --- Component ----------------------------------------------------

export function SimRenderTargetCapture(): null {
  const enabled = useMemo<boolean>(
    () => (import.meta.env.VITE_VISION_ENABLED ?? 'true') !== 'false',
    [],
  );
  const { gl, scene } = useThree();
  const { telemetryRef, missionPhase } = useSimCockpit();
  const vision = useVisionStream();

  const rt = useMemo<THREE.WebGLRenderTarget>(
    () =>
      new THREE.WebGLRenderTarget(CAPTURE_WIDTH, CAPTURE_HEIGHT, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
      }),
    [],
  );

  const povCamera = useMemo<THREE.PerspectiveCamera>(() => {
    return new THREE.PerspectiveCamera(
      78,
      CAPTURE_WIDTH / CAPTURE_HEIGHT,
      1,
      20_000,
    );
  }, []);

  const readbackCanvas = useMemo<HTMLCanvasElement>(() => {
    const c = document.createElement('canvas');
    c.width = CAPTURE_WIDTH;
    c.height = CAPTURE_HEIGHT;
    return c;
  }, []);

  const captureAccumulator = useRef<number>(0);
  const visionAccumulator = useRef<number>(0);
  const inFlight = useRef<boolean>(false);
  const frameTimestamps = useRef<number[]>([]);

  useEffect(() => {
    return () => {
      rt.dispose();
    };
  }, [rt]);

  useFrame((_state, delta) => {
    if (!enabled) return;

    // --- Position the POV camera -----------------------------------
    // Prefer the live drone object's quaternion so we respect in-scene
    // rotation (including physics-driven yaw). Fall back to telemetry
    // heading_deg if we can't find a drone node yet.
    const droneObject = scene.getObjectByName('vm-drone');
    const t = telemetryRef.current;

    if (t && Number.isFinite(t.lat) && Number.isFinite(t.lon)) {
      const { east, north, up } = enuFromLatLon(
        t.lat,
        t.lon,
        Math.max(t.relative_alt_m ?? 0, 5),
      );
      const dronePosition = new THREE.Vector3(
        east,
        Math.max(up, 5),
        -north,
      );

      const forward = droneObject
        ? horizontalForwardFromQuaternion(droneObject.quaternion)
        : horizontalForwardFromHeadingDeg(t.heading_deg ?? 0);

      // Camera: 4 m forward of the nose, 1.2 m above drone center — clear
      // of the rotor disc so the feed no longer frames the drone's arms.
      const cameraPosition = dronePosition
        .clone()
        .addScaledVector(forward, 4)
        .add(new THREE.Vector3(0, 1.2, 0));
      povCamera.position.copy(cameraPosition);

      // Look 50 m ahead at the same height.
      const lookTarget = dronePosition
        .clone()
        .addScaledVector(forward, 50)
        .add(new THREE.Vector3(0, 1.2, 0));
      povCamera.lookAt(lookTarget);
    } else {
      povCamera.position.set(8, 30, 8);
      povCamera.lookAt(0, 20, 0);
    }

    // --- Cadence bookkeeping ---------------------------------------
    captureAccumulator.current += delta;
    visionAccumulator.current += delta;
    if (captureAccumulator.current < CAPTURE_INTERVAL_S) return;
    captureAccumulator.current = 0;

    // --- Render the POV to the off-screen target -------------------
    const previousTarget = gl.getRenderTarget();
    gl.setRenderTarget(rt);
    try {
      gl.render(scene, povCamera);
    } finally {
      gl.setRenderTarget(previousTarget);
    }

    // --- Read pixels back to CPU + flip vertically -----------------
    const pixels = new Uint8Array(CAPTURE_WIDTH * CAPTURE_HEIGHT * 4);
    gl.readRenderTargetPixels(rt, 0, 0, CAPTURE_WIDTH, CAPTURE_HEIGHT, pixels);

    const ctx = readbackCanvas.getContext('2d');
    if (!ctx) return;
    const imageData = ctx.createImageData(CAPTURE_WIDTH, CAPTURE_HEIGHT);
    // WebGL framebuffer is upside-down relative to canvas; flip on copy.
    for (let y = 0; y < CAPTURE_HEIGHT; y++) {
      const srcRow = (CAPTURE_HEIGHT - 1 - y) * CAPTURE_WIDTH * 4;
      const dstRow = y * CAPTURE_WIDTH * 4;
      for (let x = 0; x < CAPTURE_WIDTH * 4; x++) {
        imageData.data[dstRow + x] = pixels[srcRow + x] ?? 0;
      }
    }
    ctx.putImageData(imageData, 0, 0);

    // --- Publish to the POV feed widget ----------------------------
    const dataUrl = readbackCanvas.toDataURL('image/jpeg', 0.72);
    publishPovFrame(dataUrl);

    // --- Rolling FPS window ----------------------------------------
    const nowSec = performance.now() / 1000;
    const cutoff = nowSec - FPS_WINDOW_S;
    const nextTimestamps = [
      ...frameTimestamps.current.filter((ts) => ts >= cutoff),
      nowSec,
    ];
    frameTimestamps.current = nextTimestamps;
    const fps = Math.round((nextTimestamps.length / FPS_WINDOW_S) * 10) / 10;
    publishFps(fps);

    // --- Vision LLM call (independent, slower cadence) -------------
    if (visionAccumulator.current < VISION_EVAL_INTERVAL_S) return;
    visionAccumulator.current = 0;
    if (inFlight.current) return;

    inFlight.current = true;
    const base64 = dataUrl.split(',')[1] ?? '';
    if (base64) {
      vision
        .evaluate(base64, missionPhase)
        .finally(() => {
          inFlight.current = false;
        });
    } else {
      inFlight.current = false;
    }
  });

  return null;
}
