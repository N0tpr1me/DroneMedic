// SimCockpit — top-level wrapper for the 3D simulator panel. It:
//
//   1. Resolves telemetry from the 3-tier priority chain (live-vm > physics
//      > mock) via useUnifiedTelemetry.
//   2. Reads mission state from MissionContext (fleetPhysics, liveMission,
//      simPayload, droneAlerts, missionStatus) and pipes it into
//      SimCockpitContext so every HUD widget sees unified data.
//   3. Mounts the 3D canvas + every HUD widget inside SimCockpitProvider.
//
// The only things outside this file that matter: usePX4Telemetry,
// useMissionContext, useUnifiedTelemetry, useMissionGeography. Everything
// downstream reads from SimCockpitContext.

import { useEffect, useMemo, useState } from 'react';
import { getGPUTier, type TierResult } from 'detect-gpu';

import {
  SimCockpitProvider,
  useSimCockpit,
  type ConnectionState,
  type MissionPhase,
  type PayloadSnapshot,
  type ReasoningItem,
  type SimAlert,
} from './SimCockpitContext';
import { GoogleTilesScene } from './GoogleTilesScene';
import { FlightHUD } from './hud/FlightHUD';
import { PhaseStrip } from './hud/PhaseStrip';
import { LiveStatusPill } from './hud/LiveStatusPill';
import { CameraPresetBar } from './hud/CameraPresetBar';
import { PlaybackControls } from './hud/PlaybackControls';
import { DebugOverlay } from './hud/DebugOverlay';
import { HelpCard } from './hud/HelpCard';
import { ReasoningTicker } from './hud/ReasoningTicker';
import { POVFeed } from './hud/POVFeed';
import { SelfCritiquePanel } from './hud/SelfCritiquePanel';
import { MissionControlBar } from './hud/MissionControlBar';
import { LidarRadarDisplay } from './hud/LidarRadarDisplay';
import { useSimHotkeys } from './useSimHotkeys';
import { useLidarReasoning } from './useLidarReasoning';
import { useMissionGeography } from '../../../hooks/useMissionGeography';
import { useUnifiedTelemetry } from './useUnifiedTelemetry';
import { useMissionContext } from '../../../context/MissionContext';

interface SimCockpitProps {
  expanded: boolean;
  onClose?: () => void;
  onToggleFullscreen?: () => void;
}

// ─ Helpers ─────────────────────────────────────────────────────────

function liveMissionStatusToPhase(status: string): MissionPhase | null {
  const s = status.toLowerCase();
  if (!s || s === 'idle') return null;
  if (s === 'planning') return 'armed';
  if (s === 'flying') return 'enroute';
  if (s === 'rerouting') return 'enroute';
  if (s === 'completed') return 'landed';
  if (s === 'failed') return 'landed';
  return null;
}

interface FlightLogShape {
  event: string;
  location?: string;
  battery?: number;
  timestamp: number;
}

interface AIReasoningShape {
  message?: string;
  content?: string;
  timestamp?: number;
  severity?: 'info' | 'warning' | 'critical';
}

interface SafetyDecisionShape {
  decision?: string;
  reason?: string;
  action?: string;
  timestamp?: number;
  severity?: 'info' | 'warning' | 'critical';
}

function iconForEvent(event: string): string {
  const e = event.toLowerCase();
  if (e.includes('takeoff')) return '▲';
  if (e.includes('land')) return '▼';
  if (e.includes('arrive') || e.includes('waypoint')) return '◉';
  if (e.includes('battery')) return '⚡';
  if (e.includes('complete')) return '✓';
  if (e.includes('reroute') || e.includes('divert')) return '↺';
  if (e.includes('deliver')) return '📦';
  return '·';
}

// ─ Inner component — has SimCockpitContext available ──────────────

interface InnerProps {
  onClose?: () => void;
  onToggleFullscreen?: () => void;
  qualityTier: 'high' | 'medium' | 'low';
  expanded: boolean;
}

function InnerCockpit({ onClose, onToggleFullscreen, qualityTier, expanded }: InnerProps) {
  const { setQualityTier } = useSimCockpit();
  useSimHotkeys({ onClose, onToggleFullscreen });

  useEffect(() => {
    setQualityTier(qualityTier);
  }, [qualityTier, setQualityTier]);

  return (
    <>
      <GoogleTilesScene />
      <LiveStatusPill />
      <MissionControlBar />
      <FlightHUD />
      {/* In compact (mini) mode, hide the heavy HUD widgets that crowd the
          480×320 panel — POV feed, LiDAR radar, reasoning ticker, camera
          presets, self-critique, debug overlay, and help card. The 3D scene,
          flight instruments, mission control bar, phase strip, and playback
          controls remain so the mini view is functional, not just decorative. */}
      {expanded && (
        <>
          <CameraPresetBar />
          <ReasoningTicker />
          <POVFeed />
          <LidarRadarDisplay />
          <SelfCritiquePanel />
          <DebugOverlay />
          <HelpCard />
        </>
      )}
      <PhaseStrip />
      <PlaybackControls />
    </>
  );
}

// ─ Main export ─────────────────────────────────────────────────────

