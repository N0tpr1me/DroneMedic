"""
DroneMedic - Route Planner

Solves the Vehicle Routing Problem (VRP) using Google OR-Tools
to compute optimal multi-stop delivery routes with priority weighting,
no-fly zone avoidance, weather penalties, and battery constraints.
"""

import math
from ortools.constraint_solver import routing_enums_pb2, pywrapcp
from config import (
    LOCATIONS, PRIORITY_HIGH, PRIORITY_WEIGHT,
    BATTERY_CAPACITY, BATTERY_DRAIN_RATE, BATTERY_MIN_RESERVE, NUM_DRONES,
)
from backend.geofence import segment_crosses_no_fly_zone
from backend.weather_service import get_weather_at_location, is_flyable

# Cost multiplier for paths crossing no-fly zones (effectively blocks them)
NO_FLY_PENALTY = 100
# Cost multiplier for paths toward locations with bad weather
WEATHER_PENALTY = 3


def _euclidean_distance(loc1: dict, loc2: dict) -> int:
    """Compute Euclidean distance between two locations using AirSim coords."""
    return int(math.sqrt(
        (loc1["x"] - loc2["x"]) ** 2 +
        (loc1["y"] - loc2["y"]) ** 2
    ))


def _build_distance_matrix(location_names: list, priorities: dict) -> list:
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


def _apply_no_fly_penalty(matrix: list, location_names: list) -> list:
    """
    Inflate costs for flight paths that cross no-fly zones.
    Paths crossing a zone get their cost multiplied by NO_FLY_PENALTY.
    """
    n = len(location_names)
    for i in range(n):
        for j in range(n):
            if i == j or matrix[i][j] == 0:
                continue
            loc_i = LOCATIONS[location_names[i]]
            loc_j = LOCATIONS[location_names[j]]
            crosses, _ = segment_crosses_no_fly_zone(
                loc_i["x"], loc_i["y"], loc_j["x"], loc_j["y"]
            )
            if crosses:
                matrix[i][j] = matrix[i][j] * NO_FLY_PENALTY
    return matrix


def _apply_weather_penalty(matrix: list, location_names: list, weather: dict = None) -> list:
    """
    Increase cost of traveling TO locations with bad weather.
    If weather dict is provided, uses it; otherwise queries weather service.
    """
    n = len(location_names)
    for j in range(n):
        loc_name = location_names[j]
        if weather and loc_name in weather:
            loc_weather = weather[loc_name]
        else:
            loc_weather = get_weather_at_location(loc_name)

        if not is_flyable(loc_weather):
            for i in range(n):
                if i != j and matrix[i][j] > 0:
                    matrix[i][j] = matrix[i][j] * WEATHER_PENALTY
    return matrix


