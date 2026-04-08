"""DroneMedic — Smart Delivery Coordinator.

Handles repeat requests from the same location by batching them onto
existing in-flight or scheduled missions when feasible.  New requests
are evaluated against active deliveries using time windows, distance
constraints, and priority rules before deciding to batch or dispatch
a new drone.

Decision flow for every incoming request:
  1. Is there an active mission already heading to this location?
     → YES: is it still modifiable (not too close / not departed past cutoff)?
       → YES: batch the new item onto that mission (reroute in-flight).
       → NO:  fall through to step 2.
  2. Is there a PLANNING-stage mission that hasn't departed yet?
     → YES: add to that mission's deliveries and re-optimise route.
  3. No batchable mission found → schedule a new drone delivery.
"""

from __future__ import annotations

import logging
import math
import time as _time
from dataclasses import dataclass, field
from datetime import datetime, timezone

from config import (
    LOCATIONS,
    BATTERY_DRAIN_RATE,
    BATTERY_MIN_RESERVE,
    DRONE_CRUISE_SPEED_MS,
)
from backend.domain.enums import (
    DeliveryStatus,
    EventType,
    MissionStatus,
)
from backend.domain.models import Delivery, DeliveryItem, Mission

logger = logging.getLogger("DroneMedic.DeliveryCoordinator")

# ── Tuning constants ────────────────────────────────────────────────────

BATCH_WINDOW_SECONDS = 600          # 10 min — requests within this window can batch
CUTOFF_DISTANCE_M = 300             # if drone is < 300 m from destination, can't modify
CUTOFF_PROGRESS_PCT = 85            # if mission > 85% progress, can't modify
NEARBY_RADIUS_M = 1500              # treat locations within 1.5 km as "nearby" for batching
MAX_BATCH_ITEMS_PER_MISSION = 6     # max delivery items on a single mission
PRIORITY_OVERRIDE_WINDOW = 900      # 15 min — urgent items can batch within wider window


# ── Helpers ─────────────────────────────────────────────────────────────

