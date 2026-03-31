"""
DroneMedic - AI Evaluation Framework

Runs golden test cases against the NLP parser and computes field-level
accuracy metrics. Supports both live (API) and mock (cached) evaluation.
"""

import json
import sys
import os
from ai.test_dataset import TEST_CASES, get_test_cases, get_categories
from ai.confidence import score_confidence


def evaluate_single(test_case: dict, actual_output: dict) -> dict:
    """
    Compare a single parser output against the expected output.

    Args:
        test_case: A test case dict with 'expected' key.
        actual_output: The actual parsed output from the parser, or None if it raised an error.

    Returns:
        Dict with per-field match results and scores.
    """
    expected = test_case["expected"]

    # Edge case tests (expected is None = should fail)
    if expected is None:
        return {
            "id": test_case["id"],
            "category": test_case["category"],
            "expected_failure": True,
            "correctly_failed": actual_output is None,
            "full_match": actual_output is None,
            "locations_match": True if actual_output is None else False,
            "priorities_match": True if actual_output is None else False,
            "supplies_match": True if actual_output is None else False,
            "constraints_match": True if actual_output is None else False,
            "locations_precision": 1.0 if actual_output is None else 0.0,
            "locations_recall": 1.0 if actual_output is None else 0.0,
            "error": None,
        }

    if actual_output is None:
        return {
            "id": test_case["id"],
            "category": test_case["category"],
            "expected_failure": False,
            "correctly_failed": False,
            "full_match": False,
            "locations_match": False,
            "priorities_match": False,
            "supplies_match": False,
            "constraints_match": False,
            "locations_precision": 0.0,
            "locations_recall": 0.0,
            "error": "Parser returned None or raised an exception",
        }

    # --- Location comparison (set-based, order-independent) ---
    expected_locs = set(expected["locations"])
    actual_locs = set(actual_output.get("locations", []))

    locations_match = expected_locs == actual_locs

    if actual_locs:
        locations_precision = len(expected_locs & actual_locs) / len(actual_locs)
    else:
        locations_precision = 0.0 if expected_locs else 1.0

    if expected_locs:
        locations_recall = len(expected_locs & actual_locs) / len(expected_locs)
    else:
        locations_recall = 1.0 if not actual_locs else 0.0

    # --- Priority comparison (exact dict match) ---
    expected_priorities = expected.get("priorities", {})
    actual_priorities = actual_output.get("priorities", {})
    priorities_match = expected_priorities == actual_priorities

    # --- Supply comparison (case-insensitive per location) ---
    expected_supplies = expected.get("supplies", {})
    actual_supplies = actual_output.get("supplies", {})
    supplies_match = _compare_supplies(expected_supplies, actual_supplies)

    # --- Constraint comparison (lenient) ---
    expected_constraints = expected.get("constraints", {})
    actual_constraints = actual_output.get("constraints", {})
    constraints_match = _compare_constraints(expected_constraints, actual_constraints)

    full_match = all([locations_match, priorities_match, supplies_match, constraints_match])

    return {
        "id": test_case["id"],
        "category": test_case["category"],
        "expected_failure": False,
        "correctly_failed": False,
        "full_match": full_match,
        "locations_match": locations_match,
        "priorities_match": priorities_match,
        "supplies_match": supplies_match,
        "constraints_match": constraints_match,
        "locations_precision": round(locations_precision, 3),
        "locations_recall": round(locations_recall, 3),
        "error": None,
    }


def _compare_supplies(expected: dict, actual: dict) -> bool:
    """Compare supplies dicts case-insensitively."""
    if set(expected.keys()) != set(actual.keys()):
        return False
    for loc in expected:
        if expected[loc].lower().strip() != actual.get(loc, "").lower().strip():
            return False
    return True


def _compare_constraints(expected: dict, actual: dict) -> bool:
    """
    Compare constraints with lenient matching:
    - avoid_zones: compared as sets (order-independent)
    - weather_concern: substring containment (either direction)
    - time_sensitive: exact bool match
    """
    # Avoid zones — set comparison
    expected_zones = set(z.lower().strip() for z in expected.get("avoid_zones", []))
    actual_zones = set(z.lower().strip() for z in actual.get("avoid_zones", []))
    if expected_zones != actual_zones:
        return False

    # Weather concern — substring match
    expected_weather = expected.get("weather_concern", "").lower().strip()
    actual_weather = actual.get("weather_concern", "").lower().strip()
    if expected_weather and actual_weather:
        # Accept if either contains the other
        if expected_weather not in actual_weather and actual_weather not in expected_weather:
            return False
    elif expected_weather != actual_weather:
        # One is empty, the other is not
        return False

    # Time sensitive — exact bool
    expected_time = expected.get("time_sensitive", False)
    actual_time = actual.get("time_sensitive", False)
    if expected_time != actual_time:
        return False

    return True


