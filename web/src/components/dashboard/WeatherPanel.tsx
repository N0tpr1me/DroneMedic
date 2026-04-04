import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Cloud, Wind, Droplets, Eye, AlertTriangle, CheckCircle, ChevronDown } from 'lucide-react';
import { GlassPanel } from '../ui/GlassPanel';
import type { Weather } from '../../lib/api';

interface WeatherPanelProps {
  weather: Record<string, Weather>;
}

export function WeatherPanel({ weather }: WeatherPanelProps) {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <GlassPanel className="flex flex-col gap-3">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-between w-full cursor-pointer bg-transparent border-none p-0"
      >
        <div className="flex items-center gap-2 text-accent-blue">
          <Cloud className="w-4 h-4" />
          <span className="text-sm font-medium">Weather Status</span>
        </div>
        <ChevronDown
          className="w-4 h-4 text-text-muted transition-transform duration-200"
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
            className="overflow-hidden"
          >
            <div className="flex flex-col gap-2 max-h-64 overflow-y-auto">
        {Object.entries(weather).map(([name, w]) => (
          <motion.div
            key={name}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            className={`p-3 rounded-xl text-xs ${
              w.flyable
                ? 'bg-accent-green/5 border border-accent-green/10'
                : 'bg-accent-red/5 border border-accent-red/10'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium text-sm">{name}</span>
              {w.flyable ? (
                <CheckCircle className="w-3.5 h-3.5 text-accent-green" />
              ) : (
                <AlertTriangle className="w-3.5 h-3.5 text-accent-red" />
              )}
            </div>
            <div className="grid grid-cols-3 gap-2 text-text-muted">
              <div className="flex items-center gap-1">
                <Wind className="w-3 h-3" />
                {w.wind_speed} m/s
              </div>
              <div className="flex items-center gap-1">
                <Droplets className="w-3 h-3" />
                {w.precipitation} mm/h
              </div>
              <div className="flex items-center gap-1">
                <Eye className="w-3 h-3" />
                {(w.visibility / 1000).toFixed(0)}km
              </div>
            </div>
            {w.alerts.length > 0 && (
              <div className="mt-2 text-accent-red">{w.alerts[0]}</div>
            )}
          </motion.div>
        ))}
      </div>
          </motion.div>
        )}
      </AnimatePresence>
    </GlassPanel>
  );
}
