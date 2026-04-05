/**
 * useRealtimeMission — Dedicated hook for live mission tracking via Supabase Realtime.
 *
 * Subscribes to: mission row updates, its waypoints, its deliveries, and drone telemetry.
 * Powers the live mission view on the dashboard.
 */

import { useEffect, useState, useRef } from 'react';
import { supabase } from '../lib/supabase';
import type { Tables } from '../lib/database.types';
import type { RealtimeChannel } from '@supabase/supabase-js';

interface UseRealtimeMissionResult {
  mission: Tables<'missions'> | null;
  waypoints: Tables<'waypoints'>[];
  deliveries: Tables<'deliveries'>[];
  telemetry: Tables<'telemetry'>[];
  loading: boolean;
  error: string | null;
}

export function useRealtimeMission(missionId: string | null): UseRealtimeMissionResult {
  const [mission, setMission] = useState<Tables<'missions'> | null>(null);
  const [waypoints, setWaypoints] = useState<Tables<'waypoints'>[]>([]);
  const [deliveries, setDeliveries] = useState<Tables<'deliveries'>[]>([]);
  const [telemetry, setTelemetry] = useState<Tables<'telemetry'>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const channelsRef = useRef<RealtimeChannel[]>([]);

  useEffect(() => {
    // Reset state when missionId changes
    setMission(null);
    setWaypoints([]);
    setDeliveries([]);
    setTelemetry([]);
    setError(null);

    if (!missionId) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    // ── Fetch initial data in parallel ──────────────────────────────────────

    async function fetchAll() {
      const mid = missionId!; // guaranteed non-null by guard above
      const [missionRes, waypointsRes, deliveriesRes, telemetryRes] =
        await Promise.all([
          supabase
            .from('missions')
            .select('*')
            .eq('id', mid)
            .maybeSingle(),
          supabase
            .from('waypoints')
            .select('*')
            .eq('mission_id', mid)
            .order('sequence', { ascending: true }),
          supabase
            .from('deliveries')
            .select('*')
            .eq('mission_id', mid)
            .order('created_at', { ascending: true }),
          supabase
            .from('telemetry')
            .select('*')
            .eq('mission_id', mid)
            .order('recorded_at', { ascending: false })
            .limit(100),
        ]);

      if (cancelled) return;

      const firstError =
        missionRes.error ?? waypointsRes.error ?? deliveriesRes.error ?? telemetryRes.error;

      if (firstError) {
        setError(firstError.message);
        setLoading(false);
        return;
      }

      setMission(missionRes.data);
      setWaypoints(waypointsRes.data ?? []);
      setDeliveries(deliveriesRes.data ?? []);
      setTelemetry(telemetryRes.data ?? []);
      setLoading(false);
    }

    fetchAll();

    // ── Subscribe to real-time changes ──────────────────────────────────────

    // 1. Mission row updates
    const missionChannel = supabase
      .channel(`rt-mission-${missionId}`)
      .on<Tables<'missions'>>(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'missions',
          filter: `id=eq.${missionId}`,
        },
        (payload) => {
          if (!cancelled) {
            setMission(payload.new);
          }
        }
      )
      .subscribe();

    // 2. Waypoint updates (reached status, reached_at timestamps)
    const waypointsChannel = supabase
      .channel(`rt-waypoints-${missionId}`)
      .on<Tables<'waypoints'>>(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'waypoints',
          filter: `mission_id=eq.${missionId}`,
        },
        (payload) => {
          if (cancelled) return;

          if (payload.eventType === 'INSERT') {
            setWaypoints((prev) => {
              const updated = [...prev, payload.new];
              return updated.sort((a, b) => a.sequence - b.sequence);
            });
          } else if (payload.eventType === 'UPDATE') {
            setWaypoints((prev) =>
              prev.map((w) => (w.id === payload.new.id ? payload.new : w))
            );
          } else if (payload.eventType === 'DELETE' && payload.old && 'id' in payload.old) {
            setWaypoints((prev) => prev.filter((w) => w.id !== payload.old.id));
          }
        }
      )
      .subscribe();

    // 3. Delivery status changes
    const deliveriesChannel = supabase
      .channel(`rt-deliveries-${missionId}`)
      .on<Tables<'deliveries'>>(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'deliveries',
          filter: `mission_id=eq.${missionId}`,
        },
        (payload) => {
          if (cancelled) return;

          if (payload.eventType === 'INSERT') {
            setDeliveries((prev) => [...prev, payload.new]);
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

    // 4. Telemetry — stream new rows, keep a rolling window of 100
    //    We need the drone_id from the mission to filter telemetry.
    //    Subscribe to all telemetry for this mission_id.
    const telemetryChannel = supabase
      .channel(`rt-telemetry-${missionId}`)
      .on<Tables<'telemetry'>>(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'telemetry',
          filter: `mission_id=eq.${missionId}`,
        },
        (payload) => {
          if (!cancelled) {
            setTelemetry((prev) => [payload.new, ...prev].slice(0, 100));
          }
        }
      )
      .subscribe();

    channelsRef.current = [
      missionChannel,
      waypointsChannel,
      deliveriesChannel,
      telemetryChannel,
    ];

    // ── Cleanup ─────────────────────────────────────────────────────────────

    return () => {
      cancelled = true;
      for (const channel of channelsRef.current) {
        supabase.removeChannel(channel);
      }
      channelsRef.current = [];
    };
  }, [missionId]);

  return { mission, waypoints, deliveries, telemetry, loading, error };
}
