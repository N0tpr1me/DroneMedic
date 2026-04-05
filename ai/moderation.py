"""Input moderation — filter unsafe content before sending to GPT."""
from __future__ import annotations

import logging
from openai import OpenAI
from config import OPENAI_API_KEY, OPENAI_BASE_URL

logger = logging.getLogger(__name__)


class ModerationService:
    """Check user input for policy violations before forwarding to LLM."""

    def __init__(self) -> None:
        self._client: OpenAI | None = None
        if OPENAI_API_KEY:
            self._client = OpenAI(api_key=OPENAI_API_KEY, base_url=OPENAI_BASE_URL)

    def check(self, text: str) -> dict:
        """Check text for policy violations. Returns safety assessment."""
        if not self._client:
            return {
                "safe": True,
                "flagged": False,
                "note": "Moderation unavailable — defaulting to safe",
            }
        try:
            response = self._client.moderations.create(
                model="omni-moderation-latest",
                input=text,
            )
            result = response.results[0]
            flagged_categories: dict = {}
            if hasattr(result, "categories"):
                flagged_categories = {
                    k: v for k, v in vars(result.categories).items() if v is True
                }
            return {
                "safe": not result.flagged,
                "flagged": result.flagged,
                "categories": flagged_categories,
            }
        except Exception as e:
            logger.warning("Moderation check failed: %s", e)
            return {"safe": True, "flagged": False, "note": f"Check failed: {e}"}
