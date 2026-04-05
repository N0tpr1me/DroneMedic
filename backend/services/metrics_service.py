"""DroneMedic — Metrics service wrapping backend.metrics."""

from __future__ import annotations

from backend.domain.errors import MissionNotFoundError
from backend.metrics import compute_metrics, compute_naive_baseline
from backend.services.mission_service import MissionService
from backend.adapters.simulator_adapter import SimulatorAdapter


class MetricsService:

    def __init__(
        self,
        mission_service: MissionService,
        simulator_adapter: SimulatorAdapter,
    ) -> None:
        self._missions = mission_service
        self._adapter = simulator_adapter

    def compute_mission_metrics(self, mission_id: str) -> dict:
        mission = self._missions.get_mission(mission_id)
        flight_log = self._adapter.get_flight_log(mission.drone_id)
        locations = [
            self._missions.get_delivery(d_id).destination
            for d_id in mission.delivery_ids
            if d_id in self._missions._deliveries
        ]
        return compute_metrics(
            flight_log=flight_log,
            optimized_route={
                "ordered_route": mission.planned_route,
                "estimated_time": mission.estimated_time,
            },
            locations=locations,
            reroute_count=mission.reroute_count,
            reroute_successes=mission.reroute_count,
        )

    def get_naive_baseline(self, locations: list[str]) -> dict:
        return compute_naive_baseline(locations)
