interface SpeedGaugeProps {
  value: number;
  max?: number;
  unit?: string;
  label?: string;
}

export function SpeedGauge({ value, max = 100, unit = 'km/h', label = 'Speed' }: SpeedGaugeProps) {
  const size = 100;
  const strokeWidth = 6;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.min(value / max, 1);
  const dashoffset = circumference * (1 - progress);

  return (
    <div style={{ width: size, height: size, position: 'relative' }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ transform: 'rotate(-90deg)' }}
      >
        <defs>
          <filter id="gaugeCyanGlow">
            <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="#00daf3" floodOpacity="0.6" />
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
          stroke="#00daf3"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashoffset}
          style={{
            transition: 'stroke-dashoffset 0.5s ease-out',
            filter: 'url(#gaugeCyanGlow)',
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
            fontFamily: "'Space Grotesk', sans-serif",
            fontSize: 22,
            fontWeight: 700,
            color: '#ffffff',
            lineHeight: 1,
          }}
        >
          {Math.round(value)}
        </span>
        <span
          style={{
            fontSize: 9,
            color: '#9ca3af',
            marginTop: 2,
          }}
        >
          {unit}
        </span>
        <span
          style={{
            fontSize: 8,
            color: '#6b7280',
            textTransform: 'uppercase',
            letterSpacing: 1,
            marginTop: 1,
          }}
        >
          {label}
        </span>
      </div>
    </div>
  );
}
