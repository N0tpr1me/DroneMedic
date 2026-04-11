/**
 * decisionBus — tiny client-side pub/sub for synthetic AI decisions.
 *
 * Lets modules that perform client-side LLM calls (llmChat / llmParse) or
 * other reasoning-like work publish a decision into the DecisionStream
 * panel without pulling React state into non-component code. The
 * `useSyntheticDecisions` hook subscribes to this bus and merges entries
 * into the stream it already builds from flight logs and mission events.
 *
 * Kept deliberately minimal — a Set of listeners and two functions. No
 * external deps, no React.
 */

import type { AIDecisionEvent } from './api';

type DecisionListener = (decision: AIDecisionEvent) => void;

const listeners: Set<DecisionListener> = new Set();

export function publishDecision(decision: AIDecisionEvent): void {
  listeners.forEach((listener) => {
    try {
      listener(decision);
    } catch {
      // A listener that throws must not break other subscribers.
    }
  });
}

export function subscribeDecisions(listener: DecisionListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
