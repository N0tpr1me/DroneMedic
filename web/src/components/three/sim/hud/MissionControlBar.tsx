// MissionControlBar — compact command bar under LiveStatusPill giving
// the operator direct TAKEOFF / RUN MISSION / HOLD / LAND buttons.
// All commands flow through useSimCommands → useUnifiedTelemetry which
// routes to whichever telemetry tier is currently live.

import { useSimCommands } from '../useSimCommands';
import { useSimCockpit } from '../SimCockpitContext';

interface ButtonDef {
  id: 'takeoff' | 'mission' | 'hold' | 'land';
  label: string;
  icon: string;
  action: () => Promise<void>;
  color: string;
}

export function MissionControlBar() {
  const { telemetry, source, missionPhase } = useSimCockpit();
  const cmd = useSimCommands();

  // Disable individual buttons based on current state so the operator
  // can't fire nonsense commands.
  const isAirborne = telemetry?.is_flying === true;
  const canTakeoff = !isAirborne && !cmd.busy;
  const canHold = isAirborne && !cmd.busy;
  const canLand = isAirborne && !cmd.busy;
  const canRun = source !== 'offline' && !cmd.busy;

  const buttons: ButtonDef[] = [
    {
      id: 'takeoff',
      label: 'TAKEOFF',
      icon: '▲',
      action: cmd.takeoff,
      color: '#74f4b8',
    },
    {
      id: 'mission',
      label: 'RUN',
      icon: '▶',
      action: cmd.runMission,
      color: '#00e6ff',
    },
    {
      id: 'hold',
      label: 'HOLD',
      icon: '⏸',
      action: cmd.hold,
      color: '#f8d25c',
    },
    {
      id: 'land',
      label: 'LAND',
      icon: '▼',
      action: cmd.land,
      color: '#ff9c6e',
    },
  ];

  const isDisabled = (id: ButtonDef['id']) => {
    if (id === 'takeoff') return !canTakeoff;
    if (id === 'mission') return !canRun;
    if (id === 'hold') return !canHold;
    if (id === 'land') return !canLand;
    return false;
  };

  return (
    <div className="pointer-events-auto absolute left-4 top-[200px] flex max-w-[260px] flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1 rounded-md border border-white/10 bg-black/50 p-1 backdrop-blur-md">
        {buttons.map((b) => {
          const disabled = isDisabled(b.id);
          return (
            <button
              key={b.id}
              type="button"
              onClick={b.action}
              disabled={disabled}
              className={`flex min-w-0 items-center gap-1 rounded px-1.5 py-1 text-[10px] font-semibold uppercase tracking-[0.15em] transition-all ${
                disabled
                  ? 'cursor-not-allowed text-white/25'
                  : 'text-white/90 hover:bg-white/10'
              }`}
              style={{
                color: disabled ? undefined : b.color,
              }}
              title={disabled ? `${b.label} unavailable` : b.label}
              aria-label={b.label}
            >
              <span className="text-sm leading-none">{b.icon}</span>
              <span className="truncate">{b.label}</span>
            </button>
          );
        })}
      </div>
      {cmd.lastError && (
        <div className="rounded border border-red-400/40 bg-red-500/10 px-2 py-1 text-[9px] uppercase tracking-[0.15em] text-red-200">
          {cmd.lastError}
        </div>
      )}
      {cmd.busy && (
        <div className="rounded border border-cyan-400/30 bg-cyan-500/10 px-2 py-1 text-[9px] uppercase tracking-[0.15em] text-cyan-200">
          dispatching…
        </div>
      )}
      <div className="rounded border border-white/10 bg-black/30 px-2 py-0.5 text-[9px] uppercase tracking-[0.15em] text-white/50 backdrop-blur">
        phase: <span className="text-white/80">{missionPhase}</span>
      </div>
    </div>
  );
}
