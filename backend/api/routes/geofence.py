"""DroneMedic — Geofence / No-Fly Zone routes."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from backend.geofence import get_no_fly_zones, add_no_fly_zone, remove_no_fly_zone

router = APIRouter(tags=["Geofence"])


@router.get("/api/geofence/zones")
def list_zones():
    return get_no_fly_zones()


@router.post("/api/geofence/zones")
def create_zone(body: dict):
    zone = {
        "name": body["name"],
        "polygon": [tuple(p) for p in body["polygon"]],
        "lat_lon": [tuple(ll) for ll in body["lat_lon"]],
    }
    add_no_fly_zone(zone)
    return {"status": "created", "zone": body["name"]}


@router.delete("/api/geofence/zones/{zone_name}")
def delete_zone(zone_name: str):
    removed = remove_no_fly_zone(zone_name)
    if not removed:
        raise HTTPException(status_code=404, detail=f"Zone not found: {zone_name}")
    return {"status": "removed", "zone": zone_name}
