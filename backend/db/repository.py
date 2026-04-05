"""DroneMedic — Repository functions for Supabase persistence.

Every function is async, uses the singleton client from supabase_client,
and fails gracefully (logs the error, returns None / empty list).
If Supabase is not configured the functions short-circuit immediately.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from backend.db.supabase_client import get_supabase

logger = logging.getLogger("DroneMedic.Repository")


# ── Helpers ───────────────────────────────────────────────────────────────

def _client():
    """Return the Supabase client or None."""
    return get_supabase()


def _serialize_datetime(value: Any) -> Any:
    """Convert datetime objects to ISO-8601 strings for JSON."""
    if isinstance(value, datetime):
        return value.isoformat()
    return value


def _prepare_row(data: dict) -> dict:
    """Deep-copy a dict with all datetimes serialised to ISO strings."""
    return {k: _serialize_datetime(v) for k, v in data.items()}


# ── Missions ──────────────────────────────────────────────────────────────

async def save_mission(mission: dict) -> dict | None:
    """Insert a new mission row."""
    sb = _client()
    if sb is None:
        return None
    try:
        row = _prepare_row(mission)
        result = sb.table("missions").insert(row).execute()
        return result.data[0] if result.data else None
    except Exception as exc:
        logger.error(f"save_mission failed: {exc}")
        return None


async def update_mission(mission_id: str, updates: dict) -> dict | None:
    """Patch an existing mission by id."""
    sb = _client()
    if sb is None:
        return None
    try:
        row = _prepare_row(updates)
        row["updated_at"] = datetime.now(timezone.utc).isoformat()
        result = sb.table("missions").update(row).eq("id", mission_id).execute()
        return result.data[0] if result.data else None
    except Exception as exc:
        logger.error(f"update_mission({mission_id}) failed: {exc}")
        return None


async def get_mission(mission_id: str) -> dict | None:
    """Fetch a single mission by id."""
    sb = _client()
    if sb is None:
        return None
    try:
        result = sb.table("missions").select("*").eq("id", mission_id).single().execute()
        return result.data
    except Exception as exc:
        logger.error(f"get_mission({mission_id}) failed: {exc}")
        return None


async def list_missions(
    user_id: str | None = None,
    status: str | None = None,
) -> list[dict]:
    """List missions, optionally filtered by user_id and/or status."""
    sb = _client()
    if sb is None:
        return []
    try:
        query = sb.table("missions").select("*")
        if user_id:
            query = query.eq("user_id", user_id)
        if status:
            query = query.eq("status", status)
        result = query.order("created_at", desc=True).execute()
        return result.data or []
    except Exception as exc:
        logger.error(f"list_missions failed: {exc}")
        return []


# ── Deliveries ────────────────────────────────────────────────────────────

async def save_deliveries(deliveries: list[dict]) -> list[dict]:
    """Batch-insert deliveries."""
    sb = _client()
    if sb is None:
        return []
    try:
        rows = [_prepare_row(d) for d in deliveries]
        result = sb.table("deliveries").insert(rows).execute()
        return result.data or []
    except Exception as exc:
        logger.error(f"save_deliveries failed: {exc}")
        return []


async def update_delivery(delivery_id: str, updates: dict) -> dict | None:
    """Patch an existing delivery by id."""
    sb = _client()
    if sb is None:
        return None
    try:
        row = _prepare_row(updates)
        row["updated_at"] = datetime.now(timezone.utc).isoformat()
        result = sb.table("deliveries").update(row).eq("id", delivery_id).execute()
        return result.data[0] if result.data else None
    except Exception as exc:
        logger.error(f"update_delivery({delivery_id}) failed: {exc}")
        return None


async def list_deliveries(mission_id: str | None = None) -> list[dict]:
    """List deliveries, optionally filtered by mission_id."""
    sb = _client()
    if sb is None:
        return []
    try:
        query = sb.table("deliveries").select("*")
        if mission_id:
            query = query.eq("mission_id", mission_id)
        result = query.order("created_at", desc=True).execute()
        return result.data or []
    except Exception as exc:
        logger.error(f"list_deliveries failed: {exc}")
        return []


# ── Drones ────────────────────────────────────────────────────────────────

async def update_drone(drone_id: str, updates: dict) -> dict | None:
    """Upsert drone state by id."""
    sb = _client()
    if sb is None:
        return None
    try:
        row = _prepare_row(updates)
        row["id"] = drone_id
        row["updated_at"] = datetime.now(timezone.utc).isoformat()
        result = (
            sb.table("drones")
            .upsert(row, on_conflict="id")
            .execute()
        )
        return result.data[0] if result.data else None
    except Exception as exc:
        logger.error(f"update_drone({drone_id}) failed: {exc}")
        return None


async def get_drones() -> list[dict]:
    """Fetch all drones."""
    sb = _client()
    if sb is None:
        return []
    try:
        result = sb.table("drones").select("*").execute()
        return result.data or []
    except Exception as exc:
        logger.error(f"get_drones failed: {exc}")
        return []


# ── Telemetry ─────────────────────────────────────────────────────────────

async def save_telemetry(snapshot: dict) -> None:
    """Insert a single telemetry row (fire-and-forget)."""
    sb = _client()
    if sb is None:
        return
    try:
        row = _prepare_row(snapshot)
        sb.table("telemetry").insert(row).execute()
    except Exception as exc:
        logger.error(f"save_telemetry failed: {exc}")


async def get_telemetry(drone_id: str, limit: int = 100) -> list[dict]:
    """Fetch recent telemetry for a drone, newest first."""
    sb = _client()
    if sb is None:
        return []
    try:
        result = (
            sb.table("telemetry")
            .select("*")
            .eq("drone_id", drone_id)
            .order("recorded_at", desc=True)
            .limit(limit)
            .execute()
        )
        return result.data or []
    except Exception as exc:
        logger.error(f"get_telemetry({drone_id}) failed: {exc}")
        return []


# ── Events ────────────────────────────────────────────────────────────────

async def save_event(event: dict) -> None:
    """Insert a single event row (fire-and-forget)."""
    sb = _client()
    if sb is None:
        return
    try:
        row = _prepare_row(event)
        sb.table("events").insert(row).execute()
    except Exception as exc:
        logger.error(f"save_event failed: {exc}")


async def list_events(
    mission_id: str | None = None,
    limit: int = 50,
) -> list[dict]:
    """List events, optionally filtered by mission_id (inside data->mission_id)."""
    sb = _client()
    if sb is None:
        return []
    try:
        query = sb.table("events").select("*")
        if mission_id:
            # events store mission_id inside the JSONB 'data' column
            query = query.eq("data->>mission_id", mission_id)
        result = query.order("created_at", desc=True).limit(limit).execute()
        return result.data or []
    except Exception as exc:
        logger.error(f"list_events failed: {exc}")
        return []


# ── Facilities ────────────────────────────────────────────────────────────

async def get_facilities() -> list[dict]:
    """Fetch all facilities."""
    sb = _client()
    if sb is None:
        return []
    try:
        result = sb.table("facilities").select("*").execute()
        return result.data or []
    except Exception as exc:
        logger.error(f"get_facilities failed: {exc}")
        return []
