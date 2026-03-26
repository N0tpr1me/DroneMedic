"""
DroneMedic - Main Orchestrator

CLI-based delivery flow demonstrating the full pipeline:
NL input → AI parse → route optimize → drone execute → dynamic re-routing.

Usage:
    python main.py --skip-ai                   # Basic demo (hardcoded task)
    python main.py --demo                      # Same as --skip-ai
    python main.py --demo-weather              # Demo with weather re-routing
    python main.py --demo-obstacle             # Demo with obstacle detection
    python main.py --demo-full                 # All scenarios combined
    python main.py --multi-drone               # 2 drones, 4 clinics
    python main.py --airsim                    # Use AirSim (default: mock)
"""

import argparse
import json
import logging
import time

from config import LOCATIONS
from ai.task_parser import parse_delivery_request
from backend.route_planner import compute_route, recompute_route
from backend.weather_service import simulate_weather_event, clear_weather_overrides
from backend.geofence import check_route_safety
from backend.metrics import compute_metrics, format_metrics
from simulation.drone_control import DroneController, FleetController
from simulation.obstacle_detector import check_for_obstacle, reset_obstacles

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("DroneMedic")


def print_banner():
    print("""
╔══════════════════════════════════════════╗
║      🚁 DroneMedic - Drone Delivery     ║
║    AI-Powered Medical Supply System      ║
╚══════════════════════════════════════════╝
    """)


def print_route(route: dict, label: str = "OPTIMISED ROUTE"):
    """Pretty-print a delivery route."""
    print(f"\n{'='*40}")
    print(f"{label}:")
    for i, loc in enumerate(route["ordered_route"]):
        arrow = "  →  " if i < len(route["ordered_route"]) - 1 else ""
        print(f"  [{i}] {loc}{arrow}")
    print(f"  Total distance: {route['total_distance']}")
    print(f"  Estimated time: {route['estimated_time']}s")
    print(f"  Battery usage:  {route.get('battery_usage', 'N/A')}%")
    print(f"{'='*40}\n")


