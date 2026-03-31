"""
DroneMedic - Scheduler Service

Core orchestration logic: assigns deliveries to drones, runs missions,
handles rerouting, and manages battery recovery. All state lives here.

Supports concurrent multi-drone execution and real-time event broadcasting
via asyncio for WebSocket/SSE consumers.
"""

from __future__ import annotations

import asyncio
import logging
import threading
import time
from datetime import datetime, timezone

from config import DRONE_NAMES, LOCATIONS, BATTERY_MIN_RESERVE
from backend.models import (
    Delivery, DeliveryItem, DeliveryStatus,
    DroneState, DroneStatus,
    Mission, MissionStatus,
    _new_id, _utcnow,
)
from backend.route_planner import compute_route, recompute_route
from backend.geofence import check_route_safety
from backend.metrics import compute_metrics
from backend.weather_service import (
    simulate_weather_event, get_all_location_weather, is_flyable,
)
from simulation.drone_control import DroneController

logger = logging.getLogger("DroneMedic.Scheduler")


class Scheduler:
    """
    Manages deliveries, drones, and missions.

    State is in-memory — no persistence across restarts.
    The simulator/controller is the source of truth for drone position and battery.
    Supports concurrent multi-drone execution via threading.
    Broadcasts events to WebSocket subscribers via asyncio queues.
    """

    def __init__(self):
        self.deliveries: dict[str, Delivery] = {}
        self.missions: dict[str, Mission] = {}
        self.drones: dict[str, DroneState] = {}
        self.controllers: dict[str, DroneController] = {}
        self.event_log: list[dict] = []

        # WebSocket subscribers — each is an asyncio.Queue
        self._subscribers: list[asyncio.Queue] = []
        self._loop: asyncio.AbstractEventLoop | None = None

        # Initialize drones from config
        for name in DRONE_NAMES:
            self.drones[name] = DroneState(id=name)
            self.controllers[name] = DroneController(use_airsim=False)

    # ── WebSocket Broadcasting ─────────────────────────────────────────

    def subscribe(self) -> asyncio.Queue:
        """Create a new subscriber queue for real-time events."""
        q: asyncio.Queue = asyncio.Queue()
        self._subscribers.append(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        """Remove a subscriber queue."""
        if q in self._subscribers:
            self._subscribers.remove(q)

    def _broadcast(self, event: dict) -> None:
        """Push event to all WebSocket subscriber queues (thread-safe)."""
        for q in self._subscribers:
            try:
                # Thread-safe put into asyncio queue
                if self._loop and self._loop.is_running():
                    self._loop.call_soon_threadsafe(q.put_nowait, event)
                else:
                    try:
                        q.put_nowait(event)
                    except Exception:
                        pass
            except Exception:
                pass

    # ── Scheduling ─────────────────────────────────────────────────────

    def schedule_batch(
        self, items: list[DeliveryItem]
    ) -> tuple[list[Delivery], list[Mission]]:
        """
        Create deliveries from items, assign to available drones, compute routes.

        Returns (created_deliveries, created_missions).
        """
        # Create Delivery objects
        deliveries: list[Delivery] = []
        for item in items:
            if item.destination not in LOCATIONS:
                raise ValueError(f"Unknown location: {item.destination}")
            d = Delivery(
                destination=item.destination,
                supply=item.supply,
                priority=item.priority,
                time_window_minutes=item.time_window_minutes,
            )
            self.deliveries[d.id] = d
            deliveries.append(d)
            self._log_event("delivery_created", {
                "delivery_id": d.id,
                "destination": d.destination,
                "priority": d.priority,
            })

        # Find available drones
        available = [
            drone_id for drone_id, state in self.drones.items()
            if state.status == DroneStatus.IDLE
        ]
        if not available:
            # Mark all deliveries as failed — no drones
            for d in deliveries:
                d.status = DeliveryStatus.FAILED
            self._log_event("schedule_failed", {"reason": "no_drones_available"})
            return deliveries, []

        # Build priorities dict for route planner
        priorities = {
            d.destination: d.priority
            for d in deliveries
            if d.priority == "high"
        }

        # Build time windows dict (minutes → seconds)
        time_windows = {}
        for d in deliveries:
            if d.time_window_minutes is not None:
                time_windows[d.destination] = d.time_window_minutes * 60

        # Locations to visit (unique, excluding Depot)
        locations = list(dict.fromkeys(
            d.destination for d in deliveries if d.destination != "Depot"
        ))

        num_drones = min(len(available), len(locations))
        if num_drones == 0:
            return deliveries, []

        # Compute routes (with time windows if any)
        route_result = compute_route(
            locations=locations,
            priorities=priorities,
            num_drones=num_drones,
            time_windows=time_windows if time_windows else None,
        )

        # Create missions from route result
        missions: list[Mission] = []
        ordered_routes = route_result.get("ordered_routes", {})

        for i, (drone_key, route) in enumerate(ordered_routes.items()):
            if i >= len(available):
                break

            drone_id = available[i]

            # Find which deliveries belong to this route
            route_stops = set(route) - {"Depot"}
            mission_delivery_ids = [
                d.id for d in deliveries if d.destination in route_stops
            ]

            if not mission_delivery_ids:
                continue

            mission = Mission(
                drone_id=drone_id,
                delivery_ids=mission_delivery_ids,
                route=route,
                route_distance=route_result.get("total_distance", 0),
                battery_usage=route_result.get("battery_usage", 0),
                estimated_time=route_result.get("estimated_time", 0),
            )

            # Update delivery assignments
            for d_id in mission_delivery_ids:
                self.deliveries[d_id].status = DeliveryStatus.ASSIGNED
                self.deliveries[d_id].assigned_drone = drone_id

            self.missions[mission.id] = mission
            missions.append(mission)

            self._log_event("mission_created", {
                "mission_id": mission.id,
                "drone_id": drone_id,
                "route": route,
                "delivery_count": len(mission_delivery_ids),
            })

        # Check for geofence violations
        for mission in missions:
            violations = check_route_safety(mission.route)
            if violations:
                self._log_event("geofence_warning", {
                    "mission_id": mission.id,
                    "violations": violations,
                })

        return deliveries, missions

    # ── Mission Execution ──────────────────────────────────────────────

    def start_missions_concurrent(self, mission_ids: list[str]) -> None:
        """
        Start multiple missions concurrently using threads.
        Each drone runs in its own thread so they fly simultaneously.
        """
        threads = []
        for mid in mission_ids:
            t = threading.Thread(
                target=self.start_mission,
                args=(mid,),
                name=f"mission-{mid}",
                daemon=True,
            )
            threads.append(t)
            t.start()

        # Don't join — let them run in background
        # The API endpoint returns immediately

    def start_mission(self, mission_id: str) -> None:
        """
        Execute a mission: connect drone, fly waypoints, deliver, land.

        This method blocks (uses time.sleep via DroneController).
        For concurrent multi-drone: call start_missions_concurrent().
        For single mission via API: call via asyncio.to_thread().

        Broadcasts real-time position updates to WebSocket subscribers.
        """
        mission = self.missions.get(mission_id)
        if not mission:
            raise ValueError(f"Mission not found: {mission_id}")
        if mission.status != MissionStatus.PLANNING:
            raise ValueError(f"Mission {mission_id} is {mission.status.value}, expected planning")

        drone_id = mission.drone_id
        drone_state = self.drones[drone_id]
        controller = self.controllers[drone_id]

        # Immediate lock — mark drone as flying right now
        drone_state.status = DroneStatus.FLYING
        drone_state.current_mission_id = mission_id
        mission.status = MissionStatus.IN_PROGRESS

        self._log_event("mission_started", {
            "mission_id": mission_id,
            "drone_id": drone_id,
            "route": mission.route,
        })

        try:
            controller.connect()
            controller.takeoff()
            self._sync_drone_state(drone_id)

            # Broadcast takeoff position
            self._broadcast_position(drone_id, mission_id, "takeoff")

            # Fly each waypoint in the route
            for waypoint in mission.route:
                # Skip starting depot
                if waypoint == "Depot" and waypoint == mission.route[0]:
                    continue

                # Check if mission was paused
                if mission.status == MissionStatus.PAUSED:
                    self._log_event("mission_paused_inflight", {
                        "mission_id": mission_id,
                        "at_location": drone_state.current_location,
                    })
                    self._broadcast_position(drone_id, mission_id, "paused")
                    # Wait until resumed
                    while mission.status == MissionStatus.PAUSED:
                        time.sleep(0.5)
                    self._broadcast_position(drone_id, mission_id, "resumed")

                # Check if mission was cancelled/reassigned during pause
                if mission.status not in (MissionStatus.IN_PROGRESS,):
                    break

                # Battery check before each waypoint
                self._sync_drone_state(drone_id)
                if not controller.check_battery_for_return():
                    self._handle_low_battery(mission_id)
                    return

                # Broadcast: drone is en-route to waypoint
                self._broadcast_position(drone_id, mission_id, f"en_route:{waypoint}")

                # Fly to waypoint
                controller.move_to(waypoint)
                self._sync_drone_state(drone_id)

                # Broadcast: arrived at waypoint
                self._broadcast_position(drone_id, mission_id, f"arrived:{waypoint}")

                self._log_event("waypoint_reached", {
                    "mission_id": mission_id,
                    "drone_id": drone_id,
                    "waypoint": waypoint,
                    "battery": drone_state.battery,
                })

                # Mark matching deliveries as delivered
                if waypoint != "Depot":
                    for d_id in mission.delivery_ids:
                        d = self.deliveries.get(d_id)
                        if (d and d.destination == waypoint
                                and d.status != DeliveryStatus.DELIVERED):
                            d.status = DeliveryStatus.DELIVERED
                            d.delivered_at = _utcnow()
                            self._log_event("delivery_completed", {
                                "delivery_id": d_id,
                                "location": waypoint,
                            })

            # Land
            controller.land()
            self._sync_drone_state(drone_id)

            mission.status = MissionStatus.COMPLETED
            drone_state.status = DroneStatus.IDLE
            drone_state.current_mission_id = None

            self._log_event("mission_completed", {
                "mission_id": mission_id,
                "drone_id": drone_id,
            })
            self._broadcast_position(drone_id, mission_id, "landed")

        except Exception as e:
            logger.exception(f"Mission {mission_id} failed: {e}")
            mission.status = MissionStatus.FAILED
            mission.failed_reason = str(e)
            drone_state.status = DroneStatus.IDLE
            drone_state.current_mission_id = None
            self._log_event("mission_failed", {
                "mission_id": mission_id,
                "error": str(e),
            })

    def _broadcast_position(self, drone_id: str, mission_id: str, status: str) -> None:
        """Broadcast a real-time position update to WebSocket subscribers."""
        state = self.drones[drone_id]
        controller = self.controllers.get(drone_id)
        pos = controller.get_position() if controller else {"x": 0, "y": 0, "z": 0}
        event = {
            "type": "drone_position_updated",
            "drone_id": drone_id,
            "mission_id": mission_id,
            "status": status,
            "position": pos,
            "battery": state.battery,
            "current_location": state.current_location,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        self._broadcast(event)

    # ── Reroute ────────────────────────────────────────────────────────

    def handle_reroute(
        self,
        mission_id: str,
        reason: str = "",
        new_items: list[DeliveryItem] | None = None,
    ) -> Mission:
        """
        Reroute an active mission. Optionally add new deliveries.
        """
        mission = self.missions.get(mission_id)
        if not mission:
            raise ValueError(f"Mission not found: {mission_id}")
        if mission.status not in (MissionStatus.IN_PROGRESS, MissionStatus.PAUSED):
            raise ValueError(f"Cannot reroute mission in {mission.status.value} state")

        drone_id = mission.drone_id
        controller = self.controllers[drone_id]

        # Pause drone while we recompute
        controller.pause()

        # Get current location from controller (source of truth)
        current_loc = controller.get_current_location()

        # Find remaining undelivered stops
        remaining = [
            d.destination for d_id in mission.delivery_ids
            if (d := self.deliveries.get(d_id))
            and d.status not in (DeliveryStatus.DELIVERED, DeliveryStatus.FAILED)
        ]

        # Handle new deliveries
        new_locations = []
        new_delivery_ids = []
        if new_items:
            for item in new_items:
                d = Delivery(
                    destination=item.destination,
                    supply=item.supply,
                    priority=item.priority,
                    status=DeliveryStatus.ASSIGNED,
                    assigned_drone=drone_id,
                )
                self.deliveries[d.id] = d
                new_delivery_ids.append(d.id)
                new_locations.append(d.destination)

        # Build priorities
        all_delivery_ids = mission.delivery_ids + new_delivery_ids
        priorities = {}
        for d_id in all_delivery_ids:
            d = self.deliveries.get(d_id)
            if d and d.priority == "high":
                priorities[d.destination] = "high"

        # Recompute route
        route_result = recompute_route(
            current_location=current_loc,
            remaining_locations=remaining,
            new_locations=new_locations,
            priorities=priorities,
        )

        # Update mission
        mission.route = route_result["ordered_route"]
        mission.delivery_ids = all_delivery_ids
        mission.reroute_count += 1
        mission.route_distance = route_result.get("total_distance", 0)
        mission.battery_usage = route_result.get("battery_usage", 0)
        mission.estimated_time = route_result.get("estimated_time", 0)

        # Resume
        controller.resume()
        if mission.status == MissionStatus.PAUSED:
            mission.status = MissionStatus.IN_PROGRESS

        self._log_event("reroute_requested", {
            "mission_id": mission_id,
            "reason": reason,
            "new_route": mission.route,
            "new_deliveries_added": len(new_delivery_ids),
        })

        return mission

    # ── Pause / Resume ─────────────────────────────────────────────────

    def pause_mission(self, mission_id: str) -> Mission:
        """Pause a mission — drone hovers in place."""
        mission = self.missions.get(mission_id)
        if not mission:
            raise ValueError(f"Mission not found: {mission_id}")
        if mission.status != MissionStatus.IN_PROGRESS:
            raise ValueError(f"Cannot pause mission in {mission.status.value} state")

        controller = self.controllers[mission.drone_id]
        controller.pause()

        mission.status = MissionStatus.PAUSED
        self.drones[mission.drone_id].status = DroneStatus.PAUSED
        self._sync_drone_state(mission.drone_id)

        self._log_event("mission_paused", {
            "mission_id": mission_id,
            "at_location": self.drones[mission.drone_id].current_location,
        })

        return mission

    def resume_mission(self, mission_id: str) -> Mission:
        """Resume a paused mission from current hover position."""
        mission = self.missions.get(mission_id)
        if not mission:
            raise ValueError(f"Mission not found: {mission_id}")
        if mission.status != MissionStatus.PAUSED:
            raise ValueError(f"Cannot resume mission in {mission.status.value} state")

        controller = self.controllers[mission.drone_id]
        controller.resume()

        mission.status = MissionStatus.IN_PROGRESS
        self.drones[mission.drone_id].status = DroneStatus.FLYING

        self._log_event("mission_resumed", {
            "mission_id": mission_id,
        })

        return mission

    # ── Metrics ────────────────────────────────────────────────────────

    def get_mission_metrics(self, mission_id: str) -> dict:
        """Compute metrics for a completed mission."""
        mission = self.missions.get(mission_id)
        if not mission:
            raise ValueError(f"Mission not found: {mission_id}")

        controller = self.controllers.get(mission.drone_id)
        flight_log = controller.get_flight_log() if controller else []

        locations = [
            self.deliveries[d_id].destination
            for d_id in mission.delivery_ids
            if d_id in self.deliveries
        ]

        reroute_successes = mission.reroute_count  # assume all reroutes succeeded

        return compute_metrics(
            flight_log=flight_log,
            optimized_route={"ordered_route": mission.route, "estimated_time": mission.estimated_time},
            locations=locations,
            reroute_count=mission.reroute_count,
            reroute_successes=reroute_successes,
        )

    # ── Battery Recovery ───────────────────────────────────────────────

    def _handle_low_battery(self, mission_id: str) -> None:
        """
        Handle a low-battery situation:
        1. Return drone to Depot
        2. Try to reassign remaining deliveries to another drone
        """
        mission = self.missions[mission_id]
        drone_id = mission.drone_id
        controller = self.controllers[drone_id]
        drone_state = self.drones[drone_id]

        logger.warning(f"[RECOVERY] Low battery on {drone_id} during mission {mission_id}")

        drone_state.status = DroneStatus.LOW_BATTERY
        mission.status = MissionStatus.FAILED
        mission.failed_reason = "low_battery"

        # Return to depot
        try:
            controller.move_to("Depot")
            controller.land()
        except Exception:
            logger.exception(f"[RECOVERY] Failed to return {drone_id} to Depot")

        self._sync_drone_state(drone_id)
        drone_state.status = DroneStatus.IDLE
        drone_state.current_mission_id = None

        self._log_event("low_battery_recovery", {
            "mission_id": mission_id,
            "drone_id": drone_id,
            "battery": drone_state.battery,
        })

        # Collect undelivered deliveries
        undelivered_items = []
        for d_id in mission.delivery_ids:
            d = self.deliveries.get(d_id)
            if d and d.status not in (DeliveryStatus.DELIVERED,):
                d.status = DeliveryStatus.PENDING
                d.assigned_drone = None
                undelivered_items.append(DeliveryItem(
                    destination=d.destination,
                    supply=d.supply,
                    priority=d.priority,
                ))

        if not undelivered_items:
            return

        # Try to reassign to another drone
        available = [
            did for did, state in self.drones.items()
            if state.status == DroneStatus.IDLE and did != drone_id
        ]

        if available:
            new_deliveries, new_missions = self.schedule_batch(undelivered_items)
            self._log_event("mission_reassigned", {
                "original_mission": mission_id,
                "new_missions": [m.id for m in new_missions],
                "reassigned_to": [m.drone_id for m in new_missions],
            })
            mission.status = MissionStatus.REASSIGNED
        else:
            # No backup drones — mark deliveries as failed
            for d_id in mission.delivery_ids:
                d = self.deliveries.get(d_id)
                if d and d.status == DeliveryStatus.PENDING:
                    d.status = DeliveryStatus.FAILED
            self._log_event("recovery_failed", {
                "mission_id": mission_id,
                "reason": "no_backup_drones_available",
            })

    # ── Scenario Runner ────────────────────────────────────────────────

    def run_scenario(self, scenario_name: str, mission_id: str) -> dict:
        """
        Run a predefined test scenario against an active mission.

        Available scenarios:
        - weather_disruption: inject storm at a delivery location
        - low_battery: force battery drain to trigger recovery
        - multi_event: obstacle + weather back-to-back
        """
        mission = self.missions.get(mission_id)
        if not mission:
            raise ValueError(f"Mission not found: {mission_id}")

        result = {"scenario": scenario_name, "events": []}

        if scenario_name == "weather_disruption":
            # Find a non-depot stop in the route and hit it with a storm
            targets = [loc for loc in mission.route if loc != "Depot"]
            if targets:
                target = targets[0]
                simulate_weather_event("storm", [target])
                result["events"].append(f"Storm injected at {target}")
                self._log_event("weather_alert", {
                    "mission_id": mission_id,
                    "event_type": "storm",
                    "locations": [target],
                })

        elif scenario_name == "low_battery":
            # Force drain the drone's battery
            controller = self.controllers.get(mission.drone_id)
            if controller:
                controller.battery = BATTERY_MIN_RESERVE + 1
                self._sync_drone_state(mission.drone_id)
                result["events"].append(
                    f"Battery forced to {controller.battery:.1f}% on {mission.drone_id}"
                )
                self._log_event("scenario_battery_drain", {
                    "mission_id": mission_id,
                    "drone_id": mission.drone_id,
                    "battery": controller.battery,
                })

        elif scenario_name == "multi_event":
            # Weather + obstacle-style reroute
            targets = [loc for loc in mission.route if loc != "Depot"]
            if len(targets) >= 1:
                simulate_weather_event("high_wind", [targets[0]])
                result["events"].append(f"High wind at {targets[0]}")
                self._log_event("weather_alert", {
                    "mission_id": mission_id,
                    "event_type": "high_wind",
                    "locations": [targets[0]],
                })
            if len(targets) >= 2:
                simulate_weather_event("storm", [targets[1]])
                result["events"].append(f"Storm at {targets[1]}")
                self._log_event("weather_alert", {
                    "mission_id": mission_id,
                    "event_type": "storm",
                    "locations": [targets[1]],
                })

        else:
            raise ValueError(f"Unknown scenario: {scenario_name}")

        return result

    # ── State Sync ─────────────────────────────────────────────────────

    def _sync_drone_state(self, drone_id: str) -> None:
        """Read position + battery from controller and update DroneState."""
        controller = self.controllers.get(drone_id)
        if not controller:
            return
        state = self.drones[drone_id]
        pos = controller.get_position()
        state.battery = controller.get_battery()
        state.current_location = controller.get_current_location()

    def sync_all_drones(self) -> None:
        """Sync all drone states from controllers."""
        for drone_id in self.drones:
            self._sync_drone_state(drone_id)

    # ── Event Log ──────────────────────────────────────────────────────

    def _log_event(self, event_type: str, data: dict) -> None:
        event = {
            "type": event_type,
            "data": data,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        self.event_log.append(event)
        logger.info(f"[EVENT] {event_type}: {data}")
        # Broadcast to WebSocket/SSE subscribers
        self._broadcast(event)

    def get_events(
        self,
        event_type: str | None = None,
        limit: int = 100,
    ) -> list[dict]:
        """Get event history, optionally filtered by type."""
        events = self.event_log
        if event_type:
            events = [e for e in events if e["type"] == event_type]
        return events[-limit:]
