"""RL-based route optimization using rl4co (PyTorch).

Provides the same interface as backend/route_planner.py for drop-in comparison.
Uses AttentionModel trained on CVRP (Capacitated VRP) which maps to
battery-constrained drone delivery.

If rl4co is not installed, falls back to a greedy nearest-neighbor heuristic
so the module remains importable and functional without GPU dependencies.
"""

import logging
import math
import os
import time
from typing import Optional

logger = logging.getLogger(__name__)

# Lazy imports -- rl4co / torch may not be installed
_RL4CO_AVAILABLE = False
try:
    import torch
    import numpy as np
    from rl4co.envs import CVRPEnv
    from rl4co.models import AttentionModelPolicy, REINFORCE
    from lightning import Trainer

    _RL4CO_AVAILABLE = True
except ImportError:
    torch = None  # type: ignore[assignment]
    np = None  # type: ignore[assignment]
    logger.info("rl4co/torch not installed -- RL planner will use greedy fallback")

# Always-available imports
from config import (
    LOCATIONS,
    BATTERY_CAPACITY,
    BATTERY_DRAIN_RATE,
    BATTERY_DRAIN_RATE_BASE,
)


# ---------------------------------------------------------------------------
# Geometry helpers (mirror route_planner.py logic)
# ---------------------------------------------------------------------------

def _euclidean_distance(loc1: dict, loc2: dict) -> int:
    """Euclidean distance in AirSim coordinate space."""
    return int(math.sqrt((loc1["x"] - loc2["x"]) ** 2 + (loc1["y"] - loc2["y"]) ** 2))


def _haversine_distance(loc1: dict, loc2: dict) -> int:
    """Haversine distance in meters between two GPS points."""
    from math import radians, sin, cos, sqrt, atan2

    R = 6371000
    lat1, lon1 = radians(loc1["lat"]), radians(loc1["lon"])
    lat2, lon2 = radians(loc2["lat"]), radians(loc2["lon"])
    dlat, dlon = lat2 - lat1, lon2 - lon1
    a = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlon / 2) ** 2
    return int(R * 2 * atan2(sqrt(a), sqrt(1 - a)))


# ---------------------------------------------------------------------------
# Greedy nearest-neighbor fallback
# ---------------------------------------------------------------------------

def _greedy_nearest_neighbor(
    location_names: list[str],
    priorities: dict,
    use_gps: bool = False,
) -> list[str]:
    """Simple nearest-neighbor heuristic starting from the first location (depot).

    High-priority locations get their effective distances scaled down by 0.3
    (same weight as OR-Tools solver) so they are visited earlier.
    """
    if len(location_names) <= 2:
        return list(location_names)

    distance_fn = _haversine_distance if use_gps else _euclidean_distance
    depot = location_names[0]
    unvisited = set(location_names[1:])
    route = [depot]
    current = depot

    while unvisited:
        best_name: Optional[str] = None
        best_dist = float("inf")
        for name in unvisited:
            dist = distance_fn(LOCATIONS[current], LOCATIONS[name])
            if priorities.get(name) == "high":
                dist = int(dist * 0.3)
            if dist < best_dist:
                best_dist = dist
                best_name = name
        if best_name is None:
            break
        route.append(best_name)
        current = best_name
        unvisited.discard(best_name)

    route.append("Depot")
    return route


# ---------------------------------------------------------------------------
# RL Route Planner
# ---------------------------------------------------------------------------

