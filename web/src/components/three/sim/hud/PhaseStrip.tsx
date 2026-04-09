// PhaseStrip — horizontal stepper showing the drone's current mission phase.
// Phase is derived from telemetry in SimCockpitContext (no extra API calls).

import { useSimCockpit, type MissionPhase } from '../SimCockpitContext';

const PHASES: { id: MissionPhase; label: string }[] = [
  { id: 'idle', label: 'IDLE' },
  { id: 'armed', label: 'ARMED' },
  { id: 'takeoff', label: 'TAKEOFF' },
  { id: 'enroute', label: 'EN-ROUTE' },
  { id: 'delivering', label: 'DELIVERING' },
  { id: 'returning', label: 'RETURNING' },
  { id: 'landed', label: 'LANDED' },
];

export function PhaseStrip() {
  const { missionPhase } = useSimCockpit();
  const currentIdx = PHASES.findIndex((p) => p.id === missionPhase);

  return (
    <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2">
      <div className="flex items-center gap-2 rounded-full border border-white/10 bg-black/50 px-4 py-1.5 backdrop-blur-md">
        {PHASES.map((phase, idx) => {
          const isDone = idx < currentIdx;
          const isActive = idx === currentIdx;
          return (
            <div key={phase.id} className="flex items-center gap-2">
              <div
                className={`relative flex h-5 items-center rounded-full px-2.5 text-[10px] uppercase tracking-[0.2em] transition-all ${
                  isActive
                    ? 'bg-cyan-400/20 text-cyan-200 shadow-[0_0_12px_#00daf366]'
                    : isDone
                      ? 'text-white/70'
                      : 'text-white/30'
                }`}
              >
                {isActive && (
                  <span className="absolute -left-1 h-1.5 w-1.5 animate-ping rounded-full bg-cyan-300" />
                )}
                {phase.label}
              </div>
              {idx < PHASES.length - 1 && (
                <div
                  className={`h-px w-4 transition-colors ${
                    idx < currentIdx ? 'bg-cyan-300/80' : 'bg-white/10'
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
