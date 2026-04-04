"""DroneMedic — Weather routes."""

from __future__ import annotations

from fastapi import APIRouter

from backend.weather_service import get_all_location_weather

router = APIRouter(tags=["Weather"])


@router.get("/api/weather")
def get_weather():
    return {"weather": get_all_location_weather()}
