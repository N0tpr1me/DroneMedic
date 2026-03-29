"""
DroneMedic - FastAPI Backend

Single-file REST API exposing the scheduler, drone state, weather,
geofence, metrics, and simulation endpoints.

Run with:
    uvicorn backend.api:app --reload
"""

from __future__ import annotations

import asyncio
import logging

from fastapi import BackgroundTasks, FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from config import LOCATIONS, NO_FLY_ZONES
from backend.models import (
    CreateBatchRequest,
    MissionStatus,
    RerouteRequest,
    ScenarioRequest,
    WeatherEventRequest,
)
from backend.scheduler import Scheduler
from backend.geofence import (
    get_no_fly_zones,
    add_no_fly_zone,
    remove_no_fly_zone,
)
from backend.weather_service import (
    get_all_location_weather,
    simulate_weather_event,
    clear_weather_overrides,
)
from backend.facilities import (
    load_facilities,
    register_facilities_as_locations,
    search_facilities,
    get_facility_by_name,
)

logging.basicConfig(level=logging.INFO, format="%(message)s")

# ── App Setup ──────────────────────────────────────────────────────────

app = FastAPI(title="DroneMedic API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

scheduler = Scheduler()


# ── Deliveries ─────────────────────────────────────────────────────────

@app.post("/api/deliveries")
def create_delivery_batch(req: CreateBatchRequest):
    """Create a batch of deliveries, assign to drones, compute routes."""
    try:
        deliveries, missions = scheduler.schedule_batch(req.deliveries)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return {
        "deliveries": [d.model_dump() for d in deliveries],
        "missions": [m.model_dump() for m in missions],
    }


@app.get("/api/deliveries")
def list_deliveries(status: str | None = Query(None)):
    """List all deliveries, optionally filtered by status."""
    deliveries = list(scheduler.deliveries.values())
    if status:
        deliveries = [d for d in deliveries if d.status.value == status]
    return [d.model_dump() for d in deliveries]


# ── Missions ───────────────────────────────────────────────────────────

@app.get("/api/missions")
def list_missions():
    """List all missions."""
    return [m.model_dump() for m in scheduler.missions.values()]


@app.get("/api/missions/{mission_id}")
def get_mission(mission_id: str):
    """Get mission detail including route, deliveries, and status."""
    mission = scheduler.missions.get(mission_id)
    if not mission:
        raise HTTPException(status_code=404, detail="Mission not found")

    mission_deliveries = [
        scheduler.deliveries[d_id].model_dump()
        for d_id in mission.delivery_ids
        if d_id in scheduler.deliveries
    ]

    return {
        "mission": mission.model_dump(),
        "deliveries": mission_deliveries,
    }


@app.post("/api/missions/{mission_id}/start")
async def start_mission(mission_id: str, background_tasks: BackgroundTasks):
    """Start a single planned mission. Drone flight runs in the background."""
    mission = scheduler.missions.get(mission_id)
    if not mission:
        raise HTTPException(status_code=404, detail="Mission not found")

    if mission.status.value != "planning":
        raise HTTPException(status_code=400, detail=f"Mission is {mission.status.value}, expected planning")

    # Store the event loop for thread-safe broadcasting (async context has the loop)
    scheduler._loop = asyncio.get_running_loop()

    # Run mission in background thread (DroneController uses time.sleep)
    background_tasks.add_task(asyncio.to_thread, scheduler.start_mission, mission_id)

    return {"status": "started", "mission_id": mission_id}


@app.post("/api/missions/start-all")
async def start_all_missions(background_tasks: BackgroundTasks):
    """
    Start ALL planned missions concurrently.
    Each drone flies its route in a separate thread — true parallel execution.
    """
    planned = [
        m.id for m in scheduler.missions.values()
        if m.status == MissionStatus.PLANNING
    ]
    if not planned:
        raise HTTPException(status_code=400, detail="No planned missions to start")

    # Store the event loop for thread-safe broadcasting (async context has the loop)
    scheduler._loop = asyncio.get_running_loop()

    # Launch all missions in parallel threads
    background_tasks.add_task(scheduler.start_missions_concurrent, planned)

    return {"status": "started", "mission_ids": planned, "concurrent": True}


@app.post("/api/missions/{mission_id}/pause")
def pause_mission(mission_id: str):
    """Pause an active mission — drone hovers in place."""
    try:
        mission = scheduler.pause_mission(mission_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return mission.model_dump()


@app.post("/api/missions/{mission_id}/resume")
def resume_mission(mission_id: str):
    """Resume a paused mission from current hover position."""
    try:
        mission = scheduler.resume_mission(mission_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return mission.model_dump()


@app.post("/api/missions/{mission_id}/reroute")
def reroute_mission(mission_id: str, req: RerouteRequest):
    """Trigger mid-flight reroute, optionally adding new deliveries."""
    try:
        mission = scheduler.handle_reroute(
            mission_id=mission_id,
            reason=req.reason,
            new_items=req.new_deliveries,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return mission.model_dump()


# ── Drones ─────────────────────────────────────────────────────────────

@app.get("/api/drones")
def list_drones():
    """List all drones with current state (synced from controllers)."""
    scheduler.sync_all_drones()
    return [state.model_dump() for state in scheduler.drones.values()]


# ── Weather ────────────────────────────────────────────────────────────

@app.get("/api/weather")
def get_weather():
    """Get weather conditions for all locations."""
    return get_all_location_weather()


# ── Geofence ───────────────────────────────────────────────────────────

@app.get("/api/geofence/zones")
def list_geofence_zones():
    """List all active no-fly zones."""
    return get_no_fly_zones()


@app.post("/api/geofence/zones")
def create_geofence_zone(zone: dict):
    """
    Add or update a no-fly zone at runtime.

    Body must include:
    - name: str
    - polygon: list of [x, y] pairs (AirSim coords)
    - lat_lon: list of [lat, lon] pairs (map coords)
    """
    if "name" not in zone or "polygon" not in zone:
        raise HTTPException(status_code=400, detail="Zone must have 'name' and 'polygon'")
    # Convert lists to tuples for geometry functions
    zone["polygon"] = [tuple(p) for p in zone["polygon"]]
    if "lat_lon" in zone:
        zone["lat_lon"] = [tuple(p) for p in zone["lat_lon"]]
    add_no_fly_zone(zone)
    return {"status": "added", "name": zone["name"]}


@app.delete("/api/geofence/zones/{zone_name}")
def delete_geofence_zone(zone_name: str):
    """Remove a no-fly zone by name."""
    removed = remove_no_fly_zone(zone_name)
    if not removed:
        raise HTTPException(status_code=404, detail=f"Zone '{zone_name}' not found")
    return {"status": "removed", "name": zone_name}


# ── Simulation ─────────────────────────────────────────────────────────

@app.post("/api/simulate/weather")
def trigger_weather_event(req: WeatherEventRequest):
    """Trigger a simulated weather event at specified locations."""
    result = simulate_weather_event(req.event_type, req.locations)
    return {"status": "simulated", "event": result}


@app.post("/api/simulate/obstacle")
def trigger_obstacle():
    """Trigger a simulated obstacle event (logs it for demo)."""
    scheduler._log_event("obstacle_reported", {
        "description": "Simulated obstacle detected",
    })
    return {"status": "obstacle_reported"}


@app.post("/api/simulate/scenario")
def run_scenario(req: ScenarioRequest):
    """Run a predefined test scenario against an active mission."""
    try:
        result = scheduler.run_scenario(req.scenario_name, req.mission_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return result


# ── Metrics ────────────────────────────────────────────────────────────

@app.get("/api/metrics/{mission_id}")
def get_metrics(mission_id: str):
    """Get performance metrics for a mission."""
    try:
        return scheduler.get_mission_metrics(mission_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


# ── Reference Data ─────────────────────────────────────────────────────

@app.get("/api/locations")
def list_locations():
    """List all known locations with coordinates."""
    return LOCATIONS


# ── Facilities ─────────────────────────────────────────────────────────

@app.get("/api/facilities")
def list_facilities(
    query: str = Query("", description="Search by facility name"),
    region: str = Query("", description="Filter by region"),
    limit: int = Query(50, ge=1, le=500),
):
    """Search hospitals/clinics from the facilities database."""
    return search_facilities(query=query, region=region, limit=limit)


@app.get("/api/facilities/{name}")
def get_facility(name: str):
    """Get a single facility by exact name."""
    facility = get_facility_by_name(name)
    if not facility:
        raise HTTPException(status_code=404, detail=f"Facility '{name}' not found")
    return facility


@app.post("/api/facilities/register")
def register_facilities(
    max_facilities: int | None = Query(None, description="Max facilities to register"),
    region: str | None = Query(None, description="Only register facilities in this region"),
):
    """
    Register facilities from the database as delivery locations.
    Once registered, they can be used as delivery destinations in the route planner.
    """
    count = register_facilities_as_locations(
        max_facilities=max_facilities,
        region=region,
    )
    return {
        "status": "registered",
        "facilities_added": count,
        "total_locations": len(LOCATIONS),
    }


# ── Events ─────────────────────────────────────────────────────────────

@app.get("/api/events")
def get_events(
    type: str | None = Query(None),
    limit: int = Query(100, ge=1, le=1000),
):
    """Get event log, optionally filtered by type."""
    return scheduler.get_events(event_type=type, limit=limit)


# ── Real-Time Streaming ───────────────────────────────────────────────

@app.websocket("/ws/live")
async def websocket_live(websocket: WebSocket):
    """
    WebSocket endpoint for real-time drone position updates.

    Clients connect and receive JSON messages for every drone movement:
    - drone_position_updated: position, battery, status, location
    - Includes takeoff, en_route, arrived, paused, resumed, landed events

    Example client (JavaScript):
        const ws = new WebSocket("ws://localhost:8000/ws/live");
        ws.onmessage = (e) => { console.log(JSON.parse(e.data)); };
    """
    await websocket.accept()

    # Store event loop for thread-safe broadcasting from mission threads
    scheduler._loop = asyncio.get_event_loop()

    # Subscribe to scheduler events
    queue = scheduler.subscribe()

    try:
        while True:
            # Wait for next event from scheduler
            event = await queue.get()
            await websocket.send_json(event)
    except WebSocketDisconnect:
        pass
    finally:
        scheduler.unsubscribe(queue)


@app.get("/api/stream")
async def sse_stream():
    """
    Server-Sent Events (SSE) endpoint for real-time drone tracking.

    Alternative to WebSocket for clients that prefer SSE (e.g. EventSource API).

    Example client (JavaScript):
        const source = new EventSource("http://localhost:8000/api/stream");
        source.onmessage = (e) => { console.log(JSON.parse(e.data)); };
    """
    import json

    # Store event loop for thread-safe broadcasting
    scheduler._loop = asyncio.get_event_loop()

    queue = scheduler.subscribe()

    async def event_generator():
        try:
            while True:
                event = await queue.get()
                yield f"data: {json.dumps(event)}\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            scheduler.unsubscribe(queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
