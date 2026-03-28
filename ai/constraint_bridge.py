"""
DroneMedic - AI Constraint Enforcement Bridge

Maps NLP-extracted constraint strings (e.g., "avoid military area") to actual
geofence polygons from config. Validates routes against user-specified constraints.
"""

import re
from config import NO_FLY_ZONES, LOCATIONS, VALID_LOCATIONS
from backend.geofence import check_route_safety, is_in_no_fly_zone


# --- Zone Alias Mapping ---
# Maps common NLP phrases to actual NO_FLY_ZONES names
ZONE_ALIASES = {
    # Military Zone Alpha aliases
    "military": "Military Zone Alpha",
    "military area": "Military Zone Alpha",
    "military zone": "Military Zone Alpha",
    "military zone alpha": "Military Zone Alpha",
    "mil zone": "Military Zone Alpha",
    # Airport Exclusion aliases
    "airport": "Airport Exclusion",
    "airport area": "Airport Exclusion",
    "airport exclusion": "Airport Exclusion",
    "airport zone": "Airport Exclusion",
    "restricted airspace": "Airport Exclusion",
    "airspace": "Airport Exclusion",
}

# Build reverse lookup: zone name -> zone dict
_ZONE_BY_NAME = {zone["name"]: zone for zone in NO_FLY_ZONES}


def resolve_avoid_zones(nlp_zones: list[str]) -> list[dict]:
    """
    Map NLP-extracted zone descriptions to actual NO_FLY_ZONES entries.

    Uses exact alias matching first, then fuzzy substring matching.

    Args:
        nlp_zones: List of zone description strings from the NLP parser.

    Returns:
        List of dicts, each with:
        - "nlp_text": original NLP string
        - "resolved": True if matched to a real zone
        - "zone_name": matched zone name (or None)
        - "zone_data": full zone dict from config (or None)
    """
    results = []

    for nlp_text in nlp_zones:
        text_lower = nlp_text.lower().strip()

        # Try exact alias match
        if text_lower in ZONE_ALIASES:
            zone_name = ZONE_ALIASES[text_lower]
            results.append({
                "nlp_text": nlp_text,
                "resolved": True,
                "zone_name": zone_name,
                "zone_data": _ZONE_BY_NAME.get(zone_name),
            })
            continue

        # Try fuzzy substring match against aliases
        matched = False
        for alias, zone_name in ZONE_ALIASES.items():
            if alias in text_lower or text_lower in alias:
                results.append({
                    "nlp_text": nlp_text,
                    "resolved": True,
                    "zone_name": zone_name,
                    "zone_data": _ZONE_BY_NAME.get(zone_name),
                })
                matched = True
                break

        # Try fuzzy match against actual zone names
        if not matched:
            for zone in NO_FLY_ZONES:
                zone_lower = zone["name"].lower()
                if text_lower in zone_lower or zone_lower in text_lower:
                    results.append({
                        "nlp_text": nlp_text,
                        "resolved": True,
                        "zone_name": zone["name"],
                        "zone_data": zone,
                    })
                    matched = True
                    break

        # Unresolved zone
        if not matched:
            results.append({
                "nlp_text": nlp_text,
                "resolved": False,
                "zone_name": None,
                "zone_data": None,
            })

    return results


