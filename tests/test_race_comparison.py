"""
Integration tests for the ``/api/metrics/race-comparison`` endpoint.

These tests construct a minimal FastAPI app that only mounts the metrics
router. We cannot use ``backend.app.app`` directly in the 3.9 pytest venv
because that transitively imports ``ai.coordinator`` which has a pre-
existing PEP 604 syntax issue on Python 3.9.
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.routes.race import router as race_router


@pytest.fixture(scope="module")
def client() -> TestClient:
    app = FastAPI()
    app.include_router(race_router)
    return TestClient(app)


@pytest.mark.integration
def test_race_comparison_returns_expected_shape(client: TestClient) -> None:
    resp = client.get(
        "/api/metrics/race-comparison",
        params={"locations": "Royal London,Homerton"},
    )

    assert resp.status_code == 200
    body = resp.json()

    expected_keys = {
        "locations",
        "drone_seconds",
        "ambulance_seconds",
        "seconds_saved",
        "percent_saved",
        "drone_distance_m",
        "ambulance_distance_m",
        "assumptions",
    }
    assert expected_keys.issubset(body.keys())

    assert body["locations"] == ["Royal London", "Homerton"]

    assert body["drone_seconds"] > 0
    assert body["ambulance_seconds"] > body["drone_seconds"]
    assert body["seconds_saved"] == body["ambulance_seconds"] - body["drone_seconds"]
    assert 0 <= body["percent_saved"] <= 100

    # Sanity-check the assumption block has the expected keys.
    assumptions = body["assumptions"]
    for key in (
        "drone_cruise_ms",
        "ambulance_avg_ms",
        "road_to_straight_ratio",
        "ambulance_stop_overhead_s",
    ):
        assert key in assumptions


@pytest.mark.integration
def test_race_comparison_handles_empty_locations(client: TestClient) -> None:
    resp = client.get(
        "/api/metrics/race-comparison",
        params={"locations": ""},
    )

    assert resp.status_code == 200
    body = resp.json()

    assert body["locations"] == []
    assert body["drone_seconds"] == 0
    assert body["ambulance_seconds"] == 0
    assert body["seconds_saved"] == 0
    assert body["percent_saved"] == 0
    assert body["drone_distance_m"] == 0
    assert body["ambulance_distance_m"] == 0


@pytest.mark.integration
def test_race_comparison_drops_unknown_locations(client: TestClient) -> None:
    resp = client.get(
        "/api/metrics/race-comparison",
        params={"locations": "Royal London,Not A Real Place,Homerton"},
    )

    assert resp.status_code == 200
    body = resp.json()

    # "Not A Real Place" should be filtered out.
    assert body["locations"] == ["Royal London", "Homerton"]


@pytest.mark.integration
def test_race_comparison_all_invalid_returns_zeros(client: TestClient) -> None:
    resp = client.get(
        "/api/metrics/race-comparison",
        params={"locations": "Mars,Moon,Atlantis"},
    )

    assert resp.status_code == 200
    body = resp.json()

    assert body["locations"] == []
    assert body["drone_seconds"] == 0
    assert body["ambulance_seconds"] == 0
