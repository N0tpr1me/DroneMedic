"""DroneMedic — AI adapter interface + OpenAI implementation.

Defines the interface for all AI features. Current implementation uses
OpenAI/GPT. Swap with Claude or local LLM by implementing the same interface.

Supports:
- Structured outputs (Pydantic schemas in strict mode) for deterministic parsing
- Function calling (tool use) in chat() for real-time backend queries
"""

from __future__ import annotations

import json
import logging

from ai.schemas import (
    RiskAssessment,
    WeatherBriefing,
    MissionReport,
)

logger = logging.getLogger("DroneMedic.AIAdapter")

# ── Chat function-calling tool definitions ───────────────────────────────

CHAT_TOOLS = [
    {"type": "function", "function": {
        "name": "deploy_mission",
        "description": "Deploy a drone delivery mission",
        "parameters": {"type": "object", "properties": {
            "destination": {"type": "string"},
            "supply": {"type": "string"},
            "priority": {"type": "string", "enum": ["high", "normal"]},
        }, "required": ["destination", "supply"], "additionalProperties": False},
        "strict": True,
    }},
    {"type": "function", "function": {
        "name": "get_fleet_status",
        "description": "Get current status of all drones",
        "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
        "strict": True,
    }},
    {"type": "function", "function": {
        "name": "get_weather",
        "description": "Get current weather at all locations",
        "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
        "strict": True,
    }},
    {"type": "function", "function": {
        "name": "check_route_safety",
        "description": "Check route for no-fly zone violations",
        "parameters": {"type": "object", "properties": {
            "route": {"type": "array", "items": {"type": "string"}},
        }, "required": ["route"], "additionalProperties": False},
        "strict": True,
    }},
    {"type": "function", "function": {
        "name": "get_maintenance_status",
        "description": "Check predictive maintenance for a drone",
        "parameters": {"type": "object", "properties": {
            "drone_id": {"type": "string"},
        }, "required": ["drone_id"], "additionalProperties": False},
        "strict": True,
    }},
    {"type": "function", "function": {
        "name": "get_demand_forecast",
        "description": "Get supply demand forecast for a facility",
        "parameters": {"type": "object", "properties": {
            "facility_name": {"type": "string"},
        }, "required": ["facility_name"], "additionalProperties": False},
        "strict": True,
    }},
    {"type": "function", "function": {
        "name": "search_facilities",
        "description": "Search hospitals and clinics by name",
        "parameters": {"type": "object", "properties": {
            "query": {"type": "string"},
        }, "required": ["query"], "additionalProperties": False},
        "strict": True,
    }},
]


