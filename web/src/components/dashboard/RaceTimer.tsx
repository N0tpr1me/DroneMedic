/**
 * RaceTimer — side-by-side countdown comparing drone vs ambulance delivery time.
 *
 * Fetches /api/metrics/race-comparison for the given locations, then renders a
 * split-pane countdown with a running "time saved" counter.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Ambulance, Plane, Info } from 'lucide-react';
import { fetchRaceComparison, type RaceComparison } from '../../lib/api';

export interface RaceTimerProps {
  locations: string[];
  startedAt?: number;
  onDroneFinished?: () => void;
}

interface TickState {
  droneRemaining: number;
  ambulanceRemaining: number;
  secondsSavedSoFar: number;
  droneDone: boolean;
  ambulanceDone: boolean;
}

function formatMMSS(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

interface FlipDigitsProps {
  value: string;
  color: string;
}

function FlipDigits({ value, color }: FlipDigitsProps) {
  return (
    <div className="flex items-center" style={{ color }}>
      {value.split('').map((char, idx) => (
        <div
          key={`${idx}-${char}`}
          className="relative inline-flex items-center justify-center"
          style={{ minWidth: char === ':' ? '0.35em' : '0.62em' }}
        >
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={char}
              initial={{ y: '-60%', opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: '60%', opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="font-mono font-bold tabular-nums"
            >
              {char}
            </motion.span>
          </AnimatePresence>
        </div>
      ))}
    </div>
  );
}

interface SkeletonProps {
  className?: string;
}

function RaceTimerSkeleton({ className = '' }: SkeletonProps) {
  return (
    <div
      className={`rounded-2xl border border-outline-variant/15 bg-surface-container-lowest/60 backdrop-blur-xl p-5 animate-pulse ${className}`}
    >
      <div className="h-4 w-40 bg-white/5 rounded mb-4" />
      <div className="grid grid-cols-2 gap-4">
        <div className="h-32 rounded-xl bg-white/5" />
        <div className="h-32 rounded-xl bg-white/5" />
      </div>
      <div className="h-10 w-48 bg-white/5 rounded mt-4 mx-auto" />
    </div>
  );
}

export function RaceTimer({ locations, startedAt, onDroneFinished }: RaceTimerProps) {
  const [comparison, setComparison] = useState<RaceComparison | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAssumptions, setShowAssumptions] = useState(false);
  const [tick, setTick] = useState<TickState>({
    droneRemaining: 0,
    ambulanceRemaining: 0,
    secondsSavedSoFar: 0,
    droneDone: false,
    ambulanceDone: false,
  });

  const finishedCallbackRef = useRef<boolean>(false);
  const startRef = useRef<number>(startedAt ?? Date.now() / 1000);

  // Reset start time when startedAt explicitly changes
  useEffect(() => {
    startRef.current = startedAt ?? Date.now() / 1000;
    finishedCallbackRef.current = false;
  }, [startedAt]);

  const locationsKey = useMemo(() => locations.join(','), [locations]);

  // Fetch race comparison on mount and when locations change
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setComparison(null);
    finishedCallbackRef.current = false;
    startRef.current = startedAt ?? Date.now() / 1000;

    fetchRaceComparison(locations)
      .then((data) => {
        if (cancelled) return;
        if (!data) {
          setError('Race comparison unavailable');
        } else {
          setComparison(data);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationsKey]);

  const computeTick = useCallback((data: RaceComparison): TickState => {
    const elapsed = Math.max(0, Date.now() / 1000 - startRef.current);
    const droneRemaining = Math.max(0, data.drone_seconds - elapsed);
    const ambulanceRemaining = Math.max(0, data.ambulance_seconds - elapsed);
    const totalSaved = Math.max(0, data.ambulance_seconds - data.drone_seconds);
    // seconds_saved_so_far = ambulance_seconds - max(ambulance_remaining, drone_seconds)
    const rawSaved = data.ambulance_seconds - Math.max(ambulanceRemaining, data.drone_seconds);
    const secondsSavedSoFar = Math.max(0, Math.min(totalSaved, rawSaved));

    return {
      droneRemaining,
      ambulanceRemaining,
      secondsSavedSoFar,
      droneDone: droneRemaining <= 0,
      ambulanceDone: ambulanceRemaining <= 0,
    };
  }, []);

  // Tick the clock every 200ms
  useEffect(() => {
    if (!comparison) return;

    const update = () => {
      const next = computeTick(comparison);
      setTick(next);
      if (next.droneDone && !finishedCallbackRef.current) {
        finishedCallbackRef.current = true;
        onDroneFinished?.();
      }
    };

    update();
    const id = window.setInterval(update, 200);
    return () => window.clearInterval(id);
  }, [comparison, computeTick, onDroneFinished]);

  if (loading) {
    return <RaceTimerSkeleton />;
  }

  if (error || !comparison) {
    return (
      <div className="rounded-2xl border border-outline-variant/15 bg-surface-container-lowest/60 backdrop-blur-xl p-5">
        <div className="text-xs text-on-surface-variant/60 uppercase tracking-wider text-center py-6">
          {error ?? 'No comparison available'}
        </div>
      </div>
    );
  }

  const droneColor = tick.droneDone ? '#22c55e' : '#00e5ff';
  const ambulanceColor = '#f97316';
  const savedColor = tick.droneDone ? '#22c55e' : '#e2e8f0';
  const assumptionsText = `Drone ${comparison.assumptions.drone_cruise_ms.toFixed(0)} m/s cruise, ambulance ${comparison.assumptions.ambulance_avg_ms.toFixed(0)} m/s avg, road factor ${comparison.assumptions.road_to_straight_ratio.toFixed(1)}×, stop overhead ${comparison.assumptions.ambulance_stop_overhead_s.toFixed(0)}s`;

  return (
    <div className="rounded-2xl border border-outline-variant/15 bg-surface-container-lowest/60 backdrop-blur-xl overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-3 border-b border-outline-variant/10">
        <span className="font-headline text-sm font-bold text-on-surface uppercase tracking-wider">
          Race Timer
        </span>
        {comparison.locations.length > 0 && (
          <span className="text-[10px] text-on-surface-variant/50 uppercase tracking-widest ml-2 truncate">
            {comparison.locations.join(' → ')}
          </span>
        )}
        <button
          type="button"
          onClick={() => setShowAssumptions((prev) => !prev)}
          className="ml-auto text-on-surface-variant/50 hover:text-on-surface-variant transition-colors cursor-pointer"
          aria-label="Toggle assumptions"
          title={assumptionsText}
        >
          <Info className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="grid grid-cols-2 divide-x divide-outline-variant/10">
        {/* AMBULANCE PANE */}
        <div className="flex flex-col items-center justify-center p-5 gap-2 bg-gradient-to-b from-orange-500/5 to-transparent">
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-orange-400">
            <Ambulance className="w-3.5 h-3.5" />
            Ambulance
          </div>
          <div className="text-3xl md:text-4xl">
            <FlipDigits value={formatMMSS(tick.ambulanceRemaining)} color={ambulanceColor} />
          </div>
          <div className="text-[9px] text-on-surface-variant/50 uppercase tracking-wider">
            {(comparison.ambulance_distance_m / 1000).toFixed(1)} km road
          </div>
          {tick.ambulanceDone && (
            <motion.span
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-300 border border-orange-500/30"
            >
              Arrived
            </motion.span>
          )}
        </div>

        {/* DRONE PANE */}
        <div className="flex flex-col items-center justify-center p-5 gap-2 bg-gradient-to-b from-cyan-500/5 to-transparent">
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-cyan-400">
            <Plane className="w-3.5 h-3.5" />
            Drone
          </div>
          <div className="text-3xl md:text-4xl">
            <FlipDigits value={formatMMSS(tick.droneRemaining)} color={droneColor} />
          </div>
          <div className="text-[9px] text-on-surface-variant/50 uppercase tracking-wider">
            {(comparison.drone_distance_m / 1000).toFixed(1)} km straight
          </div>
          <AnimatePresence>
            {tick.droneDone && (
              <motion.span
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
              >
                ✓ Delivered
              </motion.span>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* SAVED COUNTER */}
      <div className="flex flex-col items-center justify-center py-4 border-t border-outline-variant/10 bg-black/20">
        <div className="text-[10px] text-on-surface-variant/60 uppercase tracking-widest">
          Time Saved
        </div>
        <div className="text-3xl md:text-4xl mt-1">
          <FlipDigits value={formatMMSS(tick.secondsSavedSoFar)} color={savedColor} />
        </div>
        <div className="text-[10px] text-on-surface-variant/40 uppercase tracking-wider mt-1">
          Potential: {formatMMSS(comparison.seconds_saved)} ({comparison.percent_saved.toFixed(0)}%)
        </div>
      </div>

      <AnimatePresence initial={false}>
        {showAssumptions && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="text-[10px] text-on-surface-variant/60 px-5 py-2 border-t border-outline-variant/10 bg-black/20 overflow-hidden"
          >
            {assumptionsText}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
