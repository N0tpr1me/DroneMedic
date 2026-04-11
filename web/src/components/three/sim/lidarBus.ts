// lidarBus — shared types + module-level pub/sub for browser-side LiDAR.
//
// Both the synthetic raycast producer (`<SyntheticLidar />`) and the
// future VM WebSocket producer publish `LidarFrame` records through this
// bus. Consumers (`<LidarField />`, `useLidarStream`, `<LidarRadarDisplay />`)
// subscribe and read the latest frame. The bus has zero React dependency —
// it's a pure module singleton, identical in shape to `subscribeBrowserPov`.

/** A single LiDAR return, expressed in drone-local coordinates (meters). */
export interface LidarPoint {
  /** Local X (right of drone, meters). */
  x: number;
  /** Local Y (up, meters). */
  y: number;
  /** Local Z (forward along heading, meters). */
  z: number;
  /** Distance from the drone in meters. */
  distance: number;
  /** 0..1 intensity — producers use this for age/confidence fade. */
  intensity: number;
}

/** A clustered obstacle derived from raw points. */
export interface LidarObstacle {
  /** Stable id within a frame: `${bucket}-${timestamp}`. */
  id: string;
  /** Angular bearing from drone nose in radians: 0 = forward, +π/2 = right. */
  bearing: number;
  /** Closest range in the cluster, meters. */
  distance: number;
  /** Human-readable label for HUD + reasoning stream. */
  label: string;
  /** Severity derived from range: critical < 10m, warning < 20m, info otherwise. */
  severity: 'info' | 'warning' | 'critical';
  /** World-space unix timestamp (ms). */
  timestamp: number;
}

/** One LiDAR scan frame emitted by a producer. */
export interface LidarFrame {
  /** Monotonic emission time (ms epoch). */
  timestamp: number;
  /** Source label — useful for HUD distinction. */
  source: 'synthetic' | 'vm';
  /** Raw point cloud (drone-local, typically 256–512 points per frame). */
  points: readonly LidarPoint[];
  /** Clustered obstacles (usually 0–8 per frame). */
  obstacles: readonly LidarObstacle[];
  /** Drone world position at scan time (meters, three.js scene coords). */
  dronePosition: { x: number; y: number; z: number };
  /** Drone heading in radians, 0 = world -Z (north by three.js convention). */
  droneHeading: number;
}

type LidarListener = (frame: LidarFrame) => void;

const listeners = new Set<LidarListener>();
let lastFrame: LidarFrame | null = null;

/** Producer → bus. Replaces any previously cached frame. */
export function publishLidarFrame(frame: LidarFrame): void {
  lastFrame = frame;
  listeners.forEach((fn) => {
    try {
      fn(frame);
    } catch {
      // swallow individual listener errors so one bad consumer can't break the bus
    }
  });
}

/** Consumer → bus. Replays the last frame immediately if one exists. */
export function subscribeLidarFrame(listener: LidarListener): () => void {
  listeners.add(listener);
  if (lastFrame) {
    try {
      listener(lastFrame);
    } catch {
      // ignore
    }
  }
  return () => {
    listeners.delete(listener);
  };
}

/** Snapshot accessor for non-React consumers. */
export function getLastLidarFrame(): LidarFrame | null {
  return lastFrame;
}

/** Clear the bus — primarily for hot-reload / test teardown. */
export function resetLidarBus(): void {
  lastFrame = null;
  listeners.clear();
}
