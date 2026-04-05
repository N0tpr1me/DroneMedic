import { useEffect, useRef, useState, useMemo } from 'react';
import { GlassPanel } from '../ui/GlassPanel';
import { SlidingNumber } from '../ui/sliding-number';
import { Area, AreaChart } from 'recharts';

/* ── Types ─────────────────────────────────────────────────────────── */

interface DroneState {
  speed: number;
  heading: number;
  bank: number;
  pitch: number;
  alt: number;
  battery_pct: number;
  battery_wh: number;
  power_w: number;
  phase: string;
  vx: number;
  vy: number;
  vz: number;
}

interface Wind {
  speed: number;
  direction: number;
}

interface EnergyBudget {
  total_wh: number;
  available_wh: number;
  reserve_wh: number;
  ratio: number;
  feasible: boolean;
  max_range_km: number;
}

interface PhysicsDashboardProps {
  droneState: DroneState;
  wind: Wind;
  energyBudget: EnergyBudget;
  className?: string;
}

/* ── Constants ─────────────────────────────────────────────────────── */

const CYAN = '#00daf3';
const AMBER = '#f59e0b';
const GREEN = '#22c55e';
const RED = '#ef4444';
const DIM = '#6b7280';
const TRACK = '#30353a';
const FONT = "'Space Grotesk', monospace";

const PHASE_COLORS: Record<string, string> = {
  cruise: CYAN,
  hover: AMBER,
  climb: GREEN,
  descend: RED,
  descent: RED,
  idle: DIM,
};

const POWER_COLORS: Record<string, string> = {
  cruise: GREEN,
  hover: AMBER,
  climb: RED,
  descend: AMBER,
  descent: AMBER,
  idle: DIM,
};

/* ── Helpers ───────────────────────────────────────────────────────── */

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function computeGroundSpeed(airspeed: number, windSpeed: number, heading: number, windDir: number): number {
  const headwindComponent = windSpeed * Math.cos(degToRad(windDir - heading));
  return Math.max(0, airspeed - headwindComponent);
}

function computeDriftAngle(airspeed: number, windSpeed: number, heading: number, windDir: number): number {
  if (airspeed <= 0) return 0;
  const crosswindComponent = windSpeed * Math.sin(degToRad(windDir - heading));
  return Math.atan2(crosswindComponent, airspeed) * (180 / Math.PI);
}

function computeTWR(power: number, speed: number): number {
  // Approximate TWR from power/weight — uses default spec: 14.5 kg MTOM, 360 N max thrust
  const weight = 14.5 * 9.81;
  const maxThrust = 360;
  return maxThrust / weight;
}

/* ── Sub-components ────────────────────────────────────────────────── */

function PhaseBadge({ phase }: { phase: string }) {
  const color = PHASE_COLORS[phase.toLowerCase()] ?? DIM;
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 4,
        fontSize: 10,
        fontWeight: 700,
        fontFamily: FONT,
        letterSpacing: 1.2,
        textTransform: 'uppercase',
        color: '#0f1418',
        background: color,
        boxShadow: `0 0 8px ${color}66`,
      }}
    >
      {phase}
    </span>
  );
}

function CompassRose({ heading, windDir, size = 64 }: { heading: number; windDir: number; size?: number }) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 4;
  const tickR = r - 2;
  const labelR = r - 10;

  const cardinals = [
    { label: 'N', deg: 0 },
    { label: 'E', deg: 90 },
    { label: 'S', deg: 180 },
    { label: 'W', deg: 270 },
  ];

  // Heading arrow points outward from center
  const hRad = degToRad(heading - 90);
  const hx = cx + Math.cos(hRad) * (r - 14);
  const hy = cy + Math.sin(hRad) * (r - 14);

  // Wind arrow (smaller, dashed)
  const wRad = degToRad(windDir - 90);
  const wx = cx + Math.cos(wRad) * (r - 18);
  const wy = cy + Math.sin(wRad) * (r - 18);

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* Outer ring */}
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={TRACK} strokeWidth={1.5} />

      {/* Cardinal ticks and labels */}
      {cardinals.map(({ label, deg }) => {
        const rad = degToRad(deg - 90);
        const tx1 = cx + Math.cos(rad) * tickR;
        const ty1 = cy + Math.sin(rad) * tickR;
        const tx2 = cx + Math.cos(rad) * (tickR - 4);
        const ty2 = cy + Math.sin(rad) * (tickR - 4);
        const lx = cx + Math.cos(rad) * labelR;
        const ly = cy + Math.sin(rad) * labelR;
        return (
          <g key={label}>
            <line x1={tx1} y1={ty1} x2={tx2} y2={ty2} stroke={DIM} strokeWidth={1} />
            <text
              x={lx}
              y={ly}
              fill={label === 'N' ? CYAN : DIM}
              fontSize={7}
              fontFamily={FONT}
              fontWeight={label === 'N' ? 700 : 400}
              textAnchor="middle"
              dominantBaseline="central"
            >
              {label}
            </text>
          </g>
        );
      })}

      {/* Heading arrow (cyan) */}
      <line x1={cx} y1={cy} x2={hx} y2={hy} stroke={CYAN} strokeWidth={1.5} strokeLinecap="round" />
      <circle cx={hx} cy={hy} r={2} fill={CYAN} />

      {/* Wind arrow (amber, dashed) */}
      <line
        x1={cx}
        y1={cy}
        x2={wx}
        y2={wy}
        stroke={AMBER}
        strokeWidth={1}
        strokeDasharray="3 2"
        strokeLinecap="round"
      />
      <circle cx={wx} cy={wy} r={1.5} fill={AMBER} />

      {/* Center dot */}
      <circle cx={cx} cy={cy} r={2} fill="#ffffff" opacity={0.5} />
    </svg>
  );
}

