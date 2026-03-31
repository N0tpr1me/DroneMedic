"""
DroneMedic - AI Hallucination Mitigation & Output Validation

Validates LLM outputs with semantic checks, cross-validates against
keyword-extracted baselines, and provides confidence-based gating.
"""

from config import VALID_LOCATIONS
from ai.preprocessor import extract_keywords, SUPPLY_TERMS
from ai.confidence import score_confidence


# --- Allowed values ---
VALID_PRIORITIES = {"high", "normal"}
VALID_SUPPLY_TYPES = {s.lower() for s in SUPPLY_TERMS}


class ValidationResult:
    """Result of semantic validation."""

    def __init__(self):
        self.valid: bool = True
        self.errors: list[str] = []
        self.warnings: list[str] = []
        self.corrections: dict = {}

    def add_error(self, message: str) -> None:
        self.errors.append(message)
        self.valid = False

    def add_warning(self, message: str) -> None:
        self.warnings.append(message)

    def add_correction(self, field: str, original, corrected) -> None:
        self.corrections[field] = {"original": original, "corrected": corrected}

    def to_dict(self) -> dict:
        return {
            "valid": self.valid,
            "errors": self.errors,
            "warnings": self.warnings,
            "corrections": self.corrections,
        }


def validate_parsed_output(parsed: dict, user_input: str) -> ValidationResult:
    """
    Full semantic validation of LLM output.

    Checks:
    1. All locations are in VALID_LOCATIONS
    2. All priority values are "high" or "normal"
    3. All supply names are recognized medical terms
    4. Constraint structure is well-formed
    5. No unexpected fields

    Args:
        parsed: The structured output from the LLM.
        user_input: The original user input for context.

    Returns:
        ValidationResult with errors, warnings, and auto-corrections.
    """
    result = ValidationResult()

    # --- Check required fields ---
    if "locations" not in parsed:
        result.add_error("Missing required field: 'locations'")
        return result

    if not isinstance(parsed["locations"], list):
        result.add_error(f"'locations' must be a list, got {type(parsed['locations']).__name__}")
        return result

    # --- Validate locations ---
    for loc in parsed["locations"]:
        if loc not in VALID_LOCATIONS:
            result.add_error(f"Hallucinated location: '{loc}' is not a valid location")

    if not parsed["locations"]:
        result.add_warning("Locations list is empty — no deliveries parsed")

    # --- Validate priorities ---
    priorities = parsed.get("priorities", {})
    if not isinstance(priorities, dict):
        result.add_error(f"'priorities' must be a dict, got {type(priorities).__name__}")
    else:
        for loc, level in priorities.items():
            if loc not in VALID_LOCATIONS:
                result.add_error(f"Priority set for unknown location: '{loc}'")
            if level not in VALID_PRIORITIES:
                result.add_error(f"Invalid priority level '{level}' for {loc}. Must be 'high' or 'normal'")
            if loc not in parsed.get("locations", []):
                result.add_warning(f"Priority set for '{loc}' but it's not in the locations list")

    # --- Validate supplies ---
    supplies = parsed.get("supplies", {})
    if not isinstance(supplies, dict):
        result.add_error(f"'supplies' must be a dict, got {type(supplies).__name__}")
    else:
        for loc, supply in supplies.items():
            if loc not in VALID_LOCATIONS:
                result.add_error(f"Supply set for unknown location: '{loc}'")
            if not isinstance(supply, str):
                result.add_error(f"Supply for '{loc}' must be a string, got {type(supply).__name__}")
            elif supply.lower() not in VALID_SUPPLY_TYPES and supply.lower() != "medical supplies":
                # Not a hard error — LLM might use a reasonable variant
                result.add_warning(
                    f"Unrecognized supply '{supply}' for {loc}. "
                    f"Consider using a standard term."
                )

    # --- Validate constraints ---
    constraints = parsed.get("constraints", {})
    if not isinstance(constraints, dict):
        result.add_error(f"'constraints' must be a dict, got {type(constraints).__name__}")
    else:
        avoid = constraints.get("avoid_zones", [])
        if not isinstance(avoid, list):
            result.add_error("'avoid_zones' must be a list")

        weather = constraints.get("weather_concern", "")
        if not isinstance(weather, str):
            result.add_error("'weather_concern' must be a string")

        time_sensitive = constraints.get("time_sensitive", False)
        if not isinstance(time_sensitive, bool):
            result.add_warning(f"'time_sensitive' should be bool, got {type(time_sensitive).__name__}")

    # --- Check for unexpected fields ---
    expected_fields = {"locations", "priorities", "supplies", "constraints", "confidence"}
    unexpected = set(parsed.keys()) - expected_fields
    if unexpected:
        result.add_warning(f"Unexpected fields in output: {unexpected}")

    return result