def _haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Distance in metres between two GPS points."""
    R = 6_371_000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _location_coords(name: str) -> tuple[float, float]:
    """Return (lat, lon) for a named location."""
    loc = LOCATIONS.get(name, {})
    return loc.get("lat", 0.0), loc.get("lon", 0.0)


def _distance_between(loc_a: str, loc_b: str) -> float:
    """Haversine distance in metres between two named locations."""
    a_lat, a_lon = _location_coords(loc_a)
    b_lat, b_lon = _location_coords(loc_b)
    return _haversine(a_lat, a_lon, b_lat, b_lon)


# ── Request tracking ───────────────────────────────────────────────────

@dataclass
class LocationRequest:
    """Tracks a pending or recently-submitted request for a location."""
    location: str
    items: list[DeliveryItem] = field(default_factory=list)
    first_request_at: float = field(default_factory=_time.time)
    last_request_at: float = field(default_factory=_time.time)
    batch_count: int = 0


@dataclass
class BatchDecision:
    """Result of the batching decision engine."""
    action: str                       # "batch_inflight" | "batch_planning" | "new_mission"
    mission_id: str | None = None     # existing mission to batch onto
    reason: str = ""                  # human-readable explanation
    items: list[DeliveryItem] = field(default_factory=list)


# ── Coordinator ─────────────────────────────────────────────────────────

class DeliveryCoordinator:
    """Smart delivery coordinator with batching, cutoff, and priority logic."""

    def __init__(self, mission_service, drone_service, scheduler_service, event_service):
        self._missions = mission_service
        self._drones = drone_service
        self._scheduler = scheduler_service
        self._events = event_service

        # Per-location request queue: location_name → LocationRequest
        self._request_queue: dict[str, LocationRequest] = {}

    # ── Public API ──────────────────────────────────────────────────────

    def submit_request(self, item: DeliveryItem) -> BatchDecision:
        """Submit a single delivery request.  Returns a BatchDecision
        indicating whether it was batched or dispatched as a new mission.
        """
        self._track_request(item)
        decision = self._decide(item)
        self._execute(decision)
        return decision

    def submit_batch(self, items: list[DeliveryItem]) -> list[BatchDecision]:
        """Submit multiple items — each one is evaluated independently."""
        decisions: list[BatchDecision] = []
        # Group by destination first so same-location items batch together
        by_dest: dict[str, list[DeliveryItem]] = {}
        for item in items:
            by_dest.setdefault(item.destination, []).append(item)

        for dest, dest_items in by_dest.items():
            # Try batching the whole group as one
            merged = DeliveryItem(
                destination=dest,
                supply=", ".join(i.supply for i in dest_items if i.supply),
                priority="high" if any(i.priority == "high" for i in dest_items) else "normal",
                time_window_minutes=min(
                    (i.time_window_minutes for i in dest_items if i.time_window_minutes),
                    default=None,
                ),
            )
            for di in dest_items:
                self._track_request(di)
            decision = self._decide(merged)
            decision.items = dest_items
            self._execute(decision)
            decisions.append(decision)

        return decisions

    def get_request_history(self, location: str) -> LocationRequest | None:
        """Get the request history for a location."""
        return self._request_queue.get(location)

    def get_active_deliveries_for(self, location: str) -> list[dict]:
        """Return active deliveries heading to a location."""
        results = []
        for mission in self._get_active_missions():
            for d_id in mission.delivery_ids:
                try:
                    d = self._missions.get_delivery(d_id)
                    if d.destination == location and d.status.value not in ("delivered", "cancelled", "failed"):
                        results.append({
                            "delivery_id": d.id,
                            "mission_id": mission.id,
                            "drone_id": mission.drone_id,
                            "supply": d.supply,
                            "priority": d.priority,
                            "status": d.status.value,
                            "mission_status": mission.status.value,
                        })
                except Exception:
                    continue
        return results

    # ── Decision engine ─────────────────────────────────────────────────

    def _decide(self, item: DeliveryItem) -> BatchDecision:
        """Core batching decision logic.

        Priority order:
          1. Batch onto an in-flight mission heading to the same (or nearby) location
          2. Batch onto a PLANNING mission that hasn't departed
          3. Schedule a new drone
        """
        is_urgent = item.priority == "high"
        window = PRIORITY_OVERRIDE_WINDOW if is_urgent else BATCH_WINDOW_SECONDS

        # ── Step 1: check in-flight missions ────────────────────────────
        for mission in self._get_inflight_missions():
            if not self._mission_serves_location(mission, item.destination):
                continue
            if len(mission.delivery_ids) >= MAX_BATCH_ITEMS_PER_MISSION:
                continue
            if self._past_cutoff(mission):
                continue
            if not self._within_time_window(mission, window):
                continue
            if not self._has_payload_capacity(mission, item):
                continue

            return BatchDecision(
                action="batch_inflight",
                mission_id=mission.id,
                reason=(
                    f"Batched with in-flight mission {mission.id} "
                    f"(drone {mission.drone_id}) already heading to "
                    f"{item.destination}."
                ),
                items=[item],
            )

        # ── Step 2: check PLANNING missions ─────────────────────────────
        for mission in self._get_planning_missions():
            if not self._mission_serves_location(mission, item.destination):
                continue
            if len(mission.delivery_ids) >= MAX_BATCH_ITEMS_PER_MISSION:
                continue

            return BatchDecision(
                action="batch_planning",
                mission_id=mission.id,
                reason=(
                    f"Added to planned mission {mission.id} "
                    f"(not yet departed)."
                ),
                items=[item],
            )

        # ── Step 3: check nearby in-flight missions ─────────────────────
        for mission in self._get_inflight_missions():
            if self._past_cutoff(mission):
                continue
            if len(mission.delivery_ids) >= MAX_BATCH_ITEMS_PER_MISSION:
                continue
            # Check if any stop on this mission is near our destination
            for stop in mission.planned_route:
                if stop == "Depot":
                    continue
                dist = _distance_between(stop, item.destination)
                if dist <= NEARBY_RADIUS_M:
                    return BatchDecision(
                        action="batch_inflight",
                        mission_id=mission.id,
                        reason=(
                            f"Batched with in-flight mission {mission.id} "
                            f"passing nearby ({stop} is {dist:.0f}m from "
                            f"{item.destination})."
                        ),
                        items=[item],
                    )

        # ── Step 4: new mission ─────────────────────────────────────────
        return BatchDecision(
            action="new_mission",
            reason=(
                f"No active mission available for {item.destination}. "
                f"Scheduling new drone delivery."
            ),
            items=[item],
        )

    # ── Execution ───────────────────────────────────────────────────────

    def _execute(self, decision: BatchDecision) -> None:
        """Execute the batching decision."""
        if decision.action == "batch_inflight":
            self._batch_onto_inflight(decision)
        elif decision.action == "batch_planning":
            self._batch_onto_planning(decision)
        elif decision.action == "new_mission":
            self._dispatch_new(decision)

        self._events.publish(EventType.delivery_created, {
            "action": decision.action,
            "mission_id": decision.mission_id,
            "reason": decision.reason,
            "destinations": [i.destination for i in decision.items],
        })

    def _batch_onto_inflight(self, decision: BatchDecision) -> None:
        """Reroute an in-flight mission to include new deliveries."""
        try:
            self._missions.reroute_mission(
                mission_id=decision.mission_id,
                reason=f"Batching new delivery: {decision.reason}",
                new_items=decision.items,
            )
            logger.info(
                "Batched %d item(s) onto in-flight mission %s",
                len(decision.items), decision.mission_id,
            )
        except Exception as e:
            logger.warning(
                "Failed to batch onto mission %s: %s — dispatching new",
                decision.mission_id, e,
            )
            decision.action = "new_mission"
            decision.mission_id = None
            decision.reason = f"Batch failed ({e}), dispatching new drone."
            self._dispatch_new(decision)

    def _batch_onto_planning(self, decision: BatchDecision) -> None:
        """Add deliveries to a mission that hasn't departed yet."""
        try:
            mission = self._missions.get_mission(decision.mission_id)

            # Create delivery objects and add to mission
            new_deliveries = self._missions.create_deliveries(decision.items)
            new_ids = [d.id for d in new_deliveries]
            mission.delivery_ids.extend(new_ids)

            # Recompute route with all destinations
            all_stops = list(dict.fromkeys(
                s for s in mission.planned_route if s != "Depot"
            ))
            for item in decision.items:
                if item.destination not in all_stops:
                    all_stops.append(item.destination)

            from backend.services.route_service import RouteService
            route_result = self._missions._routes.compute(
                locations=all_stops,
                priorities={
                    d.destination: d.priority
                    for d_id in mission.delivery_ids
                    for d in [self._missions.get_delivery(d_id)]
                    if d.priority == "high"
                },
                num_drones=1,
            )
            # Update mission route
            routes = route_result.get("ordered_routes", {})
            if routes:
                new_route = list(routes.values())[0]
                mission.planned_route = new_route

            # Update delivery assignments
            for d in new_deliveries:
                d.assigned_drone = mission.drone_id
                d.assigned_mission = mission.id
                d.status = DeliveryStatus.assigned

            logger.info(
                "Added %d item(s) to planning mission %s",
                len(decision.items), decision.mission_id,
            )

        except Exception as e:
            logger.warning(
                "Failed to add to planning mission %s: %s — dispatching new",
                decision.mission_id, e,
            )
            decision.action = "new_mission"
            decision.mission_id = None
            self._dispatch_new(decision)

    def _dispatch_new(self, decision: BatchDecision) -> None:
        """Schedule a new drone delivery."""
        try:
            deliveries, missions = self._scheduler.schedule_batch(decision.items)
            if missions:
                decision.mission_id = missions[0].id
                logger.info(
                    "New mission %s created for %s",
                    missions[0].id,
                    [i.destination for i in decision.items],
                )
            else:
                logger.warning("No drones available for new delivery.")
        except Exception as e:
            logger.error("Failed to schedule new delivery: %s", e)

    # ── Query helpers ───────────────────────────────────────────────────

    def _get_active_missions(self) -> list[Mission]:
        """All missions that are in-flight or planning."""
        active_statuses = {
            MissionStatus.planning,
            MissionStatus.in_progress,
            MissionStatus.paused,
            MissionStatus.rerouting,
        }
        return [
            m for m in self._missions.get_all_missions()
            if m.status in active_statuses
        ]

    def _get_inflight_missions(self) -> list[Mission]:
        """Missions currently flying (in_progress, paused, rerouting)."""
        inflight = {
            MissionStatus.in_progress,
            MissionStatus.paused,
            MissionStatus.rerouting,
        }
        return [
            m for m in self._missions.get_all_missions()
            if m.status in inflight
        ]

    def _get_planning_missions(self) -> list[Mission]:
        """Missions scheduled but not yet departed."""
        return [
            m for m in self._missions.get_all_missions()
            if m.status == MissionStatus.planning
        ]

    # ── Constraint checks ───────────────────────────────────────────────

    def _mission_serves_location(self, mission: Mission, location: str) -> bool:
        """Does this mission visit the given location (or somewhere very close)?"""
        if location in mission.planned_route:
            return True
        # Check proximity — a mission to Homerton could serve a nearby request
        for stop in mission.planned_route:
            if stop == "Depot":
                continue
            if _distance_between(stop, location) <= NEARBY_RADIUS_M:
                return True
        return False

    def _past_cutoff(self, mission: Mission) -> bool:
        """Is the drone too far along to accept modifications?

        Cutoff when:
          - Mission progress > 85%
          - Drone is within 300m of its LAST delivery stop
        """
        route = mission.planned_route
        if not route:
            return True

        # Progress-based cutoff
        total_waypoints = len([s for s in route if s != "Depot"])
        if total_waypoints == 0:
            return True

        reached = sum(1 for w in mission.waypoints if w.reached and not w.is_depot)
        progress = (reached / total_waypoints) * 100
        if progress >= CUTOFF_PROGRESS_PCT:
            return True

        # Distance-based cutoff — check distance to last non-depot stop
        last_stop = None
        for s in reversed(route):
            if s != "Depot":
                last_stop = s
                break
        if last_stop:
            try:
                drone = self._drones.get(mission.drone_id)
                drone_loc = drone.current_location
                dist = _distance_between(drone_loc, last_stop)
                if dist <= CUTOFF_DISTANCE_M:
                    return True
            except Exception:
                pass

        return False

    def _within_time_window(self, mission: Mission, window_seconds: float) -> bool:
        """Was this mission created recently enough to still accept batches?"""
        age = (_time.time() - mission.created_at.timestamp())
        return age <= window_seconds

    def _has_payload_capacity(self, mission: Mission, item: DeliveryItem) -> bool:
        """Check if the drone can carry additional payload.

        Uses config.SUPPLY_WEIGHTS to estimate — if the supply type
        isn't recognised, assume 1 kg.
        """
        from config import SUPPLY_WEIGHTS, DRONE_MAX_PAYLOAD_KG

        current_weight = 0.0
        for d_id in mission.delivery_ids:
            try:
                d = self._missions.get_delivery(d_id)
                supply_key = d.supply.lower().replace(" ", "_")
                current_weight += SUPPLY_WEIGHTS.get(supply_key, 1.0)
            except Exception:
                current_weight += 1.0

        new_weight = SUPPLY_WEIGHTS.get(
            item.supply.lower().replace(" ", "_") if item.supply else "", 1.0
        )
        return (current_weight + new_weight) <= DRONE_MAX_PAYLOAD_KG

    # ── Request tracking ────────────────────────────────────────────────

    def _track_request(self, item: DeliveryItem) -> None:
        """Track incoming request for repeat-detection."""
        now = _time.time()
        loc = item.destination

        if loc in self._request_queue:
            req = self._request_queue[loc]
            req.items.append(item)
            req.last_request_at = now
            req.batch_count += 1
        else:
            self._request_queue[loc] = LocationRequest(
                location=loc,
                items=[item],
                first_request_at=now,
                last_request_at=now,
                batch_count=1,
            )

        # Prune old entries (> 30 min)
        cutoff = now - 1800
        expired = [k for k, v in self._request_queue.items() if v.last_request_at < cutoff]
        for k in expired:
            del self._request_queue[k]