export function SimCockpit({ expanded, onClose, onToggleFullscreen }: SimCockpitProps) {
  const unified = useUnifiedTelemetry();
  const missionGeography = useMissionGeography();
  const mission = useMissionContext();
  const lidarReasoning = useLidarReasoning();

  const [qualityTier, setQualityTier] = useState<'high' | 'medium' | 'low'>('high');

  useEffect(() => {
    let cancelled = false;
    getGPUTier()
      .then((result: TierResult) => {
        if (cancelled) return;
        const tier = result?.tier ?? 2;
        setQualityTier(tier >= 3 ? 'high' : tier === 2 ? 'medium' : 'low');
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // Map unified telemetry source → display-friendly ConnectionState.
  const connection: ConnectionState = useMemo(() => {
    switch (unified.source) {
      case 'live-vm':
        return 'live-vm';
      case 'physics':
        return 'physics';
      case 'mock':
        return 'mock';
      default:
        return 'offline';
    }
  }, [unified.source]);

  // Payload: prefer the authoritative liveMission.payloadStatus from the
  // backend, fall back to the dashboard-wide simPayload (cold chain loop).
  const payload: PayloadSnapshot | null = useMemo(() => {
    const backend = mission.liveMission.payloadStatus as
      | { temperature_c?: number; integrity?: PayloadSnapshot['integrity'] }
      | null
      | undefined;
    if (backend && typeof backend.temperature_c === 'number' && backend.integrity) {
      return {
        temperature_c: backend.temperature_c,
        integrity: backend.integrity,
      };
    }
    return mission.simPayload ?? null;
  }, [mission.liveMission.payloadStatus, mission.simPayload]);

  // Mission phase override: the backend's liveMission.missionStatus is the
  // authoritative high-level state; if it's idle we fall back to deriving
  // the phase from telemetry inside the context.
  const missionPhaseOverride: MissionPhase | null = useMemo(
    () => liveMissionStatusToPhase(mission.liveMission.missionStatus),
    [mission.liveMission.missionStatus],
  );

  // Reasoning items: merge flightLog + AI reasoning + safety decisions
  // into a single chronological stream consumed by ReasoningTicker.
  // Entries without their own timestamp fall back to a deterministic index
  // (avoids Date.now() during render which the react-hooks/purity rule forbids).
  const reasoning: ReasoningItem[] = useMemo(() => {
    const items: ReasoningItem[] = [];
    const idxFallback = (i: number): number => 1_700_000_000_000 + i;

    // Flight log entries
    const flightLog = mission.liveFlightLog as FlightLogShape[];
    for (let i = flightLog.length - 20; i < flightLog.length; i++) {
      if (i < 0) continue;
      const entry = flightLog[i];
      if (!entry) continue;
      items.push({
        id: `flight-${entry.timestamp}-${i}`,
        kind: 'flight',
        text: `${iconForEvent(entry.event)} ${entry.event}${entry.location ? ` · ${entry.location}` : ''}`,
        timestamp: entry.timestamp * 1000,
      });
    }

    // AI reasoning messages from the coordinator / safety agent
    const ai = mission.liveMission.aiReasoningMessages as AIReasoningShape[];
    for (let i = ai.length - 10; i < ai.length; i++) {
      if (i < 0) continue;
      const msg = ai[i];
      if (!msg) continue;
      const text = msg.message ?? msg.content ?? '';
      if (!text) continue;
      items.push({
        id: `ai-${msg.timestamp ?? i}-${i}`,
        kind: 'ai',
        text: `🧠 ${text}`,
        timestamp: msg.timestamp ? msg.timestamp * 1000 : idxFallback(i),
        severity: msg.severity,
      });
    }

    // Safety monitor decisions
    const safety = mission.liveMission.safetyDecisions as SafetyDecisionShape[];
    for (let i = safety.length - 10; i < safety.length; i++) {
      if (i < 0) continue;
      const d = safety[i];
      if (!d) continue;
      const text = d.reason ?? d.decision ?? d.action ?? 'safety decision';
      items.push({
        id: `safety-${d.timestamp ?? i}-${i}`,
        kind: 'safety',
        text: `🛡 ${text}`,
        timestamp: d.timestamp ? d.timestamp * 1000 : idxFallback(i + 500),
        severity: d.severity ?? 'info',
      });
    }

    // LiDAR obstacle cards from the browser-side raycaster
    lidarReasoning.forEach((item) => items.push(item));

    // Sort by timestamp; most recent last so the ticker scrolls naturally.
    items.sort((a, b) => a.timestamp - b.timestamp);
    return items.slice(-30);
  }, [
    mission.liveFlightLog,
    mission.liveMission.aiReasoningMessages,
    mission.liveMission.safetyDecisions,
    lidarReasoning,
  ]);

  // Alerts: only show unacknowledged, recent drone alerts.
  const alerts: SimAlert[] = useMemo(() => {
    return mission.droneAlerts
      .filter((a) => !a.acknowledged)
      .slice(-5)
      .map((a) => ({
        id: a.id,
        droneId: a.droneId,
        message: a.message,
        severity: a.severity,
        timestamp: a.timestamp,
      }));
  }, [mission.droneAlerts]);

  const missionProgress = mission.missionProgress;

  return (
    <div
      className="absolute inset-0 overflow-hidden"
      style={{ background: '#020308' }}
    >
      <SimCockpitProvider
        telemetry={unified.telemetry}
        source={unified.source}
        missionGeography={missionGeography}
        connection={connection}
        payload={payload}
        reasoning={reasoning}
        alerts={alerts}
        missionProgress={missionProgress}
        missionPhaseOverride={missionPhaseOverride}
        sendCommand={unified.sendCommand}
      >
        <InnerCockpit
          onClose={onClose}
          onToggleFullscreen={onToggleFullscreen}
          qualityTier={qualityTier}
          expanded={expanded}
        />
      </SimCockpitProvider>
    </div>
  );
}
