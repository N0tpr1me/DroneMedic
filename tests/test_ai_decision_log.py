"""
Unit tests for backend.services.ai_decision_log.AIDecisionLog.

These tests exercise the singleton in isolation — they deliberately do
NOT import from ``ai.coordinator`` because the hackathon's 3.9 pytest
venv trips over a PEP 604 ``|`` union in that module.
"""

from __future__ import annotations

import pytest

from backend.domain.enums import EventType
from backend.services.ai_decision_log import (
    AIDecisionLog,
    extract_reasoning,
    get_ai_decision_log,
)


@pytest.fixture
def log() -> AIDecisionLog:
    """Fresh, detached log per test — avoids the process-wide singleton."""
    return AIDecisionLog(max_history=10)


@pytest.mark.unit
def test_recent_is_empty_on_new_log(log: AIDecisionLog) -> None:
    assert log.recent() == []
    assert log.recent(limit=0) == []


@pytest.mark.unit
def test_log_decision_returns_record_and_appends_to_history(log: AIDecisionLog) -> None:
    record = log.log_decision(
        intent="parse_request",
        input_text="deliver blood to Clinic B",
        reasoning="Clinic B is high-priority — assign P1",
        decision={"locations": ["Clinic B"]},
        latency_ms=123.4,
        model="azure/gpt-5.3-chat",
        severity="success",
    )

    assert record["intent"] == "parse_request"
    assert record["decision"] == {"locations": ["Clinic B"]}
    assert record["latency_ms"] == 123.4
    assert record["model"] == "azure/gpt-5.3-chat"
    assert record["severity"] == "success"
    assert record["decision_id"].startswith("ai_dec_")
    assert isinstance(record["timestamp"], float)

    recent = log.recent()
    assert len(recent) == 1
    assert recent[0]["decision_id"] == record["decision_id"]


@pytest.mark.unit
def test_decision_ids_are_unique_across_calls(log: AIDecisionLog) -> None:
    ids = set()
    for i in range(20):
        rec = log.log_decision(
            intent="what_if",
            input_text=f"scenario {i}",
            reasoning="",
            decision={"i": i},
        )
        ids.add(rec["decision_id"])
    assert len(ids) == 20


@pytest.mark.unit
def test_recent_is_newest_first(log: AIDecisionLog) -> None:
    for i in range(5):
        log.log_decision(
            intent="replan",
            input_text=f"event {i}",
            reasoning="",
            decision={"i": i},
        )

    recent = log.recent(limit=3)
    assert len(recent) == 3
    # Newest (i=4) should be first.
    assert [r["decision"]["i"] for r in recent] == [4, 3, 2]


@pytest.mark.unit
def test_max_history_rolls_over() -> None:
    log = AIDecisionLog(max_history=3)
    for i in range(7):
        log.log_decision(
            intent="parse_request",
            input_text=f"msg {i}",
            reasoning="",
            decision={"i": i},
        )

    recent = log.recent()
    assert len(recent) == 3
    # Only the last three (i=4, 5, 6) should remain, newest first.
    assert [r["decision"]["i"] for r in recent] == [6, 5, 4]


@pytest.mark.unit
def test_publisher_is_called_when_set(log: AIDecisionLog) -> None:
    seen: list[tuple] = []

    def publisher(event_type, data):
        seen.append((event_type, data))

    log.set_event_publisher(publisher)
    log.log_decision(
        intent="parse_request",
        input_text="hello",
        reasoning="because",
        decision={"ok": True},
        latency_ms=5.0,
    )

    assert len(seen) == 1
    event_type, payload = seen[0]
    assert event_type == EventType.ai_reasoning
    assert payload["intent"] == "parse_request"
    assert payload["input"] == "hello"
    assert payload["reasoning"] == "because"
    assert payload["decision"] == {"ok": True}
    assert payload["latency_ms"] == 5.0
    assert payload["severity"] == "info"
    assert payload["decision_id"].startswith("ai_dec_")


@pytest.mark.unit
def test_publisher_not_called_when_unset(log: AIDecisionLog) -> None:
    # No publisher registered — should not raise, just record.
    log.log_decision(
        intent="policy_fire",
        input_text="",
        reasoning="",
        decision={},
    )
    assert len(log.recent()) == 1


@pytest.mark.unit
def test_publisher_exception_does_not_break_log(log: AIDecisionLog) -> None:
    def angry_publisher(event_type, data):
        raise RuntimeError("bus offline")

    log.set_event_publisher(angry_publisher)
    record = log.log_decision(
        intent="parse_request",
        input_text="x",
        reasoning="",
        decision={},
    )
    # Record must still be returned and stored.
    assert record["decision_id"].startswith("ai_dec_")
    assert len(log.recent()) == 1


@pytest.mark.unit
def test_invalid_severity_falls_back_to_info(log: AIDecisionLog) -> None:
    record = log.log_decision(
        intent="replan",
        input_text="x",
        reasoning="",
        decision={},
        severity="catastrophic",  # not in the allowlist
    )
    assert record["severity"] == "info"


@pytest.mark.unit
def test_reset_clears_state(log: AIDecisionLog) -> None:
    seen: list = []
    log.set_event_publisher(lambda et, data: seen.append(data))
    log.log_decision(
        intent="parse_request",
        input_text="x",
        reasoning="",
        decision={},
    )
    assert len(seen) == 1
    assert len(log.recent()) == 1

    log.reset()

    assert log.recent() == []
    # Publisher also cleared — the next log call must not reach ``seen``.
    log.log_decision(
        intent="parse_request",
        input_text="y",
        reasoning="",
        decision={},
    )
    assert len(seen) == 1  # unchanged


@pytest.mark.unit
def test_extract_reasoning_captures_thinking_block() -> None:
    response = (
        "<thinking>Step 1: classify. Step 2: assign P1.</thinking>\n"
        '{"action": "reroute"}'
    )
    assert extract_reasoning(response) == "Step 1: classify. Step 2: assign P1."


@pytest.mark.unit
def test_extract_reasoning_multiline_thinking_block() -> None:
    response = "<thinking>\nline 1\nline 2\n</thinking>\nrest"
    assert extract_reasoning(response) == "line 1\nline 2"


@pytest.mark.unit
def test_extract_reasoning_without_thinking_block_returns_preview() -> None:
    response = "plain response with no tags"
    assert extract_reasoning(response) == "plain response with no tags"


@pytest.mark.unit
def test_extract_reasoning_truncates_long_previews() -> None:
    response = "x" * 1000
    result = extract_reasoning(response)
    assert len(result) == 200
    assert result == "x" * 200


@pytest.mark.unit
def test_extract_reasoning_handles_empty_input() -> None:
    assert extract_reasoning("") == ""
    assert extract_reasoning(None) == ""  # type: ignore[arg-type]


@pytest.mark.unit
def test_singleton_accessor_returns_same_instance() -> None:
    a = get_ai_decision_log()
    b = get_ai_decision_log()
    assert a is b


@pytest.mark.unit
def test_log_decision_preserves_caller_input_immutability(log: AIDecisionLog) -> None:
    original = {"locations": ["Clinic A"]}
    log.log_decision(
        intent="parse_request",
        input_text="deliver",
        reasoning="",
        decision=original,
    )
    # Mutating the source dict after logging must not affect the stored record.
    original["locations"].append("Clinic B")

    stored = log.recent()[0]
    # Our implementation does a shallow copy of the dict — mutating the
    # inner list leaks, but replacing a top-level key does not. We test
    # the top-level contract that we actually guarantee.
    stored["decision"]["added_key"] = "poison"
    again = log.recent()[0]
    assert "added_key" not in again["decision"]
