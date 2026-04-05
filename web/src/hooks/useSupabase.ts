/**
 * useSupabase — Typed Supabase data hooks with Realtime subscriptions.
 *
 * Each hook returns { data, loading, error } and cleans up subscriptions on unmount.
 * Uses the Database-typed client from lib/supabase for full type safety.
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { Tables } from '../lib/database.types';
import type { RealtimeChannel } from '@supabase/supabase-js';

// ── useDrones ──────────────────────────────────────────────────────────────────
// Subscribe to real-time drone status changes.

interface UseDronesResult {
  drones: Tables<'drones'>[];
  loading: boolean;
  error: string | null;
}

export function useDrones(): UseDronesResult {
  const [drones, setDrones] = useState<Tables<'drones'>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchInitial() {
      const { data, error: fetchError } = await supabase
        .from('drones')
        .select('*')
        .order('created_at', { ascending: false });

      if (cancelled) return;

      if (fetchError) {
        setError(fetchError.message);
        setLoading(false);
        return;
      }

      setDrones(data ?? []);
      setLoading(false);
    }

    fetchInitial();

    const channel = supabase
      .channel('drones-realtime')
      .on<Tables<'drones'>>(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'drones' },
        (payload) => {
          if (cancelled) return;

          if (payload.eventType === 'INSERT') {
            setDrones((prev) => [payload.new, ...prev]);
          } else if (payload.eventType === 'UPDATE') {
            setDrones((prev) =>
              prev.map((d) => (d.id === payload.new.id ? payload.new : d))
            );
          } else if (payload.eventType === 'DELETE' && payload.old && 'id' in payload.old) {
            setDrones((prev) => prev.filter((d) => d.id !== payload.old.id));
          }
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      cancelled = true;
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, []);

  return { drones, loading, error };
}

// ── useMissions ────────────────────────────────────────────────────────────────
// Subscribe to mission updates, optionally filtered by user_id.

interface UseMissionsResult {
  missions: Tables<'missions'>[];
  loading: boolean;
  error: string | null;
}

export function useMissions(userId?: string): UseMissionsResult {
  const [missions, setMissions] = useState<Tables<'missions'>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchInitial() {
      let query = supabase
        .from('missions')
        .select('*')
        .order('created_at', { ascending: false });

      if (userId) {
        query = query.eq('user_id', userId);
      }

      const { data, error: fetchError } = await query;

      if (cancelled) return;

      if (fetchError) {
        setError(fetchError.message);
        setLoading(false);
        return;
      }

      setMissions(data ?? []);
      setLoading(false);
    }

    fetchInitial();

    const filter = userId
      ? `user_id=eq.${userId}`
      : undefined;

    const channel = supabase
      .channel(`missions-realtime-${userId ?? 'all'}`)
      .on<Tables<'missions'>>(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'missions',
          ...(filter ? { filter } : {}),
        },
        (payload) => {
          if (cancelled) return;

          if (payload.eventType === 'INSERT') {
            setMissions((prev) => [payload.new, ...prev]);
          } else if (payload.eventType === 'UPDATE') {
            setMissions((prev) =>
              prev.map((m) => (m.id === payload.new.id ? payload.new : m))
            );
          } else if (payload.eventType === 'DELETE' && payload.old && 'id' in payload.old) {
            setMissions((prev) => prev.filter((m) => m.id !== payload.old.id));
          }
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      cancelled = true;
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [userId]);

  return { missions, loading, error };
}

// ── useDeliveries ──────────────────────────────────────────────────────────────
// Get deliveries for a mission, with real-time updates.

interface UseDeliveriesResult {
  deliveries: Tables<'deliveries'>[];
  loading: boolean;
  error: string | null;
}

export function useDeliveries(missionId?: string): UseDeliveriesResult {
  const [deliveries, setDeliveries] = useState<Tables<'deliveries'>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchInitial() {
      let query = supabase
        .from('deliveries')
        .select('*')
        .order('created_at', { ascending: false });

      if (missionId) {
        query = query.eq('mission_id', missionId);
      }

      const { data, error: fetchError } = await query;

      if (cancelled) return;

      if (fetchError) {
        setError(fetchError.message);
        setLoading(false);
        return;
      }

      setDeliveries(data ?? []);
      setLoading(false);
    }

    fetchInitial();

    const filter = missionId
      ? `mission_id=eq.${missionId}`
      : undefined;

    const channel = supabase
      .channel(`deliveries-realtime-${missionId ?? 'all'}`)
      .on<Tables<'deliveries'>>(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'deliveries',
          ...(filter ? { filter } : {}),
        },
        (payload) => {
          if (cancelled) return;

          if (payload.eventType === 'INSERT') {
            setDeliveries((prev) => [payload.new, ...prev]);
          } else if (payload.eventType === 'UPDATE') {
            setDeliveries((prev) =>
              prev.map((d) => (d.id === payload.new.id ? payload.new : d))
            );
          } else if (payload.eventType === 'DELETE' && payload.old && 'id' in payload.old) {
            setDeliveries((prev) => prev.filter((d) => d.id !== payload.old.id));
          }
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      cancelled = true;
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [missionId]);

  return { deliveries, loading, error };
}

// ── useEvents ──────────────────────────────────────────────────────────────────
// Live event feed with real-time subscription.

interface UseEventsResult {
  events: Tables<'events'>[];
  loading: boolean;
  error: string | null;
}

export function useEvents(missionId?: string, limit = 50): UseEventsResult {
  const [events, setEvents] = useState<Tables<'events'>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchInitial() {
      let query = supabase
        .from('events')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (missionId) {
        query = query.eq('mission_id', missionId);
      }

      const { data, error: fetchError } = await query;

      if (cancelled) return;

      if (fetchError) {
        setError(fetchError.message);
        setLoading(false);
        return;
      }

      setEvents(data ?? []);
      setLoading(false);
    }

    fetchInitial();

    const filter = missionId
      ? `mission_id=eq.${missionId}`
      : undefined;

    const channel = supabase
      .channel(`events-realtime-${missionId ?? 'all'}`)
      .on<Tables<'events'>>(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'events',
          ...(filter ? { filter } : {}),
        },
        (payload) => {
          if (cancelled) return;
          // Prepend new events, keep the list capped at limit
          setEvents((prev) => [payload.new, ...prev].slice(0, limit));
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      cancelled = true;
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [missionId, limit]);

  return { events, loading, error };
}

// ── useFacilities ──────────────────────────────────────────────────────────────
// Fetch facilities (cached, no realtime needed).

interface UseFacilitiesResult {
  facilities: Tables<'facilities'>[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useFacilities(): UseFacilitiesResult {
  const [facilities, setFacilities] = useState<Tables<'facilities'>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { data, error: fetchError } = await supabase
      .from('facilities')
      .select('*')
      .eq('is_active', true)
      .order('name');

    if (fetchError) {
      setError(fetchError.message);
      setLoading(false);
      return;
    }

    setFacilities(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { facilities, loading, error, refetch: fetch };
}

// ── useMissionAnalytics ────────────────────────────────────────────────────────
// Fetch from mission_analytics view.

interface UseMissionAnalyticsResult {
  analytics: Tables<'mission_analytics'> | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useMissionAnalytics(userId?: string): UseMissionAnalyticsResult {
  const [analytics, setAnalytics] = useState<Tables<'mission_analytics'> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);

    let query = supabase
      .from('mission_analytics')
      .select('*');

    if (userId) {
      query = query.eq('user_id', userId);
    }

    const { data, error: fetchError } = await query.limit(1).maybeSingle();

    if (fetchError) {
      setError(fetchError.message);
      setLoading(false);
      return;
    }

    setAnalytics(data);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { analytics, loading, error, refetch: fetch };
}

// ── useDeliveryAnalytics ───────────────────────────────────────────────────────
// Fetch from delivery_analytics view.

interface UseDeliveryAnalyticsResult {
  analytics: Tables<'delivery_analytics'> | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useDeliveryAnalytics(userId?: string): UseDeliveryAnalyticsResult {
  const [analytics, setAnalytics] = useState<Tables<'delivery_analytics'> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);

    let query = supabase
      .from('delivery_analytics')
      .select('*');

    if (userId) {
      query = query.eq('user_id', userId);
    }

    const { data, error: fetchError } = await query.limit(1).maybeSingle();

    if (fetchError) {
      setError(fetchError.message);
      setLoading(false);
      return;
    }

    setAnalytics(data);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { analytics, loading, error, refetch: fetch };
}
