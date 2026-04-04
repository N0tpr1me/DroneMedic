"""
DroneMedic - AI Module

Provides NLP task parsing, LLM mission coordination, evaluation,
confidence scoring, hallucination mitigation, constraint enforcement,
error analysis, and input preprocessing for drone delivery requests.
"""

# Core parsing (backward-compatible)
from ai.task_parser import parse_delivery_request, parse_reroute_request

# Mission Coordinator (enhanced LLM with few-shot, CoT, what-if, re-planning)
from ai.coordinator import MissionCoordinator

# Pipeline Orchestrator (full pipeline: parse -> validate -> gate -> constrain)
from ai.orchestrator import AIOrchestrator

# Conversation state
from ai.conversation import ConversationState, detect_intent

# Confidence scoring
from ai.confidence import score_confidence, format_confidence_report

# Hallucination mitigation
from ai.validator import validate_parsed_output, confidence_gate, cross_validate

# Constraint enforcement
from ai.constraint_bridge import (
    resolve_avoid_zones, validate_route_constraints,
    check_constraints_satisfiable, get_resolved_zone_names,
)

# Error analysis
from ai.error_analysis import (
    log_error, get_error_summary, get_error_report, get_tracker,
    ErrorType, ErrorRecord, ErrorTracker,
)

# Evaluation
from ai.evaluation import evaluate_all, evaluate_single, format_evaluation_report

# Preprocessor
from ai.preprocessor import normalize_input, extract_keywords, fuzzy_match_location

# Test dataset
from ai.test_dataset import TEST_CASES, get_test_cases, get_categories

__all__ = [
    # Core parsing
    "parse_delivery_request",
    "parse_reroute_request",
    # Mission Coordinator
    "MissionCoordinator",
    # Orchestrator
    "AIOrchestrator",
    # Conversation
    "ConversationState",
    "detect_intent",
    # Confidence
    "score_confidence",
    "format_confidence_report",
    # Validator
    "validate_parsed_output",
    "confidence_gate",
    "cross_validate",
    # Constraint bridge
    "resolve_avoid_zones",
    "validate_route_constraints",
    "check_constraints_satisfiable",
    "get_resolved_zone_names",
    # Error analysis
    "log_error",
    "get_error_summary",
    "get_error_report",
    "get_tracker",
    "ErrorType",
    "ErrorRecord",
    "ErrorTracker",
    # Evaluation
    "evaluate_all",
    "evaluate_single",
    "format_evaluation_report",
    # Preprocessor
    "normalize_input",
    "extract_keywords",
    "fuzzy_match_location",
    # Test dataset
    "TEST_CASES",
    "get_test_cases",
    "get_categories",
]
