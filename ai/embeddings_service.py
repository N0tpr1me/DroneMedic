"""Embeddings service — semantic search for missions and events via pgvector."""
from __future__ import annotations

import logging
from openai import OpenAI
from config import OPENAI_API_KEY, OPENAI_BASE_URL

logger = logging.getLogger(__name__)


class EmbeddingsService:
    def __init__(self) -> None:
        self._client: OpenAI | None = None
        if OPENAI_API_KEY:
            self._client = OpenAI(api_key=OPENAI_API_KEY, base_url=OPENAI_BASE_URL)

    def available(self) -> bool:
        return self._client is not None

    def embed(self, text: str) -> list[float] | None:
        """Generate 1536-dim embedding vector."""
        if not self._client:
            return None
        try:
            response = self._client.embeddings.create(
                model="text-embedding-3-small",
                input=text,
            )
            return response.data[0].embedding
        except Exception as e:
            logger.warning(f"Embedding failed: {e}")
            return None

    def embed_batch(self, texts: list[str]) -> list[list[float]] | None:
        """Batch embed multiple texts."""
        if not self._client or not texts:
            return None
        try:
            response = self._client.embeddings.create(
                model="text-embedding-3-small",
                input=texts,
            )
            return [d.embedding for d in response.data]
        except Exception as e:
            logger.warning(f"Batch embedding failed: {e}")
            return None

    def mission_text(self, mission: dict) -> str:
        """Convert mission data to text for embedding."""
        route = " \u2192 ".join(mission.get("planned_route", []))
        return (
            f"Mission {mission.get('id', '?')}: route {route}. "
            f"Status: {mission.get('status', '?')}. "
            f"Distance: {mission.get('route_distance', 0):.0f}m. "
            f"Battery: {mission.get('battery_usage', 0):.1f}%. "
            f"Reroutes: {mission.get('reroute_count', 0)}."
        )

    def event_text(self, event: dict) -> str:
        """Convert event data to text for embedding."""
        return (
            f"Event {event.get('type', '?')}: "
            f"drone {event.get('drone_id', '?')}, "
            f"mission {event.get('mission_id', '?')}. "
            f"Data: {event.get('data', {})}. "
            f"Time: {event.get('created_at', '?')}."
        )
