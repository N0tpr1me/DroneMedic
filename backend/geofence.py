"""
DroneMedic - Geofence / No-Fly Zone Service

Provides point-in-polygon checks for no-fly zones and route validation.
Uses a simple ray-casting algorithm — no external dependencies.
"""

from __future__ import annotations

import logging
from config import NO_FLY_ZONES, LOCATIONS

logger = logging.getLogger("DroneMedic.Geofence")


def _point_in_polygon(x: float, y: float, polygon: list[tuple]) -> bool:
    """
    Ray-casting algorithm to check if a point is inside a polygon.

    Args:
        x, y: Point coordinates.
        polygon: List of (x, y) tuples defining the polygon vertices.

    Returns:
        True if point is inside the polygon.
    """
    n = len(polygon)
    inside = False
    j = n - 1
    for i in range(n):
        xi, yi = polygon[i]
        xj, yj = polygon[j]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi) + xi):
            inside = not inside
        j = i
    return inside


def _segments_intersect(p1, p2, p3, p4) -> bool:
    """Check if line segment (p1,p2) intersects with segment (p3,p4)."""
    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    d1 = cross(p3, p4, p1)
    d2 = cross(p3, p4, p2)
    d3 = cross(p1, p2, p3)
    d4 = cross(p1, p2, p4)

    if ((d1 > 0 and d2 < 0) or (d1 < 0 and d2 > 0)) and \
       ((d3 > 0 and d4 < 0) or (d3 < 0 and d4 > 0)):
        return True
    return False


def is_in_no_fly_zone(x: float, y: float) -> tuple[bool, str | None]:
    """
    Check if a point (AirSim coords) falls inside any no-fly zone.

    Returns:
        (True, "zone_name") if inside a zone, (False, None) otherwise.
    """
    for zone in NO_FLY_ZONES:
        if _point_in_polygon(x, y, zone["polygon"]):
            return True, zone["name"]
    return False, None


def segment_crosses_no_fly_zone(x1: float, y1: float, x2: float, y2: float) -> tuple[bool, str | None]:
    """
    Check if a flight path segment crosses any no-fly zone polygon edge.

    Returns:
        (True, "zone_name") if the segment crosses a zone, (False, None) otherwise.
    """
    for zone in NO_FLY_ZONES:
        poly = zone["polygon"]
        # Check if either endpoint is inside
        if _point_in_polygon(x1, y1, poly) or _point_in_polygon(x2, y2, poly):
            return True, zone["name"]
        # Check if segment crosses any polygon edge
        n = len(poly)
        for i in range(n):
            j = (i + 1) % n
            if _segments_intersect((x1, y1), (x2, y2), poly[i], poly[j]):
                return True, zone["name"]
    return False, None


def check_route_safety(location_names: list[str]) -> list[dict]:
    """
    Check an ordered route for no-fly zone violations.

    Args:
        location_names: Ordered list of location names in the route.

    Returns:
        List of violations: [{"from": "A", "to": "B", "zone": "Military Zone Alpha"}, ...]
        Empty list means the route is safe.
    """
    violations = []
    for i in range(len(location_names) - 1):
        loc1_name = location_names[i]
        loc2_name = location_names[i + 1]

        if loc1_name not in LOCATIONS or loc2_name not in LOCATIONS:
            continue

        loc1 = LOCATIONS[loc1_name]
        loc2 = LOCATIONS[loc2_name]

        crosses, zone_name = segment_crosses_no_fly_zone(
            loc1["x"], loc1["y"], loc2["x"], loc2["y"]
        )
        if crosses:
            violations.append({
                "from": loc1_name,
                "to": loc2_name,
                "zone": zone_name,
            })
            logger.warning(
                f"[GEOFENCE] Route {loc1_name} → {loc2_name} crosses {zone_name}"
            )

    return violations


def get_no_fly_zones() -> list[dict]:
    """Return all no-fly zones (for map display)."""
    return NO_FLY_ZONES


# --- Quick test ---
if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    print("=== Point-in-zone checks ===")
    # Military Zone Alpha: polygon [(-20,80),(-20,120),(30,120),(30,80)]
    print(f"  (0, 100) in zone: {is_in_no_fly_zone(0, 100)}")    # Should be True
    print(f"  (0, 0) in zone: {is_in_no_fly_zone(0, 0)}")        # Should be False
    print(f"  (200, -30) in zone: {is_in_no_fly_zone(200, -30)}") # Should be False

    print("\n=== Segment crossing checks ===")
    # Depot (0,0) to Clinic B (-50,150) — should cross Military Zone Alpha
    crosses, zone = segment_crosses_no_fly_zone(0, 0, -50, 150)
    print(f"  Depot → Clinic B crosses zone: {crosses} ({zone})")

    # Depot (0,0) to Clinic C (200,-30) — should not cross
    crosses, zone = segment_crosses_no_fly_zone(0, 0, 200, -30)
    print(f"  Depot → Clinic C crosses zone: {crosses} ({zone})")

    print("\n=== Full route safety check ===")
    violations = check_route_safety(["Depot", "Clinic B", "Clinic A", "Clinic C", "Depot"])
    if violations:
        for v in violations:
            print(f"  VIOLATION: {v['from']} → {v['to']} crosses {v['zone']}")
    else:
        print("  Route is safe!")