function HorizontalBar({
  value,
  max,
  color,
  height = 6,
  width = '100%',
}: {
  value: number;
  max: number;
  color: string;
  height?: number;
  width?: string | number;
}) {
  const pct = Math.min(Math.max(value / max, 0), 1) * 100;
  return (
    <div
      style={{
        width,
        height,
        borderRadius: height / 2,
        background: TRACK,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          width: `${pct}%`,
          height: '100%',
          borderRadius: height / 2,
          background: color,
          boxShadow: `0 0 6px ${color}66`,
          transition: 'width 0.5s ease-out',
        }}
      />
    </div>
  );
}

function EnergyBar({ available, reserve, total }: { available: number; reserve: number; total: number }) {
  const usedPct = Math.max(0, ((total - available) / total) * 100);
  const availPct = Math.max(0, ((available - reserve) / total) * 100);
  const reservePct = Math.max(0, (reserve / total) * 100);

  return (
    <div style={{ width: '100%', height: 8, borderRadius: 4, background: TRACK, overflow: 'hidden', display: 'flex' }}>
      <div style={{ width: `${usedPct}%`, height: '100%', background: DIM, transition: 'width 0.5s ease-out' }} />
      <div
        style={{
          width: `${availPct}%`,
          height: '100%',
          background: CYAN,
          boxShadow: `0 0 6px ${CYAN}44`,
          transition: 'width 0.5s ease-out',
        }}
      />
      <div
        style={{
          width: `${reservePct}%`,
          height: '100%',
          background: AMBER,
          opacity: 0.6,
          transition: 'width 0.5s ease-out',
        }}
      />
    </div>
  );
}

function AltitudeSparkline({ history }: { history: { t: number; alt: number }[] }) {
  if (history.length < 2) return null;
  return (
    <div style={{ width: '100%', height: 48 }}>
      <AreaChart width={260} height={48} data={history} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
        <defs>
          <linearGradient id="altGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CYAN} stopOpacity={0.25} />
            <stop offset="100%" stopColor={CYAN} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey="alt"
          stroke={CYAN}
          strokeWidth={1.2}
          fill="url(#altGradient)"
          isAnimationActive={false}
          dot={false}
        />
      </AreaChart>
    </div>
  );
}

/* ── Label row helper ──────────────────────────────────────────────── */

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
      <span style={{ fontSize: 10, color: DIM, fontFamily: FONT }}>{label}</span>
      <span style={{ fontSize: 12, color: '#e5e7eb', fontFamily: FONT, fontWeight: 600 }}>{children}</span>
    </div>
  );
}

/* ── Main component ────────────────────────────────────────────────── */

