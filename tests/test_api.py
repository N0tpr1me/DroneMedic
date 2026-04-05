"""API smoke tests for DroneMedic backend."""

import pytest

# These tests verify the API endpoints exist and return valid responses.
# Run with: PYTHONPATH=. pytest tests/test_api.py -v


def test_imports():
    """Verify domain modules import cleanly."""
    from backend.domain.models import Mission, Delivery, Drone, Waypoint, Event
    from backend.domain.enums import DroneStatus, MissionStatus, DeliveryStatus, EventType
    from backend.geofence import is_in_no_fly_zone, check_route_safety
    from backend.physics import DroneSpec, compute_hover_power, compute_mtom
    assert True


def test_service_imports():
    """Verify service modules import cleanly (requires openai package)."""
    pytest.importorskip("openai")
    from backend.services.mission_service import MissionService
    from backend.services.drone_service import DroneService
    from backend.services.event_service import EventService
    assert True


def test_config_loads():
    """Verify config.py loads without error."""
    import config
    assert hasattr(config, 'LOCATIONS')
    assert hasattr(config, 'NO_FLY_ZONES')
    assert hasattr(config, 'SUPPLY_WEIGHTS')
    assert len(config.LOCATIONS) >= 5
    assert config.NUM_DRONES >= 1


def test_domain_models():
    """Verify Pydantic models create correctly."""
    from backend.domain.models import Drone, Mission, Delivery
    from backend.domain.enums import DroneStatus, MissionStatus

    drone = Drone(id="test-1", status=DroneStatus.idle)
    assert drone.battery == 100.0
    assert drone.status == DroneStatus.idle

    mission = Mission()
    assert mission.status == MissionStatus.planning
    assert mission.reroute_count == 0

    delivery = Delivery(destination="Royal London")
    assert delivery.priority == "normal"
    assert delivery.status.value == "pending"


def test_geofence():
    """Verify geofence point-in-polygon checks work."""
    from backend.geofence import _point_in_polygon
    # Point inside Military Zone Alpha
    polygon = [(-20, 80), (-20, 120), (30, 120), (30, 80)]
    assert _point_in_polygon(0, 100, polygon) is True
    # Point outside
    assert _point_in_polygon(100, 100, polygon) is False


def test_geofence_zone_lookup():
    """Verify named no-fly zone lookup returns zone name."""
    from backend.geofence import is_in_no_fly_zone
    # (0, 100) is inside Military Zone Alpha per config
    in_zone, zone_name = is_in_no_fly_zone(0, 100)
    assert in_zone is True
    assert zone_name == "Military Zone Alpha"

    # (0, 0) is the Depot — should be outside all zones
    in_zone, zone_name = is_in_no_fly_zone(0, 0)
    assert in_zone is False
    assert zone_name is None


def test_route_planner():
    """Verify route planner computes routes."""
    from backend.route_planner import compute_route
    result = compute_route(
        locations=["Depot", "Clinic A", "Clinic B"],
        priorities={"Clinic A": "normal", "Clinic B": "normal"},
    )
    assert "ordered_route" in result
    assert "total_distance" in result
    assert result["total_distance"] > 0


def test_physics_engine():
    """Verify physics calculations."""
    from backend.physics import (
        DroneSpec, FlightConditions,
        compute_hover_power, compute_mtom,
    )

    spec = DroneSpec()
    payload_kg = 2.0

    hover_power = compute_hover_power(spec, payload_kg)
    assert hover_power > 0

    mtom = compute_mtom(spec, payload_kg)
    # airframe (8 kg) + battery (4 kg) + payload (2 kg) = 14 kg
    assert mtom == pytest.approx(14.0)
    assert mtom > 10  # airframe + battery + payload


def test_route_safety_check():
    """Verify route safety detects no-fly zone crossings."""
    from backend.geofence import check_route_safety
    # Clinic B (-50,150) -> Clinic A (100,50) crosses Military Zone Alpha
    violations = check_route_safety(["Clinic B", "Clinic A"])
    assert len(violations) >= 1
    assert violations[0]["zone"] == "Military Zone Alpha"

    # Depot -> Clinic A should be safe (no zone crossing on that path)
    safe_violations = check_route_safety(["Depot", "Clinic A"])
    assert len(safe_violations) == 0


def test_supply_weights():
    """Verify medical supply weights are configured."""
    from config import SUPPLY_WEIGHTS
    assert "blood_pack" in SUPPLY_WEIGHTS
    assert "defibrillator" in SUPPLY_WEIGHTS
    assert SUPPLY_WEIGHTS["blood_pack"] == 0.5
    assert SUPPLY_WEIGHTS["defibrillator"] == 2.0
