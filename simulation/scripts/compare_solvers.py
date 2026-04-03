"""Compare OR-Tools vs RL route optimizer on the same problem instances.

Generates random delivery scenarios using DroneMedic's location set,
solves each with both solvers, and prints a comparison table.

Usage:
    PYTHONPATH=. python3 scripts/compare_solvers.py
    PYTHONPATH=. python3 scripts/compare_solvers.py --scenarios 20
    PYTHONPATH=. python3 scripts/compare_solvers.py --rl-model models/rl_route_model.ckpt
"""

import argparse
import logging
import os
import random
import sys
import time

logging.basicConfig(
    level=logging.WARNING,
    format="%(levelname)s: %(message)s",
)

# Ensure project root is importable
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from config import LOCATIONS, PRIORITY_HIGH, PRIORITY_NORMAL


# ---------------------------------------------------------------------------
# Scenario generation
# ---------------------------------------------------------------------------

def generate_scenarios(count: int, seed: int = 42) -> list[dict]:
    """Generate random delivery scenarios from DroneMedic locations.

    Each scenario picks 2-4 clinics and randomly assigns priorities.
    """
    rng = random.Random(seed)
    clinics = [name for name in LOCATIONS if name != "Depot"]
    scenarios = []

    for i in range(count):
        n_stops = rng.randint(2, len(clinics))
        stops = rng.sample(clinics, n_stops)
        priorities = {}
        for stop in stops:
            if rng.random() < 0.3:
                priorities[stop] = PRIORITY_HIGH
            else:
                priorities[stop] = PRIORITY_NORMAL
        scenarios.append({
            "id": i + 1,
            "locations": stops,
            "priorities": priorities,
        })

    return scenarios


# ---------------------------------------------------------------------------
# Solver wrappers
# ---------------------------------------------------------------------------

def solve_ortools(locations: list[str], priorities: dict) -> dict:
    """Solve with OR-Tools and measure wall time."""
    from backend.route_planner import compute_route  # original project backend

    t0 = time.perf_counter()
    result = compute_route(locations, priorities, num_drones=1)
    elapsed_ms = (time.perf_counter() - t0) * 1000.0
    return {
        "route": result["ordered_route"],
        "distance": result["total_distance"],
        "battery": result["battery_usage"],
        "time_ms": round(elapsed_ms, 2),
    }


def solve_rl(planner, locations: list[str], priorities: dict) -> dict:
    """Solve with RL planner and measure wall time."""
    result = planner.compute_route(locations, priorities)
    return {
        "route": result["ordered_route"],
        "distance": result["total_distance"],
        "battery": result["battery_usage"],
        "time_ms": result["inference_ms"],
        "solver": result["solver"],
    }


# ---------------------------------------------------------------------------
# Table formatting
# ---------------------------------------------------------------------------

def print_comparison_table(rows: list[dict]) -> None:
    """Print a formatted comparison table to stdout."""
    header = (
        f"{'#':>3}  {'Stops':>5}  "
        f"{'OR-Tools Dist':>13}  {'RL Dist':>10}  {'Diff%':>6}  "
        f"{'OR-Tools ms':>11}  {'RL ms':>8}  {'Speedup':>7}  "
        f"{'RL Solver':>10}"
    )
    sep = "-" * len(header)

    print("\n" + sep)
    print("DroneMedic Solver Comparison: OR-Tools vs RL")
    print(sep)
    print(header)
    print(sep)

    total_ort_dist = 0
    total_rl_dist = 0
    total_ort_ms = 0.0
    total_rl_ms = 0.0

    for row in rows:
        ort = row["ortools"]
        rl = row["rl"]
        n_stops = row["n_stops"]
        sid = row["id"]

        ort_dist = ort["distance"]
        rl_dist = rl["distance"]
        if ort_dist > 0:
            diff_pct = ((rl_dist - ort_dist) / ort_dist) * 100
        else:
            diff_pct = 0.0

        ort_ms = ort["time_ms"]
        rl_ms = rl["time_ms"]
        speedup = ort_ms / rl_ms if rl_ms > 0 else float("inf")

        total_ort_dist += ort_dist
        total_rl_dist += rl_dist
        total_ort_ms += ort_ms
        total_rl_ms += rl_ms

        print(
            f"{sid:>3}  {n_stops:>5}  "
            f"{ort_dist:>13}  {rl_dist:>10}  {diff_pct:>+5.1f}%  "
            f"{ort_ms:>10.2f}  {rl_ms:>7.2f}  {speedup:>6.1f}x  "
            f"{rl.get('solver', 'rl'):>10}"
        )

    print(sep)

    # Summary
    avg_diff = (
        ((total_rl_dist - total_ort_dist) / total_ort_dist * 100)
        if total_ort_dist > 0
        else 0.0
    )
    avg_speedup = total_ort_ms / total_rl_ms if total_rl_ms > 0 else float("inf")

    print(f"\nSummary over {len(rows)} scenarios:")
    print(f"  OR-Tools total distance: {total_ort_dist}")
    print(f"  RL total distance:       {total_rl_dist}  ({avg_diff:+.1f}%)")
    print(f"  OR-Tools total time:     {total_ort_ms:.1f}ms")
    print(f"  RL total time:           {total_rl_ms:.1f}ms  ({avg_speedup:.1f}x speedup)")

    if avg_diff > 5:
        print("\n  Note: RL routes are longer than OR-Tools. This is expected with")
        print("  the greedy fallback. Train a model for better results:")
        print("    PYTHONPATH=. python3 scripts/train_rl_model.py")
    elif avg_diff <= 0:
        print("\n  RL routes are competitive with OR-Tools on solution quality!")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Compare OR-Tools vs RL route optimizer"
    )
    parser.add_argument(
        "--scenarios",
        type=int,
        default=10,
        help="Number of random scenarios to generate (default: 10)",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=42,
        help="Random seed for reproducibility (default: 42)",
    )
    parser.add_argument(
        "--rl-model",
        type=str,
        default=None,
        help="Path to trained RL model checkpoint (optional)",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    # Import solvers
    try:
        from backend.route_planner import compute_route  # original project backend  # noqa: F401
    except ImportError as exc:
        print(f"ERROR: Cannot import OR-Tools solver: {exc}")
        print("Install with: pip install ortools")
        sys.exit(1)

    from simulation.ai.rl_route_planner import RLRoutePlanner

    # Initialise RL planner (with optional trained model)
    rl_planner = RLRoutePlanner(model_path=args.rl_model)

    print(f"Generating {args.scenarios} random delivery scenarios (seed={args.seed})...")
    scenarios = generate_scenarios(args.scenarios, seed=args.seed)

    rows = []
    for scenario in scenarios:
        ort_result = solve_ortools(scenario["locations"], scenario["priorities"])
        rl_result = solve_rl(rl_planner, scenario["locations"], scenario["priorities"])
        rows.append({
            "id": scenario["id"],
            "n_stops": len(scenario["locations"]),
            "ortools": ort_result,
            "rl": rl_result,
        })

    print_comparison_table(rows)

    # Show individual route comparisons for first 3 scenarios
    print("\n" + "=" * 60)
    print("Route Details (first 3 scenarios)")
    print("=" * 60)
    for row in rows[:3]:
        sid = row["id"]
        print(f"\nScenario {sid}:")
        print(f"  OR-Tools: {' -> '.join(row['ortools']['route'])}")
        print(f"  RL:       {' -> '.join(row['rl']['route'])}")


if __name__ == "__main__":
    main()
