/**
 * useLiveMission — WebSocket hook for real-time drone tracking.
 *
 * Connects to ws://backend/ws/live and updates drone state, flight log,
 * mission progress, and battery in real-time as events arrive from
 * the backend's EventService.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FlightLogEntry } from '../lib/api';

const WS_URL = (import.meta.env.VITE_API_URL || 'http://localhost:8000')
  .replace(/^http/, 'ws') + '/ws/live';

export interface LiveDroneState {
  droneId: string;
  status: string;
  battery: number;
  currentLocation: string;
  position: { x: number; y: number; z: number };
  speed: number;
  missionId: string | null;
}

export interface LiveMissionState {
  /** Are we connected to the WebSocket? */
  connected: boolean;
  /** Per-drone live state */
  drones: Record<string, LiveDroneState>;
  /** Running flight log built from events */
  flightLog: FlightLogEntry[];
  /** Current drone progress along route (0-1) */
  droneProgress: number;
  /** Mission progress percentage (0-100) */
  missionProgress: number;
  /** Current mission status from events */
  missionStatus: string;
  /** Latest event received */
  lastEvent: any | null;
}

export function useLiveMission(routeStops?: string[]) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [drones, setDrones] = useState<Record<string, LiveDroneState>>({});
  const [flightLog, setFlightLog] = useState<FlightLogEntry[]>([]);
  const [droneProgress, setDroneProgress] = useState(0);
  const [missionProgress, setMissionProgress] = useState(0);
  const [missionStatus, setMissionStatus] = useState('idle');
  const [lastEvent, setLastEvent] = useState<any>(null);

  // Track waypoints reached for progress calculation
  const waypointsReachedRef = useRef(0);
  const totalStopsRef = useRef(routeStops?.length ?? 1);

  useEffect(() => {
    totalStopsRef.current = routeStops?.length ?? 1;
    waypointsReachedRef.current = 0;
  }, [routeStops]);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      console.log('[LiveMission] WebSocket connected');
    };

    ws.onclose = () => {
      setConnected(false);
      console.log('[LiveMission] WebSocket disconnected');
    };

    ws.onerror = () => {
      setConnected(false);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        setLastEvent(data);
        handleEvent(data);
      } catch {
        // ignore malformed messages
      }
    };
  }, []);

  const disconnect = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
  }, []);

  const handleEvent = useCallback((evt: any) => {
    const type = evt.type;
    const d = evt.data || evt;

    switch (type) {
      case 'drone_position_updated': {
        const droneId = d.drone_id || evt.drone_id;
        if (!droneId) break;
        setDrones(prev => ({
          ...prev,
          [droneId]: {
            droneId,
            status: d.new_status || d.status || prev[droneId]?.status || 'unknown',
            battery: d.battery ?? prev[droneId]?.battery ?? 100,
            currentLocation: d.current_location || prev[droneId]?.currentLocation || 'Unknown',
            position: d.position || prev[droneId]?.position || { x: 0, y: 0, z: 0 },
            speed: d.speed ?? prev[droneId]?.speed ?? 0,
            missionId: d.mission_id || prev[droneId]?.missionId || null,
          }
        }));
        break;
      }

      case 'drone_status_changed': {
        const droneId = d.drone_id;
        if (!droneId) break;
        setDrones(prev => ({
          ...prev,
          [droneId]: {
            ...prev[droneId],
            droneId,
            status: d.new_status || d.status || 'unknown',
            battery: prev[droneId]?.battery ?? 100,
            currentLocation: prev[droneId]?.currentLocation || 'Unknown',
            position: prev[droneId]?.position || { x: 0, y: 0, z: 0 },
            speed: prev[droneId]?.speed ?? 0,
            missionId: prev[droneId]?.missionId || null,
          }
        }));
        break;
      }

      case 'mission_started':
        setMissionStatus('flying');
        setDroneProgress(0);
        setMissionProgress(0);
        waypointsReachedRef.current = 0;
        break;

      case 'waypoint_reached': {
        waypointsReachedRef.current += 1;
        const total = Math.max(totalStopsRef.current - 1, 1); // exclude starting depot
        const progress = Math.min(waypointsReachedRef.current / total, 1);
        setDroneProgress(progress);
        setMissionProgress(Math.round(progress * 100));

        // Add to flight log
        const logEntry: FlightLogEntry = {
          event: d.waypoint === 'Depot' ? 'landed' : `arrived:${d.waypoint}`,
          location: d.waypoint || 'Unknown',
          position: d.position || { x: 0, y: 0, z: 0 },
          battery: d.battery ?? 100,
          timestamp: Date.now() / 1000,
        };
        setFlightLog(prev => [...prev, logEntry]);
        break;
      }

      case 'delivery_completed':
        // Already handled via waypoint_reached
        break;

      case 'mission_completed':
        setMissionStatus('completed');
        setDroneProgress(1);
        setMissionProgress(100);
        break;

      case 'mission_failed':
        setMissionStatus('failed');
        break;

      case 'mission_paused':
        setMissionStatus('paused');
        break;

      case 'mission_resumed':
        setMissionStatus('flying');
        break;

      case 'drone_battery_low': {
        const droneId = d.drone_id;
        if (droneId) {
          setDrones(prev => ({
            ...prev,
            [droneId]: {
              ...prev[droneId],
              battery: d.battery ?? 0,
              status: 'low_battery',
            } as LiveDroneState,
          }));
        }
        break;
      }

      case 'weather_alert':
      case 'obstacle_detected':
      case 'geofence_violation':
        // These can be surfaced in the UI via lastEvent
        break;
    }
  }, []);

  // Reset state for new mission
  const reset = useCallback(() => {
    setFlightLog([]);
    setDroneProgress(0);
    setMissionProgress(0);
    setMissionStatus('idle');
    setDrones({});
    waypointsReachedRef.current = 0;
  }, []);

  return {
    connected,
    connect,
    disconnect,
    reset,
    drones,
    flightLog,
    droneProgress,
    missionProgress,
    missionStatus,
    lastEvent,
  } satisfies LiveMissionState & { connect: () => void; disconnect: () => void; reset: () => void };
}
