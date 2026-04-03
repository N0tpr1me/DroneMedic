"""
Generate 365 days of synthetic medical emergency data using Poisson processes.

Encodes realistic temporal patterns:
- Cardiac events peak 6-10 AM
- Trauma peaks at night (10 PM - 3 AM)
- Respiratory emergencies increase in cold weather
- Surge during holidays and special events
- Weekend effect (different demand profile)

Output: data/synthetic_emergencies.csv (~40K-60K rows)
"""

import csv
import os
import random
import math
from datetime import datetime, timedelta
from typing import NamedTuple

# ---------------------------------------------------------------------------
# Locations (mirrors config.py)
# ---------------------------------------------------------------------------

LOCATIONS = {
    "Depot":    {"lat": 51.5074, "lon": -0.1278},
    "Clinic A": {"lat": 51.5124, "lon": -0.1200},
    "Clinic B": {"lat": 51.5174, "lon": -0.1350},
    "Clinic C": {"lat": 51.5044, "lon": -0.1100},
    "Clinic D": {"lat": 51.5000, "lon": -0.1400},
}

# ---------------------------------------------------------------------------
# Emergency types and their hourly rate multipliers (24-element arrays)
# ---------------------------------------------------------------------------

EMERGENCY_TYPES = {
    "cardiac": {
        "base_rate": 1.4,
        # Peaks 6-10 AM
        "hourly_mult": [
            0.4, 0.3, 0.3, 0.3, 0.5, 0.8,   # 00-05
            1.8, 2.2, 2.4, 2.0, 1.5, 1.2,     # 06-11
            1.0, 0.9, 0.8, 0.8, 0.9, 1.0,     # 12-17
            0.9, 0.8, 0.7, 0.6, 0.5, 0.4,     # 18-23
        ],
        "cold_mult": 1.3,
        "severity_weights": [0.05, 0.10, 0.25, 0.35, 0.25],
    },
    "trauma": {
        "base_rate": 1.2,
        # Peaks 10 PM - 3 AM
        "hourly_mult": [
            1.8, 2.0, 1.6, 1.4, 0.8, 0.5,     # 00-05
            0.4, 0.4, 0.5, 0.5, 0.6, 0.7,     # 06-11
            0.8, 0.8, 0.9, 1.0, 1.0, 1.1,     # 12-17
            1.2, 1.3, 1.5, 1.7, 2.0, 2.2,     # 18-23
        ],
        "cold_mult": 0.9,
        "severity_weights": [0.10, 0.15, 0.25, 0.30, 0.20],
    },
    "respiratory": {
        "base_rate": 1.0,
        # Fairly even with slight morning peak
        "hourly_mult": [
            0.6, 0.5, 0.5, 0.5, 0.6, 0.7,
            1.0, 1.2, 1.3, 1.2, 1.1, 1.0,
            1.0, 1.0, 1.0, 1.1, 1.1, 1.0,
            0.9, 0.8, 0.7, 0.7, 0.6, 0.6,
        ],
        "cold_mult": 2.0,  # Strong cold-weather effect
        "severity_weights": [0.10, 0.20, 0.30, 0.25, 0.15],
    },
    "allergic_reaction": {
        "base_rate": 0.6,
        "hourly_mult": [
            0.4, 0.3, 0.3, 0.3, 0.3, 0.5,
            0.8, 1.0, 1.2, 1.3, 1.4, 1.5,
            1.5, 1.4, 1.3, 1.2, 1.1, 1.0,
            0.8, 0.7, 0.6, 0.5, 0.4, 0.4,
        ],
        "cold_mult": 0.7,
        "severity_weights": [0.15, 0.25, 0.30, 0.20, 0.10],
    },
    "diabetic_emergency": {
        "base_rate": 0.5,
        "hourly_mult": [
            0.7, 0.6, 0.5, 0.5, 0.5, 0.6,
            1.0, 1.3, 1.2, 1.0, 1.0, 1.1,
            1.2, 1.1, 1.0, 1.0, 1.1, 1.2,
            1.3, 1.2, 1.0, 0.9, 0.8, 0.7,
        ],
        "cold_mult": 1.0,
        "severity_weights": [0.10, 0.20, 0.35, 0.25, 0.10],
    },
}

# ---------------------------------------------------------------------------
# Location demand weights (some clinics are busier)
# ---------------------------------------------------------------------------

