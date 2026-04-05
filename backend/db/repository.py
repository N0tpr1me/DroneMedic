"""DroneMedic — Supabase persistence (optional, fire-and-forget)."""

from __future__ import annotations

import logging

from config import SUPABASE_URL, SUPABASE_KEY

logger = logging.getLogger("DroneMedic.DB")

_client = None


def _get_client():
    global _client
    if _client is not None:
        return _client
    if not SUPABASE_URL or not SUPABASE_KEY:
        return None
    try:
        from supabase import create_client
        _client = create_client(SUPABASE_URL, SUPABASE_KEY)
        return _client
    except Exception as e:
        logger.warning(f"Supabase init failed: {e}")
        return None


async def save_mission(data: dict) -> None:
    client = _get_client()
    if not client:
        return
    try:
        client.table("missions").upsert(data).execute()
    except Exception as e:
        logger.debug(f"save_mission failed: {e}")


async def update_mission(mission_id: str, updates: dict) -> None:
    client = _get_client()
    if not client:
        return
    try:
        client.table("missions").update(updates).eq("id", mission_id).execute()
    except Exception as e:
        logger.debug(f"update_mission failed: {e}")


async def save_deliveries(deliveries: list[dict]) -> None:
    client = _get_client()
    if not client:
        return
    try:
        client.table("deliveries").upsert(deliveries).execute()
    except Exception as e:
        logger.debug(f"save_deliveries failed: {e}")


async def update_delivery(delivery_id: str, updates: dict) -> None:
    client = _get_client()
    if not client:
        return
    try:
        client.table("deliveries").update(updates).eq("id", delivery_id).execute()
    except Exception as e:
        logger.debug(f"update_delivery failed: {e}")


async def update_drone(drone_id: str, updates: dict) -> None:
    client = _get_client()
    if not client:
        return
    try:
        client.table("drones").update(updates).eq("id", drone_id).execute()
    except Exception as e:
        logger.debug(f"update_drone failed: {e}")


async def save_event(event: dict) -> None:
    client = _get_client()
    if not client:
        return
    try:
        client.table("events").insert(event).execute()
    except Exception as e:
        logger.debug(f"save_event failed: {e}")
