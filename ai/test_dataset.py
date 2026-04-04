"""
DroneMedic - AI Test Dataset

Golden test cases for evaluating the NLP task parser.
Each case has an input string and the expected structured output.
"""


def _default_constraints(avoid_zones=None, weather_concern="", time_sensitive=False):
    """Helper to build a constraints dict with defaults."""
    return {
        "avoid_zones": avoid_zones or [],
        "weather_concern": weather_concern,
        "time_sensitive": time_sensitive,
    }


# --- Golden Test Cases ---
TEST_CASES = [
    # ===== STANDARD REQUESTS =====
    {
        "id": "standard_001",
        "category": "standard",
        "input": "Deliver insulin to Clinic A",
        "expected": {
            "locations": ["Clinic A"],
            "priorities": {},
            "supplies": {"Clinic A": "insulin"},
            "constraints": _default_constraints(),
        },
        "description": "Single location, single supply",
    },
    {
        "id": "standard_002",
        "category": "standard",
        "input": "Deliver insulin to Clinic A and blood to Clinic B",
        "expected": {
            "locations": ["Clinic A", "Clinic B"],
            "priorities": {},
            "supplies": {"Clinic A": "insulin", "Clinic B": "blood"},
            "constraints": _default_constraints(),
        },
        "description": "Two locations with explicit supplies",
    },
    {
        "id": "standard_003",
        "category": "standard",
        "input": "Send bandages to Clinic C and vaccines to Clinic D",
        "expected": {
            "locations": ["Clinic C", "Clinic D"],
            "priorities": {},
            "supplies": {"Clinic C": "bandages", "Clinic D": "vaccines"},
            "constraints": _default_constraints(),
        },
        "description": "Two locations, different supplies",
    },
    {
        "id": "standard_004",
        "category": "standard",
        "input": "Deliver insulin to Clinic A, blood to Clinic B, and bandages to Clinic C",
        "expected": {
            "locations": ["Clinic A", "Clinic B", "Clinic C"],
            "priorities": {},
            "supplies": {"Clinic A": "insulin", "Clinic B": "blood", "Clinic C": "bandages"},
            "constraints": _default_constraints(),
        },
        "description": "Three locations with explicit supplies",
    },
    {
        "id": "standard_005",
        "category": "standard",
        "input": "We need antibiotics delivered to Clinic A, Clinic B, Clinic C, and Clinic D",
        "expected": {
            "locations": ["Clinic A", "Clinic B", "Clinic C", "Clinic D"],
            "priorities": {},
            "supplies": {
                "Clinic A": "antibiotics",
                "Clinic B": "antibiotics",
                "Clinic C": "antibiotics",
                "Clinic D": "antibiotics",
            },
            "constraints": _default_constraints(),
        },
        "description": "Four locations, same supply for all",
    },

    # ===== PRIORITY HANDLING =====
    {
        "id": "priority_001",
        "category": "priority",
        "input": "Deliver blood to Clinic B urgently",
        "expected": {
            "locations": ["Clinic B"],
            "priorities": {"Clinic B": "high"},
            "supplies": {"Clinic B": "blood"},
            "constraints": _default_constraints(),
        },
        "description": "Single urgent delivery",
    },
    {
        "id": "priority_002",
        "category": "priority",
        "input": "Emergency insulin delivery to Clinic A and bandages to Clinic C",
        "expected": {
            "locations": ["Clinic A", "Clinic C"],
            "priorities": {"Clinic A": "high"},
            "supplies": {"Clinic A": "insulin", "Clinic C": "bandages"},
            "constraints": _default_constraints(),
        },
        "description": "Emergency applies to first location only",
    },
    {
        "id": "priority_003",
        "category": "priority",
        "input": "Critical: send blood to Clinic B and Clinic D needs vaccines ASAP",
        "expected": {
            "locations": ["Clinic B", "Clinic D"],
            "priorities": {"Clinic B": "high", "Clinic D": "high"},
            "supplies": {"Clinic B": "blood", "Clinic D": "vaccines"},
            "constraints": _default_constraints(),
        },
        "description": "Multiple high-priority deliveries",
    },
    {
        "id": "priority_004",
        "category": "priority",
        "input": "Deliver painkillers to Clinic A and life-threatening situation at Clinic D needs epinephrine",
        "expected": {
            "locations": ["Clinic A", "Clinic D"],
            "priorities": {"Clinic D": "high"},
            "supplies": {"Clinic A": "painkillers", "Clinic D": "epinephrine"},
            "constraints": _default_constraints(),
        },
        "description": "Life-threatening triggers high priority",
    },

    # ===== CONSTRAINT EXTRACTION =====
    {
        "id": "constraint_001",
        "category": "constraints",
        "input": "Deliver blood to Clinic B, avoid the military area",
        "expected": {
            "locations": ["Clinic B"],
            "priorities": {},
            "supplies": {"Clinic B": "blood"},
            "constraints": _default_constraints(avoid_zones=["military area"]),
        },
        "description": "Single avoid zone",
    },
    {
        "id": "constraint_002",
        "category": "constraints",
        "input": "Send insulin to Clinic A, there is a storm approaching",
        "expected": {
            "locations": ["Clinic A"],
            "priorities": {},
            "supplies": {"Clinic A": "insulin"},
            "constraints": _default_constraints(weather_concern="storm approaching"),
        },
        "description": "Weather concern extraction",
    },
    {
        "id": "constraint_003",
        "category": "constraints",
        "input": "Deliver vaccines to Clinic C within the next hour, this is time-sensitive",
        "expected": {
            "locations": ["Clinic C"],
            "priorities": {},
            "supplies": {"Clinic C": "vaccines"},
            "constraints": _default_constraints(time_sensitive=True),
        },
        "description": "Time-sensitive flag",
    },
    {
        "id": "constraint_004",
        "category": "constraints",
        "input": "Urgently deliver blood to Clinic B, avoid military zone and airport area, storm coming in",
        "expected": {
            "locations": ["Clinic B"],
            "priorities": {"Clinic B": "high"},
            "supplies": {"Clinic B": "blood"},
            "constraints": _default_constraints(
                avoid_zones=["military zone", "airport area"],
                weather_concern="storm coming in",
                time_sensitive=False,
            ),
        },
        "description": "Multiple constraints combined with priority",
    },
    {
        "id": "constraint_005",
        "category": "constraints",
        "input": "Emergency delivery of surgical kit to Clinic D, bypass restricted airspace, heavy winds reported, need it ASAP",
        "expected": {
            "locations": ["Clinic D"],
            "priorities": {"Clinic D": "high"},
            "supplies": {"Clinic D": "surgical kit"},
            "constraints": _default_constraints(
                avoid_zones=["restricted airspace"],
                weather_concern="heavy winds",
                time_sensitive=True,
            ),
        },
        "description": "All constraint types active",
    },

    # ===== DEFAULTS / MISSING FIELDS =====
    {
        "id": "defaults_001",
        "category": "defaults",
        "input": "Deliver to Clinic A",
        "expected": {
            "locations": ["Clinic A"],
            "priorities": {},
            "supplies": {"Clinic A": "medical supplies"},
            "constraints": _default_constraints(),
        },
        "description": "No supply specified, should default",
    },
    {
        "id": "defaults_002",
        "category": "defaults",
        "input": "Send something to Clinic B and Clinic C",
        "expected": {
            "locations": ["Clinic B", "Clinic C"],
            "priorities": {},
            "supplies": {"Clinic B": "medical supplies", "Clinic C": "medical supplies"},
            "constraints": _default_constraints(),
        },
        "description": "Vague supply for multiple locations",
    },
    {
        "id": "defaults_003",
        "category": "defaults",
        "input": "Clinic D needs a delivery",
        "expected": {
            "locations": ["Clinic D"],
            "priorities": {},
            "supplies": {"Clinic D": "medical supplies"},
            "constraints": _default_constraints(),
        },
        "description": "Minimal request with default supply",
    },

    # ===== EDGE CASES =====
    {
        "id": "edge_001",
        "category": "edge_cases",
        "input": "",
        "expected": None,
        "description": "Empty input should raise ValueError",
    },
    {
        "id": "edge_002",
        "category": "edge_cases",
        "input": "   ",
        "expected": None,
        "description": "Whitespace-only input should raise ValueError",
    },
    {
        "id": "edge_003",
        "category": "edge_cases",
        "input": "What is the weather like today?",
        "expected": None,
        "description": "Non-delivery request — should fail or return empty locations",
    },
    {
        "id": "edge_004",
        "category": "edge_cases",
        "input": "deliver insulin to clinic a",
        "expected": {
            "locations": ["Clinic A"],
            "priorities": {},
            "supplies": {"Clinic A": "insulin"},
            "constraints": _default_constraints(),
        },
        "description": "Lowercase location name — should fuzzy match",
    },
    {
        "id": "edge_005",
        "category": "edge_cases",
        "input": "Deliver insulin to ClinicA and blood to ClinicB urgently",
        "expected": {
            "locations": ["Clinic A", "Clinic B"],
            "priorities": {"Clinic B": "high"},
            "supplies": {"Clinic A": "insulin", "Clinic B": "blood"},
            "constraints": _default_constraints(),
        },
        "description": "No-space location names — should fuzzy match",
    },
    {
        "id": "edge_006",
        "category": "edge_cases",
        "input": "DELIVER INSULIN TO CLINIC A AND BLOOD TO CLINIC B",
        "expected": {
            "locations": ["Clinic A", "Clinic B"],
            "priorities": {},
            "supplies": {"Clinic A": "insulin", "Clinic B": "blood"},
            "constraints": _default_constraints(),
        },
        "description": "All caps input",
    },

    # ===== REROUTE REQUESTS =====
    {
        "id": "reroute_001",
        "category": "reroute",
        "input": "Add an emergency insulin delivery to Clinic D",
        "expected": {
            "locations": ["Clinic D"],
            "priorities": {"Clinic D": "high"},
            "supplies": {"Clinic D": "insulin"},
            "constraints": _default_constraints(),
        },
        "description": "Mid-flight add with emergency priority",
    },
    {
        "id": "reroute_002",
        "category": "reroute",
        "input": "New stop needed: deliver bandages to Clinic A",
        "expected": {
            "locations": ["Clinic A"],
            "priorities": {},
            "supplies": {"Clinic A": "bandages"},
            "constraints": _default_constraints(),
        },
        "description": "Mid-flight add, normal priority",
    },
    {
        "id": "reroute_003",
        "category": "reroute",
        "input": "Reroute to include Clinic C for vaccines, avoid storm area",
        "expected": {
            "locations": ["Clinic C"],
            "priorities": {},
            "supplies": {"Clinic C": "vaccines"},
            "constraints": _default_constraints(avoid_zones=["storm area"]),
        },
        "description": "Reroute with constraint",
    },
    # ===== CONSTRAINT RESOLUTION =====
    {
        "id": "constraint_res_001",
        "category": "constraint_resolution",
        "input": "Deliver blood to Clinic B, avoid the military zone",
        "expected": {
            "locations": ["Clinic B"],
            "priorities": {},
            "supplies": {"Clinic B": "blood"},
            "constraints": _default_constraints(avoid_zones=["military zone"]),
        },
        "description": "Military zone should resolve to Military Zone Alpha",
    },
    {
        "id": "constraint_res_002",
        "category": "constraint_resolution",
        "input": "Send insulin to Clinic A, stay away from the airport",
        "expected": {
            "locations": ["Clinic A"],
            "priorities": {},
            "supplies": {"Clinic A": "insulin"},
            "constraints": _default_constraints(avoid_zones=["airport"]),
        },
        "description": "Airport should resolve to Airport Exclusion zone",
    },
    {
        "id": "constraint_res_003",
        "category": "constraint_resolution",
        "input": "Deliver vaccines to Clinic C and Clinic D, avoid military and airport areas, high winds reported",
        "expected": {
            "locations": ["Clinic C", "Clinic D"],
            "priorities": {},
            "supplies": {"Clinic C": "vaccines", "Clinic D": "vaccines"},
            "constraints": _default_constraints(
                avoid_zones=["military area", "airport area"],
                weather_concern="high winds",
            ),
        },
        "description": "Multiple zones + weather constraint",
    },

    # ===== WHAT-IF SCENARIOS (for coordinator testing) =====
    {
        "id": "whatif_001",
        "category": "what_if",
        "input": "What if it rains heavily at Clinic B?",
        "expected": None,
        "description": "What-if query — should be routed to scenario analysis, not parsing",
    },
    {
        "id": "whatif_002",
        "category": "what_if",
        "input": "What happens if the military zone expands?",
        "expected": None,
        "description": "What-if about geofence change",
    },
    {
        "id": "whatif_003",
        "category": "what_if",
        "input": "Suppose we lose contact with Clinic D, what do we do?",
        "expected": None,
        "description": "What-if about location unavailability",
    },

    # ===== MULTI-TURN CONTEXT =====
    {
        "id": "multiturn_001",
        "category": "multi_turn",
        "input": "Also add Clinic D to that delivery",
        "expected": None,
        "description": "Follow-up requires context from previous plan — cannot be parsed standalone",
    },
    {
        "id": "multiturn_002",
        "category": "multi_turn",
        "input": "Make Clinic A urgent instead",
        "expected": None,
        "description": "Modification of previous plan — requires conversation context",
    },
]


def get_test_cases(category: str = None) -> list:
    """
    Get test cases, optionally filtered by category.

    Args:
        category: Filter by category name. None returns all.

    Returns:
        List of test case dicts.
    """
    if category is None:
        return TEST_CASES
    return [tc for tc in TEST_CASES if tc["category"] == category]


def get_categories() -> list:
    """Return list of unique test case categories."""
    return sorted(set(tc["category"] for tc in TEST_CASES))


# --- Quick test ---
if __name__ == "__main__":
    print(f"Total test cases: {len(TEST_CASES)}")
    for cat in get_categories():
        cases = get_test_cases(cat)
        print(f"  {cat}: {len(cases)} cases")
