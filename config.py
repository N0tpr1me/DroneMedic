"""
DroneMedic - Shared configuration and location registry.

All modules import locations and settings from here to ensure consistency.
"""

import os
from dotenv import load_dotenv

load_dotenv()

# --- API Keys ---
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
AIRSIM_ENABLED = os.getenv("AIRSIM_ENABLED", "false").lower() == "true"

# --- Drone Settings ---
DRONE_VELOCITY = 5          # m/s movement speed
DRONE_ALTITUDE = -30        # AirSim uses NED (negative = up)
MOCK_MOVE_DELAY = 1.5       # seconds to simulate movement in mock mode

# --- Predefined Locations ---
# Each location has AirSim coords (x, y, z) and map coords (lat, lon)
LOCATIONS = {
    "Depot": {
        "x": 0, "y": 0, "z": -30,
        "lat": 51.5074, "lon": -0.1278,
        "description": "Main drone depot / base station",
    },
    "Clinic A": {
        "x": 100, "y": 50, "z": -30,
        "lat": 51.5124, "lon": -0.1200,
        "description": "General medical clinic",
    },
    "Clinic B": {
        "x": -50, "y": 150, "z": -30,
        "lat": 51.5174, "lon": -0.1350,
        "description": "Emergency care facility",
    },
    "Clinic C": {
        "x": 200, "y": -30, "z": -30,
        "lat": 51.5044, "lon": -0.1100,
        "description": "Rural health outpost",
    },
    "Clinic D": {
        "x": -100, "y": -80, "z": -30,
        "lat": 51.5000, "lon": -0.1400,
        "description": "Disaster relief camp",
    },
}

# --- Valid Location Names (for AI parser validation) ---
VALID_LOCATIONS = list(LOCATIONS.keys())

# --- Priority Levels ---
PRIORITY_HIGH = "high"
PRIORITY_NORMAL = "normal"

# --- Priority Weight Multiplier ---
# Lower = solver treats high-priority destinations as "closer" (visited earlier)
PRIORITY_WEIGHT = 0.3
