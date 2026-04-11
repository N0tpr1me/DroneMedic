"""
DroneMedic - AI Decision Log Service

Process-wide singleton that captures structured LLM reasoning from the
mission coordinator (parse_request, what-if scenarios, replans, and
safety-policy outcomes) and republishes them through the existing event
bus as ``EventType.ai_reasoning`` events.

The log is deliberately decoupled from the coordinator — the coordinator
never imports this module at module load, and every call site is expected
to wrap ``log_decision`` in try/except so decision logging can never break
a live mission.
"""

from __future__ import annotations

import logging
import random
import re
import time
from collections import deque
from threading import Lock
from typing import Any, Callable, Deque

from backend.domain.enums import EventType

logger = logging.getLogger("DroneMedic.AIDecisionLog")


# ── Module constants ──────────────────────────────────────────────────

_DEFAULT_MAX_HISTORY = 500
_INPUT_PREVIEW_CHARS = 500
_REASONING_PREVIEW_CHARS = 200
_VALID_SEVERITIES = frozenset({"info", "success", "warning", "error"})

_THINKING_PATTERN = re.compile(
    r"<thinking>(.*?)</thinking>",
    flags=re.DOTALL | re.IGNORECASE,
)


# ── Public helpers ────────────────────────────────────────────────────

def extract_reasoning(response_text: str) -> str:
    """
    Capture the first ``<thinking>...</thinking>`` block from a raw LLM
    response. If no thinking block is present, return a short preview of
    the response (first ``_REASONING_PREVIEW_CHARS`` characters).

    Mirrors the strip logic in ``ai.coordinator._extract_json`` but captures
    instead of discards.
    """
    if not response_text:
        return ""

    match = _THINKING_PATTERN.search(response_text)
    if match:
        return match.group(1).strip()

    return response_text.strip()[:_REASONING_PREVIEW_CHARS]


def _make_decision_id() -> str:
    """Build a unique-ish id: ``ai_dec_<unix_ms>_<random>``."""
    unix_ms = int(time.time() * 1000)
    token = random.randint(0, 0xFFFFFF)  # 6 hex chars, non-cryptographic
    return f"ai_dec_{unix_ms}_{token:06x}"


# ── Service ───────────────────────────────────────────────────────────

EventPublisher = Callable[[EventType, dict], Any]


class AIDecisionLog:
    """Process-wide singleton that captures coordinator decisions."""

    def __init__(self, max_history: int = _DEFAULT_MAX_HISTORY) -> None:
        self._max_history = max_history
        self._history: Deque[dict] = deque(maxlen=max_history)
        self._publisher: EventPublisher | None = None
        self._lock = Lock()

    # ── Wiring ────────────────────────────────────────────────────

    def set_event_publisher(self, publisher: EventPublisher | None) -> None:
        """
        Register the publisher used to broadcast decisions.

        ``publisher`` must accept ``(EventType, dict)``. Pass ``None`` to
        detach (useful in tests).
        """
        with self._lock:
            self._publisher = publisher

    # ── Write ─────────────────────────────────────────────────────

    def log_decision(
        self,
        intent: str,
        input_text: str,
        reasoning: str,
        decision: dict,
        *,
        latency_ms: float | None = None,
        model: str | None = None,
        severity: str = "info",
    ) -> dict:
        """
        Record a decision and publish an ``ai_reasoning`` event.

        Returns the recorded entry as a new dict (the caller never sees the
        copy held by the deque — this preserves immutability).
        """
        sev = severity if severity in _VALID_SEVERITIES else "info"

        record: dict = {
            "decision_id": _make_decision_id(),
            "timestamp": time.time(),
            "intent": str(intent),
            "input": (input_text or "")[:_INPUT_PREVIEW_CHARS],
            "reasoning": reasoning or "",
            "decision": dict(decision) if isinstance(decision, dict) else {"value": decision},
            "latency_ms": float(latency_ms) if latency_ms is not None else None,
            "model": model,
            "severity": sev,
        }

        with self._lock:
            self._history.append(record)
            publisher = self._publisher

        if publisher is not None:
            event_payload = {
                "decision_id": record["decision_id"],
                "intent": record["intent"],
                "input": record["input"],
                "reasoning": record["reasoning"],
                "decision": record["decision"],
                "latency_ms": record["latency_ms"],
                "model": record["model"],
                "severity": record["severity"],
                "timestamp": record["timestamp"],
            }
            try:
                publisher(EventType.ai_reasoning, event_payload)
            except Exception as exc:  # noqa: BLE001 - don't break callers
                logger.warning("AIDecisionLog publisher failed: %s", exc)

        return dict(record)

    # ── Read ──────────────────────────────────────────────────────

    def recent(self, limit: int = 50) -> list[dict]:
        """Return the most recent decisions, newest-first."""
        if limit <= 0:
            return []

        with self._lock:
            snapshot = list(self._history)

        # Newest first, capped at `limit`. Return copies so the caller cannot
        # mutate the deque entries — we deep-copy the nested ``decision``
        # dict because log records are intended to be immutable snapshots.
        snapshot.reverse()
        out: list[dict] = []
        for item in snapshot[:limit]:
            entry = dict(item)
            inner = entry.get("decision")
            if isinstance(inner, dict):
                entry["decision"] = dict(inner)
            out.append(entry)
        return out

    def reset(self) -> None:
        """Clear history and detach publisher. Used by tests."""
        with self._lock:
            self._history.clear()
            self._publisher = None


# ── Process-wide singleton ────────────────────────────────────────────

_SINGLETON = AIDecisionLog()


def get_ai_decision_log() -> AIDecisionLog:
    """Return the process-wide ``AIDecisionLog`` instance."""
    return _SINGLETON
