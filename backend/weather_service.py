"""
DroneMedic - Weather Service

Fetches weather data from OpenWeatherMap (real mode) or returns
simulated weather events (mock mode) for demo scenarios.
"""

import logging
from config import (
    OPENWEATHER_API_KEY, WEATHER_ENABLED,
    MAX_WIND_SPEED, MAX_PRECIPITATION, LOCATIONS,
)

logger = logging.getLogger("DroneMedic.Weather")

# Default clear weather
_CLEAR_WEATHER = {
    "wind_speed": 3.0,
    "precipitation": 0.0,
    "visibility": 10000,
    "temperature": 18.0,
    "alerts": [],
    "flyable": True,
    "description": "Clear skies",
}

# Simulated event templates
_WEATHER_EVENTS = {
    "storm": {
        "wind_speed": 22.0,
        "precipitation": 12.0,
        "visibility": 2000,
        "temperature": 10.0,
        "alerts": ["Severe thunderstorm warning"],
        "flyable": False,
        "description": "Severe storm — grounding all flights",
    },
    "high_wind": {
        "wind_speed": 18.0,
        "precipitation": 0.5,
        "visibility": 8000,
        "temperature": 15.0,
        "alerts": ["High wind advisory"],
        "flyable": False,
        "description": "High winds — unsafe for drone operations",
    },
    "light_rain": {
        "wind_speed": 5.0,
        "precipitation": 3.0,
        "visibility": 6000,
        "temperature": 14.0,
        "alerts": [],
        "flyable": True,
        "description": "Light rain — proceed with caution",
    },
    "clear": _CLEAR_WEATHER,
}

# Per-location weather overrides (for simulating localized weather)
_location_weather_overrides: dict[str, dict] = {}


def get_weather(lat: float, lon: float) -> dict:
    """
    Get weather conditions at a specific coordinate.

    In real mode (WEATHER_ENABLED=true + API key), calls OpenWeatherMap.
    In mock mode, returns clear weather unless an override is set.
    """
    if WEATHER_ENABLED and OPENWEATHER_API_KEY:
        return _fetch_real_weather(lat, lon)
    return _CLEAR_WEATHER.copy()


def get_weather_at_location(location_name: str) -> dict:
    """Get weather for a named location, checking overrides first."""
    if location_name in _location_weather_overrides:
        return _location_weather_overrides[location_name].copy()

    if location_name in LOCATIONS:
        loc = LOCATIONS[location_name]
        return get_weather(loc["lat"], loc["lon"])

    return _CLEAR_WEATHER.copy()


def simulate_weather_event(event_type: str, affected_locations: list[str] = None) -> dict:
    """
    Simulate a weather event for demo purposes.

    Args:
        event_type: One of "storm", "high_wind", "light_rain", "clear"
        affected_locations: Optional list of location names affected.
                          If provided, sets weather overrides for those locations.

    Returns:
        The weather event dict.
    """
    event = _WEATHER_EVENTS.get(event_type, _CLEAR_WEATHER).copy()

    if affected_locations:
        for loc_name in affected_locations:
            _location_weather_overrides[loc_name] = event
            logger.info(f"[WEATHER] {event_type} at {loc_name}: {event['description']}")
    else:
        logger.info(f"[WEATHER] Global event: {event['description']}")

    return event


def clear_weather_overrides():
    """Reset all simulated weather overrides."""
    _location_weather_overrides.clear()
    logger.info("[WEATHER] All weather overrides cleared")


def is_flyable(weather: dict) -> bool:
    """Check if weather conditions allow safe flight."""
    return (
        weather.get("wind_speed", 0) < MAX_WIND_SPEED
        and weather.get("precipitation", 0) < MAX_PRECIPITATION
    )


def get_all_location_weather() -> dict[str, dict]:
    """Get weather for all known locations (for dashboard display)."""
    result = {}
    for name in LOCATIONS:
        result[name] = get_weather_at_location(name)
    return result


def _fetch_real_weather(lat: float, lon: float) -> dict:
    """Fetch real weather from OpenWeatherMap API."""
    try:
        import requests
        from backend.utils.resilience import with_retry

        @with_retry(max_attempts=3, min_wait=1, max_wait=10)
        def _do_request():
            url = "https://api.openweathermap.org/data/2.5/weather"
            params = {
                "lat": lat,
                "lon": lon,
                "appid": OPENWEATHER_API_KEY,
                "units": "metric",
            }
            resp = requests.get(url, params=params, timeout=5)
            resp.raise_for_status()
            return resp

        resp = _do_request()
        data = resp.json()

        wind_speed = data.get("wind", {}).get("speed", 0)
        rain_1h = data.get("rain", {}).get("1h", 0)
        visibility = data.get("visibility", 10000)
        temp = data.get("main", {}).get("temp", 20)
        description = data.get("weather", [{}])[0].get("description", "unknown")

        weather = {
            "wind_speed": wind_speed,
            "precipitation": rain_1h,
            "visibility": visibility,
            "temperature": temp,
            "alerts": [],
            "flyable": wind_speed < MAX_WIND_SPEED and rain_1h < MAX_PRECIPITATION,
            "description": description,
        }
        return weather

    except Exception as e:
        logger.warning(f"[WEATHER] API call failed ({e}), using clear weather fallback")
        return _CLEAR_WEATHER.copy()


# --- Quick test ---
if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    print("=== Default weather (mock) ===")
    w = get_weather(51.5074, -0.1278)
    print(f"  {w}")

    print("\n=== Simulate storm at Clinic B ===")
    event = simulate_weather_event("storm", ["Clinic B"])
    print(f"  Event: {event}")
    print(f"  Clinic B weather: {get_weather_at_location('Clinic B')}")
    print(f"  Clinic A weather: {get_weather_at_location('Clinic A')}")

    print(f"\n=== Flyable checks ===")
    print(f"  Clear: {is_flyable(_CLEAR_WEATHER)}")
    print(f"  Storm: {is_flyable(event)}")

    clear_weather_overrides()
    print(f"\n=== After clear overrides ===")
    print(f"  Clinic B weather: {get_weather_at_location('Clinic B')}")
