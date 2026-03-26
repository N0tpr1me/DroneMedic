"""
DroneMedic - Streamlit Dashboard

Interactive UI with map visualization, weather, no-fly zones,
battery tracking, and delivery metrics.
Run with: PYTHONPATH=. streamlit run frontend/dashboard.py
"""

import sys
import os
import time
import json
import logging

import streamlit as st
import folium
from streamlit_folium import st_folium

# Add project root to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config import LOCATIONS, PRIORITY_HIGH, NO_FLY_ZONES
from ai.task_parser import parse_delivery_request
from backend.route_planner import compute_route, recompute_route
from backend.weather_service import (
    get_weather_at_location, simulate_weather_event,
    clear_weather_overrides, get_all_location_weather, is_flyable,
)
from backend.geofence import check_route_safety, get_no_fly_zones
from backend.metrics import compute_metrics, compute_naive_baseline
from simulation.drone_control import DroneController
from simulation.obstacle_detector import check_for_obstacle, reset_obstacles

logging.basicConfig(level=logging.INFO, format="%(message)s")

# --- Page Config ---
st.set_page_config(page_title="DroneMedic", page_icon="🚁", layout="wide")
st.title("🚁 DroneMedic - AI Drone Delivery")

# --- Session State Init ---
defaults = {
    "task": None,
    "route": None,
    "original_route": None,
    "drone": None,
    "delivery_status": [],
    "delivery_complete": False,
    "current_stop_index": 0,
    "rerouted": False,
    "metrics": None,
    "weather_active": False,
    "obstacle_active": False,
}
for key, val in defaults.items():
    if key not in st.session_state:
        st.session_state[key] = val


# --- Helper Functions ---
def create_map(route=None, original_route=None, priorities=None, drone_location=None):
    """Create a Folium map with locations, routes, no-fly zones, and drone."""
    m = folium.Map(location=[51.508, -0.128], zoom_start=14)

    # Draw no-fly zones as red shaded polygons
    for zone in get_no_fly_zones():
        if zone.get("lat_lon"):
            folium.Polygon(
                locations=zone["lat_lon"],
                color="red",
                weight=2,
                fill=True,
                fill_color="red",
                fill_opacity=0.2,
                tooltip=f"No-Fly: {zone['name']}",
                popup=f"<b>🚫 {zone['name']}</b><br>Restricted airspace",
            ).add_to(m)

    # Add weather overlay markers
    all_weather = get_all_location_weather()
    for name, weather in all_weather.items():
        if name in LOCATIONS and not is_flyable(weather):
            loc = LOCATIONS[name]
            folium.CircleMarker(
                location=[loc["lat"], loc["lon"]],
                radius=25,
                color="purple",
                fill=True,
                fill_color="purple",
                fill_opacity=0.15,
                tooltip=f"⛈️ {weather['description']} (wind: {weather['wind_speed']}m/s)",
            ).add_to(m)

    # Add all known locations as markers
    for name, loc in LOCATIONS.items():
        if name == "Depot":
            icon = folium.Icon(color="green", icon="home", prefix="fa")
        elif priorities and priorities.get(name) == PRIORITY_HIGH:
            icon = folium.Icon(color="red", icon="exclamation-triangle", prefix="fa")
        else:
            icon = folium.Icon(color="blue", icon="hospital-o", prefix="fa")

        # Add weather info to popup
        w = all_weather.get(name, {})
        weather_info = f"<br>🌤️ {w.get('description', 'Clear')}" if w else ""
        folium.Marker(
            location=[loc["lat"], loc["lon"]],
            popup=f"<b>{name}</b><br>{loc.get('description', '')}{weather_info}",
            tooltip=name,
            icon=icon,
        ).add_to(m)

    # Draw original route (grey, dashed) if re-routed
    if original_route and route and original_route != route:
        original_coords = [
            [LOCATIONS[loc]["lat"], LOCATIONS[loc]["lon"]]
            for loc in original_route["ordered_route"]
            if loc in LOCATIONS
        ]
        folium.PolyLine(
            original_coords, color="grey", weight=2, opacity=0.5,
            dash_array="10", tooltip="Original route",
        ).add_to(m)

    # Draw current route
    if route:
        route_coords = [
            [LOCATIONS[loc]["lat"], LOCATIONS[loc]["lon"]]
            for loc in route["ordered_route"]
            if loc in LOCATIONS
        ]
        route_color = "orange" if original_route and original_route != route else "blue"
        folium.PolyLine(
            route_coords, color=route_color, weight=4, opacity=0.8,
            tooltip="Current route",
        ).add_to(m)

        for i, loc_name in enumerate(route["ordered_route"]):
            if loc_name in LOCATIONS and loc_name != "Depot":
                loc = LOCATIONS[loc_name]
                folium.CircleMarker(
                    location=[loc["lat"], loc["lon"]],
                    radius=12, color=route_color, fill=True,
                    fill_opacity=0.7, tooltip=f"Stop #{i}",
                ).add_to(m)

    # Draw drone position
    if drone_location and drone_location in LOCATIONS:
        loc = LOCATIONS[drone_location]
        folium.Marker(
            location=[loc["lat"], loc["lon"]],
            popup="<b>🚁 Drone</b>",
            tooltip="Drone (current)",
            icon=folium.DivIcon(
                html='<div style="font-size:24px;">🚁</div>',
                icon_size=(30, 30), icon_anchor=(15, 15),
            ),
        ).add_to(m)

    return m


