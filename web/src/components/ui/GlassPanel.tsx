import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

interface GlassPanelProps {
  children: ReactNode;
  glow?: boolean;
  className?: string;
}

export function GlassPanel({ children, glow, className = '' }: GlassPanelProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className={`glass-panel ${glow ? 'glow-cyan' : ''} p-5 ${className}`}
    >
      {children}
    </motion.div>
  );
}
