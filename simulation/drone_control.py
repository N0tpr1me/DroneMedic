"""
DroneMedic - Drone Controller

Controls the drone via AirSim API, PX4 SITL (MAVSDK), or a mock mode for
development.  Mock mode logs movements to console and simulates delays
without any flight controller.
"""

import math
import time
import logging
from config import (
    LOCATIONS, DRONE_VELOCITY, MOCK_MOVE_DELAY, AIRSIM_ENABLED,
    BATTERY_CAPACITY, BATTERY_DRAIN_RATE, BATTERY_MIN_RESERVE, DRONE_NAMES,
    PX4_ENABLED, PX4_CONNECTION, PX4_ALTITUDE_M,
    SUPPLY_WEIGHTS, BATTERY_DRAIN_RATE_BASE, BATTERY_DRAIN_RATE_PER_KG,
)

logger = logging.getLogger("DroneMedic.Drone")

# Lazy import: physics engine (optional - degrades gracefully if not available)
_physics_available = False
try:
    from backend.physics import (
        DroneSpec as _DroneSpec,
        compute_energy_per_km as _energy_per_km,
        compute_hover_energy as _hover_energy,
        haversine_m as _haversine_m,
    )
    _physics_available = True
except ImportError:
    pass


class DroneMode:
    """Constants for supported flight-controller backends."""
    MOCK = "mock"
    AIRSIM = "airsim"
    PX4 = "px4"


class DroneController:
    """
    Unified drone controller with AirSim, PX4 SITL, and mock mode support.

    Usage:
        drone = DroneController(mode=DroneMode.MOCK)
        drone.connect()
        drone.takeoff()
        drone.move_to("Clinic A")
        drone.release_payload()
        drone.land()
    """

    def __init__(self, use_airsim: bool = None, mode: str = None):
        # --- Resolve backend mode -----------------------------------------
        if mode is not None:
            self.mode = mode
        elif use_airsim is not None:
            self.mode = DroneMode.AIRSIM if use_airsim else DroneMode.MOCK
        elif PX4_ENABLED:
            self.mode = DroneMode.PX4
        elif AIRSIM_ENABLED:
            self.mode = DroneMode.AIRSIM
        else:
            self.mode = DroneMode.MOCK

        self.use_airsim = self.mode == DroneMode.AIRSIM
        self.client = None
        self._px4 = None
        self.connected = False
        self.is_flying = False
        self.paused = False
        self.current_location = "Depot"
        self.position = {"x": 0.0, "y": 0.0, "z": 0.0}
        self.battery = BATTERY_CAPACITY   # percentage
        self.flight_log = []
        self._payload_kg = 0.0

        if self.mode == DroneMode.PX4:
            try:
                from simulation.px4_adapter import PX4Adapter
                self._px4 = PX4Adapter(connection_url=PX4_CONNECTION)
            except ImportError:
                logger.warning("mavsdk not installed - falling back to mock mode")
                self.mode = DroneMode.MOCK

    def connect(self):
        """Establish connection to PX4, AirSim, or initialize mock mode."""
        if self.mode == DroneMode.PX4:
            try:
                self._px4.connect_sync()
                logger.info("Connected to PX4 SITL via MAVSDK")
            except Exception as e:
                logger.warning(f"PX4 connection failed ({e}), falling back to mock mode")
                self.mode = DroneMode.MOCK
                self._px4 = None
        elif self.use_airsim:
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

        if self.mode != DroneMode.PX4 and not self.use_airsim:
            logger.info("[MOCK] Drone controller initialized (mock mode)")

        self.connected = True
        self._log_event("connected")

    def takeoff(self):
        """Take off to default altitude."""
        if not self.connected:
            raise RuntimeError("Drone not connected. Call connect() first.")

        if self.mode == DroneMode.PX4:
            self._px4.takeoff_sync(PX4_ALTITUDE_M)
        elif self.use_airsim:
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

        if self.paused:
            logger.info(f"Drone is paused. Waiting to resume before moving to {location_name}...")
            while self.paused:
                time.sleep(0.5)

        target = LOCATIONS[location_name]
        logger.info(f"Moving to {location_name} ({target['x']}, {target['y']}, {target['z']})")

        dist = math.sqrt(
            (target["x"] - self.position["x"]) ** 2 +
            (target["y"] - self.position["y"]) ** 2
        )

        if self.mode == DroneMode.PX4:
            self._px4.goto_gps_sync(target["lat"], target["lon"], PX4_ALTITUDE_M)
            self.position = {"x": target["x"], "y": target["y"], "z": target["z"]}
        elif self.use_airsim:
            self.client.moveToPositionAsync(
                target["x"], target["y"], target["z"],
                DRONE_VELOCITY,
            ).join()
        else:
            travel_time = min(dist / (DRONE_VELOCITY * 10), MOCK_MOVE_DELAY)
            time.sleep(max(travel_time, 0.3))

        self._drain_battery(dist)
        self.position = {"x": target["x"], "y": target["y"], "z": target["z"]}
        self.current_location = location_name
        self._log_event(f"arrived:{location_name}")
        logger.info(f"Arrived at {location_name} (battery: {self.battery:.1f}%)")
        return True

    def get_position(self) -> dict:
        """Get current drone position."""
        if self.mode == DroneMode.PX4 and self._px4:
            return self._px4.get_position_sync()
        elif self.use_airsim and self.client:
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
        if self.mode == DroneMode.PX4 and self._px4:
            self._px4.hold_sync()
        elif self.use_airsim and self.client:
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
        if self.mode == DroneMode.PX4 and self._px4:
            self._px4.land_sync()
        elif self.use_airsim and self.client:
            self.client.landAsync().join()
            self.client.armDisarm(False)
            self.client.enableApiControl(False)
        else:
            logger.info("[MOCK] Landing...")
            time.sleep(MOCK_MOVE_DELAY * 0.5)

        self.is_flying = False
        self._log_event("landed")
        logger.info("Drone has landed")

    def get_battery(self) -> float:
        """Get current battery level (percentage)."""
        if self.mode == DroneMode.PX4 and self._px4:
            return self._px4.get_battery_sync()
        return self.battery

    def get_battery_wh(self) -> float:
        """Get current battery energy in Wh (for physics engine)."""
        if _physics_available:
            spec = _DroneSpec()
            return (self.battery / 100.0) * spec.battery_capacity_wh
        return (self.battery / 100.0) * 800.0

    def release_payload(self):
        """Release the current payload at the delivery location."""
        if self.mode == DroneMode.PX4 and self._px4:
            self._px4.release_payload_sync()
        self._log_event("payload_released")
        logger.info("Payload released")

    def load_payload(self, supplies: list[str]) -> float:
        """
        Load supplies onto the drone and calculate total payload weight.

        Returns:
            Total payload weight in kg.

        Raises:
            ValueError: If total weight exceeds DRONE_MAX_PAYLOAD_KG.
        """
        from config import DRONE_MAX_PAYLOAD_KG
        total_kg = sum(SUPPLY_WEIGHTS.get(s, 0.5) for s in supplies)
        if total_kg > DRONE_MAX_PAYLOAD_KG:
            raise ValueError(f"Payload {total_kg:.1f}kg exceeds max {DRONE_MAX_PAYLOAD_KG}kg")
        self._payload_kg = total_kg
        self._log_event(f"payload_loaded:{total_kg:.1f}kg")
        logger.info(f"Loaded payload: {supplies} ({total_kg:.1f}kg)")
        return total_kg

    def _drain_battery(self, distance: float):
        """Drain battery based on distance traveled, accounting for payload weight.

        Uses physics engine if available for more realistic energy computation,
        otherwise falls back to the simple linear model.
        """
        payload = getattr(self, '_payload_kg', 0.0)

        if _physics_available:
            spec = _DroneSpec()
            e_per_km = _energy_per_km(spec, payload)
            dist_km = distance / 1000.0
            energy_consumed_wh = e_per_km * dist_km
            drain_pct = (energy_consumed_wh / spec.battery_capacity_wh) * 100.0
        else:
            rate = BATTERY_DRAIN_RATE_BASE + (payload * BATTERY_DRAIN_RATE_PER_KG)
            drain_pct = distance * rate

        self.battery = max(0.0, self.battery - drain_pct)
        if self.battery <= BATTERY_MIN_RESERVE:
            logger.warning(
                f"[BATTERY] Low battery: {self.battery:.1f}% - emergency return recommended"
            )

    def check_battery_for_return(self) -> bool:
        """Check if drone has enough battery to return to Depot."""
        depot = LOCATIONS["Depot"]
        dist_to_depot = math.sqrt(
            (depot["x"] - self.position["x"]) ** 2 +
            (depot["y"] - self.position["y"]) ** 2
        )
        needed = dist_to_depot * BATTERY_DRAIN_RATE
        return self.battery - needed >= BATTERY_MIN_RESERVE

    def get_flight_log(self) -> list:
        """Return the full flight log."""
        return self.flight_log.copy()

    def _log_event(self, event: str):
        """Record an event in the flight log."""
        self.flight_log.append({
            "event": event,
            "location": self.current_location,
            "position": self.position.copy(),
            "battery": self.battery,
            "timestamp": time.time(),
        })


