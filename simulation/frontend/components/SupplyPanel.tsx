import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Package,
  Thermometer,
  Weight,
  ChevronDown,
  Truck,
  CheckCircle2,
  Clock,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { GlassPanel } from '../ui/GlassPanel';

// ── Types ──

type DeliveryStatus = 'pending' | 'in_transit' | 'delivered' | 'failed';

interface SupplyItem {
  name: string;
  weight_kg: number;
  cold_chain: boolean;
  temperature_c?: number;
  status: DeliveryStatus;
}

interface DronePayload {
  drone_id: string;
  supplies: SupplyItem[];
  max_payload_kg: number;
  current_weight_kg: number;
}

interface CustodyEvent {
  time: string;
  event: string;
  actor: string;
}

interface SupplyPanelProps {
  /** Drone payloads to display; uses demo data if not provided */
  payloads?: DronePayload[];
  /** Chain of custody timeline events */
  custodyTimeline?: CustodyEvent[];
}

// ── Status Config ──

const STATUS_CONFIG: Record<
  DeliveryStatus,
  { label: string; color: string; bg: string; border: string; icon: typeof CheckCircle2 }
> = {
  pending: {
    label: 'Pending',
    color: 'text-yellow-400',
    bg: 'bg-yellow-500/10',
    border: 'border-yellow-500/20',
    icon: Clock,
  },
  in_transit: {
    label: 'In Transit',
    color: 'text-blue-400',
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/20',
    icon: Loader2,
  },
  delivered: {
    label: 'Delivered',
    color: 'text-green-400',
    bg: 'bg-green-500/10',
    border: 'border-green-500/20',
    icon: CheckCircle2,
  },
  failed: {
    label: 'Failed',
    color: 'text-red-400',
    bg: 'bg-red-500/10',
    border: 'border-red-500/20',
    icon: AlertCircle,
  },
};

// ── Demo Data ──

const DEMO_PAYLOADS: DronePayload[] = [
  {
    drone_id: 'DM-01',
    max_payload_kg: 5.0,
    current_weight_kg: 2.8,
    supplies: [
      { name: 'Blood Pack (O-)', weight_kg: 0.5, cold_chain: true, temperature_c: 4.2, status: 'in_transit' },
      { name: 'Defibrillator', weight_kg: 2.0, cold_chain: false, status: 'in_transit' },
      { name: 'First Aid Kit', weight_kg: 0.3, cold_chain: false, status: 'pending' },
    ],
  },
  {
    drone_id: 'DM-02',
    max_payload_kg: 5.0,
    current_weight_kg: 0.7,
    supplies: [
      { name: 'Vaccine Kit', weight_kg: 0.3, cold_chain: true, temperature_c: -18.5, status: 'delivered' },
      { name: 'Insulin', weight_kg: 0.1, cold_chain: true, temperature_c: 5.1, status: 'delivered' },
      { name: 'Medication Pack', weight_kg: 0.3, cold_chain: false, status: 'delivered' },
    ],
  },
];

const DEMO_CUSTODY: CustodyEvent[] = [
  { time: '09:12', event: 'Loaded at Depot', actor: 'Logistics Team' },
  { time: '09:15', event: 'Pre-flight check passed', actor: 'DM-01 System' },
  { time: '09:16', event: 'Takeoff — en route', actor: 'DM-01 Autopilot' },
  { time: '09:28', event: 'Arrived at Clinic A', actor: 'DM-01 Autopilot' },
  { time: '09:29', event: 'Delivered to Dr. Patel', actor: 'Clinic A Staff' },
];

// ── Sub-components ──

function StatusBadge({ status }: { status: DeliveryStatus }) {
  const cfg = STATUS_CONFIG[status];
  const Icon = cfg.icon;
  return (
    <span
      className={`
        inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium
        ${cfg.bg} ${cfg.color} ${cfg.border} border
      `}
    >
      <Icon className={`w-2.5 h-2.5 ${status === 'in_transit' ? 'animate-spin' : ''}`} />
      {cfg.label}
    </span>
  );
}

