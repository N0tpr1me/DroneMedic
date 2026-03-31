import { type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Route, CloudLightning, Brain } from 'lucide-react';

interface FeatureTab {
  id: string;
  icon: ReactNode;
  label: string;
  description: string;
}

const FEATURES: FeatureTab[] = [
  {
    id: 'routes',
    icon: <Route size={16} />,
    label: 'Route Optimization',
    description: 'OR-Tools VRP solver computes optimal multi-stop delivery routes for multiple drones simultaneously, minimizing delivery time.',
  },
  {
    id: 'weather',
    icon: <CloudLightning size={16} />,
    label: 'Weather Adaptation',
    description: 'Real-time weather monitoring with automatic rerouting when conditions change. Drones adapt mid-flight to storms and wind.',
  },
  {
    id: 'ai',
    icon: <Brain size={16} />,
    label: 'AI Coordination',
    description: 'Natural language mission parsing powered by Claude AI. Describe deliveries in plain English and watch them execute.',
  },
];

interface FeatureTabsProps {
  activeId: string;
  onSelect: (id: string) => void;
}

export function FeatureTabs({ activeId, onSelect }: FeatureTabsProps) {
  return (
    <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-40 flex gap-3 px-6">
      {FEATURES.map((feature) => {
        const isActive = feature.id === activeId;
        return (
          <motion.button
            key={feature.id}
            onClick={() => onSelect(feature.id)}
            layout
            className={`
              flex items-center gap-3 px-5 py-3.5 rounded-xl cursor-pointer
              border transition-all duration-500
              ${isActive
                ? 'bg-white/5 border-white/20 backdrop-blur-xl'
                : 'bg-transparent border-white/8 hover:border-white/15 backdrop-blur-sm'
              }
            `}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <span className={`transition-colors duration-300 ${isActive ? 'text-[#00daf3]' : 'text-white/40'}`}>
              {feature.icon}
            </span>

            <div className="flex flex-col items-start">
              <span className={`text-[11px] uppercase tracking-[0.15em] font-semibold transition-colors duration-300 ${isActive ? 'text-white' : 'text-white/50'}`}>
                {feature.label}
              </span>

              <AnimatePresence>
                {isActive && (
                  <motion.p
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.4, ease: 'easeInOut' }}
                    className="text-[11px] text-white/40 leading-relaxed max-w-[220px] overflow-hidden"
                  >
                    {feature.description}
                  </motion.p>
                )}
              </AnimatePresence>
            </div>
          </motion.button>
        );
      })}
    </div>
  );
}
