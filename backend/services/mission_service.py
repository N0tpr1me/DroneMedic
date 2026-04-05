"""DroneMedic — Mission lifecycle state machine.

Owns mission and delivery state. Runs missions in background threads.
Pause = hover in place. Resume = continue from current position.
"""

from __future__ import annotations

import asyncio
import logging
import threading
import time
from datetime import datetime, timezone

from config import LOCATIONS, SUPABASE_URL
from backend.domain.enums import (
    DeliveryStatus, DroneStatus, EventSource, EventType, MissionStatus,
)
from backend.domain.errors import (
    InvalidTransitionError, MissionNotFoundError, DeliveryNotFoundError,
)
from backend.domain.models import (
    Delivery, DeliveryItem, Mission, Waypoint, _new_id, _utcnow,
)
from backend.services.cv_service import CVDetectionService
from backend.services.drone_service import DroneService
from backend.utils.notifications import notify_mission_event
from backend.services.event_service import EventService
from backend.services.route_service import RouteService
from backend.adapters.simulator_adapter import SimulatorAdapter
from ai.flight_agent import FlightAgent, FlightContext, FlightDecision

logger = logging.getLogger("DroneMedic.MissionService")


# ── DB persistence helpers (fire-and-forget) ──────────────────────────────

def _db_enabled() -> bool:
    """Return True when Supabase credentials are configured."""
    return bool(SUPABASE_URL)


