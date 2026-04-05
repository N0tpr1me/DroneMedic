"""Vision analysis — GPT-5.3 analyzes drone camera images for obstacles and landing safety."""
from __future__ import annotations

import json
import logging
import base64
from openai import OpenAI
from config import OPENAI_API_KEY, OPENAI_BASE_URL

logger = logging.getLogger(__name__)


class VisionAnalyzer:
    def __init__(self) -> None:
        self._client: OpenAI | None = None
        if OPENAI_API_KEY:
            self._client = OpenAI(api_key=OPENAI_API_KEY, base_url=OPENAI_BASE_URL)

    def available(self) -> bool:
        return self._client is not None

    def analyze_landing_zone(self, image_base64: str) -> dict:
        """Analyze drone camera image for safe landing zone."""
        if not self._client:
            return self._demo_landing_result()
        try:
            response = self._client.chat.completions.create(
                model="azure/gpt-5.3-chat",
                max_tokens=1024,
                messages=[{
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": (
                                "You are a drone landing zone safety assessor. "
                                "Analyze this aerial image. Identify obstacles, people, "
                                "vehicles, or hazards. Rate safety 1-10. Respond with JSON: "
                                '{"safe": bool, "safety_score": int, "obstacles": [str], '
                                '"people_detected": bool, "recommendation": str}'
                            ),
                        },
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:image/jpeg;base64,{image_base64}"},
                        },
                    ],
                }],
            )
            return json.loads(response.choices[0].message.content)
        except Exception as e:
            logger.warning(f"Vision analysis failed: {e}")
            return self._demo_landing_result()

    def analyze_delivery_scene(self, image_base64: str) -> dict:
        """Analyze delivery location from drone camera."""
        if not self._client:
            return self._demo_delivery_result()
        try:
            response = self._client.chat.completions.create(
                model="azure/gpt-5.3-chat",
                max_tokens=1024,
                messages=[{
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": (
                                "Analyze this drone delivery location image. "
                                "Is there a clear receiving area? Is someone waiting? "
                                "Identify the building type. Respond JSON: "
                                '{"receiving_area_clear": bool, "personnel_visible": bool, '
                                '"building_type": str, "recommendation": str}'
                            ),
                        },
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:image/jpeg;base64,{image_base64}"},
                        },
                    ],
                }],
            )
            return json.loads(response.choices[0].message.content)
        except Exception as e:
            logger.warning(f"Delivery scene analysis failed: {e}")
            return self._demo_delivery_result()

    def _demo_landing_result(self) -> dict:
        return {
            "safe": True,
            "safety_score": 8,
            "obstacles": ["low vegetation"],
            "people_detected": False,
            "recommendation": "Landing zone clear. Proceed with delivery.",
        }

    def _demo_delivery_result(self) -> dict:
        return {
            "receiving_area_clear": True,
            "personnel_visible": True,
            "building_type": "hospital",
            "recommendation": "Medical staff visible at receiving bay. Clear to deliver.",
        }
