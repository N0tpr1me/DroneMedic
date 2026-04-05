"""DroneMedic — Singleton Supabase client for backend persistence.

Uses the service-role key to bypass RLS for server-side operations.
Returns None when credentials are not configured, allowing the app
to run without Supabase (all persistence is skipped silently).
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from config import SUPABASE_URL, SUPABASE_SERVICE_KEY

if TYPE_CHECKING:
    from supabase import Client

logger = logging.getLogger("DroneMedic.SupabaseClient")

_client: Client | None = None
_initialised: bool = False


def get_supabase() -> Client | None:
    """Return the singleton Supabase client, or None if not configured."""
    global _client, _initialised

    if _initialised:
        return _client

    _initialised = True

    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        logger.info(
            "Supabase not configured (SUPABASE_URL / SUPABASE_SERVICE_KEY missing). "
            "Database persistence is disabled."
        )
        return None

    try:
        from supabase import create_client

        _client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
        logger.info("Supabase client initialised (service-role).")
    except Exception as exc:
        logger.error(f"Failed to initialise Supabase client: {exc}")
        _client = None

    return _client
