/**
 * MissionContext — Shares fleet simulation state across all pages.
 *
 * Wraps useFleetPhysics (multi-drone physics simulation) and
 * useLiveMission (WebSocket backend events) into a single React
 * context so Dashboard, Logs, Analytics, Fleet, Status, Deploy,
 * and ChatPanel can all read/write the same mission state.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  useFleetPhysics,
  DEFAULT_FLEET_CONFIG,
  SUPPLY_WEIGHTS,
  type FleetConfig,
  type FleetEvent,
} from '../hooks/useFleetPhysics';

import { useLiveMission } from '../hooks/useLiveMission';

import { haversineM, DEFAULT_CONDITIONS, type FlightConditions, type WindVector } from '../lib/physics-engine';

import type { FlightLogEntry, Task, Route, Location } from '../lib/api';

// ── Types ──────────────────────────────────────────────────────────

export interface DroneAlert {
  id: string;
  droneId: string;
  type: 'offline' | 'battery_critical' | 'battery_low' | 'reroute' | 'emergency' | 'mission_failed' | 'geofence';
  message: string;
  severity: 'info' | 'warning' | 'critical';
  timestamp: number;
  acknowledged: boolean;
}

export interface FleetSummary {
  totalDrones: number;
  activeDrones: number;
  idleDrones: number;
  offlineDrones: number;
  avgBattery: number;
  deliveriesToday: number;
  avgDeliveryTimeMin: number;
  facilitiesServed: number;
  recentEvents: Array<{ text: string; time: string; severity: string }>;
}

export interface StoredMission {
  id: number;
  name: string;
  deliveryTime: number;
  clinicalDeadline: number;
  distance: number;
  naiveDistance: number;
  battery: number;
  status: string;
  facility: string;
  priority: string;
  completedAt: string;
  supplies?: string;
  droneId?: string;
}

type UseFleetPhysicsReturn = ReturnType<typeof useFleetPhysics>;

export interface MissionContextValue {
  // Fleet physics
  fleetPhysics: UseFleetPhysicsReturn;

  // Live backend connection
  liveMission: {
    connected: boolean;
    connect: () => void;
    disconnect: () => void;
    reset: () => void;
    missionStatus: string;
    flightLog: FlightLogEntry[];
    droneProgress: number;
    missionProgress: number;
    safetyDecisions: any[];
    cvDetection: any;
    aiReasoningMessages: any[];
    payloadStatus: any;
  };

  // Accumulated flight log from BOTH physics events and backend WebSocket
  liveFlightLog: FlightLogEntry[];

  // Completed missions persisted to localStorage
  completedMissions: StoredMission[];

  // Dispatch a delivery -- finds closest idle drone automatically
  dispatchDelivery: (task: Task, route: Route, userLocation?: { lat: number; lon: number }) => string;

  // Current overall mission status
  missionStatus: 'idle' | 'planning' | 'flying' | 'rerouting' | 'completed';

  // Active mission state — persists across page navigation
  activeTask: Task | null;
  activeRoute: Route | null;
  setActiveTask: (task: Task | null) => void;
  setActiveRoute: (route: Route | null) => void;
  activeDroneId: string | null;

  // Cross-page reactive alerts
  droneAlerts: DroneAlert[];
  acknowledgeAlert: (alertId: string) => void;

  // Derived fleet summary for Status/Fleet pages
  fleetSummary: FleetSummary;
}

// ── Context ────────────────────────────────────────────────────────

const MissionContext = createContext<MissionContextValue | null>(null);

// ── Constants ──────────────────────────────────────────────────────

const STORAGE_KEY = 'dronemedic_completed_missions';

function loadCompletedMissions(): StoredMission[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveCompletedMissions(missions: StoredMission[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(missions));
  } catch {
    // Storage full or unavailable -- silently ignore
  }
}

function makeAlertId(): string {
  return `alert-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function todayDateStr(): string {
  return new Date().toISOString().slice(0, 10);
}

// ── Provider ───────────────────────────────────────────────────────

interface MissionProviderProps {
  children: ReactNode;
  initialWind?: WindVector;
  initialConditions?: FlightConditions;
}

export function MissionProvider({
  children,
  initialWind = { speed: 0, direction: 0 },
  initialConditions = DEFAULT_CONDITIONS,
}: MissionProviderProps) {
  // ── State ────────────────────────────────────────────────────────
  const [liveFlightLog, setLiveFlightLog] = useState<FlightLogEntry[]>([]);
  const [completedMissions, setCompletedMissions] = useState<StoredMission[]>(loadCompletedMissions);
  const [missionStatus, setMissionStatus] = useState<MissionContextValue['missionStatus']>('idle');
  const [droneAlerts, setDroneAlerts] = useState<DroneAlert[]>([]);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [activeRoute, setActiveRoute] = useState<Route | null>(null);
  const [activeDroneId, setActiveDroneId] = useState<string | null>(null);

  // Location cache for building waypoints from route names
  const locationsCache = useRef<Record<string, Location>>({});

  // ── Persist completed missions ───────────────────────────────────
  useEffect(() => {
    saveCompletedMissions(completedMissions);
  }, [completedMissions]);

  // ── Fleet event handler (physics -> logs + alerts) ───────────────
  const handleFleetEvent = useCallback((evt: FleetEvent) => {
    const ts = evt.timestamp / 1000;

    // Convert to FlightLogEntry
    const logEntry: FlightLogEntry = {
      event: evt.type === 'waypoint_reached'
        ? `arrived:${(evt.data as Record<string, unknown>).name ?? 'waypoint'}`
        : evt.type === 'mission_complete'
          ? 'mission_complete'
          : evt.type === 'takeoff'
            ? 'takeoff'
            : evt.type === 'landed'
              ? 'landed'
              : evt.type === 'battery_warning'
                ? 'battery_warning'
                : evt.type,
      location: String((evt.data as Record<string, unknown>).name ?? evt.droneId),
      position: {
        x: Number((evt.data as Record<string, unknown>).lat ?? 0),
        y: Number((evt.data as Record<string, unknown>).lon ?? 0),
        z: 0,
      },
      battery: Number((evt.data as Record<string, unknown>).battery_pct ?? 100),
      timestamp: ts,
    };
    setLiveFlightLog((prev) => [...prev, logEntry]);

    // Generate alerts based on event type
    if (evt.type === 'battery_warning' || evt.type === 'battery_milestone') {
      const batteryPct = Number((evt.data as Record<string, unknown>).battery_pct ?? (evt.data as Record<string, unknown>).milestone ?? 0);

      if (batteryPct < 5) {
        setDroneAlerts((prev) => [
          ...prev,
          {
            id: makeAlertId(),
            droneId: evt.droneId,
            type: 'offline',
            message: `${evt.droneId} battery critically depleted (${batteryPct.toFixed(1)}%)`,
            severity: 'critical',
            timestamp: evt.timestamp,
            acknowledged: false,
          },
        ]);
      } else if (batteryPct < 20) {
        setDroneAlerts((prev) => [
          ...prev,
          {
            id: makeAlertId(),
            droneId: evt.droneId,
            type: 'battery_critical',
            message: `${evt.droneId} battery critical (${batteryPct.toFixed(1)}%)`,
            severity: 'critical',
            timestamp: evt.timestamp,
            acknowledged: false,
          },
        ]);
      } else if (batteryPct < 30) {
        setDroneAlerts((prev) => [
          ...prev,
          {
            id: makeAlertId(),
            droneId: evt.droneId,
            type: 'battery_low',
            message: `${evt.droneId} battery low (${batteryPct.toFixed(1)}%)`,
            severity: 'warning',
            timestamp: evt.timestamp,
            acknowledged: false,
          },
        ]);
      }
    }

    // Mission complete -> save to completedMissions
    if (evt.type === 'mission_complete') {
      const data = evt.data as Record<string, unknown>;
      const newMission: StoredMission = {
        id: Date.now(),
        name: String(data.missionId ?? `mission-${Date.now()}`),
        deliveryTime: Number(data.elapsedTimeS ?? 0),
        clinicalDeadline: 0,
        distance: 0,
        naiveDistance: 0,
        battery: Number(data.battery_pct ?? 0),
        status: 'completed',
        facility: String(data.name ?? 'Unknown'),
        priority: 'normal',
        completedAt: new Date().toISOString(),
        droneId: evt.droneId,
      };
      setCompletedMissions((prev) => [...prev, newMission]);

      // Check if all drones are idle now
      // (deferred to next render via missionStatus update)
    }
  }, []);

  // ── useFleetPhysics ──────────────────────────────────────────────
  const fleetConfigs = useMemo(() => [...DEFAULT_FLEET_CONFIG], []);

  const fleetPhysics = useFleetPhysics(
    fleetConfigs,
    initialWind,
    initialConditions,
    handleFleetEvent,
  );

  // ── useLiveMission ──────────────────────────────────────────────
  const live = useLiveMission();

  const liveMission = useMemo(
    () => ({
      connected: live.connected,
      connect: live.connect,
      disconnect: live.disconnect,
      reset: live.reset,
      missionStatus: live.missionStatus,
      flightLog: live.flightLog,
      droneProgress: live.droneProgress,
      missionProgress: live.missionProgress,
      safetyDecisions: live.safetyDecisions,
      cvDetection: live.cvDetection,
      aiReasoningMessages: live.aiReasoningMessages,
      payloadStatus: live.payloadStatus,
    }),
    [
      live.connected,
      live.connect,
      live.disconnect,
      live.reset,
      live.missionStatus,
      live.flightLog,
      live.droneProgress,
      live.missionProgress,
      live.safetyDecisions,
      live.cvDetection,
      live.aiReasoningMessages,
      live.payloadStatus,
    ],
  );

  // Merge backend flight log into liveFlightLog
  useEffect(() => {
    if (live.flightLog.length > 0) {
      setLiveFlightLog((prev) => {
        const existingTimestamps = new Set(prev.map((e) => e.timestamp));
        const newEntries = live.flightLog.filter((e) => !existingTimestamps.has(e.timestamp));
        return newEntries.length > 0 ? [...prev, ...newEntries] : prev;
      });
    }
  }, [live.flightLog]);

  // Sync overall mission status from backend events
  useEffect(() => {
    const backendStatus = live.missionStatus;
    if (backendStatus === 'flying') setMissionStatus('flying');
    else if (backendStatus === 'completed') setMissionStatus('completed');
    else if (backendStatus === 'failed') setMissionStatus('idle');
  }, [live.missionStatus]);

  // ── acknowledgeAlert ─────────────────────────────────────────────
  const acknowledgeAlert = useCallback((alertId: string) => {
    setDroneAlerts((prev) =>
      prev.map((a) => (a.id === alertId ? { ...a, acknowledged: true } : a)),
    );
  }, []);

  // ── dispatchDelivery ─────────────────────────────────────────────
  const dispatchDelivery = useCallback(
    (task: Task, route: Route, userLocation?: { lat: number; lon: number }) => {
      const depotLat = userLocation?.lat ?? 51.5074;
      const depotLon = userLocation?.lon ?? -0.1278;

      // Find closest idle drone
      const droneMapData = fleetPhysics.getDroneMapData();
      let closestId = '';
      let closestDist = Infinity;

      for (const d of droneMapData) {
        if (d.status !== 'idle') continue;
        const dist = haversineM(depotLat, depotLon, d.lat, d.lng);
        if (dist < closestDist) {
          closestDist = dist;
          closestId = d.id;
        }
      }

      if (!closestId) {
        // Fallback: pick first drone from config
        closestId = fleetConfigs[0]?.id ?? 'drone-1';
      }

      // Determine payload weight from supplies
      const supplyKeys = Object.values(task.supplies);
      const payloadKg = supplyKeys.reduce((sum, supply) => {
        const key = supply.toLowerCase().replace(/\s+/g, '_');
        return sum + (SUPPLY_WEIGHTS[key] ?? 1.0);
      }, 0) || 1.0;

      // Build waypoints from route.ordered_route
      const waypoints = route.ordered_route.map((name) => {
        const loc = locationsCache.current[name];
        return {
          lat: loc?.lat ?? depotLat,
          lon: loc?.lon ?? depotLon,
          name,
        };
      });

      // Dispatch
      fleetPhysics.dispatchDrone(closestId, waypoints, payloadKg);
      setMissionStatus('flying');
      setActiveTask(task);
      setActiveRoute(route);
      setActiveDroneId(closestId);

      return closestId;
    },
    [fleetPhysics, fleetConfigs],
  );

  // ── Fetch locations once and cache ───────────────────────────────
  useEffect(() => {
    const fetchLocations = async () => {
      try {
        const apiBase = import.meta.env.VITE_API_URL || '';
        const res = await fetch(`${apiBase}/api/locations`);
        if (res.ok) {
          const data = await res.json();
          locationsCache.current = data.locations ?? {};
        }
      } catch {
        // API unavailable -- waypoints will use depot fallback
      }
    };
    fetchLocations();
  }, []);

  // ── fleetSummary (derived) ───────────────────────────────────────
  const fleetSummary: FleetSummary = useMemo(() => {
    const mapData = fleetPhysics.getDroneMapData();
    const totalDrones = mapData.length;

    let activeDrones = 0;
    let idleDrones = 0;
    let offlineDrones = 0;
    let batterySum = 0;

    for (const d of mapData) {
      // Get telemetry for battery info
      const tel = fleetPhysics.getTelemetry(d.id);
      const batteryPct = tel?.battery_pct ?? 100;
      batterySum += batteryPct;

      if (batteryPct < 5) {
        offlineDrones += 1;
      } else if (d.status !== 'idle') {
        activeDrones += 1;
      } else {
        idleDrones += 1;
      }
    }

    const avgBattery = totalDrones > 0 ? batterySum / totalDrones : 100;

    // Today's completed missions
    const today = todayDateStr();
    const todayMissions = completedMissions.filter(
      (m) => m.completedAt.slice(0, 10) === today,
    );
    const deliveriesToday = todayMissions.length;

    const avgDeliveryTimeMin =
      deliveriesToday > 0
        ? todayMissions.reduce((sum, m) => sum + m.deliveryTime, 0) / deliveriesToday / 60
        : 0;

    const facilitiesServed = new Set(todayMissions.map((m) => m.facility)).size;

    // Recent events from flight log
    const recentEvents = liveFlightLog
      .slice(-10)
      .reverse()
      .map((entry) => ({
        text: `${entry.event} at ${entry.location}`,
        time: new Date(entry.timestamp * 1000).toLocaleTimeString(),
        severity:
          entry.event.includes('warning') || entry.event.includes('critical')
            ? 'warning'
            : entry.event.includes('complete')
              ? 'success'
              : 'info',
      }));

    return {
      totalDrones,
      activeDrones,
      idleDrones,
      offlineDrones,
      avgBattery: Math.round(avgBattery * 10) / 10,
      deliveriesToday,
      avgDeliveryTimeMin: Math.round(avgDeliveryTimeMin * 10) / 10,
      facilitiesServed,
      recentEvents,
    };
  }, [fleetPhysics, completedMissions, liveFlightLog]);

  // ── Context value ────────────────────────────────────────────────
  const value: MissionContextValue = useMemo(
    () => ({
      fleetPhysics,
      liveMission,
      liveFlightLog,
      completedMissions,
      dispatchDelivery,
      missionStatus,
      activeTask,
      activeRoute,
      setActiveTask,
      setActiveRoute,
      activeDroneId,
      droneAlerts,
      acknowledgeAlert,
      fleetSummary,
    }),
    [
      fleetPhysics,
      liveMission,
      liveFlightLog,
      completedMissions,
      dispatchDelivery,
      missionStatus,
      activeTask,
      activeRoute,
      activeDroneId,
      droneAlerts,
      acknowledgeAlert,
      fleetSummary,
    ],
  );

  return (
    <MissionContext.Provider value={value}>
      {children}
    </MissionContext.Provider>
  );
}

// ── Consumer hook ──────────────────────────────────────────────────

export function useMissionContext(): MissionContextValue {
  const ctx = useContext(MissionContext);
  if (!ctx) {
    throw new Error('useMissionContext must be used within a MissionProvider');
  }
  return ctx;
}
