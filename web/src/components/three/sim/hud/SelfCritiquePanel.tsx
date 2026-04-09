// SelfCritiquePanel — collapsible full-text LLM critique, appearing to the
// right of the POV feed. Shows the latest + a short history.

import { useState } from 'react';
import { useVisionStream } from '../useVisionStream';

export function SelfCritiquePanel() {
  const { events, latest } = useVisionStream();
  const [expanded, setExpanded] = useState(false);

  if (!latest && events.length === 0) return null;

  return (
    <div className="pointer-events-auto absolute right-4 top-32 w-80 rounded-lg border border-white/10 bg-black/55 p-3 text-[11px] text-white/85 backdrop-blur-md">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[9px] uppercase tracking-[0.25em] text-cyan-200">
          Self critique
        </span>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-[10px] text-white/50 hover:text-white"
        >
          {expanded ? 'collapse' : 'history'}
        </button>
      </div>
      {latest && (
        <div className="space-y-1">
          <div className="leading-snug text-white">
            {latest.scene_description || 'Scene analyzed.'}
          </div>
          {latest.reason && (
            <div className="text-white/60">“{latest.reason}”</div>
          )}
          <div className="flex items-center gap-2 text-[9px] uppercase tracking-[0.2em] text-white/50">
            <span>
              verdict:{' '}
              <span
                className={
                  latest.verdict === 'abort'
                    ? 'text-red-300'
                    : latest.verdict === 'caution'
                      ? 'text-amber-300'
                      : 'text-emerald-300'
                }
              >
                {latest.verdict}
              </span>
            </span>
            <span>confidence: {Math.round((latest.confidence || 0) * 100)}%</span>
          </div>
        </div>
      )}
      {expanded && (
        <ul className="mt-2 max-h-48 space-y-1 overflow-auto border-t border-white/10 pt-2 text-[10px] text-white/60">
          {events
            .slice(-12)
            .reverse()
            .map((ev, i) => (
              <li key={i} className="flex gap-1">
                <span className="text-white/30">
                  {new Date(ev.timestamp * 1000).toLocaleTimeString()}
                </span>
                <span className="flex-1 truncate">
                  {ev.scene_description || ev.reason || '—'}
                </span>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
