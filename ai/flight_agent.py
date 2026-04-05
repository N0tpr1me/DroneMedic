"""Autonomous flight decision agent — LLM-as-judge at each waypoint."""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, asdict
from typing import Literal

from ai.schemas import FlightDecisionOutput

logger = logging.getLogger("DroneMedic.FlightAgent")


@dataclass
class FlightContext:
    """Situation awareness for the agent."""
    drone_id: str
    battery_pct: float
    battery_state: str  # GREEN/AMBER/RED
    current_location: str
    next_waypoint: str
    remaining_waypoints: list[str]
    remaining_deliveries: int
    speed_ms: float
    altitude_m: float
    wind_speed_ms: float
    precipitation_mm: float
    temperature_c: float
    payload_type: str
    payload_priority: str  # P1_LIFE_CRITICAL / P2_URGENT / P3_ROUTINE
    mission_progress_pct: float
    reroute_count: int
    nearest_facility: str
    nearest_facility_distance_km: float
    nfz_nearby: bool
    # Environment awareness
    zone_type: str = "urban"  # urban / suburban / rural / disaster
    population_density: float = 0
    altitude_limit_m: float = 120
    active_threats: list = None  # type: ignore[assignment]
    nearby_hospitals: int = 0
    time_of_day: str = "day"
    visibility_m: float = 10000
    dynamic_nfz: list = None  # type: ignore[assignment]
    military_activity: bool = False
    patient_condition: str = ""
    clinical_deadline_min: float = 0
    lives_at_stake: int = 0

    def __post_init__(self) -> None:
        if self.active_threats is None:
            self.active_threats = []
        if self.dynamic_nfz is None:
            self.dynamic_nfz = []


@dataclass
class FlightDecision:
    """Structured decision output."""
    action: Literal["continue", "conserve_speed", "skip_delivery", "reroute", "divert_emergency", "abort"]
    reasoning: str
    confidence: float  # 0-1
    speed_adjustment: float  # multiplier (0.5 = half speed, 1.0 = normal)
    skip_deliveries: list[str]  # delivery IDs to skip
    divert_to: str | None  # facility name for emergency landing
    risk_assessment: Literal["low", "medium", "high", "critical"]


