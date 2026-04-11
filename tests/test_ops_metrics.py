"""
Unit tests for backend.services.ops_metrics_service.OpsMetricsService.

These tests exercise the collector directly without spinning up FastAPI —
they verify the percentile math, counter bucketing, and LLM call
accounting that the /ops/metrics endpoint is built on.
"""

from __future__ import annotations

import pytest

from backend.services.ops_metrics_service import OpsMetricsService


@pytest.fixture
def metrics() -> OpsMetricsService:
    """Fresh collector per test — no shared singleton state."""
    return OpsMetricsService(max_samples=100)


@pytest.mark.unit
def test_empty_snapshot_has_zeroed_percentiles(metrics: OpsMetricsService) -> None:
    snap = metrics.snapshot()

    assert snap["request_latency_ms"]["samples"] == 0
    assert snap["request_latency_ms"]["p50"] == 0.0
    assert snap["request_latency_ms"]["p95"] == 0.0
    assert snap["request_latency_ms"]["max"] == 0.0
    assert snap["counters"]["requests_total"] == 0
    assert snap["llm_error_rate"] == 0.0
    assert snap["uptime_seconds"] >= 0.0


@pytest.mark.unit
def test_status_code_classes_bucket_correctly(metrics: OpsMetricsService) -> None:
    metrics.record_request(10.0, 200)
    metrics.record_request(12.0, 204)
    metrics.record_request(20.0, 404)
    metrics.record_request(30.0, 500)

    counters = metrics.snapshot()["counters"]
    assert counters["requests_total"] == 4
    assert counters["requests_2xx"] == 2
    assert counters["requests_4xx"] == 1
    assert counters["requests_5xx"] == 1


@pytest.mark.unit
def test_percentiles_on_known_distribution(metrics: OpsMetricsService) -> None:
    # Record 100 samples: 1ms .. 100ms.
    for ms in range(1, 101):
        metrics.record_request(float(ms), 200)

    snap = metrics.snapshot()["request_latency_ms"]

    assert snap["samples"] == 100
    # Nearest-rank percentile on [1..100]:
    #   p50 ≈ 50, p95 ≈ 95, p99 ≈ 99, max = 100
    assert snap["p50"] == pytest.approx(50.0, abs=1.0)
    assert snap["p95"] == pytest.approx(95.0, abs=1.0)
    assert snap["p99"] == pytest.approx(99.0, abs=1.0)
    assert snap["max"] == 100.0


@pytest.mark.unit
def test_rolling_window_drops_oldest_samples() -> None:
    metrics = OpsMetricsService(max_samples=10)
    # Push 20 samples; only the last 10 should remain.
    for ms in range(1, 21):
        metrics.record_request(float(ms), 200)

    snap = metrics.snapshot()["request_latency_ms"]
    assert snap["samples"] == 10
    # Oldest (1..10) should be evicted; max is still 20.
    assert snap["max"] == 20.0


@pytest.mark.unit
def test_llm_error_rate_is_derived_correctly(metrics: OpsMetricsService) -> None:
    metrics.record_llm_call("success")
    metrics.record_llm_call("success")
    metrics.record_llm_call("success")
    metrics.record_llm_call("error")

    snap = metrics.snapshot()
    assert snap["counters"]["llm_calls_total"] == 4
    assert snap["counters"]["llm_calls_success"] == 3
    assert snap["counters"]["llm_calls_error"] == 1
    assert snap["llm_error_rate"] == pytest.approx(0.25)


@pytest.mark.unit
def test_unknown_llm_outcome_still_counts_total(metrics: OpsMetricsService) -> None:
    metrics.record_llm_call("weird_outcome")
    snap = metrics.snapshot()
    # Total always advances, even if we don't recognise the bucket.
    assert snap["counters"]["llm_calls_total"] == 1
    assert snap["counters"]["llm_calls_success"] == 0
    assert snap["counters"]["llm_calls_error"] == 0


@pytest.mark.unit
def test_reset_clears_samples_and_counters(metrics: OpsMetricsService) -> None:
    for ms in range(10):
        metrics.record_request(float(ms), 200)
    metrics.record_llm_call("success")

    metrics.reset()

    snap = metrics.snapshot()
    assert snap["request_latency_ms"]["samples"] == 0
    assert snap["counters"]["requests_total"] == 0
    assert snap["counters"]["llm_calls_total"] == 0