def compute_route(
    locations: list,
    priorities: dict,
    weather: dict = None,
    num_drones: int = None,
    time_windows: dict = None,
) -> dict:
    """
    Compute optimal delivery route(s) using OR-Tools VRP solver.

    Args:
        locations: List of location names to visit (excluding Depot).
        priorities: Dict mapping location names to "high" or "normal".
        weather: Optional dict of {location_name: weather_dict} for penalties.
        num_drones: Number of drones (default: config.NUM_DRONES).
        time_windows: Optional dict of {location_name: max_seconds}.
                      Each value is the latest arrival time in seconds from start.
                      E.g. {"Clinic B": 1800} means Clinic B must be reached within 30 min.

    Returns:
        Dict with:
            - ordered_route: list of location names (single drone, backward compat)
            - ordered_routes: dict of {drone_id: [route]} (multi-drone)
            - total_distance: total route distance
            - estimated_time: rough time estimate in seconds
            - battery_usage: estimated battery % used
            - no_fly_violations: list of avoided zones
    """
    if num_drones is None:
        num_drones = NUM_DRONES

    # Build full location list: Depot first, then delivery stops
    all_locations = ["Depot"] + [loc for loc in locations if loc != "Depot"]

    if len(all_locations) < 2:
        return {
            "ordered_route": ["Depot", "Depot"],
            "ordered_routes": {"Drone1": ["Depot", "Depot"]},
            "total_distance": 0,
            "estimated_time": 0,
            "battery_usage": 0,
            "no_fly_violations": [],
        }

    # Build and enhance distance matrix
    distance_matrix = _build_distance_matrix(all_locations, priorities)
    distance_matrix = _apply_no_fly_penalty(distance_matrix, all_locations)
    distance_matrix = _apply_weather_penalty(distance_matrix, all_locations, weather)

    # OR-Tools setup
    manager = pywrapcp.RoutingIndexManager(
        len(all_locations),
        num_drones,
        0,  # depot index
    )
    routing = pywrapcp.RoutingModel(manager)

    def distance_callback(from_index, to_index):
        from_node = manager.IndexToNode(from_index)
        to_node = manager.IndexToNode(to_index)
        return distance_matrix[from_node][to_node]

    transit_callback_index = routing.RegisterTransitCallback(distance_callback)
    routing.SetArcCostEvaluatorOfAllVehicles(transit_callback_index)

    # Battery constraint: uses RAW distance (without penalties) for realistic drain
    raw_matrix = _build_distance_matrix(all_locations, {})  # no priority/penalty adjustments

    def raw_distance_callback(from_index, to_index):
        from_node = manager.IndexToNode(from_index)
        to_node = manager.IndexToNode(to_index)
        return raw_matrix[from_node][to_node]

    raw_transit_index = routing.RegisterTransitCallback(raw_distance_callback)
    max_battery_distance = int(BATTERY_CAPACITY / BATTERY_DRAIN_RATE) if BATTERY_DRAIN_RATE > 0 else 999999
    routing.AddDimension(
        raw_transit_index,
        0,                      # no slack
        max_battery_distance,   # max distance per vehicle (battery limit)
        True,                   # start cumul to zero
        "Distance",
    )

    # Time window constraints (if any delivery has a deadline)
    if time_windows:
        # Build a time matrix: travel_time = distance / velocity + 10s per stop
        velocity = 5  # m/s (from config.DRONE_VELOCITY)
        service_time = 10  # seconds per delivery stop

        def time_callback(from_index, to_index):
            from_node = manager.IndexToNode(from_index)
            to_node = manager.IndexToNode(to_index)
            travel = raw_matrix[from_node][to_node]
            travel_seconds = int(travel / velocity) + service_time if travel > 0 else 0
            return travel_seconds

        time_transit_index = routing.RegisterTransitCallback(time_callback)

        # Max horizon: largest time window or 2 hours
        max_time = max(time_windows.values()) if time_windows else 7200
        max_time = max(max_time, 7200)

        routing.AddDimension(
            time_transit_index,
            max_time,          # allow waiting (slack)
            max_time,          # max cumulative time per vehicle
            True,              # start cumul to zero
            "Time",
        )

        time_dimension = routing.GetDimensionOrDie("Time")

        # Depot has no constraint (index 0)
        # Apply time windows to delivery locations
        for loc_name, deadline_seconds in time_windows.items():
            if loc_name in all_locations:
                node_index = all_locations.index(loc_name)
                index = manager.NodeToIndex(node_index)
                time_dimension.CumulVar(index).SetRange(0, int(deadline_seconds))

    # Search strategy
    search_params = pywrapcp.DefaultRoutingSearchParameters()
    search_params.first_solution_strategy = (
        routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    )

    solution = routing.SolveWithParameters(search_params)

    if not solution:
        fallback_route = ["Depot"] + locations + ["Depot"]
        return {
            "ordered_route": fallback_route,
            "ordered_routes": {"Drone1": fallback_route},
            "total_distance": -1,
            "estimated_time": -1,
            "battery_usage": -1,
            "no_fly_violations": [],
        }

    # Extract routes for all drones
    ordered_routes = {}
    total_distance = 0

    for vehicle_id in range(num_drones):
        drone_name = f"Drone{vehicle_id + 1}"
        route = []
        index = routing.Start(vehicle_id)

        while not routing.IsEnd(index):
            node = manager.IndexToNode(index)
            route.append(all_locations[node])
            next_index = solution.Value(routing.NextVar(index))
            total_distance += routing.GetArcCostForVehicle(index, next_index, vehicle_id)
            index = next_index

        route.append("Depot")
        ordered_routes[drone_name] = route

    # Primary route (first drone) for backward compatibility
    primary_route = ordered_routes.get("Drone1", ["Depot", "Depot"])

    # Compute real (unpenalized) distance for battery and time estimates
    raw_total = 0
    for drone_route in ordered_routes.values():
        for k in range(len(drone_route) - 1):
            if drone_route[k] in LOCATIONS and drone_route[k + 1] in LOCATIONS:
                raw_total += _euclidean_distance(
                    LOCATIONS[drone_route[k]], LOCATIONS[drone_route[k + 1]]
                )

    battery_usage = raw_total * BATTERY_DRAIN_RATE
    estimated_time = (raw_total / 5) + (len(primary_route) * 10)

    return {
        "ordered_route": primary_route,
        "ordered_routes": ordered_routes,
        "total_distance": total_distance,
        "estimated_time": int(estimated_time),
        "battery_usage": round(battery_usage, 1),
        "no_fly_violations": [],
    }


