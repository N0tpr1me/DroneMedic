"""
DroneMedic - AI Mission Coordinator

Full LLM-based mission coordinator with few-shot prompting, chain-of-thought
reasoning, what-if scenario analysis, dynamic re-planning, and multi-turn
conversation support.
"""

import json
import re
from openai import OpenAI
from pydantic import BaseModel

from config import OPENAI_API_KEY, OPENAI_BASE_URL
from ai.prompts import (
    COORDINATOR_SYSTEM_PROMPT,
    WHAT_IF_SYSTEM_PROMPT,
    REPLAN_SYSTEM_PROMPT,
    INTENT_CLASSIFICATION_PROMPT,
)
from ai.schemas import ParsedDeliveryTask
from ai.conversation import ConversationState, detect_intent
from ai.preprocessor import normalize_input


class MissionCoordinator:
    """
    LLM-based mission coordinator that provides intelligent delivery planning,
    scenario analysis, and dynamic re-planning capabilities.
    """

    def __init__(self, api_key: str = None):
        self._client = OpenAI(api_key=api_key or OPENAI_API_KEY, base_url=OPENAI_BASE_URL)
        self._conversation = ConversationState()
        self._model = "azure/gpt-5.3-chat"

    def parse_request(self, user_input: str) -> dict:
        """
        Parse a delivery request using few-shot + chain-of-thought prompting.

        Args:
            user_input: Natural language delivery request.

        Returns:
            Structured task dict with locations, priorities, supplies, constraints.

        Raises:
            ValueError: If the LLM output cannot be parsed or is invalid.
        """
        user_input = normalize_input(user_input)
        if not user_input:
            raise ValueError("Input cannot be empty or whitespace-only.")

        # Truncate excessively long inputs
        if len(user_input) > 2000:
            user_input = user_input[:2000]

        response = self._call_llm(
            system=COORDINATOR_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_input}],
            schema=ParsedDeliveryTask,
            temperature=0.1,
        )

        # With structured output the response is guaranteed valid JSON
        task = json.loads(response)

        # Update conversation state
        self._conversation.add_user_message(user_input)
        self._conversation.add_assistant_message(json.dumps(task))
        self._conversation.current_plan = task

        return task

    def analyze_scenario(self, scenario: str, current_plan: dict = None) -> dict:
        """
        Analyze a what-if scenario and its impact on the delivery plan.

        Args:
            scenario: The hypothetical scenario (e.g., "What if it rains at Clinic B?")
            current_plan: The current delivery plan for context. Uses conversation state if None.

        Returns:
            Dict with impact analysis, severity, recommendations, and revised constraints.
        """
        plan = current_plan or self._conversation.current_plan

        context_parts = [f"Scenario: {scenario}"]
        if plan:
            context_parts.append(f"Current plan: {json.dumps(plan)}")
        else:
            context_parts.append("No current plan — analyzing scenario in general.")

        user_message = "\n".join(context_parts)

        response = self._call_llm(
            system=WHAT_IF_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_message}],
        )

        result = self._extract_json(response)

        # Update conversation
        self._conversation.add_user_message(scenario)
        self._conversation.add_assistant_message(json.dumps(result))

        return result

    def replan(
        self,
        event: dict,
        current_plan: dict = None,
        remaining_stops: list = None,
    ) -> dict:
        """
        Handle a dynamic event and decide on re-planning action.

        Args:
            event: Dict describing the event, e.g.:
                {"type": "weather", "location": "Clinic B", "details": "storm incoming"}
                {"type": "obstacle", "location": "Clinic C", "details": "fallen tree"}
                {"type": "new_delivery", "details": "Emergency blood to Clinic D"}
            current_plan: Current delivery plan. Uses conversation state if None.
            remaining_stops: List of stops not yet visited.

        Returns:
            Dict with action, reasoning, and updated plan if rerouting.
        """
        plan = current_plan or self._conversation.current_plan

        context_parts = [
            f"EVENT: {json.dumps(event)}",
        ]
        if plan:
            context_parts.append(f"CURRENT PLAN: {json.dumps(plan)}")
        if remaining_stops:
            context_parts.append(f"REMAINING STOPS: {json.dumps(remaining_stops)}")

        user_message = "\n".join(context_parts)

        response = self._call_llm(
            system=REPLAN_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_message}],
        )

        result = self._extract_json(response)

        # Update conversation state with the re-plan
        self._conversation.add_user_message(f"[EVENT] {json.dumps(event)}")
        self._conversation.add_assistant_message(json.dumps(result))

        # Update current plan if rerouting
        if result.get("action") in ("reroute", "add_stop"):
            updated_plan = {
                "locations": result.get("updated_locations", []),
                "priorities": result.get("updated_priorities", {}),
                "supplies": result.get("updated_supplies", {}),
                "constraints": result.get("updated_constraints", {
                    "avoid_zones": [], "weather_concern": "", "time_sensitive": False,
                }),
            }
            self._conversation.current_plan = updated_plan

        return result

    def converse(self, message: str) -> dict:
        """
        Multi-turn conversation entry point.

        Detects intent and routes to the appropriate handler.

        Args:
            message: User's message.

        Returns:
            Dict with type, response text, and optional data.
        """
        intent = detect_intent(message)

        if intent == "delivery_request":
            try:
                task = self.parse_request(message)
                return {
                    "type": "plan",
                    "response": f"Delivery plan created for {len(task['locations'])} location(s).",
                    "data": task,
                }
            except ValueError as e:
                return {
                    "type": "error",
                    "response": f"Could not parse delivery request: {e}",
                    "data": None,
                }

        elif intent == "what_if":
            result = self.analyze_scenario(message)
            return {
                "type": "scenario",
                "response": result.get("recommendation", "Scenario analyzed."),
                "data": result,
            }

        elif intent == "replan":
            event = {"type": "user_request", "details": message}
            result = self.replan(event)
            return {
                "type": "replan",
                "response": result.get("reasoning", "Plan updated."),
                "data": result,
            }

        elif intent == "query":
            return self._handle_query(message)

        else:  # followup
            return self._handle_followup(message)

    @property
    def conversation(self) -> ConversationState:
        """Access the conversation state."""
        return self._conversation

    def reset(self) -> None:
        """Reset coordinator state."""
        self._conversation.clear()

    # --- Internal methods ---

    def _call_llm(
        self,
        system: str,
        messages: list[dict],
        schema: type[BaseModel] | None = None,
        temperature: float | None = None,
    ) -> str:
        """Make an API call to GPT-5.3 with retry on transient failures.

        Args:
            system: System prompt.
            messages: Conversation messages.
            schema: Optional Pydantic model for structured output (strict mode).
            temperature: Optional temperature override.
        """
        from backend.utils.resilience import with_retry

        @with_retry(max_attempts=2, min_wait=1, max_wait=5)
        def _do_call():
            openai_messages = [{"role": "system", "content": system}] + messages
            kwargs: dict = {
                "model": self._model,
                "max_tokens": 2048,
                "messages": openai_messages,
            }
            if temperature is not None:
                kwargs["temperature"] = temperature
            if schema is not None:
                kwargs["response_format"] = {
                    "type": "json_schema",
                    "json_schema": {
                        "name": schema.__name__,
                        "strict": True,
                        "schema": schema.model_json_schema(),
                    },
                }
            response = self._client.chat.completions.create(**kwargs)
            return response.choices[0].message.content.strip()

        try:
            return _do_call()
        except Exception as e:
            from ai.error_analysis import log_error, ErrorType
            input_text = messages[-1]["content"] if messages else ""
            log_error(ErrorType.API_ERROR, str(e), input_text)
            raise

    def _extract_json(self, response_text: str) -> dict:
        """
        Extract JSON from LLM response, handling <thinking> blocks.

        Strips chain-of-thought reasoning and parses the JSON object.
        """
        # Remove <thinking>...</thinking> blocks
        cleaned = re.sub(
            r"<thinking>.*?</thinking>",
            "",
            response_text,
            flags=re.DOTALL,
        ).strip()

        # Remove markdown code fences if present
        cleaned = re.sub(r"```json\s*", "", cleaned)
        cleaned = re.sub(r"```\s*$", "", cleaned)
        cleaned = cleaned.strip()

        # Try to parse JSON
        try:
            return json.loads(cleaned)
        except json.JSONDecodeError:
            # Try to find JSON object in the response
            match = re.search(r"\{.*\}", cleaned, re.DOTALL)
            if match:
                try:
                    return json.loads(match.group())
                except json.JSONDecodeError:
                    pass

            from ai.error_analysis import log_error, ErrorType
            log_error(
                ErrorType.JSON_PARSE_FAILURE,
                "Could not extract JSON from coordinator response",
                response_text[:200],
                response_text,
            )
            raise ValueError(f"Failed to parse coordinator response as JSON: {cleaned[:200]}")

    def _handle_query(self, message: str) -> dict:
        """Handle informational queries."""
        # Use conversation context for query responses
        context = self._conversation.get_context_summary()

        response = self._call_llm(
            system=(
                "You are the DroneMedic AI coordinator. Answer the user's question "
                "about the delivery system concisely. Use this context:\n" + context
            ),
            messages=[{"role": "user", "content": message}],
        )

        self._conversation.add_user_message(message)
        self._conversation.add_assistant_message(response)

        return {
            "type": "info",
            "response": response,
            "data": None,
        }

    def _handle_followup(self, message: str) -> dict:
        """Handle follow-up messages using conversation history."""
        messages = self._conversation.get_messages()
        messages.append({"role": "user", "content": message})

        response = self._call_llm(
            system=COORDINATOR_SYSTEM_PROMPT,
            messages=messages,
        )

        self._conversation.add_user_message(message)
        self._conversation.add_assistant_message(response)

        # Try to parse as JSON (might be a refined plan)
        try:
            data = self._extract_json(response)
            self._conversation.current_plan = data
            return {
                "type": "plan",
                "response": "Plan updated based on your feedback.",
                "data": data,
            }
        except (ValueError, json.JSONDecodeError):
            return {
                "type": "info",
                "response": response,
                "data": None,
            }


