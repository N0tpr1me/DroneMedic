"""
DroneMedic - Main Orchestrator

CLI-based delivery flow for testing without the Streamlit dashboard.
Demonstrates the full pipeline: NL input → AI parse → route optimize → drone execute → re-route.

Usage:
    python main.py                          # Interactive mode
    python main.py --demo                   # Run demo script automatically
    python main.py --skip-ai                # Skip AI, use hardcoded task
    python main.py --airsim                 # Use AirSim (default: mock)
"""

import argparse
import json
import logging
import time

from config import LOCATIONS
from ai.task_parser import parse_delivery_request
from backend.route_planner import compute_route, recompute_route
from simulation.drone_control import DroneController

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


def print_route(route: dict):
    """Pretty-print a delivery route."""
    print(f"\n{'='*40}")
    print("OPTIMISED ROUTE:")
    for i, loc in enumerate(route["ordered_route"]):
        arrow = "  →  " if i < len(route["ordered_route"]) - 1 else ""
        print(f"  [{i}] {loc}{arrow}")
    print(f"  Total distance: {route['total_distance']}")
    print(f"  Estimated time: {route['estimated_time']}s")
    print(f"{'='*40}\n")


def run_delivery(user_input: str, use_airsim: bool = False, skip_ai: bool = False):
    """
    Execute a full delivery pipeline.

    Args:
        user_input: Natural language delivery request.
        use_airsim: Whether to use AirSim (True) or mock mode (False).
        skip_ai: If True, use a hardcoded task instead of calling Claude.
    """
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
        }
        print(f"  (Using hardcoded task - AI skipped)")
    else:
        task = parse_delivery_request(user_input)

    print(f"  Parsed task: {json.dumps(task, indent=2)}")

    # --- Step 2: Compute route ---
    print("\n[STEP 2] Computing optimal route...")
    route = compute_route(task["locations"], task["priorities"])
    print_route(route)

    # --- Step 3: Execute route ---
    print("[STEP 3] Executing delivery route...")
    drone = DroneController(use_airsim=use_airsim)
    drone.connect()
    drone.takeoff()

    stops = route["ordered_route"]
    visited = []
    rerouted = False

    for i, waypoint in enumerate(stops):
        if waypoint == "Depot" and i == 0:
            continue  # Skip starting depot

        drone.move_to(waypoint)
        visited.append(waypoint)

        if waypoint == "Depot":
            print(f"  ✅ Returned to Depot")
        else:
            supply = task["supplies"].get(waypoint, "medical supplies")
            print(f"  ✅ Delivered {supply} to {waypoint}")

        # --- Step 4: Trigger re-routing at midpoint ---
        midpoint = len(stops) // 2
        if i == midpoint and not rerouted:
            rerouted = True
            print(f"\n{'!'*40}")
            print("⚡ ALERT: New urgent delivery request!")
            print("   'Emergency blood delivery to Clinic D'")
            print(f"{'!'*40}\n")

            time.sleep(1)

            # Pause drone
            drone.pause()

            # Compute remaining stops
            remaining = [s for s in stops[i + 1:] if s != "Depot"]

            # Recompute route
            print("[STEP 4] Recomputing route...")
            new_route = recompute_route(
                current_location=drone.get_current_location(),
                remaining_locations=remaining,
                new_locations=["Clinic D"],
                priorities={"Clinic D": "high"},
            )
            print_route(new_route)

            # Resume with new route
            drone.resume()

            # Execute remaining new route (skip first entry = current position)
            for j, new_wp in enumerate(new_route["ordered_route"][1:], 1):
                drone.move_to(new_wp)
                visited.append(new_wp)
                if new_wp == "Depot":
                    print(f"  ✅ Returned to Depot")
                else:
                    print(f"  ✅ Delivered to {new_wp}")

            break  # We've handled the rest of the route

    # --- Step 5: Land ---
    drone.land()

    # --- Summary ---
    print(f"\n{'='*40}")
    print("DELIVERY COMPLETE")
    print(f"  Stops visited: {' → '.join(visited)}")
    print(f"  Re-routed: {'Yes' if rerouted else 'No'}")
    print(f"{'='*40}")

    return drone.get_flight_log()


def main():
    parser = argparse.ArgumentParser(description="DroneMedic CLI")
    parser.add_argument("--demo", action="store_true", help="Run demo script")
    parser.add_argument("--skip-ai", action="store_true", help="Skip AI, use hardcoded task")
    parser.add_argument("--airsim", action="store_true", help="Use AirSim (default: mock)")
    args = parser.parse_args()

    print_banner()

    if args.demo or args.skip_ai:
        user_input = "Deliver insulin to Clinic A, blood to Clinic B urgently, and bandages to Clinic C"
        print(f"Request: {user_input}\n")
        run_delivery(user_input, use_airsim=args.airsim, skip_ai=args.skip_ai)
    else:
        user_input = input("Enter delivery request: ")
        if not user_input.strip():
            print("No input provided. Exiting.")
            return
        run_delivery(user_input, use_airsim=args.airsim)


if __name__ == "__main__":
    main()
