"""Server-Sent Events endpoints for streaming AI reasoning and anomaly alerts."""

from __future__ import annotations

import asyncio
import json
import logging
from typing import AsyncGenerator

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from openai import OpenAI

from config import OPENAI_API_KEY, OPENAI_BASE_URL

router = APIRouter()
logger = logging.getLogger("DroneMedic.ReasoningStream")

# ---------------------------------------------------------------------------
# Shared anomaly queue (populated by anomaly_detector or other services)
# ---------------------------------------------------------------------------

_anomaly_queue: asyncio.Queue[dict] = asyncio.Queue()


def push_anomaly(anomaly: dict) -> None:
    """Push an anomaly dict onto the broadcast queue (non-async helper)."""
    try:
        _anomaly_queue.put_nowait(anomaly)
    except asyncio.QueueFull:
        logger.warning("Anomaly queue full — dropping oldest entry")


REASONING_SYSTEM_PROMPT = (
    "You are a DroneMedic AI copilot. The operator has issued a command. "
    "Think step-by-step about what fleet action to take, considering weather, "
    "battery levels, no-fly zones, and payload priority. Explain your reasoning "
    "clearly as you go."
)

# ---------------------------------------------------------------------------
# SSE helpers
# ---------------------------------------------------------------------------


def _sse_event(data: dict) -> str:
    """Format a dict as an SSE data line."""
    return f"data: {json.dumps(data)}\n\n"


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/api/reasoning-stream")
async def reasoning_stream(command: str) -> StreamingResponse:
    """Stream AI reasoning tokens as SSE events.

    Event types:
        - ``reasoning``   — incremental reasoning text
        - ``action_start`` — the model has begun a tool/function call
        - ``done``        — stream complete
        - ``error``       — an error occurred
    """
    if not command.strip():
        raise HTTPException(status_code=422, detail="Command cannot be empty")

    async def _generate() -> AsyncGenerator[str, None]:
        try:
            client = OpenAI(api_key=OPENAI_API_KEY, base_url=OPENAI_BASE_URL)
            stream = client.chat.completions.create(
                model="azure/gpt-5.3-chat",
                max_tokens=1024,
                stream=True,
                messages=[
                    {"role": "system", "content": REASONING_SYSTEM_PROMPT},
                    {"role": "user", "content": command},
                ],
            )

            for chunk in stream:
                choice = chunk.choices[0] if chunk.choices else None
                if choice is None:
                    continue

                delta = choice.delta

                # Reasoning / content tokens
                if delta and delta.content:
                    yield _sse_event({"type": "reasoning", "content": delta.content})

                # Tool-call start (if the model decides on an action)
                if delta and delta.tool_calls:
                    for tc in delta.tool_calls:
                        if tc.function and tc.function.name:
                            yield _sse_event({
                                "type": "action_start",
                                "tool": tc.function.name,
                                "arguments": tc.function.arguments or "",
                            })

                # Stream finished
                if choice.finish_reason:
                    yield _sse_event({"type": "done", "finish_reason": choice.finish_reason})

        except Exception as exc:
            logger.exception("Reasoning stream failed")
            yield _sse_event({"type": "error", "message": str(exc)})

    return StreamingResponse(
        _generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/api/anomaly-stream")
async def anomaly_stream() -> StreamingResponse:
    """Stream anomaly alerts as SSE events.

    Other backend services push anomalies via ``push_anomaly()``.
    The client receives them as they arrive. A heartbeat is sent every
    15 seconds to keep the connection alive.
    """

    async def _generate() -> AsyncGenerator[str, None]:
        while True:
            try:
                anomaly = await asyncio.wait_for(_anomaly_queue.get(), timeout=15.0)
                yield _sse_event({"type": "anomaly", **anomaly})
            except asyncio.TimeoutError:
                # Heartbeat to keep the connection alive
                yield _sse_event({"type": "heartbeat"})

    return StreamingResponse(
        _generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
