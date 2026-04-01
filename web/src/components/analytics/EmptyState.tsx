import { useNavigate } from 'react-router-dom';
import { PlaneTakeoff } from 'lucide-react';
import { LiquidButton } from '@/components/ui/liquid-glass-button';

interface EmptyStateProps {
  title?: string;
  description?: string;
}

export function EmptyState({ title = 'No missions yet', description = 'Deploy your first mission to see data here.' }: EmptyStateProps) {
  const navigate = useNavigate();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh', gap: 16 }}>
      <svg width="80" height="80" viewBox="0 0 80 80" fill="none" style={{ opacity: 0.3 }}>
        <path d="M40 10L60 30L40 50L20 30Z" stroke="#00daf3" strokeWidth="2" />
        <path d="M40 50V70" stroke="#00daf3" strokeWidth="2" />
        <circle cx="40" cy="30" r="4" fill="#00daf3" opacity="0.5" />
      </svg>
      <h2 style={{ fontFamily: 'Space Grotesk', fontSize: 20, fontWeight: 700, color: '#dfe3e9', margin: 0 }}>{title}</h2>
      <p style={{ fontSize: 14, color: '#8d90a0', margin: 0 }}>{description}</p>
      <LiquidButton size="sm" onClick={() => navigate('/deploy')} style={{ color: '#00daf3', marginTop: 8 }}>
        <PlaneTakeoff size={16} />
        Deploy Mission
      </LiquidButton>
    </div>
  );
}
