"""
DroneMedic - Webots Mavic 2 Pro Controller

Waypoint-based autonomous delivery drone controller.
Reads delivery route from a JSON file (written by the route planner)
and flies the Mavic to each location in order, then returns to Depot.

Based on the official Webots Mavic 2 Pro patrol example.
"""

import json
import os
import sys
import time

from controller import Robot

try:
    import numpy as np
except ImportError:
    sys.exit("Warning: 'numpy' module not found. Install with: pip install numpy")


def clamp(value, value_min, value_max):
    return min(max(value, value_min), value_max)


# ── DroneMedic locations (matches config.py x,y coords) ──
LOCATIONS = {
    "Depot":    {"x": 0,    "y": 0},
    "Clinic A": {"x": 100,  "y": 50},
    "Clinic B": {"x": -50,  "y": 150},
    "Clinic C": {"x": 200,  "y": -30},
    "Clinic D": {"x": -100, "y": -80},
}

# Path to route file (written by route_planner.py before launching sim)
ROUTE_FILE = os.path.join(os.path.dirname(__file__), "..", "..", "route.json")

# Fallback demo route if no route file exists
DEFAULT_ROUTE = ["Depot", "Clinic A", "Clinic B", "Clinic C", "Depot"]


class MavicDelivery(Robot):
    """Mavic 2 Pro delivery controller with PID-based waypoint navigation."""

    # PID constants (empirically tuned for Mavic 2 Pro in Webots)
    K_VERTICAL_THRUST = 68.5
    K_VERTICAL_OFFSET = 0.6
    K_VERTICAL_P = 3.0
    K_ROLL_P = 50.0
    K_PITCH_P = 30.0

    MAX_YAW_DISTURBANCE = 0.4
    MAX_PITCH_DISTURBANCE = -1
    TARGET_PRECISION = 1.5  # meters — how close counts as "arrived"
    TARGET_ALTITUDE = 15    # meters above ground

    def __init__(self):
        Robot.__init__(self)
        self.time_step = int(self.getBasicTimeStep())

        # ── Sensors ──
        self.camera = self.getDevice("camera")
        self.camera.enable(self.time_step)
        self.imu = self.getDevice("inertial unit")
        self.imu.enable(self.time_step)
        self.gps = self.getDevice("gps")
        self.gps.enable(self.time_step)
        self.gyro = self.getDevice("gyro")
        self.gyro.enable(self.time_step)

        # ── Motors ──
        self.front_left_motor = self.getDevice("front left propeller")
        self.front_right_motor = self.getDevice("front right propeller")
        self.rear_left_motor = self.getDevice("rear left propeller")
        self.rear_right_motor = self.getDevice("rear right propeller")
        self.camera_pitch_motor = self.getDevice("camera pitch")
        self.camera_pitch_motor.setPosition(0.7)

        for motor in [self.front_left_motor, self.front_right_motor,
                      self.rear_left_motor, self.rear_right_motor]:
            motor.setPosition(float('inf'))
            motor.setVelocity(1)

        # ── State ──
        self.current_pose = [0, 0, 0, 0, 0, 0]  # x, y, z, roll, pitch, yaw
        self.battery = 100.0
        self.battery_drain_rate = 0.005  # per meter
        self.flight_log = []

    def load_route(self):
        """Load delivery route from JSON file, or use default demo route."""
        route_path = os.path.abspath(ROUTE_FILE)
        if os.path.exists(route_path):
            with open(route_path, 'r') as f:
                data = json.load(f)
                route = data.get("route", DEFAULT_ROUTE)
                print(f"[DroneMedic] Loaded route from {route_path}: {route}")
                return route
        print(f"[DroneMedic] No route file found, using demo route: {DEFAULT_ROUTE}")
        return DEFAULT_ROUTE

    def route_to_waypoints(self, route):
        """Convert location names to [x, y] waypoint coordinates."""
        waypoints = []
        for name in route:
            if name in LOCATIONS:
                loc = LOCATIONS[name]
                waypoints.append({"name": name, "x": loc["x"], "y": loc["y"]})
            else:
                print(f"[DroneMedic] WARNING: Unknown location '{name}', skipping")
        return waypoints

    def distance_to(self, x, y):
        """Euclidean distance from current position to target."""
        return np.sqrt((x - self.current_pose[0]) ** 2 + (y - self.current_pose[1]) ** 2)

    def has_reached(self, x, y):
        """Check if drone is within precision of target."""
        return self.distance_to(x, y) < self.TARGET_PRECISION

    def compute_navigation(self, target_x, target_y):
        """Compute yaw and pitch disturbances to navigate toward target."""
        target_angle = np.arctan2(
            target_y - self.current_pose[1],
            target_x - self.current_pose[0]
        )
        angle_left = target_angle - self.current_pose[5]
        # Normalize to (-pi, pi]
        angle_left = (angle_left + 2 * np.pi) % (2 * np.pi)
        if angle_left > np.pi:
            angle_left -= 2 * np.pi

        yaw_disturbance = self.MAX_YAW_DISTURBANCE * angle_left / (2 * np.pi)
        pitch_disturbance = clamp(
            np.log10(abs(angle_left)) if abs(angle_left) > 0.01 else self.MAX_PITCH_DISTURBANCE,
            self.MAX_PITCH_DISTURBANCE, 0.1
        )
        return yaw_disturbance, pitch_disturbance

    def apply_motors(self, roll, pitch, altitude, roll_acceleration, pitch_acceleration,
                     yaw_disturbance, pitch_disturbance, roll_disturbance=0):
        """Apply PID motor control."""
        roll_input = self.K_ROLL_P * clamp(roll, -1, 1) + roll_acceleration + roll_disturbance
        pitch_input = self.K_PITCH_P * clamp(pitch, -1, 1) + pitch_acceleration + pitch_disturbance
        yaw_input = yaw_disturbance
        clamped_alt = clamp(self.TARGET_ALTITUDE - altitude + self.K_VERTICAL_OFFSET, -1, 1)
        vertical_input = self.K_VERTICAL_P * pow(clamped_alt, 3.0)

        self.front_left_motor.setVelocity(
            self.K_VERTICAL_THRUST + vertical_input - yaw_input + pitch_input - roll_input)
        self.front_right_motor.setVelocity(
            -(self.K_VERTICAL_THRUST + vertical_input + yaw_input + pitch_input + roll_input))
        self.rear_left_motor.setVelocity(
            -(self.K_VERTICAL_THRUST + vertical_input + yaw_input - pitch_input - roll_input))
        self.rear_right_motor.setVelocity(
            self.K_VERTICAL_THRUST + vertical_input - yaw_input - pitch_input + roll_input)

    def drain_battery(self, distance):
        """Drain battery based on distance traveled."""
        self.battery = max(0.0, self.battery - distance * self.battery_drain_rate)

    def log_event(self, event, location=""):
        """Record flight event."""
        self.flight_log.append({
            "event": event,
            "location": location,
            "position": {"x": self.current_pose[0], "y": self.current_pose[1]},
            "battery": round(self.battery, 1),
            "sim_time": round(self.getTime(), 1),
        })

    def save_flight_log(self):
        """Save flight log to JSON."""
        log_path = os.path.join(os.path.dirname(__file__), "..", "..", "flight_log.json")
        log_path = os.path.abspath(log_path)
        with open(log_path, 'w') as f:
            json.dump(self.flight_log, f, indent=2)
        print(f"[DroneMedic] Flight log saved to {log_path}")

    def run(self):
        """Main control loop: takeoff, visit waypoints, land."""
        route = self.load_route()
        waypoints = self.route_to_waypoints(route)

        if len(waypoints) < 2:
            print("[DroneMedic] ERROR: Need at least 2 waypoints (Depot + 1 clinic)")
            return

        current_wp_index = 0
        phase = "takeoff"  # takeoff -> navigate -> hover -> land -> done
        nav_start_time = 0
        last_pos = [0, 0]
        hover_timer = 0

        print(f"\n{'='*50}")
        print(f"  DroneMedic Delivery Mission")
        print(f"  Route: {' -> '.join(wp['name'] for wp in waypoints)}")
        print(f"  Waypoints: {len(waypoints)}")
        print(f"{'='*50}\n")

        self.log_event("mission_start", waypoints[0]["name"])

        while self.step(self.time_step) != -1:
            # ── Read sensors ──
            roll, pitch, yaw = self.imu.getRollPitchYaw()
            x_pos, y_pos, altitude = self.gps.getValues()
            roll_acc, pitch_acc, _ = self.gyro.getValues()
            self.current_pose = [x_pos, y_pos, altitude, roll, pitch, yaw]

            # Track distance for battery drain
            dist_moved = np.sqrt((x_pos - last_pos[0])**2 + (y_pos - last_pos[1])**2)
            if dist_moved > 0.1:
                self.drain_battery(dist_moved)
                last_pos = [x_pos, y_pos]

            yaw_dist = 0
            pitch_dist = 0

            # ── State machine ──
            if phase == "takeoff":
                # Ascend to target altitude
                if altitude > self.TARGET_ALTITUDE - 1:
                    print(f"[DroneMedic] Airborne at {altitude:.1f}m -- starting deliveries")
                    self.log_event("takeoff", "Depot")
                    current_wp_index = 1  # Skip Depot, go to first clinic
                    phase = "navigate"
                    nav_start_time = self.getTime()

            elif phase == "navigate":
                wp = waypoints[current_wp_index]
                target_x, target_y = wp["x"], wp["y"]

                if self.has_reached(target_x, target_y):
                    # Arrived at waypoint
                    is_depot = wp["name"] == "Depot"
                    if is_depot:
                        print(f"[DroneMedic] Returned to Depot (battery: {self.battery:.1f}%)")
                        self.log_event("returned", "Depot")
                        phase = "land"
                    else:
                        print(f"[DroneMedic] DELIVERED to {wp['name']} (battery: {self.battery:.1f}%)")
                        self.log_event("delivered", wp["name"])
                        hover_timer = self.getTime()
                        phase = "hover"
                else:
                    # Navigate toward target
                    if self.getTime() - nav_start_time > 0.1:
                        yaw_dist, pitch_dist = self.compute_navigation(target_x, target_y)
                        nav_start_time = self.getTime()

            elif phase == "hover":
                # Hover at delivery point for 3 seconds (simulate drop-off)
                if self.getTime() - hover_timer > 3.0:
                    current_wp_index += 1
                    if current_wp_index >= len(waypoints):
                        phase = "land"
                    else:
                        print(f"[DroneMedic] En route to {waypoints[current_wp_index]['name']}...")
                        phase = "navigate"
                        nav_start_time = self.getTime()

            elif phase == "land":
                # Descend
                self.TARGET_ALTITUDE = max(0, self.TARGET_ALTITUDE - 0.05)
                if altitude < 0.3:
                    print(f"\n[DroneMedic] Mission complete! Final battery: {self.battery:.1f}%")
                    self.log_event("mission_complete", "Depot")
                    self.save_flight_log()
                    phase = "done"

            elif phase == "done":
                # Stop motors
                for motor in [self.front_left_motor, self.front_right_motor,
                              self.rear_left_motor, self.rear_right_motor]:
                    motor.setVelocity(0)
                break

            # ── Apply motor control ──
            self.apply_motors(roll, pitch, altitude, roll_acc, pitch_acc,
                              yaw_dist, pitch_dist)

        print("[DroneMedic] Controller exited")


# ── Entry point ──
robot = MavicDelivery()
robot.run()
