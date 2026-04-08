"""DroneMedic — Smart delivery coordination API routes.

Exposes the DeliveryCoordinator for intelligent batching of repeat
requests from the same location.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.domain.models import DeliveryItem
from backend.api.dependencies import get_coordinator
from backend.services.delivery_coordinator import DeliveryCoordinator

router = APIRouter(prefix="/api/coordinate", tags=["Coordination"])


class CoordinateRequest(BaseModel):
    destination: str
    supply: str = ""
    priority: str = "normal"
    time_window_minutes: int | None = None


class CoordinateBatchRequest(BaseModel):
    deliveries: list[CoordinateRequest]


@router.post("/submit")
def coordinate_submit(
    req: CoordinateRequest,
    coordinator: DeliveryCoordinator = Depends(get_coordinator),
):
    """Submit a single delivery request through the smart coordinator.

    The coordinator decides whether to batch it onto an existing mission
    or dispatch a new drone.
    """
    try:
        item = DeliveryItem(
            destination=req.destination,
            supply=req.supply,
            priority=req.priority,
            time_window_minutes=req.time_window_minutes,
        )
        decision = coordinator.submit_request(item)
        return {
            "action": decision.action,
            "mission_id": decision.mission_id,
            "reason": decision.reason,
        }
    except Exception:
        raise HTTPException(status_code=500, detail="Coordination request failed")


@router.post("/submit-batch")
def coordinate_batch(
    req: CoordinateBatchRequest,
    coordinator: DeliveryCoordinator = Depends(get_coordinator),
):
    """Submit multiple delivery requests.  Each is evaluated for batching."""
    try:
        items = [
            DeliveryItem(
                destination=r.destination,
                supply=r.supply,
                priority=r.priority,
                time_window_minutes=r.time_window_minutes,
            )
            for r in req.deliveries
        ]
        decisions = coordinator.submit_batch(items)
        return {
            "decisions": [
                {
                    "action": d.action,
                    "mission_id": d.mission_id,
                    "reason": d.reason,
                    "destinations": [i.destination for i in d.items],
                }
                for d in decisions
            ],
        }
    except Exception:
        raise HTTPException(status_code=500, detail="Batch coordination failed")


@router.get("/active/{location}")
def get_active_for_location(
    location: str,
    coordinator: DeliveryCoordinator = Depends(get_coordinator),
):
    """Check if there are active deliveries heading to a location."""
    active = coordinator.get_active_deliveries_for(location)
    history = coordinator.get_request_history(location)
    return {
        "location": location,
        "active_deliveries": active,
        "request_history": {
            "total_requests": history.batch_count if history else 0,
            "first_request_at": history.first_request_at if history else None,
            "last_request_at": history.last_request_at if history else None,
        } if history else None,
    }
