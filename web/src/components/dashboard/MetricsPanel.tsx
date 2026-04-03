import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { TrendingDown, Zap, Battery, Shield, Clock, Route } from 'lucide-react';
import { GlassPanel } from '../ui/GlassPanel';
import type { Metrics } from '../../lib/api';

interface MetricsPanelProps {
  metrics: Metrics | null;
}

function AnimatedNumber({ value, suffix = '' }: { value: number; suffix?: string }) {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    const duration = 1200;
    const start = performance.now();
    const animate = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(value * eased);
      if (progress < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }, [value]);

  return (
    <span className="font-mono font-bold">
      {display.toFixed(1)}{suffix}
    </span>
  );
}

function MetricCard({ icon: Icon, label, value, suffix, color }: {
  icon: typeof TrendingDown;
  label: string;
  value: number;
  suffix?: string;
  color: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className="p-3 rounded-xl bg-white/5 border border-white/5"
    >
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-3.5 h-3.5" style={{ color }} />
        <span className="text-xs text-text-muted">{label}</span>
      </div>
      <div className="text-lg" style={{ color }}>
        <AnimatedNumber value={value} suffix={suffix} />
      </div>
    </motion.div>
  );
}

export function MetricsPanel({ metrics }: MetricsPanelProps) {
  if (!metrics) {
    return (
      <GlassPanel className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-text-muted">
          <TrendingDown className="w-4 h-4" />
          <span className="text-sm font-medium">Metrics</span>
        </div>
        <p className="text-xs text-text-muted">Complete a delivery to see metrics</p>
      </GlassPanel>
    );
  }

  return (
    <GlassPanel className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-accent-green">
        <TrendingDown className="w-4 h-4" />
        <span className="text-sm font-medium">Delivery Metrics</span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <MetricCard
          icon={Clock}
          label="Time Saved"
          value={metrics.delivery_time_reduction}
          suffix="%"
          color="#22c55e"
        />
        <MetricCard
          icon={Route}
          label="Distance Saved"
          value={metrics.distance_reduction}
          suffix="%"
          color="#00e5ff"
        />
        <MetricCard
          icon={Battery}
          label="Battery Used"
          value={metrics.battery_used}
          suffix="%"
          color="#f59e0b"
        />
        <MetricCard
          icon={Shield}
          label="Robustness"
          value={metrics.robustness_score * 100}
          suffix="%"
          color="#3b82f6"
        />
        <MetricCard
          icon={Zap}
          label="Reroute Success"
          value={metrics.reroute_success_rate}
          suffix="%"
          color="#22c55e"
        />
        <MetricCard
          icon={TrendingDown}
          label="Deliveries"
          value={metrics.throughput}
          color="#00e5ff"
        />
      </div>
    </GlassPanel>
  );
}
