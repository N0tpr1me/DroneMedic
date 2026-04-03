"""Voice command -> LLM -> Fleet action pipeline."""

from __future__ import annotations

import json
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException
from openai import OpenAI
from pydantic import BaseModel

from config import OPENAI_API_KEY, OPENAI_BASE_URL

router = APIRouter()
logger = logging.getLogger("DroneMedic.VoiceCommand")

# ---------------------------------------------------------------------------
# Fleet tool definitions for OpenAI function-calling
# ---------------------------------------------------------------------------

FLEET_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "redirect_drone",
            "description": "Redirect a drone to a new destination",
            "parameters": {
                "type": "object",
                "properties": {
                    "drone_id": {"type": "integer", "description": "ID of the drone to redirect"},
                    "destination": {"type": "string", "description": "Target location name"},
                    "priority": {
                        "type": "string",
                        "enum": ["normal", "high", "critical"],
                        "description": "Delivery priority level",
                    },
                },
                "required": ["drone_id", "destination"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_delivery_eta",
            "description": "Get estimated time of arrival for a delivery",
            "parameters": {
                "type": "object",
                "properties": {
                    "drone_id": {"type": "integer", "description": "ID of the drone"},
                },
                "required": ["drone_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_fleet_status",
            "description": "Get current status of all drones in the fleet",
            "parameters": {
                "type": "object",
                "properties": {},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "pause_drone",
            "description": "Pause a drone mid-flight, holding its current position",
            "parameters": {
                "type": "object",
                "properties": {
                    "drone_id": {"type": "integer", "description": "ID of the drone to pause"},
                },
                "required": ["drone_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "emergency_recall",
            "description": "Immediately recall a drone back to the depot",
            "parameters": {
                "type": "object",
                "properties": {
                    "drone_id": {"type": "integer", "description": "ID of the drone to recall"},
                    "reason": {"type": "string", "description": "Reason for emergency recall"},
                },
                "required": ["drone_id"],
            },
        },
    },
]

SYSTEM_PROMPT = (
    "You are a DroneMedic fleet command interpreter. Parse the operator's voice "
    "command and decide which fleet action to take. Use exactly one tool call. "
    "If the command is ambiguous or does not map to any fleet action, respond "
    "with a short clarification request instead of calling a tool."
)

# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------


class VoiceCommandRequest(BaseModel):
    command: str


class VoiceCommandResponse(BaseModel):
    action: Optional[str] = None
    parameters: Optional[dict] = None
    explanation: str = ""
    reasoning: list[str] = []


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------


@router.post("/api/voice-command", response_model=VoiceCommandResponse)
async def handle_voice_command(req: VoiceCommandRequest) -> VoiceCommandResponse:
    """Parse voice command via LLM function-calling and return fleet action."""
    if not req.command.strip():
        raise HTTPException(status_code=422, detail="Command cannot be empty")

    try:
        client = OpenAI(api_key=OPENAI_API_KEY, base_url=OPENAI_BASE_URL)
        response = client.chat.completions.create(
            model="azure/gpt-5.3-chat",
            max_tokens=512,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": req.command},
            ],
            tools=FLEET_TOOLS,
            tool_choice="auto",
        )

        message = response.choices[0].message

        # If the model chose a tool call, extract action + parameters
        if message.tool_calls:
            tool_call = message.tool_calls[0]
            action = tool_call.function.name
            try:
                parameters = json.loads(tool_call.function.arguments)
            except json.JSONDecodeError:
                parameters = {}

            explanation = message.content or f"Executing {action}"
            reasoning = [
                f"Parsed command: {req.command!r}",
                f"Selected action: {action}",
                f"Parameters: {json.dumps(parameters)}",
            ]

            logger.info("Voice command -> %s(%s)", action, parameters)

            return VoiceCommandResponse(
                action=action,
                parameters=parameters,
                explanation=explanation,
                reasoning=reasoning,
            )

        # No tool call — model returned a clarification or refusal
        return VoiceCommandResponse(
            explanation=message.content or "Could not determine fleet action from command.",
            reasoning=[f"No tool call selected for: {req.command!r}"],
        )

    except Exception as exc:
        logger.exception("Voice command processing failed")
        raise HTTPException(status_code=500, detail=f"Voice command failed: {exc}") from exc
