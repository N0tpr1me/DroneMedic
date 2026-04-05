"""DroneMedic — Payload status physics.

Simulates temperature drift and integrity for medical payloads
based on payload type, elapsed time, and environmental conditions.
"""

from __future__ import annotations

# Payload thermal profiles
_PROFILES = {
    "blood": {"safe_min": 2.0, "safe_max": 6.0, "max_time": 240, "base_temp": 4.0, "drift": 0.005},
    "blood_pack": {"safe_min": 2.0, "safe_max": 6.0, "max_time": 240, "base_temp": 4.0, "drift": 0.005},
    "insulin": {"safe_min": 2.0, "safe_max": 8.0, "max_time": 480, "base_temp": 5.0, "drift": 0.003},
    "vaccine_kit": {"safe_min": 2.0, "safe_max": 8.0, "max_time": 360, "base_temp": 4.0, "drift": 0.004},
    "antivenom": {"safe_min": 2.0, "safe_max": 8.0, "max_time": 300, "base_temp": 5.0, "drift": 0.004},
}
_DEFAULT = {"safe_min": 15.0, "safe_max": 25.0, "max_time": 600, "base_temp": 20.0, "drift": 0.002}


def compute_payload_status(
    payload_type: str = "blood",
    elapsed_minutes: float = 0.0,
    wind_speed: float = 0.0,
) -> dict:
    """
    Compute current payload temperature and integrity.

    Returns:
        {temperature_c, integrity, time_remaining_minutes, payload_type}
    """
    profile = _PROFILES.get(payload_type, _DEFAULT)

    wind_factor = 2.0 if wind_speed > 15 else 1.0
    temp = profile["base_temp"] + (profile["drift"] * elapsed_minutes * wind_factor)

    safe_min, safe_max = profile["safe_min"], profile["safe_max"]
    if temp < safe_min or temp > safe_max:
        integrity = "compromised"
    elif temp < (safe_min + 1.0) or temp > (safe_max - 1.0):
        integrity = "warning"
    else:
        integrity = "nominal"

    remaining = max(0, profile["max_time"] - elapsed_minutes)

    return {
        "temperature_c": round(temp, 1),
        "integrity": integrity,
        "time_remaining_minutes": round(remaining, 1),
        "payload_type": payload_type,
    }
