// HelpCard — keyboard shortcut cheatsheet. Toggled with `?`.

import { useSimCockpit } from '../SimCockpitContext';

const ROWS: [string, string][] = [
  ['1–5', 'Camera presets'],
  ['C', 'Cycle camera'],
  ['Space', 'Pause playback'],
  ['F', 'Fullscreen'],
  ['~', 'Toggle debug'],
  ['?', 'Toggle this help'],
  ['Esc', 'Close panel'],
];

export function HelpCard() {
  const { helpOpen, setHelpOpen } = useSimCockpit();
  if (!helpOpen) return null;
  return (
    <div className="pointer-events-auto absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
      <div className="w-80 rounded-xl border border-white/15 bg-black/75 p-5 text-white backdrop-blur-md">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm uppercase tracking-[0.25em] text-cyan-200">
            Shortcuts
          </span>
          <button
            type="button"
            onClick={() => setHelpOpen(false)}
            className="text-white/60 hover:text-white"
          >
            ×
          </button>
        </div>
        <ul className="space-y-1 text-[12px]">
          {ROWS.map(([key, label]) => (
            <li key={key} className="flex items-center justify-between">
              <span className="text-white/70">{label}</span>
              <kbd className="rounded border border-white/20 bg-white/10 px-1.5 py-0.5 font-mono text-[10px]">
                {key}
              </kbd>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
