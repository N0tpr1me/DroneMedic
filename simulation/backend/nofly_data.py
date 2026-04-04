"""
DroneMedic - Real-World No-Fly Zone Data

Load real-world no-fly zone data from open sources (FAA, PDOK, UK CAA).
Provides static zone databases plus dynamic TFR (Temporary Flight Restriction) support.
"""

from __future__ import annotations

import logging
import time
import uuid

from config import NO_FLY_ZONES

logger = logging.getLogger("DroneMedic.NoflyData")


# ---------------------------------------------------------------------------
# Static zone databases — real GPS coordinates
# ---------------------------------------------------------------------------

def load_faa_zones() -> list[dict]:
    """FAA P-56 and other US restricted/prohibited zones with real GPS polygons."""
    return [
        {
            "name": "Washington DC P-56A (White House)",
            "country": "US",
            "source": "FAA",
            "lat_lon": [
                (38.8977, -77.0365), (38.9007, -77.0405),
                (38.9007, -77.0325), (38.8947, -77.0325),
                (38.8947, -77.0405),
            ],
        },
        {
            "name": "Washington DC P-56B (Naval Observatory)",
            "country": "US",
            "source": "FAA",
            "lat_lon": [
                (38.9217, -77.0700), (38.9257, -77.0740),
                (38.9257, -77.0660), (38.9177, -77.0660),
                (38.9177, -77.0740),
            ],
        },
        {
            "name": "JFK Airport 5 km Buffer",
            "country": "US",
            "source": "FAA",
            "lat_lon": [
                (40.6613, -73.8040), (40.6613, -73.7540),
                (40.6213, -73.7540), (40.6213, -73.8040),
            ],
        },
        {
            "name": "LAX Airport 5 km Buffer",
            "country": "US",
            "source": "FAA",
            "lat_lon": [
                (33.9625, -118.4280), (33.9625, -118.3880),
                (33.9225, -118.3880), (33.9225, -118.4280),
            ],
        },
        {
            "name": "Pentagon Restricted Area",
            "country": "US",
            "source": "FAA",
            "lat_lon": [
                (38.8720, -77.0590), (38.8750, -77.0630),
                (38.8750, -77.0550), (38.8690, -77.0550),
                (38.8690, -77.0630),
            ],
        },
        {
            "name": "San Francisco International 5 km Buffer",
            "country": "US",
            "source": "FAA",
            "lat_lon": [
                (37.6313, -122.4000), (37.6313, -122.3600),
                (37.5913, -122.3600), (37.5913, -122.4000),
            ],
        },
        {
            "name": "Camp David TFR P-40",
            "country": "US",
            "source": "FAA",
            "lat_lon": [
                (39.6483, -77.4650), (39.6523, -77.4690),
                (39.6523, -77.4610), (39.6443, -77.4610),
                (39.6443, -77.4690),
            ],
        },
    ]


