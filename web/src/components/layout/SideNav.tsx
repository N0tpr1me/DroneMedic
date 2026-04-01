import { useNavigate } from 'react-router-dom';
import { HeartPulse, PlaneTakeoff, ClipboardList, BarChart3, Settings } from 'lucide-react';
import { LiquidButton } from '@/components/ui/liquid-glass-button';

interface SideNavProps {
  currentPage: 'dashboard' | 'deploy' | 'logs' | 'analytics' | 'settings';
}

export function SideNav({ currentPage }: SideNavProps) {
  const navigate = useNavigate();

  const items = [
    { icon: <HeartPulse size={22} fill={currentPage === 'dashboard' ? 'currentColor' : 'none'} />, label: 'Dashboard', page: 'dashboard' as const, path: '/dashboard' },
    { icon: <PlaneTakeoff size={22} fill={currentPage === 'deploy' ? 'currentColor' : 'none'} />, label: 'Deploy', page: 'deploy' as const, path: '/deploy' },
    { icon: <ClipboardList size={22} />, label: 'Logs', page: 'logs' as const, path: '/logs' },
    { icon: <BarChart3 size={22} />, label: 'Analytics', page: 'analytics' as const, path: '/analytics' },
  ];

  return (
    <div style={{ position: 'fixed', left: 16, top: '50%', transform: 'translateY(-50%)', zIndex: 40, display: 'flex', flexDirection: 'column', gap: 6 }}>
      {items.map(item => (
        <LiquidButton
          key={item.label}
          size="sm"
          onClick={() => navigate(item.path)}
          aria-label={`Navigate to ${item.label}`}
          style={{
            color: item.page === currentPage ? '#b3c5ff' : '#c3c6d6',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
            padding: '10px 14px', height: 'auto', minWidth: 64,
          }}
        >
          {item.icon}
          <span style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', opacity: item.page === currentPage ? 1 : 0.7 }}>{item.label}</span>
        </LiquidButton>
      ))}
      <div style={{ height: 4 }} />
      <LiquidButton
        size="sm"
        onClick={() => navigate('/settings')}
        aria-label="Navigate to Settings"
        style={{ color: currentPage === 'settings' ? '#b3c5ff' : '#c3c6d6', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: '10px 14px', height: 'auto', minWidth: 64 }}
      >
        <Settings size={22} />
        <span style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', opacity: currentPage === 'settings' ? 1 : 0.7 }}>Settings</span>
      </LiquidButton>
    </div>
  );
}