class RLRoutePlanner:
    """RL-based route planner wrapping an rl4co AttentionModel on CVRP.

    The ``compute_route`` method returns the exact same dict schema as
    ``backend.route_planner.compute_route`` so callers can swap solvers
    without code changes.
    """

    def __init__(self, model_path: Optional[str] = None) -> None:
        self._model = None
        self._env = None
        self._policy = None
        if model_path and os.path.exists(model_path):
            self.load_model(model_path)

    # ------------------------------------------------------------------
    # Training
    # ------------------------------------------------------------------

    def train(
        self,
        num_locations: int = 20,
        epochs: int = 5,
        batch_size: int = 256,
        train_data_size: int = 50_000,
        val_data_size: int = 1_000,
    ) -> object:
        """Train AttentionModel on CVRP.

        Args:
            num_locations: Number of customer nodes (excl. depot).
            epochs: Training epochs (~15 min on CPU for 5 epochs).
            batch_size: Samples per gradient step.
            train_data_size: Total training instances generated.
            val_data_size: Total validation instances generated.

        Returns:
            The trained REINFORCE model wrapper.

        Raises:
            ImportError: If rl4co / torch / lightning are not installed.
        """
        if not _RL4CO_AVAILABLE:
            raise ImportError(
                "rl4co, torch, and lightning are required for training. "
                "Install with: pip install rl4co torch lightning"
            )

        logger.info(
            "Training AttentionModel on CVRP-%d for %d epochs (batch=%d)",
            num_locations,
            epochs,
            batch_size,
        )

        env = CVRPEnv(generator_params={"num_loc": num_locations})
        policy = AttentionModelPolicy(env_name=env.name)
        model = REINFORCE(
            env,
            policy=policy,
            batch_size=batch_size,
            train_data_size=train_data_size,
            val_data_size=val_data_size,
        )

        trainer = Trainer(
            max_epochs=epochs,
            accelerator="auto",
            devices=1,
            logger=True,
        )
        trainer.fit(model)

        self._model = model
        self._env = env
        self._policy = policy
        logger.info("Training complete")
        return model

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------

    def save_model(self, path: str) -> None:
        """Save trained model checkpoint to *path*."""
        if not _RL4CO_AVAILABLE:
            raise ImportError("torch is required for saving models")
        if self._model is None:
            raise RuntimeError("No model to save -- call train() first")
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        torch.save(self._model.state_dict(), path)
        logger.info("Model saved to %s", path)

    def load_model(self, path: str) -> None:
        """Load a previously saved checkpoint from *path*."""
        if not _RL4CO_AVAILABLE:
            logger.warning("rl4co not available -- cannot load model from %s", path)
            return
        if not os.path.exists(path):
            logger.warning("Model file not found: %s", path)
            return

        env = CVRPEnv(generator_params={"num_loc": 20})
        policy = AttentionModelPolicy(env_name=env.name)
        model = REINFORCE(env, policy=policy, batch_size=64)
        model.load_state_dict(torch.load(path, map_location="cpu"))
        model.eval()

        self._model = model
        self._env = env
        self._policy = policy
        logger.info("Model loaded from %s", path)

    # ------------------------------------------------------------------
    # Coordinate conversion helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _locations_to_normalized_coords(
        location_names: list[str],
        use_gps: bool = False,
    ) -> tuple[list[float], list[float]]:
        """Return (xs, ys) normalised to [0, 1] for the given location names."""
        if use_gps:
            xs = [LOCATIONS[n]["lat"] for n in location_names]
            ys = [LOCATIONS[n]["lon"] for n in location_names]
        else:
            xs = [float(LOCATIONS[n]["x"]) for n in location_names]
            ys = [float(LOCATIONS[n]["y"]) for n in location_names]

        min_x, max_x = min(xs), max(xs)
        min_y, max_y = min(ys), max(ys)
        range_x = max_x - min_x if max_x != min_x else 1.0
        range_y = max_y - min_y if max_y != min_y else 1.0

        norm_xs = [(x - min_x) / range_x for x in xs]
        norm_ys = [(y - min_y) / range_y for y in ys]
        return norm_xs, norm_ys

    # ------------------------------------------------------------------
    # Inference
    # ------------------------------------------------------------------

    def _rl_inference(
        self,
        location_names: list[str],
        priorities: dict,
        battery_capacity: float,
        use_gps: bool = False,
    ) -> list[str]:
        """Run the RL model and return an ordered list of location names.

        Constructs a single CVRP instance tensor matching rl4co's expected
        format: depot coords + customer coords + demands + vehicle capacity.
        """
        if self._model is None or self._env is None:
            raise RuntimeError("No model loaded")

        n_customers = len(location_names) - 1  # first is depot
        norm_xs, norm_ys = self._locations_to_normalized_coords(
            location_names, use_gps=use_gps
        )

        # Build tensorised instance  (batch=1)
        depot = torch.tensor([[norm_xs[0], norm_ys[0]]])  # (1, 2)
        locs = torch.tensor(
            [[norm_xs[i], norm_ys[i]] for i in range(1, len(location_names))]
        ).unsqueeze(0)  # (1, n, 2)

        # Demands: high-priority locations get higher demand so the solver
        # allocates capacity to them first.  Normalised to [0, 1].
        demands = []
        for name in location_names[1:]:
            demands.append(0.3 if priorities.get(name) == "high" else 0.1)
        demand_tensor = torch.tensor([demands])  # (1, n)

        # Vehicle capacity normalised (we have one vehicle with capacity 1.0)
        capacity = torch.tensor([1.0])

        td = self._env.reset(
            batch_size=[1],
        )
        # Override the generated data with our custom instance
        td["locs"] = locs.float()
        td["depot"] = depot.float()
        td["demand"] = demand_tensor.float()
        td["vehicle_capacity"] = capacity.float()
        td["capacity"] = capacity.float()

        with torch.no_grad():
            out = self._model.policy(td, decode_type="greedy")

        # out["actions"] is (1, n) tensor of customer indices (0-based)
        actions = out["actions"].squeeze(0).tolist()

        # Map indices back to location names (index 0 = first customer, not depot)
        ordered = ["Depot"]
        for idx in actions:
            if 0 <= idx < n_customers:
                ordered.append(location_names[idx + 1])
        ordered.append("Depot")
        return ordered

    # ------------------------------------------------------------------
    # Public API  (matches backend.route_planner.compute_route)
    # ------------------------------------------------------------------

    def compute_route(
        self,
        locations: list[str],
        priorities: Optional[dict] = None,
        battery_capacity: Optional[float] = None,
        use_gps: bool = False,
    ) -> dict:
        """Compute a delivery route using the RL model (or greedy fallback).

        Args:
            locations: Delivery stop names (excluding Depot).
            priorities: ``{location_name: "high" | "normal"}``.
            battery_capacity: Override battery capacity (default from config).
            use_gps: Use lat/lon instead of AirSim x/y for distances.

        Returns:
            Dict matching ``backend.route_planner.compute_route`` schema::

                {
                    "ordered_route": [...],
                    "ordered_routes": {"Drone1": [...]},
                    "total_distance": int,
                    "estimated_time": int,
                    "battery_usage": float,
                    "no_fly_violations": [],
                    "solver": "rl" | "greedy",
                    "inference_ms": float,
                }
        """
        if priorities is None:
            priorities = {}
        if battery_capacity is None:
            battery_capacity = BATTERY_CAPACITY

        all_locations = ["Depot"] + [loc for loc in locations if loc != "Depot"]

        if len(all_locations) < 2:
            return {
                "ordered_route": ["Depot", "Depot"],
                "ordered_routes": {"Drone1": ["Depot", "Depot"]},
                "total_distance": 0,
                "estimated_time": 0,
                "battery_usage": 0,
                "no_fly_violations": [],
                "solver": "rl",
                "inference_ms": 0.0,
            }

        t0 = time.perf_counter()
        solver_used = "rl"

        # Try RL inference; fall back to greedy on any failure
        try:
            if not _RL4CO_AVAILABLE or self._model is None:
                raise RuntimeError("RL model not available")
            ordered_route = self._rl_inference(
                all_locations, priorities, battery_capacity, use_gps=use_gps
            )
        except Exception as exc:
            logger.info("RL inference unavailable (%s), using greedy fallback", exc)
            ordered_route = _greedy_nearest_neighbor(
                all_locations, priorities, use_gps=use_gps
            )
            solver_used = "greedy"

        inference_ms = (time.perf_counter() - t0) * 1000.0

        # Compute distance and battery metrics on the produced route
        distance_fn = _haversine_distance if use_gps else _euclidean_distance
        total_distance = 0
        for i in range(len(ordered_route) - 1):
            if ordered_route[i] in LOCATIONS and ordered_route[i + 1] in LOCATIONS:
                total_distance += distance_fn(
                    LOCATIONS[ordered_route[i]],
                    LOCATIONS[ordered_route[i + 1]],
                )

        battery_usage = round(total_distance * BATTERY_DRAIN_RATE, 1)
        estimated_time = int((total_distance / 5) + (len(ordered_route) * 10))

        return {
            "ordered_route": ordered_route,
            "ordered_routes": {"Drone1": ordered_route},
            "total_distance": total_distance,
            "estimated_time": estimated_time,
            "battery_usage": battery_usage,
            "no_fly_violations": [],
            "solver": solver_used,
            "inference_ms": round(inference_ms, 2),
        }