def evaluate_all(test_cases: list = None, use_mock: bool = False) -> dict:
    """
    Run all test cases and compute aggregate metrics.

    Args:
        test_cases: List of test cases to evaluate. Defaults to full TEST_CASES.
        use_mock: If True, use cached responses instead of calling the API.

    Returns:
        Dict with overall_accuracy, field_accuracy, category_accuracy, and per-case results.
    """
    if test_cases is None:
        test_cases = TEST_CASES

    # Load cached responses or run live
    if use_mock:
        cached = _load_cached_responses()
    else:
        cached = None

    results = []
    for tc in test_cases:
        actual = _get_parser_output(tc, cached)
        result = evaluate_single(tc, actual)
        results.append(result)

    # Aggregate metrics
    total = len(results)
    if total == 0:
        return {"overall_accuracy": 0.0, "field_accuracy": {}, "category_accuracy": {}, "results": []}

    full_matches = sum(1 for r in results if r["full_match"])
    overall_accuracy = full_matches / total

    # Field accuracy
    field_accuracy = {}
    for field_name in ["locations_match", "priorities_match", "supplies_match", "constraints_match"]:
        matches = sum(1 for r in results if r[field_name])
        field_accuracy[field_name.replace("_match", "")] = round(matches / total, 3)

    # Category accuracy
    category_accuracy = {}
    for cat in get_categories():
        cat_results = [r for r in results if r["category"] == cat]
        if cat_results:
            cat_matches = sum(1 for r in cat_results if r["full_match"])
            category_accuracy[cat] = round(cat_matches / len(cat_results), 3)

    # Average precision and recall for locations
    avg_precision = sum(r["locations_precision"] for r in results) / total
    avg_recall = sum(r["locations_recall"] for r in results) / total

    return {
        "overall_accuracy": round(overall_accuracy, 3),
        "field_accuracy": field_accuracy,
        "category_accuracy": category_accuracy,
        "locations_avg_precision": round(avg_precision, 3),
        "locations_avg_recall": round(avg_recall, 3),
        "total_cases": total,
        "total_passed": full_matches,
        "total_failed": total - full_matches,
        "results": results,
    }


def _get_parser_output(test_case: dict, cached: dict = None) -> dict | None:
    """Get parser output for a test case — from cache or live API."""
    tc_id = test_case["id"]

    if cached is not None:
        if tc_id in cached:
            return cached[tc_id]
        return None

    # Live API call
    try:
        from ai.task_parser import parse_delivery_request
        result = parse_delivery_request(test_case["input"])
        return result
    except (ValueError, Exception):
        return None


def _load_cached_responses() -> dict:
    """Load cached parser responses from JSON file."""
    cache_path = os.path.join(os.path.dirname(__file__), "cached_responses.json")
    if os.path.exists(cache_path):
        with open(cache_path) as f:
            return json.load(f)
    return {}


def save_cached_responses(results: dict) -> None:
    """
    Save parser outputs to cache file for offline evaluation.

    Args:
        results: The results dict from evaluate_all (uses per-case results).
    """
    cache_path = os.path.join(os.path.dirname(__file__), "cached_responses.json")

    # Re-run to capture actual outputs
    cached = {}
    for tc in TEST_CASES:
        try:
            from ai.task_parser import parse_delivery_request
            output = parse_delivery_request(tc["input"])
            cached[tc["id"]] = output
        except Exception:
            cached[tc["id"]] = None

    with open(cache_path, "w") as f:
        json.dump(cached, f, indent=2)
    print(f"Cached {len(cached)} responses to {cache_path}")


def format_evaluation_report(eval_results: dict) -> str:
    """Format evaluation results as a human-readable report."""
    lines = [
        "=" * 65,
        "  DroneMedic AI — Evaluation Report",
        "=" * 65,
        f"  Total Test Cases:  {eval_results['total_cases']}",
        f"  Passed:            {eval_results['total_passed']}",
        f"  Failed:            {eval_results['total_failed']}",
        f"  Overall Accuracy:  {eval_results['overall_accuracy']:.1%}",
        "",
        f"  Location Precision (avg): {eval_results.get('locations_avg_precision', 0):.1%}",
        f"  Location Recall (avg):    {eval_results.get('locations_avg_recall', 0):.1%}",
        "",
        "  Field-Level Accuracy:",
        "  " + "-" * 45,
    ]

    for field_name, accuracy in eval_results["field_accuracy"].items():
        bar = "█" * int(accuracy * 20) + "░" * (20 - int(accuracy * 20))
        lines.append(f"  {field_name:<20} {bar} {accuracy:.1%}")

    lines.append("")
    lines.append("  Category Accuracy:")
    lines.append("  " + "-" * 45)

    for category, accuracy in eval_results["category_accuracy"].items():
        bar = "█" * int(accuracy * 20) + "░" * (20 - int(accuracy * 20))
        lines.append(f"  {category:<20} {bar} {accuracy:.1%}")

    # Show failed cases
    failed = [r for r in eval_results["results"] if not r["full_match"]]
    if failed:
        lines.append("")
        lines.append("  Failed Cases:")
        lines.append("  " + "-" * 45)
        for r in failed:
            fields_failed = []
            if not r["locations_match"]:
                fields_failed.append("locations")
            if not r["priorities_match"]:
                fields_failed.append("priorities")
            if not r["supplies_match"]:
                fields_failed.append("supplies")
            if not r["constraints_match"]:
                fields_failed.append("constraints")
            lines.append(f"  {r['id']:<20} Failed: {', '.join(fields_failed)}")
            if r.get("error"):
                lines.append(f"    → {r['error']}")

    lines.append("=" * 65)
    return "\n".join(lines)


# --- CLI entry point ---
if __name__ == "__main__":
    use_mock = "--mock" in sys.argv
    save_cache = "--save-cache" in sys.argv

    if save_cache:
        print("Running live evaluation and saving cache...")
        save_cached_responses({})
        print("Done. Run with --mock to use cached responses.")
    else:
        mode = "MOCK (cached)" if use_mock else "LIVE (API)"
        print(f"Running evaluation in {mode} mode...\n")

        results = evaluate_all(use_mock=use_mock)
        print(format_evaluation_report(results))
