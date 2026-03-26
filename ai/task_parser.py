"""
DroneMedic - AI Task Parser

Converts natural language delivery requests into structured JSON tasks
using the Claude API (Anthropic SDK).
"""

import json
import anthropic
from config import ANTHROPIC_API_KEY, VALID_LOCATIONS

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


def parse_delivery_request(user_input: str) -> dict:
    """
    Parse a natural language delivery request into a structured task.

    Args:
        user_input: Natural language delivery request from the user.

    Returns:
        Dict with keys: locations (list), priorities (dict), supplies (dict)

    Raises:
        ValueError: If Claude returns invalid JSON or missing required fields.
    """
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1024,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_input}],
    )

    raw_text = response.content[0].text.strip()

    # Parse JSON response
    try:
        task = json.loads(raw_text)
    except json.JSONDecodeError:
        # Retry once with stricter instruction
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
        raw_text = retry_response.content[0].text.strip()
        try:
            task = json.loads(raw_text)
        except json.JSONDecodeError as e:
            raise ValueError(f"Failed to parse Claude response as JSON: {raw_text}") from e

    # Validate required fields
    if "locations" not in task or not isinstance(task["locations"], list):
        raise ValueError(f"Missing or invalid 'locations' field: {task}")

    # Set defaults
    task.setdefault("priorities", {})
    task.setdefault("supplies", {})
    task.setdefault("constraints", {"avoid_zones": [], "weather_concern": "", "time_sensitive": False})

    # Validate location names
    for loc in task["locations"]:
        if loc not in VALID_LOCATIONS:
            raise ValueError(f"Unknown location '{loc}'. Valid: {VALID_LOCATIONS}")

    return task


def parse_reroute_request(user_input: str) -> dict:
    """
    Parse a mid-flight re-routing request (e.g., new urgent delivery).

    Returns same schema as parse_delivery_request but for additional stops.
    """
    return parse_delivery_request(user_input)


# --- Quick test ---
if __name__ == "__main__":
    test_input = "Deliver insulin to Clinic A, blood to Clinic B urgently, and bandages to Clinic C"
    print(f"Input: {test_input}")
    try:
        result = parse_delivery_request(test_input)
        print(f"Output: {json.dumps(result, indent=2)}")
    except ValueError as e:
        print(f"Error: {e}")
