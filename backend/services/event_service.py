"""DroneMedic — Event bus: publish/subscribe + history."""

from __future__ import annotations

import asyncio
import logging
from collections import deque

from config import SUPABASE_URL
from backend.domain.enums import EventSource, EventType
from backend.domain.models import Event

logger = logging.getLogger("DroneMedic.Events")


def _db_enabled() -> bool:
    return bool(SUPABASE_URL)


def _persist(coro) -> None:
    if not _db_enabled():
        return
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(coro)
    except RuntimeError:
        try:
            _loop = asyncio.new_event_loop()
            _loop.run_until_complete(coro)
            _loop.close()
        except Exception:
            pass

_MAX_HISTORY = 10_000


class EventService:
    """
    In-process pub/sub event bus with bounded history.

    Thread-safe: mission execution threads call publish() which uses
    loop.call_soon_threadsafe() to push into asyncio subscriber queues.
    """

    def __init__(self) -> None:
        self._history: deque[Event] = deque(maxlen=_MAX_HISTORY)
        self._subscribers: list[asyncio.Queue] = []
        self._loop: asyncio.AbstractEventLoop | None = None

    # ── Lifecycle ──────────────────────────────────────────────────────

    def set_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        """Store the asyncio event loop for thread-safe broadcasting."""
        self._loop = loop

    # ── Publish ────────────────────────────────────────────────────────

    def publish(
        self,
        event_type: EventType,
        data: dict | None = None,
        source: EventSource = EventSource.system,
    ) -> Event:
        """Create and broadcast an event. Safe to call from any thread."""
        event = Event(type=event_type, data=data or {}, source=source)
        self._history.append(event)
        logger.info(f"[EVENT] {event_type.value}: {data}")
        self._broadcast(event)

        # Persist event to Supabase
        from backend.db import repository as repo
        _persist(repo.save_event(event.model_dump(mode="json")))

        return event

    # ── Subscribe ──────────────────────────────────────────────────────

    def subscribe(self) -> asyncio.Queue:
        """Create a subscriber queue. Caller awaits queue.get()."""
        q: asyncio.Queue = asyncio.Queue()
        self._subscribers.append(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        if q in self._subscribers:
            self._subscribers.remove(q)

    # ── History ────────────────────────────────────────────────────────

    def get_history(
        self,
        event_type: EventType | str | None = None,
        limit: int = 100,
    ) -> list[dict]:
        events = list(self._history)
        if event_type:
            type_val = event_type.value if isinstance(event_type, EventType) else event_type
            events = [e for e in events if e.type.value == type_val]
        return [e.model_dump(mode="json") for e in events[-limit:]]

    # ── Internal ───────────────────────────────────────────────────────

    def _broadcast(self, event: Event) -> None:
        """Push event dict to all subscriber queues (thread-safe)."""
        payload = event.model_dump(mode="json")
        for q in self._subscribers:
            try:
                if self._loop and self._loop.is_running():
                    self._loop.call_soon_threadsafe(q.put_nowait, payload)
                else:
                    q.put_nowait(payload)
            except Exception:
                pass
