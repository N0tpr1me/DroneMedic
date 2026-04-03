"""
Pre-position drones based on predicted demand.

Assigns available drones to the highest-predicted-demand locations and
compares reactive (from base) vs predictive (pre-positioned) response times.
"""

import math
from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class DronePosition:
    """Immutable record of a drone's assigned position."""
    drone_id: str
    location_id: str
    lat: float
    lon: float


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance between two lat/lon points in kilometres."""
    R = 6371.0  # Earth radius in km
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return 2 * R * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def compute_prepositions(
    predictions: dict,
    num_drones: int,
    locations: dict,
) -> list[DronePosition]:
    """Assign drones to the top-N predicted high-demand locations.

    Args:
        predictions: {location_id: [{"yhat": float, ...}, ...]}
                     Output from DemandPredictor.predict().
        num_drones:  Number of drones available for pre-positioning.
        locations:   {location_id: {"lat": float, "lon": float, ...}}
                     Typically config.LOCATIONS.

    Returns:
        Sorted list of DronePosition assignments (highest demand first).
    """
    # Aggregate total predicted demand per location
    demand_scores: list[tuple[str, float]] = []
    for loc_id, preds in predictions.items():
        total = sum(max(0.0, p.get("yhat", 0)) for p in preds)
        demand_scores.append((loc_id, total))

    # Sort descending by predicted demand
    demand_scores.sort(key=lambda x: x[1], reverse=True)

    positions: list[DronePosition] = []
    for i, (loc_id, _score) in enumerate(demand_scores[:num_drones]):
        loc = locations.get(loc_id, {})
        lat = loc.get("lat", 0.0)
        lon = loc.get("lon", 0.0)
        positions.append(
            DronePosition(
                drone_id=f"Drone{i + 1}",
                location_id=loc_id,
                lat=lat,
                lon=lon,
            )
        )

    return positions


def calculate_response_improvement(
    emergencies: list[dict],
    base_position: dict,
    prepositioned: list[DronePosition],
    speed_kmh: float = 54.0,
) -> dict:
    """Compare reactive (from base) vs predictive (pre-positioned) response times.

    Args:
        emergencies: List of emergency dicts with at minimum
                     {"location_lat": float, "location_lon": float}.
        base_position: {"lat": float, "lon": float} of the depot/base.
        prepositioned: List of DronePosition from compute_prepositions().
        speed_kmh:    Drone cruise speed in km/h (default 54, ~15 m/s).

    Returns:
        {
            "avg_reactive_min": float,
            "avg_predictive_min": float,
            "reduction_percent": float,
            "time_saved_per_emergency": float,
            "total_emergencies": int,
        }
    """
    if not emergencies:
        return {
            "avg_reactive_min": 0.0,
            "avg_predictive_min": 0.0,
            "reduction_percent": 0.0,
            "time_saved_per_emergency": 0.0,
            "total_emergencies": 0,
        }

    speed_km_per_min = speed_kmh / 60.0
    reactive_times: list[float] = []
    predictive_times: list[float] = []

    base_lat = base_position["lat"]
    base_lon = base_position["lon"]

    for emg in emergencies:
        emg_lat = emg["location_lat"]
        emg_lon = emg["location_lon"]

        # Reactive: always dispatch from base
        dist_reactive = _haversine_km(base_lat, base_lon, emg_lat, emg_lon)
        reactive_min = dist_reactive / speed_km_per_min
        reactive_times.append(reactive_min)

        # Predictive: dispatch from nearest pre-positioned drone
        min_predictive = reactive_min  # fallback if no prepositioned drones
        for drone in prepositioned:
            dist = _haversine_km(drone.lat, drone.lon, emg_lat, emg_lon)
            t = dist / speed_km_per_min
            if t < min_predictive:
                min_predictive = t
        predictive_times.append(min_predictive)

    n = len(emergencies)
    avg_reactive = sum(reactive_times) / n
    avg_predictive = sum(predictive_times) / n

    reduction = (
        ((avg_reactive - avg_predictive) / avg_reactive * 100.0)
        if avg_reactive > 0
        else 0.0
    )

    return {
        "avg_reactive_min": round(avg_reactive, 2),
        "avg_predictive_min": round(avg_predictive, 2),
        "reduction_percent": round(reduction, 2),
        "time_saved_per_emergency": round(avg_reactive - avg_predictive, 2),
        "total_emergencies": n,
    }


# ======================================================================
# Main — demo with synthetic data
# ======================================================================

if __name__ == "__main__":
    import csv
    import os
    import random
    import sys

    # Try importing from project config
    try:
        sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        from config import LOCATIONS, NUM_DRONES
    except ImportError:
        LOCATIONS = {
            "Depot":    {"lat": 51.5074, "lon": -0.1278},
            "Clinic A": {"lat": 51.5124, "lon": -0.1200},
            "Clinic B": {"lat": 51.5174, "lon": -0.1350},
            "Clinic C": {"lat": 51.5044, "lon": -0.1100},
            "Clinic D": {"lat": 51.5000, "lon": -0.1400},
        }
        NUM_DRONES = 2

    # ------------------------------------------------------------------
    # Scenario 1: Mock predictions (no Prophet needed)
    # ------------------------------------------------------------------
    print("=" * 60)
    print("  Pre-positioning Demo (mock predictions)")
    print("=" * 60)

    random.seed(99)
    mock_predictions: dict = {}
    for loc_id in LOCATIONS:
        if loc_id == "Depot":
            demand = random.uniform(0.5, 2.0)
        else:
            demand = random.uniform(1.0, 8.0)
        mock_predictions[loc_id] = [{"yhat": demand}]

    print("\nMock predicted demand:")
    for loc_id, preds in sorted(
        mock_predictions.items(), key=lambda x: x[1][0]["yhat"], reverse=True
    ):
        print(f"  {loc_id:<12s}  {preds[0]['yhat']:.2f}")

    positions = compute_prepositions(mock_predictions, NUM_DRONES, LOCATIONS)
    print(f"\nDrone pre-positions ({NUM_DRONES} drones):")
    for pos in positions:
        print(
            f"  {pos.drone_id} -> {pos.location_id} "
            f"({pos.lat:.4f}, {pos.lon:.4f})"
        )

    # ------------------------------------------------------------------
    # Scenario 2: Response improvement with synthetic emergencies
    # ------------------------------------------------------------------
    data_path = "data/synthetic_emergencies.csv"
    if os.path.exists(data_path):
        print(f"\n{'='*60}")
        print("  Response Time Improvement (from synthetic data)")
        print(f"{'='*60}")

        with open(data_path, "r") as f:
            reader = csv.DictReader(f)
            all_emergencies = [
                {
                    "location_lat": float(r["location_lat"]),
                    "location_lon": float(r["location_lon"]),
                }
                for r in reader
            ]

        # Sample 500 emergencies for quick demo
        sample = random.sample(all_emergencies, min(500, len(all_emergencies)))

        base = {"lat": LOCATIONS["Depot"]["lat"], "lon": LOCATIONS["Depot"]["lon"]}

        result = calculate_response_improvement(
            emergencies=sample,
            base_position=base,
            prepositioned=positions,
        )

        print(f"\n  Emergencies evaluated: {result['total_emergencies']}")
        print(f"  Avg reactive (from base):   {result['avg_reactive_min']:.2f} min")
        print(f"  Avg predictive (pre-pos):   {result['avg_predictive_min']:.2f} min")
        print(f"  Reduction:                  {result['reduction_percent']:.1f}%")
        print(f"  Time saved per emergency:   {result['time_saved_per_emergency']:.2f} min")
    else:
        print(f"\nSkipping response improvement demo ({data_path} not found).")
        print("Run scripts/generate_synthetic_data.py first.")

    print()
