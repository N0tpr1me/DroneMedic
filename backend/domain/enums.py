"""DroneMedic — Domain enums for drone, mission, delivery, and event states."""

from enum import Enum


class DroneStatus(str, Enum):
    idle = "idle"
    preflight = "preflight"
    takeoff = "takeoff"
    en_route = "en_route"
    hovering = "hovering"
    paused = "paused"
    delivering = "delivering"
    rerouting = "rerouting"
    returning = "returning"
    landing = "landing"
    landed = "landed"
    emergency = "emergency"
    offline = "offline"


class MissionStatus(str, Enum):
    planning = "planning"
    preflight = "preflight"
    in_progress = "in_progress"
    paused = "paused"
    rerouting = "rerouting"
    completing = "completing"
    completed = "completed"
    failed = "failed"
    aborted = "aborted"
    reassigned = "reassigned"


class DeliveryStatus(str, Enum):
    pending = "pending"
    assigned = "assigned"
    in_transit = "in_transit"
    delivering = "delivering"
    delivered = "delivered"
    failed = "failed"
    cancelled = "cancelled"


class EventType(str, Enum):
    # Mission lifecycle
    mission_created = "mission_created"
    mission_started = "mission_started"
    mission_paused = "mission_paused"
    mission_resumed = "mission_resumed"
    mission_completed = "mission_completed"
    mission_failed = "mission_failed"
    mission_aborted = "mission_aborted"
    mission_reassigned = "mission_reassigned"
    # Drone
    drone_status_changed = "drone_status_changed"
    drone_position_updated = "drone_position_updated"
    drone_battery_low = "drone_battery_low"
    # Delivery
    delivery_created = "delivery_created"
    delivery_assigned = "delivery_assigned"
    delivery_completed = "delivery_completed"
    delivery_failed = "delivery_failed"
    # Route / waypoint
    waypoint_reached = "waypoint_reached"
    reroute_requested = "reroute_requested"
    reroute_completed = "reroute_completed"
    # Environment
    weather_alert = "weather_alert"
    geofence_violation = "geofence_violation"
    obstacle_detected = "obstacle_detected"
    # AI reasoning narration
    ai_reasoning = "ai_reasoning"
    # Demo / scenario
    scenario_triggered = "scenario_triggered"


class EventSource(str, Enum):
    system = "system"
    manual = "manual"
    scenario = "scenario"
