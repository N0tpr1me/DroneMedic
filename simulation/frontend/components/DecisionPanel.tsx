import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle,
  Cloud,
  Shield,
  Battery,
  Navigation,
  Zap,
  Info,
  ArrowRight,
} from 'lucide-react';
import { GlassPanel } from '../ui/GlassPanel';

type Severity = 'info' | 'warning' | 'critical';

interface DecisionReason {
  factor: string;
  description: string;
  severity: Severity;
  metric?: number;
  threshold?: number;
  impact: string;
}

interface RouteDecision {
  reasons: DecisionReason[];
  old_route?: string[];
  new_route?: string[];
  confidence: number;
}

interface DecisionPanelProps {
  decision: RouteDecision | null;
}

const SEVERITY_STYLES: Record<
  Severity,
  { bg: string; border: string; text: string; bar: string }
> = {
  info: {
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/20',
    text: 'text-blue-400',
    bar: 'bg-blue-500',
  },
  warning: {
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/20',
    text: 'text-amber-400',
    bar: 'bg-amber-500',
  },
  critical: {
    bg: 'bg-red-500/10',
    border: 'border-red-500/20',
    text: 'text-red-400',
    bar: 'bg-red-500',
  },
};

const FACTOR_ICONS: Record<string, React.ReactNode> = {
  weather: <Cloud className="w-4 h-4" />,
  no_fly_zone: <Shield className="w-4 h-4" />,
  battery: <Battery className="w-4 h-4" />,
  priority: <Zap className="w-4 h-4" />,
  distance: <Navigation className="w-4 h-4" />,
  obstacle: <AlertTriangle className="w-4 h-4" />,
};

function getFactorIcon(factor: string): React.ReactNode {
  const key = Object.keys(FACTOR_ICONS).find((k) =>
    factor.toLowerCase().includes(k),
  );
  return key ? FACTOR_ICONS[key] : <Info className="w-4 h-4" />;
}

function ReasonCard({ reason }: { reason: DecisionReason }) {
  const style = SEVERITY_STYLES[reason.severity];
  const hasBar =
    reason.metric !== undefined && reason.threshold !== undefined;
  const barPercent = hasBar
    ? Math.min(100, (reason.metric! / reason.threshold!) * 100)
    : 0;

  return (
    <motion.div
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      className={`rounded-xl p-3 border ${style.bg} ${style.border}`}
    >
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 ${style.text}`}>{getFactorIcon(reason.factor)}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className={`text-sm font-medium ${style.text}`}>
              {reason.factor}
            </span>
            <span
              className={`text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded ${style.bg} ${style.text}`}
            >
              {reason.severity}
            </span>
          </div>
          <p className="text-xs text-on-surface-variant mt-1">
            {reason.description}
          </p>

          {hasBar && (
            <div className="mt-2">
              <div className="flex items-center justify-between text-[10px] text-on-surface-variant mb-1">
                <span>
                  {reason.metric?.toFixed(1)} / {reason.threshold?.toFixed(1)}
                </span>
                <span>{barPercent.toFixed(0)}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${barPercent}%` }}
                  transition={{ duration: 0.6, ease: 'easeOut' }}
                  className={`h-full rounded-full ${style.bar}`}
                />
              </div>
            </div>
          )}

          <p className="text-[11px] text-on-surface-variant/70 mt-2 italic">
            Impact: {reason.impact}
          </p>
        </div>
      </div>
    </motion.div>
  );
}

export function DecisionPanel({ decision }: DecisionPanelProps) {
  if (!decision) {
    return (
      <GlassPanel className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-on-surface-variant">
          <Info className="w-4 h-4" />
          <span className="text-sm font-medium">Route Decisions</span>
        </div>
        <p className="text-xs text-on-surface-variant/60">
          No route decisions yet. Plan a route to see AI reasoning.
        </p>
      </GlassPanel>
    );
  }

  const hasRouteChange = decision.old_route && decision.new_route;

  return (
    <GlassPanel className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-tertiary">
          <Info className="w-4 h-4" />
          <span className="text-sm font-medium">Route Decisions</span>
        </div>

        {/* Confidence */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-on-surface-variant uppercase tracking-wider">
            Confidence
          </span>
          <div className="flex items-center gap-1.5">
            <div className="w-16 h-1.5 rounded-full bg-white/5 overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${decision.confidence}%` }}
                transition={{ duration: 0.8, ease: 'easeOut' }}
                className="h-full rounded-full bg-tertiary"
              />
            </div>
            <span className="text-xs font-medium text-tertiary tabular-nums">
              {decision.confidence}%
            </span>
          </div>
        </div>
      </div>

      {/* Route comparison */}
      <AnimatePresence>
        {hasRouteChange && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="rounded-xl p-3 bg-white/5 border border-outline-variant/20"
          >
            <div className="text-[10px] uppercase tracking-wider text-on-surface-variant mb-2">
              Route Change
            </div>
            <div className="flex items-center gap-3 text-xs">
              <div className="flex-1 flex flex-wrap gap-1">
                {decision.old_route!.map((loc, i) => (
                  <span key={`old-${i}`}>
                    <span className="text-on-surface-variant/60">{loc}</span>
                    {i < decision.old_route!.length - 1 && (
                      <ArrowRight className="inline w-3 h-3 mx-0.5 text-on-surface-variant/30" />
                    )}
                  </span>
                ))}
              </div>
              <ArrowRight className="w-4 h-4 text-tertiary shrink-0" />
              <div className="flex-1 flex flex-wrap gap-1">
                {decision.new_route!.map((loc, i) => (
                  <span key={`new-${i}`}>
                    <span className="text-tertiary font-medium">{loc}</span>
                    {i < decision.new_route!.length - 1 && (
                      <ArrowRight className="inline w-3 h-3 mx-0.5 text-tertiary/40" />
                    )}
                  </span>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Reason cards */}
      <div className="flex flex-col gap-2">
        {decision.reasons.map((reason, i) => (
          <ReasonCard key={`${reason.factor}-${i}`} reason={reason} />
        ))}
      </div>
    </GlassPanel>
  );
}
