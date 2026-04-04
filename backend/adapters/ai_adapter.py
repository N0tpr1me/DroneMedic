"""DroneMedic — AI adapter interface + OpenAI implementation.

Defines the interface for all AI features. Current implementation uses
OpenAI/GPT. Swap with Claude or local LLM by implementing the same interface.
"""

from __future__ import annotations

import json
import logging

logger = logging.getLogger("DroneMedic.AIAdapter")


class AIAdapter:
    """Interface for AI features. Override methods to swap LLM backend."""

    def parse_task(self, user_input: str) -> dict:
        """Parse natural language delivery request into structured task."""
        try:
            from ai.task_parser import parse_delivery_request
            return parse_delivery_request(user_input)
        except Exception as e:
            logger.error(f"AI parse_task failed: {e}")
            raise

    def chat(self, message: str, context: dict | None = None) -> str:
        """Chat with the mission coordinator."""
        try:
            from ai.coordinator import MissionCoordinator
            coordinator = MissionCoordinator()
            result = coordinator.converse(message)
            return result.get("response", "I couldn't process that request.")
        except Exception as e:
            logger.error(f"AI chat failed: {e}")
            return f"AI chat unavailable: {e}"

    def generate_report(self, metrics: dict, mission_summary: dict | None = None) -> str:
        """Generate a post-flight mission report."""
        system = (
            "You are a DroneMedic post-flight analyst for NHS hospital administrators. "
            "Given performance metrics and mission data, write a concise 3-5 sentence "
            "mission report covering: delivery outcome vs clinical deadline, route "
            "efficiency, any incidents encountered, and recommendation for future operations."
        )
        user_msg = json.dumps({"metrics": metrics, "mission_summary": mission_summary or {}})
        return self._call_gpt(system, user_msg)

    def weather_briefing(self, weather_data: dict) -> str:
        """Generate an AI weather briefing."""
        system = (
            "You are a DroneMedic weather analyst advising hospital operations. "
            "For each location, state: flyable or not, specific risk, recommended action."
        )
        return self._call_gpt(system, json.dumps(weather_data))

    def risk_score(
        self, route: list, weather: dict, battery: float, priority: str
    ) -> dict:
        """Compute AI-generated risk score for a delivery route."""
        system = (
            "You are a DroneMedic risk analyst. Given route, weather, battery, and "
            "payload priority, return a JSON object with: score (0-100), "
            "level (low/medium/high/critical), factors (list), recommendation (string), "
            "contingency (string). Return ONLY valid JSON."
        )
        user_msg = json.dumps({
            "route": route, "weather": weather,
            "battery": battery, "payload_priority": priority,
        })
        raw = self._call_gpt(system, user_msg)
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return {
                "score": 25, "level": "low",
                "factors": ["Unable to assess — using default"],
                "recommendation": "Proceed with caution",
                "contingency": "Backup drone on standby",
            }

    def narrate_event(self, event: dict, context: dict | None = None) -> str:
        """Generate live flight narration for a drone event."""
        system = (
            "You are a DroneMedic mission narrator. Given a flight event, "
            "produce a single concise narration sentence suitable for a live dashboard."
        )
        user_msg = json.dumps({"event": event, "context": context or {}})
        return self._call_gpt(system, user_msg)

    def _call_gpt(self, system: str, user_message: str) -> str:
        """Call GPT via OpenAI-compatible API."""
        try:
            from config import OPENAI_API_KEY, OPENAI_BASE_URL
            from openai import OpenAI
            client = OpenAI(api_key=OPENAI_API_KEY, base_url=OPENAI_BASE_URL)
            response = client.chat.completions.create(
                model="azure/gpt-5.3-chat",
                max_tokens=1024,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user_message},
                ],
            )
            return response.choices[0].message.content.strip()
        except Exception as e:
            logger.error(f"GPT call failed: {e}")
            return f"AI unavailable: {e}"
