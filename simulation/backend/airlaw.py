"""
DroneMedic - Multi-country air law compliance profiles and validation.

Each country profile encodes legal constraints for drone operations:
max altitude, range, VLOS requirements, weight limits, restricted hours,
airport buffer zones, registration, and remote ID requirements.

Falls back to UK CAA rules when the country is unknown.
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass
from typing import Optional

from config import LOCATIONS, DRONE_MAX_ALTITUDE_M, DRONE_EMPTY_WEIGHT_KG

logger = logging.getLogger("DroneMedic.AirLaw")


# ── Air Law Profile ───────────────────────────────────────────────────

@dataclass(frozen=True)
class AirLawProfile:
    """Immutable drone regulation profile for a single country."""

    country: str
    country_code: str               # ISO 3166-1 alpha-2
    max_altitude_m: float
    max_range_km: float
    requires_vlos: bool             # Visual Line of Sight required?
    max_weight_kg: float            # Total drone + payload
    restricted_hours: Optional[tuple[int, int]]  # (start_utc, end_utc) or None
    no_fly_buffer_m: float          # Buffer distance around airports
    requires_registration: bool
    requires_remote_id: bool
    authority: str                  # Regulatory body name


# ── Country Profiles ──────────────────────────────────────────────────

COUNTRY_PROFILES: dict[str, AirLawProfile] = {
    "GB": AirLawProfile(
        "United Kingdom", "GB", 120, 5, True, 25,
        None, 5000, True, True, "UK CAA",
    ),
    "US": AirLawProfile(
        "United States", "US", 122, 1.85, True, 25,
        None, 8000, True, True, "FAA",
    ),
    "DE": AirLawProfile(
        "Germany", "DE", 100, 5, True, 25,
        (22, 6), 1500, True, True, "EASA/LBA",
    ),
    "AE": AirLawProfile(
        "UAE", "AE", 120, 5, True, 25,
        (18, 6), 5000, True, True, "GCAA",
    ),
    "NL": AirLawProfile(
        "Netherlands", "NL", 120, 5, True, 25,
        None, 3000, True, True, "EASA/ILT",
    ),
    "IN": AirLawProfile(
        "India", "IN", 120, 5, True, 25,
        (18, 6), 5000, True, True, "DGCA",
    ),
    "RW": AirLawProfile(
        "Rwanda", "RW", 150, 40, False, 50,
        None, 3000, True, False, "RCAA",
    ),
    "AU": AirLawProfile(
        "Australia", "AU", 120, 5, True, 25,
        None, 5500, True, True, "CASA",
    ),
}

DEFAULT_COUNTRY = "GB"


# ── Profile Lookup ────────────────────────────────────────────────────

def get_profile(country_code: str) -> AirLawProfile:
    """Get air law profile for a country code. Falls back to GB if unknown."""
    code = country_code.upper().strip()
    profile = COUNTRY_PROFILES.get(code)
    if profile is None:
        logger.warning(
            f"No air law profile for '{code}', falling back to {DEFAULT_COUNTRY}"
        )
        profile = COUNTRY_PROFILES[DEFAULT_COUNTRY]
    return profile


def get_all_profiles() -> dict[str, AirLawProfile]:
    """Return all available country profiles."""
    return dict(COUNTRY_PROFILES)


# ── Country Detection ─────────────────────────────────────────────────

def detect_country_from_coords(lat: float, lon: float) -> str:
    """
    Detect country from coordinates using Google Maps reverse geocode.

    Returns ISO 3166-1 alpha-2 country code. Falls back to 'GB' if the
    Google Maps service is unavailable or coordinates cannot be resolved.
    """
    try:
        from simulation.backend.google_maps import GoogleMapsService
        svc = GoogleMapsService()
        result = svc.detect_country(lat, lon)
        if result:
            code = result.upper()
            logger.info(f"Detected country '{code}' for ({lat}, {lon})")
            return code
        logger.warning(
            f"Could not detect country for ({lat}, {lon}), defaulting to {DEFAULT_COUNTRY}"
        )
        return DEFAULT_COUNTRY
    except Exception as exc:
        logger.warning(
            f"Google Maps country detection failed: {exc}. "
            f"Defaulting to {DEFAULT_COUNTRY}"
        )
        return DEFAULT_COUNTRY


# ── Mission Compliance Validation ─────────────────────────────────────

def _route_total_distance_km(route: list[str]) -> float:
    """Compute total route distance in kilometres (Euclidean on AirSim coords)."""
    total_m = 0.0
    for i in range(len(route) - 1):
        loc1 = LOCATIONS.get(route[i])
        loc2 = LOCATIONS.get(route[i + 1])
        if loc1 is None or loc2 is None:
            continue
        dx = loc1["x"] - loc2["x"]
        dy = loc1["y"] - loc2["y"]
        total_m += math.sqrt(dx * dx + dy * dy)
    return total_m / 1000.0


def validate_mission_compliance(
    route: list[str],
    country_code: str,
    altitude_m: float,
    total_weight_kg: float,
    time_utc_hour: int = 12,
) -> list[dict]:
    """
    Validate a mission against the air law profile for *country_code*.

    Args:
        route: Ordered list of location names (e.g. ["Depot", "Clinic A", "Depot"]).
        country_code: ISO 2-letter country code.
        altitude_m: Planned cruise altitude in metres.
        total_weight_kg: Drone empty weight + payload.
        time_utc_hour: Planned launch hour (0-23 UTC).

    Returns:
        List of violation dicts. Each dict has:
            rule  — short rule identifier
            description — human-readable explanation
            severity — "critical" | "warning"
        An empty list means the mission is compliant.
    """
    profile = get_profile(country_code)
    violations: list[dict] = []

    # 1. Altitude check
    if altitude_m > profile.max_altitude_m:
        violations.append({
            "rule": "max_altitude",
            "description": (
                f"Altitude {altitude_m}m exceeds {profile.authority} limit "
                f"of {profile.max_altitude_m}m"
            ),
            "severity": "critical",
        })

    # 2. Weight check
    if total_weight_kg > profile.max_weight_kg:
        violations.append({
            "rule": "max_weight",
            "description": (
                f"Total weight {total_weight_kg}kg exceeds {profile.authority} limit "
                f"of {profile.max_weight_kg}kg"
            ),
            "severity": "critical",
        })

    # 3. Range check
    total_km = _route_total_distance_km(route)
    if total_km > profile.max_range_km:
        violations.append({
            "rule": "max_range",
            "description": (
                f"Route distance {total_km:.2f}km exceeds {profile.authority} limit "
                f"of {profile.max_range_km}km"
            ),
            "severity": "critical",
        })

    # 4. Restricted hours check
    if profile.restricted_hours is not None:
        start_h, end_h = profile.restricted_hours
        # Restricted window wraps midnight (e.g. 22:00 – 06:00)
        if start_h > end_h:
            in_restricted = time_utc_hour >= start_h or time_utc_hour < end_h
        else:
            in_restricted = start_h <= time_utc_hour < end_h
        if in_restricted:
            violations.append({
                "rule": "restricted_hours",
                "description": (
                    f"Launch at {time_utc_hour:02d}:00 UTC falls within "
                    f"{profile.authority} restricted hours "
                    f"({start_h:02d}:00 – {end_h:02d}:00 UTC)"
                ),
                "severity": "critical",
            })

    # 5. Registration advisory
    if profile.requires_registration:
        violations.append({
            "rule": "registration_required",
            "description": (
                f"{profile.authority} requires drone registration in {profile.country}"
            ),
            "severity": "warning",
        })

    # 6. Remote ID advisory
    if profile.requires_remote_id:
        violations.append({
            "rule": "remote_id_required",
            "description": (
                f"{profile.authority} requires remote ID broadcast in {profile.country}"
            ),
            "severity": "warning",
        })

    # 7. VLOS advisory
    if profile.requires_vlos:
        violations.append({
            "rule": "vlos_required",
            "description": (
                f"{profile.authority} requires Visual Line of Sight in {profile.country}"
            ),
            "severity": "warning",
        })

    if violations:
        critical = [v for v in violations if v["severity"] == "critical"]
        logger.info(
            f"Compliance check for {profile.country}: "
            f"{len(critical)} critical, {len(violations) - len(critical)} warnings"
        )
    else:
        logger.info(f"Mission fully compliant with {profile.authority} regulations")

    return violations


def format_compliance_report(violations: list[dict], country_code: str) -> str:
    """Format compliance violations as a readable report string."""
    profile = get_profile(country_code)
    lines = [
        f"╔══════════════════════════════════════════╗",
        f"║  AIR LAW COMPLIANCE — {profile.authority:<18s} ║",
        f"╚══════════════════════════════════════════╝",
        f"  Country:   {profile.country} ({profile.country_code})",
        f"  Authority: {profile.authority}",
    ]

    critical = [v for v in violations if v["severity"] == "critical"]
    warnings = [v for v in violations if v["severity"] == "warning"]

    if critical:
        lines.append(f"\n  ✖ CRITICAL VIOLATIONS ({len(critical)}):")
        for v in critical:
            lines.append(f"    [{v['rule']}] {v['description']}")

    if warnings:
        lines.append(f"\n  ⚠ ADVISORIES ({len(warnings)}):")
        for v in warnings:
            lines.append(f"    [{v['rule']}] {v['description']}")

    if not critical:
        lines.append("\n  ✔ No critical violations — mission may proceed")

    return "\n".join(lines)


# ── Quick test ────────────────────────────────────────────────────────

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    print("=== Available Country Profiles ===")
    for code, prof in COUNTRY_PROFILES.items():
        restricted = (
            f"{prof.restricted_hours[0]:02d}:00-{prof.restricted_hours[1]:02d}:00"
            if prof.restricted_hours else "none"
        )
        print(
            f"  {code} ({prof.country:<18s}) — alt:{prof.max_altitude_m}m  "
            f"range:{prof.max_range_km}km  weight:{prof.max_weight_kg}kg  "
            f"restricted:{restricted}  authority:{prof.authority}"
        )

    print("\n=== UK Compliance (should pass) ===")
    route = ["Depot", "Clinic A", "Clinic B", "Depot"]
    violations = validate_mission_compliance(
        route=route,
        country_code="GB",
        altitude_m=100,
        total_weight_kg=5.0,
        time_utc_hour=14,
    )
    print(format_compliance_report(violations, "GB"))

    print("\n=== Germany Compliance at 23:00 UTC (restricted hours) ===")
    violations = validate_mission_compliance(
        route=route,
        country_code="DE",
        altitude_m=100,
        total_weight_kg=5.0,
        time_utc_hour=23,
    )
    print(format_compliance_report(violations, "DE"))

    print("\n=== US Compliance — overweight drone ===")
    violations = validate_mission_compliance(
        route=route,
        country_code="US",
        altitude_m=130,       # exceeds 122m FAA limit
        total_weight_kg=30,   # exceeds 25kg FAA limit
        time_utc_hour=10,
    )
    print(format_compliance_report(violations, "US"))

    print("\n=== Rwanda — relaxed regulations ===")
    violations = validate_mission_compliance(
        route=route,
        country_code="RW",
        altitude_m=140,
        total_weight_kg=40,
        time_utc_hour=10,
    )
    print(format_compliance_report(violations, "RW"))

    print("\n=== Unknown country fallback ===")
    profile = get_profile("ZZ")
    print(f"  Fallback profile: {profile.country} ({profile.authority})")
