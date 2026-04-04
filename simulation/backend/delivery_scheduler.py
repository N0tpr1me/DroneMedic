"""
DroneMedic - Delivery scheduling with priority queue and emergency preemption.

Manages a priority-ordered queue of delivery requests and assigns them
to available drones. Supports emergency preemption: a CRITICAL request
can bump a lower-priority active delivery back into the queue.

This module is separate from the main scheduler.py (which handles mission
execution, drone control, and event broadcasting). It focuses purely on
request ordering and drone assignment logic.
"""

from __future__ import annotations

import heapq
import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import IntEnum
from typing import Optional

logger = logging.getLogger("DroneMedic.DeliveryScheduler")


# ── Priority Levels ───────────────────────────────────────────────────

class Priority(IntEnum):
    """Delivery priority levels. Higher value = more urgent."""
    LOW = 0
    NORMAL = 1
    HIGH = 2
    CRITICAL = 3


# ── Delivery Request ──────────────────────────────────────────────────

def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _new_request_id() -> str:
    return f"REQ-{uuid.uuid4().hex[:8]}"


@dataclass(order=True)
class DeliveryRequest:
    """
    A delivery request in the priority queue.

    Ordering uses *negated* priority so heapq (min-heap) pops the highest
    priority first. Ties are broken by request time (earlier = higher).
    """

    sort_key: tuple = field(init=False, repr=False, compare=True)
    request_id: str = field(default_factory=_new_request_id, compare=False)
    origin: str = field(default="Depot", compare=False)
    destination: str = field(default="", compare=False)
    supplies: list[str] = field(default_factory=list, compare=False)
    priority: Priority = field(default=Priority.NORMAL, compare=False)
    requested_at: datetime = field(default_factory=_utcnow, compare=False)
    assigned_drone: Optional[str] = field(default=None, compare=False)
    status: str = field(default="queued", compare=False)

    def __post_init__(self) -> None:
        # Negate priority for min-heap; use timestamp for FIFO tie-breaking
        self.sort_key = (-int(self.priority), self.requested_at.timestamp())


# ── Delivery Scheduler ────────────────────────────────────────────────

