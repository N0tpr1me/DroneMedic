/**
 * NaturalEventsPanel — Displays real-world natural hazard events from NASA EONET.
 */

import type { EONETEvent } from '../../hooks/useEONET';

interface Props {
  events: EONETEvent[];
  loading: boolean;
  error: string | null;
  onRefetch: () => void;
}

const categoryIcons: Record<string, string> = {
  wildfires: '🔥',
  severeStorms: '🌪️',
  volcanoes: '🌋',
  floods: '🌊',
  earthquakes: '📳',
  drought: '☀️',
  landslides: '⛰️',
  seaLakeIce: '🧊',
};

function getCategoryIcon(categories: EONETEvent['categories']): string {
  for (const cat of categories) {
    if (categoryIcons[cat.id]) return categoryIcons[cat.id];
  }
  return '⚠️';
}

export function NaturalEventsPanel({ events, loading, error, onRefetch }: Props) {
  return (
    <section style={{
      background: 'rgba(30,35,40,0.85)',
      backdropFilter: 'blur(24px)',
      borderRadius: 8,
      padding: 16,
      border: '1px solid rgba(67,70,84,0.25)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ fontFamily: 'Space Grotesk', fontSize: 12, fontWeight: 700, color: '#f5a623', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>
          Natural Events
        </h3>
        <button
          onClick={onRefetch}
          style={{ fontSize: 10, color: '#8d90a0', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
        >
          Refresh
        </button>
      </div>

      {loading && (
        <p style={{ fontSize: 11, color: '#8d90a0', margin: 0 }}>Loading EONET data...</p>
      )}

      {error && (
        <p style={{ fontSize: 11, color: '#ff6b6b', margin: 0 }}>{error}</p>
      )}

      {!loading && !error && events.length === 0 && (
        <p style={{ fontSize: 11, color: '#8d90a0', margin: 0 }}>No active events</p>
      )}

      <div style={{ maxHeight: 180, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {events.slice(0, 8).map((event) => (
          <div key={event.id} style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '6px 8px', borderRadius: 6,
            background: 'rgba(245,166,35,0.08)',
            border: '1px solid rgba(245,166,35,0.15)',
          }}>
            <span style={{ fontSize: 16 }}>{getCategoryIcon(event.categories)}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 11, fontWeight: 600, color: '#dfe3e9', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {event.title}
              </p>
              <p style={{ fontSize: 9, color: '#8d90a0', margin: 0 }}>
                {event.categories.map(c => c.title).join(', ')}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