LOCATION_WEIGHTS = {
    "Depot":    0.10,   # Low — mostly a base, few direct emergencies
    "Clinic A": 0.25,
    "Clinic B": 0.30,   # Emergency care facility — busiest
    "Clinic C": 0.15,
    "Clinic D": 0.20,   # Disaster relief camp
}

# ---------------------------------------------------------------------------
# Holidays & events (UK-centric + some universal)
# ---------------------------------------------------------------------------

HOLIDAYS_2025 = {
    datetime(2025, 1, 1),    # New Year's Day
    datetime(2025, 4, 18),   # Good Friday
    datetime(2025, 4, 21),   # Easter Monday
    datetime(2025, 5, 5),    # Early May bank holiday
    datetime(2025, 5, 26),   # Spring bank holiday
    datetime(2025, 8, 25),   # Summer bank holiday
    datetime(2025, 12, 25),  # Christmas Day
    datetime(2025, 12, 26),  # Boxing Day
}

# Special events that cause demand surges (date -> multiplier)
EVENTS_2025 = {
    datetime(2025, 6, 28): 1.8,   # Summer festival
    datetime(2025, 6, 29): 1.8,
    datetime(2025, 7, 4): 1.5,    # Large public gathering
    datetime(2025, 8, 10): 1.6,   # Sporting event
    datetime(2025, 11, 5): 1.7,   # Bonfire night
    datetime(2025, 12, 31): 2.0,  # New Year's Eve
}


class WeatherParams(NamedTuple):
    temperature_c: float
    condition: str


def _seasonal_temperature(day_of_year: int, hour: int) -> float:
    """Generate realistic London-ish temperature with seasonal + diurnal variation."""
    # Seasonal component: coldest ~Jan 15 (day 15), warmest ~Jul 20 (day 201)
    seasonal = 10.0 + 8.0 * math.sin(2 * math.pi * (day_of_year - 105) / 365)
    # Diurnal: warmest at 14:00, coldest at 05:00
    diurnal = 3.0 * math.sin(2 * math.pi * (hour - 5) / 24)
    noise = random.gauss(0, 1.5)
    return round(seasonal + diurnal + noise, 1)


def _weather_condition(temp: float, hour: int) -> str:
    """Pick a weather condition weighted by temperature and time."""
    if temp < 2:
        options = ["snow", "freezing_fog", "clear", "overcast"]
        weights = [0.3, 0.2, 0.2, 0.3]
    elif temp < 10:
        options = ["rain", "overcast", "clear", "fog"]
        weights = [0.3, 0.35, 0.2, 0.15]
    elif temp < 20:
        options = ["clear", "partly_cloudy", "rain", "overcast"]
        weights = [0.3, 0.3, 0.2, 0.2]
    else:
        options = ["clear", "partly_cloudy", "thunderstorm", "heatwave"]
        weights = [0.4, 0.3, 0.15, 0.15]
    return random.choices(options, weights=weights, k=1)[0]


def _poisson_count(rate: float) -> int:
    """Sample from Poisson distribution using inverse transform."""
    if rate <= 0:
        return 0
    L = math.exp(-rate)
    k = 0
    p = 1.0
    while True:
        k += 1
        p *= random.random()
        if p < L:
            return k - 1


def _pick_severity(weights: list[float]) -> int:
    """Pick severity 1-5 from weights."""
    return random.choices([1, 2, 3, 4, 5], weights=weights, k=1)[0]


