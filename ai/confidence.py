"""
DroneMedic - AI Confidence Scoring

Provides heuristic confidence scores for parser outputs by comparing
the structured result against signals found in the original input text.
"""

from ai.preprocessor import extract_keywords, PRIORITY_KEYWORDS
from config import VALID_LOCATIONS


def score_confidence(user_input: str, parsed_output: dict) -> dict:
    """
    Score confidence of a parsed delivery task by comparing the structured
    output against heuristic signals found in the raw input text.

    Args:
        user_input: The original natural language request.
        parsed_output: The structured task dict from the parser.

    Returns:
        Dict with per-field confidence scores (0.0-1.0), overall score, and flags.
    """
    keywords = extract_keywords(user_input)
    flags = []

    # --- Location confidence ---
    location_score = _score_locations(parsed_output, keywords, flags)

    # --- Priority confidence ---
    priority_score = _score_priorities(parsed_output, keywords, user_input, flags)

    # --- Supply confidence ---
    supply_score = _score_supplies(parsed_output, keywords, user_input, flags)

    # --- Constraint confidence ---
    constraint_score = _score_constraints(parsed_output, keywords, flags)

    # --- Overall (weighted average) ---
    overall = (
        location_score * 0.4
        + priority_score * 0.2
        + supply_score * 0.2
        + constraint_score * 0.2
    )

    return {
        "overall": round(overall, 3),
        "locations": round(location_score, 3),
        "priorities": round(priority_score, 3),
        "supplies": round(supply_score, 3),
        "constraints": round(constraint_score, 3),
        "flags": flags,
    }


def _score_locations(parsed: dict, keywords: dict, flags: list) -> float:
    """Score location extraction confidence."""
    locations = parsed.get("locations", [])
    if not locations:
        flags.append("no_locations_extracted")
        return 0.0

    mentioned = keywords["mentioned_locations"]
    score = 1.0

    # Check if each extracted location is mentioned in the input
    for loc in locations:
        if loc not in mentioned:
            score -= 0.2
            flags.append(f"location_not_in_input:{loc}")

    # Check if input mentions locations not extracted
    for loc in mentioned:
        if loc not in locations:
            score -= 0.15
            flags.append(f"mentioned_but_not_extracted:{loc}")

    # Check all locations are valid
    for loc in locations:
        if loc not in VALID_LOCATIONS:
            score -= 0.3
            flags.append(f"invalid_location:{loc}")

    return max(0.0, min(1.0, score))


def _score_priorities(parsed: dict, keywords: dict, user_input: str, flags: list) -> float:
    """Score priority extraction confidence."""
    priorities = parsed.get("priorities", {})
    found_priority_kw = keywords["priority_keywords"]

    # If no priority keywords in input and no priorities extracted — perfect
    if not found_priority_kw and not priorities:
        return 1.0

    # If priority keywords found but none extracted — low confidence
    if found_priority_kw and not priorities:
        flags.append("priority_keywords_found_but_none_extracted")
        return 0.4

    # If priorities extracted but no keywords found — might be inferred
    if priorities and not found_priority_kw:
        flags.append("priorities_without_clear_keywords")
        return 0.6

    score = 1.0
    input_lower = user_input.lower()

    # Check each high-priority location has nearby keywords
    for loc, level in priorities.items():
        if level == "high":
            loc_lower = loc.lower()
            has_nearby_keyword = any(kw in input_lower for kw in PRIORITY_KEYWORDS)
            if not has_nearby_keyword:
                score -= 0.3
                flags.append(f"no_priority_keyword_for:{loc}")

    return max(0.0, min(1.0, score))


