"""
DroneMedic — Gazebo ↔ Unity ROS 2 Bridge Node

Bridges MAVROS telemetry and Gazebo world state to /dronemedic/* ROS topics
that Unity's ROSBridge.cs subscribes to.

Publishes:
  /dronemedic/drone_pose       — Drone GPS position, heading, battery, flight mode (10 Hz)
  /dronemedic/world/buildings   — Static building locations from Gazebo world (once at startup)
  /dronemedic/world/nofly_zones — No-fly zone polygons (once at startup)
  /dronemedic/gazebo/obstacles  — Dynamic obstacle events (on change)
  /dronemedic/gazebo/weather    — Wind/atmosphere data from Gazebo (1 Hz)

Subscribes to (from MAVROS):
  /mavros/global_position/global — GPS position
  /mavros/battery                — Battery state
  /mavros/state                  — Flight mode, arming status
  /mavros/local_position/velocity_local — Velocity for speed calculation
  /mavros/imu/data               — IMU for heading

Usage:
  ros2 run simulation gazebo_unity_bridge
  # or directly:
  python3 simulation/gazebo_unity_bridge.py
"""

import json
import math
import rclpy
from rclpy.node import Node
from rclpy.qos import QoSProfile, ReliabilityPolicy, DurabilityPolicy
from std_msgs.msg import String
from sensor_msgs.msg import NavSatFix, BatteryState, Imu
from geometry_msgs.msg import TwistStamped
from mavros_msgs.msg import State


# -- Gazebo world data (parsed from dronemedic_world.sdf) --
# These match the SDF exactly so Unity can reconstruct the Gazebo world

BUILDINGS = [
    {"name": "Depot",             "lat": 51.5074, "lon": -0.1278, "east": 0,     "north": 0,    "width": 10, "depth": 10, "height": 6,  "color": [0.2, 0.3, 0.8]},
    {"name": "Clinic A",          "lat": 51.5124, "lon": -0.1200, "east": 542,   "north": 556,  "width": 8,  "depth": 8,  "height": 5,  "color": [0.9, 0.2, 0.2]},
    {"name": "Clinic B",          "lat": 51.5174, "lon": -0.1350, "east": -501,  "north": 1112, "width": 8,  "depth": 8,  "height": 5,  "color": [0.9, 0.5, 0.5]},
    {"name": "Clinic C",          "lat": 51.5044, "lon": -0.1100, "east": 1237,  "north": -334, "width": 8,  "depth": 8,  "height": 4,  "color": [0.3, 0.7, 0.3]},
    {"name": "Clinic D",          "lat": 51.5000, "lon": -0.1400, "east": -848,  "north": -823, "width": 8,  "depth": 8,  "height": 4,  "color": [0.9, 0.6, 0.2]},
    {"name": "Royal London",      "lat": 51.5185, "lon": -0.0590, "east": 4783,  "north": 1234, "width": 20, "depth": 15, "height": 12, "color": [0.95, 0.95, 0.95]},
    {"name": "Homerton",          "lat": 51.5468, "lon": -0.0456, "east": 5715,  "north": 4381, "width": 15, "depth": 12, "height": 10, "color": [0.95, 0.95, 0.95]},
    {"name": "Newham General",    "lat": 51.5155, "lon":  0.0285, "east": 10860, "north": 900,  "width": 15, "depth": 12, "height": 10, "color": [0.95, 0.95, 0.95]},
    {"name": "Whipps Cross",      "lat": 51.5690, "lon":  0.0066, "east": 9337,  "north": 6850, "width": 15, "depth": 12, "height": 10, "color": [0.95, 0.95, 0.95]},
]

NO_FLY_ZONES = [
    {
        "name": "Military Zone Alpha",
        "center_east": -209, "center_north": 500,
        "width": 417, "depth": 334,
        "corners_gps": [
            {"lat": 51.513, "lon": -0.132},
            {"lat": 51.513, "lon": -0.126},
            {"lat": 51.516, "lon": -0.126},
            {"lat": 51.516, "lon": -0.132},
        ],
    },
    {
        "name": "Airport Exclusion",
        "center_east": 1132, "center_north": -390,
        "width": 487, "depth": 334,
        "corners_gps": [
            {"lat": 51.503, "lon": -0.115},
            {"lat": 51.503, "lon": -0.108},
            {"lat": 51.506, "lon": -0.108},
            {"lat": 51.506, "lon": -0.115},
        ],
    },
]


