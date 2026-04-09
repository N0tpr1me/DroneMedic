import { useState, useEffect, useRef, useCallback } from 'react';
import { backendWsUrl } from '../lib/backendUrls';

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
  source: 'px4' | 'mock' | 'unity' | 'physics' | null;
}

const TELEMETRY_MODE = import.meta.env.VITE_TELEMETRY_MODE || 'physics';
// `px4_vm` resolves via backendWsUrl(): dev uses the Vite proxy, Netlify prod
// uses VITE_API_URL (→ http://144.202.12.168:8000 → ws://…/ws/px4).
const WS_URL =
  TELEMETRY_MODE === 'mock'
    ? 'ws://localhost:8765'
    : TELEMETRY_MODE === 'px4_vm'
      ? backendWsUrl('/ws/px4')
      : (import.meta.env.VITE_MAVLINK_WS_URL || '');
const MAX_RECONNECT_DELAY = 5000;

export function usePX4Telemetry(): UsePX4TelemetryReturn {
  const [telemetry, setTelemetry] = useState<PX4Telemetry | null>(null);
  const [connected, setConnected] = useState(false);
  const [source, setSource] = useState<'px4' | 'mock' | 'unity' | 'physics' | null>(
    TELEMETRY_MODE === 'physics' ? 'physics' : null
  );
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectDelay = useRef(1000);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestData = useRef<PX4Telemetry | null>(null);
  const rafId = useRef<number | null>(null);
  const mountedRef = useRef(true);

  // Throttle state updates to ~30 fps via requestAnimationFrame
  const scheduleUpdate = useCallback(() => {
    if (rafId.current) return;
    rafId.current = requestAnimationFrame(() => {
      rafId.current = null;
      if (latestData.current && mountedRef.current) {
        setTelemetry(latestData.current);
      }
    });
  }, []);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;

    if (TELEMETRY_MODE === 'physics') {
      // Headless mode — browser physics engine is the simulator
      // No WebSocket needed, all telemetry comes from useFleetPhysics via MissionContext
      return;
    }

    try {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        reconnectDelay.current = 1000; // reset backoff
      };

      ws.onmessage = (event) => {
        try {
          const raw = JSON.parse(event.data);
          if (raw.type !== 'telemetry') return;
          let mapped: PX4Telemetry | null = null;

          // Nested format (legacy MAVLink MCP bridge — `raw.data.position.*`)
          if (raw.data && typeof raw.data === 'object') {
            const d = raw.data;
            const vel = d.velocity || {};
            const speed = Math.sqrt(
              (vel.north_m_s || 0) ** 2 +
              (vel.east_m_s || 0) ** 2 +
              (vel.down_m_s || 0) ** 2,
            );
            mapped = {
              lat: d.position?.lat ?? 0,
              lon: d.position?.lon ?? 0,
              alt_m: d.position?.abs_alt_m ?? 0,
              relative_alt_m: d.position?.alt_m ?? 0,
              battery_pct: d.battery?.remaining ?? 0,
              flight_mode: d.flight_mode ?? 'UNKNOWN',
              is_armed: d.flight_mode !== 'HOLD' && d.flight_mode !== 'MANUAL',
              is_flying: (d.position?.alt_m ?? 0) > 0.5,
              heading_deg: d.heading_deg ?? 0,
              speed_m_s: speed,
              timestamp: raw.ts ?? Date.now() / 1000,
              source: 'px4',
              drone_id: d.drone_id,
            };
          } else if (typeof raw.lat === 'number' && typeof raw.lon === 'number') {
            // Flat format (telemetry_bridge.py → PX4TelemetrySource / MockTelemetrySource)
            mapped = {
              lat: raw.lat,
              lon: raw.lon,
              alt_m: raw.alt_m ?? 0,
              relative_alt_m: raw.relative_alt_m ?? 0,
              battery_pct: raw.battery_pct ?? 0,
              flight_mode: raw.flight_mode ?? 'UNKNOWN',
              is_armed: !!raw.is_armed,
              is_flying: !!raw.is_flying,
              heading_deg: raw.heading_deg ?? 0,
              speed_m_s: raw.speed_m_s ?? 0,
              timestamp: raw.timestamp ?? Date.now() / 1000,
              source: raw.source === 'mock' ? 'mock' : 'px4',
              drone_id: raw.drone_id,
              current_location: raw.current_location,
            };
          }

          if (mapped) {
            latestData.current = mapped;
            const nextSource = mapped.source;
            if (source !== nextSource) setSource(nextSource);
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
