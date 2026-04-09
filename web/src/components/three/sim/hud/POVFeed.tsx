// POVFeed — drone-camera picture-in-picture widget. Subscribes to /ws/pov
// and paints JPEG frames into an <img> via blob URLs. Falls back to an
// "offline" state when the upstream is down.

import { useEffect, useRef, useState } from 'react';
import { VisionOverlay } from './VisionOverlay';
import { useVisionStream } from '../useVisionStream';
import { backendWsUrl } from '../../../../lib/backendUrls';

interface Status {
  connected: boolean;
  frameUrl: string | null;
  lastFrame: number | null;
  fps: number;
}

export function POVFeed() {
  const [status, setStatus] = useState<Status>({
    connected: false,
    frameUrl: null,
    lastFrame: null,
    fps: 0,
  });
  const wsRef = useRef<WebSocket | null>(null);
  const frameCount = useRef(0);
  const lastFpsSample = useRef<number>(0);
  const lastUrl = useRef<string | null>(null);
  const vision = useVisionStream();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (import.meta.env.VITE_VISION_ENABLED === 'false') return;
    lastFpsSample.current = performance.now();
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (cancelled) return;
      const path =
        (import.meta.env.VITE_POV_FEED_URL as string | undefined) || '/ws/pov';
      const url = backendWsUrl(path);
      try {
        const ws = new WebSocket(url);
        ws.binaryType = 'arraybuffer';
        wsRef.current = ws;
        ws.onopen = () =>
          setStatus((s) => ({ ...s, connected: true }));
        ws.onmessage = (msg) => {
          if (typeof msg.data === 'string') {
            // Status/JSON control frames can be ignored here; /ws/vision handles reasoning.
            return;
          }
          const blob = new Blob([msg.data], { type: 'image/jpeg' });
          const objUrl = URL.createObjectURL(blob);
          if (lastUrl.current) URL.revokeObjectURL(lastUrl.current);
          lastUrl.current = objUrl;

          frameCount.current += 1;
          const now = performance.now();
          if (now - lastFpsSample.current >= 1000) {
            const fps = frameCount.current;
            frameCount.current = 0;
            lastFpsSample.current = now;
            setStatus((s) => ({ ...s, frameUrl: objUrl, lastFrame: Date.now(), fps }));
          } else {
            setStatus((s) => ({ ...s, frameUrl: objUrl, lastFrame: Date.now() }));
          }
        };
        ws.onerror = () =>
          setStatus((s) => ({ ...s, connected: false }));
        ws.onclose = () => {
          setStatus((s) => ({ ...s, connected: false }));
          wsRef.current = null;
          if (!cancelled) reconnectTimer = setTimeout(connect, 4000);
        };
      } catch {
        if (!cancelled) reconnectTimer = setTimeout(connect, 4000);
      }
    };

    connect();
    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
      if (lastUrl.current) URL.revokeObjectURL(lastUrl.current);
      lastUrl.current = null;
    };
  }, []);

  return (
    <div className="pointer-events-none absolute right-4 bottom-16 w-[320px] overflow-hidden rounded-lg border border-white/15 bg-black/60 backdrop-blur-md">
      <div className="flex items-center justify-between px-2 py-1 text-[9px] uppercase tracking-[0.25em] text-cyan-200/80">
        <span className="flex items-center gap-1.5">
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${
              status.connected ? 'animate-pulse bg-emerald-300' : 'bg-red-400'
            }`}
          />
          AI Vision
        </span>
        <span className="text-white/50">{status.fps} fps</span>
      </div>
      <div
        className="relative w-full"
        style={{ aspectRatio: '16 / 9', background: '#020308' }}
      >
        {status.frameUrl ? (
          <img
            src={status.frameUrl}
            alt="drone point of view"
            className="h-full w-full object-cover"
            style={{
              filter: 'contrast(1.1) saturate(1.05)',
            }}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[11px] uppercase tracking-[0.25em] text-white/40">
            {status.connected ? 'waiting for frame' : 'pov feed offline'}
          </div>
        )}
        {/* CRT scanline overlay for "camera feed" texture */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 mix-blend-overlay opacity-40"
          style={{
            background:
              'repeating-linear-gradient(to bottom, rgba(255,255,255,0.08) 0px, rgba(255,255,255,0.08) 1px, transparent 1px, transparent 3px)',
          }}
        />
        <VisionOverlay latest={vision.latest} />
      </div>
    </div>
  );
}
