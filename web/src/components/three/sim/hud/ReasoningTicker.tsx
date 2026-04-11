// ReasoningTicker — scrolling footer that surfaces vision + mission
// reasoning from the unified context (flight log, AI reasoning, safety
// decisions) merged with live vision events from the backend /ws/vision
// stream.

import { useMemo } from 'react';
import { useSimCockpit, type ReasoningItem } from '../SimCockpitContext';
import { useVisionStream } from '../useVisionStream';

function iconForVision(verdict: string | undefined, source: string | undefined): string {
  if (verdict === 'abort') return '⛔';
  if (verdict === 'caution') return '⚠';
  if (source === 'fallback') return '◎';
  return '👁';
}

function colorForSeverity(
  severity: ReasoningItem['severity'] | undefined,
  kind: ReasoningItem['kind'],
): string {
  if (severity === 'critical') return 'text-red-200';
  if (severity === 'warning') return 'text-amber-200';
  if (kind === 'ai') return 'text-cyan-100';
  if (kind === 'safety') return 'text-cyan-200';
  if (kind === 'vision') return 'text-emerald-200';
  if (kind === 'lidar') return 'text-fuchsia-200';
  return 'text-white/85';
}

export function ReasoningTicker() {
  const { connection, reasoning } = useSimCockpit();
  const stream = useVisionStream();

  // Merge context reasoning + live vision events, sort by timestamp, keep last 10.
  const merged = useMemo<ReasoningItem[]>(() => {
    const visionItems: ReasoningItem[] = stream.events.slice(-10).map((ev, i) => ({
      id: `vision-${ev.timestamp}-${i}`,
      kind: 'vision' as const,
      text: `${iconForVision(ev.verdict, ev.source)} ${ev.scene_description || ev.reason || 'scene analyzed'}${
        ev.reason && ev.scene_description ? ` — ${ev.reason}` : ''
      }`,
      timestamp: ev.timestamp * 1000,
      severity:
        ev.verdict === 'abort'
          ? ('critical' as const)
          : ev.verdict === 'caution'
            ? ('warning' as const)
            : ('info' as const),
    }));
    const all = [...reasoning, ...visionItems];
    all.sort((a, b) => a.timestamp - b.timestamp);
    return all.slice(-10);
  }, [reasoning, stream.events]);

  return (
    <div className="pointer-events-none absolute bottom-24 left-1/2 -translate-x-1/2 flex w-full max-w-[540px] justify-center px-2">
      <div className="flex w-full max-w-[540px] flex-col gap-1 rounded-xl border border-white/10 bg-black/45 px-4 py-2 text-[11px] backdrop-blur-md">
        <div className="flex items-center gap-2 text-[9px] uppercase tracking-[0.25em] text-cyan-200/80">
          <span>AI reasoning</span>
          <span className="text-white/30">·</span>
          <span className="text-white/50">{connection}</span>
          <span className="text-white/30">·</span>
          <span className="text-white/50">{merged.length} events</span>
        </div>
        {merged.length === 0 ? (
          <span className="text-white/45">
            awaiting mission events and vision analysis…
          </span>
        ) : (
          merged.map((item) => (
            <div
              key={item.id}
              className="flex items-baseline gap-2 overflow-hidden"
            >
              <span
                className={`truncate ${colorForSeverity(item.severity, item.kind)}`}
              >
                {item.text}
              </span>
              <span className="ml-auto shrink-0 font-mono text-[9px] text-white/30">
                {new Date(item.timestamp).toLocaleTimeString()}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
