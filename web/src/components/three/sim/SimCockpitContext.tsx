// SimCockpitContext — the single source of truth for the 3D simulation
// panel. It owns telemetry refs (for per-frame consumers like VMDrone and
// CameraRig) plus throttled snapshots (for HUD widgets that need React state).
//
// Design rule: the Canvas tree must NEVER re-render at telemetry rate
// (30+ Hz). All per-frame work reads from telemetryRef via useFrame; HUD
// widgets read from the throttled snapshot via useSimCockpit.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import type { PX4Telemetry } from '../../../hooks/usePX4Telemetry';
import type { MissionGeography } from '../../../hooks/useMissionGeography';

export type CameraPreset =
  | 'chase'
  | 'cockpit'
  | 'topdown'
  | 'cinematic'
  | 'free';

export type ConnectionState =
  | 'live-vm'
  | 'physics'
  | 'mock'
  | 'reconnecting'
  | 'offline';

export interface PlaybackState {
  paused: boolean;
  speed: 1 | 2 | 4;
  replayingUntil: number | null;
}

export interface MissionRoutePoint {
  lat: number;
  lon: number;
  alt?: number;
  label?: string;
}

export interface SimCockpitState {
  telemetry: PX4Telemetry | null;
  connection: ConnectionState;
  tilesAvailable: boolean;
  cameraPreset: CameraPreset;
  activeDroneId: string | null;
  playback: PlaybackState;
  missionPhase: MissionPhase;
  debugOpen: boolean;
  helpOpen: boolean;
  reducedMotion: boolean;
  qualityTier: 'high' | 'medium' | 'low';
}

export type MissionPhase =
  | 'idle'
  | 'armed'
  | 'takeoff'
  | 'enroute'
  | 'delivering'
  | 'returning'
  | 'landed';

export interface SimCockpitContextValue extends SimCockpitState {
  telemetryRef: React.MutableRefObject<PX4Telemetry | null>;
  missionGeography: MissionGeography;
  setCameraPreset: (preset: CameraPreset) => void;
  setActiveDroneId: (id: string | null) => void;
  setTilesAvailable: (value: boolean) => void;
  setConnection: (state: ConnectionState) => void;
  setPlayback: (updater: (prev: PlaybackState) => PlaybackState) => void;
  setDebugOpen: (value: boolean | ((prev: boolean) => boolean)) => void;
  setHelpOpen: (value: boolean | ((prev: boolean) => boolean)) => void;
  setQualityTier: (tier: 'high' | 'medium' | 'low') => void;
  pushTelemetry: (t: PX4Telemetry | null) => void;
  subscribeTelemetry: (listener: (t: PX4Telemetry | null) => void) => () => void;
}

const SimCockpitContext = createContext<SimCockpitContextValue | null>(null);

const HUD_SNAPSHOT_HZ = 10;

interface ProviderProps {
  children: ReactNode;
  telemetry: PX4Telemetry | null;
  missionGeography: MissionGeography;
  connection: ConnectionState;
}

export function SimCockpitProvider({
  children,
  telemetry,
  missionGeography,
  connection,
}: ProviderProps) {
  const telemetryRef = useRef<PX4Telemetry | null>(telemetry);
  const listenersRef = useRef<Set<(t: PX4Telemetry | null) => void>>(new Set());

  const [snapshot, setSnapshot] = useState<PX4Telemetry | null>(telemetry);
  const [cameraPreset, setCameraPresetState] = useState<CameraPreset>('chase');
  const [activeDroneId, setActiveDroneId] = useState<string | null>(null);
  const [tilesAvailable, setTilesAvailable] = useState<boolean>(true);
  const [connState, setConnState] = useState<ConnectionState>(connection);
  const [playback, setPlayback] = useState<PlaybackState>({
    paused: false,
    speed: 1,
    replayingUntil: null,
  });
  const [debugOpen, setDebugOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [qualityTier, setQualityTier] = useState<'high' | 'medium' | 'low'>(
    'high',
  );

  // Reduced-motion preference — gates postprocessing / cinematic camera.
  const reducedMotion = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  }, []);

  // Mission phase derived from telemetry + connection state.
  const missionPhase = useMemo<MissionPhase>(() => {
    const t = snapshot;
    if (!t) return 'idle';
    if (!t.is_armed && !t.is_flying) return 'idle';
    if (t.is_armed && !t.is_flying) return 'armed';
    const alt = t.relative_alt_m ?? 0;
    if (t.is_flying && alt < 5) return 'takeoff';
    if (t.flight_mode?.toUpperCase().includes('LAND')) return 'delivering';
    if (t.is_flying) return 'enroute';
    return 'landed';
  }, [snapshot]);

  // Push telemetry from the parent hook into the ref + throttled snapshot.
  const throttleTimer = useRef<number | null>(null);
  const pushTelemetry = useCallback((t: PX4Telemetry | null) => {
    telemetryRef.current = t;
    listenersRef.current.forEach((fn) => fn(t));
    if (throttleTimer.current != null) return;
    throttleTimer.current = window.setTimeout(() => {
      throttleTimer.current = null;
      setSnapshot(telemetryRef.current);
    }, 1000 / HUD_SNAPSHOT_HZ);
  }, []);

  // Keep the ref fresh when the parent's telemetry changes.
  useEffect(() => {
    pushTelemetry(telemetry);
  }, [telemetry, pushTelemetry]);

  useEffect(() => {
    setConnState(connection);
  }, [connection]);

  useEffect(() => {
    const listeners = listenersRef.current;
    return () => {
      if (throttleTimer.current != null) window.clearTimeout(throttleTimer.current);
      listeners.clear();
    };
  }, []);

  const subscribeTelemetry = useCallback(
    (listener: (t: PX4Telemetry | null) => void) => {
      listenersRef.current.add(listener);
      listener(telemetryRef.current);
      return () => {
        listenersRef.current.delete(listener);
      };
    },
    [],
  );

  const setCameraPreset = useCallback((preset: CameraPreset) => {
    setCameraPresetState(preset);
  }, []);

  const value: SimCockpitContextValue = {
    telemetry: snapshot,
    connection: connState,
    tilesAvailable,
    cameraPreset,
    activeDroneId,
    playback,
    missionPhase,
    debugOpen,
    helpOpen,
    reducedMotion,
    qualityTier,
    telemetryRef,
    missionGeography,
    setCameraPreset,
    setActiveDroneId,
    setTilesAvailable,
    setConnection: setConnState,
    setPlayback,
    setDebugOpen,
    setHelpOpen,
    setQualityTier,
    pushTelemetry,
    subscribeTelemetry,
  };

  return (
    <SimCockpitContext.Provider value={value}>
      {children}
    </SimCockpitContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSimCockpit(): SimCockpitContextValue {
  const ctx = useContext(SimCockpitContext);
  if (!ctx) {
    throw new Error('useSimCockpit must be used within a SimCockpitProvider');
  }
  return ctx;
}
