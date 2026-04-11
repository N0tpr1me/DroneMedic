"""
DroneMedic — Ambulance vs. drone race comparison route.

This endpoint powers the frontend race-timer widget. It computes an
ambulance-vs-drone delivery time comparison for a set of locations using
OR-Tools for the drone side and a naive sequential straight-line baseline
scaled to road distance for the ambulance side.

This module intentionally avoids importing anything from
``backend.api.dependencies`` (which pulls in the service graph and the
LLM coordinator) so that it can be mounted into a minimal FastAPI app
inside unit tests without booting the full backend.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Query

from config import LOCATIONS

router = APIRouter(tags=["Metrics"])

logger = logging.getLogger("DroneMedic.RaceComparison")


# ── Ambulance vs drone comparison constants ──────────────────────────
# Heuristics for a hackathon-quality ambulance time estimate.

_DRONE_CRUISE_MS = 15.0          # matches config.PHYSICS_CRUISE_SPEED_MS
_AMBULANCE_AVG_MS = 8.0          # NHS category 2 urban cross-city
_ROAD_TO_STRAIGHT_RATIO = 1.6    # London street network vs straight-line
_AMBULANCE_STOP_OVERHEAD_S = 60  # per-delivery dispatch / handover overhead

_RACE_ASSUMPTIONS = {
    "drone_cruise_ms": _DRONE_CRUISE_MS,
    "ambulance_avg_ms": _AMBULANCE_AVG_MS,
    "road_to_straight_ratio": _ROAD_TO_STRAIGHT_RATIO,
    "ambulance_stop_overhead_s": _AMBULANCE_STOP_OVERHEAD_S,
}


def _empty_race_payload(valid_locations: list[str]) -> dict:
    """Return the shape expected by the frontend when no locations are valid."""
    return {
        "locations": valid_locations,
        "drone_seconds": 0,
        "ambulance_seconds": 0,
        "seconds_saved": 0,
        "percent_saved": 0,
        "drone_distance_m": 0,
        "ambulance_distance_m": 0,
        "assumptions": dict(_RACE_ASSUMPTIONS),
    }


@router.get("/api/metrics/race-comparison")
def race_comparison(
    locations: str = Query(..., description="Comma-separated location names"),
) -> dict:
    """
    Compare optimized drone delivery time to a naive ambulance baseline.

    Ambulance time uses the naive sequential straight-line distance from
    ``compute_naive_baseline`` scaled by a road-network ratio and the NHS
    urban average ambulance speed, plus a per-stop dispatch overhead.
    """
    # Parse and validate location names — unknown entries are dropped.
    raw_names = [name.strip() for name in (locations or "").split(",")]
    valid_locations = [
        name for name in raw_names if name and name in LOCATIONS and name != "Depot"
    ]

    if not valid_locations:
        return _empty_race_payload(valid_locations)

    # Defer heavy imports until we actually need them.
    from backend.metrics import _route_distance, compute_naive_baseline
    from backend.route_planner import compute_route

    # Drone: run OR-Tools VRP.
    try:
        drone_route = compute_route(valid_locations, priorities={})
    except Exception as exc:  # noqa: BLE001 — wrap into an HTTP error
        logger.warning("race-comparison: compute_route failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"Route planning failed: {exc}")

    drone_seconds = int(drone_route.get("estimated_time", 0) or 0)
    drone_distance_m = int(round(
        _route_distance(drone_route.get("ordered_route", []) or [])
    ))

    # Ambulance: naive sequential route scaled to road distance + overhead.
    baseline = compute_naive_baseline(list(valid_locations))
    naive_distance_m = float(baseline.get("total_distance", 0.0) or 0.0)
    ambulance_distance_m = int(round(naive_distance_m * _ROAD_TO_STRAIGHT_RATIO))

    travel_seconds = (
        ambulance_distance_m / _AMBULANCE_AVG_MS if _AMBULANCE_AVG_MS > 0 else 0.0
    )
    ambulance_seconds = int(round(
        travel_seconds + _AMBULANCE_STOP_OVERHEAD_S * len(valid_locations)
    ))

    seconds_saved = max(0, ambulance_seconds - drone_seconds)
    if ambulance_seconds > 0:
        percent_saved = int(round((seconds_saved / ambulance_seconds) * 100))
    else:
        percent_saved = 0
    percent_saved = max(0, min(100, percent_saved))

    return {
        "locations": valid_locations,
        "drone_seconds": drone_seconds,
        "ambulance_seconds": ambulance_seconds,
        "seconds_saved": seconds_saved,
        "percent_saved": percent_saved,
        "drone_distance_m": drone_distance_m,
        "ambulance_distance_m": ambulance_distance_m,
        "assumptions": dict(_RACE_ASSUMPTIONS),
    }
