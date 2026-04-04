import { useState, useEffect, useRef, useCallback } from 'react';

export interface PX4Telemetry {
  lat: number;
  lon: number;
  alt_m: number;
  relative_alt_m: number;
  battery_pct: number;
  flight_mode: string;
  is_armed: boolean;
  is_flying: boolean;
  heading_deg: number;
  speed_m_s: number;
  timestamp: number;
  source: 'px4' | 'mock' | 'unity';
  drone_id?: string;
  current_location?: string;
}

interface UsePX4TelemetryReturn {
  telemetry: PX4Telemetry | null;
  connected: boolean;
  sendCommand: (cmd: Record<string, unknown>) => void;
  source: 'px4' | 'mock' | 'unity' | null;
}

const WS_URL = 'ws://localhost:8765';
const MAX_RECONNECT_DELAY = 5000;

export function usePX4Telemetry(): UsePX4TelemetryReturn {
  const [telemetry, setTelemetry] = useState<PX4Telemetry | null>(null);
  const [connected, setConnected] = useState(false);
  const [source, setSource] = useState<'px4' | 'mock' | 'unity' | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectDelay = useRef(1000);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();
  const latestData = useRef<PX4Telemetry | null>(null);
  const rafId = useRef<number>();
  const mountedRef = useRef(true);

  // Throttle state updates to ~30 fps via requestAnimationFrame
  const scheduleUpdate = useCallback(() => {
    if (rafId.current) return;
    rafId.current = requestAnimationFrame(() => {
      rafId.current = undefined;
      if (latestData.current && mountedRef.current) {
        setTelemetry(latestData.current);
      }
    });
  }, []);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;

    try {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        reconnectDelay.current = 1000; // reset backoff
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'telemetry') {
            latestData.current = data as PX4Telemetry;
            if (data.source && data.source !== source) setSource(data.source);
            scheduleUpdate();
          }
        } catch {
          // ignore malformed messages
        }
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        // Reconnect with exponential backoff
        if (mountedRef.current) {
          reconnectTimer.current = setTimeout(() => {
            reconnectDelay.current = Math.min(
              reconnectDelay.current * 1.5,
              MAX_RECONNECT_DELAY
            );
            connect();
          }, reconnectDelay.current);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {
      // WebSocket constructor can throw if URL is invalid
      if (mountedRef.current) {
        reconnectTimer.current = setTimeout(connect, reconnectDelay.current);
      }
    }
  }, [scheduleUpdate]);

  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (rafId.current) cancelAnimationFrame(rafId.current);
      if (wsRef.current) {
        wsRef.current.onclose = null; // prevent reconnect on unmount
        wsRef.current.close();
      }
    };
  }, [connect]);

  const sendCommand = useCallback((cmd: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(cmd));
    }
  }, []);

  return { telemetry, connected, sendCommand, source };
}