def run_delivery(
    user_input: str,
    use_airsim: bool = False,
    skip_ai: bool = False,
    enable_weather: bool = False,
    enable_obstacles: bool = False,
):
    """Execute a full delivery pipeline with optional weather/obstacle scenarios."""
    reroute_count = 0
    reroute_successes = 0
    obstacles_avoided = 0
    obstacles_total = 0

    # --- Step 1: Parse request ---
    print("\n[STEP 1] Parsing delivery request...")
    if skip_ai:
        task = {
            "locations": ["Clinic A", "Clinic B", "Clinic C"],
            "priorities": {"Clinic B": "high"},
            "supplies": {
                "Clinic A": "insulin",
                "Clinic B": "blood packs",
                "Clinic C": "bandages",
            },
            "constraints": {"avoid_zones": [], "weather_concern": "", "time_sensitive": False},
        }
        print("  (Using hardcoded task - AI skipped)")
    else:
        task = parse_delivery_request(user_input)

    print(f"  Parsed task: {json.dumps(task, indent=2)}")

    # --- Step 2: Check geofence safety ---
    print("\n[STEP 2] Computing optimal route...")
    route = compute_route(task["locations"], task["priorities"])
    print_route(route)

    violations = check_route_safety(route["ordered_route"])
    if violations:
        print("  ⚠️  Route has no-fly zone conflicts (solver avoided via cost penalty):")
        for v in violations:
            print(f"      {v['from']} → {v['to']} crosses {v['zone']}")

    # --- Step 3: Execute route ---
    print("[STEP 3] Executing delivery route...")
    drone = DroneController(use_airsim=use_airsim)
    drone.connect()
    drone.takeoff()

    stops = route["ordered_route"]
    visited = []
    rerouted = False
    weather_triggered = False
    obstacle_triggered = False
    reset_obstacles()

    for i, waypoint in enumerate(stops):
        if waypoint == "Depot" and i == 0:
            continue

        # Calculate flight progress
        progress = i / max(len(stops) - 1, 1)

        # --- Weather event at ~30% ---
        if enable_weather and not weather_triggered and progress >= 0.3:
            weather_triggered = True
            reroute_count += 1
            print(f"\n{'!'*40}")
            print("🌩️  WEATHER ALERT: Storm detected near Clinic B!")
            print(f"{'!'*40}\n")
            time.sleep(0.5)

            simulate_weather_event("storm", ["Clinic B"])
            drone.pause()

            remaining = [s for s in stops[i:] if s != "Depot"]
            print("[RE-ROUTE] Recomputing route with weather penalties...")
            new_route = recompute_route(
                current_location=drone.get_current_location(),
                remaining_locations=remaining,
                new_locations=[],
                priorities=task["priorities"],
            )
            print_route(new_route, "WEATHER-ADJUSTED ROUTE")

            clear_weather_overrides()
            drone.resume()

            for j, new_wp in enumerate(new_route["ordered_route"][1:], 1):
                sub_progress = (i + j) / max(len(stops) - 1, 1)

                # Check for obstacles during weather-rerouted flight
                if enable_obstacles and not obstacle_triggered and sub_progress >= 0.6:
                    obstacle_triggered = True
                    _handle_obstacle(drone, new_route, task, i + j, stops, visited)
                    obstacles_total += 1
                    obstacles_avoided += 1
                    reroute_count += 1
                    reroute_successes += 1
                    break

                drone.move_to(new_wp)
                visited.append(new_wp)
                if new_wp == "Depot":
                    print(f"  ✅ Returned to Depot")
                else:
                    supply = task["supplies"].get(new_wp, "medical supplies")
                    print(f"  ✅ Delivered {supply} to {new_wp}")

            reroute_successes += 1
            rerouted = True
            break

        # --- Obstacle event at ~60% ---
        if enable_obstacles and not obstacle_triggered and progress >= 0.6:
            obstacle_triggered = True
            obstacles_total += 1

            obstacle = check_for_obstacle(drone.get_position(), progress)
            if obstacle:
                reroute_count += 1
                print(f"\n{'!'*40}")
                print(f"🚧 OBSTACLE: {obstacle['description']}")
                print(f"{'!'*40}\n")
                time.sleep(0.5)

                drone.pause()
                remaining = [s for s in stops[i:] if s != "Depot"]

                print("[RE-ROUTE] Recomputing route to avoid obstacle...")
                new_route = recompute_route(
                    current_location=drone.get_current_location(),
                    remaining_locations=remaining,
                    new_locations=[],
                    priorities=task["priorities"],
                )
                print_route(new_route, "OBSTACLE-AVOIDANCE ROUTE")

                drone.resume()
                for new_wp in new_route["ordered_route"][1:]:
                    drone.move_to(new_wp)
                    visited.append(new_wp)
                    if new_wp == "Depot":
                        print(f"  ✅ Returned to Depot")
                    else:
                        print(f"  ✅ Delivered to {new_wp}")

                obstacles_avoided += 1
                reroute_successes += 1
                rerouted = True
                break

        drone.move_to(waypoint)
        visited.append(waypoint)

        if waypoint == "Depot":
            print(f"  ✅ Returned to Depot")
        else:
            supply = task["supplies"].get(waypoint, "medical supplies")
            print(f"  ✅ Delivered {supply} to {waypoint}")

        # --- New delivery trigger at midpoint ---
        midpoint = len(stops) // 2
        if i == midpoint and not rerouted:
            rerouted = True
            reroute_count += 1
            print(f"\n{'!'*40}")
            print("⚡ ALERT: New urgent delivery request!")
            print("   'Emergency blood delivery to Clinic D'")
            print(f"{'!'*40}\n")

            time.sleep(0.5)
            drone.pause()

            remaining = [s for s in stops[i + 1:] if s != "Depot"]
            print("[RE-ROUTE] Recomputing route with new delivery...")
            new_route = recompute_route(
                current_location=drone.get_current_location(),
                remaining_locations=remaining,
                new_locations=["Clinic D"],
                priorities={"Clinic D": "high"},
            )
            print_route(new_route, "UPDATED ROUTE")

            drone.resume()
            for new_wp in new_route["ordered_route"][1:]:
                drone.move_to(new_wp)
                visited.append(new_wp)
                if new_wp == "Depot":
                    print(f"  ✅ Returned to Depot")
                else:
                    print(f"  ✅ Delivered to {new_wp}")

            reroute_successes += 1
            break

    # --- Step 4: Land ---
    drone.land()

    # --- Step 5: Metrics ---
    print("\n[STEP 5] Computing delivery metrics...")
    all_locations = task["locations"] + (["Clinic D"] if "Clinic D" in visited else [])
    metrics = compute_metrics(
        flight_log=drone.get_flight_log(),
        optimized_route=route,
        locations=all_locations,
        reroute_count=reroute_count,
        reroute_successes=reroute_successes,
        obstacles_avoided=obstacles_avoided,
        obstacles_total=obstacles_total,
    )
    print(format_metrics(metrics))

    # --- Summary ---
    print(f"\n{'='*40}")
    print("DELIVERY COMPLETE")
    print(f"  Stops visited: {' → '.join(visited)}")
    print(f"  Re-routed: {'Yes' if rerouted else 'No'} ({reroute_count} events)")
    print(f"  Final battery: {drone.get_battery():.1f}%")
    print(f"{'='*40}")

    return drone.get_flight_log()