def _persist(coro) -> None:
    """Schedule an async DB coroutine as a fire-and-forget task.

    Safe to call from any thread.  If no running event loop is available
    the coroutine is silently discarded.
    """
    if not _db_enabled():
        return
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(coro)
    except RuntimeError:
        # No running event loop (e.g. called from a background thread).
        # Spin up a tiny event loop to await the coroutine.
        try:
            _loop = asyncio.new_event_loop()
            _loop.run_until_complete(coro)
            _loop.close()
        except Exception:
            logger.debug("DB persist skipped — no event loop available")


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
        self._cv = CVDetectionService()
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
                recipient=item.recipient,
                recipient_role=item.recipient_role,
                patient_count=item.patient_count,
            )
            self._deliveries[d.id] = d
            deliveries.append(d)
            self._events.publish(EventType.delivery_created, {
                "delivery_id": d.id,
                "destination": d.destination,
                "priority": d.priority,
            })

        # Persist deliveries to Supabase
        if deliveries:
            from backend.db import repository as repo
            _persist(repo.save_deliveries([
                d.model_dump(mode="json") for d in deliveries
            ]))

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

        # Persist mission to Supabase
        from backend.db import repository as repo
        _persist(repo.save_mission(mission.model_dump(mode="json")))

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

        # Persist status change
        from backend.db import repository as repo
        _persist(repo.update_mission(mission_id, {"status": mission.status.value}))

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

        # Persist status change
        from backend.db import repository as repo
        _persist(repo.update_mission(mission_id, {"status": mission.status.value}))

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

        # Persist abort + cancelled deliveries
        from backend.db import repository as repo
        _persist(repo.update_mission(mission_id, {
            "status": mission.status.value,
            "failed_reason": reason,
        }))
        for d_id in mission.delivery_ids:
            d = self._deliveries.get(d_id)
            if d and d.status == DeliveryStatus.cancelled:
                _persist(repo.update_delivery(d_id, {"status": d.status.value}))

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

        # AI reasoning: reroute narration
        new_route_str = " -> ".join(mission.planned_route)
        bat = self._adapter.get_battery(mission.drone_id)
        self._publish_reasoning(
            f"Route recalculated. {reason or 'Conditions changed.'} "
            f"New route: {new_route_str}. "
            f"Battery {bat:.0f}% — sufficient for updated plan.",
            severity="warning",
            context={"battery": bat, "new_route": mission.planned_route, "action": "reroute"},
        )

        # Persist reroute updates
        from backend.db import repository as repo
        _persist(repo.update_mission(mission_id, {
            "status": mission.status.value,
            "planned_route": mission.planned_route,
            "reroute_count": mission.reroute_count,
            "route_distance": mission.route_distance,
            "battery_usage": mission.battery_usage,
            "estimated_time": mission.estimated_time,
        }))

        return mission

    # ── AI reasoning narration ─────────────────────────────────────────

    def _publish_reasoning(
        self,
        message: str,
        severity: str = "info",
        context: dict | None = None,
    ) -> None:
        """Publish a template-based AI reasoning message to the event bus."""
        self._events.publish(EventType.ai_reasoning, {
            "message": message,
            "severity": severity,
            "context": context or {},
        })

    # ── Autonomous flight agent ────────────────────────────────────────

    def _flight_agent_decide(self, mission: Mission, drone_id: str, waypoint: str, waypoint_index: int) -> FlightDecision | None:
        """Run the flight decision agent at the current waypoint.

        Returns a FlightDecision or None if the agent could not run.
        """
        try:
            bat = self._adapter.get_battery(drone_id)
            bat_state = "GREEN" if bat > 50 else ("AMBER" if bat > 25 else "RED")

            remaining_wps = mission.planned_route[waypoint_index + 1:]
            remaining_deliveries = len([w for w in remaining_wps if w != "Depot"])

            # Determine payload info from first undelivered delivery
            payload_type = "medical_supply"
            payload_priority = "P2_URGENT"
            for d_id in mission.delivery_ids:
                d = self._deliveries.get(d_id)
                if d and d.status != DeliveryStatus.delivered:
                    payload_type = d.items[0].name if d.items else "medical_supply"
                    payload_priority = d.priority if hasattr(d, "priority") else "P2_URGENT"
                    break

            # Progress
            total = max(len(mission.planned_route), 1)
            progress = ((waypoint_index + 1) / total) * 100

            # Nearest facility (simple: Depot is always the fallback)
            nearest = "Depot"
            nearest_dist_km = 2.0  # default estimate

            # NFZ check (simplified)
            from backend.geofence import is_in_no_fly_zone
            loc = LOCATIONS.get(waypoint, {})
            nfz_result = is_in_no_fly_zone(loc.get("x", 0), loc.get("y", 0)) if loc else (False, None)
            nfz_nearby = nfz_result[0] if isinstance(nfz_result, tuple) else bool(nfz_result)

            # Gather disaster intelligence for context-aware decisions
            active_threats: list[dict] = []
            dynamic_nfz: list[str] = []
            military_activity = False
            try:
                from backend.api.routes.disasters import get_disaster_service
                disaster_svc = get_disaster_service()
                active_threats = disaster_svc.get_active_threats()
                dynamic_nfz = [
                    t.get("id", "") for t in active_threats
                    if t.get("source") in ("EONET", "DEMO")
                ]
                military_activity = any(
                    t.get("category") == "military" for t in active_threats
                )
            except Exception:
                pass  # graceful degradation if disaster service unavailable

            ctx = FlightContext(
                drone_id=drone_id,
                battery_pct=bat,
                battery_state=bat_state,
                current_location=waypoint,
                next_waypoint=remaining_wps[0] if remaining_wps else "Depot",
                remaining_waypoints=remaining_wps,
                remaining_deliveries=remaining_deliveries,
                speed_ms=15.0,
                altitude_m=80.0,
                wind_speed_ms=0.0,   # no live weather in sim — agent uses rules
                precipitation_mm=0.0,
                temperature_c=18.0,
                payload_type=payload_type,
                payload_priority=payload_priority,
                mission_progress_pct=progress,
                reroute_count=mission.reroute_count,
                nearest_facility=nearest,
                nearest_facility_distance_km=nearest_dist_km,
                nfz_nearby=nfz_nearby,
                active_threats=active_threats,
                dynamic_nfz=dynamic_nfz,
                military_activity=military_activity,
            )

            # Use rule-based agent (sync) — avoids event loop issues in threads
            agent = FlightAgent()
            import asyncio
            decision = asyncio.run(agent.decide(ctx))

            logger.info(
                "[FLIGHT-AGENT] %s @ %s → action=%s confidence=%.2f risk=%s",
                drone_id, waypoint, decision.action, decision.confidence, decision.risk_assessment,
            )
            return decision

        except Exception as e:
            logger.warning("[FLIGHT-AGENT] Decision failed at %s: %s", waypoint, e)
            return None

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

        # Persist mission start
        from backend.db import repository as repo
        _persist(repo.update_mission(mission_id, {
            "status": mission.status.value,
            "started_at": mission.started_at.isoformat() if mission.started_at else None,
        }))
        _persist(repo.update_drone(drone_id, {"status": DroneStatus.takeoff.value}))

        try:
            self._adapter.connect(drone_id)
            self._adapter.takeoff(drone_id)
            self._drones.set_status(drone_id, DroneStatus.en_route)

            # AI reasoning: mission launch narration
            destinations = [w for w in mission.planned_route if w != "Depot"]
            dest_str = ", ".join(destinations) if destinations else "planned route"
            bat = self._adapter.get_battery(drone_id)
            self._publish_reasoning(
                f"Initiating flight to {dest_str}. Battery {bat:.0f}%. "
                f"Flight plan nominal with {len(destinations)} delivery stop{'s' if len(destinations) != 1 else ''}. "
                f"Estimated distance: {mission.route_distance:.0f}m.",
                severity="success",
                context={"battery": bat, "stops": len(destinations), "action": "takeoff"},
            )

            total_waypoints = len(mission.planned_route)
            cv_detection_fired = False  # ensure CV detection runs at most once

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
                    self._publish_reasoning(
                        f"Battery critically low. Insufficient charge to reach {waypoint} "
                        f"and return to Depot. Aborting remaining stops and returning to base.",
                        severity="error",
                        context={"battery": self._adapter.get_battery(drone_id), "action": "low_battery"},
                    )
                    self._handle_low_battery(mission_id)
                    return

                # Fly
                self._drones.set_status(drone_id, DroneStatus.en_route)
                self._adapter.move_to(drone_id, waypoint)
                self._drones.set_location(drone_id, waypoint)

                mission.current_waypoint_index = i
                bat = self._adapter.get_battery(drone_id)

                self._events.publish(EventType.waypoint_reached, {
                    "mission_id": mission_id,
                    "drone_id": drone_id,
                    "waypoint": waypoint,
                    "battery": bat,
                    "waypoint_index": i,
                })

                # ── Payload status update ──
                self._publish_payload_status(mission_id, mission)

                # ── YOLOv8 CV obstacle detection at ~60% mission progress ──
                progress = (i + 1) / max(total_waypoints, 1)
                if not cv_detection_fired and 0.55 <= progress <= 0.85:
                    cv_detection_fired = True
                    try:
                        cv_result = self._cv.run_detection()
                        self._events.publish(EventType.obstacle_detected, {
                            "mission_id": mission_id,
                            "drone_id": drone_id,
                            "waypoint": waypoint,
                            "progress": round(progress, 2),
                            "detections": cv_result.get("detections", []),
                            "evasion": cv_result.get("evasion"),
                            "model": cv_result.get("model", "YOLOv8n"),
                            "inference_ms": cv_result.get("inference_ms", 0),
                            "frame": cv_result.get("frame", "unknown"),
                        })
                        logger.info(
                            "[CV] YOLOv8 detection on mission %s at %.0f%% progress: "
                            "%d detections, model=%s, %.1fms",
                            mission_id,
                            progress * 100,
                            len(cv_result.get("detections", [])),
                            cv_result.get("model"),
                            cv_result.get("inference_ms", 0),
                        )
                    except Exception as e:
                        logger.warning("[CV] Detection failed mid-flight: %s", e)

                # Mark waypoint reached
                if i < len(mission.waypoints):
                    mission.waypoints[i].reached = True
                    mission.waypoints[i].reached_at = _utcnow()

                # AI reasoning: waypoint narration
                total_stops = len([w for w in mission.planned_route if w != "Depot"])
                stops_done = i  # index counts from 0 with Depot at 0
                remaining = total_stops - stops_done
                bat_state = "GREEN" if bat > 50 else ("AMBER" if bat > 25 else "RED")
                if waypoint != "Depot":
                    severity = "success" if bat_state == "GREEN" else ("warning" if bat_state == "AMBER" else "error")
                    self._publish_reasoning(
                        f"Arrived at {waypoint}. Battery {bat:.0f}% — state {bat_state}. "
                        f"{'Delivering payload.' if remaining > 0 else 'Final delivery.'} "
                        f"{remaining} stop{'s' if remaining != 1 else ''} remaining.",
                        severity=severity,
                        context={"battery": bat, "location": waypoint, "remaining": remaining, "action": "waypoint"},
                    )

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
                            # Persist delivery completion
                            _persist(repo.update_delivery(d_id, {
                                "status": d.status.value,
                                "delivered_at": d.delivered_at.isoformat(),
                            }))

                # ── Autonomous flight agent decision ──
                if waypoint != "Depot":
                    decision = self._flight_agent_decide(mission, drone_id, waypoint, i)
                    if decision is not None:
                        # Publish decision as AI reasoning event
                        severity_map = {
                            "low": "success", "medium": "warning",
                            "high": "error", "critical": "error",
                        }
                        self._publish_reasoning(
                            f"[Flight Agent] {decision.reasoning}",
                            severity=severity_map.get(decision.risk_assessment, "info"),
                            context={
                                "action": decision.action,
                                "confidence": decision.confidence,
                                "risk": decision.risk_assessment,
                                "speed_adjustment": decision.speed_adjustment,
                                "skip_deliveries": decision.skip_deliveries,
                                "divert_to": decision.divert_to,
                                "source": "flight_agent",
                            },
                        )

                        # Act on critical decisions
                        if decision.action == "divert_emergency":
                            self._publish_reasoning(
                                f"EMERGENCY DIVERT: Landing at {decision.divert_to or 'nearest facility'}. "
                                f"Reason: {decision.reasoning}",
                                severity="error",
                                context={"action": "divert_emergency", "source": "flight_agent"},
                            )
                            self._handle_low_battery(mission_id)
                            return

                        if decision.action == "abort":
                            self._publish_reasoning(
                                f"MISSION ABORT: {decision.reasoning}",
                                severity="error",
                                context={"action": "abort", "source": "flight_agent"},
                            )
                            mission.status = MissionStatus.aborted
                            mission.failed_reason = f"Flight agent abort: {decision.reasoning}"
                            self._drones.set_status(drone_id, DroneStatus.emergency)
                            self._events.publish(EventType.mission_aborted, {
                                "mission_id": mission_id,
                                "reason": decision.reasoning,
                            })
                            _persist(repo.update_mission(mission_id, {
                                "status": mission.status.value,
                                "failed_reason": mission.failed_reason,
                            }))
                            return

                        # ── Autonomous execution for high-confidence decisions ──
                        AUTONOMY_THRESHOLD = 0.85
                        if decision.confidence >= AUTONOMY_THRESHOLD and decision.action != "continue":
                            auto_executed = True

                            if decision.action == "conserve_speed":
                                # Speed reduction is advisory — logged for telemetry
                                self._publish_reasoning(
                                    f"[AUTO-EXEC] Conserving speed (x{decision.speed_adjustment:.1f}). "
                                    f"Confidence: {decision.confidence:.0%}",
                                    severity="warning",
                                    context={"action": "conserve_speed", "auto_executed": True},
                                )

                            elif decision.action == "skip_delivery":
                                for skip_loc in decision.skip_deliveries:
                                    for d_id in mission.delivery_ids:
                                        d = self._deliveries.get(d_id)
                                        if d and d.destination == skip_loc and d.status != DeliveryStatus.delivered:
                                            d.status = DeliveryStatus.cancelled
                                            _persist(repo.update_delivery(d_id, {"status": d.status.value}))
                                self._publish_reasoning(
                                    f"[AUTO-EXEC] Skipped deliveries: {decision.skip_deliveries}. "
                                    f"Confidence: {decision.confidence:.0%}",
                                    severity="warning",
                                    context={"action": "skip_delivery", "auto_executed": True,
                                             "skipped": decision.skip_deliveries},
                                )

                            elif decision.action == "reroute":
                                self._publish_reasoning(
                                    f"[AUTO-EXEC] Triggering reroute. Confidence: {decision.confidence:.0%}. "
                                    f"Reason: {decision.reasoning}",
                                    severity="warning",
                                    context={"action": "reroute", "auto_executed": True},
                                )
                                try:
                                    self.reroute_mission(mission_id, reason=f"Auto-reroute: {decision.reasoning}")
                                except Exception as reroute_err:
                                    logger.warning("[AUTO-EXEC] Reroute failed: %s", reroute_err)

                            else:
                                auto_executed = False

                            if auto_executed:
                                self._events.publish(EventType.ai_reasoning, {
                                    "action": decision.action,
                                    "reasoning": decision.reasoning,
                                    "confidence": decision.confidence,
                                    "auto_executed": True,
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

                final_bat = self._adapter.get_battery(drone_id)
                delivered_count = sum(
                    1 for d_id in mission.delivery_ids
                    if self._deliveries.get(d_id) and self._deliveries[d_id].status == DeliveryStatus.delivered
                )

                # AI reasoning: mission complete narration
                self._publish_reasoning(
                    f"All {delivered_count} deliveries confirmed. Initiating landing sequence at Depot. "
                    f"Battery {final_bat:.0f}% remaining. Mission complete.",
                    severity="success",
                    context={"battery": final_bat, "deliveries": delivered_count, "action": "landing"},
                )

                mission.status = MissionStatus.completed
                mission.completed_at = _utcnow()
                self._drones.set_status(drone_id, DroneStatus.idle)
                self._drones.set_mission(drone_id, None)

                self._events.publish(EventType.mission_completed, {
                    "mission_id": mission_id,
                    "drone_id": drone_id,
                })

                # Notify operator of mission completion
                _persist(notify_mission_event("mission_completed", mission_id, {
                    "drone_id": drone_id,
                    "delivered": delivered_count,
                    "battery_remaining": final_bat,
                }))

                # Persist mission completion
                _persist(repo.update_mission(mission_id, {
                    "status": mission.status.value,
                    "completed_at": mission.completed_at.isoformat() if mission.completed_at else None,
                }))
                _persist(repo.update_drone(drone_id, {
                    "status": DroneStatus.idle.value,
                    "current_mission_id": None,
                }))

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

            # Notify operator of mission failure
            _persist(notify_mission_event("mission_failed", mission_id, {
                "drone_id": drone_id,
                "error": str(e),
            }))

            # Persist mission failure
            _persist(repo.update_mission(mission_id, {
                "status": mission.status.value,
                "failed_reason": mission.failed_reason,
            }))
            _persist(repo.update_drone(drone_id, {
                "status": DroneStatus.idle.value,
                "current_mission_id": None,
            }))

    def _execute_remaining(self, mission_id: str) -> None:
        """Continue executing a mission after reroute replaced the route."""
        mission = self._missions[mission_id]
        drone_id = mission.drone_id
        from backend.db import repository as repo

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
                            # Persist delivery completion
                            _persist(repo.update_delivery(d_id, {
                                "status": d.status.value,
                                "delivered_at": d.delivered_at.isoformat(),
                            }))

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

                # Notify operator of mission completion (post-reroute)
                _persist(notify_mission_event("mission_completed", mission_id, {
                    "drone_id": drone_id,
                    "rerouted": True,
                }))

                # Persist mission completion
                _persist(repo.update_mission(mission_id, {
                    "status": mission.status.value,
                    "completed_at": mission.completed_at.isoformat() if mission.completed_at else None,
                }))
                _persist(repo.update_drone(drone_id, {
                    "status": DroneStatus.idle.value,
                    "current_mission_id": None,
                }))

        except Exception as e:
            logger.exception(f"Mission {mission_id} failed after reroute: {e}")
            mission.status = MissionStatus.failed
            mission.failed_reason = str(e)
            self._drones.set_status(drone_id, DroneStatus.idle)
            self._drones.set_mission(drone_id, None)

            # Notify operator of mission failure (post-reroute)
            _persist(notify_mission_event("mission_failed", mission_id, {
                "drone_id": drone_id,
                "error": str(e),
                "rerouted": True,
            }))

            # Persist failure
            _persist(repo.update_mission(mission_id, {
                "status": mission.status.value,
                "failed_reason": mission.failed_reason,
            }))
            _persist(repo.update_drone(drone_id, {
                "status": DroneStatus.idle.value,
                "current_mission_id": None,
            }))

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

        # Persist low-battery failure
        from backend.db import repository as repo
        _persist(repo.update_mission(mission_id, {
            "status": mission.status.value,
            "failed_reason": mission.failed_reason,
        }))
        _persist(repo.update_drone(drone_id, {"status": DroneStatus.returning.value}))

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

    def _publish_payload_status(self, mission_id: str, mission: Mission) -> None:
        """Publish live payload temperature/integrity based on elapsed time."""
        if not mission.started_at:
            return
        from backend.services.payload_service import compute_payload_status
        from backend.weather_service import get_weather_at_location

        elapsed = (datetime.now(timezone.utc) - mission.started_at).total_seconds() / 60.0

        # Get supply type from first delivery
        payload_type = "blood"
        for d_id in mission.delivery_ids:
            d = self._deliveries.get(d_id)
            if d and d.supply:
                payload_type = d.supply.split()[0].lower()  # "blood_pack" → "blood_pack"
                break

        # Get wind at drone location
        drone = self._drones.get(mission.drone_id)
        wind = 0.0
        if drone:
            w = get_weather_at_location(drone.current_location)
            wind = w.get("wind_speed", 0)

        status = compute_payload_status(payload_type, elapsed, wind)
        self._events.publish(EventType.payload_status_updated, {
            "mission_id": mission_id,
            **status,
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
