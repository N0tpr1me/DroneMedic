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

# --- Supabase ---
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("VITE_SUPABASE_ANON_KEY", "")

# --- PX4 SITL ---
PX4_ENABLED = os.getenv("PX4_ENABLED", "false").lower() == "true"
PX4_CONNECTION = os.getenv("PX4_CONNECTION", "udp://:14540")
PX4_ALTITUDE_M = 30.0
PX4_HOME_LAT = 51.5074   # Must match Depot lat
PX4_HOME_LON = -0.1278   # Must match Depot lon

# --- Google Maps ---
GOOGLE_MAPS_API_KEY = os.getenv("GOOGLE_MAPS_API_KEY", "")

# --- Drone Specifications ---
DRONE_EMPTY_WEIGHT_KG = 2.5
DRONE_MAX_PAYLOAD_KG = 5.0
DRONE_CRUISE_SPEED_MS = 15.0   # m/s (~54 km/h)
DRONE_MAX_ALTITUDE_M = 120.0   # UK air law
BATTERY_DRAIN_RATE_BASE = 0.08      # % per meter (empty drone)
BATTERY_DRAIN_RATE_PER_KG = 0.015   # additional % per meter per kg payload

# --- Medical Supply Weights (kg) ---
SUPPLY_WEIGHTS = {
    "blood_pack": 0.5,
    "vaccine_kit": 0.3,
    "defibrillator": 2.0,
    "first_aid": 1.0,
    "medication": 0.2,
    "insulin": 0.1,
    "antivenom": 0.4,
    "surgical_kit": 1.5,
    "oxygen_tank": 3.0,
}

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
    "Royal London": {
        "x": 100, "y": 50, "z": -30,
        "lat": 51.5185, "lon": -0.0590,
        "description": "Royal London Hospital — Major trauma centre",
    },
    "Homerton": {
        "x": -50, "y": 150, "z": -30,
        "lat": 51.5468, "lon": -0.0456,
        "description": "Homerton Hospital — Urgent care facility",
    },
    "Newham General": {
        "x": 200, "y": -30, "z": -30,
        "lat": 51.5155, "lon": 0.0285,
        "description": "Newham General Hospital — Trauma kit resupply",
    },
    "Whipps Cross": {
        "x": -100, "y": -80, "z": -30,
        "lat": 51.5690, "lon": 0.0066,
        "description": "Whipps Cross Hospital — Cardiac unit",
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
