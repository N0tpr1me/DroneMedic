// useSimCommands — convenience wrapper around useUnifiedTelemetry's
// sendCommand dispatcher. Exposes named methods for the MissionControlBar
// HUD and handles the "RUN MISSION" path which has to call the backend
// directly (to kick off the full scheduler pipeline) rather than dispatch
// through the telemetry bridge.

import { useCallback, useState } from 'react';
import { useSimCockpit } from './SimCockpitContext';
import { backendHttpUrl } from '../../../lib/backendUrls';

export interface SimCommandState {
  takeoff: () => Promise<void>;
  runMission: () => Promise<void>;
  hold: () => Promise<void>;
  land: () => Promise<void>;
  busy: boolean;
  lastError: string | null;
}

interface PlannedMission {
  id: string;
  status: string;
}

async function fetchLatestPlannedMission(): Promise<string | null> {
  try {
    const res = await fetch(backendHttpUrl('/api/missions?status=planned'));
    if (!res.ok) return null;
    const data: unknown = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;
    const first = data[0] as PlannedMission;
    return first?.id ?? null;
  } catch {
    return null;
  }
}

async function startMissionOnBackend(missionId: string): Promise<boolean> {
  try {
    const res = await fetch(
      backendHttpUrl(`/api/missions/${missionId}/start`),
      { method: 'POST' },
    );
    return res.ok;
  } catch {
    return false;
  }
}

export function useSimCommands(): SimCommandState {
  const { sendCommand, source } = useSimCockpit();
  const [busy, setBusy] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  const guard = useCallback(
    async (fn: () => Promise<void>): Promise<void> => {
      if (busy) return;
      setBusy(true);
      setLastError(null);
      try {
        await fn();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setLastError(msg);
      } finally {
        setBusy(false);
      }
    },
    [busy],
  );

  const takeoff = useCallback(
    () => guard(async () => sendCommand({ type: 'takeoff' })),
    [guard, sendCommand],
  );

  const hold = useCallback(
    () => guard(async () => sendCommand({ type: 'hold' })),
    [guard, sendCommand],
  );

  const land = useCallback(
    () => guard(async () => sendCommand({ type: 'land' })),
    [guard, sendCommand],
  );

  const runMission = useCallback(
    () =>
      guard(async () => {
        // For live-vm and mock tiers: ask the backend to start the latest
        // planned mission (the scheduler drives PX4 via DroneController).
        // For the physics tier: the dashboard's ChatPanel / Deploy page is
        // the path that calls dispatchDelivery — we can't start a mission
        // from here without a planned route in hand. Best-effort: call the
        // backend anyway so if the user has a planned mission it fires.
        const missionId = await fetchLatestPlannedMission();
        if (missionId) {
          const ok = await startMissionOnBackend(missionId);
          if (!ok) {
            throw new Error(`backend refused /api/missions/${missionId}/start`);
          }
          return;
        }

        // Fallback: telemetry-bridge style start_mission (mock source only).
        if (source === 'mock' || source === 'live-vm') {
          await sendCommand({ type: 'run_mission' });
          return;
        }

        throw new Error(
          'no planned mission available and physics tier can\'t self-start',
        );
      }),
    [guard, sendCommand, source],
  );

  return { takeoff, runMission, hold, land, busy, lastError };
}
