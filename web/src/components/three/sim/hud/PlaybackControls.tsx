// PlaybackControls — visual playback rate controls. They do NOT affect the
// upstream WebSocket (telemetry keeps flowing); they only affect the render
// loop multiplier consumed by CameraRig and Drone lerps.

import { useSimCockpit } from '../SimCockpitContext';

const SPEEDS: Array<1 | 2 | 4> = [1, 2, 4];

export function PlaybackControls() {
  const { playback, setPlayback } = useSimCockpit();

  return (
    <div className="pointer-events-auto absolute bottom-4 left-4 flex items-center gap-2 rounded-lg border border-white/10 bg-black/45 px-2 py-1.5 backdrop-blur-md">
      <button
        type="button"
        onClick={() => setPlayback((p) => ({ ...p, paused: !p.paused }))}
        className="rounded px-2 py-0.5 text-[11px] uppercase tracking-widest text-white/80 hover:text-white"
      >
        {playback.paused ? '▶ play' : '❚❚ pause'}
      </button>
      <div className="h-3 w-px bg-white/10" />
      {SPEEDS.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => setPlayback((p) => ({ ...p, speed: s }))}
          className={`rounded px-2 py-0.5 text-[11px] uppercase tracking-widest transition-colors ${
            playback.speed === s
              ? 'bg-cyan-400/20 text-cyan-100'
              : 'text-white/60 hover:text-white'
          }`}
        >
          {s}×
        </button>
      ))}
    </div>
  );
}
