// useSyntheticDecisions — browser-side synthetic AI decision generator.
//
// The DecisionStream dashboard panel subscribes to the backend's
// `/api/ai/decisions` feed + live `ai_reasoning` WebSocket events, but those
// only fire when a real Claude API call lands (coordinator, task parser,
// what-if, replan, policy fire). In local-dev with no live mission, the
// stream is permanently empty.
//
// This hook derives synthetic `AIDecisionEvent` records from three existing
// app-internal sources so the stream always has substance to show:
//
//   1. Mission flight log        → `parse_request` / `policy_fire` cards
//   2. AI reasoning messages      → `query` cards
//   3. Safety monitor decisions   → `policy_fire` cards
//   4. Mission status transitions → `policy_fire` cards
//   5. LiDAR obstacle clusters    → `policy_fire` cards (debounced per bucket)
//
// All synthetic decisions are tagged `model: 'local-sim'` so the UI can
// render a `SIM` pill on them, making the real-vs-synthetic distinction
// transparent to viewers.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useMissionContext } from '../context/MissionContext';
import {
  subscribeLidarFrame,
  type LidarFrame,
  type LidarObstacle,
} from '../components/three/sim/lidarBus';
import type {
  AIDecisionEvent,
  AIDecisionIntent,
  AIDecisionSeverity,
  FlightLogEntry,
} from '../lib/api';
import { subscribeDecisions } from '../lib/decisionBus';

const MAX_SYNTHETIC = 50;
const LIDAR_DEBOUNCE_MS = 2500;
const SIM_MODEL_TAG = 'local-sim';

// Events that fire constantly during a flight and add no reasoning value.
// Filtering them keeps the DecisionStream focused on meaningful decisions.
const FLIGHT_LOG_SKIP: ReadonlySet<string> = new Set([
  'battery_milestone',
  'battery_update',
  'position_update',
  'telemetry_tick',
  'waypoint_update',
  'heartbeat',
  'status_update',
]);

// Events that are worth surfacing as a decision card. Everything not listed
// and not in FLIGHT_LOG_SKIP falls through to a generic "info" card, but
// these get curated reasoning text and stronger severity.
const FLIGHT_LOG_CURATED: ReadonlySet<string> = new Set([
  'takeoff',
  'mission_started',
  'waypoint_reached',
  'arrived',
  'delivering',
  'delivered',
  'delivery_completed',
  'rerouting',
  'reroute',
  'divert',
  'landing',
  'landed',
  'mission_completed',
  'abort',
  'emergency',
  'geofence_violation',
  'obstacle_detected',
]);

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

