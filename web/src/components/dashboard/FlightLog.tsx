import { motion } from 'framer-motion';
import { Activity, MapPin, Pause, Play, Battery, Plane } from 'lucide-react';
import { GlassPanel } from '../ui/GlassPanel';
import type { FlightLogEntry } from '../../lib/api';

interface FlightLogProps {
  log: FlightLogEntry[];
}

function getEventIcon(event: string) {
  if (event === 'takeoff') return Plane;
  if (event === 'landed') return MapPin;
  if (event === 'paused') return Pause;
  if (event === 'resumed') return Play;
  if (event.startsWith('arrived:')) return MapPin;
  return Activity;
}

function getEventColor(event: string): string {
  if (event === 'takeoff') return '#00e5ff';
  if (event === 'landed') return '#22c55e';
  if (event === 'paused') return '#f59e0b';
  if (event === 'resumed') return '#3b82f6';
  if (event.startsWith('arrived:')) return '#22c55e';
  return '#6b7280';
}

function formatEvent(event: string): string {
  if (event.startsWith('arrived:')) return `Arrived at ${event.replace('arrived:', '')}`;
  return event.charAt(0).toUpperCase() + event.slice(1);
}

export function FlightLog({ log }: FlightLogProps) {
  return (
    <GlassPanel className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-text-muted">
        <Activity className="w-4 h-4" />
        <span className="text-sm font-medium">Flight Log</span>
        <span className="ml-auto text-xs bg-white/10 px-2 py-0.5 rounded-full">
          {log.length} events
        </span>
      </div>

      <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
        {log.length === 0 ? (
          <p className="text-xs text-text-muted">No flight events yet</p>
        ) : (
          [...log].reverse().map((entry, i) => {
            const Icon = getEventIcon(entry.event);
            const color = getEventColor(entry.event);
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                className="flex items-center gap-2 p-2 rounded-lg bg-white/3 text-xs"
              >
                <Icon className="w-3 h-3 shrink-0" style={{ color }} />
                <span className="flex-1 truncate">{formatEvent(entry.event)}</span>
                <div className="flex items-center gap-1 text-text-muted">
                  <Battery className="w-3 h-3" />
                  {entry.battery.toFixed(0)}%
                </div>
              </motion.div>
            );
          })
        )}
      </div>
    </GlassPanel>
  );
}
