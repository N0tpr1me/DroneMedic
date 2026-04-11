// LidarRadarDisplay — 2D top-down radar HUD widget for the synthetic (or VM)
// LiDAR stream. Sits next to POVFeed in the bottom-right HUD cluster and
// renders the latest point cloud projected onto the horizontal plane.
//
// Rendering is imperative: a <canvas> ref + useEffect + requestAnimationFrame
// loop. React state drives only the chrome (header count, footer label) so
// the canvas itself never triggers React reconciliation.

import { useEffect, useRef } from 'react';
import { useLidarStream } from '../useLidarStream';
import type { LidarFrame } from '../lidarBus';

const CSS_SIZE = 200;
const CENTER = CSS_SIZE / 2;
const MAX_RANGE_M = 50;
const PROJECT_SCALE = (CSS_SIZE / 2 - 5) / MAX_RANGE_M; // pixels per meter
const RING_COLOR = 'rgba(80, 200, 255, 0.3)';
const RING_COLOR_DIM = 'rgba(80, 200, 255, 0.18)';
const BG_FADE = 'rgba(5, 10, 18, 0.35)';
const BG_SOLID = 'rgba(5, 10, 18, 0.85)';

interface RadarDeps {
  frame: LidarFrame | null;
}

export function LidarRadarDisplay() {
  const { frame, obstacleCount, pointCount, source, connected } = useLidarStream();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const depsRef = useRef<RadarDeps>({ frame: null });
  const firstFrameRef = useRef<boolean>(true);

  // Keep the latest frame available to the imperative draw loop without
  // recreating the effect on every state update.
  depsRef.current.frame = frame;

  useEffect(() => {
    if (source === 'off') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.round(CSS_SIZE * dpr);
    canvas.height = Math.round(CSS_SIZE * dpr);
    canvas.style.width = `${CSS_SIZE}px`;
    canvas.style.height = `${CSS_SIZE}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const drawStaticBackground = () => {
      ctx.save();
      ctx.fillStyle = BG_SOLID;
      ctx.fillRect(0, 0, CSS_SIZE, CSS_SIZE);
      ctx.restore();
    };

    const drawGrid = () => {
      ctx.save();
      ctx.strokeStyle = RING_COLOR;
      ctx.lineWidth = 1;

      // Range rings at 10 / 25 / 50 m.
      const ranges: readonly number[] = [10, 25, 50];
      ranges.forEach((r) => {
        ctx.beginPath();
        ctx.arc(CENTER, CENTER, r * PROJECT_SCALE, 0, Math.PI * 2);
        ctx.stroke();
      });

      // Crosshair lines.
      ctx.strokeStyle = RING_COLOR_DIM;
      ctx.beginPath();
      ctx.moveTo(CENTER, 4);
      ctx.lineTo(CENTER, CSS_SIZE - 4);
      ctx.moveTo(4, CENTER);
      ctx.lineTo(CSS_SIZE - 4, CENTER);
      ctx.stroke();

      // Range labels on the right-hand crossing.
      ctx.fillStyle = 'rgba(140, 220, 255, 0.55)';
      ctx.font = '10px sans-serif';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ranges.forEach((r) => {
        const x = CENTER + r * PROJECT_SCALE + 2;
        ctx.fillText(`${r}m`, x, CENTER - 6);
      });

      ctx.restore();
    };

    const drawDrone = () => {
      ctx.save();
      ctx.translate(CENTER, CENTER);
      ctx.fillStyle = 'rgba(120, 230, 255, 0.95)';
      ctx.beginPath();
      ctx.moveTo(0, -5); // nose
      ctx.lineTo(3, 3);
      ctx.lineTo(-3, 3);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };

    const drawPoints = (f: LidarFrame) => {
      ctx.save();
      ctx.fillStyle = 'rgba(120, 230, 255, 0.85)';
      for (let i = 0; i < f.points.length; i += 1) {
        const p = f.points[i];
        const cx = CENTER + (p.x / MAX_RANGE_M) * (CSS_SIZE / 2 - 5);
        const cy = CENTER - (p.z / MAX_RANGE_M) * (CSS_SIZE / 2 - 5);
        if (cx < 0 || cx > CSS_SIZE || cy < 0 || cy > CSS_SIZE) continue;
        ctx.fillRect(cx - 0.75, cy - 0.75, 1.5, 1.5);
      }
      ctx.restore();
    };

    const drawObstacles = (f: LidarFrame, now: number) => {
      if (f.obstacles.length === 0) return;
      ctx.save();
      const haloScale = Math.sin(now / 200) * 0.5 + 1;
      for (let i = 0; i < f.obstacles.length; i += 1) {
        const o = f.obstacles[i];
        // Convert (bearing, distance) → local (x forward-right).
        // bearing 0 = forward (+z), +π/2 = right (+x).
        const x = Math.sin(o.bearing) * o.distance;
        const z = Math.cos(o.bearing) * o.distance;
        const cx = CENTER + (x / MAX_RANGE_M) * (CSS_SIZE / 2 - 5);
        const cy = CENTER - (z / MAX_RANGE_M) * (CSS_SIZE / 2 - 5);
        if (cx < -10 || cx > CSS_SIZE + 10 || cy < -10 || cy > CSS_SIZE + 10) {
          continue;
        }

        // Halo.
        const haloAlpha =
          o.severity === 'critical' ? 0.45 : o.severity === 'warning' ? 0.3 : 0.2;
        ctx.fillStyle = `rgba(255, 90, 90, ${haloAlpha})`;
        ctx.beginPath();
        ctx.arc(cx, cy, 6 * haloScale, 0, Math.PI * 2);
        ctx.fill();

        // Core blip.
        ctx.fillStyle = 'rgba(255, 110, 110, 0.95)';
        ctx.beginPath();
        ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    };

    const renderFrame = () => {
      rafRef.current = requestAnimationFrame(renderFrame);

      if (firstFrameRef.current) {
        drawStaticBackground();
        firstFrameRef.current = false;
      } else {
        // Semi-transparent fade for motion-trail look.
        ctx.save();
        ctx.fillStyle = BG_FADE;
        ctx.fillRect(0, 0, CSS_SIZE, CSS_SIZE);
        ctx.restore();
      }

      drawGrid();

      const f = depsRef.current.frame;
      if (f) {
        drawPoints(f);
        drawObstacles(f, performance.now());
      }

      drawDrone();
    };

    firstFrameRef.current = true;
    rafRef.current = requestAnimationFrame(renderFrame);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [source]);

  if (source === 'off') return null;

  const obstacleLabel = `${obstacleCount} obstacle${obstacleCount === 1 ? '' : 's'}`;
  const obstacleColor = obstacleCount > 0 ? 'text-red-300' : 'text-white/50';
  const footer = `${source.toUpperCase()} · ${connected ? 'LIVE' : 'STANDBY'} · ${pointCount} pts`;

  return (
    <div className="pointer-events-none absolute bottom-24 right-[392px] w-[200px] overflow-hidden rounded-lg border border-cyan-300/30 bg-black/60 backdrop-blur-md">
      <div className="flex items-center justify-between px-2 py-1 text-[9px] uppercase tracking-[0.25em] text-cyan-200/80">
        <span className="flex items-center gap-1.5">
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${
              connected ? 'animate-pulse bg-cyan-300' : 'bg-white/30'
            }`}
          />
          LIDAR · TOP-DOWN
        </span>
        <span className={obstacleColor}>{obstacleLabel}</span>
      </div>
      <div
        className="relative"
        style={{ width: `${CSS_SIZE}px`, height: `${CSS_SIZE}px` }}
      >
        <canvas ref={canvasRef} />
      </div>
      <div className="px-2 py-1 text-[9px] uppercase tracking-[0.2em] text-white/45">
        {footer}
      </div>
    </div>
  );
}
