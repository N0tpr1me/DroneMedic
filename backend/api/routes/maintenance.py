"""DroneMedic - Predictive Maintenance API routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from backend.api.dependencies import get_drones
from backend.domain.errors import DomainError

router = APIRouter(tags=["Maintenance"])

# Lazy-initialise the predictor once at module level.
_predictor = None


def _get_predictor():
    global _predictor
    if _predictor is None:
        from ai.predictive_maintenance import MaintenancePredictor
        _predictor = MaintenancePredictor()
    return _predictor


@router.get("/api/maintenance/{drone_id}")
def check_maintenance(drone_id: str, drone_service=Depends(get_drones)):
    """Run predictive maintenance analysis on a drone's recent telemetry.

    Returns risk score (0-100), anomaly flag, and maintenance recommendation.
    Uses Tier 1 (Z-score) always; Tier 2 (LSTM autoencoder) when PyTorch is
    available and a trained model exists.
    """
    # Validate drone exists
    try:
        drone = drone_service.get(drone_id)
    except DomainError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

    # Build telemetry snapshot list from current drone state.
    # In a full system this would pull historical telemetry from Supabase.
    # For the demo, we construct a single-point snapshot from the live cache.
    telemetry: list[dict] = [
        {
            "battery": drone.battery,
            "speed": drone.speed,
            "altitude": drone.altitude,
            "position": drone.position,
        }
    ]

    predictor = _get_predictor()
    result = predictor.predict(drone_id, telemetry)
    return result


@router.get("/api/maintenance/{drone_id}/demo")
def demo_maintenance(drone_id: str, anomalous: bool = False):
    """Demo endpoint with synthetic telemetry for judging presentations.

    Query params:
        anomalous: if true, simulate a failing battery.
    """
    if anomalous:
        telemetry = [
            {
                "battery": 100 - i * 5.0,
                "speed": 5.0,
                "altitude": 20.0,
                "position": {
                    "x": i * 10.0, "y": 0.0, "z": -30.0,
                    "lat": 51.507 + i * 0.001, "lon": -0.127,
                },
            }
            for i in range(20)
        ]
    else:
        telemetry = [
            {
                "battery": 100 - i * 0.5,
                "speed": 15.0,
                "altitude": 80.0,
                "position": {
                    "x": i * 10.0, "y": 0.0, "z": -30.0,
                    "lat": 51.507 + i * 0.001, "lon": -0.127,
                },
            }
            for i in range(20)
        ]

    predictor = _get_predictor()
    result = predictor.predict(drone_id, telemetry)
    return result
