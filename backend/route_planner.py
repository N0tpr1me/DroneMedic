"""
DroneMedic - Route Planner

Solves the Travelling Salesman Problem (TSP) using Google OR-Tools
to compute optimal multi-stop delivery routes with priority weighting.
"""

import math
from ortools.constraint_solver import routing_enums_pb2, pywrapcp
from config import LOCATIONS, PRIORITY_HIGH, PRIORITY_WEIGHT


def _euclidean_distance(loc1: dict, loc2: dict) -> int:
    """Compute Euclidean distance between two locations using AirSim coords."""
    return int(math.sqrt(
        (loc1["x"] - loc2["x"]) ** 2 +
        (loc1["y"] - loc2["y"]) ** 2
    ))


def _build_distance_matrix(location_names: list[str], priorities: dict) -> list[list[int]]:
    """
    Build a distance matrix for the given locations.

    High-priority destinations get their incoming distances multiplied by
    PRIORITY_WEIGHT (e.g. 0.3), making them appear "closer" so the solver
    visits them earlier in the route.
    """
    coords = [LOCATIONS[name] for name in location_names]
    n = len(coords)
    matrix = [[0] * n for _ in range(n)]

    for i in range(n):
        for j in range(n):
            if i == j:
                continue
            dist = _euclidean_distance(coords[i], coords[j])
            # Apply priority weight: reduce distance TO high-priority locations
            if priorities.get(location_names[j]) == PRIORITY_HIGH:
                dist = int(dist * PRIORITY_WEIGHT)
            matrix[i][j] = dist

    return matrix


def compute_route(locations: list[str], priorities: dict) -> dict:
    """
    Compute the optimal delivery route using OR-Tools TSP solver.

    Args:
        locations: List of location names to visit (excluding Depot).
        priorities: Dict mapping location names to "high" or "normal".

    Returns:
        Dict with:
            - ordered_route: list of location names in visit order (starts/ends at Depot)
            - total_distance: total route distance
            - estimated_time: rough time estimate in seconds
    """
    # Build full location list: Depot first, then delivery stops
    all_locations = ["Depot"] + [loc for loc in locations if loc != "Depot"]

    if len(all_locations) < 2:
        return {
            "ordered_route": ["Depot", "Depot"],
            "total_distance": 0,
            "estimated_time": 0,
        }

    distance_matrix = _build_distance_matrix(all_locations, priorities)

    # OR-Tools setup: 1 vehicle, starting at index 0 (Depot)
    manager = pywrapcp.RoutingIndexManager(
        len(all_locations),  # number of nodes
        1,                   # number of vehicles
        0,                   # depot index
    )
    routing = pywrapcp.RoutingModel(manager)

    def distance_callback(from_index, to_index):
        from_node = manager.IndexToNode(from_index)
        to_node = manager.IndexToNode(to_index)
        return distance_matrix[from_node][to_node]

    transit_callback_index = routing.RegisterTransitCallback(distance_callback)
    routing.SetArcCostEvaluatorOfAllVehicles(transit_callback_index)

    # Search strategy
    search_params = pywrapcp.DefaultRoutingSearchParameters()
    search_params.first_solution_strategy = (
        routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    )

    solution = routing.SolveWithParameters(search_params)

    if not solution:
        # Fallback: return locations in original order
        fallback_route = ["Depot"] + locations + ["Depot"]
        return {
            "ordered_route": fallback_route,
            "total_distance": -1,
            "estimated_time": -1,
        }

    # Extract route from solution
    ordered_route = []
    total_distance = 0
    index = routing.Start(0)

    while not routing.IsEnd(index):
        node = manager.IndexToNode(index)
        ordered_route.append(all_locations[node])
        next_index = solution.Value(routing.NextVar(index))
        total_distance += routing.GetArcCostForVehicle(index, next_index, 0)
        index = next_index

    # Add return to Depot
    ordered_route.append("Depot")

    # Rough time estimate: distance / velocity (5 m/s) + 10s per stop
    estimated_time = (total_distance / 5) + (len(ordered_route) * 10)

    return {
        "ordered_route": ordered_route,
        "total_distance": total_distance,
        "estimated_time": int(estimated_time),
    }


