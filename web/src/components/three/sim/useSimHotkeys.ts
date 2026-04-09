// Hotkey handler for the 3D sim panel. Scoped to when the panel is
// mounted; listeners are removed on unmount.

import { useEffect } from 'react';
import { useSimCockpit, type CameraPreset } from './SimCockpitContext';

const PRESET_BY_KEY: Record<string, CameraPreset> = {
  '1': 'chase',
  '2': 'cockpit',
  '3': 'topdown',
  '4': 'cinematic',
  '5': 'free',
};

interface HotkeyOptions {
  onClose?: () => void;
  onToggleFullscreen?: () => void;
}

export function useSimHotkeys({ onClose, onToggleFullscreen }: HotkeyOptions = {}) {
  const {
    setCameraPreset,
    setDebugOpen,
    setHelpOpen,
    setPlayback,
    cameraPreset,
  } = useSimCockpit();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const key = e.key;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      if (key in PRESET_BY_KEY) {
        setCameraPreset(PRESET_BY_KEY[key]);
        e.preventDefault();
        return;
      }
      if (key === 'Escape') {
        onClose?.();
        return;
      }
      if (key === 'f' || key === 'F') {
        onToggleFullscreen?.();
        return;
      }
      if (key === ' ') {
        setPlayback((p) => ({ ...p, paused: !p.paused }));
        e.preventDefault();
        return;
      }
      if (key === 'c' || key === 'C') {
        const order: CameraPreset[] = ['chase', 'cockpit', 'topdown', 'cinematic', 'free'];
        const next = order[(order.indexOf(cameraPreset) + 1) % order.length];
        setCameraPreset(next);
        return;
      }
      if (key === '`' || key === '~') {
        setDebugOpen((v) => !v);
        return;
      }
      if (key === '?' || (key === '/' && e.shiftKey)) {
        setHelpOpen((v) => !v);
        return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [cameraPreset, onClose, onToggleFullscreen, setCameraPreset, setDebugOpen, setHelpOpen, setPlayback]);
}
