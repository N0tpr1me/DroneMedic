// useUnifiedTelemetry — resolves drone telemetry from a three-tier priority
// chain and exposes a command dispatcher keyed to whichever tier is live:
//
//   1. live-vm  — backend /ws/px4 proxy → Gazebo PX4 SITL on the VM
//   2. physics  — MissionContext.fleetPhysics (in-browser multi-drone sim)
//   3. mock     — local telemetry_bridge.py on ws://localhost:8765
//
// The sim cockpit calls this hook once and passes the result into
// SimCockpitProvider; all downstream HUD widgets + the 3D scene consume
// the same unified telemetry without knowing where it came from.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePX4Telemetry, type PX4Telemetry } from '../../../hooks/usePX4Telemetry';
import { useMissionContext } from '../../../context/MissionContext';
import type { DroneTelemetry } from '../../../hooks/useFleetPhysics';

export type TelemetrySource =
  | 'live-vm'
  | 'physics'
  | 'mock'
  | 'offline';

export type DroneCommand =
  | { type: 'takeoff'; altitude?: number }
  | { type: 'goto'; lat: number; lon: number; alt: number }
  | { type: 'hold' }
  | { type: 'land' }
  | { type: 'run_mission'; missionId?: string };

export interface UnifiedTelemetry {
  telemetry: PX4Telemetry | null;
  source: TelemetrySource;
  /** Milliseconds since the last live-vm frame; null if none arrived yet. */
  lastVmFrameAgeMs: number | null;
  sendCommand: (cmd: DroneCommand) => Promise<void>;
}

// Max age of the last /ws/px4 frame before we consider the VM "stale" and
// fall through to the physics tier. Keeps a short hysteresis so a single
// dropped packet doesn't flip the source.
const VM_STALE_MS = 2500;

/** Convert a fleetPhysics telemetry snapshot into a PX4Telemetry frame. */
function physicsToPx4(
  droneId: string,
  tel: DroneTelemetry | null,
): PX4Telemetry | null {
  if (!tel) return null;
  const flightMode =
    tel.phase === 'takeoff'
      ? 'TAKEOFF'
      : tel.phase === 'landing'
        ? 'LAND'
        : tel.phase === 'cruise'
          ? 'MISSION'
          : tel.phase === 'hover' || tel.phase === 'hold'
            ? 'HOLD'
            : tel.phase === 'preflight'
              ? 'IDLE'
              : tel.phase?.toUpperCase() ?? 'UNKNOWN';

  return {
    lat: tel.lat,
    lon: tel.lon,
    alt_m: tel.alt,
    relative_alt_m: tel.alt,
    battery_pct: tel.battery_pct,
    flight_mode: flightMode,
    is_armed: tel.missionActive || tel.phase !== 'preflight',
    is_flying: tel.missionActive && tel.alt > 1,
    heading_deg: tel.heading,
    // Use the same field the dashboard reads (`tel.speed_ms`) so the sim
    // HUD and the dashboard HUD show the same km/h value. `ground_speed_ms`
    // drops the vertical component and produced a visible 8km/h vs 44km/h
    // delta between the two views.
    speed_m_s: tel.speed_ms,
    timestamp: Date.now() / 1000,
    source: 'mock',
    drone_id: droneId,
  };
}

/**
 * Core telemetry resolver. Subscribes to both live-vm (via usePX4Telemetry)
 * and in-browser physics; picks the highest-priority source that has fresh
 * data, and routes commands to that same tier.
 */