def generate(
    start_date: datetime = datetime(2025, 1, 1),
    days: int = 365,
    seed: int = 42,
    output_path: str = "data/synthetic_emergencies.csv",
) -> str:
    """Generate synthetic emergency data and write to CSV. Returns output path."""
    random.seed(seed)

    rows: list[dict] = []

    for day_offset in range(days):
        current_date = start_date + timedelta(days=day_offset)
        day_of_year = current_date.timetuple().tm_yday
        day_of_week = current_date.weekday()  # 0=Mon, 6=Sun
        is_weekend = day_of_week >= 5
        is_holiday = current_date in HOLIDAYS_2025
        event_mult = EVENTS_2025.get(current_date, 1.0)
        is_event = event_mult > 1.0

        for hour in range(24):
            temp = _seasonal_temperature(day_of_year, hour)
            condition = _weather_condition(temp, hour)
            is_cold = temp < 5

            for loc_id, loc_data in LOCATIONS.items():
                loc_weight = LOCATION_WEIGHTS[loc_id]

                for etype, econfig in EMERGENCY_TYPES.items():
                    # Compute effective Poisson rate for this hour/location/type
                    rate = econfig["base_rate"]
                    rate *= econfig["hourly_mult"][hour]
                    rate *= loc_weight

                    # Cold weather effect
                    if is_cold:
                        rate *= econfig["cold_mult"]

                    # Weekend effect: trauma +40%, cardiac -10%
                    if is_weekend:
                        if etype == "trauma":
                            rate *= 1.4
                        elif etype == "cardiac":
                            rate *= 0.9

                    # Holiday surge
                    if is_holiday:
                        rate *= 1.5

                    # Event surge
                    rate *= event_mult

                    # Bad weather increases all emergencies slightly
                    if condition in ("thunderstorm", "snow", "freezing_fog"):
                        rate *= 1.3

                    count = _poisson_count(rate)

                    for _ in range(count):
                        # Random minute within the hour
                        minute = random.randint(0, 59)
                        second = random.randint(0, 59)
                        ts = current_date.replace(
                            hour=hour, minute=minute, second=second
                        )

                        rows.append({
                            "timestamp": ts.strftime("%Y-%m-%d %H:%M:%S"),
                            "location_id": loc_id,
                            "location_lat": loc_data["lat"],
                            "location_lon": loc_data["lon"],
                            "emergency_type": etype,
                            "severity": _pick_severity(econfig["severity_weights"]),
                            "temperature_c": temp,
                            "weather_condition": condition,
                            "is_holiday": int(is_holiday),
                            "is_event": int(is_event),
                            "hour_of_day": hour,
                            "day_of_week": day_of_week,
                        })

    # Sort by timestamp
    rows.sort(key=lambda r: r["timestamp"])

    # Ensure output directory exists
    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)

    fieldnames = [
        "timestamp", "location_id", "location_lat", "location_lon",
        "emergency_type", "severity", "temperature_c", "weather_condition",
        "is_holiday", "is_event", "hour_of_day", "day_of_week",
    ]

    with open(output_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    return output_path


def print_summary(path: str) -> None:
    """Print summary statistics of the generated dataset."""
    import collections

    with open(path, "r") as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    total = len(rows)
    print(f"\n{'='*60}")
    print(f"  Synthetic Emergency Data Summary")
    print(f"{'='*60}")
    print(f"  Total records: {total:,}")
    print(f"  Date range:    {rows[0]['timestamp'][:10]} to {rows[-1]['timestamp'][:10]}")

    # By emergency type
    type_counts = collections.Counter(r["emergency_type"] for r in rows)
    print(f"\n  By Emergency Type:")
    for etype, count in type_counts.most_common():
        print(f"    {etype:<25s} {count:>6,}  ({100*count/total:.1f}%)")

    # By location
    loc_counts = collections.Counter(r["location_id"] for r in rows)
    print(f"\n  By Location:")
    for loc, count in loc_counts.most_common():
        print(f"    {loc:<25s} {count:>6,}  ({100*count/total:.1f}%)")

    # By severity
    sev_counts = collections.Counter(int(r["severity"]) for r in rows)
    print(f"\n  By Severity:")
    for sev in sorted(sev_counts):
        count = sev_counts[sev]
        print(f"    Severity {sev}              {count:>6,}  ({100*count/total:.1f}%)")

    # Hourly distribution (top 5 peak hours)
    hour_counts = collections.Counter(int(r["hour_of_day"]) for r in rows)
    print(f"\n  Peak Hours (top 5):")
    for hour, count in hour_counts.most_common(5):
        print(f"    {hour:02d}:00                   {count:>6,}  ({100*count/total:.1f}%)")

    # Holiday vs normal
    holiday_count = sum(1 for r in rows if r["is_holiday"] == "1")
    event_count = sum(1 for r in rows if r["is_event"] == "1")
    print(f"\n  Holiday records:  {holiday_count:>6,}")
    print(f"  Event records:    {event_count:>6,}")

    avg_severity = sum(int(r["severity"]) for r in rows) / total
    print(f"  Avg severity:     {avg_severity:.2f}")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    output = generate()
    print(f"Generated data at: {output}")
    print_summary(output)
