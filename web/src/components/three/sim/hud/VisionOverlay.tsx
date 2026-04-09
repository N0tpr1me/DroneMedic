// VisionOverlay — transparent overlay above the POVFeed that labels
// whatever the LLM saw in the latest frame. No real bounding box coords
// come back from the LLM so we approximate with stacked labels.

import type { VisionEvent } from '../useVisionStream';

interface Props {
  latest: VisionEvent | null;
}

export function VisionOverlay({ latest }: Props) {
  if (!latest) return null;
  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-2 text-[10px]">
      <div className="flex flex-wrap gap-1">
        {latest.obstacles.slice(0, 4).map((obs, i) => (
          <span
            key={`${obs.label}-${i}`}
            className="rounded-sm border border-red-300/40 bg-red-500/10 px-1.5 py-0.5 font-mono text-red-200"
          >
            {obs.label}
            {obs.confidence !== undefined
              ? ` (${Math.round(obs.confidence * 100)}%)`
              : ''}
          </span>
        ))}
      </div>
      <div className="self-start rounded border border-cyan-300/40 bg-black/60 px-2 py-1 font-mono text-cyan-100">
        verdict: {latest.verdict}
        {latest.confidence > 0 && (
          <span className="ml-1 text-white/50">
            ({Math.round(latest.confidence * 100)}%)
          </span>
        )}
      </div>
    </div>
  );
}
