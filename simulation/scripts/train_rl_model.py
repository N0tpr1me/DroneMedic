"""Train the RL route optimization model and save checkpoint.

Trains an AttentionModel (Transformer-based) on Capacitated VRP instances
using REINFORCE policy gradient via the rl4co library.

Usage:
    PYTHONPATH=. python3 scripts/train_rl_model.py
    PYTHONPATH=. python3 scripts/train_rl_model.py --epochs 10 --num-locations 30
    PYTHONPATH=. python3 scripts/train_rl_model.py --output models/custom_model.ckpt

The saved checkpoint can be loaded by ai.rl_route_planner.RLRoutePlanner.
"""

import argparse
import logging
import os
import sys
import time

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

# Ensure project root is importable
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Train RL route optimizer for DroneMedic"
    )
    parser.add_argument(
        "--num-locations",
        type=int,
        default=20,
        help="Number of customer locations per CVRP instance (default: 20)",
    )
    parser.add_argument(
        "--epochs",
        type=int,
        default=5,
        help="Training epochs (default: 5, ~15 min on CPU)",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=256,
        help="Batch size per gradient step (default: 256)",
    )
    parser.add_argument(
        "--train-data-size",
        type=int,
        default=50_000,
        help="Number of training instances to generate (default: 50000)",
    )
    parser.add_argument(
        "--val-data-size",
        type=int,
        default=1_000,
        help="Number of validation instances to generate (default: 1000)",
    )
    parser.add_argument(
        "--output",
        type=str,
        default=os.path.join(PROJECT_ROOT, "models", "rl_route_model.ckpt"),
        help="Path to save the trained model checkpoint",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    # Check rl4co availability before doing anything expensive
    try:
        import torch  # noqa: F401
        import rl4co  # noqa: F401
        import lightning  # noqa: F401
    except ImportError as exc:
        logger.error(
            "Missing dependency: %s\n"
            "Install with: pip install rl4co torch lightning",
            exc,
        )
        sys.exit(1)

    from simulation.ai.rl_route_planner import RLRoutePlanner

    planner = RLRoutePlanner()

    print("=" * 60)
    print("DroneMedic RL Route Optimizer -- Training")
    print("=" * 60)
    print(f"  CVRP size:        {args.num_locations} locations")
    print(f"  Epochs:           {args.epochs}")
    print(f"  Batch size:       {args.batch_size}")
    print(f"  Train instances:  {args.train_data_size}")
    print(f"  Val instances:    {args.val_data_size}")
    print(f"  Output:           {args.output}")
    print("=" * 60)

    t0 = time.time()

    planner.train(
        num_locations=args.num_locations,
        epochs=args.epochs,
        batch_size=args.batch_size,
        train_data_size=args.train_data_size,
        val_data_size=args.val_data_size,
    )

    elapsed = time.time() - t0
    print(f"\nTraining completed in {elapsed:.1f}s ({elapsed / 60:.1f} min)")

    # Save checkpoint
    planner.save_model(args.output)
    print(f"Model saved to {args.output}")

    # Quick validation: run inference on DroneMedic locations
    print("\n--- Validation: inference on DroneMedic locations ---")
    result = planner.compute_route(
        ["Clinic A", "Clinic B", "Clinic C", "Clinic D"],
        {"Clinic B": "high"},
    )
    print(f"  Route:        {result['ordered_route']}")
    print(f"  Distance:     {result['total_distance']}m")
    print(f"  Battery:      {result['battery_usage']}%")
    print(f"  Solver:       {result['solver']}")
    print(f"  Inference:    {result['inference_ms']:.2f}ms")
    print("\nDone.")


if __name__ == "__main__":
    main()
