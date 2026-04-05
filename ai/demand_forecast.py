"""Demand forecasting for medical supply deliveries per facility.

Uses exponential smoothing to predict near-term delivery volumes
and supply breakdowns for each facility.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta
from typing import Any


class DemandForecaster:
    """Simple exponential smoothing for delivery demand prediction."""

    def __init__(self, alpha: float = 0.3) -> None:
        self.alpha = alpha  # smoothing factor

    def forecast(
        self,
        facility_name: str,
        history: list[dict[str, Any]],
        horizon_days: int = 7,
    ) -> dict[str, Any]:
        """Forecast demand for a facility over the next *horizon_days* days.

        Args:
            facility_name: Human-readable facility identifier.
            history: Past deliveries, each ``{"date": "YYYY-MM-DD", "supply": str, "count": int}``.
            horizon_days: Number of days to project forward.

        Returns:
            Forecast payload with daily predictions, trend, and summary stats.
        """
        if not history:
            return self._empty_forecast(facility_name, horizon_days)

        # --- aggregate history by date ---
        daily_counts: dict[str, int] = defaultdict(int)
        supply_counts: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))

        for entry in history:
            date_str = entry.get("date", "")[:10]  # YYYY-MM-DD
            count = entry.get("count", 1)
            supply = entry.get("supply", "unknown")
            daily_counts[date_str] += count
            supply_counts[date_str][supply] += count

        sorted_dates = sorted(daily_counts.keys())
        values = [daily_counts[d] for d in sorted_dates]

        # --- exponential smoothing projection ---
        forecast_values = self._exponential_smooth(values, horizon_days)

        # --- build per-day forecast records ---
        last_date = (
            datetime.strptime(sorted_dates[-1], "%Y-%m-%d")
            if sorted_dates
            else datetime.now()
        )

        # historical supply ratios
        total_supplies: dict[str, int] = defaultdict(int)
        for sc in supply_counts.values():
            for supply, count in sc.items():
                total_supplies[supply] += count
        total = sum(total_supplies.values()) or 1

        forecast_days: list[dict[str, Any]] = []
        for i, predicted in enumerate(forecast_values):
            date = last_date + timedelta(days=i + 1)
            ci_low = max(0, int(predicted * 0.6))
            ci_high = int(predicted * 1.5) + 1
            supplies = {
                s: max(1, round(predicted * c / total))
                for s, c in total_supplies.items()
            }

            forecast_days.append(
                {
                    "date": date.strftime("%Y-%m-%d"),
                    "predicted_deliveries": round(predicted),
                    "supplies": dict(supplies),
                    "confidence_low": ci_low,
                    "confidence_high": ci_high,
                }
            )

        # --- trend detection ---
        trend = self._detect_trend(values)

        return {
            "facility": facility_name,
            "generated_at": datetime.now().isoformat(),
            "forecast": forecast_days,
            "trend": trend,
            "history_days_analyzed": len(sorted_dates),
            "avg_daily_demand": round(sum(values) / max(len(values), 1), 1),
        }

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    def _exponential_smooth(self, values: list[int | float], horizon: int) -> list[float]:
        """Apply exponential smoothing and project forward as a constant level."""
        if not values:
            return [0.0] * horizon

        smoothed = float(values[0])
        for v in values[1:]:
            smoothed = self.alpha * v + (1 - self.alpha) * smoothed

        return [smoothed] * horizon

    @staticmethod
    def _detect_trend(values: list[int | float]) -> str:
        if len(values) < 3:
            return "insufficient_data"
        recent_avg = sum(values[-3:]) / 3
        older_avg = sum(values[: max(1, len(values) - 3)]) / max(1, len(values) - 3)
        if recent_avg > older_avg * 1.1:
            return "increasing"
        if recent_avg < older_avg * 0.9:
            return "decreasing"
        return "stable"

    def _empty_forecast(self, facility_name: str, horizon: int) -> dict[str, Any]:
        now = datetime.now()
        return {
            "facility": facility_name,
            "generated_at": now.isoformat(),
            "forecast": [
                {
                    "date": (now + timedelta(days=i + 1)).strftime("%Y-%m-%d"),
                    "predicted_deliveries": 0,
                    "supplies": {},
                    "confidence_low": 0,
                    "confidence_high": 0,
                }
                for i in range(horizon)
            ],
            "trend": "no_data",
            "history_days_analyzed": 0,
            "avg_daily_demand": 0,
        }


# ── Demo data ────────────────────────────────────────────────────────────

_DEMO_HISTORY: list[dict[str, Any]] = [
    {"date": "2026-03-28", "supply": "insulin", "count": 4},
    {"date": "2026-03-28", "supply": "blood", "count": 2},
    {"date": "2026-03-29", "supply": "insulin", "count": 3},
    {"date": "2026-03-29", "supply": "bandages", "count": 5},
    {"date": "2026-03-30", "supply": "insulin", "count": 5},
    {"date": "2026-03-30", "supply": "blood", "count": 3},
    {"date": "2026-03-31", "supply": "vaccines", "count": 2},
    {"date": "2026-03-31", "supply": "insulin", "count": 4},
    {"date": "2026-04-01", "supply": "insulin", "count": 6},
    {"date": "2026-04-01", "supply": "blood", "count": 4},
    {"date": "2026-04-01", "supply": "bandages", "count": 3},
    {"date": "2026-04-02", "supply": "insulin", "count": 5},
    {"date": "2026-04-02", "supply": "epinephrine", "count": 1},
    {"date": "2026-04-03", "supply": "blood", "count": 5},
    {"date": "2026-04-03", "supply": "insulin", "count": 7},
    {"date": "2026-04-04", "supply": "insulin", "count": 6},
    {"date": "2026-04-04", "supply": "bandages", "count": 4},
    {"date": "2026-04-04", "supply": "blood", "count": 3},
]


def get_demo_forecast(facility_name: str = "Royal London") -> dict[str, Any]:
    """Return a realistic demo forecast seeded from hardcoded history."""
    forecaster = DemandForecaster(alpha=0.3)
    return forecaster.forecast(facility_name, _DEMO_HISTORY, horizon_days=7)


# ── Quick test ───────────────────────────────────────────────────────────

if __name__ == "__main__":
    import json

    result = get_demo_forecast()
    print(json.dumps(result, indent=2))
