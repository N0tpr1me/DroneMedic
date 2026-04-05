import { useCallback, useRef } from 'react';

export function useTTS() {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const play = useCallback(async (text: string, style = 'flight_controller') => {
    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, style }),
      });
      if (!res.ok) return;
      const blob = await res.blob();
      if (audioRef.current) {
        audioRef.current.pause();
      }
      const audio = new Audio(URL.createObjectURL(blob));
      audioRef.current = audio;
      await audio.play();
    } catch (e) {
      console.warn('TTS playback failed:', e);
    }
  }, []);

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
  }, []);

  return { play, stop };
}
