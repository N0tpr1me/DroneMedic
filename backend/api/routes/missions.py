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


@router.get("/api/missions/{mission_id}/payload")
def get_payload_status(
    mission_id: str,
    mission_service=Depends(get_missions),
):
    """Get live payload temperature and integrity for an active mission."""
    from datetime import datetime, timezone
    from backend.services.payload_service import compute_payload_status
    from backend.weather_service import get_weather_at_location

    try:
        mission = mission_service.get_mission(mission_id)
    except DomainError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

    if not mission.started_at:
        return {"temperature_c": None, "integrity": "standby", "time_remaining_minutes": None, "payload_type": None}

    elapsed = (datetime.now(timezone.utc) - mission.started_at).total_seconds() / 60.0

    # Get supply type from first delivery
    payload_type = "blood"
    deliveries = []
    for d_id in mission.delivery_ids:
        try:
            d = mission_service.get_delivery(d_id)
            deliveries.append(d)
            if d.supply:
                payload_type = d.supply.split()[0].lower()
        except Exception:
            pass

    # Get wind at drone's current location
    wind = 0.0
    try:
        from backend.api.dependencies import get_drones
        drone_svc = get_drones()
        drone = drone_svc.get(mission.drone_id)
        w = get_weather_at_location(drone.current_location)
        wind = w.get("wind_speed", 0)
    except Exception:
        pass

    status = compute_payload_status(payload_type, elapsed, wind)

    # Include delivery recipient info
    recipient_info = {}
    if deliveries:
        d = deliveries[0]
        recipient_info = {
            "recipient": d.recipient,
            "recipient_role": d.recipient_role,
            "patient_count": d.patient_count,
            "destination": d.destination,
            "supply": d.supply,
        }

    return {**status, **recipient_info}
