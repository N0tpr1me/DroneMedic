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

export interface ChatSession {
  id: string;
  title: string;
  messages: Array<{ id: string; role: string; content: string; timestamp: string }>;
  createdAt: string;
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

  // Deploy page multi-session chat history
  chatSessions: ChatSession[];
  activeChatId: string | null;
  setActiveChatId: (id: string | null) => void;
  createChatSession: () => string; // returns new session id
  deleteChatSession: (id: string) => void;
  updateChatMessages: (sessionId: string, msgs: Array<{ id: string; role: string; content: string; timestamp: string }>) => void;

  // Cross-page reactive alerts
  droneAlerts: DroneAlert[];
  acknowledgeAlert: (alertId: string) => void;

  // Derived fleet summary for Status/Fleet pages
  fleetSummary: FleetSummary;

  // Live mission telemetry — lifted from Dashboard so it survives page navigation
  droneProgress: number;                                                     // 0..1 along route
  missionProgress: number;                                                   // 0..100
  liveBattery: number;                                                       // 0..100 — authoritative battery for active drone
  simPayload: { temperature_c: number; integrity: 'nominal' | 'warning' | 'critical' } | null;
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

  // Multi-session chat history
  const [chatSessions, setChatSessions] = useState<ChatSession[]>(() => {
    try {
      const stored = localStorage.getItem('dronemedic_chat_sessions');
      if (stored) return JSON.parse(stored);
    } catch { /* ignore */ }
    return [];
  });
  const [activeChatId, setActiveChatId] = useState<string | null>(() => {
    try {
      const stored = localStorage.getItem('dronemedic_active_chat');
      if (stored) return stored;
    } catch { /* ignore */ }
    return null;
  });

  // Persist chat sessions to localStorage
  useEffect(() => {
    try { localStorage.setItem('dronemedic_chat_sessions', JSON.stringify(chatSessions)); } catch { /* ignore */ }
  }, [chatSessions]);
  useEffect(() => {
    try { localStorage.setItem('dronemedic_active_chat', activeChatId ?? ''); } catch { /* ignore */ }
  }, [activeChatId]);

  const createChatSession = useCallback(() => {
    const id = `chat-${Date.now()}`;
    const session: ChatSession = { id, title: 'New Mission', messages: [], createdAt: new Date().toISOString() };
    setChatSessions(prev => [session, ...prev]);
    setActiveChatId(id);
    return id;
  }, []);

  const deleteChatSession = useCallback((id: string) => {
    setChatSessions(prev => prev.filter(s => s.id !== id));
    setActiveChatId(prev => prev === id ? null : prev);
  }, []);

  const updateChatMessages = useCallback((sessionId: string, msgs: ChatSession['messages']) => {
    setChatSessions(prev => prev.map(s => {
      if (s.id !== sessionId) return s;
      // Auto-title from first user message
      const firstUser = msgs.find(m => m.role === 'user');
      const title = firstUser ? firstUser.content.slice(0, 40) + (firstUser.content.length > 40 ? '...' : '') : s.title;
      return { ...s, messages: msgs, title };
    }));
  }, []);

  // Location cache for building waypoints from route names
  const locationsCache = useRef<Record<string, Location>>({});

  // ── Live mission state (lifted from Dashboard so it survives page navigation)
  const [droneProgress, setDroneProgress] = useState(0);
  const [missionProgress, setMissionProgress] = useState(0);
  const [liveBattery, setLiveBattery] = useState(100);
  const [simPayload, setSimPayload] = useState<{
    temperature_c: number;
    integrity: 'nominal' | 'warning' | 'critical';
  } | null>(null);
  const flightStartRef = useRef<number | null>(null);

  // Last-known battery per drone — fallback when fleet events lack battery_pct
  const batteryByDroneRef = useRef<Record<string, number>>({});

  // ── Persist completed missions ───────────────────────────────────
  useEffect(() => {
    saveCompletedMissions(completedMissions);
  }, [completedMissions]);

