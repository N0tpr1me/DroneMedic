// useVisionStream — subscribes to the backend /ws/vision proxy and buffers
// structured VisionEvent frames. Also exposes a manual `evaluate()` helper
// that POSTs a base64 JPEG to /api/vision/evaluate for the BrowserVisionFallback.

import { useCallback, useEffect, useRef, useState } from 'react';
import { backendHttpUrl, backendWsUrl } from '../../../lib/backendUrls';

export interface VisionObstacle {
  label: string;
  confidence?: number;
}

export interface VisionEvent {
  scene_description: string;
  obstacles: VisionObstacle[];
  path_clear: boolean;
  verdict: 'safe' | 'caution' | 'abort';
  reason: string;
  confidence: number;
  timestamp: number;
  source?: string;
  action?: string;
}

export interface VisionStreamState {
  connected: boolean;
  events: VisionEvent[];
  latest: VisionEvent | null;
  error: string | null;
  evaluate: (imageBase64: string, action?: string) => Promise<VisionEvent | null>;
}

const MAX_EVENTS = 40;

export function useVisionStream(): VisionStreamState {
  const [events, setEvents] = useState<VisionEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (import.meta.env.VITE_VISION_ENABLED === 'false') return;
    let cancelled = false;

    const connect = () => {
      if (cancelled) return;
      const path =
        (import.meta.env.VITE_VISION_EVENTS_URL as string | undefined) ||
        '/ws/vision';
      const url = backendWsUrl(path);
      try {
        const ws = new WebSocket(url);
        wsRef.current = ws;
        ws.onopen = () => setConnected(true);
        ws.onmessage = (msg) => {
          try {
            const data = JSON.parse(msg.data);
            if (!data || typeof data !== 'object') return;
            if ('connected' in data && 'type' in data) {
              setConnected(!!data.connected);
              if (data.error) setError(String(data.error));
              return;
            }
            const ev: VisionEvent = {
              scene_description: String(data.scene_description ?? ''),
              obstacles: Array.isArray(data.obstacles) ? data.obstacles : [],
              path_clear: data.path_clear !== false,
              verdict:
                data.verdict === 'abort' || data.verdict === 'caution'
                  ? data.verdict
                  : 'safe',
              reason: String(data.reason ?? ''),
              confidence: Number(data.confidence ?? 0),
              timestamp: Number(data.timestamp ?? Date.now() / 1000),
              source: data.source,
              action: data.action ?? data.intended_action,
            };
            setEvents((prev) => [...prev, ev].slice(-MAX_EVENTS));
          } catch {
            /* ignore */
          }
        };
        ws.onerror = () => {
          setError('vision stream error');
        };
        ws.onclose = () => {
          setConnected(false);
          wsRef.current = null;
          if (!cancelled) {
            reconnectTimer.current = setTimeout(connect, 3000);
          }
        };
      } catch {
        reconnectTimer.current = setTimeout(connect, 3000);
      }
    };

    connect();
    return () => {
      cancelled = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, []);

  const evaluate = useCallback(
    async (imageBase64: string, action = 'cruise'): Promise<VisionEvent | null> => {
      try {
        const res = await fetch(backendHttpUrl('/api/vision/evaluate'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            image_base64: imageBase64,
            intended_action: action,
            context: {},
          }),
        });
        if (!res.ok) return null;
        const data = await res.json();
        const ev: VisionEvent = {
          scene_description: data.scene_description ?? '',
          obstacles: data.obstacles ?? [],
          path_clear: data.path_clear ?? true,
          verdict: data.verdict ?? 'safe',
          reason: data.reason ?? '',
          confidence: Number(data.confidence ?? 0),
          timestamp: Number(data.timestamp ?? Date.now() / 1000),
          source: data.source,
          action,
        };
        setEvents((prev) => [...prev, ev].slice(-MAX_EVENTS));
        return ev;
      } catch {
        return null;
      }
    },
    [],
  );

  return {
    connected,
    events,
    latest: events[events.length - 1] ?? null,
    error,
    evaluate,
  };
}