# --- Quick test ---
if __name__ == "__main__":
    print("=" * 60)
    print("  DroneMedic AI — Mission Coordinator Demo")
    print("=" * 60)
    print("\n  Note: Requires ANTHROPIC_API_KEY to be set.\n")

    coordinator = MissionCoordinator()

    # Demo 1: Parse request
    print("--- Parse Request ---")
    try:
        task = coordinator.parse_request(
            "Deliver insulin to Clinic A urgently and blood to Clinic B, avoid military area"
        )
        print(f"  Result: {json.dumps(task, indent=2)}")
    except Exception as e:
        print(f"  Error: {e}")

    # Demo 2: What-if scenario
    print("\n--- What-If Scenario ---")
    try:
        scenario = coordinator.analyze_scenario("What if a storm hits Clinic B?")
        print(f"  Result: {json.dumps(scenario, indent=2)}")
    except Exception as e:
        print(f"  Error: {e}")

    # Demo 3: Dynamic re-planning
    print("\n--- Dynamic Re-planning ---")
    try:
        result = coordinator.replan(
            event={"type": "new_delivery", "details": "Emergency blood to Clinic D"},
            remaining_stops=["Clinic B", "Depot"],
        )
        print(f"  Result: {json.dumps(result, indent=2)}")
    except Exception as e:
        print(f"  Error: {e}")