class FlightAgent:
    """LLM-powered flight decision agent with rule-based fallback."""

    SYSTEM_PROMPT = """You are an autonomous flight safety officer for DroneMedic, a medical drone delivery system.

DRONE SPECS:
- 6-rotor hexacopter, 8kg airframe, 800Wh battery
- Cruise speed: 15 m/s, max wind tolerance: 12 m/s
- Battery reserve: 20% minimum for safe return
- Payload capacity: 5kg max

PRIORITY LEVELS:
- P1_LIFE_CRITICAL: Blood products, epinephrine, antivenom — NEVER skip unless battery critical
- P2_URGENT: Insulin, antibiotics, surgical kits — skip only in RED battery state
- P3_ROUTINE: Bandages, vitamins — can be skipped to conserve battery

DECISION RULES:
1. CONTINUE: All systems nominal, proceed to next waypoint
2. CONSERVE_SPEED: Battery < 40% or wind > 8 m/s — reduce speed to 70%
3. SKIP_DELIVERY: Battery insufficient for all stops — drop lowest priority
4. REROUTE: Weather hazard ahead or NFZ detected — find alternative path
5. DIVERT_EMERGENCY: Battery < 15% or equipment failure — land at nearest facility
6. ABORT: Critical failure, no safe landing option — emergency landing immediately

DISASTER RESPONSE PROTOCOL:
- Military activity detected: IMMEDIATE ABORT — no exceptions
- Active disaster threats present: REROUTE around all threat zones; if not possible, DIVERT
- Zone type "disaster": raise altitude limit to 150m, prioritize P1 deliveries above all else
- Zone type "urban": enforce altitude limit of 50m for population safety
- Clinical deadline < 15 min with P1 payload: accept AMBER risk level (proceed through marginal conditions)
- Dynamic no-fly zones: treat identically to static NFZs, always reroute

ENVIRONMENT AWARENESS:
- Adapt altitude limits to zone_type (urban=50m, suburban=80m, rural=120m, disaster=150m)
- When visibility < 3000m: reduce speed to 60%, avoid reroutes into low-visibility areas
- Night operations (time_of_day="night"): reduce max speed to 70%, increase safety margins
- Multiple lives at stake (lives_at_stake > 0): elevate mission priority, accept higher risk

Always prioritize human life. A P1 delivery should proceed even in AMBER conditions.
Respond ONLY with valid JSON matching the FlightDecision schema."""

    def __init__(self, llm_call=None, llm_call_structured=None):
        self._llm_call = llm_call  # async callable(system, user) -> str
        self._llm_call_structured = llm_call_structured  # async callable(system, user, schema, temperature) -> str

    async def decide(self, context: FlightContext) -> FlightDecision:
        """Make a flight decision given current context."""
        # Try LLM first
        if self._llm_call:
            try:
                return await self._llm_decide(context)
            except Exception as e:
                logger.warning(f"LLM flight agent failed, using rules: {e}")

        # Fallback to rule-based
        return self._rule_based_decide(context)

    async def _llm_decide(self, ctx: FlightContext) -> FlightDecision:
        """Call LLM for decision using structured output."""
        user_prompt = f"""Current flight situation:
- Drone: {ctx.drone_id}, Battery: {ctx.battery_pct:.1f}% ({ctx.battery_state})
- Position: {ctx.current_location} → Next: {ctx.next_waypoint}
- Remaining stops: {ctx.remaining_deliveries} ({', '.join(ctx.remaining_waypoints)})
- Speed: {ctx.speed_ms:.1f} m/s, Altitude: {ctx.altitude_m:.0f}m
- Weather: Wind {ctx.wind_speed_ms:.1f} m/s, Precip {ctx.precipitation_mm:.1f} mm/h, Temp {ctx.temperature_c:.0f}°C
- Payload: {ctx.payload_type} (Priority: {ctx.payload_priority})
- Mission progress: {ctx.mission_progress_pct:.0f}%
- Reroutes so far: {ctx.reroute_count}
- Nearest facility: {ctx.nearest_facility} ({ctx.nearest_facility_distance_km:.1f} km)
- No-fly zone nearby: {ctx.nfz_nearby}
- Zone type: {ctx.zone_type}, Altitude limit: {ctx.altitude_limit_m}m
- Active threats: {len(ctx.active_threats)}, Dynamic NFZs: {len(ctx.dynamic_nfz)}
- Military activity: {ctx.military_activity}
- Visibility: {ctx.visibility_m}m, Time of day: {ctx.time_of_day}
- Patient condition: {ctx.patient_condition or 'N/A'}, Clinical deadline: {ctx.clinical_deadline_min} min
- Lives at stake: {ctx.lives_at_stake}

What is your decision?"""

        # Prefer structured output call if available
        if self._llm_call_structured:
            response = await self._llm_call_structured(
                self.SYSTEM_PROMPT,
                user_prompt,
                FlightDecisionOutput,
                0.0,
            )
        else:
            response = await self._llm_call(self.SYSTEM_PROMPT, user_prompt)

        # Parse JSON response (structured output guarantees valid JSON)
        data = json.loads(response)
        return FlightDecision(
            action=data.get("action", "continue"),
            reasoning=data.get("reasoning", ""),
            confidence=float(data.get("confidence", 0.5)),
            speed_adjustment=float(data.get("speed_adjustment", 1.0)),
            skip_deliveries=data.get("skip_deliveries", []),
            divert_to=data.get("divert_to"),
            risk_assessment=data.get("risk_assessment", "low"),
        )

    def _rule_based_decide(self, ctx: FlightContext) -> FlightDecision:
        """Deterministic rule-based fallback with disaster/environment awareness."""

        # ── Military activity: immediate abort, no exceptions ──
        if ctx.military_activity:
            return FlightDecision(
                action="abort",
                reasoning="Military activity detected in operating area. Immediate abort required per safety protocol.",
                confidence=1.0, speed_adjustment=0.0,
                skip_deliveries=[], divert_to=ctx.nearest_facility,
                risk_assessment="critical",
            )

        # ── Active disaster threats: reroute around all ──
        if ctx.active_threats:
            return FlightDecision(
                action="reroute",
                reasoning=f"{len(ctx.active_threats)} active disaster threat(s) detected. Rerouting around all threat zones.",
                confidence=0.95, speed_adjustment=0.8,
                skip_deliveries=[], divert_to=None,
                risk_assessment="high",
            )

        # ── Critical battery ──
        if ctx.battery_pct < 15:
            return FlightDecision(
                action="divert_emergency",
                reasoning=f"Battery critically low at {ctx.battery_pct:.1f}%. Diverting to {ctx.nearest_facility}.",
                confidence=1.0, speed_adjustment=0.7,
                skip_deliveries=[], divert_to=ctx.nearest_facility,
                risk_assessment="critical",
            )

        # ── Clinical deadline pressure: accept higher risk for P1 ──
        if (
            ctx.clinical_deadline_min > 0
            and ctx.clinical_deadline_min < 15
            and ctx.payload_priority == "P1_LIFE_CRITICAL"
            and ctx.battery_state in ("GREEN", "AMBER")
        ):
            speed_adj = 1.0  # maintain full speed for life-critical deadline
            return FlightDecision(
                action="continue",
                reasoning=(
                    f"Clinical deadline in {ctx.clinical_deadline_min:.0f} min with P1 payload. "
                    f"Accepting AMBER risk to meet life-critical deadline. "
                    f"Battery {ctx.battery_pct:.1f}% ({ctx.battery_state})."
                ),
                confidence=0.90, speed_adjustment=speed_adj,
                skip_deliveries=[], divert_to=None,
                risk_assessment="medium",
            )

        # ── High wind ──
        if ctx.wind_speed_ms > 10:
            return FlightDecision(
                action="reroute",
                reasoning=f"Wind speed {ctx.wind_speed_ms:.1f} m/s approaching max threshold (12 m/s). Seeking sheltered route.",
                confidence=0.85, speed_adjustment=0.7,
                skip_deliveries=[], divert_to=None,
                risk_assessment="high",
            )

        # ── Zone-type altitude enforcement ──
        zone_limits = {"urban": 50, "suburban": 80, "rural": 120, "disaster": 150}
        effective_alt_limit = zone_limits.get(ctx.zone_type, 120)
        alt_warning = ""
        if ctx.altitude_m > effective_alt_limit:
            alt_warning = f" Altitude {ctx.altitude_m:.0f}m exceeds {ctx.zone_type} limit ({effective_alt_limit}m) — descending."

        # ── Low battery — conserve ──
        if ctx.battery_pct < 40:
            skips = []
            if ctx.battery_pct < 25 and ctx.payload_priority == "P3_ROUTINE":
                skips = [ctx.next_waypoint]
            return FlightDecision(
                action="conserve_speed" if not skips else "skip_delivery",
                reasoning=(
                    f"Battery at {ctx.battery_pct:.1f}%. "
                    f"{'Skipping low-priority stop.' if skips else 'Reducing speed to conserve energy.'}"
                    f"{alt_warning}"
                ),
                confidence=0.9, speed_adjustment=0.7,
                skip_deliveries=skips, divert_to=None,
                risk_assessment="medium",
            )

        # ── NFZ nearby (static or dynamic) ──
        if ctx.nfz_nearby or ctx.dynamic_nfz:
            nfz_count = len(ctx.dynamic_nfz) if ctx.dynamic_nfz else 0
            return FlightDecision(
                action="reroute",
                reasoning=f"No-fly zone detected near flight path ({nfz_count} dynamic NFZ{'s' if nfz_count != 1 else ''}). Adjusting route.",
                confidence=0.95, speed_adjustment=1.0,
                skip_deliveries=[], divert_to=None,
                risk_assessment="medium",
            )

        # ── Low visibility ──
        if ctx.visibility_m < 3000:
            return FlightDecision(
                action="conserve_speed",
                reasoning=f"Low visibility ({ctx.visibility_m:.0f}m). Reducing speed for safety.{alt_warning}",
                confidence=0.85, speed_adjustment=0.6,
                skip_deliveries=[], divert_to=None,
                risk_assessment="medium",
            )

        # ── All nominal ──
        return FlightDecision(
            action="continue",
            reasoning=(
                f"All systems nominal. Battery {ctx.battery_pct:.1f}%, wind {ctx.wind_speed_ms:.1f} m/s. "
                f"Proceeding to {ctx.next_waypoint}.{alt_warning}"
            ),
            confidence=0.95, speed_adjustment=1.0,
            skip_deliveries=[], divert_to=None,
            risk_assessment="low",
        )
