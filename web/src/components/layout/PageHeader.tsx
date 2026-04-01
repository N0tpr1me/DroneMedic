import { useNavigate } from 'react-router-dom';
import { HudStatus } from '../ui/hud-status';
import type { ComponentType } from 'react';

interface PageHeaderProps {
  title: string;
  icon: ComponentType<{ size?: number; style?: React.CSSProperties }>;
  statusVariant?: 'idle' | 'planning' | 'flying' | 'rerouting' | 'completed' | 'emergency';
}

export function PageHeader({ title, icon: Icon, statusVariant = 'idle' }: PageHeaderProps) {
  const navigate = useNavigate();

  return (
    <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', height: 64, borderBottom: '1px solid rgba(67,70,84,0.15)', background: 'rgba(15,20,24,0.80)', backdropFilter: 'blur(20px)', flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <span onClick={() => navigate('/dashboard')} style={{ fontFamily: 'Space Grotesk', fontSize: 18, fontWeight: 900, color: '#dfe3e9', textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer' }}>DroneMedic</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon size={20} style={{ color: '#00daf3' }} />
        <h1 style={{ fontFamily: 'Space Grotesk', fontSize: 16, fontWeight: 700, color: '#dfe3e9', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>{title}</h1>
      </div>
      <HudStatus variant={statusVariant} />
    </header>
  );
}
