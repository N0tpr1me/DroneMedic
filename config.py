"""
DroneMedic - Shared configuration and location registry.

All modules import locations and settings from here to ensure consistency.
"""

import os
from dotenv import load_dotenv

load_dotenv()

# --- API Keys ---
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "https://chat.kxsb.org/api/v1")
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

# --- Weather ---
OPENWEATHER_API_KEY = os.getenv("OPENWEATHER_API_KEY", "")
WEATHER_ENABLED = os.getenv("WEATHER_ENABLED", "false").lower() == "true"
MAX_WIND_SPEED = 15        # m/s — abort flight above this
MAX_PRECIPITATION = 5      # mm/h — reroute above this

# --- Battery ---
BATTERY_CAPACITY = 100     # percent
BATTERY_DRAIN_RATE = 0.08  # percent per meter traveled
BATTERY_MIN_RESERVE = 20   # must retain this % to return to depot

# --- No-Fly Zones (simplified polygons using AirSim x,y coords + lat/lon for map) ---
NO_FLY_ZONES = [
    {
        "name": "Military Zone Alpha",
        "polygon": [(-20, 80), (-20, 120), (30, 120), (30, 80)],
        "lat_lon": [
            (51.513, -0.132), (51.516, -0.132),
            (51.516, -0.126), (51.513, -0.126),
        ],
    },
    {
        "name": "Airport Exclusion",
        "polygon": [(120, -60), (120, -20), (180, -20), (180, -60)],
        "lat_lon": [
            (51.503, -0.115), (51.506, -0.115),
            (51.506, -0.108), (51.503, -0.108),
        ],
    },
]

# --- Multi-Drone ---
NUM_DRONES = 2
DRONE_NAMES = ["Drone1", "Drone2"]
