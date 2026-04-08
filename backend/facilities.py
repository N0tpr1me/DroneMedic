"""
DroneMedic - Facility Loader

Loads hospital/clinic data from the facilities.xlsx spreadsheet and
converts them into the LOCATIONS format used by the route planner.

Facilities are loaded once at import time and registered into config.LOCATIONS
so the rest of the system (route planner, geofence, weather) can use them
without any changes.

Lat/lon → AirSim x,y conversion:
    Uses the Depot as the origin (0,0). Each facility gets an x,y position
    computed from its lat/lon offset relative to the Depot, scaled to meters
    using an approximate flat-earth projection. This is good enough for
    route planning over regional distances.
"""

from __future__ import annotations

import logging
import math
import os

from config import LOCATIONS, DRONE_ALTITUDE

logger = logging.getLogger("DroneMedic.Facilities")

# Path to the curated top hospitals CSV
_FACILITIES_PATH = os.path.join(
    os.path.dirname(os.path.dirname(__file__)), "data", "enrichment", "top_hospitals_enriched.csv"
)
# NHS hospitals CSV (1,179 UK hospitals)
_NHS_PATH = os.path.join(
    os.path.dirname(os.path.dirname(__file__)), "data", "enrichment", "nhs_hospitals.csv"
)

# All loaded facilities (raw data from xlsx)
_facilities: list[dict] = []
_nhs_facilities: list[dict] = []

# Meters per degree (approximate at mid-latitudes)
_M_PER_DEG_LAT = 111_320
_M_PER_DEG_LON_AT_EQUATOR = 111_320


def _latlon_to_xy(lat: float, lon: float, ref_lat: float, ref_lon: float) -> tuple[float, float]:
    """
    Convert lat/lon to local x,y (meters) relative to a reference point.
    x = north-south offset, y = east-west offset.
    """
    x = (lat - ref_lat) * _M_PER_DEG_LAT
    y = (lon - ref_lon) * _M_PER_DEG_LON_AT_EQUATOR * math.cos(math.radians(ref_lat))
    return round(x, 1), round(y, 1)


