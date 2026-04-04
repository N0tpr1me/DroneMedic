"""DroneMedic — Isolated scenario/demo mode.

Injects events manually — NOT wired into core mission flow.
All events published with source=EventSource.scenario.
"""

from __future__ import annotations

from config import BATTERY_MIN_RESERVE
from backend.domain.enums import EventSource, EventType
from backend.domain.errors import MissionNotFoundError
from backend.services.event_service import EventService
from backend.services.mission_service import MissionService
from backend.adapters.simulator_adapter import SimulatorAdapter
from backend.weather_service import simulate_weather_event


class ScenarioService:

    def __init__(
        self,
        event_service: EventService,
        mission_service: MissionService,
        simulator_adapter: SimulatorAdapter,
    ) -> None:
        self._events = event_service
        self._missions = mission_service
        self._adapter = simulator_adapter

    def run_scenario(self, scenario_name: str, mission_id: str) -> dict:
        """
        Run a predefined test scenario against an active mission.

        Available:
        - weather_disruption: inject storm at first delivery stop
        - low_battery: force battery to near-reserve level
        - multi_event: high_wind + storm at two stops
        """
        mission = self._missions.get_mission(mission_id)
        result = {"scenario": scenario_name, "events": []}

        if scenario_name == "weather_disruption":
            targets = [loc for loc in mission.planned_route if loc != "Depot"]
            if targets:
                target = targets[0]
                simulate_weather_event("storm", [target])
                result["events"].append(f"Storm injected at {target}")
                self._events.publish(EventType.weather_alert, {
                    "mission_id": mission_id,
                    "event_type": "storm",
                    "locations": [target],
                }, source=EventSource.scenario)

        elif scenario_name == "low_battery":
            ctrl = self._adapter._controllers.get(mission.drone_id)
            if ctrl:
                ctrl.battery = BATTERY_MIN_RESERVE + 1
                self._adapter._push_telemetry(mission.drone_id)
                result["events"].append(
                    f"Battery forced to {ctrl.battery:.1f}% on {mission.drone_id}"
                )
                self._events.publish(EventType.drone_battery_low, {
                    "drone_id": mission.drone_id,
                    "battery": ctrl.battery,
                }, source=EventSource.scenario)

        elif scenario_name == "multi_event":
            targets = [loc for loc in mission.planned_route if loc != "Depot"]
            if len(targets) >= 1:
                simulate_weather_event("high_wind", [targets[0]])
                result["events"].append(f"High wind at {targets[0]}")
                self._events.publish(EventType.weather_alert, {
                    "event_type": "high_wind",
                    "locations": [targets[0]],
                }, source=EventSource.scenario)
            if len(targets) >= 2:
                simulate_weather_event("storm", [targets[1]])
                result["events"].append(f"Storm at {targets[1]}")
                self._events.publish(EventType.weather_alert, {
                    "event_type": "storm",
                    "locations": [targets[1]],
                }, source=EventSource.scenario)

        else:
            raise ValueError(f"Unknown scenario: {scenario_name}")

        self._events.publish(EventType.scenario_triggered, {
            "scenario": scenario_name,
            "mission_id": mission_id,
            "events": result["events"],
        }, source=EventSource.scenario)

        return result
