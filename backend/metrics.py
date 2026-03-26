"""
DroneMedic - Evaluation Metrics

Computes delivery performance metrics for demo presentations:
delivery time reduction, throughput, re-routing success rate, etc.
"""

import math
from config import LOCATIONS, BATTERY_DRAIN_RATE


def _route_distance(route: list) -> float:
    """Compute total Euclidean distance for an ordered route."""
    total = 0.0
    for i in range(len(route) - 1):
        if route[i] in LOCATIONS and route[i + 1] in LOCATIONS:
            loc1 = LOCATIONS[route[i]]
            loc2 = LOCATIONS[route[i + 1]]
            total += math.sqrt(
                (loc1["x"] - loc2["x"]) ** 2 +
                (loc1["y"] - loc2["y"]) ** 2
            )
    return total


def compute_naive_baseline(locations: list) -> dict:
    """
    Compute a naive sequential route (no optimization) for comparison.

    Visits locations in the order given, starting and ending at Depot.
    """
    naive_route = ["Depot"] + locations + ["Depot"]
    distance = _route_distance(naive_route)
    estimated_time = (distance / 5) + (len(naive_route) * 10)

    return {
        "ordered_route": naive_route,
        "total_distance": round(distance, 1),
        "estimated_time": int(estimated_time),
    }


def compute_metrics(
    flight_log: list,
    optimized_route: dict,
    locations: list,
    reroute_count: int = 0,
    reroute_successes: int = 0,
    obstacles_avoided: int = 0,
    obstacles_total: int = 0,
) -> dict:
    """
    Compute evaluation metrics comparing optimized vs naive delivery.

    Args:
        flight_log: List of flight log entries from DroneController.
        optimized_route: Route dict from compute_route().
        locations: Original list of delivery locations.
        reroute_count: Number of re-routing events triggered.
        reroute_successes: Number of successful re-routes.
        obstacles_avoided: Number of obstacles successfully avoided.
        obstacles_total: Total number of obstacles encountered.

    Returns:
        Dict with all evaluation metrics.
    """
    # Naive baseline
    naive = compute_naive_baseline(locations)
    naive_distance = naive["total_distance"]
    naive_time = naive["estimated_time"]

    # Optimized stats
    opt_route = optimized_route.get("ordered_route", [])
    opt_distance = _route_distance(opt_route)
    opt_time = optimized_route.get("estimated_time", 0)

    # Delivery time reduction
    if naive_time > 0:
        time_reduction = ((naive_time - opt_time) / naive_time) * 100
    else:
        time_reduction = 0.0

    # Distance reduction
    if naive_distance > 0:
        distance_reduction = ((naive_distance - opt_distance) / naive_distance) * 100
    else:
        distance_reduction = 0.0

    # Throughput: count actual deliveries from flight log
    deliveries = sum(
        1 for entry in flight_log
        if entry.get("event", "").startswith("arrived:") and "Depot" not in entry.get("event", "")
    )

    # Re-routing success rate
    reroute_success_rate = (
        (reroute_successes / reroute_count * 100) if reroute_count > 0 else 100.0
    )

    # Robustness score (0-1)
    if obstacles_total > 0:
        robustness = obstacles_avoided / obstacles_total
    else:
        robustness = 1.0

    # Battery usage
    battery_used = opt_distance * BATTERY_DRAIN_RATE

    # Actual delivery time from flight log
    if flight_log and len(flight_log) >= 2:
        actual_time = flight_log[-1]["timestamp"] - flight_log[0]["timestamp"]
    else:
        actual_time = 0

    return {
        "delivery_time_reduction": round(time_reduction, 1),
        "distance_reduction": round(distance_reduction, 1),
        "throughput": deliveries,
        "reroute_success_rate": round(reroute_success_rate, 1),
        "total_distance_optimized": round(opt_distance, 1),
        "total_distance_naive": round(naive_distance, 1),
        "battery_used": round(battery_used, 1),
        "robustness_score": round(robustness, 2),
        "actual_flight_time_seconds": round(actual_time, 1),
        "estimated_time_seconds": opt_time,
        "naive_time_seconds": naive_time,
    }


def format_metrics(metrics: dict) -> str:
    """Format metrics dict as a readable summary string."""
    lines = [
        "╔══════════════════════════════════════════╗",
        "║         DELIVERY METRICS SUMMARY         ║",
        "╚══════════════════════════════════════════╝",
        f"  Deliveries completed:    {metrics['throughput']}",
        f"  Distance (optimized):    {metrics['total_distance_optimized']}m",
        f"  Distance (naive):        {metrics['total_distance_naive']}m",
        f"  Distance reduction:      {metrics['distance_reduction']}%",
        f"  Time reduction:          {metrics['delivery_time_reduction']}%",
        f"  Re-route success rate:   {metrics['reroute_success_rate']}%",
        f"  Battery used:            {metrics['battery_used']}%",
        f"  Robustness score:        {metrics['robustness_score']}",
        f"  Actual flight time:      {metrics['actual_flight_time_seconds']}s",
    ]
    return "\n".join(lines)


# --- Quick test ---
if __name__ == "__main__":
    from backend.route_planner import compute_route

    route = compute_route(["Clinic A", "Clinic B", "Clinic C"], {"Clinic B": "high"})
    fake_log = [
        {"event": "takeoff", "timestamp": 1000},
        {"event": "arrived:Clinic A", "timestamp": 1030},
        {"event": "arrived:Clinic B", "timestamp": 1060},
        {"event": "arrived:Clinic C", "timestamp": 1090},
        {"event": "landed", "timestamp": 1120},
    ]

    metrics = compute_metrics(
        flight_log=fake_log,
        optimized_route=route,
        locations=["Clinic A", "Clinic B", "Clinic C"],
        reroute_count=1,
        reroute_successes=1,
        obstacles_avoided=1,
        obstacles_total=1,
    )

    print(format_metrics(metrics))
