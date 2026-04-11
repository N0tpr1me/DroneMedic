// LiveStatusPill — small badge at the top of the 3D panel that shows the
// current connection source + a live sim clock.

import { useSyncExternalStore } from 'react';
import { useSimCockpit } from '../SimCockpitContext';
import { useLidarStream } from '../useLidarStream';

// External tick store — re-renders subscribed components twice per second
// without calling Date.now() during React render.
const tickSubscribers = new Set<() => void>();
let tickValue = 0;
if (typeof window !== 'undefined') {
  window.setInterval(() => {
    tickValue = Date.now();
    tickSubscribers.forEach((fn) => fn());
  }, 500);
}
function subscribeTick(listener: () => void): () => void {
  tickSubscribers.add(listener);
  return () => tickSubscribers.delete(listener);
}
function getTick(): number {
  return tickValue;
}

function labelFor(source: string): { label: string; color: string } {
  switch (source) {
    case 'live-vm':
      return { label: 'LIVE · GAZEBO VM', color: '#74f4b8' };
    case 'mock':
      return { label: 'MOCK TELEMETRY', color: '#f8d25c' };
    case 'physics':
      return { label: 'BROWSER PHYSICS', color: '#b3c5ff' };
    case 'alert':
      return { label: 'ALERT', color: '#ff6a6a' };
    case 'reconnecting':
      return { label: 'RECONNECTING…', color: '#ff9c3c' };
    default:
      return { label: 'OFFLINE', color: '#ff6a6a' };
  }
}

export function LiveStatusPill() {
  const { connection, telemetry, tilesAvailable, alerts, missionProgress } =
    useSimCockpit();
  const lidar = useLidarStream();
  const now = useSyncExternalStore(subscribeTick, getTick, getTick);

  const src = labelFor(connection);
  const simTime = telemetry?.timestamp ? new Date(telemetry.timestamp * 1000) : null;
  const ageMs = telemetry?.timestamp && now
    ? now - telemetry.timestamp * 1000
    : null;
  const topAlert = alerts.length > 0 ? alerts[alerts.length - 1] : null;

  return (
    <div className="pointer-events-none absolute left-1/2 top-4 flex -translate-x-1/2 items-center gap-3">
      <div
        className="flex items-center gap-2 rounded-full border border-white/10 bg-black/50 px-3 py-1 text-[11px] uppercase tracking-[0.25em] backdrop-blur-md"
        style={{ color: src.color }}
      >
        <span
          className="inline-block h-1.5 w-1.5 animate-pulse rounded-full"
          style={{ backgroundColor: src.color, boxShadow: `0 0 8px ${src.color}` }}
        />
        {src.label}
      </div>
      {simTime && (
        <div className="rounded-full border border-white/10 bg-black/50 px-3 py-1 text-[10px] font-mono text-white/70 backdrop-blur-md">
          {simTime.toISOString().slice(11, 19)}Z
          {ageMs !== null && ageMs > 2000 && (
            <span className="ml-2 text-amber-300">
              stale {(ageMs / 1000).toFixed(0)}s
            </span>
          )}
        </div>
      )}
      {missionProgress > 0 && missionProgress < 100 && (
        <div className="rounded-full border border-white/10 bg-black/50 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-white/80 backdrop-blur-md">
          {missionProgress}% mission
        </div>
      )}
      {!tilesAvailable && (
        <div className="rounded-full border border-amber-300/30 bg-amber-500/10 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-amber-200 backdrop-blur-md">
          PROCEDURAL VIEW
        </div>
      )}
      {lidar.source !== 'off' && lidar.obstacleCount > 0 && (
        <div
          className={`rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.2em] backdrop-blur-md ${
            lidar.obstacles.some((o) => o.severity === 'critical')
              ? 'border-red-400/50 bg-red-500/15 text-red-200'
              : 'border-fuchsia-300/40 bg-fuchsia-500/10 text-fuchsia-200'
          }`}
          title="Nearby obstacles detected by LiDAR"
        >
          LIDAR · {lidar.obstacleCount} obstacle
          {lidar.obstacleCount === 1 ? '' : 's'}
        </div>
      )}
      {topAlert && (
        <div
          className={`max-w-[260px] truncate rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.2em] backdrop-blur-md ${
            topAlert.severity === 'critical'
              ? 'border-red-400/50 bg-red-500/15 text-red-200'
              : 'border-amber-300/30 bg-amber-500/10 text-amber-200'
          }`}
          title={topAlert.message}
        >
          ⚠ {topAlert.message}
        </div>
      )}
    </div>
  );
}
