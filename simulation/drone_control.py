"""
DroneMedic - Drone Controller

Controls the drone via AirSim API or a mock mode for development.
Mock mode logs movements to console and simulates delays without AirSim.
"""

import time
import logging
from config import LOCATIONS, DRONE_VELOCITY, MOCK_MOVE_DELAY, AIRSIM_ENABLED

logger = logging.getLogger("DroneMedic.Drone")


class DroneController:
    """
    Unified drone controller with AirSim and mock mode support.

    Usage:
        drone = DroneController(use_airsim=False)
        drone.connect()
        drone.takeoff()
        drone.move_to("Clinic A")
        drone.land()
    """

    def __init__(self, use_airsim: bool = None):
        if use_airsim is None:
            use_airsim = AIRSIM_ENABLED
        self.use_airsim = use_airsim
        self.client = None
        self.connected = False
        self.is_flying = False
        self.paused = False
        self.current_location = "Depot"
        self.position = {"x": 0.0, "y": 0.0, "z": 0.0}
        self.flight_log = []  # Track all movements

    def connect(self):
        """Establish connection to AirSim or initialize mock mode."""
        if self.use_airsim:
            try:
                import airsim
                self.client = airsim.MultirotorClient()
                self.client.confirmConnection()
                self.client.enableApiControl(True)
                self.client.armDisarm(True)
                logger.info("Connected to AirSim")
            except ImportError:
                logger.warning("AirSim not installed, falling back to mock mode")
                self.use_airsim = False
            except Exception as e:
                logger.warning(f"AirSim connection failed ({e}), falling back to mock mode")
                self.use_airsim = False

        if not self.use_airsim:
            logger.info("[MOCK] Drone controller initialized (mock mode)")

        self.connected = True
        self._log_event("connected")

    def takeoff(self):
        """Take off to default altitude."""
        if not self.connected:
            raise RuntimeError("Drone not connected. Call connect() first.")

        if self.use_airsim:
            self.client.takeoffAsync().join()
        else:
            logger.info("[MOCK] Taking off...")
            time.sleep(MOCK_MOVE_DELAY * 0.5)

        self.is_flying = True
        self.current_location = "Depot"
        self._log_event("takeoff")
        logger.info("Drone is airborne")

    def move_to(self, location_name: str) -> bool:
        """
        Fly to a named location.

        Args:
            location_name: Name of location from config.LOCATIONS

        Returns:
            True if reached successfully, False if paused/interrupted.
        """
        if not self.is_flying:
            raise RuntimeError("Drone not flying. Call takeoff() first.")

        if location_name not in LOCATIONS:
            raise ValueError(f"Unknown location: {location_name}")

        # Check if paused
        if self.paused:
            logger.info(f"Drone is paused. Waiting to resume before moving to {location_name}...")
            while self.paused:
                time.sleep(0.5)

        target = LOCATIONS[location_name]
        logger.info(f"Moving to {location_name} ({target['x']}, {target['y']}, {target['z']})")

        if self.use_airsim:
            self.client.moveToPositionAsync(
                target["x"], target["y"], target["z"],
                DRONE_VELOCITY,
            ).join()
        else:
            # Mock: simulate travel time based on distance
            import math
            dist = math.sqrt(
                (target["x"] - self.position["x"]) ** 2 +
                (target["y"] - self.position["y"]) ** 2
            )
            travel_time = min(dist / (DRONE_VELOCITY * 10), MOCK_MOVE_DELAY)
            time.sleep(max(travel_time, 0.3))

        # Update position
        self.position = {"x": target["x"], "y": target["y"], "z": target["z"]}
        self.current_location = location_name
        self._log_event(f"arrived:{location_name}")
        logger.info(f"Arrived at {location_name}")
        return True

    def get_position(self) -> dict:
        """Get current drone position."""
        if self.use_airsim and self.client:
            state = self.client.getMultirotorState()
            pos = state.kinematics_estimated.position
            return {"x": pos.x_val, "y": pos.y_val, "z": pos.z_val}
        return self.position.copy()

    def get_current_location(self) -> str:
        """Get the name of the current/last visited location."""
        return self.current_location

    def pause(self):
        """Pause drone (hover in place). Used for re-routing."""
        self.paused = True
        if self.use_airsim and self.client:
            self.client.hoverAsync().join()
        logger.info("[PAUSED] Drone hovering - awaiting new route")
        self._log_event("paused")

    def resume(self):
        """Resume drone after pause."""
        self.paused = False
        logger.info("[RESUMED] Drone continuing delivery")
        self._log_event("resumed")

    def land(self):
        """Land the drone."""
        if self.use_airsim and self.client:
            self.client.landAsync().join()
            self.client.armDisarm(False)
            self.client.enableApiControl(False)
        else:
            logger.info("[MOCK] Landing...")
            time.sleep(MOCK_MOVE_DELAY * 0.5)

        self.is_flying = False
        self._log_event("landed")
        logger.info("Drone has landed")

    def get_flight_log(self) -> list[dict]:
        """Return the full flight log."""
        return self.flight_log.copy()

    def _log_event(self, event: str):
        """Record an event in the flight log."""
        self.flight_log.append({
            "event": event,
            "location": self.current_location,
            "position": self.position.copy(),
            "timestamp": time.time(),
        })


# --- Quick test ---
if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    drone = DroneController(use_airsim=False)
    drone.connect()
    drone.takeoff()

    for loc in ["Clinic A", "Clinic B", "Clinic C"]:
        drone.move_to(loc)

    drone.land()

    print("\n=== Flight Log ===")
    for entry in drone.get_flight_log():
        print(f"  {entry['event']:20s} @ {entry['location']}")
