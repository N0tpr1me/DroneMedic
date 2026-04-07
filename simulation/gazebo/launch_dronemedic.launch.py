"""
DroneMedic ROS 2 Launch File — PX4 SITL + Gazebo + MAVROS + Telemetry Bridge

Orchestrates the full simulation stack for the DroneMedic project:
  1. PX4 SITL with Gazebo Harmonic (gz_x500 airframe)
  2. MAVROS node for MAVLink communication
  3. Telemetry WebSocket bridge (optional) for the web dashboard

Launch arguments:
  px4_dir        Path to PX4-Autopilot source (default: ~/PX4-Autopilot)
  headless       Run Gazebo without GUI (default: false)
  launch_bridge  Start the telemetry WebSocket bridge (default: true)

Usage:
  ros2 launch simulation/gazebo/launch_dronemedic.launch.py
  ros2 launch simulation/gazebo/launch_dronemedic.launch.py headless:=true
  ros2 launch simulation/gazebo/launch_dronemedic.launch.py launch_bridge:=false
"""

from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument, ExecuteProcess, TimerAction
from launch.conditions import IfCondition, UnlessCondition
from launch.substitutions import LaunchConfiguration
from launch_ros.actions import Node
import os


def generate_launch_description():
    # -- File resolution --
    # world_dir: directory containing this launch file (and dronemedic_world.sdf)
    world_dir = os.path.dirname(os.path.abspath(__file__))
    # project_dir: DroneMedic root, two levels up from simulation/gazebo/
    project_dir = os.path.abspath(os.path.join(world_dir, os.pardir, os.pardir))

    # -- Launch arguments --
    px4_dir_arg = DeclareLaunchArgument(
        "px4_dir",
        default_value=os.path.expanduser("~/PX4-Autopilot"),
        description="Path to PX4-Autopilot source directory",
    )

    headless_arg = DeclareLaunchArgument(
        "headless",
        default_value="false",
        description="Run Gazebo in headless mode (no GUI)",
    )

    launch_bridge_arg = DeclareLaunchArgument(
        "launch_bridge",
        default_value="true",
        description="Start the telemetry WebSocket bridge",
    )

    px4_dir = LaunchConfiguration("px4_dir")
    headless = LaunchConfiguration("headless")
    launch_bridge = LaunchConfiguration("launch_bridge")

    # -- Shared PX4 environment variables --
    # Depot coordinates matching config.py (same as launch_px4.sh / start_sim.sh)
    px4_common_env = {
        "PX4_HOME_LAT": "51.5074",
        "PX4_HOME_LON": "-0.1278",
        "PX4_HOME_ALT": "0",
        "PX4_GZ_WORLD": "dronemedic",
        "PX4_GZ_WORLD_PATH": world_dir,
        "GZ_SIM_RESOURCE_PATH": os.path.join(
            os.path.expanduser("~/PX4-Autopilot"),
            "Tools", "simulation", "gz", "models",
        ),
    }

    # Headless variant adds HEADLESS=1
    px4_headless_env = {**px4_common_env, "HEADLESS": "1"}

    # ----------------------------------------------------------------
    # 1. PX4 SITL via Gazebo Harmonic
    #    Two variants: GUI (default) and headless, gated by the headless arg.
    # ----------------------------------------------------------------
    px4_sitl_cmd = ["bash", "-c", ["cd ", px4_dir, " && make px4_sitl gz_x500"]]

    px4_sitl_gui = ExecuteProcess(
        cmd=px4_sitl_cmd,
        additional_env=px4_common_env,
        output="screen",
        condition=UnlessCondition(headless),
    )

    px4_sitl_headless = ExecuteProcess(
        cmd=px4_sitl_cmd,
        additional_env=px4_headless_env,
        output="screen",
        condition=IfCondition(headless),
    )

    # ----------------------------------------------------------------
    # 2. MAVROS — delayed 15 s to let PX4 finish initialization
    # ----------------------------------------------------------------
    mavros_node = TimerAction(
        period=15.0,
        actions=[
            Node(
                package="mavros",
                executable="mavros_node",
                parameters=[{
                    "fcu_url": "udp://:14540@",
                    "target_system_id": 1,
                    "target_component_id": 1,
                    "gcs_url": "",
                }],
                output="screen",
            ),
        ],
    )

    # ----------------------------------------------------------------
    # 3. Telemetry Bridge (optional) — delayed 20 s
    #    Gated by the launch_bridge argument so it can be disabled for
    #    standalone SITL testing without the web dashboard.
    # ----------------------------------------------------------------
    telemetry_bridge = TimerAction(
        period=20.0,
        actions=[
            ExecuteProcess(
                cmd=[
                    "python3",
                    os.path.join(project_dir, "simulation", "telemetry_bridge.py"),
                ],
                additional_env={
                    "PX4_CONNECTION": "udp://:14540",
                    "TELEMETRY_WS_PORT": "8765",
                },
                output="screen",
                condition=IfCondition(launch_bridge),
            ),
        ],
    )

    # ----------------------------------------------------------------
    # 4. Gazebo ↔ Unity ROS Bridge — delayed 25 s
    #    Subscribes to MAVROS topics and republishes on /dronemedic/*
    #    topics that Unity's ROSBridge.cs consumes.
    # ----------------------------------------------------------------
    gazebo_unity_bridge = TimerAction(
        period=25.0,
        actions=[
            ExecuteProcess(
                cmd=[
                    "python3",
                    os.path.join(project_dir, "simulation", "gazebo_unity_bridge.py"),
                ],
                output="screen",
                condition=IfCondition(launch_bridge),
            ),
        ],
    )

    # ----------------------------------------------------------------
    # 5. ROS-TCP-Endpoint — for Unity ROS-TCP-Connector communication
    #    Delayed 22 s, starts after MAVROS is up.
    #    Unity connects to this on port 10000.
    # ----------------------------------------------------------------
    ros_tcp_endpoint = TimerAction(
        period=22.0,
        actions=[
            Node(
                package="ros_tcp_endpoint",
                executable="default_server_endpoint",
                parameters=[{"ROS_IP": "0.0.0.0"}],
                output="screen",
                condition=IfCondition(launch_bridge),
            ),
        ],
    )

    # ----------------------------------------------------------------
    # Assemble launch description
    # ----------------------------------------------------------------
    return LaunchDescription([
        # Arguments
        px4_dir_arg,
        headless_arg,
        launch_bridge_arg,

        # PX4 SITL (exactly one fires based on headless arg)
        px4_sitl_gui,
        px4_sitl_headless,

        # MAVROS (delayed 15 s)
        mavros_node,

        # Telemetry bridge (delayed 20 s, gated by launch_bridge arg)
        telemetry_bridge,

        # ROS-TCP-Endpoint for Unity (delayed 22 s)
        ros_tcp_endpoint,

        # Gazebo ↔ Unity bridge (delayed 25 s)
        gazebo_unity_bridge,
    ])
