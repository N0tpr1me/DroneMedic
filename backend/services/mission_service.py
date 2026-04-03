"""DroneMedic — Mission lifecycle state machine.

Owns mission and delivery state. Runs missions in background threads.
Pause = hover in place. Resume = continue from current position.
"""

from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timezone

from config import LOCATIONS
from backend.domain.enums import (
    DeliveryStatus, DroneStatus, EventSource, EventType, MissionStatus,
)
from backend.domain.errors import (
    InvalidTransitionError, MissionNotFoundError, DeliveryNotFoundError,
)
from backend.domain.models import (
    Delivery, DeliveryItem, Mission, Waypoint, _new_id, _utcnow,
)
from backend.services.drone_service import DroneService
from backend.services.event_service import EventService
from backend.services.route_service import RouteService
from backend.adapters.simulator_adapter import SimulatorAdapter

logger = logging.getLogger("DroneMedic.MissionService")


class MissionService:

    def __init__(
        self,
        drone_service: DroneService,
        simulator_adapter: SimulatorAdapter,
        event_service: EventService,
        route_service: RouteService,
    ) -> None:
        self._drones = drone_service
        self._adapter = simulator_adapter
        self._events = event_service
        self._routes = route_service
        self._missions: dict[str, Mission] = {}
        self._deliveries: dict[str, Delivery] = {}
        # Back-reference set during app startup
        self._scheduler_service = None

    def set_scheduler(self, scheduler) -> None:
        """Late-bind scheduler to break circular dependency."""
        self._scheduler_service = scheduler

    # ── Delivery management ────────────────────────────────────────────

    def create_deliveries(self, items: list[DeliveryItem]) -> list[Delivery]:
        deliveries = []
        for item in items:
            d = Delivery(
                destination=item.destination,
                supply=item.supply,
                priority=item.priority,
                time_window_minutes=item.time_window_minutes,
            )
            self._deliveries[d.id] = d
            deliveries.append(d)
            self._events.publish(EventType.delivery_created, {
                "delivery_id": d.id,
                "destination": d.destination,
                "priority": d.priority,
            })
        return deliveries

    def get_delivery(self, delivery_id: str) -> Delivery:
        d = self._deliveries.get(delivery_id)
        if not d:
            raise DeliveryNotFoundError(delivery_id)
        return d

    def get_all_deliveries(self, status: str | None = None) -> list[Delivery]:
        result = list(self._deliveries.values())
        if status:
            result = [d for d in result if d.status.value == status]
        return result

    # ── Mission creation ───────────────────────────────────────────────

    def create_mission(
        self,
        drone_id: str,
        delivery_ids: list[str],
        route: list[str],
        route_meta: dict,
    ) -> Mission:
        # Build waypoints from route
        waypoints = []
        for loc_name in route:
            coords = LOCATIONS.get(loc_name, {})
            waypoints.append(Waypoint(
                location_name=loc_name,
                coordinates={k: coords.get(k, 0) for k in ("x", "y", "z", "lat", "lon")},
                is_depot=(loc_name == "Depot"),
            ))

        mission = Mission(
            drone_id=drone_id,
            delivery_ids=delivery_ids,
            planned_route=route,
            waypoints=waypoints,
            route_distance=route_meta.get("total_distance", 0),
            battery_usage=route_meta.get("battery_usage", 0),
            estimated_time=route_meta.get("estimated_time", 0),
        )
        self._missions[mission.id] = mission

        # Update delivery assignments
        for d_id in delivery_ids:
            d = self._deliveries.get(d_id)
            if d:
                d.status = DeliveryStatus.assigned
                d.assigned_drone = drone_id
                d.assigned_mission = mission.id

        # Update drone
        self._drones.set_mission(drone_id, mission.id)

        self._events.publish(EventType.mission_created, {
            "mission_id": mission.id,
            "drone_id": drone_id,
            "route": route,
            "delivery_count": len(delivery_ids),
        })
        return mission

    # ── Mission queries ────────────────────────────────────────────────

    def get_mission(self, mission_id: str) -> Mission:
        m = self._missions.get(mission_id)
        if not m:
            raise MissionNotFoundError(mission_id)
        return m

    def get_all_missions(self) -> list[Mission]:
        return list(self._missions.values())

    # ── Mission lifecycle ──────────────────────────────────────────────

    def start_mission(self, mission_id: str) -> None:
        """Launch mission execution in a background thread."""
        mission = self.get_mission(mission_id)
        if mission.status != MissionStatus.planning:
            raise InvalidTransitionError("mission", mission.status.value, "in_progress")

        t = threading.Thread(
            target=self._run_mission,
            args=(mission_id,),
            name=f"mission-{mission_id}",
            daemon=True,
        )
        t.start()

    def start_missions_concurrent(self, mission_ids: list[str]) -> None:
        """Start multiple missions in parallel threads."""
        for mid in mission_ids:
            self.start_mission(mid)

    def pause_mission(self, mission_id: str, source: EventSource = EventSource.manual) -> Mission:
        """Pause — drone hovers in place, mission progression stops."""
        mission = self.get_mission(mission_id)
        if mission.status != MissionStatus.in_progress:
            raise InvalidTransitionError("mission", mission.status.value, "paused")

        mission.status = MissionStatus.paused
        self._drones.set_status(mission.drone_id, DroneStatus.paused)
        self._adapter.pause(mission.drone_id)

        self._events.publish(EventType.mission_paused, {
            "mission_id": mission_id,
            "drone_id": mission.drone_id,
            "source": source.value,
            "at_location": self._drones.get(mission.drone_id).current_location,
        })
        return mission

    def resume_mission(self, mission_id: str) -> Mission:
        """Resume from current hover position."""
        mission = self.get_mission(mission_id)
        if mission.status != MissionStatus.paused:
            raise InvalidTransitionError("mission", mission.status.value, "in_progress")

        mission.status = MissionStatus.in_progress
        self._drones.set_status(mission.drone_id, DroneStatus.en_route)
        self._adapter.resume(mission.drone_id)

        self._events.publish(EventType.mission_resumed, {
            "mission_id": mission_id,
            "drone_id": mission.drone_id,
        })
        return mission

    def abort_mission(self, mission_id: str, reason: str = "manual abort") -> Mission:
        """Abort — return to depot, cancel remaining deliveries."""
        mission = self.get_mission(mission_id)
        if mission.status not in (MissionStatus.in_progress, MissionStatus.paused):
            raise InvalidTransitionError("mission", mission.status.value, "aborted")

        mission.status = MissionStatus.aborted
        mission.failed_reason = reason
        self._drones.set_status(mission.drone_id, DroneStatus.returning)

        # Cancel undelivered deliveries
        for d_id in mission.delivery_ids:
            d = self._deliveries.get(d_id)
            if d and d.status not in (DeliveryStatus.delivered,):
                d.status = DeliveryStatus.cancelled

        self._events.publish(EventType.mission_aborted, {
            "mission_id": mission_id,
            "reason": reason,
        })

        # Return to depot in background (don't block the API call)
        threading.Thread(
            target=self._return_to_depot,
            args=(mission.drone_id,),
            daemon=True,
        ).start()

        return mission

    def reroute_mission(
        self,
        mission_id: str,
        reason: str = "",
        new_items: list[DeliveryItem] | None = None,
    ) -> Mission:
        """Reroute — pause drone, recompute route, resume."""
        mission = self.get_mission(mission_id)
        if mission.status not in (MissionStatus.in_progress, MissionStatus.paused):
            raise InvalidTransitionError("mission", mission.status.value, "rerouting")

        old_status = mission.status
        mission.status = MissionStatus.rerouting
        self._drones.set_status(mission.drone_id, DroneStatus.rerouting)
        self._adapter.pause(mission.drone_id)

        self._events.publish(EventType.reroute_requested, {
            "mission_id": mission_id,
            "reason": reason,
        })

        # Current location from controller (source of truth)
        current_loc = self._adapter.get_current_location(mission.drone_id)

        # Remaining undelivered stops
        remaining = [
            self._deliveries[d_id].destination
            for d_id in mission.delivery_ids
            if d_id in self._deliveries
            and self._deliveries[d_id].status not in (DeliveryStatus.delivered, DeliveryStatus.failed, DeliveryStatus.cancelled)
        ]

        # Handle new deliveries
        new_locations = []
        if new_items:
            new_deliveries = self.create_deliveries(new_items)
            for d in new_deliveries:
                d.assigned_drone = mission.drone_id
                d.assigned_mission = mission.id
                d.status = DeliveryStatus.assigned
                mission.delivery_ids.append(d.id)
                new_locations.append(d.destination)

        # Build priorities
        priorities = {}
        for d_id in mission.delivery_ids:
            d = self._deliveries.get(d_id)
            if d and d.priority == "high":
                priorities[d.destination] = "high"

        # Recompute
        route_result = self._routes.recompute(
            current_location=current_loc,
            remaining=remaining,
            new_locations=new_locations,
            priorities=priorities,
        )

        # Update mission
        mission.planned_route = route_result["ordered_route"]
        mission.reroute_count += 1
        mission.route_distance = route_result.get("total_distance", 0)
        mission.battery_usage = route_result.get("battery_usage", 0)
        mission.estimated_time = route_result.get("estimated_time", 0)

        # Rebuild waypoints
        mission.waypoints = []
        for loc_name in mission.planned_route:
            coords = LOCATIONS.get(loc_name, {})
            mission.waypoints.append(Waypoint(
                location_name=loc_name,
                coordinates={k: coords.get(k, 0) for k in ("x", "y", "z", "lat", "lon")},
                is_depot=(loc_name == "Depot"),
            ))
        mission.current_waypoint_index = 0

        # Resume
        mission.status = MissionStatus.in_progress
        self._drones.set_status(mission.drone_id, DroneStatus.en_route)
        self._adapter.resume(mission.drone_id)

        self._events.publish(EventType.reroute_completed, {
            "mission_id": mission_id,
            "new_route": mission.planned_route,
            "new_deliveries_added": len(new_locations),
        })
        return mission

    # ── Mission execution (blocking, runs in thread) ───────────────────

    def _run_mission(self, mission_id: str) -> None:
        mission = self._missions[mission_id]
        drone_id = mission.drone_id

        # Immediate lock
        mission.status = MissionStatus.in_progress
        mission.started_at = _utcnow()
        self._drones.set_status(drone_id, DroneStatus.takeoff)

        self._events.publish(EventType.mission_started, {
            "mission_id": mission_id,
            "drone_id": drone_id,
            "route": mission.planned_route,
        })

        try:
            self._adapter.connect(drone_id)
            self._adapter.takeoff(drone_id)
            self._drones.set_status(drone_id, DroneStatus.en_route)

            for i, waypoint in enumerate(mission.planned_route):
                # Skip starting depot
                if waypoint == "Depot" and i == 0:
                    continue

                # Pause check — hover in place, don't advance
                while mission.status == MissionStatus.paused:
                    time.sleep(0.5)

                # Abort check
                if mission.status in (MissionStatus.aborted, MissionStatus.failed):
                    break

                # If rerouting happened, the route was replaced — break out
                # The reroute handler will resume with the new route
                if mission.status == MissionStatus.rerouting:
                    # Wait for reroute to complete
                    while mission.status == MissionStatus.rerouting:
                        time.sleep(0.3)
                    # Route was replaced — restart the loop from current index
                    # (reroute resets current_waypoint_index to 0 and replaces planned_route)
                    break

                # Battery check
                if not self._adapter.check_battery_for_return(drone_id):
                    self._handle_low_battery(mission_id)
                    return

                # Fly
                self._drones.set_status(drone_id, DroneStatus.en_route)
                self._adapter.move_to(drone_id, waypoint)
                self._drones.set_location(drone_id, waypoint)

                mission.current_waypoint_index = i

                self._events.publish(EventType.waypoint_reached, {
                    "mission_id": mission_id,
                    "drone_id": drone_id,
                    "waypoint": waypoint,
                    "battery": self._adapter.get_battery(drone_id),
                    "waypoint_index": i,
                })

                # Mark waypoint reached
                if i < len(mission.waypoints):
                    mission.waypoints[i].reached = True
                    mission.waypoints[i].reached_at = _utcnow()

                # Mark matching deliveries as delivered
                if waypoint != "Depot":
                    self._drones.set_status(drone_id, DroneStatus.delivering)
                    for d_id in mission.delivery_ids:
                        d = self._deliveries.get(d_id)
                        if d and d.destination == waypoint and d.status != DeliveryStatus.delivered:
                            d.status = DeliveryStatus.delivered
                            d.delivered_at = _utcnow()
                            self._events.publish(EventType.delivery_completed, {
                                "delivery_id": d_id,
                                "location": waypoint,
                            })

            # If we broke out due to reroute, restart execution with new route
            if mission.status == MissionStatus.in_progress and mission.reroute_count > 0:
                # Re-enter the execution with the updated route
                self._execute_remaining(mission_id)
                return

            # Land
            if mission.status not in (MissionStatus.aborted, MissionStatus.failed):
                self._drones.set_status(drone_id, DroneStatus.landing)
                self._adapter.land(drone_id)

                mission.status = MissionStatus.completed
                mission.completed_at = _utcnow()
                self._drones.set_status(drone_id, DroneStatus.idle)
                self._drones.set_mission(drone_id, None)

                self._events.publish(EventType.mission_completed, {
                    "mission_id": mission_id,
                    "drone_id": drone_id,
                })

        except Exception as e:
            logger.exception(f"Mission {mission_id} failed: {e}")
            mission.status = MissionStatus.failed
            mission.failed_reason = str(e)
            self._drones.set_status(drone_id, DroneStatus.idle)
            self._drones.set_mission(drone_id, None)
            self._events.publish(EventType.mission_failed, {
                "mission_id": mission_id,
                "error": str(e),
            })

    def _execute_remaining(self, mission_id: str) -> None:
        """Continue executing a mission after reroute replaced the route."""
        mission = self._missions[mission_id]
        drone_id = mission.drone_id

        try:
            for i, waypoint in enumerate(mission.planned_route):
                if waypoint == mission.planned_route[0] and i == 0:
                    continue  # Skip current location (start of rerouted path)

                while mission.status == MissionStatus.paused:
                    time.sleep(0.5)
                if mission.status in (MissionStatus.aborted, MissionStatus.failed):
                    break

                if not self._adapter.check_battery_for_return(drone_id):
                    self._handle_low_battery(mission_id)
                    return

                self._drones.set_status(drone_id, DroneStatus.en_route)
                self._adapter.move_to(drone_id, waypoint)
                self._drones.set_location(drone_id, waypoint)
                mission.current_waypoint_index = i

                self._events.publish(EventType.waypoint_reached, {
                    "mission_id": mission_id,
                    "drone_id": drone_id,
                    "waypoint": waypoint,
                    "battery": self._adapter.get_battery(drone_id),
                })

                if waypoint != "Depot":
                    self._drones.set_status(drone_id, DroneStatus.delivering)
                    for d_id in mission.delivery_ids:
                        d = self._deliveries.get(d_id)
                        if d and d.destination == waypoint and d.status != DeliveryStatus.delivered:
                            d.status = DeliveryStatus.delivered
                            d.delivered_at = _utcnow()
                            self._events.publish(EventType.delivery_completed, {
                                "delivery_id": d_id,
                                "location": waypoint,
                            })

            # Land
            if mission.status not in (MissionStatus.aborted, MissionStatus.failed):
                self._drones.set_status(drone_id, DroneStatus.landing)
                self._adapter.land(drone_id)
                mission.status = MissionStatus.completed
                mission.completed_at = _utcnow()
                self._drones.set_status(drone_id, DroneStatus.idle)
                self._drones.set_mission(drone_id, None)
                self._events.publish(EventType.mission_completed, {
                    "mission_id": mission_id,
                    "drone_id": drone_id,
                })

        except Exception as e:
            logger.exception(f"Mission {mission_id} failed after reroute: {e}")
            mission.status = MissionStatus.failed
            mission.failed_reason = str(e)
            self._drones.set_status(drone_id, DroneStatus.idle)
            self._drones.set_mission(drone_id, None)

    # ── Battery recovery ───────────────────────────────────────────────

    def _handle_low_battery(self, mission_id: str) -> None:
        mission = self._missions[mission_id]
        drone_id = mission.drone_id

        logger.warning(f"[RECOVERY] Low battery on {drone_id}")
        mission.status = MissionStatus.failed
        mission.failed_reason = "low_battery"
        self._drones.set_status(drone_id, DroneStatus.returning)

        self._events.publish(EventType.drone_battery_low, {
            "drone_id": drone_id,
            "battery": self._adapter.get_battery(drone_id),
            "mission_id": mission_id,
        })

        self._return_to_depot(drone_id)

        # Collect undelivered
        undelivered = []
        for d_id in mission.delivery_ids:
            d = self._deliveries.get(d_id)
            if d and d.status not in (DeliveryStatus.delivered,):
                d.status = DeliveryStatus.pending
                d.assigned_drone = None
                d.assigned_mission = None
                undelivered.append(DeliveryItem(
                    destination=d.destination,
                    supply=d.supply,
                    priority=d.priority,
                    time_window_minutes=d.time_window_minutes,
                ))

        if undelivered and self._scheduler_service:
            new_deliveries, new_missions = self._scheduler_service.schedule_batch(undelivered)
            if new_missions:
                mission.status = MissionStatus.reassigned
                self._events.publish(EventType.mission_reassigned, {
                    "original_mission": mission_id,
                    "new_missions": [m.id for m in new_missions],
                })

    def _return_to_depot(self, drone_id: str) -> None:
        try:
            self._adapter.move_to(drone_id, "Depot")
            self._adapter.land(drone_id)
        except Exception:
            logger.exception(f"Failed to return {drone_id} to Depot")
        self._drones.set_status(drone_id, DroneStatus.idle)
        self._drones.set_mission(drone_id, None)
        self._drones.set_location(drone_id, "Depot")
