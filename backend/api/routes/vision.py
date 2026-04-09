"""DroneMedic — Vision analysis routes for drone camera images.

Two endpoint families:

* ``POST /api/vision/analyze`` — legacy landing / delivery analyzer.
* ``POST /api/vision/evaluate`` — structured "should the drone take this
  action?" evaluator used by the 3D simulator's vision-critique loop.
  The response shape matches the :class:`VisionEvaluation` model so the
  frontend can render it directly in ``SelfCritiquePanel``.
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(tags=["Vision"])
logger = logging.getLogger("DroneMedic.Vision")


# ── Request / response models ─────────────────────────────────────────


class VisionRequest(BaseModel):
    image_base64: str
    analysis_type: str = "landing_zone"  # or "delivery_scene"


class VisionEvaluateRequest(BaseModel):
    image_base64: str
    context: dict[str, Any] = Field(default_factory=dict)
    intended_action: str = "cruise"  # takeoff | cruise | approach | deliver | land | reroute


class VisionObstacle(BaseModel):
    label: str
    confidence: float = 0.5


class VisionEvaluation(BaseModel):
    scene_description: str
    obstacles: list[VisionObstacle] = Field(default_factory=list)
    path_clear: bool = True
    verdict: str = "safe"  # safe | caution | abort
    reason: str = ""
    confidence: float = 0.5
    timestamp: float = Field(default_factory=time.time)
    source: str = "gpt"


# ── Singleton ─────────────────────────────────────────────────────────

_analyzer = None


def _get_analyzer():
    global _analyzer
    if _analyzer is None:
        from ai.vision_analyzer import VisionAnalyzer

        _analyzer = VisionAnalyzer()
    return _analyzer


# ── Helpers ───────────────────────────────────────────────────────────


_VERDICT_WHITELIST = {"safe", "caution", "abort"}


def _fallback_evaluation(action: str, reason: str) -> VisionEvaluation:
    return VisionEvaluation(
        scene_description="Vision service unavailable — geometric fallback in use.",
        obstacles=[],
        path_clear=True,
        verdict="safe" if action in {"cruise", "takeoff"} else "caution",
        reason=reason,
        confidence=0.25,
        source="fallback",
    )


def _normalize_verdict(raw: Any) -> str:
    if not isinstance(raw, str):
        return "safe"
    value = raw.strip().lower()
    return value if value in _VERDICT_WHITELIST else "caution"


def _structured_evaluate(
    image_base64: str,
    intended_action: str,
    context: dict[str, Any],
) -> VisionEvaluation:
    """Call the GPT vision analyzer with a structured-output prompt."""
    analyzer = _get_analyzer()
    if not analyzer.available():
        return _fallback_evaluation(intended_action, "No vision API key configured.")

    # Build an action-aware prompt using the existing analyzer's client.
    try:
        from openai import OpenAI  # type: ignore

        client: OpenAI = analyzer._client  # type: ignore[attr-defined]
        prompt = (
            "You are the onboard vision co-pilot of an autonomous medical "
            "delivery drone flying over London. Evaluate the attached camera "
            f"image. The drone's current intended action is: {intended_action!r}. "
            f"Context: {json.dumps(context, default=str)[:600]}. "
            "Respond with strict JSON: "
            '{"scene_description": string, '
            '"obstacles": [{"label": string, "confidence": number}], '
            '"path_clear": bool, '
            '"verdict": "safe"|"caution"|"abort", '
            '"reason": string, '
            '"confidence": number}. '
            "Only abort if an obstacle or airspace conflict blocks the "
            "intended action. Use 'caution' for reduced-margin cases."
        )

        response = client.chat.completions.create(
            model="azure/gpt-5.3-chat",
            max_tokens=700,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/jpeg;base64,{image_base64}"
                            },
                        },
                    ],
                }
            ],
        )
        content = response.choices[0].message.content or "{}"
        parsed = json.loads(content)

        obstacles_raw = parsed.get("obstacles") or []
        obstacles: list[VisionObstacle] = []
        for entry in obstacles_raw:
            if isinstance(entry, dict) and "label" in entry:
                obstacles.append(
                    VisionObstacle(
                        label=str(entry.get("label", "unknown")),
                        confidence=float(entry.get("confidence", 0.5)),
                    )
                )
            elif isinstance(entry, str):
                obstacles.append(VisionObstacle(label=entry, confidence=0.5))

        return VisionEvaluation(
            scene_description=str(parsed.get("scene_description", "")),
            obstacles=obstacles,
            path_clear=bool(parsed.get("path_clear", True)),
            verdict=_normalize_verdict(parsed.get("verdict")),
            reason=str(parsed.get("reason", "")),
            confidence=float(parsed.get("confidence", 0.6)),
            source="gpt",
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("vision.evaluate failed: %s", exc)
        return _fallback_evaluation(intended_action, f"Upstream error: {exc}")


# ── Routes ────────────────────────────────────────────────────────────


@router.post("/api/vision/analyze")
async def analyze_image(req: VisionRequest) -> dict:
    """Analyze a drone camera image for landing safety or delivery scene."""
    analyzer = _get_analyzer()
    if req.analysis_type == "delivery_scene":
        return analyzer.analyze_delivery_scene(req.image_base64)
    return analyzer.analyze_landing_zone(req.image_base64)


@router.post("/api/vision/evaluate", response_model=VisionEvaluation)
async def evaluate_decision(req: VisionEvaluateRequest) -> VisionEvaluation:
    """Evaluate the drone's current intended action against a camera frame.

    Returns a structured verdict (``safe | caution | abort``) with reasoning.
    Callers use this for the in-panel self-critique HUD and the scheduler's
    pre-action veto hook.
    """
    if not req.image_base64:
        raise HTTPException(status_code=400, detail="image_base64 is required")
    return _structured_evaluate(req.image_base64, req.intended_action, req.context)