def add_status(message: str):
    """Add a status message to the delivery log."""
    st.session_state.delivery_status.append(
        f"[{time.strftime('%H:%M:%S')}] {message}"
    )


# --- Sidebar ---
with st.sidebar:
    st.header("📋 Delivery Request")

    user_input = st.text_area(
        "Enter delivery request:",
        placeholder="e.g., Deliver insulin to Clinic A, blood to Clinic B urgently, and bandages to Clinic C",
        height=100,
    )

    col1, col2 = st.columns(2)
    with col1:
        plan_btn = st.button("🗺️ Plan Route", use_container_width=True)
    with col2:
        start_btn = st.button("🚀 Start Delivery", use_container_width=True)

    st.divider()

    st.header("⚡ Mid-Flight Actions")
    reroute_input = st.text_input(
        "New urgent delivery:",
        placeholder="e.g., Emergency blood to Clinic D",
    )
    reroute_btn = st.button("🔄 Add Urgent Delivery", use_container_width=True)

    st.divider()

    st.header("🌩️ Simulate Events")
    sim_col1, sim_col2 = st.columns(2)
    with sim_col1:
        storm_btn = st.button("⛈️ Storm", use_container_width=True)
    with sim_col2:
        obstacle_btn = st.button("🚧 Obstacle", use_container_width=True)

    if storm_btn:
        simulate_weather_event("storm", ["Clinic B"])
        st.session_state.weather_active = True
        add_status("⛈️ STORM simulated near Clinic B!")
        st.rerun()

    if obstacle_btn:
        st.session_state.obstacle_active = True
        add_status("🚧 OBSTACLE simulated near Clinic C!")
        st.rerun()

    # Clear weather button
    if st.session_state.weather_active:
        if st.button("☀️ Clear Weather", use_container_width=True):
            clear_weather_overrides()
            st.session_state.weather_active = False
            add_status("☀️ Weather cleared")
            st.rerun()

    st.divider()

    # Battery gauge
    if st.session_state.drone:
        battery = st.session_state.drone.get_battery()
        st.header("🔋 Battery")
        battery_color = "normal" if battery > 30 else "inverse" if battery > 15 else "off"
        st.progress(battery / 100.0)
        st.caption(f"{battery:.1f}% remaining")

    if st.button("🔄 Reset All", use_container_width=True):
        clear_weather_overrides()
        reset_obstacles()
        for key in list(st.session_state.keys()):
            del st.session_state[key]
        st.rerun()