def validate_route_constraints(
    route: list[str],
    constraints: dict,
    plan: dict = None,
) -> dict:
    """
    Pre-flight constraint validation.

    Checks:
    1. Route avoids all resolved avoid_zones (geofence check)
    2. Weather concerns are flagged
    3. Time-sensitive flag is noted

    Args:
        route: Ordered list of location names.
        constraints: Constraints dict from the parsed task.
        plan: Full parsed plan (optional, for additional context).

    Returns:
        Dict with: valid (bool), violations (list), warnings (list), resolved_zones (list)
    """
    violations = []
    warnings = []

    # Resolve NLP avoid zones to actual zones
    avoid_zones = constraints.get("avoid_zones", [])
    resolved_zones = resolve_avoid_zones(avoid_zones) if avoid_zones else []

    # Check for unresolved zones
    for rz in resolved_zones:
        if not rz["resolved"]:
            warnings.append(
                f"Could not resolve zone '{rz['nlp_text']}' to a known no-fly zone. "
                f"It will not be enforced."
            )

    # Run geofence check on the route
    geofence_violations = check_route_safety(route)

    # Check if any geofence violation matches a user-requested avoid zone
    resolved_zone_names = {rz["zone_name"] for rz in resolved_zones if rz["resolved"]}

    for v in geofence_violations:
        if v["zone"] in resolved_zone_names:
            violations.append({
                "type": "user_constraint_violated",
                "message": f"Route {v['from']} -> {v['to']} crosses {v['zone']}, "
                           f"which the user requested to avoid",
                "zone": v["zone"],
                "segment": (v["from"], v["to"]),
            })
        else:
            warnings.append(
                f"Route {v['from']} -> {v['to']} crosses {v['zone']} "
                f"(not user-specified, but still a no-fly zone)"
            )

    # Weather concern flag
    weather_concern = constraints.get("weather_concern", "")
    if weather_concern:
        warnings.append(f"Weather concern noted: {weather_concern}")

    # Time-sensitive flag
    if constraints.get("time_sensitive", False):
        warnings.append("Delivery is time-sensitive — prioritize speed over distance optimization")

    return {
        "valid": len(violations) == 0,
        "violations": violations,
        "warnings": warnings,
        "resolved_zones": resolved_zones,
    }


def check_constraints_satisfiable(constraints: dict) -> dict:
    """
    Pre-parse feasibility check: can the constraints be satisfied?

    Checks if user-requested avoid zones would make all routes impossible.

    Returns:
        Dict with: feasible (bool), issues (list)
    """
    issues = []

    avoid_zones = constraints.get("avoid_zones", [])
    resolved = resolve_avoid_zones(avoid_zones) if avoid_zones else []

    resolved_names = {r["zone_name"] for r in resolved if r["resolved"]}

    # If avoiding all known zones, check if any route exists
    all_zone_names = {z["name"] for z in NO_FLY_ZONES}
    if resolved_names == all_zone_names and len(all_zone_names) > 0:
        issues.append(
            "All known no-fly zones are being avoided. Routes may be severely constrained."
        )

    # Check if any location falls inside an avoid zone
    for loc_name in VALID_LOCATIONS:
        if loc_name == "Depot":
            continue
        loc = LOCATIONS[loc_name]
        in_zone, zone_name = is_in_no_fly_zone(loc["x"], loc["y"])
        if in_zone and zone_name in resolved_names:
            issues.append(
                f"Location '{loc_name}' is inside avoid zone '{zone_name}'. "
                f"Delivery to this location may be impossible."
            )

    return {
        "feasible": len(issues) == 0,
        "issues": issues,
    }


def get_resolved_zone_names(constraints: dict) -> list[str]:
    """Get list of resolved zone names from constraints for use in route planner."""
    avoid_zones = constraints.get("avoid_zones", [])
    if not avoid_zones:
        return []
    resolved = resolve_avoid_zones(avoid_zones)
    return [r["zone_name"] for r in resolved if r["resolved"]]


# --- Quick test ---
if __name__ == "__main__":
    print("=" * 60)
    print("  DroneMedic AI — Constraint Bridge Demo")
    print("=" * 60)

    # Test zone resolution
    test_zones = ["military area", "airport", "storm zone", "restricted airspace"]
    print("\nZone Resolution:")
    for z in test_zones:
        results = resolve_avoid_zones([z])
        r = results[0]
        status = f"-> {r['zone_name']}" if r["resolved"] else "-> UNRESOLVED"
        print(f"  '{z}' {status}")

    # Test route constraint validation
    print("\nRoute Constraint Validation:")
    test_constraints = {
        "avoid_zones": ["military area"],
        "weather_concern": "storm approaching",
        "time_sensitive": True,
    }
    # Route that crosses Military Zone Alpha (Depot -> Clinic B)
    result = validate_route_constraints(
        ["Depot", "Clinic B", "Clinic A", "Depot"],
        test_constraints,
    )
    print(f"  Valid: {result['valid']}")
    for v in result["violations"]:
        print(f"  VIOLATION: {v['message']}")
    for w in result["warnings"]:
        print(f"  WARNING: {w}")

    # Test feasibility
    print("\nFeasibility Check:")
    feasibility = check_constraints_satisfiable(test_constraints)
    print(f"  Feasible: {feasibility['feasible']}")
    for issue in feasibility["issues"]:
        print(f"  ISSUE: {issue}")