class DeliveryScheduler:
    """
    Priority queue + drone assignment with emergency preemption.

    Drones are tracked as either idle (available for assignment) or active
    (currently executing a delivery). A CRITICAL request can preempt the
    lowest-priority active delivery.
    """

    def __init__(self) -> None:
        self._queue: list[DeliveryRequest] = []  # heapq min-heap
        self._active: dict[str, DeliveryRequest] = {}  # drone_id -> request
        self._completed: list[DeliveryRequest] = []
        self._all_requests: dict[str, DeliveryRequest] = {}  # request_id -> request

    # ── Submit ────────────────────────────────────────────────────────

    def submit(
        self,
        origin: str = "Depot",
        destination: str = "",
        supplies: Optional[list[str]] = None,
        priority: Priority = Priority.NORMAL,
    ) -> str:
        """
        Submit a delivery request to the queue.

        Args:
            origin: Starting location (defaults to Depot).
            destination: Target delivery location.
            supplies: List of supply item names.
            priority: Priority level (LOW, NORMAL, HIGH, CRITICAL).

        Returns:
            The request ID.
        """
        if not destination:
            raise ValueError("destination is required")

        request = DeliveryRequest(
            origin=origin,
            destination=destination,
            supplies=list(supplies or []),
            priority=priority,
        )
        heapq.heappush(self._queue, request)
        self._all_requests[request.request_id] = request

        logger.info(
            f"[QUEUE] Submitted {request.request_id}: "
            f"{origin} -> {destination}  priority={priority.name}  "
            f"supplies={request.supplies}"
        )
        return request.request_id

    # ── Assignment ────────────────────────────────────────────────────

    def assign_next(self, drone_id: str) -> Optional[DeliveryRequest]:
        """
        Pop the highest-priority request from the queue and assign it to *drone_id*.

        Returns None if the queue is empty.
        """
        if drone_id in self._active:
            logger.warning(
                f"[QUEUE] Drone {drone_id} already has active delivery "
                f"{self._active[drone_id].request_id}"
            )
            return None

        if not self._queue:
            logger.info(f"[QUEUE] No pending requests for {drone_id}")
            return None

        request = heapq.heappop(self._queue)
        request.assigned_drone = drone_id
        request.status = "active"
        self._active[drone_id] = request

        logger.info(
            f"[QUEUE] Assigned {request.request_id} to {drone_id}: "
            f"{request.origin} -> {request.destination} "
            f"(priority={request.priority.name})"
        )
        return request

    # ── Preemption ────────────────────────────────────────────────────

    def preempt(
        self, drone_id: str, new_request: DeliveryRequest
    ) -> Optional[DeliveryRequest]:
        """
        Preempt *drone_id*'s current delivery with a higher-priority request.

        The preempted delivery is re-queued. Returns the preempted request,
        or None if preemption is not possible (drone idle, or new request
        is not higher priority).
        """
        current = self._active.get(drone_id)
        if current is None:
            logger.info(
                f"[PREEMPT] Drone {drone_id} has no active delivery — "
                f"assigning directly"
            )
            new_request.assigned_drone = drone_id
            new_request.status = "active"
            self._active[drone_id] = new_request
            self._all_requests[new_request.request_id] = new_request
            return None

        if new_request.priority <= current.priority:
            logger.info(
                f"[PREEMPT] Rejected: new priority {new_request.priority.name} "
                f"<= active {current.priority.name} on {drone_id}"
            )
            # Re-queue the new request instead
            heapq.heappush(self._queue, new_request)
            self._all_requests[new_request.request_id] = new_request
            return None

        # Preempt: bump current back to queue
        current.assigned_drone = None
        current.status = "preempted"
        heapq.heappush(self._queue, current)

        new_request.assigned_drone = drone_id
        new_request.status = "active"
        self._active[drone_id] = new_request
        self._all_requests[new_request.request_id] = new_request

        logger.info(
            f"[PREEMPT] {drone_id}: preempted {current.request_id} "
            f"(priority={current.priority.name}) with {new_request.request_id} "
            f"(priority={new_request.priority.name})"
        )
        return current

    # ── Completion ────────────────────────────────────────────────────

    def complete(self, drone_id: str) -> None:
        """Mark *drone_id*'s current delivery as completed and free the drone."""
        request = self._active.pop(drone_id, None)
        if request is None:
            logger.warning(f"[QUEUE] Drone {drone_id} has no active delivery to complete")
            return

        request.status = "completed"
        request.assigned_drone = None
        self._completed.append(request)

        logger.info(
            f"[QUEUE] Completed {request.request_id} on {drone_id}: "
            f"{request.origin} -> {request.destination}"
        )

    # ── Queries ───────────────────────────────────────────────────────

    def get_queue(self) -> list[DeliveryRequest]:
        """Return pending requests sorted by priority (highest first)."""
        return sorted(self._queue, key=lambda r: r.sort_key)

    def get_active(self) -> dict[str, DeliveryRequest]:
        """Return dict of drone_id -> active request."""
        return dict(self._active)

    def get_completed(self) -> list[DeliveryRequest]:
        """Return list of completed requests."""
        return list(self._completed)

    def get_request(self, request_id: str) -> Optional[DeliveryRequest]:
        """Look up a request by ID."""
        return self._all_requests.get(request_id)

    def find_lowest_priority_drone(self) -> Optional[str]:
        """
        Find the drone with the lowest-priority active delivery.

        Useful for deciding which drone to preempt when a CRITICAL
        request arrives.

        Returns:
            Drone ID, or None if no drones are active.
        """
        if not self._active:
            return None

        return min(
            self._active,
            key=lambda did: self._active[did].priority,
        )

    def queue_size(self) -> int:
        """Number of pending requests in the queue."""
        return len(self._queue)

    def active_count(self) -> int:
        """Number of drones currently executing deliveries."""
        return len(self._active)

    # ── Summary ───────────────────────────────────────────────────────

    def format_status(self) -> str:
        """Return a human-readable status summary."""
        lines = [
            "╔══════════════════════════════════════════╗",
            "║       DELIVERY SCHEDULER STATUS          ║",
            "╚══════════════════════════════════════════╝",
            f"  Queued:    {self.queue_size()}",
            f"  Active:    {self.active_count()}",
            f"  Completed: {len(self._completed)}",
        ]

        if self._active:
            lines.append("\n  Active Deliveries:")
            for drone_id, req in self._active.items():
                lines.append(
                    f"    {drone_id}: {req.request_id}  "
                    f"{req.origin} -> {req.destination}  "
                    f"[{req.priority.name}]"
                )

        if self._queue:
            lines.append("\n  Queued Requests:")
            for req in self.get_queue():
                lines.append(
                    f"    {req.request_id}  "
                    f"{req.origin} -> {req.destination}  "
                    f"[{req.priority.name}]"
                )

        return "\n".join(lines)