# --- Plan Route ---
if plan_btn and user_input:
    with st.spinner("🤖 AI is parsing your request..."):
        try:
            task = parse_delivery_request(user_input)
            st.session_state.task = task
            add_status(f"AI parsed: {len(task['locations'])} locations identified")
        except Exception as e:
            st.error(f"Failed to parse request: {e}")
            st.stop()

    with st.spinner("🗺️ Computing optimal route..."):
        route = compute_route(task["locations"], task["priorities"])
        st.session_state.route = route
        st.session_state.original_route = route

        # Check geofence
        violations = check_route_safety(route["ordered_route"])
        if violations:
            for v in violations:
                add_status(f"⚠️ Route {v['from']}→{v['to']} near {v['zone']} (penalized)")

        add_status(f"Route computed: {' → '.join(route['ordered_route'])}")
        add_status(f"Battery estimate: {route.get('battery_usage', 'N/A')}%")

    st.rerun()

# --- Start Delivery ---
if start_btn and st.session_state.route:
    route = st.session_state.route
    task = st.session_state.task

    add_status("Initializing drone (mock mode)...")
    drone = DroneController(use_airsim=False)
    drone.connect()
    st.session_state.drone = drone

    add_status("Taking off from Depot...")
    drone.takeoff()
    reset_obstacles()

    reroute_count = 0
    reroute_successes = 0

    for i, waypoint in enumerate(route["ordered_route"]):
        if waypoint == "Depot" and i == 0:
            continue

        progress = i / max(len(route["ordered_route"]) - 1, 1)

        # Check for obstacle event
        if st.session_state.obstacle_active and progress >= 0.5:
            obstacle = check_for_obstacle(drone.get_position(), progress)
            if obstacle:
                add_status(f"🚧 OBSTACLE: {obstacle['description']}")
                st.session_state.obstacle_active = False

        drone.move_to(waypoint)
        st.session_state.current_stop_index = i

        if waypoint == "Depot":
            add_status("Returned to Depot")
        else:
            supply = task["supplies"].get(waypoint, "medical supplies") if task else "medical supplies"
            priority = task["priorities"].get(waypoint, "normal") if task else "normal"
            add_status(f"✅ Delivered {supply} to {waypoint} (priority: {priority})")

    drone.land()
    st.session_state.delivery_complete = True
    add_status(f"🎉 All deliveries complete! Battery: {drone.get_battery():.1f}%")

    # Compute metrics
    all_locations = task["locations"] if task else []
    metrics = compute_metrics(
        flight_log=drone.get_flight_log(),
        optimized_route=route,
        locations=all_locations,
        reroute_count=reroute_count,
        reroute_successes=reroute_successes,
    )
    st.session_state.metrics = metrics

    st.rerun()

# --- Re-route ---
if reroute_btn and reroute_input and st.session_state.route:
    with st.spinner("🤖 Parsing new delivery request..."):
        try:
            new_task = parse_delivery_request(reroute_input)
        except Exception as e:
            st.error(f"Failed to parse: {e}")
            st.stop()

    current_route = st.session_state.route
    current_loc = "Depot"
    if st.session_state.drone:
        current_loc = st.session_state.drone.get_current_location()

    idx = st.session_state.current_stop_index
    remaining = current_route["ordered_route"][idx + 1:]
    remaining = [loc for loc in remaining if loc != "Depot"]

    merged_priorities = {}
    if st.session_state.task:
        merged_priorities.update(st.session_state.task.get("priorities", {}))
    merged_priorities.update(new_task.get("priorities", {}))

    with st.spinner("🔄 Recomputing route..."):
        new_route = recompute_route(
            current_location=current_loc,
            remaining_locations=remaining,
            new_locations=new_task["locations"],
            priorities=merged_priorities,
        )
        if not st.session_state.rerouted:
            st.session_state.original_route = st.session_state.route
        st.session_state.route = new_route
        st.session_state.rerouted = True

        if st.session_state.task:
            st.session_state.task["locations"].extend(new_task["locations"])
            st.session_state.task["priorities"].update(new_task.get("priorities", {}))
            st.session_state.task["supplies"].update(new_task.get("supplies", {}))

        add_status(f"⚡ REROUTED! New route: {' → '.join(new_route['ordered_route'])}")

    st.rerun()


# --- Main Content Area ---
tab_map, tab_metrics, tab_log = st.tabs(["🗺️ Map", "📊 Metrics", "📝 Flight Log"])

