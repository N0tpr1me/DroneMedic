import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { HeartPulse, PlaneTakeoff, Cpu, ClipboardList, BarChart3, Settings, Shield } from 'lucide-react';
import { LiquidButton } from '@/components/ui/liquid-glass-button';
import { NotificationCenter } from '../dashboard/NotificationCenter';
import { useRole } from '../../hooks/useRole';

interface SideNavProps {
  currentPage: 'dashboard' | 'deploy' | 'fleet' | 'logs' | 'analytics' | 'settings';
}

const NAV_ITEMS = [
  { icon: HeartPulse, label: 'Dashboard', page: 'dashboard' as const, path: '/dashboard' },
  { icon: PlaneTakeoff, label: 'Deploy', page: 'deploy' as const, path: '/deploy' },
  { icon: Cpu, label: 'Fleet', page: 'fleet' as const, path: '/fleet' },
  { icon: ClipboardList, label: 'Logs', page: 'logs' as const, path: '/logs' },
  { icon: BarChart3, label: 'Analytics', page: 'analytics' as const, path: '/analytics' },
] as const;

type Breakpoint = 'mobile' | 'tablet' | 'desktop';

function useBreakpoint(): Breakpoint {
  const [bp, setBp] = useState<Breakpoint>(() => {
    if (typeof window === 'undefined') return 'desktop';
    const w = window.innerWidth;
    if (w < 768) return 'mobile';
    if (w < 1024) return 'tablet';
    return 'desktop';
  });

  useEffect(() => {
    function handleResize() {
      const w = window.innerWidth;
      if (w < 768) setBp('mobile');
      else if (w < 1024) setBp('tablet');
      else setBp('desktop');
    }
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return bp;
}

export function SideNav({ currentPage }: SideNavProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const breakpoint = useBreakpoint();
  const [hovered, setHovered] = useState(false);

  // Derive active page from location for bottom tab bar accuracy
  const activePage = NAV_ITEMS.find(item => location.pathname.startsWith(item.path))?.page ?? currentPage;

  // ── Mobile: Bottom Tab Bar ──
  if (breakpoint === 'mobile') {
    return (
      <nav
        role="navigation"
        aria-label="Main navigation"
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          height: 64,
          zIndex: 50,
          display: 'flex',
          justifyContent: 'space-evenly',
          alignItems: 'center',
          background: 'rgba(15,20,24,0.85)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          borderTop: '1px solid rgba(67,70,84,0.15)',
        }}
      >
        {NAV_ITEMS.map(item => {
          const isActive = activePage === item.page;
          const Icon = item.icon;
          return (
            <button
              key={item.page}
              onClick={() => navigate(item.path)}
              aria-label={`Navigate to ${item.label}`}
              aria-current={isActive ? 'page' : undefined}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 2,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '6px 12px',
                color: isActive ? '#00daf3' : '#8d90a0',
                transition: 'color 0.2s',
              }}
            >
              <Icon size={20} fill={isActive ? 'currentColor' : 'none'} />
              <span style={{
                fontSize: 9,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}>
                {item.label}
              </span>
            </button>
          );
        })}
      </nav>
    );
  }

  // ── Tablet: Collapsed icon-only sidebar, expands on hover ──
  if (breakpoint === 'tablet') {
    const isExpanded = hovered;
    const sidebarWidth = isExpanded ? 160 : 64;

    return (
      <nav
        role="navigation"
        aria-label="Main navigation"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          position: 'fixed',
          left: 0,
          top: '50%',
          transform: 'translateY(-50%)',
          zIndex: 40,
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          padding: '12px 8px',
          width: sidebarWidth,
          transition: 'width 0.25s ease',
          background: 'rgba(15,20,24,0.6)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          borderRadius: '0 12px 12px 0',
          borderRight: '1px solid rgba(67,70,84,0.1)',
          overflow: 'hidden',
        }}
      >
        {NAV_ITEMS.map(item => {
          const isActive = activePage === item.page;
          const Icon = item.icon;
          return (
            <button
              key={item.page}
              onClick={() => navigate(item.path)}
              aria-label={`Navigate to ${item.label}`}
              aria-current={isActive ? 'page' : undefined}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                background: isActive ? 'rgba(0,218,243,0.1)' : 'transparent',
                border: 'none',
                borderRadius: 8,
                cursor: 'pointer',
                padding: '10px 12px',
                color: isActive ? '#00daf3' : '#c3c6d6',
                transition: 'all 0.2s',
                whiteSpace: 'nowrap',
                minHeight: 44,
              }}
            >
              <Icon size={20} fill={isActive ? 'currentColor' : 'none'} style={{ flexShrink: 0 }} />
              <span style={{
                fontSize: 11,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                opacity: isExpanded ? 1 : 0,
                transition: 'opacity 0.2s',
                overflow: 'hidden',
              }}>
                {item.label}
              </span>
            </button>
          );
        })}
        <div style={{ height: 1, background: 'rgba(67,70,84,0.15)', margin: '4px 8px' }} />
        <button
          onClick={() => navigate('/settings')}
          aria-label="Navigate to Settings"
          aria-current={activePage === ('settings' as string) ? 'page' : undefined}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            background: currentPage === 'settings' ? 'rgba(0,218,243,0.1)' : 'transparent',
            border: 'none',
            borderRadius: 8,
            cursor: 'pointer',
            padding: '10px 12px',
            color: currentPage === 'settings' ? '#00daf3' : '#c3c6d6',
            transition: 'all 0.2s',
            whiteSpace: 'nowrap',
            minHeight: 44,
          }}
        >
          <Settings size={20} style={{ flexShrink: 0 }} />
          <span style={{
            fontSize: 11,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            opacity: isExpanded ? 1 : 0,
            transition: 'opacity 0.2s',
            overflow: 'hidden',
          }}>
            Settings
          </span>
        </button>
      </nav>
    );
  }

  // ── Desktop: Original fixed left sidebar with text labels ──
  return (
    <nav
      role="navigation"
      aria-label="Main navigation"
      style={{ position: 'fixed', left: 16, top: '50%', transform: 'translateY(-50%)', zIndex: 40, display: 'flex', flexDirection: 'column', gap: 6, background: 'rgba(10,15,19,0.65)', backdropFilter: 'blur(12px)', borderRadius: 14, padding: '10px 6px', border: '1px solid rgba(255,255,255,0.08)' }}
    >
      {NAV_ITEMS.map(item => {
        const isActive = activePage === item.page;
        const Icon = item.icon;
        return (
          <LiquidButton
            key={item.label}
            size="sm"
            onClick={() => navigate(item.path)}
            aria-label={`Navigate to ${item.label}`}
            aria-current={isActive ? 'page' : undefined}
            style={{
              color: isActive ? '#b3c5ff' : '#c3c6d6',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
              padding: '10px 14px', height: 'auto', minWidth: 64,
            }}
          >
            <Icon size={22} fill={isActive ? 'currentColor' : 'none'} />
            <span style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', opacity: isActive ? 1 : 0.85 }}>{item.label}</span>
          </LiquidButton>
        );
      })}
      <LiquidButton
        size="sm"
        onClick={() => navigate('/settings')}
        aria-label="Navigate to Settings"
        aria-current={currentPage === 'settings' ? 'page' : undefined}
        style={{ color: currentPage === 'settings' ? '#b3c5ff' : '#c3c6d6', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: '10px 14px', height: 'auto', minWidth: 64 }}
      >
        <Settings size={22} />
        <span style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', opacity: currentPage === 'settings' ? 1 : 0.85 }}>Settings</span>
      </LiquidButton>
    </nav>
  );
}
