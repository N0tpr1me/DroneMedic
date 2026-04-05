"""Pydantic schemas for GPT structured outputs (strict mode)."""
from __future__ import annotations

from pydantic import BaseModel
from typing import Literal


class TaskConstraints(BaseModel):
    avoid_zones: list[str]
    weather_concern: str
    time_sensitive: bool


class ParsedDeliveryTask(BaseModel):
    locations: list[str]
    priorities: dict[str, str]
    supplies: dict[str, str]
    constraints: TaskConstraints


class RiskAssessment(BaseModel):
    score: int
    level: Literal["low", "medium", "high", "critical"]
    factors: list[str]
    recommendation: str
    contingency: str


class FlightDecisionOutput(BaseModel):
    action: Literal["continue", "conserve_speed", "skip_delivery", "reroute", "divert_emergency", "abort"]
    reasoning: str
    confidence: float
    speed_adjustment: float
    risk_assessment: Literal["low", "medium", "high", "critical"]


class WeatherBriefing(BaseModel):
    summary: str
    flyable: bool
    wind_advisory: str
    precipitation_advisory: str
    recommendation: str


class MissionReport(BaseModel):
    executive_summary: str
    metrics_summary: str
    incidents: list[str]
    recommendations: list[str]
    grade: Literal["A", "B", "C", "D", "F"]
