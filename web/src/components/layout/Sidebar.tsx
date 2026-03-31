import { useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { HeartPulse, Crosshair, ClipboardList, BarChart3, Send, Settings } from 'lucide-react';

interface SidebarProps {
  activeNav: string;
  onNavSelect: (id: string) => void;
  onDeploy: () => void;
  isDeployDisabled: boolean;
  onSendMessage?: (message: string) => void;
  isBusy?: boolean;
}

interface NavItem {
  id: string;
  icon: (filled: boolean) => ReactNode;
  label: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'live-ops', icon: (filled) => <HeartPulse size={22} {...(filled ? { fill: 'currentColor' } : {})} />, label: 'Live Ops' },
  { id: 'fleet', icon: (filled) => <Crosshair size={22} {...(filled ? { fill: 'currentColor' } : {})} />, label: 'Fleet Status' },
  { id: 'logs', icon: (filled) => <ClipboardList size={22} {...(filled ? { fill: 'currentColor' } : {})} />, label: 'Mission Logs' },
  { id: 'analytics', icon: (filled) => <BarChart3 size={22} {...(filled ? { fill: 'currentColor' } : {})} />, label: 'Analytics' },
];

export function Sidebar({ activeNav, onNavSelect, onDeploy, isDeployDisabled, onSendMessage, isBusy }: SidebarProps) {
  const [input, setInput] = useState('');

  const handleSend = () => {
    if (!input.trim() || !onSendMessage) return;
    onSendMessage(input.trim());
    setInput('');
  };

  return (
    <aside className="h-screen w-64 fixed left-0 top-0 z-40 bg-[#171c20] border-r border-[#434654]/15 flex-col pb-8 hidden lg:flex" style={{ paddingTop: '80px' }}>
      <div className="px-6 mb-8">
        <h2 className="font-headline text-xl font-bold text-[#dfe3e9]">Mission Control</h2>
        <p className="text-xs font-medium uppercase tracking-wider text-[#c3c6d6]/60">
          Sentinel v4.2
        </p>
      </div>

      <nav className="flex-1">
        {NAV_ITEMS.map((item) => {
          const isActive = item.id === activeNav;
          return (
            <button
              key={item.id}
              onClick={() => onNavSelect(item.id)}
              className={`
                w-full py-4 px-6 flex items-center gap-4 transition-all duration-300 cursor-pointer text-left
                ${isActive
                  ? 'bg-gradient-to-r from-primary/10 to-transparent border-l-4 border-primary text-primary'
                  : 'text-[#c3c6d6] opacity-60 hover:bg-[#262b2f] hover:opacity-100 hover:translate-x-1 border-l-4 border-transparent'
                }
              `}
            >
              {item.icon(isActive)}
              <span className="font-label text-xs font-medium uppercase tracking-wider">
                {item.label}
              </span>
            </button>
          );
        })}
      </nav>

      <div className="px-6 mt-auto space-y-4">
        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={onDeploy}
          disabled={isDeployDisabled}
          className="w-full py-3 btn-primary-gradient text-on-primary-fixed font-bold rounded-md shadow-lg shadow-primary-container/20 uppercase text-xs tracking-widest cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Deploy Drone
        </motion.button>

        {/* Mission input */}
        {onSendMessage && (
          <div className="flex gap-2 items-center">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder="Describe your delivery mission..."
              disabled={isBusy}
              className="flex-1 bg-surface-container-lowest px-3 py-2 rounded text-[11px] text-on-surface placeholder:text-on-surface-variant/40 border border-outline-variant/10 focus:outline-none focus:border-primary/30 disabled:opacity-40"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || isBusy}
              className="bg-surface-container-highest p-2 rounded text-primary hover:bg-surface-bright cursor-pointer disabled:opacity-30"
            >
              <Send size={14} />
            </button>
          </div>
        )}

        <div className="flex items-center gap-4 text-on-surface-variant/60 hover:opacity-100 cursor-pointer transition-opacity">
          <Settings size={14} />
          <span className="font-label text-[10px] uppercase tracking-widest">System Settings</span>
        </div>
      </div>
    </aside>
  );
}
