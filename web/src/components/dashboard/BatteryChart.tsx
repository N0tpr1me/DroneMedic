import { useEffect, useRef, useState } from 'react';
import { Area, AreaChart } from 'recharts';

interface BatteryDataPoint {
  time: number;
  battery: number;
}

interface BatteryChartProps {
  history: BatteryDataPoint[];
  currentBattery: number;
}

export function BatteryChart({ history, currentBattery }: BatteryChartProps) {
  const [internalHistory, setInternalHistory] = useState<BatteryDataPoint[]>(
    () => (history.length > 0 ? history : [{ time: Date.now(), battery: currentBattery }]),
  );
  const prevBatteryRef = useRef(currentBattery);

  useEffect(() => {
    if (prevBatteryRef.current !== currentBattery) {
      prevBatteryRef.current = currentBattery;
      setInternalHistory((prev) => {
        const next = [...prev, { time: Date.now(), battery: currentBattery }];
        // Keep last 60 data points to avoid unbounded growth
        return next.length > 60 ? next.slice(next.length - 60) : next;
      });
    }
  }, [currentBattery]);

  // Merge external history with internal history, preferring the longer one
  const data = history.length > internalHistory.length ? history : internalHistory;

  return (
    <div style={{ width: 280, height: 80 }}>
      <AreaChart
        width={280}
        height={80}
        data={data}
        margin={{ top: 4, right: 4, bottom: 4, left: 4 }}
      >
        <defs>
          <linearGradient id="batteryGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#00daf3" stopOpacity={0.2} />
            <stop offset="100%" stopColor="#00daf3" stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey="battery"
          stroke="#00daf3"
          strokeWidth={1.5}
          fill="url(#batteryGradient)"
          isAnimationActive={false}
          dot={false}
        />
      </AreaChart>
    </div>
  );
}
