"""DroneMedic — Vision analysis routes for drone camera images."""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(tags=["Vision"])


# ── Request models ────────────────────────────────────────────────────

class VisionRequest(BaseModel):
    image_base64: str
    analysis_type: str = "landing_zone"  # or "delivery_scene"


# ── Singleton ─────────────────────────────────────────────────────────

_analyzer = None


def _get_analyzer():
    global _analyzer
    if _analyzer is None:
        from ai.vision_analyzer import VisionAnalyzer
        _analyzer = VisionAnalyzer()
    return _analyzer


# ── Routes ────────────────────────────────────────────────────────────

@router.post("/api/vision/analyze")
async def analyze_image(req: VisionRequest) -> dict:
    """Analyze a drone camera image for landing safety or delivery scene."""
    analyzer = _get_analyzer()
    if req.analysis_type == "delivery_scene":
        return analyzer.analyze_delivery_scene(req.image_base64)
    return analyzer.analyze_landing_zone(req.image_base64)