export function useUnifiedTelemetry(): UnifiedTelemetry {
  const px4 = usePX4Telemetry();
  const mission = useMissionContext();

  // Freshness signal: derive from the telemetry frame's own timestamp (set
  // by telemetry_bridge.py before send). `usePX4Telemetry.connected` flips
  // false when the WS drops; combined with the timestamp delta this is a
  // pure, render-safe check (no Date.now() during render).
  //
  // This tick ALSO acts as the physics-tier re-capture driver — in physics
  // mode, fleetPhysics mutates its internal state at 30 Hz but the React
  // tree has no dep change to signal that, so the useMemo below would keep
  // returning a stale snapshot. Gating the memo on `nowMs` forces a fresh
  // physicsToPx4() conversion every tick, which keeps the HUD clock, battery,
  // and altitude in sync with the dashboard (which reads fleetPhysics directly).
  const [nowMs, setNowMs] = useState(0);
  useEffect(() => {
    const tick = () => setNowMs(Date.now());
    tick();
    const id = window.setInterval(tick, 100);
    return () => window.clearInterval(id);
  }, []);

  const frameTimestampMs = px4.telemetry?.timestamp
    ? px4.telemetry.timestamp * 1000
    : null;
  const lastVmFrameAgeMs =
    frameTimestampMs != null && nowMs ? Math.abs(nowMs - frameTimestampMs) : null;

  // Resolve source tier + active telemetry frame.
  const { telemetry, source } = useMemo<{
    telemetry: PX4Telemetry | null;
    source: TelemetrySource;
  }>(() => {
    // 1. live-vm — WebSocket frames fresh within VM_STALE_MS
    if (
      px4.telemetry &&
      px4.source === 'px4' &&
      px4.connected &&
      lastVmFrameAgeMs !== null &&
      lastVmFrameAgeMs < VM_STALE_MS
    ) {
      return {
        telemetry: { ...px4.telemetry, source: 'px4' as const },
        source: 'live-vm' as const,
      };
    }

    // 2. physics — convert fleetPhysics telemetry to PX4 shape
    const activeDroneId =
      mission.activeDroneId ?? mission.fleetPhysics.getDroneMapData()[0]?.id ?? null;
    if (activeDroneId) {
      const tel = mission.fleetPhysics.getTelemetry(activeDroneId);
      if (tel) {
        return {
          telemetry: physicsToPx4(activeDroneId, tel),
          source: 'physics' as const,
        };
      }
    }

    // 3. mock — usePX4Telemetry already tagged this as 'mock'
    if (px4.telemetry && px4.source === 'mock') {
      return {
        telemetry: { ...px4.telemetry, source: 'mock' as const },
        source: 'mock' as const,
      };
    }

    // Nothing live.
    return { telemetry: null, source: 'offline' as const };
  }, [
    px4.telemetry,
    px4.source,
    px4.connected,
    lastVmFrameAgeMs,
    mission.activeDroneId,
    mission.fleetPhysics,
    // Include nowMs so the useMemo re-runs on every 250ms tick and re-captures
    // fleetPhysics telemetry in physics mode. Without this the snapshot stays
    // frozen at mount time and the HUD reports "stale 289s" even though the
    // physics sim is running fine.
    nowMs,
  ]);

  // Command dispatcher — routes to the right tier.
  const sendCommand = useCallback(
    async (cmd: DroneCommand): Promise<void> => {
      // Route by current source — same-tier dispatch so the drone that's
      // being simulated is the drone that receives the command.
      if (source === 'live-vm' || source === 'mock') {
        // telemetry_bridge.py accepts {cmd, lat, lon, alt}
        const payload = (() => {
          switch (cmd.type) {
            case 'takeoff':
              return { cmd: 'takeoff' };
            case 'goto':
              return { cmd: 'goto', lat: cmd.lat, lon: cmd.lon, alt: cmd.alt };
            case 'hold':
              return { cmd: 'hold' };
            case 'land':
              return { cmd: 'land' };
            case 'run_mission':
              // VM path: start_mission triggers the mock mission loop;
              // real PX4 requires a backend POST which the caller handles.
              return { cmd: 'start_mission' };
          }
        })();
        px4.sendCommand(payload as Record<string, unknown>);
        return;
      }

      // physics tier — drive fleetPhysics directly
      if (source === 'physics' || source === 'offline') {
        const fleet = mission.fleetPhysics;
        switch (cmd.type) {
          case 'takeoff': {
            // Physics sim's takeoff is bundled into dispatchDrone; for a
            // bare takeoff command we dispatch to the depot itself so the
            // drone climbs and hovers.
            const droneId = mission.activeDroneId ?? fleet.getDroneMapData()[0]?.id;
            if (droneId) {
              fleet.dispatchDrone(
                droneId,
                [{ lat: 51.5074, lon: -0.1278, name: 'Depot' }],
                1.0,
              );
            }
            return;
          }
          case 'hold':
            // Physics engine doesn't have hold; pause instead via
            // missionStatus — caller should use the dashboard pause path.
            return;
          case 'land': {
            const landId = mission.activeDroneId ?? fleet.getDroneMapData()[0]?.id;
            if (landId) {
              fleet.landDrone(landId);
            }
            return;
          }
          case 'goto':
          case 'run_mission':
            // Missions are orchestrated via dispatchDelivery in MissionContext
            // — the UI should call that path directly, not this dispatcher.
            return;
        }
      }
    },
    [source, px4, mission.fleetPhysics, mission.activeDroneId],
  );

  return {
    telemetry,
    source,
    lastVmFrameAgeMs,
    sendCommand,
  };
}