  // ── Fleet event handler (physics -> logs + alerts) ───────────────
  const handleFleetEvent = useCallback((evt: FleetEvent) => {
    const ts = evt.timestamp / 1000;

    // Skip noisy events that spam the chat/flight log
    if (evt.type === 'wind_change' || evt.type === 'phase_change') return;

    // Resolve battery: prefer event's battery_pct, else use last-known battery for this
    // drone (monotonically decreasing), else 0. Never fall back to 100 — that produces
    // fake "Battery 100% on arrival" entries in the chain-of-custody timeline.
    const rawBat = (evt.data as Record<string, unknown>).battery_pct;
    const prevBat = batteryByDroneRef.current[evt.droneId];
    const batteryVal = rawBat != null ? Number(rawBat) : (prevBat ?? 0);
    if (rawBat != null) {
      batteryByDroneRef.current[evt.droneId] = Number(rawBat);
    }

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
      battery: batteryVal,
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

  // ── Live progress loop (10 Hz) ───────────────────────────────────
  // Runs continuously in the provider so progress keeps advancing even when
  // the user navigates away from /dashboard. Reads primary values from the
  // physics simulation; falls back to elapsed-time / estimated_time when the
  // physics sim has no flying drone (e.g. all waypoints collapsed to depot).
  useEffect(() => {
    if (missionStatus !== 'flying') return;
    const interval = setInterval(() => {
      const mapData = fleetPhysics.getDroneMapData();
      const flying = mapData.find((d) => d.status !== 'idle' && d.status !== 'preflight');
      if (flying) {
        const tel = fleetPhysics.getTelemetry(flying.id);
        if (tel) {
          setLiveBattery(Math.round(tel.battery_pct));
          setMissionProgress(Math.round(tel.missionProgress));
          setDroneProgress(
            tel.totalWaypoints > 1 ? Math.min(tel.missionProgress / 100, 1) : 0,
          );
          if (tel.missionProgress >= 100) {
            setMissionStatus('completed');
            flightStartRef.current = null;
          }
        }
      } else if (activeRoute?.estimated_time && flightStartRef.current != null) {
        // Time-based fallback
        const elapsed = (performance.now() - flightStartRef.current) / 1000;
        const p = Math.min(elapsed / activeRoute.estimated_time, 1);
        setDroneProgress(p);
        setMissionProgress(Math.round(p * 100));
        // Simulate gradual battery drain during fallback flight (~30% per mission)
        setLiveBattery((prev) => Math.max(0, Math.round(100 - p * 30)));
        if (p >= 1) {
          setMissionStatus('completed');
          flightStartRef.current = null;
        }
      }
    }, 100);
    return () => clearInterval(interval);
    // fleetPhysics is referenced via closure; its methods read from refs internally
    // so stale closures don't matter. Keying on missionStatus + activeRoute keeps
    // the interval in sync with the active mission without restarting every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missionStatus, activeRoute]);

  // ── Cold-chain payload temperature simulation (mean-reverting) ───
  // Runs in the provider so temperature keeps fluctuating during page navigation.
  useEffect(() => {
    if (live.payloadStatus) { setSimPayload(null); return; }
    if (missionStatus === 'idle') { setSimPayload(null); return; }
    const base = 4.0; // standard blood storage target (°C)
    setSimPayload({ temperature_c: base, integrity: 'nominal' });
    const iv = setInterval(() => {
      setSimPayload((prev) => {
        if (!prev) return { temperature_c: base, integrity: 'nominal' };
        const reversion = 0.15; // pull strength back toward base each tick
        const noise = (Math.random() - 0.5) * 0.18; // zero-mean wiggle ±0.09°C
        const delta = reversion * (base - prev.temperature_c) + noise;
        const next = Math.round((prev.temperature_c + delta) * 100) / 100;
        const clamped = Math.max(3.2, Math.min(4.8, next));
        const integrity: 'nominal' | 'warning' | 'critical' =
          clamped > 6.0 ? 'critical' : clamped > 5.0 ? 'warning' : 'nominal';
        return { temperature_c: clamped, integrity };
      });
    }, 2000);
    return () => clearInterval(iv);
  }, [missionStatus, live.payloadStatus]);

  // Null flightStartRef when mission completes/resets
  useEffect(() => {
    if (missionStatus === 'idle' || missionStatus === 'completed') {
      flightStartRef.current = null;
    }
  }, [missionStatus]);

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

      // ── Reset all live state for a clean new mission (prevents stale events
      //    from previous missions leaking into the chain-of-custody timeline)
      live.reset();                              // clears backend-sourced flightLog
      setLiveFlightLog([]);                      // clears merged log
      batteryByDroneRef.current = {};            // clears per-drone battery memory
      setDroneProgress(0);
      setMissionProgress(0);
      setLiveBattery(100);
      setSimPayload(null);                       // temp effect will re-initialize
      flightStartRef.current = performance.now(); // start of mission for time-fallback

      // Dispatch
      fleetPhysics.dispatchDrone(closestId, waypoints, payloadKg);
      setMissionStatus('flying');
      setActiveTask(task);
      setActiveRoute(route);
      setActiveDroneId(closestId);

      return closestId;
    },
    [fleetPhysics, fleetConfigs, live],
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
      chatSessions,
      activeChatId,
      setActiveChatId,
      createChatSession,
      deleteChatSession,
      updateChatMessages,
      droneAlerts,
      acknowledgeAlert,
      fleetSummary,
      droneProgress,
      missionProgress,
      liveBattery,
      simPayload,
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
      chatSessions,
      activeChatId,
      droneAlerts,
      acknowledgeAlert,
      fleetSummary,
      droneProgress,
      missionProgress,
      liveBattery,
      simPayload,
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
