"""
DroneMedic - AI Error Analysis

Tracks, categorizes, and reports parsing failures systematically.
Provides error taxonomy and analysis tools for improving parser reliability.
"""

import json
from dataclasses import dataclass, field, asdict
from datetime import datetime
from enum import Enum


class ErrorType(Enum):
    """Taxonomy of AI parsing errors."""
    JSON_PARSE_FAILURE = "json_parse_failure"
    INVALID_LOCATION = "invalid_location"
    MISSING_FIELD = "missing_field"
    TYPE_ERROR = "type_error"
    EMPTY_RESULT = "empty_result"
    API_ERROR = "api_error"
    LOW_CONFIDENCE = "low_confidence"
    VALIDATION_ERROR = "validation_error"
    EMPTY_INPUT = "empty_input"


@dataclass
class ErrorRecord:
    """A single parsing error event."""
    error_type: ErrorType
    error_message: str
    input_text: str
    raw_response: str = ""
    attempt_number: int = 1
    timestamp: str = field(default_factory=lambda: datetime.now().isoformat())

    def to_dict(self) -> dict:
        d = asdict(self)
        d["error_type"] = self.error_type.value
        return d


class ErrorTracker:
    """
    Tracks parsing errors in-memory with analysis and export capabilities.
    """

    def __init__(self):
        self._errors: list[ErrorRecord] = []

    def log_error(self, record: ErrorRecord) -> None:
        """Log a new error record."""
        self._errors.append(record)

    def get_summary(self) -> dict:
        """
        Get aggregate error statistics.

        Returns:
            Dict with total_errors, error_rate_by_type, most_common_type, and recent_count.
        """
        total = len(self._errors)
        if total == 0:
            return {
                "total_errors": 0,
                "error_counts": {},
                "most_common_type": None,
                "recent_count": 0,
            }

        # Count by type
        counts = {}
        for err in self._errors:
            type_name = err.error_type.value
            counts[type_name] = counts.get(type_name, 0) + 1

        most_common = max(counts, key=counts.get)

        return {
            "total_errors": total,
            "error_counts": counts,
            "most_common_type": most_common,
            "recent_count": min(total, 10),
        }

    def get_recent(self, n: int = 10) -> list[ErrorRecord]:
        """Get the N most recent errors."""
        return self._errors[-n:]

    def get_errors_by_type(self, error_type: ErrorType) -> list[ErrorRecord]:
        """Get all errors of a specific type."""
        return [e for e in self._errors if e.error_type == error_type]

    def clear(self) -> None:
        """Clear all tracked errors."""
        self._errors.clear()

    def export_json(self, filepath: str) -> None:
        """Export full error log to a JSON file."""
        data = {
            "exported_at": datetime.now().isoformat(),
            "total_errors": len(self._errors),
            "errors": [e.to_dict() for e in self._errors],
        }
        with open(filepath, "w") as f:
            json.dump(data, f, indent=2)

    def format_report(self) -> str:
        """Generate a human-readable error analysis report."""
        summary = self.get_summary()

        lines = [
            "=" * 60,
            "  DroneMedic AI — Error Analysis Report",
            "=" * 60,
            f"  Total Errors Logged: {summary['total_errors']}",
        ]

        if summary["total_errors"] == 0:
            lines.append("  No errors recorded.")
            lines.append("=" * 60)
            return "\n".join(lines)

        lines.append(f"  Most Common Error:  {summary['most_common_type']}")
        lines.append("")
        lines.append("  Error Breakdown:")
        lines.append("  " + "-" * 40)

        for error_type, count in sorted(summary["error_counts"].items(), key=lambda x: -x[1]):
            pct = (count / summary["total_errors"]) * 100
            bar = "█" * int(pct / 5) + "░" * (20 - int(pct / 5))
            lines.append(f"  {error_type:<25} {count:>3} ({pct:5.1f}%) {bar}")

        # Show recent errors
        recent = self.get_recent(5)
        if recent:
            lines.append("")
            lines.append("  Recent Errors:")
            lines.append("  " + "-" * 40)
            for err in recent:
                input_preview = err.input_text[:50] + "..." if len(err.input_text) > 50 else err.input_text
                lines.append(f"  [{err.error_type.value}] {input_preview}")
                lines.append(f"    → {err.error_message}")

        lines.append("=" * 60)
        return "\n".join(lines)


# --- Module-level singleton ---
_tracker = ErrorTracker()


def log_error(error_type: ErrorType, error_message: str, input_text: str,
              raw_response: str = "", attempt_number: int = 1) -> None:
    """Convenience function to log an error to the global tracker."""
    record = ErrorRecord(
        error_type=error_type,
        error_message=error_message,
        input_text=input_text,
        raw_response=raw_response,
        attempt_number=attempt_number,
    )
    _tracker.log_error(record)


def get_error_summary() -> dict:
    """Get summary from the global tracker."""
    return _tracker.get_summary()


def get_error_report() -> str:
    """Get formatted report from the global tracker."""
    return _tracker.format_report()


def get_tracker() -> ErrorTracker:
    """Get the global error tracker instance."""
    return _tracker


# --- Quick test ---
if __name__ == "__main__":
    # Demo with sample errors
    log_error(ErrorType.JSON_PARSE_FAILURE, "Invalid JSON in response", "Deliver insulin to Clinic A", raw_response="Sure! Here's the delivery plan...")
    log_error(ErrorType.INVALID_LOCATION, "Unknown location 'Clinic X'", "Send blood to Clinic X")
    log_error(ErrorType.JSON_PARSE_FAILURE, "Markdown in response", "Send vaccines", raw_response="```json{...}```")
    log_error(ErrorType.EMPTY_INPUT, "Empty input provided", "")
    log_error(ErrorType.API_ERROR, "Rate limit exceeded", "Deliver bandages to Clinic C")

    print(get_error_report())
