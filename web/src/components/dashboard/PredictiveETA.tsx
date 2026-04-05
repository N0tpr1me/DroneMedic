import { useMemo } from 'react';
import { SlidingNumber } from '../ui/sliding-number';

interface PredictiveETAProps {
  currentSpeed: number;
  remainingDistance: number;
  totalDistance: number;
  missionProgress: number;
  deliveryStops: number;
  nextWaypoint?: string;
}

function formatTime(seconds: number): { minutes: number; secs: number } {
  const clamped = Math.max(0, Math.round(seconds));
  return {
    minutes: Math.floor(clamped / 60),
    secs: clamped % 60,
  };
}

function getETAColor(seconds: number): string {
  if (seconds < 120) return '#22c55e';
  if (seconds < 300) return '#f5a623';
  return '#00daf3';
}

export function PredictiveETA({
  currentSpeed,
  remainingDistance,
  totalDistance,
  missionProgress,
  deliveryStops,
  nextWaypoint = 'Royal London',
}: PredictiveETAProps) {
  const etaSeconds = useMemo(
    () => remainingDistance / Math.max(currentSpeed, 0.1) + deliveryStops * 30,
    [remainingDistance, currentSpeed, deliveryStops],
  );

  const { minutes, secs } = formatTime(etaSeconds);
  const color = getETAColor(etaSeconds);
  const progress = Math.min(missionProgress / 100, 1);

  const size = 140;
  const strokeWidth = 7;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashoffset = circumference * (1 - progress);

  const filterId = 'etaRingGlow';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        width: 160,
      }}
    >
      <div style={{ width: size, height: size, position: 'relative' }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          style={{ transform: 'rotate(-90deg)' }}
        >
          <defs>
            <filter id={filterId}>
              <feDropShadow
                dx="0"
                dy="0"
                stdDeviation="3"
                floodColor={color}
                floodOpacity="0.6"
              />
            </filter>
          </defs>
          {/* Track */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="#30353a"
            strokeWidth={strokeWidth}
          />
          {/* Progress arc */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashoffset}
            style={{
              transition: 'stroke-dashoffset 0.5s ease-out, stroke 0.4s ease',
              filter: `url(#${filterId})`,
            }}
          />
        </svg>

        {/* Center text */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <span
            style={{
              fontSize: 9,
              color: '#6b7280',
              textTransform: 'uppercase',
              letterSpacing: 1.5,
              marginBottom: 2,
            }}
          >
            ETA
          </span>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              fontFamily: "'Space Grotesk', sans-serif",
              fontSize: 28,
              fontWeight: 700,
              color: '#ffffff',
              lineHeight: 1,
            }}
          >
            <SlidingNumber value={minutes} />
            <span style={{ color: '#6b7280', margin: '0 1px' }}>:</span>
            <SlidingNumber
              value={secs}
              className="min-w-[2ch]"
              prefix={secs < 10 ? '0' : ''}
            />
          </div>
          <span
            style={{
              fontSize: 8,
              color: '#9ca3af',
              marginTop: 4,
            }}
          >
            {Math.round(remainingDistance)}m remaining
          </span>
        </div>
      </div>

      {/* Waypoint label */}
      <div
        style={{
          textAlign: 'center',
          lineHeight: 1.3,
        }}
      >
        <span style={{ fontSize: 10, color: '#6b7280' }}>Next: </span>
        <span style={{ fontSize: 11, color: '#e5e7eb', fontWeight: 500 }}>
          {nextWaypoint}
        </span>
      </div>
    </div>
  );
}
