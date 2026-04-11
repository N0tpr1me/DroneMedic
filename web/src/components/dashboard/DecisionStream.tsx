/**
 * DecisionStream — live feed of Claude reasoning decisions.
 *
 * Backfills recent decisions from /api/ai/decisions on mount, then listens
 * to ai_reasoning events on the live WebSocket and prepends new entries.
 *
 * Also merges browser-side synthetic decisions from `useSyntheticDecisions`
 * (derived from mission events, safety decisions, LiDAR obstacles, phase
 * transitions) so the stream is never empty in local-dev. Synthetic entries
 * are tagged `model: 'local-sim'` and render a small SIM pill in the card
 * header for transparency.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Brain, ChevronDown, ChevronRight, Clock, Cpu, Zap } from 'lucide-react';
import {
  fetchRecentDecisions,
  type AIDecisionEvent,
  type AIDecisionIntent,
  type AIDecisionSeverity,
} from '../../lib/api';
import { useLiveMission } from '../../hooks/useLiveMission';
import { useSyntheticDecisions } from '../../hooks/useSyntheticDecisions';

export interface DecisionStreamProps {
  maxEntries?: number;
  className?: string;
}

interface IntentStyle {
  label: string;
  classes: string;
}

const INTENT_STYLES: Record<AIDecisionIntent, IntentStyle> = {
  parse_request: {
    label: 'PARSE',
    classes: 'bg-sky-500/15 border-sky-500/30 text-sky-300',
  },
  what_if: {
    label: 'WHAT-IF',
    classes: 'bg-purple-500/15 border-purple-500/30 text-purple-300',
  },
  replan: {
    label: 'REPLAN',
    classes: 'bg-amber-500/15 border-amber-500/30 text-amber-300',
  },
  policy_fire: {
    label: 'POLICY',
    classes: 'bg-red-500/15 border-red-500/30 text-red-300',
  },
  query: {
    label: 'QUERY',
    classes: 'bg-white/5 border-white/15 text-on-surface-variant',
  },
  followup: {
    label: 'FOLLOWUP',
    classes: 'bg-white/5 border-white/15 text-on-surface-variant',
  },
};

const SEVERITY_BORDER: Record<AIDecisionSeverity, string> = {
  info: 'border-l-sky-400/70',
  success: 'border-l-emerald-400/70',
  warning: 'border-l-amber-400/70',
  error: 'border-l-red-400/70',
};

function formatTimestamp(unixSeconds: number, now: number): string {
  const deltaSeconds = Math.max(0, Math.floor(now - unixSeconds));
  if (deltaSeconds < 60) return `${deltaSeconds}s ago`;
  if (deltaSeconds < 3600) return `${Math.floor(deltaSeconds / 60)}m ago`;
  const date = new Date(unixSeconds * 1000);
  return date.toLocaleTimeString([], { hour12: false });
}

function formatLatency(latencyMs: number | null): string | null {
  if (latencyMs === null || latencyMs === undefined) return null;
  if (latencyMs < 1000) return `${Math.round(latencyMs)}ms`;
  return `${(latencyMs / 1000).toFixed(1)}s`;
}

function stringifyDecision(decision: Record<string, unknown>): string {
  try {
    return JSON.stringify(decision, null, 2);
  } catch {
    return '{}';
  }
}

function isAIDecisionEvent(value: unknown): value is AIDecisionEvent {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.decision_id === 'string' &&
    typeof record.intent === 'string' &&
    typeof record.reasoning === 'string'
  );
}

interface DecisionCardProps {
  entry: AIDecisionEvent;
  now: number;
}

const SYNTHETIC_MODEL_TAG = 'local-sim';

function DecisionCard({ entry, now }: DecisionCardProps) {
  const [expanded, setExpanded] = useState(false);
  const intentStyle = INTENT_STYLES[entry.intent] ?? INTENT_STYLES.query;
  const severityBorder = SEVERITY_BORDER[entry.severity] ?? SEVERITY_BORDER.info;
  const latency = formatLatency(entry.latency_ms);
  const decisionJson = useMemo(() => stringifyDecision(entry.decision), [entry.decision]);
  const isSynthetic = entry.model === SYNTHETIC_MODEL_TAG;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.25 }}
      className={`rounded-xl border border-outline-variant/10 border-l-2 ${severityBorder} bg-surface-container-high/40 backdrop-blur-sm px-4 py-3 space-y-2`}
    >
      <div className="flex items-center flex-wrap gap-2">
        <span
          className={`text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded border ${intentStyle.classes}`}
        >
          {intentStyle.label}
        </span>
        {isSynthetic && (
          <span
            className="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded border border-fuchsia-400/40 bg-fuchsia-500/10 text-fuchsia-300"
            title="Derived from local mission + LiDAR activity (no Claude API call)"
          >
            SIM
          </span>
        )}
        <span className="flex items-center gap-1 text-[10px] text-on-surface-variant/60 uppercase tracking-wider">
          <Clock className="w-3 h-3" />
          {formatTimestamp(entry.timestamp, now)}
        </span>
        {latency && (
          <span className="flex items-center gap-1 text-[10px] text-on-surface-variant/60 uppercase tracking-wider">
            <Zap className="w-3 h-3" />
            {latency}
          </span>
        )}
        {entry.model && (
          <span className="flex items-center gap-1 text-[10px] text-on-surface-variant/50 uppercase tracking-wider ml-auto">
            <Cpu className="w-3 h-3" />
            {entry.model}
          </span>
        )}
      </div>

      {entry.input && (
        <div className="text-xs text-on-surface-variant/80 bg-white/3 rounded-md px-2.5 py-1.5 border border-white/5 leading-relaxed">
          {entry.input}
        </div>
      )}

      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex items-center gap-1 text-[10px] uppercase tracking-wider font-semibold text-tertiary/90 hover:text-tertiary transition-colors cursor-pointer"
      >
        {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        Reasoning
      </button>

      <AnimatePresence initial={false}>
        {expanded && entry.reasoning && (
          <motion.pre
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="text-[11px] text-on-surface-variant/85 font-mono whitespace-pre-wrap bg-black/20 rounded-md px-2.5 py-2 border border-white/5 leading-relaxed overflow-hidden"
          >
            {entry.reasoning}
          </motion.pre>
        )}
      </AnimatePresence>

      {Object.keys(entry.decision).length > 0 && (
        <pre className="text-[10px] text-tertiary/80 font-mono bg-black/25 rounded-md px-2.5 py-2 border border-tertiary/10 max-h-36 overflow-auto leading-snug">
          {decisionJson}
        </pre>
      )}
    </motion.div>
  );
}

export function DecisionStream({ maxEntries = 50, className = '' }: DecisionStreamProps) {
  const [decisions, setDecisions] = useState<AIDecisionEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState<number>(() => Date.now() / 1000);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const { lastEvent } = useLiveMission();
  const syntheticDecisions = useSyntheticDecisions();

  const addDecision = useCallback(
    (decision: AIDecisionEvent) => {
      if (seenIdsRef.current.has(decision.decision_id)) return;
      seenIdsRef.current.add(decision.decision_id);
      setDecisions((prev) => [decision, ...prev].slice(0, maxEntries));
    },
    [maxEntries],
  );

  // Initial backfill
  useEffect(() => {
    let cancelled = false;
    fetchRecentDecisions(20)
      .then((entries) => {
        if (cancelled) return;
        const sorted = [...entries].sort((a, b) => b.timestamp - a.timestamp).slice(0, maxEntries);
        sorted.forEach((entry) => seenIdsRef.current.add(entry.decision_id));
        setDecisions(sorted);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [maxEntries]);

  // Subscribe to new ai_reasoning events via lastEvent
  useEffect(() => {
    if (!lastEvent) return;
    const evt = lastEvent as Record<string, unknown>;
    if (evt.type !== 'ai_reasoning') return;
    const payload = isAIDecisionEvent(evt.data) ? evt.data : isAIDecisionEvent(evt) ? evt : null;
    if (!payload) return;
    addDecision(payload);
  }, [lastEvent, addDecision]);

  // Merge browser-side synthetic decisions into the same stream whenever
  // new ones are generated. Dedupe is handled inside addDecision via
  // `seenIdsRef`, so replay of existing entries is cheap and harmless.
  useEffect(() => {
    syntheticDecisions.forEach((d) => addDecision(d));
  }, [syntheticDecisions, addDecision]);

  // Ticking clock for "Xs ago" labels
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Render-time sort so late-arriving synthetic entries (which may carry
  // older timestamps, e.g. flight log backfill) slot into the correct
  // chronological position instead of always landing at the top.
  const sortedDecisions = useMemo<AIDecisionEvent[]>(
    () => [...decisions].sort((a, b) => b.timestamp - a.timestamp),
    [decisions],
  );

  return (
    <div
      className={`flex flex-col rounded-2xl border border-outline-variant/15 bg-surface-container-lowest/60 backdrop-blur-xl ${className}`}
    >
      <div className="flex items-center gap-2 px-5 py-4 border-b border-outline-variant/10">
        <Brain className="w-4 h-4 text-tertiary" />
        <span className="font-headline text-sm font-bold text-on-surface uppercase tracking-wider">
          Decision Stream
        </span>
        <span className="ml-auto text-[10px] text-on-surface-variant/50 uppercase tracking-widest">
          {decisions.length} live
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 max-h-[520px]">
        {loading && decisions.length === 0 && (
          <div className="flex items-center justify-center py-12 text-xs text-on-surface-variant/50 uppercase tracking-wider">
            Loading recent decisions…
          </div>
        )}
        {!loading && decisions.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 gap-2 text-center">
            <Brain className="w-8 h-8 text-on-surface-variant/20" />
            <span className="text-xs text-on-surface-variant/50 uppercase tracking-wider">
              Stream idle · awaiting mission activity
            </span>
          </div>
        )}
        <AnimatePresence initial={false}>
          {sortedDecisions.map((entry) => (
            <DecisionCard key={entry.decision_id} entry={entry} now={now} />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
