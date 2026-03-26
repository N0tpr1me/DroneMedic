"""
DroneMedic - Simulated Obstacle Detector

Simulates obstacle detection events at configurable flight progress points.
In a real system, this would use YOLO/CV on AirSim camera feed.
For the hackathon, obstacles are triggered at pre-set progress percentages.
"""

from __future__ import annotations

import logging
from config import LOCATIONS

logger = logging.getLogger("DroneMedic.Obstacle")

# Pre-configured obstacle events (triggered by flight progress %)
SIMULATED_OBSTACLES = [
    {
        "trigger_at_progress": 0.6,
        "type": "fallen_tree",
        "near_location": "Clinic C",
        "description": "Fallen tree blocking approach to Clinic C",
        "severity": "high",
    },
]

# Track which obstacles have been triggered (reset per flight)
_triggered_obstacles: set = set()


def reset_obstacles():
    """Reset triggered obstacle tracking for a new flight."""
    _triggered_obstacles.clear()


def check_for_obstacle(
    position: dict,
    flight_progress: float,
    obstacles: list | None = None,
) -> dict | None:
    """
    Check if an obstacle should be triggered at the current flight progress.

    Args:
        position: Current drone position {x, y, z}.
        flight_progress: Float 0.0 to 1.0 representing how far along the route.
        obstacles: Optional custom obstacle list (defaults to SIMULATED_OBSTACLES).

    Returns:
        Obstacle dict if triggered, None if clear.
    """
    if obstacles is None:
        obstacles = SIMULATED_OBSTACLES

    for i, obstacle in enumerate(obstacles):
        obstacle_id = f"obstacle_{i}"

        # Skip already-triggered obstacles
        if obstacle_id in _triggered_obstacles:
            continue

        # Check if we've reached the trigger point
        if flight_progress >= obstacle["trigger_at_progress"]:
            _triggered_obstacles.add(obstacle_id)

            # Get obstacle position (near the specified location)
            near_loc = obstacle.get("near_location", "Depot")
            obs_pos = LOCATIONS.get(near_loc, {"x": 0, "y": 0, "z": 0})

            result = {
                "type": obstacle["type"],
                "description": obstacle["description"],
                "severity": obstacle["severity"],
                "near_location": near_loc,
                "position": {"x": obs_pos["x"], "y": obs_pos["y"], "z": obs_pos["z"]},
            }

            logger.warning(
                f"[OBSTACLE] Detected: {obstacle['description']} "
                f"near {near_loc} at {flight_progress:.0%} progress"
            )
            return result

    return None


def get_obstacle_avoidance_locations(obstacle: dict) -> list:
    """
    Given a detected obstacle, return location names to avoid in re-routing.

    Args:
        obstacle: Obstacle dict from check_for_obstacle().

    Returns:
        List of location names that should be penalized or avoided.
    """
    return [obstacle["near_location"]]


# --- Quick test ---
if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    print("=== Obstacle detection simulation ===")
    reset_obstacles()

    for progress in [0.0, 0.3, 0.5, 0.6, 0.8, 1.0]:
        result = check_for_obstacle({"x": 0, "y": 0, "z": 0}, progress)
        status = f"OBSTACLE: {result['description']}" if result else "Clear"
        print(f"  Progress {progress:.0%}: {status}")

    print("\n=== After reset, triggers again ===")
    reset_obstacles()
    result = check_for_obstacle({"x": 0, "y": 0, "z": 0}, 0.6)
    print(f"  0.6: {result['type'] if result else 'clear'}")
    result = check_for_obstacle({"x": 0, "y": 0, "z": 0}, 0.7)
    print(f"  0.7: {result}")  # Should be None (already triggered)
