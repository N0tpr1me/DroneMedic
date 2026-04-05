"""Responses API client — wraps OpenAI Responses API for built-in tools and better caching."""
from __future__ import annotations

import json
import logging
from openai import OpenAI
from config import OPENAI_API_KEY, OPENAI_BASE_URL

logger = logging.getLogger(__name__)


class ResponsesClient:
    """Wrapper around OpenAI Responses API with built-in tools."""

    def __init__(self) -> None:
        self._client: OpenAI | None = None
        if OPENAI_API_KEY:
            self._client = OpenAI(api_key=OPENAI_API_KEY, base_url=OPENAI_BASE_URL)

    def available(self) -> bool:
        return self._client is not None

    def query(
        self,
        instructions: str,
        user_input: str,
        tools: list[dict] | None = None,
        temperature: float | None = None,
        model: str = "azure/gpt-5.3-chat",
        store: bool = False,
    ) -> dict:
        """Send a query via Responses API with optional built-in tools.

        Falls back to Chat Completions if Responses API not available.
        """
        if not self._client:
            return {"text": "", "error": "API not configured"}

        # Try Responses API first
        try:
            kwargs: dict = {
                "model": model,
                "instructions": instructions,
                "input": user_input,
            }
            if tools:
                kwargs["tools"] = tools
            if temperature is not None:
                kwargs["temperature"] = temperature
            if store:
                kwargs["store"] = True

            response = self._client.responses.create(**kwargs)

            # Extract text from response output items
            text_parts: list[str] = []
            tool_outputs: list[dict] = []
            for item in response.output:
                if hasattr(item, "text"):
                    text_parts.append(item.text)
                elif hasattr(item, "type") and item.type == "tool_use":
                    tool_outputs.append({"tool": item.name, "result": item.content})

            return {
                "text": "\n".join(text_parts) if text_parts else "",
                "tool_outputs": tool_outputs,
                "model": model,
                "api": "responses",
            }
        except Exception as e:
            logger.info(
                "Responses API not available (%s), falling back to Chat Completions",
                e,
            )
            return self._fallback_chat(instructions, user_input, temperature, model)

    def _fallback_chat(
        self,
        instructions: str,
        user_input: str,
        temperature: float | None,
        model: str,
    ) -> dict:
        """Fallback to Chat Completions API."""
        try:
            kwargs: dict = {
                "model": model,
                "max_tokens": 2048,
                "messages": [
                    {"role": "system", "content": instructions},
                    {"role": "user", "content": user_input},
                ],
            }
            if temperature is not None:
                kwargs["temperature"] = temperature

            response = self._client.chat.completions.create(**kwargs)
            return {
                "text": response.choices[0].message.content or "",
                "tool_outputs": [],
                "model": model,
                "api": "chat_completions_fallback",
            }
        except Exception as e:
            return {"text": "", "error": str(e)}

    def query_with_web_search(
        self, instructions: str, user_input: str
    ) -> dict:
        """Query with built-in web search enabled."""
        return self.query(
            instructions=instructions,
            user_input=user_input,
            tools=[{"type": "web_search"}],
        )

    def query_with_code_interpreter(
        self, instructions: str, user_input: str
    ) -> dict:
        """Query with built-in code interpreter."""
        return self.query(
            instructions=instructions,
            user_input=user_input,
            tools=[{"type": "code_interpreter", "container": {"type": "auto"}}],
        )

    def query_with_file_search(
        self,
        instructions: str,
        user_input: str,
        vector_store_ids: list[str],
    ) -> dict:
        """Query with built-in file search (RAG)."""
        return self.query(
            instructions=instructions,
            user_input=user_input,
            tools=[{"type": "file_search", "vector_store_ids": vector_store_ids}],
        )

    def query_with_mcp(
        self,
        instructions: str,
        user_input: str,
        mcp_server_url: str,
    ) -> dict:
        """Query with remote MCP server."""
        return self.query(
            instructions=instructions,
            user_input=user_input,
            tools=[
                {
                    "type": "mcp",
                    "server_url": mcp_server_url,
                    "require_approval": "never",
                }
            ],
        )
