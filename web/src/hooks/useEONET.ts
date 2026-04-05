import { useState, useEffect, useCallback } from 'react';

// ── NASA EONET (Earth Observatory Natural Event Tracker) ──
// Free API, no key required. Returns real-time natural disasters with coordinates.

export interface EONETGeometry {
  magnitudeValue: number | null;
  magnitudeUnit: string | null;
  date: string;
  type: 'Point';
  coordinates: [number, number]; // [lon, lat]
}

export interface EONETCategory {
  id: string;
  title: string;
}

export interface EONETEvent {
  id: string;
  title: string;
  description: string | null;
  link: string;
  closed: string | null;
  categories: EONETCategory[];
  geometry: EONETGeometry[];
}

export interface EONETState {
  events: EONETEvent[];
  loading: boolean;
  error: string | null;
  lastFetched: number | null;
}

const EONET_API = 'https://eonet.gsfc.nasa.gov/api/v3/events';

// Category → icon/color mapping for map markers
export const EONET_CATEGORY_STYLES: Record<string, { color: string; icon: string; label: string }> = {
  wildfires:       { color: '#ff6b35', icon: '🔥', label: 'Wildfire' },
  severeStorms:    { color: '#8b5cf6', icon: '⛈️', label: 'Severe Storm' },
  volcanoes:       { color: '#ef4444', icon: '🌋', label: 'Volcano' },
  earthquakes:     { color: '#f59e0b', icon: '🫨', label: 'Earthquake' },
  floods:          { color: '#3b82f6', icon: '🌊', label: 'Flood' },
  landslides:      { color: '#a16207', icon: '⛰️', label: 'Landslide' },
  snow:            { color: '#e2e8f0', icon: '❄️', label: 'Snow' },
  drought:         { color: '#d97706', icon: '☀️', label: 'Drought' },
  dustHaze:        { color: '#9ca3af', icon: '🌫️', label: 'Dust/Haze' },
  tempExtremes:    { color: '#dc2626', icon: '🌡️', label: 'Temperature Extreme' },
  seaLakeIce:      { color: '#06b6d4', icon: '🧊', label: 'Sea/Lake Ice' },
  waterColor:      { color: '#059669', icon: '💧', label: 'Water Color' },
  manmade:         { color: '#6b7280', icon: '🏭', label: 'Manmade' },
};

export function getCategoryStyle(categoryId: string) {
  return EONET_CATEGORY_STYLES[categoryId] ?? { color: '#6b7280', icon: '⚠️', label: categoryId };
}

export function useEONET(options: { limit?: number; days?: number; status?: 'open' | 'closed' } = {}) {
  const { limit = 30, days = 60, status = 'open' } = options;

  const [state, setState] = useState<EONETState>({
    events: [],
    loading: true,
    error: null,
    lastFetched: null,
  });

  const fetchEvents = useCallback(async () => {
    setState(prev => ({ ...prev, loading: true, error: null }));
    try {
      const params = new URLSearchParams({
        limit: String(limit),
        days: String(days),
        status,
      });
      const res = await fetch(`${EONET_API}?${params}`);
      if (!res.ok) throw new Error(`EONET API error: ${res.status}`);
      const data = await res.json();
      setState({
        events: data.events ?? [],
        loading: false,
        error: null,
        lastFetched: Date.now(),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to fetch EONET events';
      setState(prev => ({ ...prev, loading: false, error: message }));
    }
  }, [limit, days, status]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  return { ...state, refetch: fetchEvents };
}