def _score_supplies(parsed: dict, keywords: dict, user_input: str, flags: list) -> float:
    """Score supply extraction confidence."""
    supplies = parsed.get("supplies", {})
    locations = parsed.get("locations", [])

    if not locations:
        return 0.0

    score = 1.0
    input_lower = user_input.lower()

    for loc in locations:
        supply = supplies.get(loc, "medical supplies")

        # Default supply used — lower confidence
        if supply == "medical supplies":
            # Check if input actually mentions a specific supply
            if keywords["supply_terms"]:
                score -= 0.15
                flags.append(f"defaulted_supply_despite_terms_present:{loc}")
            else:
                score -= 0.1
                flags.append(f"supply_defaulted:{loc}")
        else:
            # Check if the extracted supply appears in the input
            if supply.lower() not in input_lower:
                score -= 0.2
                flags.append(f"supply_not_in_input:{loc}={supply}")

    return max(0.0, min(1.0, score))


def _score_constraints(parsed: dict, keywords: dict, flags: list) -> float:
    """Score constraint extraction confidence."""
    constraints = parsed.get("constraints", {})
    indicators = keywords["constraint_indicators"]

    avoid_zones = constraints.get("avoid_zones", [])
    weather = constraints.get("weather_concern", "")
    time_sensitive = constraints.get("time_sensitive", False)

    score = 1.0

    # Check avoid zones
    if "avoid_zones" in indicators and not avoid_zones:
        score -= 0.2
        flags.append("avoid_keywords_found_but_no_zones_extracted")
    elif avoid_zones and "avoid_zones" not in indicators:
        score -= 0.15
        flags.append("zones_extracted_without_avoid_keywords")

    # Check weather
    if "weather" in indicators and not weather:
        score -= 0.2
        flags.append("weather_keywords_found_but_no_concern_extracted")
    elif weather and "weather" not in indicators:
        score -= 0.15
        flags.append("weather_extracted_without_keywords")

    # Check time sensitivity
    if "time_sensitive" in indicators and not time_sensitive:
        score -= 0.2
        flags.append("time_keywords_found_but_not_flagged")
    elif time_sensitive and "time_sensitive" not in indicators:
        score -= 0.15
        flags.append("time_sensitive_flagged_without_keywords")

    return max(0.0, min(1.0, score))


def format_confidence_report(confidence: dict) -> str:
    """Format confidence scores as a readable report."""
    lines = [
        "-" * 50,
        "  Confidence Scores",
        "-" * 50,
        f"  Overall:     {_bar(confidence['overall'])} {confidence['overall']:.1%}",
        f"  Locations:   {_bar(confidence['locations'])} {confidence['locations']:.1%}",
        f"  Priorities:  {_bar(confidence['priorities'])} {confidence['priorities']:.1%}",
        f"  Supplies:    {_bar(confidence['supplies'])} {confidence['supplies']:.1%}",
        f"  Constraints: {_bar(confidence['constraints'])} {confidence['constraints']:.1%}",
    ]

    if confidence["flags"]:
        lines.append("")
        lines.append("  Flags:")
        for flag in confidence["flags"]:
            lines.append(f"    ⚠ {flag}")

    lines.append("-" * 50)
    return "\n".join(lines)


def _bar(value: float, width: int = 20) -> str:
    """Create a progress bar string."""
    filled = int(value * width)
    return "█" * filled + "░" * (width - filled)


# --- Quick test ---
if __name__ == "__main__":
    # Test with sample parsed output
    test_input = "Deliver insulin to Clinic A urgently and blood to Clinic B"
    test_output = {
        "locations": ["Clinic A", "Clinic B"],
        "priorities": {"Clinic A": "high"},
        "supplies": {"Clinic A": "insulin", "Clinic B": "blood"},
        "constraints": {"avoid_zones": [], "weather_concern": "", "time_sensitive": False},
    }

    confidence = score_confidence(test_input, test_output)
    print(format_confidence_report(confidence))

    print("\n--- Low confidence example ---\n")
    bad_output = {
        "locations": ["Clinic A", "Clinic C"],  # Clinic C not mentioned
        "priorities": {},  # missed "urgently"
        "supplies": {"Clinic A": "medical supplies", "Clinic C": "medical supplies"},
        "constraints": {"avoid_zones": ["military zone"], "weather_concern": "", "time_sensitive": False},
    }

    confidence2 = score_confidence(test_input, bad_output)
    print(format_confidence_report(confidence2))