export function PhysicsDashboard({ droneState, wind, energyBudget, className = '' }: PhysicsDashboardProps) {
  const altHistoryRef = useRef<{ t: number; alt: number }[]>([]);
  const [altHistory, setAltHistory] = useState<{ t: number; alt: number }[]>([]);
  const prevAltRef = useRef(droneState.alt);

  // Track altitude over time for sparkline
  useEffect(() => {
    if (prevAltRef.current !== droneState.alt) {
      prevAltRef.current = droneState.alt;
      const next = [...altHistoryRef.current, { t: Date.now(), alt: droneState.alt }];
      const trimmed = next.length > 60 ? next.slice(next.length - 60) : next;
      altHistoryRef.current = trimmed;
      setAltHistory(trimmed);
    }
  }, [droneState.alt]);

  const groundSpeed = useMemo(
    () => computeGroundSpeed(droneState.speed, wind.speed, droneState.heading, wind.direction),
    [droneState.speed, wind.speed, droneState.heading, wind.direction],
  );

  const driftAngle = useMemo(
    () => computeDriftAngle(droneState.speed, wind.speed, droneState.heading, wind.direction),
    [droneState.speed, wind.speed, droneState.heading, wind.direction],
  );

  const twr = computeTWR(droneState.power_w, droneState.speed);
  const phaseColor = PHASE_COLORS[droneState.phase.toLowerCase()] ?? DIM;
  const powerColor = POWER_COLORS[droneState.phase.toLowerCase()] ?? DIM;

  const sectionStyle: React.CSSProperties = {
    borderTop: `1px solid ${TRACK}`,
    paddingTop: 8,
    marginTop: 8,
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 9,
    color: DIM,
    fontFamily: FONT,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 4,
  };

  return (
    <GlassPanel className={className} aria-label="Flight Dynamics">
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 10,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            fontFamily: FONT,
            letterSpacing: 1.5,
            textTransform: 'uppercase',
            color: CYAN,
          }}
        >
          Flight Dynamics
        </span>
        <PhaseBadge phase={droneState.phase} />
      </div>

      {/* Compass + core flight data */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <CompassRose heading={droneState.heading} windDir={wind.direction} size={64} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <Row label="Speed">
            <SlidingNumber value={parseFloat(droneState.speed.toFixed(1))} suffix=" m/s" />
          </Row>
          <Row label="Heading">
            <SlidingNumber value={Math.round(droneState.heading)} suffix="°" />
          </Row>
          <Row label="Bank">
            <SlidingNumber value={parseFloat(droneState.bank.toFixed(1))} suffix="°" />
          </Row>
          <Row label="Pitch">
            <SlidingNumber value={parseFloat(droneState.pitch.toFixed(1))} suffix="°" />
          </Row>
        </div>
      </div>

      {/* Power section */}
      <div style={sectionStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <span style={{ fontSize: 12 }}>&#9889;</span>
          <span style={{ fontSize: 11, fontFamily: FONT, color: '#e5e7eb', fontWeight: 600 }}>
            Power: <SlidingNumber value={Math.round(droneState.power_w)} suffix="W" />
          </span>
          <span style={{ fontSize: 9, color: phaseColor, fontFamily: FONT }}>
            [{droneState.phase.toLowerCase()}]
          </span>
        </div>
        <HorizontalBar value={droneState.battery_pct} max={100} color={powerColor} />
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginTop: 3,
          }}
        >
          <span style={{ fontSize: 9, color: DIM, fontFamily: FONT }}>
            <SlidingNumber value={Math.round(droneState.battery_pct)} suffix="% batt" />
          </span>
          <span style={{ fontSize: 9, color: DIM, fontFamily: FONT }}>
            <SlidingNumber value={Math.round(droneState.battery_wh)} suffix=" Wh" />
          </span>
        </div>
      </div>

      {/* Energy budget */}
      <div style={sectionStyle}>
        <div style={labelStyle}>Energy Budget</div>
        <EnergyBar
          available={energyBudget.available_wh}
          reserve={energyBudget.reserve_wh}
          total={energyBudget.total_wh}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
          <span style={{ fontSize: 9, color: DIM, fontFamily: FONT }}>
            {Math.round(energyBudget.available_wh)} / {Math.round(energyBudget.total_wh)} Wh
          </span>
          <span style={{ fontSize: 9, color: AMBER, fontFamily: FONT }}>
            Reserve: {Math.round(energyBudget.reserve_wh)} Wh
          </span>
        </div>
        {!energyBudget.feasible && (
          <div style={{ fontSize: 9, color: RED, fontFamily: FONT, marginTop: 2, fontWeight: 700 }}>
            ENERGY BUDGET EXCEEDED
          </div>
        )}
      </div>

      {/* Wind section */}
      <div style={sectionStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
          <span style={{ fontSize: 12 }}>&#128168;</span>
          <span style={{ fontSize: 11, fontFamily: FONT, color: '#e5e7eb', fontWeight: 600 }}>
            Wind: <SlidingNumber value={parseFloat(wind.speed.toFixed(1))} suffix={` m/s @ ${Math.round(wind.direction)}°`} />
          </span>
        </div>
        <Row label="Ground speed">
          <SlidingNumber value={parseFloat(groundSpeed.toFixed(1))} suffix=" m/s" />
        </Row>
        <Row label="Drift angle">
          <span>
            {driftAngle >= 0 ? '+' : ''}
            <SlidingNumber value={parseFloat(driftAngle.toFixed(1))} suffix="°" />
          </span>
        </Row>
      </div>

      {/* TWR + Range + Alt */}
      <div style={sectionStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
          <span style={{ fontSize: 10, color: DIM, fontFamily: FONT }}>
            TWR: <span style={{ color: '#e5e7eb', fontWeight: 600 }}>{twr.toFixed(2)}</span>
          </span>
          <span style={{ fontSize: 10, color: DIM, fontFamily: FONT }}>
            Range: <span style={{ color: '#e5e7eb', fontWeight: 600 }}>
              <SlidingNumber value={parseFloat(energyBudget.max_range_km.toFixed(1))} suffix=" km" />
            </span>
          </span>
        </div>
        <Row label="Alt">
          <SlidingNumber value={Math.round(droneState.alt)} suffix="m AGL" />
        </Row>
      </div>

      {/* Altitude sparkline */}
      <div style={sectionStyle}>
        <div style={labelStyle}>Altitude Profile</div>
        <AltitudeSparkline history={altHistory} />
      </div>
    </GlassPanel>
  );
}