def cross_validate(parsed: dict, user_input: str) -> dict:
    """
    Compare LLM output against keyword-extracted baseline to detect hallucinations.

    Uses preprocessor.extract_keywords() as a cheap, deterministic baseline.
    Discrepancies between LLM output and keyword baseline are flagged.

    Args:
        parsed: The structured output from the LLM.
        user_input: The original user input.

    Returns:
        Dict with agreement_score, discrepancies, llm_extras, keyword_extras.
    """
    keywords = extract_keywords(user_input)
    discrepancies = []
    llm_extras = []
    keyword_extras = []

    # --- Location cross-validation ---
    llm_locations = set(parsed.get("locations", []))
    kw_locations = set(keywords["mentioned_locations"])

    # Locations LLM found but keywords didn't
    for loc in llm_locations - kw_locations:
        llm_extras.append(f"LLM extracted location '{loc}' not found by keyword scan")

    # Locations keywords found but LLM didn't
    for loc in kw_locations - llm_locations:
        keyword_extras.append(f"Keyword scan found location '{loc}' but LLM didn't extract it")

    # --- Priority cross-validation ---
    llm_has_priority = bool(parsed.get("priorities", {}))
    kw_has_priority = bool(keywords["priority_keywords"])

    if kw_has_priority and not llm_has_priority:
        discrepancies.append(
            f"Priority keywords found ({keywords['priority_keywords']}) "
            f"but no priorities in LLM output"
        )
    elif llm_has_priority and not kw_has_priority:
        discrepancies.append(
            "LLM assigned priorities but no priority keywords detected in input"
        )

    # --- Supply cross-validation ---
    llm_supplies = set(
        s.lower() for s in parsed.get("supplies", {}).values()
        if s.lower() != "medical supplies"
    )
    kw_supplies = set(keywords["supply_terms"])

    for supply in llm_supplies:
        if supply not in kw_supplies and not any(supply in ks for ks in kw_supplies):
            llm_extras.append(f"LLM extracted supply '{supply}' not found by keyword scan")

    # --- Constraint cross-validation ---
    llm_constraints = parsed.get("constraints", {})
    kw_constraints = keywords["constraint_indicators"]

    if "avoid_zones" in kw_constraints and not llm_constraints.get("avoid_zones"):
        discrepancies.append("Avoid keywords detected but no avoid_zones in LLM output")

    if "weather" in kw_constraints and not llm_constraints.get("weather_concern"):
        discrepancies.append("Weather keywords detected but no weather_concern in LLM output")

    # --- Compute agreement score ---
    total_checks = 4  # locations, priorities, supplies, constraints
    agreements = total_checks - len(discrepancies)
    # Penalize for extras (potential hallucinations)
    penalty = len(llm_extras) * 0.1
    agreement_score = max(0.0, min(1.0, (agreements / total_checks) - penalty))

    return {
        "agreement_score": round(agreement_score, 3),
        "discrepancies": discrepancies,
        "llm_extras": llm_extras,
        "keyword_extras": keyword_extras,
    }


