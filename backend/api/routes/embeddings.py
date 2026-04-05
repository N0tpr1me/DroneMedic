"""DroneMedic — Embeddings and semantic search routes."""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(tags=["Embeddings"])


# ── Request models ────────────────────────────────────────────────────

class EmbedRequest(BaseModel):
    text: str


class SearchRequest(BaseModel):
    query: str
    limit: int = 10


# ── Singleton ─────────────────────────────────────────────────────────

_svc = None


def _get_svc():
    global _svc
    if _svc is None:
        from ai.embeddings_service import EmbeddingsService
        _svc = EmbeddingsService()
    return _svc


# ── Routes ────────────────────────────────────────────────────────────

@router.post("/api/embed")
async def generate_embedding(req: EmbedRequest) -> dict:
    """Generate a text embedding vector."""
    svc = _get_svc()
    vec = svc.embed(req.text)
    return {
        "embedding": vec[:5] if vec else None,
        "dimensions": len(vec) if vec else 0,
        "model": "text-embedding-3-small",
    }


@router.post("/api/search/semantic")
async def semantic_search(req: SearchRequest) -> dict:
    """Semantic search over events using pgvector similarity."""
    svc = _get_svc()
    vec = svc.embed(req.query)
    if not vec:
        return {"results": [], "error": "Embeddings unavailable"}

    # Query Supabase pgvector
    try:
        from backend.db.supabase_client import get_supabase

        sb = get_supabase()
        if sb:
            result = sb.rpc(
                "search_events_semantic",
                {
                    "query_embedding": vec,
                    "match_threshold": 0.7,
                    "match_count": req.limit,
                },
            ).execute()
            return {"results": result.data or [], "query": req.query}
    except Exception:
        pass

    return {"results": [], "query": req.query, "note": "Supabase unavailable — demo mode"}
