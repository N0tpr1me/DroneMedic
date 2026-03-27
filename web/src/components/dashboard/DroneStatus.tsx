import { motion } from 'framer-motion';
import { Battery, MapPin, Navigation } from 'lucide-react';
import { GlassPanel } from '../ui/GlassPanel';

interface DroneStatusProps {
  battery: number;
  currentLocation: string;
  status: 'idle' | 'planning' | 'flying' | 'rerouting' | 'completed';
  routeStops?: string[];
  currentStopIndex?: number;
}

const statusConfig = {
  idle: { label: 'Idle', color: '#6b7280', pulse: false },
  planning: { label: 'Planning Route...', color: '#f59e0b', pulse: true },
  flying: { label: 'In Flight', color: '#00e5ff', pulse: true },
  rerouting: { label: 'Rerouting...', color: '#f59e0b', pulse: true },
  completed: { label: 'Mission Complete', color: '#22c55e', pulse: false },
};

export function DroneStatus({ battery, currentLocation, status, routeStops, currentStopIndex }: DroneStatusProps) {
  const config = statusConfig[status];

  return (
    <GlassPanel className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Navigation className="w-4 h-4 text-accent-cyan" />
        <span className="text-sm font-medium">Drone Status</span>
      </div>

      {/* Status indicator */}
      <div className="flex items-center gap-3">
        <div className="relative">
          <div
            className="w-3 h-3 rounded-full"
            style={{ backgroundColor: config.color }}
          />
          {config.pulse && (
            <motion.div
              animate={{ scale: [1, 2], opacity: [0.5, 0] }}
              transition={{ duration: 1.5, repeat: Infinity }}
              className="absolute inset-0 rounded-full"
              style={{ backgroundColor: config.color }}
            />
          )}
        </div>
        <span className="text-sm font-medium" style={{ color: config.color }}>
          {config.label}
        </span>
      </div>

      {/* Battery gauge */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between text-xs">
          <span className="flex items-center gap-1 text-text-muted">
            <Battery className="w-3 h-3" /> Battery
          </span>
          <span className="font-mono" style={{
            color: battery > 50 ? '#22c55e' : battery > 20 ? '#f59e0b' : '#ef4444'
          }}>
            {battery.toFixed(0)}%
          </span>
        </div>
        <div className="h-2 bg-white/10 rounded-full overflow-hidden">
          <motion.div
            className="h-full rounded-full"
            style={{
              backgroundColor: battery > 50 ? '#22c55e' : battery > 20 ? '#f59e0b' : '#ef4444',
            }}
            animate={{ width: `${battery}%` }}
            transition={{ duration: 0.5 }}
          />
        </div>
      </div>

      {/* Location */}
      <div className="flex items-center gap-2 text-xs text-text-muted">
        <MapPin className="w-3 h-3" />
        <span>{currentLocation}</span>
      </div>

      {/* Route progress */}
      {routeStops && routeStops.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-xs text-text-muted">Route Progress</span>
          <div className="flex gap-1">
            {routeStops.map((stop, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <div
                  className="w-full h-1 rounded-full"
                  style={{
                    backgroundColor:
                      currentStopIndex !== undefined && i <= currentStopIndex
                        ? '#00e5ff'
                        : 'rgba(255,255,255,0.1)',
                  }}
                />
                <span className="text-[9px] text-text-muted truncate w-full text-center">
                  {stop.replace('Clinic ', '')}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </GlassPanel>
  );
}
