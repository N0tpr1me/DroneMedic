"""DroneMedic — Forecast & AI evaluation routes."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from backend.api.dependencies import get_ai
from backend.adapters.ai_adapter import AIAdapter

logger = logging.getLogger("DroneMedic.ForecastRoutes")

router = APIRouter(tags=["Forecast & AI Eval"])


# ── Request / Response models ────────────────────────────────────────────


class EvalRequest(BaseModel):
    categories: list[str] | None = None


# ── Forecast endpoint ────────────────────────────────────────────────────


@router.get("/api/forecast/{facility_name}")
async def get_forecast(
    facility_name: str,
    days: int = Query(default=7, ge=1, le=30),
) -> dict[str, Any]:
    """Return demand forecast for a facility.

    Tries to load delivery history from Supabase. Falls back to demo data
    when the database is unavailable or has no records.
    """
    from ai.demand_forecast import DemandForecaster, get_demo_forecast

    # Attempt real data from Supabase
    history = await _fetch_delivery_history(facility_name)

    if history:
        forecaster = DemandForecaster(alpha=0.3)
        return forecaster.forecast(facility_name, history, horizon_days=days)

    # Fallback: demo forecast
    logger.info("No Supabase history for %s — returning demo forecast", facility_name)
    return get_demo_forecast(facility_name)


# ── AI evaluation endpoint ───────────────────────────────────────────────


@router.post("/api/ai/evaluate")
async def evaluate_ai(
    body: EvalRequest | None = None,
    ai: AIAdapter = Depends(get_ai),
) -> dict[str, Any]:
    """Run the golden-test evaluation suite against the current AI parser.

    Optionally filter by category names in the request body.
    """
    from ai.eval_runner import EvalRunner

    async def _parse(text: str) -> dict[str, Any]:
        """Wrap the sync AIAdapter.parse_task in an executor."""
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, ai.parse_task, text)

    runner = EvalRunner(_parse)
    categories = body.categories if body else None

    try:
        report = await runner.run(categories=categories)
    except Exception as exc:
        logger.error("AI evaluation failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"Evaluation failed: {exc}")

    return report


# ── Helpers ──────────────────────────────────────────────────────────────


async def _fetch_delivery_history(facility_name: str) -> list[dict[str, Any]]:
    """Query Supabase deliveries table for a facility's recent history.

    Returns an empty list when Supabase is not configured or the query fails.
    """
    try:
        from backend.db.supabase_client import get_supabase

        sb = get_supabase()
        if sb is None:
            return []

        result = (
            sb.table("deliveries")
            .select("created_at, supply_type, quantity")
            .ilike("facility_name", f"%{facility_name}%")
            .order("created_at", desc=True)
            .limit(200)
            .execute()
        )

        rows = result.data or []
        return [
            {
                "date": row.get("created_at", "")[:10],
                "supply": row.get("supply_type", "unknown"),
                "count": row.get("quantity", 1),
            }
            for row in rows
        ]
    except Exception as exc:
        logger.warning("Supabase delivery history query failed: %s", exc)
        return []
