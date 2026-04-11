// useLidarStream — React hook exposing the latest LiDAR frame plus derived
// metrics. Source is swappable at mount time via VITE_LIDAR_SOURCE:
//   'synthetic' (default) — subscribes directly to the in-browser lidarBus
//   'vm'                  — opens a WebSocket to the backend /ws/lidar proxy,
//                           validates + republishes frames through the same bus
//                           so every consumer (HUD radar, 3D LidarField, etc.)
//                           reads from one source of truth.
//   'off'                 — no-op, returns a stable empty state.
//
// State updates are throttled to 5 Hz so HUD widgets don't re-render at the
// 10 Hz bus cadence. Connection health is derived from the most recent frame
// arrival (fresh <1.5s = connected).

import { useEffect, useRef, useState } from 'react';
import {
  publishLidarFrame,
  subscribeLidarFrame,
  type LidarFrame,
  type LidarObstacle,
  type LidarPoint,
} from './lidarBus';
import { backendWsUrl } from '../../../lib/backendUrls';

export type LidarSource = 'synthetic' | 'vm' | 'off';

export interface LidarStreamState {
  frame: LidarFrame | null;
  obstacles: readonly LidarObstacle[];
  obstacleCount: number;
  pointCount: number;
  source: LidarSource;
  connected: boolean;
  lastUpdateMs: number | null;
}

const EMPTY_OBSTACLES: readonly LidarObstacle[] = Object.freeze([]);
const EMPTY_POINTS: readonly LidarPoint[] = Object.freeze([]);
const THROTTLE_MS = 200; // 5 Hz
const FRESHNESS_MS = 1500;

function resolveSource(): LidarSource {
  const raw = (import.meta.env.VITE_LIDAR_SOURCE as string | undefined)?.toLowerCase();
  if (raw === 'vm') return 'vm';
  if (raw === 'off') return 'off';
  return 'synthetic';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isLidarFrame(value: unknown): value is LidarFrame {
  if (!isRecord(value)) return false;
  if (typeof value.timestamp !== 'number') return false;
  if (!Array.isArray(value.points)) return false;
  if (!Array.isArray(value.obstacles)) return false;
  if (!isRecord(value.dronePosition)) return false;
  const pos = value.dronePosition;
  if (typeof pos.x !== 'number' || typeof pos.y !== 'number' || typeof pos.z !== 'number') {
    return false;
  }
  if (typeof value.droneHeading !== 'number') return false;
  return true;
}

const EMPTY_STATE: LidarStreamState = {
  frame: null,
  obstacles: EMPTY_OBSTACLES,
  obstacleCount: 0,
  pointCount: 0,
  source: 'off',
  connected: false,
  lastUpdateMs: null,
};

export function useLidarStream(): LidarStreamState {
  const sourceRef = useRef<LidarSource>(resolveSource());
  const [state, setState] = useState<LidarStreamState>(() => {
    if (sourceRef.current === 'off') return EMPTY_STATE;
    return {
      frame: null,
      obstacles: EMPTY_OBSTACLES,
      obstacleCount: 0,
      pointCount: 0,
      source: sourceRef.current,
      connected: false,
      lastUpdateMs: null,
    };
  });

  const lastEmitRef = useRef<number>(0);
  const pendingFrameRef = useRef<LidarFrame | null>(null);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const source = sourceRef.current;
    if (source === 'off') return;

    let cancelled = false;

    const commitFrame = (frame: LidarFrame) => {
      if (cancelled) return;
      setState({
        frame,
        obstacles: frame.obstacles,
        obstacleCount: frame.obstacles.length,
        pointCount: frame.points.length,
        source,
        connected: true,
        lastUpdateMs: frame.timestamp,
      });
    };

    const scheduleFlush = () => {
      if (flushTimerRef.current) return;
      const now = performance.now();
      const sinceLast = now - lastEmitRef.current;
      const wait = Math.max(0, THROTTLE_MS - sinceLast);
      flushTimerRef.current = setTimeout(() => {
        flushTimerRef.current = null;
        const pending = pendingFrameRef.current;
        pendingFrameRef.current = null;
        if (pending) {
          lastEmitRef.current = performance.now();
          commitFrame(pending);
        }
      }, wait);
    };

    const handleFrame = (frame: LidarFrame) => {
      pendingFrameRef.current = frame;
      const now = performance.now();
      if (now - lastEmitRef.current >= THROTTLE_MS) {
        // fast path: emit immediately
        pendingFrameRef.current = null;
        lastEmitRef.current = now;
        commitFrame(frame);
      } else {
        scheduleFlush();
      }
    };

    // Freshness watchdog — if no frame arrives for 1.5s, flip connected=false.
    const freshnessInterval = setInterval(() => {
      if (cancelled) return;
      setState((prev) => {
        if (!prev.frame || !prev.connected) return prev;
        const age = Date.now() - prev.frame.timestamp;
        if (age <= FRESHNESS_MS) return prev;
        return { ...prev, connected: false };
      });
    }, 500);

    let unsubscribeBus: (() => void) | null = null;
    let ws: WebSocket | null = null;

    if (source === 'synthetic') {
      unsubscribeBus = subscribeLidarFrame(handleFrame);
    } else {
      // 'vm' — also subscribe to the bus (so republished frames drive the hook),
      // then open the WebSocket and republish validated inbound frames.
      unsubscribeBus = subscribeLidarFrame(handleFrame);

      const path =
        (import.meta.env.VITE_LIDAR_WS_URL as string | undefined) || '/ws/lidar';
      let wsUrl: string;
      try {
        wsUrl = backendWsUrl(path);
      } catch {
        wsUrl = 'ws://localhost:8000/ws/lidar';
      }

      try {
        ws = new WebSocket(wsUrl);
        ws.onmessage = (event: MessageEvent<unknown>) => {
          const data = event.data;
          if (typeof data !== 'string') return;
          try {
            const parsed: unknown = JSON.parse(data);
            if (!isLidarFrame(parsed)) return;
            publishLidarFrame(parsed);
          } catch {
            // malformed — drop silently
          }
        };
        ws.onclose = () => {
          if (cancelled) return;
          setState((prev) => ({ ...prev, connected: false }));
        };
        ws.onerror = () => {
          if (cancelled) return;
          setState((prev) => ({ ...prev, connected: false }));
        };
      } catch {
        // constructor threw — stay in disconnected state, hook still works if
        // another producer publishes to the bus.
      }
    }

    return () => {
      cancelled = true;
      clearInterval(freshnessInterval);
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      pendingFrameRef.current = null;
      if (unsubscribeBus) unsubscribeBus();
      if (ws) {
        ws.onmessage = null;
        ws.onclose = null;
        ws.onerror = null;
        try {
          ws.close();
        } catch {
          // ignore
        }
      }
    };
  }, []);

  return state;
}
