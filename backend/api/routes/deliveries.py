"""DroneMedic — Delivery routes."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query

from backend.api.dependencies import get_events, get_missions, get_scheduler
from backend.domain.models import CreateBatchRequest
from backend.domain.errors import DomainError

router = APIRouter(tags=["Deliveries"])


@router.post("/api/deliveries")
def create_deliveries(
    req: CreateBatchRequest,
    scheduler=Depends(get_scheduler),
):
    try:
        deliveries, missions = scheduler.schedule_batch(req.deliveries)
        return {
            "deliveries": [d.model_dump() for d in deliveries],
            "missions": [m.model_dump() for m in missions],
        }
    except DomainError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/api/deploy")
async def deploy_mission(
    req: CreateBatchRequest,
    background_tasks: BackgroundTasks,
    scheduler=Depends(get_scheduler),
    mission_service=Depends(get_missions),
    events=Depends(get_events),
):
    """
    One-shot deploy: create deliveries + schedule + start all missions.
    Returns immediately. Live updates stream via WebSocket /ws/live.
    """
    try:
        deliveries, missions = scheduler.schedule_batch(req.deliveries)
        if missions:
            events.set_loop(asyncio.get_running_loop())
            planned_ids = [m.id for m in missions]
            background_tasks.add_task(mission_service.start_missions_concurrent, planned_ids)
        return {
            "status": "deployed",
            "deliveries": [d.model_dump() for d in deliveries],
            "missions": [m.model_dump() for m in missions],
        }
    except DomainError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/api/deliveries")
def list_deliveries(
    status: str | None = Query(None),
    mission_service=Depends(get_missions),
):
    try:
        deliveries = mission_service.get_all_deliveries(status)
        return [d.model_dump() for d in deliveries]
    except DomainError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