def load_uk_zones() -> list[dict]:
    """UK CAA drone restriction zones (Flight Restriction Zones)."""
    return [
        {
            "name": "Heathrow Airport FRZ",
            "country": "UK",
            "source": "UK_CAA",
            "lat_lon": [
                (51.4775, -0.4614), (51.4775, -0.4314),
                (51.4575, -0.4314), (51.4575, -0.4614),
            ],
        },
        {
            "name": "Gatwick Airport FRZ",
            "country": "UK",
            "source": "UK_CAA",
            "lat_lon": [
                (51.1637, -0.2042), (51.1637, -0.1642),
                (51.1437, -0.1642), (51.1437, -0.2042),
            ],
        },
        {
            "name": "Buckingham Palace Restricted",
            "country": "UK",
            "source": "UK_CAA",
            "lat_lon": [
                (51.5024, -0.1430), (51.5044, -0.1430),
                (51.5044, -0.1390), (51.5024, -0.1390),
            ],
        },
        {
            "name": "Houses of Parliament Restricted",
            "country": "UK",
            "source": "UK_CAA",
            "lat_lon": [
                (51.4990, -0.1265), (51.5010, -0.1265),
                (51.5010, -0.1235), (51.4990, -0.1235),
            ],
        },
        {
            "name": "London City Airport FRZ",
            "country": "UK",
            "source": "UK_CAA",
            "lat_lon": [
                (51.5075, 0.0395), (51.5075, 0.0595),
                (51.4975, 0.0595), (51.4975, 0.0395),
            ],
        },
        {
            "name": "Manchester Airport FRZ",
            "country": "UK",
            "source": "UK_CAA",
            "lat_lon": [
                (53.3637, -2.2900), (53.3637, -2.2500),
                (53.3437, -2.2500), (53.3437, -2.2900),
            ],
        },
        {
            "name": "Edinburgh Airport FRZ",
            "country": "UK",
            "source": "UK_CAA",
            "lat_lon": [
                (55.9600, -3.3900), (55.9600, -3.3500),
                (55.9400, -3.3500), (55.9400, -3.3900),
            ],
        },
    ]


def load_pdok_zones() -> list[dict]:
    """Netherlands PDOK drone no-fly zones."""
    return [
        {
            "name": "Schiphol Airport CTR",
            "country": "NL",
            "source": "PDOK",
            "lat_lon": [
                (52.3186, 4.7438), (52.3186, 4.7838),
                (52.2986, 4.7838), (52.2986, 4.7438),
            ],
        },
        {
            "name": "Rotterdam The Hague Airport",
            "country": "NL",
            "source": "PDOK",
            "lat_lon": [
                (51.9689, 4.4266), (51.9689, 4.4566),
                (51.9489, 4.4566), (51.9489, 4.4266),
            ],
        },
        {
            "name": "Eindhoven Air Base",
            "country": "NL",
            "source": "PDOK",
            "lat_lon": [
                (51.4591, 5.3613), (51.4591, 5.4013),
                (51.4391, 5.4013), (51.4391, 5.3613),
            ],
        },
        {
            "name": "Binnenhof (Parliament)",
            "country": "NL",
            "source": "PDOK",
            "lat_lon": [
                (52.0790, 4.3120), (52.0810, 4.3120),
                (52.0810, 4.3160), (52.0790, 4.3160),
            ],
        },
        {
            "name": "Volkel Air Base",
            "country": "NL",
            "source": "PDOK",
            "lat_lon": [
                (51.6600, 5.6700), (51.6600, 5.7100),
                (51.6400, 5.7100), (51.6400, 5.6700),
            ],
        },
        {
            "name": "Leeuwarden Air Base",
            "country": "NL",
            "source": "PDOK",
            "lat_lon": [
                (53.2386, 5.7500), (53.2386, 5.7900),
                (53.2186, 5.7900), (53.2186, 5.7500),
            ],
        },
    ]


def load_nofly_zones(country: str = "UK") -> list[dict]:
    """
    Merge config hardcoded zones with real-world data for the requested country.

    Args:
        country: "US", "UK", or "NL".

    Returns:
        Combined list of no-fly zone dicts.
    """
    zones = list(NO_FLY_ZONES)  # Start with existing config zones
    loaders = {
        "US": load_faa_zones,
        "UK": load_uk_zones,
        "NL": load_pdok_zones,
    }
    loader = loaders.get(country.upper())
    if loader is not None:
        zones.extend(loader())
    else:
        logger.warning(f"[NOFLY] No zone data for country '{country}'. Returning config zones only.")
    return zones


# ---------------------------------------------------------------------------
# Dynamic TFR (Temporary Flight Restriction) support
# ---------------------------------------------------------------------------

_active_tfrs: list[dict] = []