class GazeboUnityBridge(Node):
    """ROS 2 node that bridges MAVROS + Gazebo world state to Unity."""

    def __init__(self) -> None:
        super().__init__("gazebo_unity_bridge")
        self.get_logger().info("Starting Gazebo ↔ Unity bridge node")

        # -- State cache --
        self._lat = 0.0
        self._lon = 0.0
        self._alt_m = 0.0
        self._relative_alt_m = 0.0
        self._battery_pct = 100.0
        self._flight_mode = "UNKNOWN"
        self._is_armed = False
        self._heading_deg = 0.0
        self._speed_m_s = 0.0

        # -- QoS profiles --
        sensor_qos = QoSProfile(
            reliability=ReliabilityPolicy.BEST_EFFORT,
            durability=DurabilityPolicy.VOLATILE,
            depth=10,
        )
        reliable_qos = QoSProfile(
            reliability=ReliabilityPolicy.RELIABLE,
            durability=DurabilityPolicy.TRANSIENT_LOCAL,
            depth=10,
        )

        # -- Publishers (to Unity via ROS-TCP-Connector) --
        self._pub_drone_pose = self.create_publisher(String, "/dronemedic/drone_pose", 10)
        self._pub_buildings = self.create_publisher(String, "/dronemedic/world/buildings", reliable_qos)
        self._pub_nofly = self.create_publisher(String, "/dronemedic/world/nofly_zones", reliable_qos)
        self._pub_obstacles = self.create_publisher(String, "/dronemedic/gazebo/obstacles", 10)
        self._pub_weather = self.create_publisher(String, "/dronemedic/gazebo/weather", 10)

        # -- Subscribers (from MAVROS) --
        self.create_subscription(NavSatFix, "/mavros/global_position/global", self._on_gps, sensor_qos)
        self.create_subscription(BatteryState, "/mavros/battery", self._on_battery, sensor_qos)
        self.create_subscription(State, "/mavros/state", self._on_state, 10)
        self.create_subscription(TwistStamped, "/mavros/local_position/velocity_local", self._on_velocity, sensor_qos)
        self.create_subscription(Imu, "/mavros/imu/data", self._on_imu, sensor_qos)

        # -- Timers --
        self.create_timer(0.1, self._publish_drone_pose)   # 10 Hz pose
        self.create_timer(1.0, self._publish_weather)       # 1 Hz weather

        # -- Publish static world data once after 2 seconds --
        self.create_timer(2.0, self._publish_world_once)
        self._world_published = False

        self.get_logger().info("Bridge ready — waiting for MAVROS topics")

    # -- MAVROS Callbacks --

    def _on_gps(self, msg: NavSatFix) -> None:
        self._lat = msg.latitude
        self._lon = msg.longitude
        self._alt_m = msg.altitude
        # Compute relative altitude from home (51.5074 is ~0m elevation)
        self._relative_alt_m = max(0.0, msg.altitude)

    def _on_battery(self, msg: BatteryState) -> None:
        if msg.percentage >= 0:
            self._battery_pct = msg.percentage * 100.0
        elif msg.voltage > 0:
            # Estimate from voltage (4S LiPo: 16.8V full, 13.2V empty)
            self._battery_pct = max(0.0, min(100.0, (msg.voltage - 13.2) / (16.8 - 13.2) * 100.0))

    def _on_state(self, msg: State) -> None:
        self._flight_mode = msg.mode
        self._is_armed = msg.armed

    def _on_velocity(self, msg: TwistStamped) -> None:
        vx = msg.twist.linear.x
        vy = msg.twist.linear.y
        self._speed_m_s = math.sqrt(vx * vx + vy * vy)

    def _on_imu(self, msg: Imu) -> None:
        # Extract heading from quaternion
        q = msg.orientation
        siny_cosp = 2.0 * (q.w * q.z + q.x * q.y)
        cosy_cosp = 1.0 - 2.0 * (q.y * q.y + q.z * q.z)
        yaw_rad = math.atan2(siny_cosp, cosy_cosp)
        self._heading_deg = math.degrees(yaw_rad) % 360.0

    # -- Publishers --

    def _publish_drone_pose(self) -> None:
        """Publish drone pose at 10 Hz — Unity subscribes to drive DroneController."""
        data = {
            "type": "drone_pose",
            "lat": round(self._lat, 7),
            "lon": round(self._lon, 7),
            "alt_m": round(self._alt_m, 2),
            "relative_alt_m": round(self._relative_alt_m, 2),
            "battery_pct": round(self._battery_pct, 1),
            "flight_mode": self._flight_mode,
            "is_armed": self._is_armed,
            "heading_deg": round(self._heading_deg, 1),
            "speed_m_s": round(self._speed_m_s, 2),
        }
        msg = String()
        msg.data = json.dumps(data)
        self._pub_drone_pose.publish(msg)

    def _publish_world_once(self) -> None:
        """Publish Gazebo world static data once so Unity can render buildings + NFZs."""
        if self._world_published:
            return
        self._world_published = True

        # Buildings
        buildings_msg = String()
        buildings_msg.data = json.dumps({"type": "buildings", "buildings": BUILDINGS})
        self._pub_buildings.publish(buildings_msg)
        self.get_logger().info(f"Published {len(BUILDINGS)} buildings to Unity")

        # No-fly zones
        nofly_msg = String()
        nofly_msg.data = json.dumps({"type": "nofly_zones", "zones": NO_FLY_ZONES})
        self._pub_nofly.publish(nofly_msg)
        self.get_logger().info(f"Published {len(NO_FLY_ZONES)} no-fly zones to Unity")

    def _publish_weather(self) -> None:
        """Publish Gazebo atmosphere/wind data at 1 Hz."""
        # TODO: read from Gazebo atmosphere plugin when available
        # For now publish default clear weather
        data = {
            "type": "gazebo_weather",
            "wind_speed_ms": 3.0,
            "wind_direction_deg": 270.0,
            "precipitation_mm_h": 0.0,
            "visibility_km": 10.0,
            "temperature_c": 15.0,
        }
        msg = String()
        msg.data = json.dumps(data)
        self._pub_weather.publish(msg)

    # -- Public API for dynamic obstacles --

    def publish_obstacle(self, obstacle_type: str, near_location: str, description: str) -> None:
        """Call this to inject a dynamic obstacle event into Unity."""
        data = {
            "type": "gazebo_obstacle",
            "obstacle_type": obstacle_type,
            "near_location": near_location,
            "description": description,
        }
        msg = String()
        msg.data = json.dumps(data)
        self._pub_obstacles.publish(msg)
        self.get_logger().info(f"Obstacle published: {obstacle_type} near {near_location}")


def main(args=None) -> None:
    rclpy.init(args=args)
    node = GazeboUnityBridge()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        node.get_logger().info("Bridge shutting down")
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == "__main__":
    main()