def recompute_route(
    current_location: str,
    remaining_locations: list[str],
    new_locations: list[str],
    priorities: dict,
) -> dict:
    """
    Recompute route mid-flight when new deliveries are added.

    Uses the drone's current location as the new starting point,
    combines remaining and new locations, and re-solves.

    Args:
        current_location: Where the drone currently is (or nearest known location).
        remaining_locations: Locations not yet visited from original route.
        new_locations: New locations to add to the route.
        priorities: Updated priority dict for all locations.

    Returns:
        Same format as compute_route, starting from current_location.
    """
    # Combine remaining + new, remove duplicates
    all_stops = list(dict.fromkeys(remaining_locations + new_locations))

    # Remove current location and Depot from stops (they're start/end)
    all_stops = [loc for loc in all_stops if loc not in (current_location, "Depot")]

    if not all_stops:
        return {
            "ordered_route": [current_location, "Depot"],
            "total_distance": _euclidean_distance(
                LOCATIONS[current_location], LOCATIONS["Depot"]
            ),
            "estimated_time": 30,
        }

    # Build location list with current position as "depot"
    all_locations = [current_location] + all_stops

    distance_matrix = _build_distance_matrix(all_locations, priorities)

    manager = pywrapcp.RoutingIndexManager(len(all_locations), 1, 0)
    routing = pywrapcp.RoutingModel(manager)

    def distance_callback(from_index, to_index):
        from_node = manager.IndexToNode(from_index)
        to_node = manager.IndexToNode(to_index)
        return distance_matrix[from_node][to_node]

    transit_callback_index = routing.RegisterTransitCallback(distance_callback)
    routing.SetArcCostEvaluatorOfAllVehicles(transit_callback_index)

    search_params = pywrapcp.DefaultRoutingSearchParameters()
    search_params.first_solution_strategy = (
        routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    )

    solution = routing.SolveWithParameters(search_params)

    if not solution:
        fallback = [current_location] + all_stops + ["Depot"]
        return {"ordered_route": fallback, "total_distance": -1, "estimated_time": -1}

    ordered_route = []
    total_distance = 0
    index = routing.Start(0)

    while not routing.IsEnd(index):
        node = manager.IndexToNode(index)
        ordered_route.append(all_locations[node])
        next_index = solution.Value(routing.NextVar(index))
        total_distance += routing.GetArcCostForVehicle(index, next_index, 0)
        index = next_index

    ordered_route.append("Depot")
    estimated_time = (total_distance / 5) + (len(ordered_route) * 10)

    return {
        "ordered_route": ordered_route,
        "total_distance": total_distance,
        "estimated_time": int(estimated_time),
    }


# --- Quick test ---
if __name__ == "__main__":
    print("=== Test 1: Basic route ===")
    result = compute_route(["Clinic A", "Clinic B", "Clinic C"], {})
    print(f"Route: {result['ordered_route']}")
    print(f"Distance: {result['total_distance']}")

    print("\n=== Test 2: Priority route (Clinic B urgent) ===")
    result = compute_route(
        ["Clinic A", "Clinic B", "Clinic C"],
        {"Clinic B": "high"},
    )
    print(f"Route: {result['ordered_route']}")
    print(f"Distance: {result['total_distance']}")

    print("\n=== Test 3: Re-routing from Clinic A, add Clinic D urgent ===")
    result = recompute_route(
        current_location="Clinic A",
        remaining_locations=["Clinic C"],
        new_locations=["Clinic D"],
        priorities={"Clinic D": "high"},
    )
    print(f"New route: {result['ordered_route']}")
    print(f"Distance: {result['total_distance']}")
