// DebugOverlay — raw telemetry + FPS counter + quality tier controls.
// Toggled with `~` via useSimHotkeys.

import { useEffect, useRef, useState } from 'react';
import { useSimCockpit } from '../SimCockpitContext';

export function DebugOverlay() {
  const { debugOpen, telemetry, qualityTier, setQualityTier, connection } =
    useSimCockpit();
  const [fps, setFps] = useState(0);
  const frames = useRef(0);
  const lastSample = useRef<number>(0);

  useEffect(() => {
    if (!debugOpen) return;
    lastSample.current = performance.now();
    let raf = 0;
    const loop = () => {
      frames.current += 1;
      const now = performance.now();
      if (now - lastSample.current >= 1000) {
        setFps(frames.current);
        frames.current = 0;
        lastSample.current = now;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [debugOpen]);

  if (!debugOpen) return null;

  return (
    <div className="pointer-events-auto absolute right-4 top-20 w-64 rounded-lg border border-white/10 bg-black/60 p-3 font-mono text-[10px] text-white/80 backdrop-blur-md">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-cyan-200 uppercase tracking-[0.2em]">Debug</span>
        <span className="text-white/50">{fps} fps</span>
      </div>
      <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
        <span className="text-white/40">lat</span>
        <span>{telemetry?.lat?.toFixed(6) ?? '—'}</span>
        <span className="text-white/40">lon</span>
        <span>{telemetry?.lon?.toFixed(6) ?? '—'}</span>
        <span className="text-white/40">abs alt</span>
        <span>{telemetry?.alt_m?.toFixed(1) ?? '—'} m</span>
        <span className="text-white/40">rel alt</span>
        <span>{telemetry?.relative_alt_m?.toFixed(1) ?? '—'} m</span>
        <span className="text-white/40">heading</span>
        <span>{telemetry?.heading_deg?.toFixed(1) ?? '—'}°</span>
        <span className="text-white/40">speed</span>
        <span>{telemetry?.speed_m_s?.toFixed(2) ?? '—'} m/s</span>
        <span className="text-white/40">armed</span>
        <span>{telemetry?.is_armed ? 'yes' : 'no'}</span>
        <span className="text-white/40">flying</span>
        <span>{telemetry?.is_flying ? 'yes' : 'no'}</span>
        <span className="text-white/40">mode</span>
        <span>{telemetry?.flight_mode ?? '—'}</span>
        <span className="text-white/40">source</span>
        <span>{telemetry?.source ?? '—'}</span>
        <span className="text-white/40">link</span>
        <span>{connection}</span>
      </div>
      <div className="mt-2 flex items-center gap-1 border-t border-white/10 pt-2 text-[10px] uppercase">
        <span className="text-white/40">fx</span>
        {(['high', 'medium', 'low'] as const).map((tier) => (
          <button
            key={tier}
            type="button"
            onClick={() => setQualityTier(tier)}
            className={`rounded px-1.5 py-0.5 tracking-widest ${
              tier === qualityTier
                ? 'bg-cyan-400/30 text-cyan-100'
                : 'text-white/50 hover:text-white'
            }`}
          >
            {tier}
          </button>
        ))}
      </div>
    </div>
  );
}
