"""
DroneMedic - AI Task Parser

Converts natural language delivery requests into structured JSON tasks.
Uses the AI Orchestrator internally for enhanced parsing with few-shot prompting,
chain-of-thought reasoning, validation, and constraint resolution.

Maintains backward-compatible API for existing callers (main.py, dashboard.py).
"""

import json
import anthropic
from config import ANTHROPIC_API_KEY, VALID_LOCATIONS
from ai.preprocessor import normalize_input, fuzzy_match_location
from ai.confidence import score_confidence
from ai.error_analysis import log_error, ErrorType

# Legacy system prompt (kept as fallback)
SYSTEM_PROMPT = f"""You are a medical drone delivery task parser for the DroneMedic system.

Convert the user's delivery request into a JSON object with exactly these fields:
- "locations": list of location names to deliver to (choose from: {', '.join(VALID_LOCATIONS)})
- "priorities": dict mapping location names to "high" or "normal" (only include locations with explicit urgency as "high")
- "supplies": dict mapping location names to the supply type being delivered
- "constraints": dict with optional fields:
  - "avoid_zones": list of zone/area descriptions to avoid (e.g. "military area", "storm zone")
  - "weather_concern": string describing any weather concern mentioned (e.g. "storm approaching", "high winds")
  - "time_sensitive": boolean, true if the request mentions time pressure

Rules:
- Only use location names from the valid list above
- If a location is described as "urgent", "emergency", or "critical", set its priority to "high"
- If no specific supply is mentioned for a location, use "medical supplies" as default
- Always include all mentioned delivery destinations in the locations list
- If no constraints are mentioned, use empty values: "avoid_zones": [], "weather_concern": "", "time_sensitive": false
- Respond with ONLY valid JSON, no markdown, no explanation, no other text
"""

# --- Lazy singleton orchestrator ---
_orchestrator = None


def _get_orchestrator():
    """Get or create the global AI orchestrator (lazy initialization)."""
    global _orchestrator
    if _orchestrator is None:
        from ai.orchestrator import AIOrchestrator
        _orchestrator = AIOrchestrator()
    return _orchestrator


def parse_delivery_request(user_input: str, include_confidence: bool = False) -> dict:
    """
    Parse a natural language delivery request into a structured task.

    Uses the full AI orchestrator pipeline internally (few-shot + CoT + validation
    + confidence gating + constraint resolution) but returns the same backward-
    compatible schema.

    Args:
        user_input: Natural language delivery request from the user.
        include_confidence: If True, add a 'confidence' key with scoring breakdown.

    Returns:
        Dict with keys: locations (list), priorities (dict), supplies (dict),
        constraints (dict), and optionally confidence (dict).

    Raises:
        ValueError: If input is empty, Claude returns invalid JSON, or missing required fields.
    """
    try:
        # Use the full orchestrator pipeline
        result = _get_orchestrator().process_request(user_input)

        # Extract backward-compatible task dict
        task = {
            "locations": result["locations"],
            "priorities": result["priorities"],
            "supplies": result["supplies"],
            "constraints": result["constraints"],
        }

        if include_confidence:
            task["confidence"] = result.get("confidence", score_confidence(user_input, task))

        return task

    except Exception:
        # Fallback to legacy direct parsing if orchestrator fails
        return _legacy_parse(user_input, include_confidence)


def _legacy_parse(user_input: str, include_confidence: bool = False) -> dict:
    """
    Legacy direct parsing — fallback if the orchestrator fails.
    Uses the original simple prompt without few-shot or CoT.
    """
    user_input = normalize_input(user_input)
    if not user_input:
        log_error(ErrorType.EMPTY_INPUT, "Empty or whitespace-only input", "")
        raise ValueError("Input cannot be empty or whitespace-only.")

    if len(user_input) > 2000:
        user_input = user_input[:2000]

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    try:
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=1024,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_input}],
        )
    except Exception as e:
        log_error(ErrorType.API_ERROR, str(e), user_input)
        raise

    raw_text = response.content[0].text.strip()

    # Parse JSON response
    task = _parse_json_response(raw_text, user_input, client)

    # Validate required fields
    if "locations" not in task or not isinstance(task["locations"], list):
        log_error(ErrorType.MISSING_FIELD, f"Missing or invalid 'locations': {task}", user_input, raw_text)
        raise ValueError(f"Missing or invalid 'locations' field: {task}")

    # Set defaults
    task.setdefault("priorities", {})
    task.setdefault("supplies", {})
    task.setdefault("constraints", {"avoid_zones": [], "weather_concern": "", "time_sensitive": False})

    # Validate and fix types
    _validate_types(task, user_input, raw_text)

    # Validate and fuzzy-match location names
    task["locations"] = _validate_locations(task["locations"], user_input, raw_text)

    # Handle empty result
    if not task["locations"]:
        log_error(ErrorType.EMPTY_RESULT, "No valid locations after parsing", user_input, raw_text)
        raise ValueError(f"No valid locations found in input: {user_input}")

    if include_confidence:
        task["confidence"] = score_confidence(user_input, task)

    return task