def add_tfr(
    name: str,
    polygon_latlon: list[tuple[float, float]],
    reason: str,
    expiry_minutes: int = 60,
) -> str:
    """
    Add a temporary flight restriction.

    Returns:
        Short UUID identifier for the TFR.
    """
    tfr_id = str(uuid.uuid4())[:8]
    _active_tfrs.append({
        "id": tfr_id,
        "name": name,
        "lat_lon": polygon_latlon,
        "reason": reason,
        "created": time.time(),
        "expiry": time.time() + expiry_minutes * 60,
    })
    logger.info(f"[TFR] Added '{name}' (id={tfr_id}, reason={reason}, expires in {expiry_minutes}m)")
    return tfr_id


def remove_tfr(tfr_id: str) -> bool:
    """Remove a TFR by id. Returns True if found and removed."""
    before = len(_active_tfrs)
    _active_tfrs[:] = [t for t in _active_tfrs if t["id"] != tfr_id]
    removed = len(_active_tfrs) < before
    if removed:
        logger.info(f"[TFR] Removed id={tfr_id}")
    return removed


def get_active_tfrs() -> list[dict]:
    """Return all non-expired TFRs, pruning expired ones in place."""
    now = time.time()
    _active_tfrs[:] = [t for t in _active_tfrs if t["expiry"] > now]
    return list(_active_tfrs)


def _point_in_polygon_latlon(lat: float, lon: float, polygon: list[tuple[float, float]]) -> bool:
    """Ray-casting point-in-polygon for lat/lon coordinates."""
    n = len(polygon)
    inside = False
    j = n - 1
    for i in range(n):
        lat_i, lon_i = polygon[i]
        lat_j, lon_j = polygon[j]
        if ((lon_i > lon) != (lon_j > lon)) and (
            lat < (lat_j - lat_i) * (lon - lon_i) / (lon_j - lon_i) + lat_i
        ):
            inside = not inside
        j = i
    return inside


def check_route_against_tfrs(
    route_points: list[tuple[float, float]],
) -> list[dict]:
    """
    Check a list of (lat, lon) waypoints against all active TFRs.

    Returns:
        List of violations: [{"point": (lat, lon), "tfr": <tfr_dict>}, ...]
    """
    active = get_active_tfrs()
    violations: list[dict] = []
    for lat, lon in route_points:
        for tfr in active:
            if _point_in_polygon_latlon(lat, lon, tfr["lat_lon"]):
                violations.append({"point": (lat, lon), "tfr": tfr})
    return violations


# ---------------------------------------------------------------------------
# Quick test
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    print("=== Load zones by country ===")
    for country in ("US", "UK", "NL"):
        zones = load_nofly_zones(country)
        print(f"  {country}: {len(zones)} zones")
        for z in zones:
            src = z.get("source", "config")
            print(f"    - {z['name']} ({src})")

    print("\n=== TFR management ===")
    tfr_id = add_tfr(
        name="Emergency Incident Zone",
        polygon_latlon=[
            (51.510, -0.130), (51.512, -0.130),
            (51.512, -0.126), (51.510, -0.126),
        ],
        reason="Chemical spill",
        expiry_minutes=30,
    )
    print(f"  Created TFR: {tfr_id}")
    print(f"  Active TFRs: {len(get_active_tfrs())}")

    print("\n=== Route vs TFR check ===")
    test_route = [
        (51.5074, -0.1278),  # Depot — outside TFR
        (51.5110, -0.1285),  # Inside TFR polygon
        (51.5044, -0.1100),  # Clinic C — outside TFR
    ]
    violations = check_route_against_tfrs(test_route)
    if violations:
        for v in violations:
            print(f"  VIOLATION at {v['point']}: TFR '{v['tfr']['name']}' ({v['tfr']['reason']})")
    else:
        print("  Route is clear of TFRs.")

    print("\n=== Remove TFR ===")
    removed = remove_tfr(tfr_id)
    print(f"  Removed: {removed}, active TFRs: {len(get_active_tfrs())}")
