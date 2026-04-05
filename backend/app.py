"""DroneMedic — FastAPI application factory.

Single entry point: uvicorn backend.app:app --port 8000
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import DRONE_NAMES
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
from backend.api.dependencies import init_services

# Route modules
from backend.api.routes.deliveries import router as deliveries_router
from backend.api.routes.missions import router as missions_router
from backend.api.routes.drones import router as drones_router
from backend.api.routes.weather import router as weather_router
from backend.api.routes.geofence import router as geofence_router
from backend.api.routes.simulation import router as simulation_router
from backend.api.routes.metrics import router as metrics_router
from backend.api.routes.facilities import router as facilities_router
from backend.api.routes.streaming import router as streaming_router
from backend.api.legacy_routes import router as legacy_router

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("DroneMedic.App")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Build the service dependency graph on startup."""
    logger.info("DroneMedic backend starting...")

    # Build dependency graph
    event_service = EventService()
    drone_service = DroneService(DRONE_NAMES, event_service)
    telemetry_service = TelemetryService(drone_service, event_service)
    simulator_adapter = SimulatorAdapter(DRONE_NAMES, telemetry_service)
    route_service = RouteService()
    mission_service = MissionService(
        drone_service, simulator_adapter, event_service, route_service,
    )
    scheduler_service = SchedulerService(
        mission_service, drone_service, route_service, event_service,
    )
    metrics_service = MetricsService(mission_service, simulator_adapter)
    scenario_service = ScenarioService(event_service, mission_service, simulator_adapter)
    ai_adapter = AIAdapter()

    # Break circular dependency: mission needs scheduler for reassignment
    mission_service.set_scheduler(scheduler_service)

    # Store singletons for dependency injection
    init_services(
        event_service=event_service,
        drone_service=drone_service,
        telemetry_service=telemetry_service,
        simulator_adapter=simulator_adapter,
        mission_service=mission_service,
        scheduler_service=scheduler_service,
        route_service=route_service,
        metrics_service=metrics_service,
        scenario_service=scenario_service,
        ai_adapter=ai_adapter,
    )

    logger.info(f"DroneMedic backend ready — {len(DRONE_NAMES)} drones initialized")
    yield
    logger.info("DroneMedic backend shutting down")


# ── App ────────────────────────────────────────────────────────────────

app = FastAPI(
    title="DroneMedic API",
    version="2.0.0",
    description="AI-powered medical drone delivery backend",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# New structured routes
app.include_router(deliveries_router)
app.include_router(missions_router)
app.include_router(drones_router)
app.include_router(weather_router)
app.include_router(geofence_router)
app.include_router(simulation_router)
app.include_router(metrics_router)
app.include_router(facilities_router)
app.include_router(streaming_router)

# Legacy routes for frontend backward compatibility
app.include_router(legacy_router)
