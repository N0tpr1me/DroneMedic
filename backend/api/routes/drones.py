"""DroneMedic — Drone routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from backend.api.dependencies import get_drones
from backend.domain.errors import DomainError

router = APIRouter(tags=["Drones"])


@router.get("/api/drones")
def list_drones(drone_service=Depends(get_drones)):
    try:
        drones = drone_service.get_all()
        return [d.model_dump() for d in drones]
    except DomainError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/api/drones/{drone_id}")
def get_drone(drone_id: str, drone_service=Depends(get_drones)):
    try:
        drone = drone_service.get(drone_id)
        return drone.model_dump()
    except DomainError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