function PayloadWeightBar({ current, max }: { current: number; max: number }) {
  const pct = Math.min((current / max) * 100, 100);
  const isHigh = pct > 80;

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[10px] text-on-surface-variant/60">
        <span className="flex items-center gap-1">
          <Weight className="w-3 h-3" />
          Payload
        </span>
        <span className={isHigh ? 'text-amber-400' : ''}>
          {current.toFixed(1)} / {max.toFixed(1)} kg
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-black/30 overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          className={`h-full rounded-full ${
            isHigh
              ? 'bg-gradient-to-r from-amber-500 to-red-500'
              : 'bg-gradient-to-r from-cyan-500 to-blue-500'
          }`}
        />
      </div>
    </div>
  );
}

// ── Main Component ──

export function SupplyPanel({ payloads, custodyTimeline }: SupplyPanelProps) {
  const [isOpen, setIsOpen] = useState(true);
  const dronePayloads = payloads ?? DEMO_PAYLOADS;
  const custody = custodyTimeline ?? DEMO_CUSTODY;

  return (
    <GlassPanel className="flex flex-col gap-3">
      {/* Header */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-between w-full cursor-pointer bg-transparent border-none p-0"
      >
        <div className="flex items-center gap-2 text-cyan-400">
          <Package className="w-4 h-4" />
          <span className="text-sm font-medium">Supply Inventory</span>
        </div>
        <ChevronDown
          className="w-4 h-4 text-on-surface-variant/50 transition-transform duration-200"
          style={{ transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }}
        />
      </button>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden flex flex-col gap-3"
          >
            {/* Drone Payloads */}
            {dronePayloads.map((drone) => (
              <div
                key={drone.drone_id}
                className="rounded-xl bg-black/20 border border-outline-variant/10 p-3 space-y-2.5"
              >
                {/* Drone header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Truck className="w-3.5 h-3.5 text-on-surface-variant/60" />
                    <span className="text-xs font-semibold">{drone.drone_id}</span>
                  </div>
                  <span className="text-[10px] text-on-surface-variant/40">
                    {drone.supplies.length} items
                  </span>
                </div>

                {/* Weight bar */}
                <PayloadWeightBar current={drone.current_weight_kg} max={drone.max_payload_kg} />

                {/* Supply list */}
                <div className="space-y-1.5">
                  {drone.supplies.map((supply, idx) => (
                    <div
                      key={`${drone.drone_id}-${idx}`}
                      className="flex items-center justify-between text-xs"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="truncate text-on-surface-variant/80">
                          {supply.name}
                        </span>
                        {supply.cold_chain && supply.temperature_c !== undefined && (
                          <span className="flex items-center gap-0.5 text-[10px] text-blue-400 shrink-0">
                            <Thermometer className="w-2.5 h-2.5" />
                            {supply.temperature_c.toFixed(1)}&deg;C
                          </span>
                        )}
                      </div>
                      <StatusBadge status={supply.status} />
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {/* Chain of Custody Timeline */}
            <div className="space-y-2">
              <span className="text-[10px] font-medium text-on-surface-variant/50 uppercase tracking-wider">
                Chain of Custody
              </span>
              <div className="relative pl-4">
                {/* Timeline line */}
                <div className="absolute left-[5px] top-1 bottom-1 w-px bg-outline-variant/20" />

                {custody.map((evt, idx) => {
                  const isLast = idx === custody.length - 1;
                  return (
                    <motion.div
                      key={`custody-${idx}`}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.05 }}
                      className="relative flex items-start gap-2.5 pb-2 last:pb-0"
                    >
                      {/* Dot */}
                      <div
                        className={`
                          absolute -left-4 top-1 w-2.5 h-2.5 rounded-full border-2
                          ${isLast
                            ? 'bg-green-400 border-green-400/40'
                            : 'bg-surface-dim border-outline-variant/30'
                          }
                        `}
                      />
                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2">
                          <span className="text-[10px] text-on-surface-variant/40 tabular-nums shrink-0">
                            {evt.time}
                          </span>
                          <span className="text-xs text-on-surface-variant/80 truncate">
                            {evt.event}
                          </span>
                        </div>
                        <span className="text-[10px] text-on-surface-variant/40">
                          {evt.actor}
                        </span>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </GlassPanel>
  );
}
