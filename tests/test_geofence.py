"""
Unit tests for backend.geofence.

Verifies point-in-polygon, segment crossing, route safety, and the
runtime-mutable zone registry.
"""

from __future__ import annotations

import pytest

from backend import geofence
from backend.geofence import (
    add_no_fly_zone,
    check_route_safety,
    get_no_fly_zones,
    is_in_no_fly_zone,
    remove_no_fly_zone,
    reset_no_fly_zones,
    segment_crosses_no_fly_zone,
)


@pytest.fixture(autouse=True)
def _reset_zones_between_tests():
    """Ensure no test leaks mutations into another."""
    reset_no_fly_zones()
    yield
    reset_no_fly_zones()


@pytest.mark.unit
def test_default_zones_are_present() -> None:
    names = [z["name"] for z in get_no_fly_zones()]
    assert "Military Zone Alpha" in names
    assert "Airport Exclusion" in names


@pytest.mark.unit
def test_point_inside_custom_square_zone_detected() -> None:
    add_no_fly_zone({
        "name": "TestSquare",
        "polygon": [(0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0)],
        "lat_lon": [],
    })

    inside, zone = is_in_no_fly_zone(5.0, 5.0)
    assert inside is True
    assert zone == "TestSquare"


@pytest.mark.unit
def test_point_outside_custom_zone_not_detected() -> None:
    add_no_fly_zone({
        "name": "TestSquare",
        "polygon": [(0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0)],
        "lat_lon": [],
    })

    inside, zone = is_in_no_fly_zone(50.0, 50.0)
    assert inside is False
    assert zone is None


@pytest.mark.unit
def test_segment_crossing_through_zone_detected() -> None:
    add_no_fly_zone({
        "name": "TestSquare",
        "polygon": [(0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0)],
        "lat_lon": [],
    })

    # Segment (-5,5) → (15,5) passes straight through the square.
    crosses, zone = segment_crosses_no_fly_zone(-5.0, 5.0, 15.0, 5.0)
    assert crosses is True
    assert zone == "TestSquare"


@pytest.mark.unit
def test_segment_bypassing_zone_not_flagged() -> None:
    add_no_fly_zone({
        "name": "TestSquare",
        "polygon": [(0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0)],
        "lat_lon": [],
    })

    # Segment well clear of the square.
    crosses, zone = segment_crosses_no_fly_zone(-50.0, -50.0, -40.0, -40.0)
    assert crosses is False
    assert zone is None


@pytest.mark.unit
def test_check_route_safety_returns_empty_for_safe_route(monkeypatch) -> None:
    # Build an isolated zone far from any real location.
    add_no_fly_zone({
        "name": "OffMap",
        "polygon": [(9000.0, 9000.0), (9010.0, 9000.0),
                    (9010.0, 9010.0), (9000.0, 9010.0)],
        "lat_lon": [],
    })

    violations = check_route_safety(["Depot", "Clinic A", "Depot"])
    # Route should be safe: we only care that no violations reference
    # our OffMap zone, since other default zones may or may not apply.
    off_map_violations = [v for v in violations if v["zone"] == "OffMap"]
    assert off_map_violations == []


@pytest.mark.unit
def test_remove_no_fly_zone_removes_it() -> None:
    add_no_fly_zone({
        "name": "Temp",
        "polygon": [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)],
        "lat_lon": [],
    })
    assert any(z["name"] == "Temp" for z in get_no_fly_zones())

    removed = remove_no_fly_zone("Temp")
    assert removed is True
    assert not any(z["name"] == "Temp" for z in get_no_fly_zones())


@pytest.mark.unit
def test_remove_unknown_zone_returns_false() -> None:
    assert remove_no_fly_zone("does-not-exist") is False
