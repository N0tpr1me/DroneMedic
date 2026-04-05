"""Text-to-Speech service — GPT narrates flight events in aviation voice."""
from __future__ import annotations

import logging

from openai import OpenAI

from config import OPENAI_API_KEY, OPENAI_BASE_URL

logger = logging.getLogger(__name__)


class TTSService:
    VOICES = {
        "flight_controller": {
            "voice": "cedar",
            "instructions": (
                "Speak like a professional aviation flight controller. "
                "Calm, clear, authoritative. Use short, precise sentences."
            ),
        },
        "emergency": {
            "voice": "cedar",
            "instructions": (
                "Urgent but controlled tone. Emphasize critical information. "
                "Speak slightly faster than normal."
            ),
        },
        "narrator": {
            "voice": "coral",
            "instructions": (
                "Warm, professional narrator voice. Engaging and clear. "
                "Good for mission summaries and reports."
            ),
        },
    }

    def __init__(self) -> None:
        self._client: OpenAI | None = None
        try:
            if OPENAI_API_KEY:
                self._client = OpenAI(
                    api_key=OPENAI_API_KEY, base_url=OPENAI_BASE_URL,
                )
        except Exception as e:
            logger.warning("TTS service unavailable: %s", e)

    def available(self) -> bool:
        return self._client is not None

    def synthesize(self, text: str, style: str = "flight_controller") -> bytes | None:
        """Generate speech audio for *text*. Returns MP3 bytes or None."""
        if not self._client:
            return None
        try:
            voice_config = self.VOICES.get(style, self.VOICES["flight_controller"])
            response = self._client.audio.speech.create(
                model="gpt-4o-mini-tts",
                voice=voice_config["voice"],
                input=text,
                instructions=voice_config["instructions"],
                response_format="mp3",
            )
            return response.content
        except Exception as e:
            logger.warning("TTS synthesis failed: %s", e)
            return None

    def narrate_event(self, event_type: str, details: dict) -> bytes | None:
        """Generate narration for a flight event."""
        templates = {
            "takeoff": (
                "Alpha drone departing depot, en route to {destination}. "
                "Estimated time of arrival, {eta} minutes."
            ),
            "waypoint": (
                "Waypoint reached. {location} delivery confirmed. "
                "Proceeding to next stop."
            ),
            "reroute": (
                "Weather advisory. {reason}. Rerouting via alternate corridor. "
                "New ETA {eta} minutes."
            ),
            "emergency": (
                "Emergency. {reason}. Diverting to nearest facility, {facility}."
            ),
            "complete": (
                "Mission complete. All deliveries confirmed. "
                "{delivered} items delivered. Returning to depot."
            ),
            "battery_low": (
                "Battery advisory. Current level {battery} percent. "
                "Switching to conservation mode."
            ),
        }
        template = templates.get(event_type, "Flight event: {event_type}")
        text = template.format(**details, event_type=event_type)
        style = (
            "emergency"
            if event_type in ("emergency", "battery_low")
            else "flight_controller"
        )
        return self.synthesize(text, style)
