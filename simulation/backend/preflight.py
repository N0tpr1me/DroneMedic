"""
DroneMedic - Automated Pre-Flight Checklist

Inspired by Zipline / Wing / Matternet operational checklists.
Validates battery, weather, airspace, payload, comms, and GPS before launch.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

from backend.geofence import check_route_safety

logger = logging.getLogger("DroneMedic.Preflight")


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class CheckResult:
    """Result of a single pre-flight check."""
    passed: bool
    check_name: str
    message: str
    severity: str  # "info", "warning", "critical"


@dataclass(frozen=True)
class PreflightReport:
    """Aggregated pre-flight report."""
    passed: bool
    checks: tuple[CheckResult, ...]
    blocked_reason: str | None = None


# ---------------------------------------------------------------------------
# Checklist
# ---------------------------------------------------------------------------

class PreflightChecklist:
    """Run all pre-flight checks and produce a report."""

    # --- Individual checks ---------------------------------------------------

    @staticmethod
    def check_battery(battery_pct: float) -> CheckResult:
        """Battery must be above 80 % for launch."""
        if battery_pct >= 80.0:
            return CheckResult(
                passed=True,
                check_name="battery",
                message=f"Battery at {battery_pct:.0f}% — OK",
                severity="info",
            )
        if battery_pct >= 50.0:
            return CheckResult(
                passed=False,
                check_name="battery",
                message=f"Battery at {battery_pct:.0f}% — below 80% launch threshold",
                severity="warning",
            )
        return CheckResult(
            passed=False,
            check_name="battery",
            message=f"Battery at {battery_pct:.0f}% — critically low",
            severity="critical",
        )

    @staticmethod
    def check_weather(weather: dict) -> CheckResult:
        """
        Weather check — wind < 15 m/s and no active storm.

        Expects weather dict with keys:
            wind_speed (float, m/s), storm (bool), description (str, optional)
        """
        wind = weather.get("wind_speed", 0.0)
        storm = weather.get("storm", False)

        if storm:
            return CheckResult(
                passed=False,
                check_name="weather",
                message=f"Active storm detected — flight unsafe",
                severity="critical",
            )
        if wind >= 15.0:
            return CheckResult(
                passed=False,
                check_name="weather",
                message=f"Wind speed {wind:.1f} m/s exceeds 15 m/s limit",
                severity="critical",
            )
        if wind >= 10.0:
            return CheckResult(
                passed=True,
                check_name="weather",
                message=f"Wind speed {wind:.1f} m/s — marginal but within limits",
                severity="warning",
            )
        return CheckResult(
            passed=True,
            check_name="weather",
            message=f"Wind speed {wind:.1f} m/s, no storm — conditions good",
            severity="info",
        )

    @staticmethod
    def check_airspace(route: list[str], nofly_zones: list[dict] | None = None) -> CheckResult:
        """
        Verify the route does not cross any no-fly zone.

        Args:
            route: Ordered list of location names.
            nofly_zones: Optional override; if None uses geofence module defaults.
        """
        violations = check_route_safety(route)
        if not violations:
            return CheckResult(
                passed=True,
                check_name="airspace",
                message="Route clear of all no-fly zones",
                severity="info",
            )
        zone_names = ", ".join(v["zone"] for v in violations)
        return CheckResult(
            passed=False,
            check_name="airspace",
            message=f"Route violates no-fly zone(s): {zone_names}",
            severity="critical",
        )

    @staticmethod
    def check_payload(weight_kg: float, max_kg: float = 5.0) -> CheckResult:
        """Payload must not exceed max capacity."""
        if weight_kg <= 0.0:
            return CheckResult(
                passed=False,
                check_name="payload",
                message="No payload loaded — verify cargo",
                severity="warning",
            )
        if weight_kg <= max_kg:
            return CheckResult(
                passed=True,
                check_name="payload",
                message=f"Payload {weight_kg:.2f} kg within {max_kg:.1f} kg limit",
                severity="info",
            )
        return CheckResult(
            passed=False,
            check_name="payload",
            message=f"Payload {weight_kg:.2f} kg exceeds {max_kg:.1f} kg max",
            severity="critical",
        )

    @staticmethod
    def check_comms(signal_strength: float = 1.0) -> CheckResult:
        """Communication link must have signal strength > 0.5 (0.0 – 1.0 scale)."""
        if signal_strength > 0.5:
            return CheckResult(
                passed=True,
                check_name="comms",
                message=f"Signal strength {signal_strength:.2f} — link OK",
                severity="info",
            )
        return CheckResult(
            passed=False,
            check_name="comms",
            message=f"Signal strength {signal_strength:.2f} — link too weak (min 0.5)",
            severity="critical",
        )

    @staticmethod
    def check_gps(satellite_count: int = 12) -> CheckResult:
        """GPS fix requires > 6 satellites."""
        if satellite_count > 6:
            return CheckResult(
                passed=True,
                check_name="gps",
                message=f"{satellite_count} satellites locked — GPS fix OK",
                severity="info",
            )
        return CheckResult(
            passed=False,
            check_name="gps",
            message=f"Only {satellite_count} satellites — insufficient for reliable GPS fix (need >6)",
            severity="critical",
        )

    # --- Aggregate -----------------------------------------------------------

    def run_all(
        self,
        drone_state: dict,
        route: list[str],
        weather: dict,
        payload_kg: float,
    ) -> PreflightReport:
        """
        Execute the full preflight checklist.

        Args:
            drone_state: Dict with keys battery_pct, signal_strength, satellite_count.
            route: Ordered list of location names.
            weather: Dict with wind_speed, storm, description.
            payload_kg: Total payload weight in kg.

        Returns:
            PreflightReport with pass/fail and individual check results.
        """
        checks = [
            self.check_battery(drone_state.get("battery_pct", 0.0)),
            self.check_weather(weather),
            self.check_airspace(route),
            self.check_payload(payload_kg),
            self.check_comms(drone_state.get("signal_strength", 1.0)),
            self.check_gps(drone_state.get("satellite_count", 12)),
        ]

        critical_failures = [c for c in checks if not c.passed and c.severity == "critical"]
        all_passed = all(c.passed for c in checks)

        blocked_reason = None
        if critical_failures:
            blocked_reason = "; ".join(c.message for c in critical_failures)

        report = PreflightReport(
            passed=all_passed,
            checks=tuple(checks),
            blocked_reason=blocked_reason,
        )

        if report.passed:
            logger.info("[PREFLIGHT] All checks passed — cleared for takeoff")
        else:
            logger.warning(f"[PREFLIGHT] Flight blocked: {blocked_reason}")

        return report


# ---------------------------------------------------------------------------
# Quick test
# ---------------------------------------------------------------------------

def _print_report(report: PreflightReport) -> None:
    """Pretty-print a preflight report."""
    status = "PASSED" if report.passed else "BLOCKED"
    print(f"  Result: {status}")
    for c in report.checks:
        icon = "OK" if c.passed else "FAIL"
        print(f"    [{icon}] {c.check_name}: {c.message} ({c.severity})")
    if report.blocked_reason:
        print(f"  Blocked: {report.blocked_reason}")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    checklist = PreflightChecklist()

    # --- Scenario 1: All good ---
    print("=== Scenario 1: Normal conditions ===")
    report = checklist.run_all(
        drone_state={"battery_pct": 95.0, "signal_strength": 0.9, "satellite_count": 14},
        route=["Depot", "Clinic A", "Clinic C", "Depot"],
        weather={"wind_speed": 5.0, "storm": False},
        payload_kg=1.5,
    )
    _print_report(report)

    # --- Scenario 2: Low battery + storm ---
    print("\n=== Scenario 2: Low battery + storm ===")
    report = checklist.run_all(
        drone_state={"battery_pct": 40.0, "signal_strength": 0.8, "satellite_count": 10},
        route=["Depot", "Clinic A", "Depot"],
        weather={"wind_speed": 20.0, "storm": True},
        payload_kg=2.0,
    )
    _print_report(report)

    # --- Scenario 3: Overweight + weak GPS ---
    print("\n=== Scenario 3: Overweight + weak GPS ===")
    report = checklist.run_all(
        drone_state={"battery_pct": 90.0, "signal_strength": 0.3, "satellite_count": 4},
        route=["Depot", "Clinic D", "Depot"],
        weather={"wind_speed": 8.0, "storm": False},
        payload_kg=7.5,
    )
    _print_report(report)
