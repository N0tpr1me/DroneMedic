"""DroneMedic — Route planning service.

Thin wrapper around backend.route_planner with geofence validation.
"""

from __future__ import annotations

from backend.route_planner import compute_route, recompute_route
from backend.geofence import check_route_safety


class RouteService:

    def compute(
        self,
        locations: list[str],
        priorities: dict[str, str],
        num_drones: int = 1,
        time_windows: dict[str, int] | None = None,
        use_gps: bool = False,
    ) -> dict:
        """Compute optimal route(s) and validate geofence safety."""
        result = compute_route(
            locations=locations,
            priorities=priorities,
            num_drones=num_drones,
            time_windows=time_windows,
            use_gps=use_gps,
        )
        violations = check_route_safety(result.get("ordered_route", []))
        result["no_fly_violations"] = violations
        return result

    def recompute(
        self,
        current_location: str,
        remaining: list[str],
        new_locations: list[str],
        priorities: dict[str, str],
    ) -> dict:
        """Recompute route mid-flight from current position."""
        return recompute_route(
            current_location=current_location,
            remaining_locations=remaining,
            new_locations=new_locations,
            priorities=priorities,
        )

    def validate_safety(self, route: list[str]) -> list[dict]:
        """Check an ordered route for no-fly zone violations."""
        return check_route_safety(route)
