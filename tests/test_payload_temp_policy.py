"""
Unit tests for the payload temperature excursion safety policy plus a
regression guard for an existing disaster event type.
"""

from __future__ import annotations

import pytest

from config import LOCATIONS
from backend.safety import (
    DisasterEvent,
    DisasterResponse,
    DisasterSeverity,
    MissionAction,
    handle_disaster_event,
)
from backend.services.ai_decision_log import get_ai_decision_log


@pytest.fixture(autouse=True)
def _reset_ai_log() -> None:
    """Ensure the process-wide decision log does not leak across tests."""
    get_ai_decision_log().reset()
    yield
    get_ai_decision_log().reset()


def _position_near_royal_london() -> dict:
    base = dict(LOCATIONS["Royal London"])
    # Nudge a small amount so we are "mid-flight" but clearly closest to RL.
    base["lat"] = base["lat"] - 0.002
    base["lon"] = base["lon"] - 0.002
    return base


@pytest.mark.unit
def test_payload_temp_excursion_diverts_to_nearest_hospital() -> None:
    event = DisasterEvent(
        event_type="payload_temp_excursion",
        severity=DisasterSeverity.MAJOR,
        description="Blood temp exceeded 10C",
        payload_type="blood",
        temp_window_remaining_s=600.0,
    )

    response = handle_disaster_event(
        event=event,
        current_position=_position_near_royal_london(),
        remaining_route=["Clinic B", "Depot"],
        battery_remaining_wh=500.0,
        payload_kg=2.5,
    )

    assert isinstance(response, DisasterResponse)
    assert response.action == MissionAction.DIVERT
    assert response.new_route is not None
    assert len(response.new_route) == 1

    diverted_to = response.new_route[0]
    # The diverted-to stop must be one of the registered hospitals.
    hospitals = {"Royal London", "Homerton", "Newham General", "Whipps Cross"}
    assert diverted_to in hospitals

    assert "temperature" in response.reasoning.lower()
    assert diverted_to in response.reasoning


@pytest.mark.unit
def test_payload_temp_excursion_accepts_context_from_new_delivery_dict() -> None:
    """Legacy path: context may be placed on event.new_delivery."""
    event = DisasterEvent(
        event_type="payload_temp_excursion",
        severity=DisasterSeverity.MINOR,
        description="Insulin warming",
        new_delivery={"payload_type": "insulin", "temp_window_remaining_s": 300.0},
    )

    response = handle_disaster_event(
        event=event,
        current_position=_position_near_royal_london(),
        remaining_route=["Clinic A", "Depot"],
        battery_remaining_wh=500.0,
        payload_kg=1.5,
    )

    assert response.action == MissionAction.DIVERT
    assert "insulin" in response.reasoning.lower()
    assert "temperature" in response.reasoning.lower()


@pytest.mark.unit
def test_payload_temp_excursion_is_recorded_in_decision_log() -> None:
    event = DisasterEvent(
        event_type="payload_temp_excursion",
        severity=DisasterSeverity.MAJOR,
        payload_type="vaccine",
        temp_window_remaining_s=900.0,
    )

    log = get_ai_decision_log()
    assert log.recent() == []

    handle_disaster_event(
        event=event,
        current_position=_position_near_royal_london(),
        remaining_route=["Clinic A", "Depot"],
        battery_remaining_wh=500.0,
        payload_kg=2.0,
    )

    entries = log.recent()
    assert len(entries) >= 1
    latest = entries[0]
    assert latest["intent"] == "policy_fire"
    assert latest["decision"]["event_type"] == "payload_temp_excursion"
    assert latest["decision"]["action"] == MissionAction.DIVERT.value


@pytest.mark.unit
def test_lz_blocked_regression_still_returns_reroute() -> None:
    """Existing event types must keep their original semantics."""
    event = DisasterEvent(
        event_type="lz_blocked",
        severity=DisasterSeverity.MAJOR,
        affected_location="Clinic B",
        description="Debris on LZ",
    )

    response = handle_disaster_event(
        event=event,
        current_position=_position_near_royal_london(),
        remaining_route=["Clinic B", "Clinic C", "Depot"],
        battery_remaining_wh=500.0,
        payload_kg=2.5,
    )

    assert response.action == MissionAction.REROUTE
    assert response.new_route == ["Clinic C", "Depot"]
    assert "Clinic B" in response.dropped_stops
    assert "Clinic B" in response.reasoning
