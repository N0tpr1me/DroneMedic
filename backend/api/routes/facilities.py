"""DroneMedic — Facility routes."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from backend.facilities import (
    search_facilities,
    get_facility_by_name,
    register_facilities_as_locations,
)
from config import LOCATIONS

router = APIRouter(tags=["Facilities"])


@router.get("/api/facilities")
def list_facilities(
    query: str = Query(""),
    region: str = Query(""),
    limit: int = Query(50),
):
    return search_facilities(query=query, region=region, limit=limit)


@router.get("/api/facilities/{name}")
def get_facility(name: str):
    facility = get_facility_by_name(name)
    if facility is None:
        raise HTTPException(status_code=404, detail=f"Facility not found: {name}")
    return facility


@router.post("/api/facilities/register")
def register_facilities(
    max_facilities: int | None = Query(None),
    region: str | None = Query(None),
):
    count = register_facilities_as_locations(
        max_facilities=max_facilities, region=region
    )
    return {
        "status": "registered",
        "facilities_added": count,
        "total_locations": len(LOCATIONS),
    }
