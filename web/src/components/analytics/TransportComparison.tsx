import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LabelList,
} from 'recharts';
import { Plane, Truck, AlertTriangle, Clock, DollarSign } from 'lucide-react';
import { DEMO_SCENARIO } from '../../data/demo-scenario';

// ── Types ──

interface TransportMethod {
  name: string;
  time: number | null;
  cost: number;
  color: string;
  icon: typeof Plane;
  available: boolean;
}

// ── Data ──

const { comparison, clinicalDeadline } = DEMO_SCENARIO;

const TRANSPORTS: TransportMethod[] = [
  {
    name: 'Drone',
    time: comparison.drone.time_min,
    cost: comparison.drone.cost_gbp,
    color: '#00daf3',
    icon: Plane,
    available: true,
  },
  {
    name: 'Helicopter',
    time: null,
    cost: comparison.helicopter.cost_gbp,
    color: '#ef4444',
    icon: AlertTriangle,
    available: false,
  },
  {
    name: 'Ambulance',
    time: comparison.ambulance.time_min,
    cost: comparison.ambulance.cost_gbp,
    color: '#f59e0b',
    icon: Truck,
    available: true,
  },
];

const timeChartData = TRANSPORTS.map((t) => ({
  name: t.name,
  time: t.time ?? 0,
  color: t.color,
  available: t.available,
}));

const costChartData = TRANSPORTS.map((t) => ({
  name: t.name,
  cost: t.cost,
  color: t.color,
}));

// ── Styles ──

const glassCard: React.CSSProperties = {
  background: 'rgba(23,28,32,0.7)',
  backdropFilter: 'blur(24px)',
  border: '1px solid rgba(141,144,160,0.1)',
  borderRadius: 12,
  padding: 24,
};

const sectionLabel: React.CSSProperties = {
  fontFamily: 'Space Grotesk',
  fontSize: 11,
  fontWeight: 700,
  color: '#8d90a0',
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
  marginBottom: 12,
};

const tooltipStyle = {
  background: 'rgba(15,20,24,0.95)',
  border: '1px solid rgba(67,70,84,0.3)',
  borderRadius: 8,
};

// ── Custom bar label for "GROUNDED" ──

function GroundedLabel(props: Record<string, unknown>) {
  const { x, y, width, height, value, index } = props as {
    x: number;
    y: number;
    width: number;
    height: number;
    value: number;
    index: number;
  };
  const entry = timeChartData[index];
  if (entry?.available || value > 0) return null;
  return (
    <text
      x={x + 12}
      y={y + height / 2 + 4}
      fill="#ef4444"
      fontSize={11}
      fontWeight={700}
      fontFamily="Space Grotesk"
      letterSpacing="0.08em"
    >
      GROUNDED
    </text>
  );
}

// ── Custom tooltip ──

function TimeTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: typeof timeChartData[0] }> }) {
  if (!active || !payload?.[0]) return null;
  const d = payload[0].payload;
  return (
    <div style={{ ...tooltipStyle, padding: '8px 12px', fontSize: 12, color: '#dfe3e9' }}>
      <strong style={{ color: d.color }}>{d.name}</strong>
      <br />
      {d.available ? `${d.time} minutes` : 'Grounded — unavailable in storm'}
    </div>
  );
}

function CostTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: typeof costChartData[0] }> }) {
  if (!active || !payload?.[0]) return null;
  const d = payload[0].payload;
  return (
    <div style={{ ...tooltipStyle, padding: '8px 12px', fontSize: 12, color: '#dfe3e9' }}>
      <strong style={{ color: d.color }}>{d.name}</strong>
      <br />
      {'\u00a3'}{d.cost.toLocaleString()}
    </div>
  );
}

// ── Component ──

