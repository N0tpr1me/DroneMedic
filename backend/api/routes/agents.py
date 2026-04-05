"""Agent orchestration routes — multi-agent query and status endpoints."""
from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(tags=["agents"])


class AgentRequest(BaseModel):
    message: str
    context: dict | None = None


@router.post("/api/agents/query")
async def agent_query(req: AgentRequest) -> dict:
    """Route query through multi-agent orchestrator."""
    from ai.agent_orchestrator import AgentOrchestrator

    orchestrator = AgentOrchestrator()
    result = await orchestrator.process(req.message, req.context)
    return result


@router.get("/api/agents/status")
async def agent_status() -> dict:
    """Get status of all specialized agents."""
    from ai.agent_orchestrator import AgentOrchestrator

    orchestrator = AgentOrchestrator()
    return orchestrator.get_agent_status()
