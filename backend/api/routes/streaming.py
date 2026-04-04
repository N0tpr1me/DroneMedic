"""DroneMedic — Streaming / WebSocket / SSE routes."""

from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse

from backend.api.dependencies import get_events

router = APIRouter(tags=["Streaming"])


@router.websocket("/ws/live")
async def websocket_live(
    websocket: WebSocket,
    event_service=Depends(get_events),
):
    await websocket.accept()
    event_service.set_loop(asyncio.get_event_loop())
    queue = event_service.subscribe()
    try:
        while True:
            event = await queue.get()
            await websocket.send_json(event)
    except WebSocketDisconnect:
        event_service.unsubscribe(queue)


@router.get("/api/stream")
async def sse_stream(event_service=Depends(get_events)):
    event_service.set_loop(asyncio.get_event_loop())
    queue = event_service.subscribe()

    async def event_generator():
        try:
            while True:
                event = await queue.get()
                yield f"data: {json.dumps(event)}\n\n"
        except asyncio.CancelledError:
            event_service.unsubscribe(queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
    )


@router.get("/api/events")
def get_events_history(
    type: str | None = Query(None),
    limit: int = Query(100),
    event_service=Depends(get_events),
):
    return event_service.get_history(event_type=type, limit=limit)
