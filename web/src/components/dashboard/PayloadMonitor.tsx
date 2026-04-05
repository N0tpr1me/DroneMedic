import { Thermometer } from 'lucide-react';

interface PayloadMonitorProps {
  payloadType: string;
  temperature: number;
  integrity: string;
  timeRemaining: number;
}

const PAYLOAD_LABELS: Record<string, string> = {
  blood_pack: 'Blood Pack',
  insulin: 'Insulin',
  vaccine: 'Vaccine',
  plasma: 'Plasma',
  organ: 'Organ',
};

function formatViableTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h > 0) return `${h}h ${m}m viable`;
  return `${m}m viable`;
}

function getTempColor(temp: number): string {
  if (temp < 2) return '#60a5fa'; // cold — blue
  if (temp <= 6) return '#22c55e'; // safe — green
  return '#ef4444'; // hot — red
}

function getIntegrityConfig(integrity: string): { color: string; bg: string; label: string } {
  switch (integrity) {
    case 'warning':
      return { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', label: 'Warning' };
    case 'critical':
      return { color: '#ef4444', bg: 'rgba(239,68,68,0.12)', label: 'Critical' };
    default:
      return { color: '#22c55e', bg: 'rgba(34,197,94,0.12)', label: 'Nominal' };
  }
}

export function PayloadMonitor({ payloadType, temperature, integrity, timeRemaining }: PayloadMonitorProps) {
  const integ = getIntegrityConfig(integrity);
  const tempColor = getTempColor(temperature);
  const label = PAYLOAD_LABELS[payloadType] ?? payloadType;

  // Gauge: map temperature from -5..+15 range onto 0..100% bar height
  const minT = -5;
  const maxT = 15;
  const clamped = Math.max(minT, Math.min(maxT, temperature));
  const pct = ((clamped - minT) / (maxT - minT)) * 100;

  // Safe zone band (2-6 deg) mapped to same scale
  const safeBottom = ((2 - minT) / (maxT - minT)) * 100;
  const safeTop = ((6 - minT) / (maxT - minT)) * 100;

  return (
    <div
      style={{
        width: 200,
        minHeight: 120,
        background: 'rgba(23,28,32,0.7)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        border: '1px solid rgba(141,144,160,0.1)',
        borderRadius: 10,
        padding: 14,
        display: 'flex',
        gap: 12,
        fontFamily: "'Space Grotesk', sans-serif",
      }}
    >
      {/* Vertical temperature gauge */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, width: 28 }}>
        <Thermometer size={14} color={tempColor} />
        <div
          style={{
            position: 'relative',
            width: 10,
            flex: 1,
            minHeight: 60,
            borderRadius: 5,
            background: '#1e2328',
            overflow: 'hidden',
          }}
        >
          {/* Safe zone band */}
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: `${safeBottom}%`,
              height: `${safeTop - safeBottom}%`,
              background: 'rgba(34,197,94,0.15)',
              borderLeft: '2px solid rgba(34,197,94,0.4)',
            }}
          />
          {/* Current temp level */}
          <div
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              height: `${pct}%`,
              background: `linear-gradient(to top, ${tempColor}44, ${tempColor}cc)`,
              borderRadius: '0 0 5px 5px',
              transition: 'height 0.5s ease-out',
            }}
          />
        </div>
      </div>

      {/* Info section */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 6 }}>
        {/* Payload type */}
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: '#b3c5ff',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          {label}
        </span>

        {/* Temperature readout */}
        <div>
          <span
            style={{
              fontSize: 22,
              fontWeight: 700,
              color: tempColor,
              lineHeight: 1,
              fontFamily: "'Space Grotesk', sans-serif",
            }}
          >
            {temperature.toFixed(1)}
          </span>
          <span style={{ fontSize: 11, color: '#8d90a0', marginLeft: 2 }}>°C</span>
          <div style={{ fontSize: 9, color: '#6b7280', marginTop: 2 }}>Safe 2-6°C</div>
        </div>

        {/* Integrity badge */}
        <span
          style={{
            display: 'inline-block',
            width: 'fit-content',
            fontSize: 9,
            fontWeight: 700,
            color: integ.color,
            background: integ.bg,
            border: `1px solid ${integ.color}33`,
            borderRadius: 4,
            padding: '2px 8px',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}
        >
          {integ.label}
        </span>

        {/* Time remaining */}
        <span style={{ fontSize: 10, color: '#9ca3af', fontFamily: 'monospace' }}>
          {formatViableTime(timeRemaining)}
        </span>
      </div>
    </div>
  );
}