def _handle_obstacle(drone, current_route, task, current_idx, stops, visited):
    """Handle obstacle detection during flight."""
    obstacle = check_for_obstacle(drone.get_position(), current_idx / max(len(stops) - 1, 1))
    if obstacle:
        print(f"\n{'!'*40}")
        print(f"🚧 OBSTACLE: {obstacle['description']}")
        print(f"{'!'*40}\n")

        drone.pause()
        remaining = [s for s in current_route["ordered_route"][1:] if s != "Depot" and s not in visited]
        new_route = recompute_route(
            current_location=drone.get_current_location(),
            remaining_locations=remaining,
            new_locations=[],
            priorities=task["priorities"],
        )
        print_route(new_route, "OBSTACLE-AVOIDANCE ROUTE")

        drone.resume()
        for new_wp in new_route["ordered_route"][1:]:
            drone.move_to(new_wp)
            visited.append(new_wp)
            if new_wp == "Depot":
                print(f"  ✅ Returned to Depot")
            else:
                print(f"  ✅ Delivered to {new_wp}")


def run_multi_drone(use_airsim: bool = False):
    """Demo: multi-drone delivery with VRP."""
    print("\n[MULTI-DRONE] Computing routes for 2 drones, 4 clinics...")

    locations = ["Clinic A", "Clinic B", "Clinic C", "Clinic D"]
    priorities = {"Clinic B": "high"}

    route = compute_route(locations, priorities, num_drones=2)

    print(f"\nDrone assignments:")
    for drone_id, drone_route in route["ordered_routes"].items():
        real_stops = [s for s in drone_route if s != "Depot"]
        if real_stops:
            print(f"  {drone_id}: {' → '.join(drone_route)}")

    fleet = FleetController(num_drones=2, use_airsim=use_airsim)
    fleet.connect_all()
    fleet.execute_routes(route["ordered_routes"])

    print(f"\nBatteries: {fleet.get_all_batteries()}")


def main():
    parser = argparse.ArgumentParser(description="DroneMedic CLI")
    parser.add_argument("--demo", action="store_true", help="Run basic demo")
    parser.add_argument("--skip-ai", action="store_true", help="Skip AI, use hardcoded task")
    parser.add_argument("--demo-weather", action="store_true", help="Demo with weather re-routing")
    parser.add_argument("--demo-obstacle", action="store_true", help="Demo with obstacle detection")
    parser.add_argument("--demo-full", action="store_true", help="All scenarios combined")
    parser.add_argument("--multi-drone", action="store_true", help="Multi-drone VRP demo")
    parser.add_argument("--airsim", action="store_true", help="Use AirSim (default: mock)")
    args = parser.parse_args()

    print_banner()

    if args.multi_drone:
        run_multi_drone(use_airsim=args.airsim)
        return

    user_input = "Deliver insulin to Clinic A, blood to Clinic B urgently, and bandages to Clinic C"

    if args.demo_full:
        print(f"Request: {user_input}\n")
        run_delivery(user_input, use_airsim=args.airsim, skip_ai=True,
                     enable_weather=True, enable_obstacles=True)
    elif args.demo_weather:
        print(f"Request: {user_input}\n")
        run_delivery(user_input, use_airsim=args.airsim, skip_ai=True,
                     enable_weather=True)
    elif args.demo_obstacle:
        print(f"Request: {user_input}\n")
        run_delivery(user_input, use_airsim=args.airsim, skip_ai=True,
                     enable_obstacles=True)
    elif args.demo or args.skip_ai:
        print(f"Request: {user_input}\n")
        run_delivery(user_input, use_airsim=args.airsim, skip_ai=True)
    else:
        user_input = input("Enter delivery request: ")
        if not user_input.strip():
            print("No input provided. Exiting.")
            return
        run_delivery(user_input, use_airsim=args.airsim)


if __name__ == "__main__":
    main()