function hashString(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

function severityFromMsg(
  sev: 'info' | 'warning' | 'critical' | undefined,
): AIDecisionSeverity {
  if (sev === 'critical') return 'error';
  if (sev === 'warning') return 'warning';
  return 'info';
}

function severityFromObstacle(
  sev: LidarObstacle['severity'],
): AIDecisionSeverity {
  if (sev === 'critical') return 'error';
  if (sev === 'warning') return 'warning';
  return 'info';
}

function intentForEvent(event: string): AIDecisionIntent {
  const e = event.toLowerCase();
  if (e.includes('reroute') || e.includes('divert') || e.includes('replan')) {
    return 'replan';
  }
  if (e.includes('geofence') || e.includes('abort') || e.includes('emergency') || e.includes('obstacle')) {
    return 'policy_fire';
  }
  if (e.includes('takeoff') || e.includes('deliver') || e.includes('arrive') || e.includes('waypoint') || e.includes('landed') || e.includes('completed')) {
    return 'parse_request';
  }
  return 'followup';
}

function reasoningForFlightEvent(entry: FlightLogEntry): string {
  const e = entry.event.toLowerCase();
  const loc = entry.location || 'current waypoint';
  const bat = typeof entry.battery === 'number' ? `${entry.battery.toFixed(0)}%` : 'unknown';

  if (e.includes('takeoff')) {
    return `Go-signal issued. Pre-flight checklist complete (payload secured, GPS lock, IMU calibrated, battery ${bat}). Motors armed and drone has left the pad. Expected cruise altitude 80 m AGL, cruise speed 15 m/s.`;
  }
  if (e.includes('waypoint') || e.includes('arrive')) {
    return `Waypoint ${loc} reached. Battery at ${bat}. Updating remaining leg estimate. Geofence envelope re-verified against the next segment. No deviations from planned track.`;
  }
  if (e.includes('deliver')) {
    return `Delivery executed at ${loc}. Payload released, confirmation telemetry returned. Remaining battery ${bat}. Re-tasking drone to next route node or return-to-base if route exhausted.`;
  }
  if (e.includes('reroute') || e.includes('replan')) {
    return `Route conditions changed mid-flight. OR-Tools VRP re-solved with updated constraints (weather, no-fly, priority). New path dispatched to autopilot. Battery margin ${bat} confirmed sufficient for revised leg.`;
  }
  if (e.includes('divert')) {
    return `Safety policy triggered a diversion from original destination. Re-routing to nearest safe point. Remaining battery ${bat}. Payload integrity still within acceptable envelope.`;
  }
  if (e.includes('abort') || e.includes('emergency')) {
    return `Emergency condition detected. Mission aborted per safety policy. Battery ${bat}. Falling back to autonomous return-to-base or nearest safe landing zone.`;
  }
  if (e.includes('geofence')) {
    return `Geofence boundary crossed. Immediate lateral escape vector computed. Mission replanned to re-enter permitted airspace. Battery ${bat}.`;
  }
  if (e.includes('obstacle')) {
    return `Obstacle returned by onboard perception. Evaluating evasion vector: altitude change vs lateral deviation. Current battery ${bat} supports both options.`;
  }
  if (e.includes('landed') || e.includes('completed')) {
    return `Mission complete at ${loc}. Drone landed safely. Final battery ${bat}. Flight log closed and handed to metrics service for post-mission scoring.`;
  }
  return `Mission state advanced · ${entry.event}${entry.location ? ` at ${entry.location}` : ''}${typeof entry.battery === 'number' ? ` · battery ${bat}` : ''}.`;
}

function bearingToDegrees(rad: number): number {
  return (rad * 180) / Math.PI;
}

export function useSyntheticDecisions(): readonly AIDecisionEvent[] {
  const [decisions, setDecisions] = useState<AIDecisionEvent[]>([]);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const lidarBucketLastRef = useRef<Map<string, number>>(new Map());
  const lastMissionStatusRef = useRef<string>('');
  const mission = useMissionContext();

  const append = useCallback((batch: readonly AIDecisionEvent[]): void => {
    if (batch.length === 0) return;
    const fresh: AIDecisionEvent[] = [];
    batch.forEach((d) => {
      if (seenIdsRef.current.has(d.decision_id)) return;
      seenIdsRef.current.add(d.decision_id);
      fresh.push(d);
    });
    if (fresh.length === 0) return;
    setDecisions((prev) => [...prev, ...fresh].slice(-MAX_SYNTHETIC));
  }, []);

  // ── Source 1 — mission flight log ────────────────────────────────
  useEffect(() => {
    const log = mission.liveFlightLog as readonly FlightLogEntry[];
    if (log.length === 0) return;
    const batch: AIDecisionEvent[] = [];
    log.slice(-40).forEach((entry) => {
      const eventKey = entry.event.toLowerCase();
      // Hard-filter high-frequency telemetry noise so the DecisionStream
      // stays focused on meaningful reasoning moments.
      if (FLIGHT_LOG_SKIP.has(eventKey)) return;

      const tsSeconds = entry.timestamp;
      const id = `synth-flight-${Math.round(tsSeconds * 1000)}-${hashString(entry.event)}`;
      const intent = intentForEvent(entry.event);
      const curated = FLIGHT_LOG_CURATED.has(eventKey);
      const severity: AIDecisionSeverity =
        eventKey.includes('abort') || eventKey.includes('emergency') || eventKey.includes('geofence')
          ? 'error'
          : eventKey.includes('reroute') || eventKey.includes('divert') || eventKey.includes('obstacle')
            ? 'warning'
            : eventKey.includes('delivered') || eventKey.includes('completed') || eventKey.includes('landed')
              ? 'success'
              : 'info';

      batch.push({
        decision_id: id,
        intent,
        input: curated ? entry.event.replace(/_/g, ' ') : entry.event,
        reasoning: reasoningForFlightEvent(entry),
        decision: {
          event: entry.event,
          location: entry.location,
          battery: typeof entry.battery === 'number'
            ? Number(entry.battery.toFixed(1))
            : entry.battery,
        },
        latency_ms: null,
        model: SIM_MODEL_TAG,
        severity,
        timestamp: tsSeconds,
      });
    });
    append(batch);
  }, [mission.liveFlightLog, append]);

  // ── Source 2 — AI reasoning messages ─────────────────────────────
  useEffect(() => {
    const ai = mission.liveMission.aiReasoningMessages as unknown as readonly AIReasoningShape[];
    if (!Array.isArray(ai) || ai.length === 0) return;
    const batch: AIDecisionEvent[] = [];
    ai.slice(-10).forEach((msg) => {
      const text = msg.message ?? msg.content ?? '';
      if (!text) return;
      const tsSeconds = msg.timestamp ?? Date.now() / 1000;
      const id = `synth-ai-${Math.round(tsSeconds * 1000)}-${hashString(text.slice(0, 64))}`;
      batch.push({
        decision_id: id,
        intent: 'query',
        input: text.length > 120 ? `${text.slice(0, 120)}…` : text,
        reasoning: text,
        decision: {},
        latency_ms: null,
        model: SIM_MODEL_TAG,
        severity: severityFromMsg(msg.severity),
        timestamp: tsSeconds,
      });
    });
    append(batch);
  }, [mission.liveMission.aiReasoningMessages, append]);

  // ── Source 3 — safety monitor decisions ──────────────────────────
  useEffect(() => {
    const safety = mission.liveMission
      .safetyDecisions as unknown as readonly SafetyDecisionShape[];
    if (!Array.isArray(safety) || safety.length === 0) return;
    const batch: AIDecisionEvent[] = [];
    safety.slice(-10).forEach((s) => {
      const text = s.reason ?? s.decision ?? s.action ?? 'safety decision';
      const tsSeconds = s.timestamp ?? Date.now() / 1000;
      const id = `synth-safety-${Math.round(tsSeconds * 1000)}-${hashString(text.slice(0, 64))}`;
      batch.push({
        decision_id: id,
        intent: 'policy_fire',
        input: s.decision ?? 'safety policy evaluation',
        reasoning: text,
        decision: {
          action: s.action ?? null,
          reason: s.reason ?? null,
        },
        latency_ms: null,
        model: SIM_MODEL_TAG,
        severity: severityFromMsg(s.severity),
        timestamp: tsSeconds,
      });
    });
    append(batch);
  }, [mission.liveMission.safetyDecisions, append]);

  // ── Source 4 — mission status transitions ────────────────────────
  useEffect(() => {
    const status = mission.liveMission.missionStatus;
    if (!status) return;
    if (status === lastMissionStatusRef.current) return;
    const prev = lastMissionStatusRef.current || 'idle';
    lastMissionStatusRef.current = status;
    const tsSeconds = Date.now() / 1000;
    const id = `synth-phase-${Math.round(tsSeconds * 1000)}-${prev}-${status}`;
    append([
      {
        decision_id: id,
        intent: 'policy_fire',
        input: `Mission phase transition: ${prev} → ${status}`,
        reasoning:
          `The mission state machine advanced from ${prev} to ${status}. ` +
          `Triggered by live telemetry / scheduler tick. ` +
          `Downstream actions: HUD phase strip update, waypoint tracker advance, battery budget refresh.`,
        decision: { from: prev, to: status },
        latency_ms: null,
        model: SIM_MODEL_TAG,
        severity: 'info',
        timestamp: tsSeconds,
      },
    ]);
  }, [mission.liveMission.missionStatus, append]);

  // ── Source 5 — LiDAR obstacle clusters (debounced per bucket) ────
  useEffect(() => {
    const handler = (frame: LidarFrame): void => {
      const nowMs = frame.timestamp;
      const batch: AIDecisionEvent[] = [];
      frame.obstacles.forEach((obs) => {
        const bucket = obs.id.split('-')[1] ?? 'b0';
        const last = lidarBucketLastRef.current.get(bucket) ?? 0;
        if (nowMs - last < LIDAR_DEBOUNCE_MS) return;
        lidarBucketLastRef.current.set(bucket, nowMs);
        const tsSeconds = nowMs / 1000;
        const bearingDeg = bearingToDegrees(obs.bearing);
        batch.push({
          decision_id: `synth-lidar-${bucket}-${Math.round(nowMs)}`,
          intent: 'policy_fire',
          input: `LiDAR cluster detected · ${obs.label}`,
          reasoning:
            `Raycast produced a coherent return cluster at bearing ` +
            `${bearingDeg.toFixed(0)}° · range ${obs.distance.toFixed(1)}m. ` +
            `Severity tier: ${obs.severity}. ` +
            `Triggering proximity awareness policy · ${
              obs.severity === 'critical'
                ? 'recommend immediate hold or evasion.'
                : obs.severity === 'warning'
                  ? 'recommend speed reduction and heading review.'
                  : 'logging for situational awareness only.'
            }`,
          decision: {
            bucket,
            bearing_deg: bearingDeg,
            distance_m: obs.distance,
            severity: obs.severity,
          },
          latency_ms: null,
          model: SIM_MODEL_TAG,
          severity: severityFromObstacle(obs.severity),
          timestamp: tsSeconds,
        });
      });
      if (batch.length > 0) append(batch);
    };
    const unsubscribe = subscribeLidarFrame(handler);
    return unsubscribe;
  }, [append]);

  // ── Source 6 — client-side LLM decision bus ──────────────────────
  // Any module that performs a direct browser-side Claude call (llmChat,
  // llmParse in web/src/lib/api.ts) publishes onto this bus. Subscribing
  // here lets those real-LLM calls land in the DecisionStream alongside
  // mission-derived synthetic cards, without requiring a live backend.
  useEffect(() => {
    const unsubscribe = subscribeDecisions((decision) => {
      append([decision]);
    });
    return unsubscribe;
  }, [append]);

  return decisions;
}