with tab_map:
    priorities = st.session_state.task.get("priorities", {}) if st.session_state.task else {}
    drone_loc = None
    if st.session_state.drone:
        drone_loc = st.session_state.drone.get_current_location()

    col_map, col_info = st.columns([2, 1])

    with col_map:
        m = create_map(
            route=st.session_state.route,
            original_route=st.session_state.original_route if st.session_state.rerouted else None,
            priorities=priorities,
            drone_location=drone_loc,
        )
        st_folium(m, width=700, height=500)

    with col_info:
        # Task details
        if st.session_state.task:
            st.subheader("📦 Parsed Task")
            st.json(st.session_state.task)

        # Route details
        if st.session_state.route:
            st.subheader("🗺️ Route")
            route = st.session_state.route
            for i, loc in enumerate(route["ordered_route"]):
                if loc == "Depot":
                    marker = "🏠"
                elif st.session_state.task and st.session_state.task.get("priorities", {}).get(loc) == PRIORITY_HIGH:
                    marker = "🔴"
                else:
                    marker = "🔵"
                st.write(f"{marker} {i}. {loc}")

            st.caption(
                f"Distance: {route['total_distance']} | "
                f"Time: {route['estimated_time']}s | "
                f"Battery: {route.get('battery_usage', 'N/A')}%"
            )

        # Weather status
        if st.session_state.weather_active:
            st.warning("⛈️ Active storm near Clinic B")

        if st.session_state.delivery_complete:
            st.success("All deliveries completed!")

        # Status log (compact)
        if st.session_state.delivery_status:
            st.subheader("Recent Status")
            for msg in reversed(st.session_state.delivery_status[-8:]):
                st.text(msg)

with tab_metrics:
    if st.session_state.metrics:
        met = st.session_state.metrics

        st.subheader("📊 Delivery Performance")

        col_m1, col_m2, col_m3, col_m4 = st.columns(4)
        with col_m1:
            st.metric("Deliveries", met["throughput"])
        with col_m2:
            st.metric("Distance Saved", f"{met['distance_reduction']}%")
        with col_m3:
            st.metric("Time Saved", f"{met['delivery_time_reduction']}%")
        with col_m4:
            st.metric("Battery Used", f"{met['battery_used']}%")

        col_m5, col_m6, col_m7, col_m8 = st.columns(4)
        with col_m5:
            st.metric("Reroute Success", f"{met['reroute_success_rate']}%")
        with col_m6:
            st.metric("Robustness", f"{met['robustness_score']}")
        with col_m7:
            st.metric("Optimized Dist", f"{met['total_distance_optimized']}m")
        with col_m8:
            st.metric("Naive Dist", f"{met['total_distance_naive']}m")

        st.divider()

        st.subheader("Optimized vs Naive Comparison")
        comparison_data = {
            "Metric": ["Distance (m)", "Est. Time (s)"],
            "Optimized": [met["total_distance_optimized"], met["estimated_time_seconds"]],
            "Naive": [met["total_distance_naive"], met["naive_time_seconds"]],
            "Improvement": [
                f"{met['distance_reduction']}%",
                f"{met['delivery_time_reduction']}%",
            ],
        }
        st.table(comparison_data)
    else:
        st.info("Complete a delivery to see performance metrics.")

with tab_log:
    if st.session_state.drone:
        flight_log = st.session_state.drone.get_flight_log()
        if flight_log:
            st.subheader("📝 Full Flight Log")
            for entry in flight_log:
                battery_str = f" | 🔋 {entry.get('battery', 'N/A'):.1f}%" if isinstance(entry.get('battery'), (int, float)) else ""
                st.text(
                    f"{entry['event']:25s} @ {entry['location']}{battery_str}"
                )
        else:
            st.info("No flight data yet. Start a delivery to see the log.")
    else:
        st.info("No flight data yet. Start a delivery to see the log.")

    # No-fly zone info
    st.subheader("🚫 No-Fly Zones")
    for zone in get_no_fly_zones():
        st.write(f"**{zone['name']}** — shown as red area on map")
