"""DroneMedic — Scheduler service: assigns deliveries to drones."""

from __future__ import annotations

import logging

from config import LOCATIONS
from backend.domain.enums import EventType
from backend.domain.errors import DroneUnavailableError, InvalidLocationError
from backend.domain.models import Delivery, DeliveryItem, Mission
from backend.services.drone_service import DroneService
from backend.services.event_service import EventService
from backend.services.mission_service import MissionService
from backend.services.route_service import RouteService

logger = logging.getLogger("DroneMedic.Scheduler")


class SchedulerService:

    def __init__(
        self,
        mission_service: MissionService,
        drone_service: DroneService,
        route_service: RouteService,
        event_service: EventService,
    ) -> None:
        self._missions = mission_service
        self._drones = drone_service
        self._routes = route_service
        self._events = event_service

    def schedule_batch(
        self, items: list[DeliveryItem]
    ) -> tuple[list[Delivery], list[Mission]]:
        """Create deliveries, assign to available drones, compute routes."""
        # Validate locations
        for item in items:
            if item.destination not in LOCATIONS:
                raise InvalidLocationError(item.destination)

        # Create delivery objects
        deliveries = self._missions.create_deliveries(items)

        # Find available drones
        available = self._drones.get_available()
        if not available:
            for d in deliveries:
                d.status = "failed"
            self._events.publish(EventType.mission_failed, {
                "reason": "no_drones_available",
            })
            return deliveries, []

        # Build priorities and time windows
        priorities = {
            d.destination: d.priority
            for d in deliveries
            if d.priority == "high"
        }
        time_windows = {}
        for d in deliveries:
            if d.time_window_minutes is not None:
                time_windows[d.destination] = d.time_window_minutes * 60

        # Unique locations (excluding Depot)
        locations = list(dict.fromkeys(
            d.destination for d in deliveries if d.destination != "Depot"
        ))
        num_drones = min(len(available), len(locations))
        if num_drones == 0:
            return deliveries, []

        # Compute routes
        route_result = self._routes.compute(
            locations=locations,
            priorities=priorities,
            num_drones=num_drones,
            time_windows=time_windows if time_windows else None,
        )

        # Create missions from routes
        missions: list[Mission] = []
        ordered_routes = route_result.get("ordered_routes", {})

        for i, (drone_key, route) in enumerate(ordered_routes.items()):
            if i >= len(available):
                break

            drone_id = available[i].id
            route_stops = set(route) - {"Depot"}
            mission_delivery_ids = [
                d.id for d in deliveries if d.destination in route_stops
            ]
            if not mission_delivery_ids:
                continue

            mission = self._missions.create_mission(
                drone_id=drone_id,
                delivery_ids=mission_delivery_ids,
                route=route,
                route_meta=route_result,
            )
            missions.append(mission)

        # Check geofence
        for mission in missions:
            violations = self._routes.validate_safety(mission.planned_route)
            if violations:
                self._events.publish(EventType.geofence_violation, {
                    "mission_id": mission.id,
                    "violations": violations,
                })

        return deliveries, missions

    def reassign_undelivered(self, failed_mission_id: str) -> list[Mission] | None:
        """Attempt to reassign undelivered items from a failed mission."""
        try:
            mission = self._missions.get_mission(failed_mission_id)
        except Exception:
            return None

        undelivered = []
        for d_id in mission.delivery_ids:
            try:
                d = self._missions.get_delivery(d_id)
                if d.status.value not in ("delivered",):
                    undelivered.append(DeliveryItem(
                        destination=d.destination,
                        supply=d.supply,
                        priority=d.priority,
                        time_window_minutes=d.time_window_minutes,
                    ))
            except Exception:
                continue

        if not undelivered:
            return None

        _, new_missions = self.schedule_batch(undelivered)
        return new_missions if new_missions else None
