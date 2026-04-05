"""
Hospital & Clinic Directory Collector
======================================
Queries the OpenStreetMap Overpass API for hospitals and clinics across
12 target regions and exports the results to an Excel spreadsheet.

Usage:
    pip install pandas openpyxl requests
    python collect_facilities.py

Output:
    data/facilities.xlsx
"""

from __future__ import annotations

import logging
import re
import sys
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Optional

import pandas as pd
import requests
from openpyxl.utils import get_column_letter

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter",
]
RATE_LIMIT_SECONDS = 2.0
MAX_RETRIES = 5
RETRY_BACKOFF = [10, 20, 40, 60, 90]
MAX_RESPONSE_BYTES = 50 * 1024 * 1024  # 50 MB safety cap
OUTPUT_DIR = Path(__file__).parent / "data"
OUTPUT_FILE = OUTPUT_DIR / "facilities.xlsx"

# Validation patterns for query injection prevention
_SAFE_AMENITY_RE = re.compile(r"^[a-z_]+$")
_SAFE_AREA_FILTER_RE = re.compile(r'^(area\[.*?\]|area\(\d+\))$')

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------


@dataclass
class Facility:
    name: str
    facility_type: str  # "Hospital" or "Clinic"
    phone: str
    email: str
    address: str
    latitude: float
    longitude: float
    region: str


# ---------------------------------------------------------------------------
# Region configuration
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class RegionConfig:
    name: str
    area_filter: str  # Overpass area clause
    hospital_limit: Optional[int] = None  # None = no limit (small countries)
    clinic_limit: Optional[int] = None


# Large/data-rich countries: split hospitals & clinics with limits to reach ~1000
# Small countries: combined query, no limits (naturally under 1000)
REGIONS: list[RegionConfig] = [
    RegionConfig("USA", 'area["ISO3166-1"="US"]', hospital_limit=700, clinic_limit=300),
    RegionConfig("UK", 'area["ISO3166-1"="GB"]', hospital_limit=700, clinic_limit=300),
    RegionConfig("Japan", 'area["ISO3166-1"="JP"]', hospital_limit=700, clinic_limit=300),
    RegionConfig("Australia", 'area["ISO3166-1"="AU"]', hospital_limit=700, clinic_limit=300),
    RegionConfig("South Africa", 'area["ISO3166-1"="ZA"]'),
    RegionConfig("Manila (Philippines)", "area(3600147488)"),  # Metro Manila relation
    RegionConfig("Moldova", 'area["ISO3166-1"="MD"]'),
    RegionConfig("Kazakhstan", 'area["ISO3166-1"="KZ"]'),
    RegionConfig("Venezuela", 'area["ISO3166-1"="VE"]'),
    RegionConfig("Jamaica", 'area["ISO3166-1"="JM"]'),
    RegionConfig("Iceland", 'area["ISO3166-1"="IS"]'),
    RegionConfig("New Zealand", 'area["ISO3166-1"="NZ"]'),
]

# ---------------------------------------------------------------------------
# Query builder
# ---------------------------------------------------------------------------


def build_query(
    area_filter: str,
    amenity_types: list[str],
    limit: Optional[int] = None,
) -> str:
    """Build an Overpass QL query for the given area and amenity types."""
    # Validate inputs to prevent query injection
    if not _SAFE_AREA_FILTER_RE.match(area_filter):
        raise ValueError(f"Unsafe area_filter rejected: {area_filter!r}")
    for t in amenity_types:
        if not _SAFE_AMENITY_RE.match(t):
            raise ValueError(f"Unsafe amenity type rejected: {t!r}")

    timeout = 60 if (limit is not None and limit <= 500) else 120
    union_parts = "\n  ".join(
        f'nwr["amenity"="{t}"](area.searchArea);' for t in amenity_types
    )
    limit_clause = f" {limit}" if limit else ""

    return (
        f"[out:json][timeout:{timeout}];\n"
        f"{area_filter}->.searchArea;\n"
        f"(\n  {union_parts}\n);\n"
        f"out center{limit_clause};\n"
    )


# ---------------------------------------------------------------------------
# API request with retry
# ---------------------------------------------------------------------------


