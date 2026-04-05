"""Simple notification utility — logs events that would be emailed in production."""

from __future__ import annotations

import logging
from datetime import datetime, timezone

logger = logging.getLogger("DroneMedic.Notifications")


async def notify_mission_event(
    event_type: str, mission_id: str, details: dict
) -> dict:
    """Log a notification event. In production, this would send email/SMS."""
    logger.info(
        "[NOTIFICATION] %s — Mission %s: %s", event_type, mission_id, details
    )
    # In production: call Supabase Edge Function notify-operator
    # For now: structured log that could be picked up by a log aggregator
    return {
        "sent": True,
        "channel": "log",  # would be "email" or "sms" in production
        "event_type": event_type,
        "mission_id": mission_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
