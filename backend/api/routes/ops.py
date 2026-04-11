"""DroneMedic — Ops / observability routes."""

from __future__ import annotations

from fastapi import APIRouter

from backend.services.ops_metrics_service import get_ops_metrics

router = APIRouter(tags=["Ops"])


@router.get("/ops/metrics")
def ops_metrics() -> dict:
    """
    Runtime operations metrics.

    Returns request latency percentiles (p50/p95/p99/max), request counters
    grouped by status-code class, LLM call success/error counts, derived LLM
    error rate, and process uptime.
    """
    return get_ops_metrics().snapshot()


@router.get("/ops/health")
def ops_health() -> dict:
    """Liveness probe — always 200 when the process is up."""
    return {"status": "ok"}