def _parse_json_response(raw_text: str, user_input: str, client) -> dict:
    """Parse JSON from Claude's response, with retry on failure."""
    try:
        return json.loads(raw_text)
    except json.JSONDecodeError:
        log_error(ErrorType.JSON_PARSE_FAILURE, "First attempt failed", user_input, raw_text, attempt_number=1)

        retry_response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=1024,
            system=SYSTEM_PROMPT,
            messages=[
                {"role": "user", "content": user_input},
                {"role": "assistant", "content": raw_text},
                {
                    "role": "user",
                    "content": "That was not valid JSON. Please respond with ONLY a valid JSON object, nothing else.",
                },
            ],
        )
        retry_text = retry_response.content[0].text.strip()
        try:
            return json.loads(retry_text)
        except json.JSONDecodeError as e:
            log_error(ErrorType.JSON_PARSE_FAILURE, f"Retry also failed: {e}", user_input, retry_text, attempt_number=2)
            raise ValueError(f"Failed to parse Claude response as JSON: {retry_text}") from e


def _validate_types(task: dict, user_input: str, raw_text: str) -> None:
    """Validate and enforce correct types for all task fields."""
    if not isinstance(task.get("priorities"), dict):
        log_error(ErrorType.TYPE_ERROR, f"priorities is not a dict: {type(task.get('priorities'))}", user_input, raw_text)
        task["priorities"] = {}
    else:
        valid_priorities = {}
        for loc, level in task["priorities"].items():
            if level in ("high", "normal"):
                valid_priorities[loc] = level
        task["priorities"] = valid_priorities

    if not isinstance(task.get("supplies"), dict):
        log_error(ErrorType.TYPE_ERROR, f"supplies is not a dict: {type(task.get('supplies'))}", user_input, raw_text)
        task["supplies"] = {}
    else:
        task["supplies"] = {k: str(v) for k, v in task["supplies"].items()}

    constraints = task.get("constraints", {})
    if not isinstance(constraints, dict):
        log_error(ErrorType.TYPE_ERROR, f"constraints is not a dict: {type(constraints)}", user_input, raw_text)
        task["constraints"] = {"avoid_zones": [], "weather_concern": "", "time_sensitive": False}
    else:
        if not isinstance(constraints.get("avoid_zones"), list):
            constraints["avoid_zones"] = []
        if not isinstance(constraints.get("weather_concern"), str):
            constraints["weather_concern"] = str(constraints.get("weather_concern", ""))
        if not isinstance(constraints.get("time_sensitive"), bool):
            constraints["time_sensitive"] = bool(constraints.get("time_sensitive", False))
        task["constraints"] = constraints


def _validate_locations(locations: list, user_input: str, raw_text: str) -> list:
    """Validate location names with fuzzy matching fallback."""
    validated = []
    for loc in locations:
        if loc in VALID_LOCATIONS:
            validated.append(loc)
        else:
            matched = fuzzy_match_location(loc)
            if matched:
                validated.append(matched)
            else:
                log_error(
                    ErrorType.INVALID_LOCATION,
                    f"Unknown location '{loc}', no fuzzy match found",
                    user_input,
                    raw_text,
                )
    return validated


def parse_reroute_request(user_input: str, include_confidence: bool = False) -> dict:
    """
    Parse a mid-flight re-routing request (e.g., new urgent delivery).

    Returns same schema as parse_delivery_request but for additional stops.
    """
    return parse_delivery_request(user_input, include_confidence=include_confidence)


# --- Quick test ---
if __name__ == "__main__":
    test_input = "Deliver insulin to Clinic A, blood to Clinic B urgently, and bandages to Clinic C"
    print(f"Input: {test_input}")
    try:
        result = parse_delivery_request(test_input, include_confidence=True)
        print(f"Output: {json.dumps(result, indent=2)}")
    except ValueError as e:
        print(f"Error: {e}")