# ---------------------------------------------------------------------------
# Quick self-test
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

    planner = RLRoutePlanner()

    print("=== RL Route Planner (greedy fallback) ===\n")

    print("Test 1: Basic route")
    result = planner.compute_route(["Clinic A", "Clinic B", "Clinic C"], {})
    print(f"  Route:    {result['ordered_route']}")
    print(f"  Distance: {result['total_distance']}m")
    print(f"  Battery:  {result['battery_usage']}%")
    print(f"  Solver:   {result['solver']}")
    print(f"  Time:     {result['inference_ms']:.2f}ms\n")

    print("Test 2: Priority route (Clinic B urgent)")
    result = planner.compute_route(
        ["Clinic A", "Clinic B", "Clinic C"],
        {"Clinic B": "high"},
    )
    print(f"  Route:    {result['ordered_route']}")
    print(f"  Solver:   {result['solver']}\n")

    print("Test 3: All clinics")
    result = planner.compute_route(
        ["Clinic A", "Clinic B", "Clinic C", "Clinic D"],
        {"Clinic D": "high"},
    )
    print(f"  Route:    {result['ordered_route']}")
    print(f"  Distance: {result['total_distance']}m")
    print(f"  Battery:  {result['battery_usage']}%")
    print(f"  Solver:   {result['solver']}")
    print(f"  Time:     {result['inference_ms']:.2f}ms\n")

    if _RL4CO_AVAILABLE:
        print("rl4co IS available -- training could be run with planner.train()")
    else:
        print("rl4co NOT installed -- using greedy fallback only")
        print("Install with: pip install rl4co torch lightning")
