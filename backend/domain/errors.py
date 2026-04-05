"""DroneMedic — Domain error types."""


class DomainError(Exception):
    """Base error for all domain-level failures."""


class MissionNotFoundError(DomainError):
    def __init__(self, mission_id: str):
        super().__init__(f"Mission not found: {mission_id}")
        self.mission_id = mission_id


class DroneNotFoundError(DomainError):
    def __init__(self, drone_id: str):
        super().__init__(f"Drone not found: {drone_id}")
        self.drone_id = drone_id


class DroneUnavailableError(DomainError):
    def __init__(self, reason: str = "No drones available"):
        super().__init__(reason)


class DeliveryNotFoundError(DomainError):
    def __init__(self, delivery_id: str):
        super().__init__(f"Delivery not found: {delivery_id}")
        self.delivery_id = delivery_id


class InvalidTransitionError(DomainError):
    def __init__(self, entity: str, current: str, target: str):
        super().__init__(
            f"Cannot transition {entity} from '{current}' to '{target}'"
        )
        self.current = current
        self.target = target


class InvalidLocationError(DomainError):
    def __init__(self, location: str):
        super().__init__(f"Unknown location: {location}")
        self.location = location