export function TransportComparison() {
  const timeSaved = comparison.ambulance.time_min - comparison.drone.time_min;
  const costSaved = comparison.helicopter.cost_gbp - comparison.drone.cost_gbp;

  return (
    <div style={glassCard}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <div style={sectionLabel}>Why Drones? — Transport Comparison</div>
          <p style={{ fontSize: 13, color: '#c3c6d6', margin: 0, lineHeight: 1.5 }}>
            Emergency O-negative blood to Royal London Hospital during a North London storm
          </p>
        </div>
        <div style={{
          padding: '6px 14px',
          borderRadius: 8,
          background: 'rgba(0,218,243,0.08)',
          border: '1px solid rgba(0,218,243,0.2)',
          fontSize: 11,
          fontWeight: 700,
          color: '#00daf3',
          fontFamily: 'Space Grotesk',
          letterSpacing: '0.05em',
        }}>
          {clinicalDeadline}-MIN CLINICAL WINDOW
        </div>
      </div>

      {/* Charts Row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 20 }}>

        {/* Response Time */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14 }}>
            <Clock size={13} style={{ color: '#8d90a0' }} />
            <span style={{ fontSize: 11, fontWeight: 600, color: '#8d90a0', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Response Time (minutes)
            </span>
          </div>
          {timeChartData.map((entry) => (
            <div key={entry.name} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#c3c6d6', width: 80 }}>{entry.name}</span>
              <div style={{ flex: 1, height: 24, background: 'rgba(48,53,58,0.6)', borderRadius: 6, overflow: 'hidden', position: 'relative' }}>
                {entry.available && entry.time > 0 ? (
                  <div style={{
                    width: `${Math.min((entry.time / 60) * 100, 100)}%`,
                    height: '100%',
                    background: `linear-gradient(90deg, ${entry.color}, ${entry.color}dd)`,
                    borderRadius: 6,
                    minWidth: 4,
                    transition: 'width 0.5s',
                  }} />
                ) : (
                  <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 10, fontWeight: 700, color: '#ef4444', letterSpacing: '0.08em' }}>
                    GROUNDED
                  </span>
                )}
              </div>
              <span style={{ fontSize: 13, fontWeight: 700, color: entry.color, width: 45, textAlign: 'right', fontFamily: 'Space Grotesk' }}>
                {entry.available ? `${entry.time}m` : '—'}
              </span>
            </div>
          ))}
        </div>

        {/* Cost */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14 }}>
            <DollarSign size={13} style={{ color: '#8d90a0' }} />
            <span style={{ fontSize: 11, fontWeight: 600, color: '#8d90a0', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Cost per Delivery ({'\u00a3'} GBP)
            </span>
          </div>
          {costChartData.map((entry) => (
            <div key={entry.name} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#c3c6d6', width: 80 }}>{entry.name}</span>
              <div style={{ flex: 1, height: 24, background: 'rgba(48,53,58,0.6)', borderRadius: 6, overflow: 'hidden' }}>
                <div style={{
                  width: `${Math.min((entry.cost / 8200) * 100, 100)}%`,
                  height: '100%',
                  background: `linear-gradient(90deg, ${entry.color}, ${entry.color}dd)`,
                  borderRadius: 6,
                  minWidth: 4,
                  transition: 'width 0.5s',
                }} />
              </div>
              <span style={{ fontSize: 13, fontWeight: 700, color: entry.color, width: 65, textAlign: 'right', fontFamily: 'Space Grotesk' }}>
                {'\u00a3'}{entry.cost >= 1000 ? `${(entry.cost / 1000).toFixed(1)}k` : entry.cost}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Callout Strip */}
      <div style={{
        display: 'flex',
        gap: 16,
        padding: '14px 20px',
        borderRadius: 10,
        background: 'linear-gradient(135deg, rgba(0,218,243,0.06) 0%, rgba(74,222,128,0.06) 100%)',
        border: '1px solid rgba(0,218,243,0.15)',
        alignItems: 'center',
      }}>
        {/* Time Saved */}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#7a7e8c', marginBottom: 2 }}>
            Time Saved vs Ambulance
          </div>
          <div style={{ fontFamily: 'Space Grotesk', fontSize: 22, fontWeight: 700, color: '#4ade80' }}>
            {timeSaved} minutes
          </div>
        </div>

        {/* Divider */}
        <div style={{ width: 1, height: 36, background: 'rgba(141,144,160,0.15)' }} />

        {/* Cost Saved */}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#7a7e8c', marginBottom: 2 }}>
            Cost Saved vs Helicopter
          </div>
          <div style={{ fontFamily: 'Space Grotesk', fontSize: 22, fontWeight: 700, color: '#00daf3' }}>
            {'\u00a3'}{costSaved.toLocaleString()}
          </div>
        </div>

        {/* Divider */}
        <div style={{ width: 1, height: 36, background: 'rgba(141,144,160,0.15)' }} />

        {/* Clinical Window */}
        <div style={{ flex: 2 }}>
          <div style={{ fontSize: 13, color: '#c3c6d6', lineHeight: 1.5 }}>
            Drone saved <strong style={{ color: '#4ade80' }}>{timeSaved} minutes</strong> vs ambulance{' '}
            — well within the <strong style={{ color: '#00daf3' }}>{clinicalDeadline}-minute</strong> clinical window
          </div>
        </div>
      </div>
    </div>
  );
}
