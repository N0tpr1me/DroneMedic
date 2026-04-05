/**
 * useEONET — Fetches natural disaster events from NASA EONET API.
 * Used to display real-world hazards (wildfires, storms, volcanoes) on the dashboard.
 */

import { useCallback, useEffect, useState } from 'react';

export interface EONETEvent {
  id: string;
  title: string;
  categories: Array<{ id: string; title: string }>;
  geometry: Array<{ date: string; type: string; coordinates: [number, number] }>;
  link: string;
}

interface UseEONETOptions {
  limit?: number;
  days?: number;
}

export function useEONET({ limit = 20, days = 30 }: UseEONETOptions = {}) {
  const [events, setEvents] = useState<EONETEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `https://eonet.gsfc.nasa.gov/api/v3/events?limit=${limit}&days=${days}&status=open`
      );
      if (!res.ok) throw new Error(`EONET API error: ${res.status}`);
      const data = await res.json();
      setEvents(data.events || []);
    } catch (e: any) {
      setError(e.message || 'Failed to fetch EONET events');
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [limit, days]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  return { events, loading, error, refetch: fetchEvents };
}