# ── Quick test ────────────────────────────────────────────────────────

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    scheduler = DeliveryScheduler()

    print("=== Submitting Requests ===")
    r1 = scheduler.submit("Depot", "Clinic A", ["blood_pack"], Priority.NORMAL)
    r2 = scheduler.submit("Depot", "Clinic B", ["vaccine_kit"], Priority.HIGH)
    r3 = scheduler.submit("Depot", "Clinic C", ["first_aid"], Priority.LOW)
    r4 = scheduler.submit("Depot", "Clinic D", ["medication"], Priority.NORMAL)

    print(f"\n=== Queue ({scheduler.queue_size()} requests) ===")
    for req in scheduler.get_queue():
        print(f"  {req.request_id}  -> {req.destination}  [{req.priority.name}]")

    print("\n=== Assigning to Drones ===")
    assigned1 = scheduler.assign_next("Drone1")
    print(f"  Drone1 got: {assigned1.request_id} -> {assigned1.destination} [{assigned1.priority.name}]")

    assigned2 = scheduler.assign_next("Drone2")
    print(f"  Drone2 got: {assigned2.request_id} -> {assigned2.destination} [{assigned2.priority.name}]")

    print(f"\n  Queue remaining: {scheduler.queue_size()}")

    print("\n=== Emergency Preemption ===")
    emergency = DeliveryRequest(
        origin="Depot",
        destination="Clinic A",
        supplies=["defibrillator"],
        priority=Priority.CRITICAL,
    )
    scheduler._all_requests[emergency.request_id] = emergency

    # Find the drone running the least important delivery
    lowest_drone = scheduler.find_lowest_priority_drone()
    print(f"  Lowest priority drone: {lowest_drone}")
    if lowest_drone:
        current_req = scheduler.get_active()[lowest_drone]
        print(
            f"  Current delivery: {current_req.request_id} "
            f"[{current_req.priority.name}]"
        )

    preempted = scheduler.preempt(lowest_drone, emergency)
    if preempted:
        print(
            f"  Preempted: {preempted.request_id} "
            f"[{preempted.priority.name}] -> re-queued"
        )
    print(f"  {lowest_drone} now running: {scheduler.get_active()[lowest_drone].request_id}")

    print("\n=== Completing Deliveries ===")
    scheduler.complete("Drone1")
    scheduler.complete(lowest_drone)

    # Assign remaining
    next_req = scheduler.assign_next("Drone1")
    if next_req:
        print(f"  Drone1 re-assigned: {next_req.request_id} -> {next_req.destination}")
        scheduler.complete("Drone1")

    next_req2 = scheduler.assign_next("Drone2")
    if next_req2:
        print(f"  Drone2 re-assigned: {next_req2.request_id} -> {next_req2.destination}")
        scheduler.complete("Drone2")

    print(f"\n{scheduler.format_status()}")

    print("\n=== Priority Ordering Demo ===")
    sched2 = DeliveryScheduler()
    sched2.submit("Depot", "A", ["x"], Priority.LOW)
    sched2.submit("Depot", "B", ["x"], Priority.CRITICAL)
    sched2.submit("Depot", "C", ["x"], Priority.NORMAL)
    sched2.submit("Depot", "D", ["x"], Priority.HIGH)
    sched2.submit("Depot", "E", ["x"], Priority.CRITICAL)

    print("  Dequeue order (should be CRITICAL, CRITICAL, HIGH, NORMAL, LOW):")
    while sched2.queue_size() > 0:
        req = sched2.assign_next("TestDrone")
        print(f"    {req.destination} [{req.priority.name}]")
        sched2.complete("TestDrone")
