"""
DroneMedic - Ops Metrics Service

Runtime observability metrics for the FastAPI backend:
  • Request latency percentiles (p50/p95/p99/max) over a rolling window
  • Request counters broken down by status-code class
  • LLM call counters (success / error) with derived error rate
  • Process uptime

Designed to be a process-local singleton. Thread-safe for the single-process
uvicorn workers used in the hackathon demo stack.
"""

from __future__ import annotations

import time
from collections import deque
from threading import Lock
from typing import Deque

_MAX_SAMPLES = 1000  # rolling window of most recent request latencies


class OpsMetricsService:
    """Lightweight in-memory metrics collector. No external deps."""

    def __init__(self, max_samples: int = _MAX_SAMPLES) -> None:
        self._latencies_ms: Deque[float] = deque(maxlen=max_samples)
        self._counters: dict[str, int] = {
            "requests_total": 0,
            "requests_2xx": 0,
            "requests_4xx": 0,
            "requests_5xx": 0,
            "llm_calls_total": 0,
            "llm_calls_success": 0,
            "llm_calls_error": 0,
        }
        self._lock = Lock()
        self._started_at = time.time()

    # ── Recording ────────────────────────────────────────────────

    def record_request(self, latency_ms: float, status_code: int) -> None:
        """Record a completed HTTP request."""
        with self._lock:
            self._latencies_ms.append(float(latency_ms))
            self._counters["requests_total"] += 1
            if 200 <= status_code < 300:
                self._counters["requests_2xx"] += 1
            elif 400 <= status_code < 500:
                self._counters["requests_4xx"] += 1
            elif 500 <= status_code < 600:
                self._counters["requests_5xx"] += 1

    def record_llm_call(self, outcome: str) -> None:
        """
        Record a coordinator / LLM call outcome.

        Args:
            outcome: "success" or "error".
        """
        key = f"llm_calls_{outcome}"
        with self._lock:
            self._counters["llm_calls_total"] += 1
            if key in self._counters:
                self._counters[key] += 1

    def reset(self) -> None:
        """Clear all samples and counters. Used by tests."""
        with self._lock:
            self._latencies_ms.clear()
            for key in self._counters:
                self._counters[key] = 0
            self._started_at = time.time()

    # ── Read ─────────────────────────────────────────────────────

    def snapshot(self) -> dict:
        """Return the current metrics snapshot as a plain dict."""
        with self._lock:
            samples = sorted(self._latencies_ms)
            counters = dict(self._counters)
            uptime = round(time.time() - self._started_at, 1)

        n = len(samples)

        def percentile(p: float) -> float:
            if n == 0:
                return 0.0
            # Nearest-rank method — simple, dependency-free
            idx = min(n - 1, max(0, int(round(p * (n - 1)))))
            return round(samples[idx], 2)

        llm_total = counters["llm_calls_total"]
        llm_error_rate = (
            round(counters["llm_calls_error"] / llm_total, 3) if llm_total > 0 else 0.0
        )

        return {
            "uptime_seconds": uptime,
            "request_latency_ms": {
                "samples": n,
                "p50": percentile(0.50),
                "p95": percentile(0.95),
                "p99": percentile(0.99),
                "max": round(samples[-1], 2) if n else 0.0,
            },
            "counters": counters,
            "llm_error_rate": llm_error_rate,
        }


# ── Process-wide singleton ──────────────────────────────────────

_SINGLETON = OpsMetricsService()


def get_ops_metrics() -> OpsMetricsService:
    """Return the process-wide OpsMetricsService instance."""
    return _SINGLETON