def query_overpass(query: str, session: requests.Session) -> list[dict[str, Any]]:
    """Send a query to Overpass API with retry logic and rate limiting."""
    for attempt in range(MAX_RETRIES):
        for url in OVERPASS_URLS:
            try:
                log.info("Overpass request (attempt %d) to %s", attempt + 1, url.split("/")[2])
                resp = session.post(url, data={"data": query}, timeout=180)

                if resp.status_code == 429:
                    wait = RETRY_BACKOFF[min(attempt, len(RETRY_BACKOFF) - 1)]
                    log.warning("Rate limited (429). Waiting %ds...", wait)
                    time.sleep(wait)
                    break  # retry with first URL

                if resp.status_code == 504:
                    log.warning("Gateway timeout (504). Retrying...")
                    time.sleep(RETRY_BACKOFF[min(attempt, len(RETRY_BACKOFF) - 1)])
                    break

                resp.raise_for_status()

                # Guard against oversized responses
                if len(resp.content) > MAX_RESPONSE_BYTES:
                    log.error("Response body exceeds %d MB limit, skipping.", MAX_RESPONSE_BYTES // (1024 * 1024))
                    return []

                data = resp.json()
                elements = data.get("elements", [])
                log.info("  -> %d elements returned", len(elements))
                return elements

            except requests.exceptions.Timeout:
                log.warning("Request timed out. Retrying...")
                time.sleep(RETRY_BACKOFF[min(attempt, len(RETRY_BACKOFF) - 1)])
                break
            except requests.exceptions.ConnectionError:
                log.warning("Connection error to %s. Trying next endpoint...", url)
                continue
            except requests.exceptions.RequestException as exc:
                log.error("Request failed: %s", exc)
                time.sleep(RETRY_BACKOFF[min(attempt, len(RETRY_BACKOFF) - 1)])
                break

    log.error("All retries exhausted for query.")
    return []


# ---------------------------------------------------------------------------
# Response parser
# ---------------------------------------------------------------------------


def _get_tag(tags: dict[str, str], *keys: str) -> str:
    """Return the first non-empty tag value for the given keys."""
    for key in keys:
        val = tags.get(key, "").strip()
        if val:
            return val
    return ""


def _build_address(tags: dict[str, str]) -> str:
    """Construct a human-readable address from OSM addr:* tags."""
    full = _get_tag(tags, "addr:full")
    if full:
        return full

    parts = []
    number = _get_tag(tags, "addr:housenumber")
    street = _get_tag(tags, "addr:street")
    if number and street:
        parts.append(f"{number} {street}")
    elif street:
        parts.append(street)

    city = _get_tag(tags, "addr:city")
    if city:
        parts.append(city)

    postcode = _get_tag(tags, "addr:postcode")
    if postcode:
        parts.append(postcode)

    country = _get_tag(tags, "addr:country")
    if country:
        parts.append(country)

    return ", ".join(parts)


def parse_elements(elements: list[dict], region_name: str) -> list[Facility]:
    """Parse raw Overpass JSON elements into Facility objects."""
    facilities: list[Facility] = []

    for el in elements:
        tags = el.get("tags", {})

        # Skip unnamed facilities
        name = _get_tag(tags, "name", "name:en")
        if not name:
            continue

        # Coordinates: nodes have lat/lon directly; ways/relations use center
        # Use `is None` checks (not falsy) because 0.0 is a valid coordinate
        lat = el.get("lat")
        lon = el.get("lon")
        if lat is None or lon is None:
            center = el.get("center", {})
            lat = center.get("lat")
            lon = center.get("lon")
        if lat is None or lon is None:
            continue

        try:
            lat_f = round(float(lat), 6)
            lon_f = round(float(lon), 6)
        except (TypeError, ValueError):
            log.warning("Skipping element with non-numeric coordinates: lat=%r lon=%r", lat, lon)
            continue

        if not (-90.0 <= lat_f <= 90.0) or not (-180.0 <= lon_f <= 180.0):
            log.warning("Skipping element with out-of-range coordinates: lat=%s lon=%s", lat_f, lon_f)
            continue

        amenity = tags.get("amenity", "hospital")
        facility_type = "Hospital" if amenity == "hospital" else "Clinic"

        facilities.append(
            Facility(
                name=name,
                facility_type=facility_type,
                phone=_get_tag(tags, "phone", "contact:phone"),
                email=_get_tag(tags, "email", "contact:email"),
                address=_build_address(tags),
                latitude=lat_f,
                longitude=lon_f,
                region=region_name,
            )
        )

    return facilities


# ---------------------------------------------------------------------------
# Deduplication
# ---------------------------------------------------------------------------


def deduplicate(facilities: list[Facility]) -> list[Facility]:
    """Remove duplicates by (name, rounded coordinates)."""
    seen: set[tuple[str, float, float]] = set()
    unique: list[Facility] = []

    for f in facilities:
        key = (f.name.lower(), round(f.latitude, 5), round(f.longitude, 5))
        if key not in seen:
            seen.add(key)
            unique.append(f)

    removed = len(facilities) - len(unique)
    if removed > 0:
        log.info("Removed %d duplicates", removed)
    return unique


# ---------------------------------------------------------------------------
# Collection orchestrator
# ---------------------------------------------------------------------------


def collect_region(region: RegionConfig, session: requests.Session) -> list[Facility]:
    """Collect facilities for a single region."""
    log.info("=" * 50)
    log.info("Collecting: %s", region.name)

    facilities: list[Facility] = []

    if region.hospital_limit is not None:
        # Large country: query hospitals and clinics separately
        query_h = build_query(region.area_filter, ["hospital"], region.hospital_limit)
        elements_h = query_overpass(query_h, session)
        facilities.extend(parse_elements(elements_h, region.name))
        log.info("  Hospitals: %d", len(facilities))

        time.sleep(RATE_LIMIT_SECONDS)

        # For USA, OSM uses "doctors" instead of "clinic" for most facilities
        clinic_types = ["clinic", "doctors"] if "US" in region.area_filter else ["clinic"]
        query_c = build_query(region.area_filter, clinic_types, region.clinic_limit)
        elements_c = query_overpass(query_c, session)
        clinics = parse_elements(elements_c, region.name)
        facilities.extend(clinics)
        log.info("  Clinics/Doctors: %d", len(clinics))
    else:
        # Small country: combined query for hospitals, clinics, and doctors
        query = build_query(region.area_filter, ["hospital", "clinic", "doctors"])
        elements = query_overpass(query, session)
        facilities = parse_elements(elements, region.name)

    facilities = deduplicate(facilities)
    log.info("  Total for %s: %d facilities", region.name, len(facilities))
    return facilities


def load_existing_facilities(path: Path) -> list[Facility]:
    """Load previously collected facilities from an Excel file."""
    if not path.exists():
        return []
    df = pd.read_excel(path, engine="openpyxl")
    facilities: list[Facility] = []
    for _, row in df.iterrows():
        facilities.append(Facility(
            name=str(row.get("Name", "")),
            facility_type=str(row.get("Type", "")),
            phone=str(row.get("Phone Number", "")),
            email=str(row.get("Email", "")),
            address=str(row.get("Physical Address", "")),
            latitude=float(row.get("Latitude", 0)),
            longitude=float(row.get("Longitude", 0)),
            region=str(row.get("Region", "")),
        ))
    log.info("Loaded %d existing facilities from %s", len(facilities), path)
    return facilities


def collect_all_regions(retry_mode: bool = False) -> list[Facility]:
    """Iterate through all regions and collect facility data.

    If retry_mode is True, load existing data and only re-query regions
    that have zero or very few results.
    """
    existing: list[Facility] = []
    skip_regions: set[str] = set()

    if retry_mode:
        existing = load_existing_facilities(OUTPUT_FILE)
        # Count per region to find gaps
        region_counts: dict[str, int] = {}
        for f in existing:
            region_counts[f.region] = region_counts.get(f.region, 0) + 1
        for region in REGIONS:
            count = region_counts.get(region.name, 0)
            # Skip regions that already have good data (>800 for large, >20 for small)
            threshold = 800 if region.hospital_limit is not None else 20
            if count >= threshold:
                skip_regions.add(region.name)
                log.info("Skipping %s (%d facilities already collected)", region.name, count)

    all_facilities: list[Facility] = []
    failed_regions: list[str] = []

    session = requests.Session()
    session.headers.update({"User-Agent": "DroneMedic-FacilityCollector/1.0"})

    for i, region in enumerate(REGIONS):
        if region.name in skip_regions:
            continue

        try:
            facilities = collect_region(region, session)
            all_facilities.extend(facilities)
        except Exception as exc:
            log.error("Failed to collect %s: %s", region.name, exc, exc_info=True)
            failed_regions.append(region.name)

        # Rate limit between regions
        if i < len(REGIONS) - 1:
            time.sleep(RATE_LIMIT_SECONDS)

    if failed_regions:
        log.warning("Failed regions: %s", ", ".join(failed_regions))

    if retry_mode:
        # Merge: keep existing data for skipped regions, use new data for retried ones
        retried_region_names = {r.name for r in REGIONS} - skip_regions
        kept_existing = [f for f in existing if f.region not in retried_region_names]
        all_facilities = kept_existing + all_facilities
        all_facilities = deduplicate(all_facilities)

    return all_facilities


# ---------------------------------------------------------------------------
# Excel export
# ---------------------------------------------------------------------------


def export_to_excel(facilities: list[Facility], output_path: Path) -> None:
    """Export facilities to an Excel spreadsheet."""
    df = pd.DataFrame([asdict(f) for f in facilities])

    # Rename columns for readability (explicit mapping, order-independent)
    df = df.rename(columns={
        "name": "Name",
        "facility_type": "Type",
        "phone": "Phone Number",
        "email": "Email",
        "address": "Physical Address",
        "latitude": "Latitude",
        "longitude": "Longitude",
        "region": "Region",
    })

    # Sort by Region, then Type, then Name
    df = df.sort_values(["Region", "Type", "Name"]).reset_index(drop=True)

    output_path.parent.mkdir(parents=True, exist_ok=True)

    with pd.ExcelWriter(output_path, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name="Facilities")

        # Auto-adjust column widths
        worksheet = writer.sheets["Facilities"]
        for col_idx, column in enumerate(df.columns):
            col_max = df[column].astype(str).map(len).max()
            max_len = max(int(col_max) if pd.notna(col_max) else 0, len(column))
            col_letter = get_column_letter(col_idx + 1)
            worksheet.column_dimensions[col_letter].width = min(max_len + 2, 50)

    log.info("Exported %d facilities to %s", len(df), output_path)


# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------


def print_summary(facilities: list[Facility]) -> None:
    """Print a per-region summary table."""
    df = pd.DataFrame([asdict(f) for f in facilities])
    if df.empty:
        log.warning("No facilities collected.")
        return

    print("\n" + "=" * 65)
    print(f"{'Region':<28} {'Hospitals':>10} {'Clinics':>10} {'Total':>10}")
    print("-" * 65)

    for region in REGIONS:
        region_data = df[df["region"] == region.name]
        hospitals = len(region_data[region_data["facility_type"] == "Hospital"])
        clinics = len(region_data[region_data["facility_type"] == "Clinic"])
        total = hospitals + clinics
        print(f"{region.name:<28} {hospitals:>10} {clinics:>10} {total:>10}")

    print("-" * 65)
    total_h = len(df[df["facility_type"] == "Hospital"])
    total_c = len(df[df["facility_type"] == "Clinic"])
    print(f"{'TOTAL':<28} {total_h:>10} {total_c:>10} {len(df):>10}")
    print("=" * 65 + "\n")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main() -> int:
    retry_mode = "--retry" in sys.argv
    if retry_mode:
        log.info("RETRY MODE: filling in missing/incomplete regions...")
    else:
        log.info("Starting facility collection for %d regions...", len(REGIONS))

    start = time.time()

    facilities = collect_all_regions(retry_mode=retry_mode)

    if not facilities:
        log.error("No facilities collected. Check your internet connection.")
        return 1

    export_to_excel(facilities, OUTPUT_FILE)
    print_summary(facilities)

    elapsed = time.time() - start
    log.info("Done in %.1f seconds. Output: %s", elapsed, OUTPUT_FILE)
    return 0


if __name__ == "__main__":
    sys.exit(main())
