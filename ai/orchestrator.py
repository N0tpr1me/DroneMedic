"""
DroneMedic - AI Pipeline Orchestrator

Top-level integration layer that ties together parsing, validation,
confidence gating, and constraint enforcement into a single pipeline.
"""

import json
from ai.coordinator import MissionCoordinator
from ai.validator import validate_parsed_output, confidence_gate, cross_validate
from ai.constraint_bridge import resolve_avoid_zones, validate_route_constraints
from ai.confidence import score_confidence
from ai.error_analysis import log_error, ErrorType


class AIOrchestrator:
    """
    Orchestrates the full AI pipeline:
    input -> parse -> validate -> confidence gate -> resolve constraints -> output

    Provides a unified interface for delivery parsing, what-if analysis,
    and dynamic re-planning with full hallucination mitigation.
    """

    def __init__(self, api_key: str = None, confidence_threshold: float = 0.6):
        self._coordinator = MissionCoordinator(api_key)
        self._confidence_threshold = confidence_threshold

    def process_request(self, user_input: str) -> dict:
        """
        Full pipeline: parse, validate, gate, and resolve constraints.

        Steps:
        1. Parse via coordinator (few-shot + CoT)
        2. Semantic validation
        3. Confidence gating (accept/warn/reject)
        4. If rejected, retry once with original parser
        5. Resolve NLP constraints to actual geofence zones
        6. Return enriched result

        Args:
            user_input: Natural language delivery request.

        Returns:
            Enriched task dict with standard fields plus:
            - "validation": validation result
            - "confidence": confidence scores
            - "gate": gate decision
            - "resolved_constraints": resolved zone mappings
        """
        # Step 1: Parse via coordinator
        try:
            task = self._coordinator.parse_request(user_input)
        except ValueError as e:
            log_error(ErrorType.JSON_PARSE_FAILURE, str(e), user_input)
            raise

        # Step 2: Semantic validation
        validation = validate_parsed_output(task, user_input)

        # Step 3: Confidence gating
        gate = confidence_gate(
            task, user_input,
            threshold=self._confidence_threshold,
        )

        # Step 4: If rejected, retry with stricter approach
        if gate["action"] == "reject":
            try:
                task = self._coordinator.parse_request(
                    f"IMPORTANT: Parse this EXACTLY. {user_input}"
                )
                validation = validate_parsed_output(task, user_input)
                gate = confidence_gate(task, user_input, threshold=self._confidence_threshold)
            except ValueError:
                pass  # Keep the original rejected result

        # Auto-fix validation errors where possible
        if not validation.valid:
            task = self._auto_correct(task, validation)

        # Step 5: Resolve NLP constraints to geofence zones
        constraints = task.get("constraints", {})
        avoid_zones = constraints.get("avoid_zones", [])
        resolved_constraints = resolve_avoid_zones(avoid_zones) if avoid_zones else []

        # Build enriched result
        result = {
            **task,
            "validation": validation.to_dict(),
            "confidence": gate.get("confidence", {}),
            "gate": {
                "action": gate["action"],
                "combined_score": gate["combined_score"],
                "reason": gate["reason"],
            },
            "resolved_constraints": [
                {"nlp_text": r["nlp_text"], "resolved": r["resolved"], "zone_name": r["zone_name"]}
                for r in resolved_constraints
            ],
        }

        return result

    def process_what_if(self, scenario: str) -> dict:
        """
        Handle a what-if scenario query.

        Args:
            scenario: The hypothetical scenario description.

        Returns:
            Scenario analysis dict from the coordinator.
        """
        return self._coordinator.analyze_scenario(scenario)

    def process_replan(self, event: dict, remaining_stops: list = None) -> dict:
        """
        Handle a dynamic re-planning event with validation.

        Args:
            event: Event dict (type, location, details).
            remaining_stops: List of unvisited stops.

        Returns:
            Re-planning result with validation applied to the updated plan.
        """
        result = self._coordinator.replan(event, remaining_stops=remaining_stops)

        # If rerouting, validate the updated plan
        if result.get("action") in ("reroute", "add_stop"):
            updated_plan = {
                "locations": result.get("updated_locations", []),
                "priorities": result.get("updated_priorities", {}),
                "supplies": result.get("updated_supplies", {}),
                "constraints": result.get("updated_constraints", {}),
            }

            validation = validate_parsed_output(updated_plan, str(event))
            result["validation"] = validation.to_dict()

        return result

    def converse(self, message: str) -> dict:
        """Multi-turn conversation entry point."""
        return self._coordinator.converse(message)

    def validate_route(self, route: list[str], plan: dict) -> dict:
        """
        Pre-flight route validation against plan constraints.

        Args:
            route: Ordered list of location names.
            plan: The delivery plan with constraints.

        Returns:
            Constraint validation result.
        """
        constraints = plan.get("constraints", {})
        return validate_route_constraints(route, constraints, plan)

    @property
    def coordinator(self) -> MissionCoordinator:
        """Access the underlying coordinator."""
        return self._coordinator

    def reset(self) -> None:
        """Reset all state."""
        self._coordinator.reset()

    def _auto_correct(self, task: dict, validation) -> dict:
        """
        Attempt to auto-correct validation errors.
        Only corrects safe, unambiguous issues.
        """
        # Remove invalid locations
        valid_locations = []
        from config import VALID_LOCATIONS
        from ai.preprocessor import fuzzy_match_location

        for loc in task.get("locations", []):
            if loc in VALID_LOCATIONS:
                valid_locations.append(loc)
            else:
                matched = fuzzy_match_location(loc)
                if matched:
                    valid_locations.append(matched)
                    validation.add_correction("locations", loc, matched)

        task["locations"] = valid_locations

        # Fix invalid priority values
        priorities = task.get("priorities", {})
        fixed_priorities = {}
        for loc, level in priorities.items():
            if level in ("high", "normal"):
                fixed_priorities[loc] = level
            elif level in ("urgent", "emergency", "critical"):
                fixed_priorities[loc] = "high"
                validation.add_correction(f"priorities.{loc}", level, "high")

        task["priorities"] = fixed_priorities

        return task


# --- Quick test ---
if __name__ == "__main__":
    print("=" * 60)
    print("  DroneMedic AI — Orchestrator Demo")
    print("=" * 60)
    print("\n  Note: Requires ANTHROPIC_API_KEY to be set.\n")

    orchestrator = AIOrchestrator()

    # Demo: Full pipeline
    print("--- Full Pipeline ---")
    try:
        result = orchestrator.process_request(
            "Deliver insulin to Clinic A urgently and blood to Clinic B, avoid military area"
        )
        # Print core result
        print(f"  Locations: {result['locations']}")
        print(f"  Priorities: {result['priorities']}")
        print(f"  Supplies: {result['supplies']}")
        print(f"  Gate: {result['gate']['action']} (score: {result['gate']['combined_score']})")
        print(f"  Validation valid: {result['validation']['valid']}")
        print(f"  Resolved constraints: {result['resolved_constraints']}")
    except Exception as e:
        print(f"  Error: {e}")

    # Demo: Route validation
    print("\n--- Route Validation ---")
    plan = {
        "locations": ["Clinic A", "Clinic B"],
        "constraints": {"avoid_zones": ["military area"], "weather_concern": "", "time_sensitive": False},
    }
    route_result = orchestrator.validate_route(
        ["Depot", "Clinic B", "Clinic A", "Depot"], plan
    )
    print(f"  Route valid: {route_result['valid']}")
    for v in route_result["violations"]:
        print(f"  VIOLATION: {v['message']}")
    for w in route_result["warnings"]:
        print(f"  WARNING: {w}")
