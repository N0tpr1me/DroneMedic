"""
DroneMedic - AI Input Preprocessor

Normalizes user input, extracts keywords, and provides fuzzy location matching
to improve parsing accuracy and support confidence scoring.
"""

from __future__ import annotations


import re
from config import VALID_LOCATIONS


# --- Priority keywords (case-insensitive matching) ---
PRIORITY_KEYWORDS = [
    "urgent", "urgently", "emergency", "critical", "asap",
    "immediately", "life-threatening", "stat", "priority",
]

# --- Common medical supply terms ---
SUPPLY_TERMS = [
    "insulin", "blood", "blood packs", "bandages", "vaccines", "vaccine",
    "antibiotics", "painkillers", "morphine", "epinephrine", "epipen",
    "oxygen", "defibrillator", "surgical kit", "first aid",
    "medical supplies", "medication", "medicine", "plasma",
    "saline", "syringes", "iv drip", "antivenom", "splints",
]

# --- Constraint indicator keywords ---
CONSTRAINT_KEYWORDS = {
    "avoid_zones": [
        "avoid", "stay away", "no-fly", "restricted", "military",
        "airport", "exclusion", "bypass",
    ],
    "weather": [
        "storm", "rain", "wind", "weather", "thunder", "lightning",
        "fog", "visibility", "hurricane", "cyclone",
    ],
    "time_sensitive": [
        "time-sensitive", "deadline", "within", "before", "hurry",
        "rush", "fast", "quick", "asap", "immediately",
    ],
}


def normalize_input(text: str) -> str:
    """
    Normalize user input text before sending to Claude.

    - Strips leading/trailing whitespace
    - Collapses multiple spaces into one
    - Removes control characters (keeps newlines)

    Args:
        text: Raw user input string.

    Returns:
        Cleaned string ready for parsing.
    """
    if not isinstance(text, str):
        return ""
    text = text.strip()
    text = re.sub(r"[^\S\n]+", " ", text)  # collapse spaces (preserve newlines)
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", text)  # remove control chars
    return text


def extract_keywords(text: str) -> dict:
    """
    Extract relevant keywords from input text using regex matching.

    Provides a non-LLM baseline for comparison and supports confidence scoring.

    Args:
        text: User input string.

    Returns:
        Dict with keys: priority_keywords, mentioned_locations, supply_terms, constraint_indicators
    """
    text_lower = text.lower()

    # Find priority keywords
    found_priority = [kw for kw in PRIORITY_KEYWORDS if kw in text_lower]

    # Find mentioned locations
    found_locations = [loc for loc in VALID_LOCATIONS if loc.lower() in text_lower]

    # Find supply terms
    found_supplies = [term for term in SUPPLY_TERMS if term in text_lower]

    # Find constraint indicators
    found_constraints = {}
    for category, keywords in CONSTRAINT_KEYWORDS.items():
        matches = [kw for kw in keywords if kw in text_lower]
        if matches:
            found_constraints[category] = matches

    return {
        "priority_keywords": found_priority,
        "mentioned_locations": found_locations,
        "supply_terms": found_supplies,
        "constraint_indicators": found_constraints,
    }


def fuzzy_match_location(name: str, valid_locations: list = None) -> str | None:
    """
    Attempt to match a location name against valid locations using
    case-insensitive and whitespace-tolerant matching.

    Args:
        name: Location name to match (potentially misspelled or misformatted).
        valid_locations: List of valid location names. Defaults to VALID_LOCATIONS.

    Returns:
        Matched valid location name, or None if no match found.
    """
    if valid_locations is None:
        valid_locations = VALID_LOCATIONS

    # Exact match
    if name in valid_locations:
        return name

    # Case-insensitive match
    name_lower = name.lower().strip()
    for loc in valid_locations:
        if loc.lower() == name_lower:
            return loc

    # Whitespace-collapsed match (e.g., "ClinicA" -> "Clinic A")
    name_no_space = re.sub(r"\s+", "", name_lower)
    for loc in valid_locations:
        if re.sub(r"\s+", "", loc.lower()) == name_no_space:
            return loc

    # Partial match — check if valid location is contained in the name or vice versa
    for loc in valid_locations:
        loc_lower = loc.lower()
        if loc_lower in name_lower or name_lower in loc_lower:
            return loc

    return None


# --- Quick test ---
if __name__ == "__main__":
    test_inputs = [
        "Deliver insulin to Clinic A urgently and blood to Clinic B",
        "Send vaccines to clinic c, avoid military zone, storm approaching",
        "Emergency bandages to ClinicD",
        "",
    ]

    for inp in test_inputs:
        print(f"\nInput: {repr(inp)}")
        normalized = normalize_input(inp)
        print(f"Normalized: {repr(normalized)}")
        keywords = extract_keywords(normalized)
        print(f"Keywords: {keywords}")
