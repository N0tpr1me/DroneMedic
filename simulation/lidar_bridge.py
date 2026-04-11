"""DroneMedic — LiDAR bridge (VM-side, STUB).

This module is a scaffolded placeholder for the future VM-side pipeline
that will stream real Gazebo ``gpu_lidar`` point clouds to the browser
through the FastAPI ``/ws/lidar`` proxy. It is NOT wired up yet.

When executed, the bridge will:

1.  Subscribe to the ``/world/dronemedic/model/x500/link/base_link/sensor/gpu_lidar/scan``
    gz-transport topic emitted by ``simulation/gazebo/x500_with_lidar.sdf``.
2.  Convert each incoming ``gz::msgs::PointCloudPacked`` into a lightweight
    ``LidarFrame`` JSON blob with drone-local ``LidarPoint`` records
    (matching the shape published by the browser's synthetic raycaster in
    ``web/src/components/three/sim/lidarBus.ts``).
3.  Publish the JSON blob on a WebSocket server bound to
    ``LIDAR_BRIDGE_WS_URL`` (default ``ws://localhost:8768``).
4.  Perform a lightweight clustering pass to produce
    ``LidarObstacle`` entries so the frontend doesn't have to cluster
    server-published point clouds.

Until this is implemented, the frontend runs with
``VITE_LIDAR_SOURCE=synthetic`` and raycasts the procedural scene in
the browser. Flip to ``VITE_LIDAR_SOURCE=vm`` after this bridge and the
associated Gazebo SDF are live.

Expected runtime dependencies (not installed in the current hackathon
environment): ``gz-transport``, ``rosbags``, ``websockets``, ``numpy``.

No code runs at import time — importing this module is safe.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

__all__ = ["LidarPoint", "LidarObstacle", "LidarFrame", "LidarBridge"]


@dataclass(frozen=True)
class LidarPoint:
    """Drone-local point (meters). Mirrors the TypeScript bus schema."""

    x: float
    y: float
    z: float
    distance: float
    intensity: float


@dataclass(frozen=True)
class LidarObstacle:
    """Clustered obstacle record emitted alongside the raw point cloud."""

    id: str
    bearing: float
    distance: float
    label: str
    severity: str  # 'info' | 'warning' | 'critical'
    timestamp: float


@dataclass(frozen=True)
class LidarFrame:
    """One LiDAR scan frame sent to the frontend."""

    timestamp: float
    source: str  # 'vm' when this bridge emits it
    points: tuple[LidarPoint, ...]
    obstacles: tuple[LidarObstacle, ...]
    drone_position: tuple[float, float, float]
    drone_heading: float


class LidarBridge(Protocol):
    """Protocol future implementation must satisfy."""

    async def start(self) -> None:
        """Connect to the gz-transport topic and open the WebSocket server."""
        ...

    async def stop(self) -> None:
        """Gracefully tear down subscriptions and the WebSocket server."""
        ...


def main() -> None:  # pragma: no cover - stub entrypoint
    """CLI entrypoint placeholder. Not yet implemented."""
    raise NotImplementedError(
        "lidar_bridge: VM-side bridge not implemented yet. "
        "Use VITE_LIDAR_SOURCE=synthetic on the frontend until the Gazebo "
        "gpu_lidar sensor is wired up (see simulation/gazebo/x500_with_lidar.sdf)."
    )


if __name__ == "__main__":
    main()
