"""DroneMedic — Streaming / WebSocket / SSE routes.

In addition to the existing ``/ws/live`` event fan-out, this module proxies
three upstream WebSocket streams from the simulation VM:

* ``/ws/px4``     — PX4 SITL telemetry (from ``simulation/telemetry_bridge.py``)
* ``/ws/pov``     — Drone camera JPEG feed (from ``ai/drone_vision_agent.py``)
* ``/ws/vision``  — Structured vision reasoning events (from the agent)

Each proxy endpoint opens one upstream WebSocket per client, relays frames
bi-directionally, and auto-reconnects on upstream drop. Upstream URLs are
configurable via environment variables so nothing hard-codes the VM IP.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os

from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse

from backend.api.dependencies import get_events

router = APIRouter(tags=["Streaming"])
logger = logging.getLogger("DroneMedic.Streaming")


# ── Existing event fan-out ────────────────────────────────────────────


@router.websocket("/ws/live")
async def websocket_live(
    websocket: WebSocket,
    event_service=Depends(get_events),
) -> None:
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
async def sse_stream(event_service=Depends(get_events)) -> StreamingResponse:
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
) -> list[dict]:
    return event_service.get_history(event_type=type, limit=limit)


# ── VM proxy endpoints ────────────────────────────────────────────────

PX4_BRIDGE_WS_URL = os.getenv("PX4_BRIDGE_WS_URL", "ws://localhost:8765")
POV_BRIDGE_WS_URL = os.getenv("POV_BRIDGE_WS_URL", "ws://localhost:8766")
VISION_BRIDGE_WS_URL = os.getenv("VISION_BRIDGE_WS_URL", "ws://localhost:8767")
LIDAR_BRIDGE_WS_URL = os.getenv("LIDAR_BRIDGE_WS_URL", "ws://localhost:8768")

_PROXY_RECONNECT_DELAY_SEC = 2.0
_PROXY_IDLE_TIMEOUT_SEC = 30.0


async def _proxy_bidirectional(
    client: WebSocket,
    upstream_url: str,
    label: str,
    *,
    on_upstream_down_payload: dict | None = None,
) -> None:
    """Pump frames between a downstream browser client and an upstream WS.

    On upstream failure, emit an error payload so the browser can surface a
    "reconnecting" state and we don't silently hang.
    """
    import websockets  # imported lazily so the module loads without the dep

    await client.accept()
    logger.info("[%s] client connected", label)

    async def forward_upstream_to_client(upstream) -> None:
        try:
            async for frame in upstream:
                if isinstance(frame, (bytes, bytearray)):
                    await client.send_bytes(bytes(frame))
                else:
                    await client.send_text(str(frame))
        except Exception as exc:
            logger.warning("[%s] upstream closed: %s", label, exc)

    async def forward_client_to_upstream(upstream) -> None:
        try:
            while True:
                msg = await client.receive()
                if msg["type"] == "websocket.disconnect":
                    return
                if "text" in msg and msg["text"] is not None:
                    await upstream.send(msg["text"])
                elif "bytes" in msg and msg["bytes"] is not None:
                    await upstream.send(msg["bytes"])
        except Exception as exc:
            logger.debug("[%s] client closed: %s", label, exc)

    try:
        while True:
            try:
                async with websockets.connect(
                    upstream_url,
                    open_timeout=5,
                    ping_interval=20,
                    ping_timeout=10,
                    max_size=4 * 1024 * 1024,
                ) as upstream:
                    logger.info("[%s] upstream connected: %s", label, upstream_url)
                    await client.send_json(
                        {"type": f"{label}_status", "connected": True, "url": upstream_url}
                    )
                    up_task = asyncio.create_task(forward_upstream_to_client(upstream))
                    down_task = asyncio.create_task(forward_client_to_upstream(upstream))
                    done, pending = await asyncio.wait(
                        {up_task, down_task}, return_when=asyncio.FIRST_COMPLETED
                    )
                    for task in pending:
                        task.cancel()
                    for task in done:
                        exc = task.exception()
                        if exc is not None:
                            raise exc
                    # Normal close — exit.
                    return
            except Exception as exc:
                logger.warning("[%s] upstream error: %s; retrying", label, exc)
                try:
                    payload = {
                        "type": f"{label}_status",
                        "connected": False,
                        "error": str(exc),
                    }
                    if on_upstream_down_payload:
                        payload.update(on_upstream_down_payload)
                    await client.send_json(payload)
                except Exception:
                    return  # client already gone
                await asyncio.sleep(_PROXY_RECONNECT_DELAY_SEC)
    except WebSocketDisconnect:
        logger.info("[%s] client disconnected", label)
    finally:
        try:
            await client.close()
        except Exception:
            pass


@router.websocket("/ws/px4")
async def websocket_px4(websocket: WebSocket) -> None:
    """Proxy upstream PX4 / mock telemetry to the browser."""
    await _proxy_bidirectional(websocket, PX4_BRIDGE_WS_URL, "px4")


@router.websocket("/ws/pov")
async def websocket_pov(websocket: WebSocket) -> None:
    """Proxy drone-camera JPEG frames to the browser."""
    await _proxy_bidirectional(websocket, POV_BRIDGE_WS_URL, "pov")


@router.websocket("/ws/vision")
async def websocket_vision(websocket: WebSocket) -> None:
    """Proxy structured vision reasoning events to the browser."""
    await _proxy_bidirectional(websocket, VISION_BRIDGE_WS_URL, "vision")


@router.websocket("/ws/lidar")
async def websocket_lidar(websocket: WebSocket) -> None:
    """Proxy upstream LiDAR point-cloud frames (from the VM gpu_lidar
    sensor bridge, see ``simulation/lidar_bridge.py``) to the browser.

    When the VM-side bridge is not running the proxy sends periodic
    ``lidar_status`` messages with ``connected: False`` so the frontend can
    cleanly fall back to the synthetic browser-side raycaster.
    """
    await _proxy_bidirectional(websocket, LIDAR_BRIDGE_WS_URL, "lidar")
