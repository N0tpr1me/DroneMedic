"""DroneMedic — FastAPI dependency injection.

All services are singletons created in app.py lifespan and stored here.
Route handlers use Depends() to access them.
"""

from __future__ import annotations

from backend.services.event_service import EventService
from backend.services.drone_service import DroneService
from backend.services.telemetry_service import TelemetryService
from backend.services.mission_service import MissionService
from backend.services.scheduler_service import SchedulerService
from backend.services.route_service import RouteService
from backend.services.metrics_service import MetricsService
from backend.services.scenario_service import ScenarioService
from backend.adapters.simulator_adapter import SimulatorAdapter
from backend.adapters.ai_adapter import AIAdapter

# Populated by app.py lifespan
_event_service: EventService | None = None
_drone_service: DroneService | None = None
_telemetry_service: TelemetryService | None = None
_simulator_adapter: SimulatorAdapter | None = None
_mission_service: MissionService | None = None
_scheduler_service: SchedulerService | None = None
_route_service: RouteService | None = None
_metrics_service: MetricsService | None = None
_scenario_service: ScenarioService | None = None
_ai_adapter: AIAdapter | None = None


def init_services(
    event_service: EventService,
    drone_service: DroneService,
    telemetry_service: TelemetryService,
    simulator_adapter: SimulatorAdapter,
    mission_service: MissionService,
    scheduler_service: SchedulerService,
    route_service: RouteService,
    metrics_service: MetricsService,
    scenario_service: ScenarioService,
    ai_adapter: AIAdapter,
) -> None:
    """Store service singletons for dependency injection."""
    global _event_service, _drone_service, _telemetry_service
    global _simulator_adapter, _mission_service, _scheduler_service
    global _route_service, _metrics_service, _scenario_service, _ai_adapter
    _event_service = event_service
    _drone_service = drone_service
    _telemetry_service = telemetry_service
    _simulator_adapter = simulator_adapter
    _mission_service = mission_service
    _scheduler_service = scheduler_service
    _route_service = route_service
    _metrics_service = metrics_service
    _scenario_service = scenario_service
    _ai_adapter = ai_adapter


# FastAPI Depends() functions
def get_events() -> EventService: return _event_service  # type: ignore
def get_drones() -> DroneService: return _drone_service  # type: ignore
def get_telemetry() -> TelemetryService: return _telemetry_service  # type: ignore
def get_adapter() -> SimulatorAdapter: return _simulator_adapter  # type: ignore
def get_missions() -> MissionService: return _mission_service  # type: ignore
def get_scheduler() -> SchedulerService: return _scheduler_service  # type: ignore
def get_routes() -> RouteService: return _route_service  # type: ignore
def get_metrics() -> MetricsService: return _metrics_service  # type: ignore
def get_scenarios() -> ScenarioService: return _scenario_service  # type: ignore
def get_ai() -> AIAdapter: return _ai_adapter  # type: ignore
