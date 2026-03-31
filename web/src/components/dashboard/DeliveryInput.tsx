import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Sparkles, Package, AlertTriangle } from 'lucide-react';
import { Button } from '../ui/Button';
import { GlassPanel } from '../ui/GlassPanel';
import type { Task } from '../../lib/api';

interface DeliveryInputProps {
  onSubmit: (input: string) => Promise<void>;
  parsedTask: Task | null;
  loading: boolean;
}

export function DeliveryInput({ onSubmit, parsedTask, loading }: DeliveryInputProps) {
  const [input, setInput] = useState('');

  const handleSubmit = () => {
    if (!input.trim()) return;
    onSubmit(input.trim());
  };

  return (
    <GlassPanel className="flex flex-col gap-4">
      <div className="flex items-center gap-2 text-accent-cyan">
        <Sparkles className="w-4 h-4" />
        <span className="text-sm font-medium">AI Delivery Request</span>
      </div>

      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Deliver O- plasma to Royal London urgently, insulin to Homerton, and defibrillator pads to Whipps Cross..."
        className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-sm text-text-primary placeholder-text-muted resize-none h-24 focus:outline-none focus:border-accent-cyan/50 transition-colors"
      />

      <Button onClick={handleSubmit} loading={loading} disabled={!input.trim()}>
        <Send className="w-4 h-4" />
        Parse with AI
      </Button>

      <AnimatePresence>
        {parsedTask && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="flex flex-col gap-2"
          >
            <div className="text-xs text-text-muted uppercase tracking-wider">Parsed Deliveries</div>
            {parsedTask.locations.map((loc) => (
              <div
                key={loc}
                className="flex items-center gap-2 text-sm p-2 rounded-lg bg-white/5"
              >
                <Package className="w-3.5 h-3.5 text-accent-green" />
                <span className="flex-1">{loc}</span>
                {parsedTask.priorities[loc] === 'high' && (
                  <span className="flex items-center gap-1 text-xs text-accent-amber">
                    <AlertTriangle className="w-3 h-3" />
                    Urgent
                  </span>
                )}
                <span className="text-xs text-text-muted">
                  {parsedTask.supplies[loc] || 'medical supplies'}
                </span>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </GlassPanel>
  );
}