def recompute_route(
    current_location: str,
    remaining_locations: list,
    new_locations: list,
    priorities: dict,
    weather: dict = None,
) -> dict:
    """
    Recompute route mid-flight when new deliveries are added or conditions change.

    Uses the drone's current location as the new starting point,
    combines remaining and new locations, and re-solves.
    """
    # Combine remaining + new, remove duplicates
    all_stops = list(dict.fromkeys(remaining_locations + new_locations))
    all_stops = [loc for loc in all_stops if loc not in (current_location, "Depot")]

    if not all_stops:
        return {
            "ordered_route": [current_location, "Depot"],
            "ordered_routes": {"Drone1": [current_location, "Depot"]},
            "total_distance": _euclidean_distance(
                LOCATIONS[current_location], LOCATIONS["Depot"]
            ),
            "estimated_time": 30,
            "battery_usage": 0,
            "no_fly_violations": [],
        }

    # Build location list with current position as "depot"
    all_locations = [current_location] + all_stops

    distance_matrix = _build_distance_matrix(all_locations, priorities)
    distance_matrix = _apply_no_fly_penalty(distance_matrix, all_locations)
    distance_matrix = _apply_weather_penalty(distance_matrix, all_locations, weather)

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
        return {
            "ordered_route": fallback,
            "ordered_routes": {"Drone1": fallback},
            "total_distance": -1,
            "estimated_time": -1,
            "battery_usage": -1,
            "no_fly_violations": [],
        }

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
    battery_usage = total_distance * BATTERY_DRAIN_RATE

    return {
        "ordered_route": ordered_route,
        "ordered_routes": {"Drone1": ordered_route},
        "total_distance": total_distance,
        "estimated_time": int(estimated_time),
        "battery_usage": round(battery_usage, 1),
        "no_fly_violations": [],
    }


# --- Quick test ---
if __name__ == "__main__":
    print("=== Test 1: Basic route (backward compatible) ===")
    result = compute_route(["Clinic A", "Clinic B", "Clinic C"], {})
    print(f"Route: {result['ordered_route']}")
    print(f"Distance: {result['total_distance']}, Battery: {result['battery_usage']}%")

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

    print("\n=== Test 4: With simulated storm at Clinic B ===")
    from backend.weather_service import simulate_weather_event
    simulate_weather_event("storm", ["Clinic B"])
    result = compute_route(
        ["Clinic A", "Clinic B", "Clinic C"],
        {},
    )
    print(f"Route (storm at B): {result['ordered_route']}")
    print(f"Distance: {result['total_distance']}")

    from backend.weather_service import clear_weather_overrides
    clear_weather_overrides()

    print("\n=== Test 5: Multi-drone (2 drones, 4 clinics) ===")
    result = compute_route(
        ["Clinic A", "Clinic B", "Clinic C", "Clinic D"],
        {},
        num_drones=2,
    )
    print(f"Drone routes: {result['ordered_routes']}")
    print(f"Total distance: {result['total_distance']}")