def confidence_gate(
    parsed: dict,
    user_input: str,
    threshold: float = 0.6,
    auto_reject_threshold: float = 0.3,
) -> dict:
    """
    Apply confidence-based gating to decide whether to accept, warn, or reject.

    Combines confidence scoring with cross-validation for a holistic check.

    Args:
        parsed: The structured output from the LLM.
        user_input: The original user input.
        threshold: Below this, output gets a "warn" status.
        auto_reject_threshold: Below this, output is rejected.

    Returns:
        Dict with action (accept/warn/reject), confidence, cross_validation, reason.
    """
    confidence = score_confidence(user_input, parsed)
    cross_val = cross_validate(parsed, user_input)

    overall_score = confidence["overall"]
    agreement = cross_val["agreement_score"]

    # Combined score (weighted)
    combined = overall_score * 0.6 + agreement * 0.4

    # Determine action
    if combined >= threshold:
        action = "accept"
        reason = f"Combined score {combined:.2f} meets threshold {threshold}"
    elif combined >= auto_reject_threshold:
        action = "warn"
        reasons = []
        if overall_score < threshold:
            reasons.append(f"confidence {overall_score:.2f} below {threshold}")
        if cross_val["discrepancies"]:
            reasons.append(f"{len(cross_val['discrepancies'])} discrepancies found")
        if cross_val["llm_extras"]:
            reasons.append(f"{len(cross_val['llm_extras'])} potential hallucinations")
        reason = "Low confidence: " + "; ".join(reasons)
    else:
        action = "reject"
        reason = f"Combined score {combined:.2f} below rejection threshold {auto_reject_threshold}"

    return {
        "action": action,
        "combined_score": round(combined, 3),
        "confidence": confidence,
        "cross_validation": cross_val,
        "reason": reason,
    }


# --- Quick test ---
if __name__ == "__main__":
    print("=" * 60)
    print("  DroneMedic AI — Validator Demo")
    print("=" * 60)

    # Good output
    good_input = "Deliver insulin to Clinic A urgently and blood to Clinic B"
    good_output = {
        "locations": ["Clinic A", "Clinic B"],
        "priorities": {"Clinic A": "high"},
        "supplies": {"Clinic A": "insulin", "Clinic B": "blood"},
        "constraints": {"avoid_zones": [], "weather_concern": "", "time_sensitive": False},
    }

    print("\n--- Good Output ---")
    val = validate_parsed_output(good_output, good_input)
    print(f"  Valid: {val.valid}")
    gate = confidence_gate(good_output, good_input)
    print(f"  Gate: {gate['action']} (score: {gate['combined_score']})")
    print(f"  Reason: {gate['reason']}")

    # Hallucinated output
    bad_input = "Deliver insulin to Clinic A"
    bad_output = {
        "locations": ["Clinic A", "Clinic X"],  # Clinic X doesn't exist
        "priorities": {"Clinic A": "urgent"},     # "urgent" not valid, should be "high"
        "supplies": {"Clinic A": "insulin", "Clinic X": "laser gun"},  # not a supply
        "constraints": {"avoid_zones": ["area 51"], "weather_concern": "", "time_sensitive": False},
    }

    print("\n--- Hallucinated Output ---")
    val2 = validate_parsed_output(bad_output, bad_input)
    print(f"  Valid: {val2.valid}")
    for e in val2.errors:
        print(f"  ERROR: {e}")
    for w in val2.warnings:
        print(f"  WARN: {w}")

    gate2 = confidence_gate(bad_output, bad_input)
    print(f"  Gate: {gate2['action']} (score: {gate2['combined_score']})")
    print(f"  Reason: {gate2['reason']}")

    # Cross-validation demo
    print("\n--- Cross-Validation ---")
    cv = cross_validate(bad_output, bad_input)
    print(f"  Agreement: {cv['agreement_score']}")
    for d in cv["discrepancies"]:
        print(f"  DISCREPANCY: {d}")
    for e in cv["llm_extras"]:
        print(f"  LLM EXTRA: {e}")
