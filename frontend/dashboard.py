"""
DroneMedic - Streamlit Dashboard

Interactive UI with map visualization for drone delivery management.
Run with: streamlit run frontend/dashboard.py
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

from config import LOCATIONS, PRIORITY_HIGH
from ai.task_parser import parse_delivery_request
from backend.route_planner import compute_route, recompute_route
from simulation.drone_control import DroneController

logging.basicConfig(level=logging.INFO, format="%(message)s")

# --- Page Config ---
st.set_page_config(page_title="DroneMedic", page_icon="🚁", layout="wide")
st.title("🚁 DroneMedic - AI Drone Delivery")

# --- Session State Init ---
if "task" not in st.session_state:
    st.session_state.task = None
if "route" not in st.session_state:
    st.session_state.route = None
if "original_route" not in st.session_state:
    st.session_state.original_route = None
if "drone" not in st.session_state:
    st.session_state.drone = None
if "delivery_status" not in st.session_state:
    st.session_state.delivery_status = []
if "delivery_complete" not in st.session_state:
    st.session_state.delivery_complete = False
if "current_stop_index" not in st.session_state:
    st.session_state.current_stop_index = 0
if "rerouted" not in st.session_state:
    st.session_state.rerouted = False


# --- Helper Functions ---
def create_map(route=None, original_route=None, priorities=None, drone_location=None):
    """Create a Folium map with locations, route, and drone position."""
    # Center on London (matches our simulated coords)
    m = folium.Map(location=[51.508, -0.128], zoom_start=14)

    # Add all known locations as markers
    for name, loc in LOCATIONS.items():
        if name == "Depot":
            icon = folium.Icon(color="green", icon="home", prefix="fa")
        elif priorities and priorities.get(name) == PRIORITY_HIGH:
            icon = folium.Icon(color="red", icon="exclamation-triangle", prefix="fa")
        else:
            icon = folium.Icon(color="blue", icon="hospital-o", prefix="fa")

        folium.Marker(
            location=[loc["lat"], loc["lon"]],
            popup=f"<b>{name}</b><br>{loc.get('description', '')}",
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
            original_coords,
            color="grey",
            weight=2,
            opacity=0.5,
            dash_array="10",
            tooltip="Original route",
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
            route_coords,
            color=route_color,
            weight=4,
            opacity=0.8,
            tooltip="Current route",
        ).add_to(m)

        # Add numbered markers for route order
        for i, loc_name in enumerate(route["ordered_route"]):
            if loc_name in LOCATIONS and loc_name != "Depot":
                loc = LOCATIONS[loc_name]
                folium.CircleMarker(
                    location=[loc["lat"], loc["lon"]],
                    radius=12,
                    color=route_color,
                    fill=True,
                    fill_opacity=0.7,
                    tooltip=f"Stop #{i}",
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
                icon_size=(30, 30),
                icon_anchor=(15, 15),
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
    if st.button("🔄 Reset", use_container_width=True):
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
        add_status(f"Route computed: {' → '.join(route['ordered_route'])}")

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

    for i, waypoint in enumerate(route["ordered_route"]):
        if waypoint == "Depot" and i == 0:
            continue  # Skip starting depot

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
    add_status("🎉 All deliveries complete! Drone has landed.")
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

    # Determine remaining locations
    idx = st.session_state.current_stop_index
    remaining = current_route["ordered_route"][idx + 1:]
    remaining = [loc for loc in remaining if loc != "Depot"]

    # Merge priorities
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
        # Keep original for overlay
        if not st.session_state.rerouted:
            st.session_state.original_route = st.session_state.route
        st.session_state.route = new_route
        st.session_state.rerouted = True

        # Merge task info
        if st.session_state.task:
            st.session_state.task["locations"].extend(new_task["locations"])
            st.session_state.task["priorities"].update(new_task.get("priorities", {}))
            st.session_state.task["supplies"].update(new_task.get("supplies", {}))

        add_status(f"⚡ REROUTED! New route: {' → '.join(new_route['ordered_route'])}")

    st.rerun()

# --- Main Content Area ---
col_map, col_info = st.columns([2, 1])

with col_map:
    st.subheader("Delivery Map")
    priorities = st.session_state.task.get("priorities", {}) if st.session_state.task else {}
    drone_loc = None
    if st.session_state.drone:
        drone_loc = st.session_state.drone.get_current_location()

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
        st.caption(f"Total distance: {route['total_distance']} | Est. time: {route['estimated_time']}s")

    # Delivery status log
    if st.session_state.delivery_status:
        st.subheader("📝 Status Log")
        for msg in reversed(st.session_state.delivery_status[-15:]):
            st.text(msg)

    if st.session_state.delivery_complete:
        st.success("All deliveries completed!")
