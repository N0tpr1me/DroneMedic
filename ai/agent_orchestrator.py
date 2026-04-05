"""Multi-agent orchestrator — specialized agents with handoff capabilities."""
from __future__ import annotations

import json
import logging
from ai.responses_client import ResponsesClient

logger = logging.getLogger(__name__)

# Agent definitions
AGENTS: dict[str, dict] = {
    "triage": {
        "name": "Triage Agent",
        "instructions": (
            "You are the DroneMedic triage agent. Classify user intent and route to the right specialist:\n"
            "- delivery_request -> Parser Agent\n"
            "- safety_question -> Safety Agent\n"
            "- analytics_query -> Analyst Agent\n"
            "- compliance_check -> Compliance Agent\n"
            "- general_chat -> respond directly\n"
            'Respond JSON: {"route_to": "parser|safety|analyst|compliance|self", '
            '"intent": "description", "confidence": 0.0-1.0}'
        ),
        "temperature": 0.1,
    },
    "parser": {
        "name": "Parser Agent",
        "instructions": (
            "You are a delivery request parser. Extract locations, supplies, priorities, "
            "and constraints from natural language. Respond with structured JSON."
        ),
        "temperature": 0.1,
    },
    "safety": {
        "name": "Safety Agent",
        "instructions": (
            "You are a flight safety officer. Evaluate conditions using available tools. "
            "Check weather, no-fly zones, battery levels. Recommend go/no-go decisions."
        ),
        "temperature": 0.0,
        "tools_needed": ["get_weather", "check_route_safety", "get_maintenance_status"],
    },
    "analyst": {
        "name": "Analyst Agent",
        "instructions": (
            "You are a telemetry data analyst. Use code interpreter to analyze flight data, "
            "compute statistics, and generate insights."
        ),
        "temperature": 0.3,
        "tools_needed": ["code_interpreter"],
    },
    "compliance": {
        "name": "Compliance Agent",
        "instructions": (
            "You are a medical compliance officer. Reference regulations and protocols. "
            "Verify temperature chains, custody procedures, and delivery confirmations."
        ),
        "temperature": 0.2,
        "tools_needed": ["file_search"],
    },
    "narrator": {
        "name": "Narrator Agent",
        "instructions": (
            "You are an aviation flight narrator. Generate clear, professional flight status updates. "
            "Use concise aviation language."
        ),
        "temperature": 0.8,
    },
}


class AgentOrchestrator:
    """Routes queries to specialized agents with handoff."""

    def __init__(self) -> None:
        self.client = ResponsesClient()
        self.conversation_history: list[dict] = []

    async def process(self, user_input: str, context: dict | None = None) -> dict:
        """Process user input through multi-agent pipeline."""
        if not self.client.available():
            return {"agent": "fallback", "response": "AI not available", "route": "self"}

        # Step 1: Triage — classify intent
        triage_config = AGENTS["triage"]
        triage_result = self.client.query(
            instructions=triage_config["instructions"],
            user_input=user_input,
            temperature=triage_config["temperature"],
        )

        try:
            routing = json.loads(triage_result["text"])
            route_to = routing.get("route_to", "self")
            intent = routing.get("intent", "unknown")
            confidence = routing.get("confidence", 0.5)
        except (json.JSONDecodeError, KeyError):
            route_to = "self"
            intent = "general"
            confidence = 0.3

        # Step 2: Route to specialist
        if route_to == "self" or route_to not in AGENTS:
            return {
                "agent": "triage",
                "response": triage_result["text"],
                "route": "self",
                "intent": intent,
                "confidence": confidence,
            }

        agent_config = AGENTS[route_to]

        # Build context-enhanced input
        enhanced_input = user_input
        if context:
            enhanced_input = (
                f"Context: {json.dumps(context, default=str)}\n\nUser request: {user_input}"
            )

        # Call specialist agent
        specialist_result = self.client.query(
            instructions=agent_config["instructions"],
            user_input=enhanced_input,
            temperature=agent_config.get("temperature"),
        )

        return {
            "agent": route_to,
            "agent_name": agent_config["name"],
            "response": specialist_result["text"],
            "route": route_to,
            "intent": intent,
            "confidence": confidence,
            "api_used": specialist_result.get("api", "unknown"),
        }

    def get_agent_status(self) -> dict:
        """Return status of all agents for UI display."""
        return {
            name: {
                "name": config["name"],
                "temperature": config.get("temperature", "default"),
                "tools": config.get("tools_needed", []),
                "status": "ready" if self.client.available() else "offline",
            }
            for name, config in AGENTS.items()
        }
