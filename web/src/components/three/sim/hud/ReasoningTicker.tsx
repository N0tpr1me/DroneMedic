// ReasoningTicker — scrolling footer that surfaces vision + mission reasoning.
// Pulls from the SimCockpit context's vision event buffer.

import { useSimCockpit } from '../SimCockpitContext';
import { useVisionStream } from '../useVisionStream';

function iconFor(source: string | undefined, verdict: string | undefined): string {
  if (verdict === 'abort') return '⛔';
  if (verdict === 'caution') return '⚠';
  if (source === 'fallback') return '◎';
  return '👁';
}

export function ReasoningTicker() {
  const { connection } = useSimCockpit();
  const stream = useVisionStream();
  const visible = stream.events.slice(-8);

  return (
    <div className="pointer-events-none absolute bottom-16 left-4 right-4 flex justify-center">
      <div className="flex max-w-[80%] flex-col gap-1 rounded-xl border border-white/10 bg-black/45 px-4 py-2 text-[11px] backdrop-blur-md">
        <div className="flex items-center gap-2 text-[9px] uppercase tracking-[0.25em] text-cyan-200/80">
          <span>AI reasoning</span>
          <span className="text-white/30">·</span>
          <span className="text-white/50">{connection}</span>
        </div>
        {visible.length === 0 ? (
          <span className="text-white/45">
            awaiting vision analysis…
          </span>
        ) : (
          visible.map((ev, i) => (
            <div
              key={`${ev.timestamp}-${i}`}
              className="flex items-baseline gap-2 text-white/85"
            >
              <span>{iconFor(ev.source, ev.verdict)}</span>
              <span
                className={
                  ev.verdict === 'abort'
                    ? 'text-red-200'
                    : ev.verdict === 'caution'
                      ? 'text-amber-200'
                      : 'text-cyan-100'
                }
              >
                {ev.scene_description || ev.reason || 'scene analyzed'}
              </span>
              {ev.reason && ev.scene_description && (
                <span className="text-white/50">— {ev.reason}</span>
              )}
              <span className="ml-auto text-white/30">
                {new Date(ev.timestamp * 1000).toLocaleTimeString()}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
