import { useState } from 'react';
import type { EONETEvent } from '../../hooks/useEONET';
import { getCategoryStyle } from '../../hooks/useEONET';

interface NaturalEventsPanelProps {
  events: EONETEvent[];
  loading: boolean;
  error: string | null;
  onRefetch: () => void;
}

export function NaturalEventsPanel({ events, loading, error, onRefetch }: NaturalEventsPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const displayEvents = expanded ? events : events.slice(0, 4);

  // Count by category
  const categoryCounts: Record<string, number> = {};
  for (const event of events) {
    const catId = event.categories[0]?.id ?? 'unknown';
    categoryCounts[catId] = (categoryCounts[catId] ?? 0) + 1;
  }

  return (
    <section style={{
      background: 'rgba(30,35,40,0.85)',
      backdropFilter: 'blur(24px)',
      WebkitBackdropFilter: 'blur(24px)',
      borderRadius: 8,
      padding: 20,
      border: '1px solid rgba(67,70,84,0.25)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{
          fontFamily: 'Space Grotesk',
          fontSize: 14,
          fontWeight: 700,
          letterSpacing: '0.02em',
          color: '#ff6b35',
          textTransform: 'uppercase',
          margin: 0,
        }}>
          Natural Events
        </h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontSize: 10,
            background: 'rgba(255,107,53,0.2)',
            color: '#ff6b35',
            padding: '2px 8px',
            borderRadius: 4,
          }}>
            {events.length} ACTIVE
          </span>
          <button
            onClick={onRefetch}
            disabled={loading}
            style={{
              background: 'none',
              border: 'none',
              color: '#8d90a0',
              cursor: 'pointer',
              fontSize: 10,
              padding: '2px 4px',
              opacity: loading ? 0.5 : 1,
            }}
          >
            {loading ? '...' : '↻'}
          </button>
          <button
            onClick={() => setMinimized(!minimized)}
            style={{
              background: 'none',
              border: 'none',
              color: '#8d90a0',
              cursor: 'pointer',
              fontSize: 12,
              padding: '2px 4px',
              transition: 'transform 0.2s ease',
              transform: minimized ? 'rotate(-90deg)' : 'rotate(0deg)',
            }}
            title={minimized ? 'Expand panel' : 'Minimize panel'}
          >
            ▼
          </button>
        </div>
      </div>

      {!minimized && (
        <>
          {/* Category summary chips */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
            {Object.entries(categoryCounts).map(([catId, count]) => {
              const style = getCategoryStyle(catId);
              return (
                <span key={catId} style={{
                  fontSize: 9,
                  padding: '2px 6px',
                  borderRadius: 4,
                  background: `${style.color}22`,
                  color: style.color,
                  fontWeight: 600,
                }}>
                  {style.icon} {count}
                </span>
              );
            })}
          </div>

          {error && (
            <p style={{ fontSize: 10, color: '#ff4444', margin: '0 0 8px' }}>{error}</p>
          )}

          {/* Event list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {displayEvents.map((event) => {
              const categoryId = event.categories[0]?.id ?? 'unknown';
              const style = getCategoryStyle(categoryId);
              const latestGeo = event.geometry[event.geometry.length - 1];
              const date = latestGeo ? new Date(latestGeo.date).toLocaleDateString() : '';
              const magnitude = latestGeo?.magnitudeValue
                ? `${latestGeo.magnitudeValue} ${latestGeo.magnitudeUnit ?? ''}`
                : null;

              return (
                <div key={event.id} style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  padding: '8px 0',
                  borderBottom: '1px solid rgba(67,70,84,0.1)',
                }}>
                  <span style={{
                    fontSize: 16,
                    width: 28,
                    height: 28,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: `${style.color}22`,
                    borderRadius: 6,
                    flexShrink: 0,
                  }}>
                    {style.icon}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: '#dfe3e9',
                      margin: '0 0 2px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {event.title}
                    </p>
                    <p style={{ fontSize: 9, color: '#8d90a0', margin: 0 }}>
                      {style.label} &bull; {date}
                      {magnitude && <> &bull; {magnitude}</>}
                    </p>
                  </div>
                  <span style={{
                    fontSize: 8,
                    padding: '1px 5px',
                    borderRadius: 3,
                    background: event.closed ? 'rgba(107,114,128,0.2)' : 'rgba(255,107,53,0.15)',
                    color: event.closed ? '#6b7280' : '#ff6b35',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    flexShrink: 0,
                  }}>
                    {event.closed ? 'Closed' : 'Active'}
                  </span>
                </div>
              );
            })}
          </div>

          {events.length > 4 && (
            <button
              onClick={() => setExpanded(!expanded)}
              style={{
                marginTop: 8,
                background: 'none',
                border: 'none',
                color: '#b3c5ff',
                fontSize: 10,
                cursor: 'pointer',
                padding: 0,
                fontWeight: 600,
              }}
            >
              {expanded ? 'Show less' : `Show all ${events.length} events`}
            </button>
          )}

          <p style={{ fontSize: 8, color: '#6b7280', margin: '8px 0 0', textAlign: 'right' }}>
            NASA EONET v3
          </p>
        </>
      )}
    </section>
  );
}
