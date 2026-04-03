"""DroneMedic — Metrics routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from backend.api.dependencies import get_metrics
from backend.domain.errors import DomainError

router = APIRouter(tags=["Metrics"])


@router.get("/api/metrics/{mission_id}")
def get_mission_metrics(mission_id: str, metrics_service=Depends(get_metrics)):
    try:
        return metrics_service.compute_mission_metrics(mission_id)
    except DomainError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
