"""DroneMedic — Mission routes."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query

from backend.api.dependencies import get_events, get_missions
from backend.domain.models import RerouteRequest
from backend.domain.enums import MissionStatus
from backend.domain.errors import DomainError

router = APIRouter(tags=["Missions"])


@router.get("/api/missions")
def list_missions(mission_service=Depends(get_missions)):
    try:
        missions = mission_service.get_all_missions()
        return [m.model_dump() for m in missions]
    except DomainError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/api/missions/{mission_id}")
def get_mission(mission_id: str, mission_service=Depends(get_missions)):
    try:
        mission = mission_service.get_mission(mission_id)
        deliveries = [
            mission_service.get_delivery(d_id).model_dump()
            for d_id in mission.delivery_ids
        ]
        return {
            "mission": mission.model_dump(),
            "deliveries": deliveries,
        }
    except DomainError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.post("/api/missions/{mission_id}/start")
async def start_mission(
    mission_id: str,
    background_tasks: BackgroundTasks,
    mission_service=Depends(get_missions),
    events=Depends(get_events),
):
    try:
        mission = mission_service.get_mission(mission_id)
        if mission.status != MissionStatus.planning:
            raise HTTPException(
                status_code=400,
                detail=f"Mission is '{mission.status}', expected 'planning'",
            )
        events.set_loop(asyncio.get_running_loop())
        background_tasks.add_task(
            asyncio.to_thread, mission_service.start_mission, mission_id
        )
        return {"status": "started", "mission_id": mission_id}
    except DomainError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.post("/api/missions/start-all")
async def start_all_missions(
    background_tasks: BackgroundTasks,
    mission_service=Depends(get_missions),
    events=Depends(get_events),
):
    try:
        all_missions = mission_service.get_all_missions()
        planned_ids = [
            m.id for m in all_missions if m.status == MissionStatus.planning
        ]
        events.set_loop(asyncio.get_running_loop())
        background_tasks.add_task(
            mission_service.start_missions_concurrent, planned_ids
        )
        return {"status": "started", "mission_ids": planned_ids, "concurrent": True}
    except DomainError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/api/missions/{mission_id}/pause")
def pause_mission(mission_id: str, mission_service=Depends(get_missions)):
    try:
        mission_service.pause_mission(mission_id)
        return {"status": "paused", "mission_id": mission_id}
    except DomainError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/api/missions/{mission_id}/resume")
def resume_mission(mission_id: str, mission_service=Depends(get_missions)):
    try:
        mission_service.resume_mission(mission_id)
        return {"status": "resumed", "mission_id": mission_id}
    except DomainError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/api/missions/{mission_id}/abort")
def abort_mission(
    mission_id: str,
    reason: str = Query(""),
    mission_service=Depends(get_missions),
):
    try:
        mission_service.abort_mission(mission_id, reason)
        return {"status": "aborted", "mission_id": mission_id}
    except DomainError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/api/missions/{mission_id}/reroute")
def reroute_mission(
    mission_id: str,
    req: RerouteRequest,
    mission_service=Depends(get_missions),
):
    try:
        mission_service.reroute_mission(mission_id, req.reason, req.new_deliveries)
        return {"status": "rerouting", "mission_id": mission_id}
    except DomainError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