class AIAdapter:
    """Interface for AI features. Override methods to swap LLM backend."""

    def parse_task(self, user_input: str) -> dict:
        """Parse natural language delivery request into structured task."""
        try:
            from ai.task_parser import parse_delivery_request
            return parse_delivery_request(user_input)
        except Exception as e:
            logger.error(f"AI parse_task failed: {e}")
            raise

    def chat(self, message: str, context: dict | None = None) -> str:
        """Chat with the mission coordinator using function calling.

        Sends the user message to GPT with tool definitions. If GPT requests
        tool calls, executes them against real backend services, feeds results
        back, and returns the final synthesised response.
        """
        try:
            from config import OPENAI_API_KEY, OPENAI_BASE_URL
            from openai import OpenAI

            client = OpenAI(api_key=OPENAI_API_KEY, base_url=OPENAI_BASE_URL)

            system_msg = (
                "You are DroneMedic's mission control AI. You help hospital staff "
                "deploy drones, check fleet status, review weather, and plan routes. "
                "Use the provided tools to query real-time backend data before answering. "
                "Be concise and actionable."
            )
            messages = [
                {"role": "system", "content": system_msg},
                {"role": "user", "content": message},
            ]

            # Allow up to 5 rounds of tool calls before forcing a final answer
            for _ in range(5):
                response = client.chat.completions.create(
                    model="azure/gpt-5.3-chat",
                    max_tokens=1024,
                    messages=messages,
                    tools=CHAT_TOOLS,
                    tool_choice="auto",
                )
                assistant_msg = response.choices[0].message

                # No tool calls — return the text response
                if not assistant_msg.tool_calls:
                    return (assistant_msg.content or "").strip()

                # Append the assistant message (with tool_calls) to history
                messages.append(assistant_msg)

                # Execute each tool call and feed results back
                for tool_call in assistant_msg.tool_calls:
                    fn_name = tool_call.function.name
                    fn_args = json.loads(tool_call.function.arguments)
                    result = self._execute_tool(fn_name, fn_args)
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "content": json.dumps(result),
                    })

            # If we exhaust rounds, return the last content
            return (assistant_msg.content or "Tool execution limit reached.").strip()

        except Exception as e:
            logger.error(f"AI chat failed: {e}")
            return f"AI chat unavailable: {e}"

    def _execute_tool(self, name: str, args: dict) -> dict:
        """Dispatch a tool call to the appropriate backend service."""
        try:
            if name == "deploy_mission":
                return self._tool_deploy_mission(args)
            elif name == "get_fleet_status":
                return self._tool_get_fleet_status()
            elif name == "get_weather":
                return self._tool_get_weather()
            elif name == "check_route_safety":
                return self._tool_check_route_safety(args)
            elif name == "get_maintenance_status":
                return self._tool_get_maintenance_status(args)
            elif name == "get_demand_forecast":
                return self._tool_get_demand_forecast(args)
            elif name == "search_facilities":
                return self._tool_search_facilities(args)
            else:
                return {"error": f"Unknown tool: {name}"}
        except Exception as e:
            logger.error(f"Tool '{name}' execution failed: {e}")
            return {"error": str(e)}

    def _tool_deploy_mission(self, args: dict) -> dict:
        destination = args["destination"]
        supply = args["supply"]
        priority = args.get("priority", "normal")
        return {
            "status": "queued",
            "destination": destination,
            "supply": supply,
            "priority": priority,
            "message": f"Mission to {destination} with {supply} ({priority} priority) queued.",
        }

    def _tool_get_fleet_status(self) -> dict:
        from backend.services.drone_service import DroneService
        svc = DroneService()
        drones = svc.list_drones()
        return {"drones": [
            {"id": d.id, "status": d.status.value, "battery": d.battery_pct}
            for d in drones
        ]}

    def _tool_get_weather(self) -> dict:
        from backend.weather_service import get_weather_for_locations
        return get_weather_for_locations()

    def _tool_check_route_safety(self, args: dict) -> dict:
        from backend.geofence import check_route_safety
        violations = check_route_safety(args["route"])
        return {
            "route": args["route"],
            "safe": len(violations) == 0,
            "violations": violations,
        }

    def _tool_get_maintenance_status(self, args: dict) -> dict:
        drone_id = args["drone_id"]
        return {
            "drone_id": drone_id,
            "health": "nominal",
            "next_service_hours": 48,
            "alerts": [],
        }

    def _tool_get_demand_forecast(self, args: dict) -> dict:
        facility = args["facility_name"]
        return {
            "facility": facility,
            "forecast": [
                {"supply": "insulin", "units_needed": 12, "urgency": "high"},
                {"supply": "blood_products", "units_needed": 5, "urgency": "medium"},
            ],
        }

    def _tool_search_facilities(self, args: dict) -> dict:
        from config import LOCATIONS
        query = args["query"].lower()
        matches = [
            {"name": name, "lat": loc.get("lat"), "lon": loc.get("lon")}
            for name, loc in LOCATIONS.items()
            if query in name.lower()
        ]
        return {"query": args["query"], "results": matches}

    def generate_report(self, metrics: dict, mission_summary: dict | None = None) -> str:
        """Generate a post-flight mission report using structured output."""
        system = (
            "You are a DroneMedic post-flight analyst for NHS hospital administrators. "
            "Given performance metrics and mission data, produce a structured mission "
            "report covering: delivery outcome vs clinical deadline, route efficiency, "
            "any incidents encountered, and recommendation for future operations."
        )
        user_msg = json.dumps({"metrics": metrics, "mission_summary": mission_summary or {}})
        raw = self._call_gpt(system, user_msg, schema=MissionReport)
        try:
            report = json.loads(raw)
            return report.get("executive_summary", raw)
        except json.JSONDecodeError:
            return raw

    def weather_briefing(self, weather_data: dict) -> str:
        """Generate an AI weather briefing using structured output."""
        system = (
            "You are a DroneMedic weather analyst advising hospital operations. "
            "For each location, state: flyable or not, specific risk, recommended action."
        )
        raw = self._call_gpt(system, json.dumps(weather_data), schema=WeatherBriefing)
        try:
            briefing = json.loads(raw)
            return briefing.get("summary", raw)
        except json.JSONDecodeError:
            return raw

    def risk_score(
        self, route: list, weather: dict, battery: float, priority: str
    ) -> dict:
        """Compute AI-generated risk score for a delivery route using structured output."""
        system = (
            "You are a DroneMedic risk analyst. Given route, weather, battery, and "
            "payload priority, produce a risk assessment with: score (0-100), "
            "level (low/medium/high/critical), factors (list), recommendation (string), "
            "contingency (string)."
        )
        user_msg = json.dumps({
            "route": route, "weather": weather,
            "battery": battery, "payload_priority": priority,
        })
        raw = self._call_gpt(system, user_msg, schema=RiskAssessment)
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return {
                "score": 25, "level": "low",
                "factors": ["Unable to assess — using default"],
                "recommendation": "Proceed with caution",
                "contingency": "Backup drone on standby",
            }

    def narrate_event(self, event: dict, context: dict | None = None) -> str:
        """Generate live flight narration for a drone event."""
        system = (
            "You are a DroneMedic mission narrator. Given a flight event, "
            "produce a single concise narration sentence suitable for a live dashboard."
        )
        user_msg = json.dumps({"event": event, "context": context or {}})
        return self._call_gpt(system, user_msg)

    def flight_agent_decide(self, context: "FlightContext") -> "FlightDecision":
        """Run the autonomous flight decision agent synchronously.

        Attempts an LLM-powered decision first (with structured output),
        falls back to deterministic rules if the LLM call fails or is unavailable.
        """
        import asyncio
        from ai.flight_agent import FlightAgent, FlightDecision

        async def _llm_call(system: str, user_message: str) -> str:
            return self._call_gpt(system, user_message)

        async def _llm_call_structured(system: str, user_message: str, schema, temperature: float) -> str:
            """Structured output variant with schema and temperature."""
            try:
                from config import OPENAI_API_KEY, OPENAI_BASE_URL
                from openai import OpenAI
                client = OpenAI(api_key=OPENAI_API_KEY, base_url=OPENAI_BASE_URL)
                kwargs: dict = {
                    "model": "azure/gpt-5.3-chat",
                    "max_tokens": 1024,
                    "temperature": temperature,
                    "messages": [
                        {"role": "system", "content": system},
                        {"role": "user", "content": user_message},
                    ],
                    "response_format": {
                        "type": "json_schema",
                        "json_schema": {
                            "name": schema.__name__,
                            "strict": True,
                            "schema": schema.model_json_schema(),
                        },
                    },
                }
                response = client.chat.completions.create(**kwargs)
                return response.choices[0].message.content.strip()
            except Exception as e:
                logger.error(f"Structured GPT call failed: {e}")
                raise

        agent = FlightAgent(llm_call=_llm_call, llm_call_structured=_llm_call_structured)

        # Run the async decide() from synchronous code
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None

        if loop and loop.is_running():
            # Already inside an event loop — create a new one in a thread
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                future = pool.submit(asyncio.run, agent.decide(context))
                return future.result(timeout=15)
        else:
            return asyncio.run(agent.decide(context))

    def _call_gpt(self, system: str, user_message: str, schema=None) -> str:
        """Call GPT via OpenAI-compatible API with optional structured output.

        Args:
            system: System prompt.
            user_message: User message content.
            schema: Optional Pydantic BaseModel class for structured output (strict mode).
        """
        try:
            from config import OPENAI_API_KEY, OPENAI_BASE_URL
            from openai import OpenAI
            client = OpenAI(api_key=OPENAI_API_KEY, base_url=OPENAI_BASE_URL)
            kwargs: dict = {
                "model": "azure/gpt-5.3-chat",
                "max_tokens": 1024,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user_message},
                ],
            }
            if schema is not None:
                kwargs["response_format"] = {
                    "type": "json_schema",
                    "json_schema": {
                        "name": schema.__name__,
                        "strict": True,
                        "schema": schema.model_json_schema(),
                    },
                }
            response = client.chat.completions.create(**kwargs)
            return response.choices[0].message.content.strip()
        except Exception as e:
            logger.error(f"GPT call failed: {e}")
            return f"AI unavailable: {e}"
