// FlightHUD — compass, altimeter, airspeed tape, and battery arc.
// Reads throttled telemetry snapshot from the SimCockpit context so it
// updates at ~10 Hz instead of the Canvas framerate.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSimCockpit } from '../SimCockpitContext';

function formatN(n: number | undefined, digits = 0): string {
  if (n === undefined || Number.isNaN(n)) return '--';
  return n.toFixed(digits);
}

export function FlightHUD() {
  const { telemetry, payload, criticalAlertActive } = useSimCockpit();
  const heading = telemetry?.heading_deg ?? 0;
  const alt = telemetry?.relative_alt_m ?? 0;
  const speed = telemetry?.speed_m_s ?? 0;

  // --- Vertical Speed Indicator (VSI) ---
  const prevAltRef = useRef(alt);
  const prevTimeRef = useRef(Date.now());
  const [vsi, setVsi] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      const dt = (now - prevTimeRef.current) / 1000; // seconds
      if (dt > 0) {
        const currentAlt = telemetry?.relative_alt_m ?? 0;
        setVsi((currentAlt - prevAltRef.current) / dt);
        prevAltRef.current = currentAlt;
        prevTimeRef.current = now;
      }
    }, 500);
    return () => clearInterval(id);
  }, [telemetry?.relative_alt_m]);

  const absVsi = Math.abs(vsi);
  const vsiColor = absVsi > 5 ? '#ff6a6a' : absVsi > 2 ? '#f8d25c' : '#74f4b8';
  const vsiArrow = vsi >= 0 ? '\u25B2' : '\u25BC';

  // --- Wind Direction Indicator ---
  const baseWind = useMemo(() => ({ speed: 3.5, bearing: 225 }), []);
  const tickRef = useRef(0);
  const [windSpeed, setWindSpeed] = useState(baseWind.speed);
  const [windBearing, setWindBearing] = useState(baseWind.bearing);

  useEffect(() => {
    const id = setInterval(() => {
      tickRef.current += 1;
      const t = tickRef.current * 0.5; // seconds elapsed
      setWindSpeed(baseWind.speed + 0.4 * Math.sin(t * 0.3));
      setWindBearing(baseWind.bearing + 5 * Math.sin(t * 0.2));
    }, 500);
    return () => clearInterval(id);
  }, [baseWind]);

  const relativeWindDeg = windBearing - heading;
  const windColor = windSpeed > 10 ? '#ff6a6a' : windSpeed > 5 ? '#f8d25c' : '#74f4b8';
  const battery = Math.max(0, Math.min(100, telemetry?.battery_pct ?? 0));
  const batteryColor =
    battery > 60 ? '#74f4b8' : battery > 30 ? '#f8d25c' : '#ff6a6a';
  const batteryPulse = criticalAlertActive || battery < 20;
  const payloadColor =
    payload?.integrity === 'critical'
      ? '#ff6a6a'
      : payload?.integrity === 'warning'
        ? '#f8d25c'
        : '#74f4b8';

  return (
    <div
      className="pointer-events-none absolute inset-0 select-none"
      style={{ fontFamily: 'Space Grotesk, monospace, sans-serif' }}
    >
      {/* top-left: altimeter + airspeed */}
      <div className="absolute left-4 top-14 flex flex-col gap-2 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-[11px] uppercase tracking-widest text-cyan-100/90 backdrop-blur">
        <div className="flex items-baseline gap-2">
          <span className="text-white/50">ALT</span>
          <span className="text-xl font-semibold text-white">
            {formatN(alt, 1)}
          </span>
          <span className="text-white/50">m</span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-white/50">SPD</span>
          <span className="text-xl font-semibold text-white">
            {formatN(speed, 1)}
          </span>
          <span className="text-white/50">m/s</span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-white/50">VSI</span>
          <span className="text-xl font-semibold" style={{ color: vsiColor }}>
            <span className="mr-0.5 text-sm">{vsiArrow}</span>
            {vsi >= 0 ? '+' : ''}{formatN(vsi, 1)}
          </span>
          <span className="text-white/50">m/s</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-white/50">WIND</span>
          <svg
            width={20}
            height={20}
            viewBox="0 0 20 20"
            style={{ transform: `rotate(${relativeWindDeg}deg)` }}
          >
            <path
              d="M10 2 L14 14 L10 11 L6 14 Z"
              fill={windColor}
              opacity={0.9}
            />
          </svg>
          <span className="font-semibold" style={{ color: windColor }}>
            {formatN(windSpeed, 1)}
          </span>
          <span className="text-white/50">m/s</span>
        </div>
      </div>

      {/* top-right: battery arc + mode + payload */}
      <div
        className={`absolute right-4 top-14 flex flex-col items-end gap-2 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-[11px] uppercase tracking-widest backdrop-blur ${
          batteryPulse ? 'animate-pulse ring-1 ring-red-400/50' : ''
        }`}
      >
        <div className="flex items-center gap-2">
          <span className="text-white/50">BATT</span>
          <svg width={48} height={16} viewBox="0 0 48 16">
            <rect
              x={0.5}
              y={0.5}
              width={44}
              height={15}
              rx={3}
              fill="none"
              stroke="#ffffff40"
              strokeWidth={1}
            />
            <rect
              x={2}
              y={2}
              width={(battery / 100) * 41}
              height={12}
              rx={1}
              fill={batteryColor}
            />
            <rect x={45} y={5} width={3} height={6} rx={0.5} fill="#ffffff40" />
          </svg>
          <span className="text-sm font-semibold text-white">
            {formatN(battery, 0)}%
          </span>
        </div>
        <div className="flex items-center gap-2 text-cyan-100/80">
          <span className="text-white/50">MODE</span>
          <span className="text-white">{telemetry?.flight_mode ?? '---'}</span>
        </div>
        {payload && (
          <div className="flex items-center gap-2" style={{ color: payloadColor }}>
            <span className="text-white/50">PAYLOAD</span>
            <span className="font-semibold">
              {formatN(payload.temperature_c, 1)}°C
            </span>
            <span className="text-[9px]">{payload.integrity.toUpperCase()}</span>
          </div>
        )}
      </div>

      {/* mid-top center: compass (moved out of ticker zone) */}
      <div className="absolute top-[260px] left-1/2 -translate-x-1/2 rounded-full border border-white/10 bg-black/40 px-4 py-2 backdrop-blur">
        <div
          className="relative h-6 w-48 overflow-hidden text-[10px] uppercase tracking-[0.25em] text-white/80"
          aria-label="compass"
        >
          <div
            className="absolute top-0 flex h-full items-center whitespace-nowrap"
            style={{
              transform: `translateX(calc(50% - ${(heading / 360) * 600}px))`,
            }}
          >
            {[...Array(37)].map((_, i) => {
              const deg = i * 10;
              const cardinal =
                deg === 0
                  ? 'N'
                  : deg === 90
                    ? 'E'
                    : deg === 180
                      ? 'S'
                      : deg === 270
                        ? 'W'
                        : `${deg}`;
              return (
                <span
                  key={deg}
                  className={`inline-block w-[60px] text-center ${
                    deg % 90 === 0 ? 'text-cyan-200' : 'text-white/60'
                  }`}
                >
                  {cardinal}
                </span>
              );
            })}
          </div>
          <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-cyan-300" />
        </div>
        <div className="mt-1 text-center text-[10px] uppercase tracking-[0.3em] text-white/60">
          HDG {formatN(heading, 0)}°
        </div>
      </div>
    </div>
  );
}
