"""DroneMedic — AI decision log API routes."""

from __future__ import annotations

from fastapi import APIRouter, Query

from backend.services.ai_decision_log import get_ai_decision_log

router = APIRouter(tags=["AI"])


@router.get("/api/ai/decisions")
def get_recent_decisions(
    limit: int = Query(50, ge=1, le=500),
) -> dict:
    """Return the most recent AI coordinator decisions (newest first)."""
    decisions = get_ai_decision_log().recent(limit=limit)
    return {"decisions": decisions, "count": len(decisions)}