class FleetController:
    """
    Manages multiple DroneController instances for multi-drone operations.

    Usage:
        fleet = FleetController(num_drones=2, use_airsim=False)
        fleet.connect_all()
        fleet.execute_routes({"Drone1": [...], "Drone2": [...]})
    """

    def __init__(self, num_drones: int = 1, use_airsim: bool = False, mode: str = None):
        self.drones = {}
        for i in range(num_drones):
            name = DRONE_NAMES[i] if i < len(DRONE_NAMES) else f"Drone{i + 1}"
            self.drones[name] = DroneController(use_airsim=use_airsim, mode=mode)

    def connect_all(self):
        """Connect all drones."""
        for name, drone in self.drones.items():
            logger.info(f"[FLEET] Connecting {name}...")
            drone.connect()

    def get_drone(self, drone_id: str) -> DroneController:
        """Get a specific drone by ID."""
        return self.drones.get(drone_id)

    def execute_routes(self, routes: dict):
        """
        Execute routes for all drones sequentially (mock mode).
        In a real system, these would run concurrently.

        Args:
            routes: Dict of {drone_id: [ordered_waypoints]}
        """
        for drone_id, waypoints in routes.items():
            drone = self.drones.get(drone_id)
            if not drone:
                logger.warning(f"[FLEET] Unknown drone: {drone_id}")
                continue

            real_stops = [w for w in waypoints if w != "Depot"]
            if not real_stops:
                continue

            logger.info(f"\n[FLEET] {drone_id} starting route: {' -> '.join(waypoints)}")
            drone.takeoff()

            for wp in waypoints:
                if wp == "Depot" and wp == waypoints[0]:
                    continue
                drone.move_to(wp)

            drone.land()
            logger.info(f"[FLEET] {drone_id} completed (battery: {drone.get_battery():.1f}%)")

    def get_all_batteries(self) -> dict:
        """Get battery levels for all drones."""
        return {name: drone.get_battery() for name, drone in self.drones.items()}

    def get_all_logs(self) -> dict:
        """Get flight logs for all drones."""
        return {name: drone.get_flight_log() for name, drone in self.drones.items()}


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
