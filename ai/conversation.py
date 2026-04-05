"""
DroneMedic - AI Conversation State Management

Manages multi-turn conversation history and intent detection
for the LLM Mission Coordinator.
"""

from __future__ import annotations

import re


class ConversationState:
    """
    Tracks multi-turn conversation history for the mission coordinator.
    Maintains Anthropic API message format and current plan context.
    """

    def __init__(self, max_history: int = 20):
        self._messages: list[dict] = []
        self._max_history = max_history
        self._current_plan: dict | None = None

    def add_user_message(self, content: str) -> None:
        """Add a user message to the conversation history."""
        self._messages.append({"role": "user", "content": content})
        self._trim_history()

    def add_assistant_message(self, content: str) -> None:
        """Add an assistant message to the conversation history."""
        self._messages.append({"role": "assistant", "content": content})
        self._trim_history()

    def get_messages(self) -> list[dict]:
        """Get conversation history in Anthropic API format."""
        return list(self._messages)

    def get_context_summary(self) -> str:
        """Generate a brief summary of conversation context for system prompts."""
        if not self._messages:
            return "No prior conversation."

        parts = []
        if self._current_plan:
            locs = ", ".join(self._current_plan.get("locations", []))
            parts.append(f"Current plan delivers to: {locs}")

        msg_count = len(self._messages)
        parts.append(f"Conversation has {msg_count} messages so far.")

        # Summarize recent messages
        recent = self._messages[-4:]
        for msg in recent:
            role = msg["role"]
            text = msg["content"][:80] + "..." if len(msg["content"]) > 80 else msg["content"]
            parts.append(f"  [{role}]: {text}")

        return "\n".join(parts)

    def clear(self) -> None:
        """Clear all conversation history and plan."""
        self._messages.clear()
        self._current_plan = None

    @property
    def current_plan(self) -> dict | None:
        """Get the most recent delivery plan."""
        return self._current_plan

    @current_plan.setter
    def current_plan(self, plan: dict) -> None:
        """Set the current delivery plan."""
        self._current_plan = plan

    @property
    def has_history(self) -> bool:
        """Check if there is any conversation history."""
        return len(self._messages) > 0

    @property
    def message_count(self) -> int:
        return len(self._messages)

    def _trim_history(self) -> None:
        """Trim conversation history to max_history messages."""
        if len(self._messages) > self._max_history:
            # Keep the most recent messages
            self._messages = self._messages[-self._max_history:]


# --- Intent Detection Keywords ---
_DELIVERY_KEYWORDS = [
    "deliver", "send", "ship", "dispatch", "transport", "drop off",
    "bring", "supply", "distribute",
]
_WHAT_IF_KEYWORDS = [
    "what if", "what happens if", "hypothetically", "suppose",
    "imagine if", "scenario", "what about if",
]
_REPLAN_KEYWORDS = [
    "reroute", "re-route", "change", "update", "modify", "cancel",
    "add stop", "add delivery", "new stop", "redirect", "skip",
    "remove", "drop",
]
_QUERY_KEYWORDS = [
    "what is", "where is", "how does", "explain", "show me",
    "tell me about", "status", "current", "how many",
]


def detect_intent(message: str) -> str:
    """
    Classify a user message into an intent category using keyword heuristics.

    Returns one of:
        "delivery_request" | "what_if" | "replan" | "query" | "followup"
    """
    msg_lower = message.lower().strip()

    if not msg_lower:
        return "query"

    # Check what-if first (most specific)
    for kw in _WHAT_IF_KEYWORDS:
        if kw in msg_lower:
            return "what_if"

    # Check re-planning keywords
    for kw in _REPLAN_KEYWORDS:
        if kw in msg_lower:
            return "replan"

    # Check delivery request keywords
    for kw in _DELIVERY_KEYWORDS:
        if kw in msg_lower:
            return "delivery_request"

    # Check query keywords
    for kw in _QUERY_KEYWORDS:
        if kw in msg_lower:
            return "query"

    # Default to followup if none matched
    return "followup"


# --- Quick test ---
if __name__ == "__main__":
    # Test intent detection
    test_messages = [
        "Deliver insulin to Clinic A urgently",
        "What if it rains at Clinic B?",
        "Reroute to skip Clinic C",
        "What is the status of the delivery?",
        "Add Clinic D to the route",
        "Yes, proceed with that plan",
        "Send vaccines to Clinic A, avoid military area",
        "What happens if the airport zone is expanded?",
        "Change the priority of Clinic B to high",
    ]

    print("Intent Detection Demo:")
    print("-" * 60)
    for msg in test_messages:
        intent = detect_intent(msg)
        print(f"  [{intent:<20}] {msg}")

    # Test conversation state
    print("\nConversation State Demo:")
    print("-" * 60)
    state = ConversationState(max_history=5)
    state.add_user_message("Deliver insulin to Clinic A")
    state.add_assistant_message('{"locations": ["Clinic A"], ...}')
    state.current_plan = {"locations": ["Clinic A"]}
    print(f"  Messages: {state.message_count}")
    print(f"  Has history: {state.has_history}")
    print(f"  Current plan: {state.current_plan}")
    print(f"\n  Context summary:\n{state.get_context_summary()}")
