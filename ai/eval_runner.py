"""AI evaluation runner — tests NL parsing accuracy on golden test cases.

Runs each test case through a parser function, scores the output
against expected results, and produces an accuracy report with
per-category breakdowns.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Callable, Awaitable

from ai.test_dataset import get_test_cases, get_categories

logger = logging.getLogger("DroneMedic.EvalRunner")


class EvalRunner:
    """Score a parser function against the golden test dataset."""

    def __init__(self, parser_fn: Callable[[str], Awaitable[dict[str, Any]]]) -> None:
        """
        Args:
            parser_fn: Async callable that accepts a natural-language string
                       and returns a parsed dict.
        """
        self.parser_fn = parser_fn

    async def run(self, categories: list[str] | None = None) -> dict[str, Any]:
        """Run all (or filtered) test cases and compute aggregate metrics.

        Args:
            categories: Optional list of category names to restrict the run.
                        ``None`` runs every category.

        Returns:
            Dict with ``total_cases``, ``accuracy``, ``avg_latency_ms``,
            ``by_category``, and per-result details.
        """
        cases: list[dict[str, Any]] = []
        if categories:
            for cat in categories:
                cases.extend(get_test_cases(cat))
        else:
            cases = get_test_cases()

        results: list[dict[str, Any]] = []

        for case in cases:
            start = time.perf_counter()
            try:
                result = await self.parser_fn(case["input"])
                latency = (time.perf_counter() - start) * 1000
                score = self._score(result, case.get("expected"))
                results.append(
                    {
                        "id": case.get("id", ""),
                        "input": case["input"],
                        "score": score,
                        "latency_ms": round(latency, 1),
                        "success": True,
                        "category": case.get("category", "unknown"),
                    }
                )
            except Exception as exc:
                logger.warning("eval case %s failed: %s", case.get("id"), exc)
                results.append(
                    {
                        "id": case.get("id", ""),
                        "input": case["input"],
                        "score": 0.0,
                        "latency_ms": 0.0,
                        "success": False,
                        "error": str(exc),
                        "category": case.get("category", "unknown"),
                    }
                )

        return self._aggregate(results)

    # ------------------------------------------------------------------
    # Scoring
    # ------------------------------------------------------------------

    @staticmethod
    def _score(result: dict[str, Any], expected: dict[str, Any] | None) -> float:
        """Score a single result against expected output (0.0 – 1.0)."""
        if expected is None:
            # Cases with no expected output (multi-turn, edge-case) — pass if non-empty
            return 1.0 if result else 0.0

        score = 0.0
        checks = 0

        # Location match (set intersection)
        if "locations" in expected:
            parsed_locs = set(result.get("locations", []))
            expected_locs = set(expected["locations"])
            if expected_locs:
                checks += 1
                score += len(parsed_locs & expected_locs) / len(expected_locs)

        # Priority match (exact)
        if "priorities" in expected:
            checks += 1
            if result.get("priorities") == expected["priorities"]:
                score += 1.0

        # Supply match (per-key)
        if "supplies" in expected:
            checks += 1
            parsed_supplies = result.get("supplies", {})
            expected_supplies = expected["supplies"]
            if expected_supplies:
                matches = sum(
                    1
                    for k, v in expected_supplies.items()
                    if parsed_supplies.get(k) == v
                )
                score += matches / len(expected_supplies)

        # Constraint match (structural equality)
        if "constraints" in expected:
            checks += 1
            if result.get("constraints") == expected["constraints"]:
                score += 1.0

        return score / max(checks, 1)

    # ------------------------------------------------------------------
    # Aggregation
    # ------------------------------------------------------------------

    @staticmethod
    def _aggregate(results: list[dict[str, Any]]) -> dict[str, Any]:
        total = len(results)
        successes = [r for r in results if r["success"]]
        accuracy = sum(r["score"] for r in successes) / max(len(successes), 1)
        avg_latency = sum(r["latency_ms"] for r in successes) / max(len(successes), 1)

        by_category: dict[str, dict[str, Any]] = {}
        for r in results:
            cat = r["category"]
            if cat not in by_category:
                by_category[cat] = {"total": 0, "passed": 0, "scores": []}
            by_category[cat]["total"] += 1
            by_category[cat]["scores"].append(r["score"])
            if r["score"] > 0.7:
                by_category[cat]["passed"] += 1

        for cat, data in by_category.items():
            scores = data.pop("scores")
            data["avg_score"] = round(sum(scores) / max(len(scores), 1), 3)

        return {
            "total_cases": total,
            "successful": len(successes),
            "failed": total - len(successes),
            "accuracy": round(accuracy, 3),
            "avg_latency_ms": round(avg_latency, 1),
            "by_category": by_category,
            "results": results,
        }


# ── Quick test ───────────────────────────────────────────────────────────

if __name__ == "__main__":
    import json

    async def _mock_parser(text: str) -> dict[str, Any]:
        """Trivial echo parser for smoke testing the runner itself."""
        return {"locations": [], "priorities": {}, "supplies": {}, "constraints": {}}

    async def _main() -> None:
        runner = EvalRunner(_mock_parser)
        report = await runner.run()
        # Drop per-result detail for readability
        report.pop("results", None)
        print(json.dumps(report, indent=2))

    asyncio.run(_main())
