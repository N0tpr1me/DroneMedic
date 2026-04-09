// CameraPresetBar — 5 buttons mapped to the CameraRig presets.
// Keys 1-5 also trigger them via useSimHotkeys.

import { useSimCockpit, type CameraPreset } from '../SimCockpitContext';

const PRESETS: { id: CameraPreset; label: string; key: string; icon: string }[] = [
  { id: 'chase', label: 'Chase', key: '1', icon: '◣' },
  { id: 'cockpit', label: 'Cockpit', key: '2', icon: '◆' },
  { id: 'topdown', label: 'Top', key: '3', icon: '▣' },
  { id: 'cinematic', label: 'Cinema', key: '4', icon: '◉' },
  { id: 'free', label: 'Free', key: '5', icon: '◯' },
];

export function CameraPresetBar() {
  const { cameraPreset, setCameraPreset } = useSimCockpit();
  return (
    <div className="pointer-events-auto absolute right-4 top-1/2 flex -translate-y-1/2 flex-col gap-2">
      {PRESETS.map((preset) => {
        const active = cameraPreset === preset.id;
        return (
          <button
            key={preset.id}
            type="button"
            onClick={() => setCameraPreset(preset.id)}
            className={`flex min-w-[64px] items-center gap-2 rounded-md border px-2 py-1.5 text-[10px] uppercase tracking-[0.2em] backdrop-blur-md transition-all ${
              active
                ? 'border-cyan-300/60 bg-cyan-400/15 text-cyan-100 shadow-[0_0_12px_#00daf366]'
                : 'border-white/10 bg-black/40 text-white/70 hover:text-white'
            }`}
          >
            <span className="text-sm">{preset.icon}</span>
            <span className="flex-1 text-left">{preset.label}</span>
            <span className="text-[9px] text-white/40">{preset.key}</span>
          </button>
        );
      })}
    </div>
  );
}
