interface SkeletonProps {
  variant?: 'text' | 'card' | 'circle' | 'chart' | 'rect';
  width?: string | number;
  height?: string | number;
  className?: string;
  count?: number;
}

function toSize(value: string | number | undefined): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === 'number' ? `${value}px` : value;
}

const BASE = 'animate-pulse rounded';
const BG = 'bg-[rgba(67,70,84,0.3)]';

export function Skeleton({
  variant = 'text',
  width,
  height,
  className = '',
  count = 1,
}: SkeletonProps) {
  const style: React.CSSProperties = {
    width: toSize(width),
    height: toSize(height),
  };

  if (variant === 'text') {
    const items = Array.from({ length: count }, (_, i) => (
      <div
        key={i}
        className={`${BASE} ${BG} h-4 w-full rounded ${className}`}
        style={i === 0 ? style : { ...style, width: style.width ?? (i === count - 1 ? '60%' : '100%') }}
      />
    ));
    return count > 1 ? <div className="flex flex-col gap-2">{items}</div> : items[0];
  }

  if (variant === 'card') {
    return (
      <div
        className={`${BASE} ${BG} h-48 w-full rounded-xl ${className}`}
        style={style}
      />
    );
  }

  if (variant === 'circle') {
    return (
      <div
        className={`${BASE} ${BG} w-12 h-12 rounded-full ${className}`}
        style={style}
      />
    );
  }

  if (variant === 'chart') {
    return (
      <div
        className={`${BASE} ${BG} h-32 w-full rounded-xl overflow-hidden relative ${className}`}
        style={style}
      >
        {/* Wavy line pattern */}
        <svg
          className="absolute inset-0 w-full h-full opacity-20"
          viewBox="0 0 200 80"
          preserveAspectRatio="none"
        >
          <path
            d="M0,60 C30,40 50,55 80,35 C110,15 130,50 160,30 C190,10 200,40 200,40"
            fill="none"
            stroke="rgba(67,70,84,0.5)"
            strokeWidth="2"
          />
          <path
            d="M0,70 C40,55 60,65 100,45 C140,25 170,60 200,50"
            fill="none"
            stroke="rgba(67,70,84,0.4)"
            strokeWidth="1.5"
          />
        </svg>
      </div>
    );
  }

  // rect (default fallback)
  return (
    <div
      className={`${BASE} ${BG} rounded-lg ${className}`}
      style={{ width: toSize(width) ?? '100%', height: toSize(height) ?? '48px', ...style }}
    />
  );
}

/* ── Compound skeletons ── */

export function SkeletonDroneCard() {
  return (
    <div className="glass-panel rounded-xl p-5 flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <Skeleton variant="circle" width={40} height={40} />
        <div className="flex-1 flex flex-col gap-2">
          <Skeleton variant="text" width="50%" />
          <Skeleton variant="text" width="30%" className="h-3" />
        </div>
      </div>
      <Skeleton variant="rect" height={6} className="rounded-full" />
      <div className="flex justify-between">
        <Skeleton variant="text" width="25%" className="h-3" />
        <Skeleton variant="text" width="20%" className="h-3" />
      </div>
    </div>
  );
}

export function SkeletonKPICard() {
  return (
    <div className="glass-panel rounded-xl p-5 flex flex-col gap-3">
      <Skeleton variant="text" width="40%" className="h-3" />
      <Skeleton variant="text" width="60%" className="h-8" />
      <Skeleton variant="rect" height={4} className="rounded-full" />
    </div>
  );
}

export function SkeletonFlightLog() {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="glass-sm rounded-lg px-4 py-3 flex items-center gap-3">
          <Skeleton variant="circle" width={28} height={28} />
          <div className="flex-1 flex flex-col gap-1.5">
            <Skeleton variant="text" width={`${70 - i * 8}%`} />
            <Skeleton variant="text" width="35%" className="h-3" />
          </div>
          <Skeleton variant="text" width={48} className="h-3" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonMap() {
  return (
    <div className={`${BASE} ${BG} w-full h-full min-h-[300px] rounded-xl relative overflow-hidden`}>
      {/* Simulated map grid */}
      <div className="absolute inset-0 blueprint-grid" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-3">
        <Skeleton variant="circle" width={48} height={48} />
        <Skeleton variant="text" width={96} className="h-3" />
      </div>
    </div>
  );
}