def load_facilities() -> list[dict]:
    """
    Load facilities from the curated top hospitals CSV.
    Each dict has: name, type, phone, email, address, lat, lon, region, beds, website.
    """
    global _facilities
    if _facilities:
        return _facilities

    import csv

    if not os.path.exists(_FACILITIES_PATH):
        logger.warning(f"Facilities file not found: {_FACILITIES_PATH}")
        return []

    with open(_FACILITIES_PATH, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            try:
                lat = float(row.get("Latitude", 0))
                lon = float(row.get("Longitude", 0))
            except (TypeError, ValueError):
                continue

            if lat == 0 and lon == 0:
                continue

            _facilities.append({
                "name": str(row.get("Name", "")).strip(),
                "type": str(row.get("Type", "")).strip(),
                "phone": str(row.get("Phone Number", "") or "").strip(),
                "email": str(row.get("Email", "") or "").strip(),
                "address": str(row.get("Physical Address", "") or "").strip(),
                "lat": lat,
                "lon": lon,
                "region": str(row.get("Region", "") or "").strip(),
                "beds": int(row.get("Beds", 0) or 0),
                "website": str(row.get("Website", "") or "").strip(),
            })

    logger.info(f"Loaded {len(_facilities)} facilities from {_FACILITIES_PATH}")
    return _facilities


def register_facilities_as_locations(
    max_facilities: int | None = None,
    region: str | None = None,
) -> int:
    """
    Register loaded facilities into config.LOCATIONS so the route planner
    can use them. Converts lat/lon to AirSim x,y coords relative to Depot.

    Args:
        max_facilities: Limit how many to register (None = all).
        region: Only register facilities in this region.

    Returns:
        Number of facilities registered.
    """
    facilities = load_facilities()
    if not facilities:
        return 0

    # Use Depot as reference point
    depot = LOCATIONS["Depot"]
    ref_lat = depot["lat"]
    ref_lon = depot["lon"]

    count = 0
    for f in facilities:
        if region and f["region"].lower() != region.lower():
            continue

        name = f["name"]
        if name in LOCATIONS:
            continue  # Don't overwrite existing locations

        x, y = _latlon_to_xy(f["lat"], f["lon"], ref_lat, ref_lon)

        LOCATIONS[name] = {
            "x": x,
            "y": y,
            "z": DRONE_ALTITUDE,
            "lat": f["lat"],
            "lon": f["lon"],
            "description": f"{f['type']} — {f['address']}" if f["address"] else f["type"],
        }

        count += 1
        if max_facilities and count >= max_facilities:
            break

    logger.info(f"Registered {count} facilities into LOCATIONS (total: {len(LOCATIONS)})")
    return count


def load_nhs_facilities() -> list[dict]:
    """Load NHS hospitals from the NHS CSV (1,179 UK hospitals)."""
    global _nhs_facilities
    if _nhs_facilities:
        return _nhs_facilities

    import csv

    if not os.path.exists(_NHS_PATH):
        logger.warning(f"NHS facilities file not found: {_NHS_PATH}")
        return []

    # NHS CSV uses ¬ (0xAC) as delimiter and latin-1 encoding
    with open(_NHS_PATH, newline="", encoding="latin-1") as f:
        reader = csv.DictReader(f, delimiter="\xac")
        for row in reader:
            try:
                lat = float(row.get("Latitude", 0))
                lon = float(row.get("Longitude", 0))
            except (TypeError, ValueError):
                continue

            if lat == 0 and lon == 0:
                continue

            name = str(row.get("OrganisationName", "")).strip()
            if not name:
                continue

            city = str(row.get("City", "") or "").strip()
            postcode = str(row.get("Postcode", "") or "").strip()
            address1 = str(row.get("Address1", "") or "").strip()
            address2 = str(row.get("Address2", "") or "").strip()
            address_parts = [p for p in [address1, address2, city, postcode] if p]

            _nhs_facilities.append({
                "name": name,
                "type": str(row.get("SubType", "Hospital")).strip(),
                "phone": str(row.get("Phone", "") or "").strip(),
                "email": str(row.get("Email", "") or "").strip(),
                "address": ", ".join(address_parts),
                "lat": lat,
                "lon": lon,
                "region": "UK",
                "beds": 0,
                "website": str(row.get("Website", "") or "").strip(),
                "sector": str(row.get("Sector", "") or "").strip(),
                "nhs_code": str(row.get("OrganisationCode", "") or "").strip(),
            })

    logger.info(f"Loaded {len(_nhs_facilities)} NHS facilities from {_NHS_PATH}")
    return _nhs_facilities


def search_facilities(
    query: str = "",
    region: str = "",
    limit: int = 50,
) -> list[dict]:
    """
    Search facilities by name or region across all data sources.
    Searches the curated database (489 hospitals) + NHS database (1,179 UK hospitals).
    """
    results = []
    seen_names: set[str] = set()

    query_lower = query.lower()
    region_lower = region.lower()

    # Search curated facilities first
    for f in load_facilities():
        if query_lower and query_lower not in f["name"].lower():
            if not (query_lower and query_lower in f.get("address", "").lower()):
                continue
        if region_lower and region_lower not in f["region"].lower():
            continue
        if f["name"] not in seen_names:
            seen_names.add(f["name"])
            results.append(f)
        if len(results) >= limit:
            return results

    # Search NHS facilities
    for f in load_nhs_facilities():
        if query_lower and query_lower not in f["name"].lower():
            if not (query_lower and query_lower in f.get("address", "").lower()):
                continue
        if region_lower and region_lower not in f["region"].lower():
            continue
        if f["name"] not in seen_names:
            seen_names.add(f["name"])
            results.append(f)
        if len(results) >= limit:
            break

    return results


def get_facility_by_name(name: str) -> dict | None:
    """Get a single facility by exact name (searches all sources)."""
    name_lower = name.lower()
    for f in load_facilities():
        if f["name"].lower() == name_lower:
            return f
    for f in load_nhs_facilities():
        if f["name"].lower() == name_lower:
            return f
    return None
