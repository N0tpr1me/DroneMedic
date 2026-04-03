# DroneMedic: Complete Simulator + Wow-Factor Implementation Plan

## Context

DroneMedic is a multi-agent UAV medical delivery system for the AR26 HackXelerator (judges from NVIDIA, Meta, PyTorch). We're replacing deprecated AirSim with PX4 SITL + Gazebo Harmonic + MAVLinkMCP (all installed). Adding Google Maps API, RL optimization, predictive demand, voice control, CV obstacle detection, and stunning 3D visualization. Zain builds everything with Claude. 8 days remaining.

### Drone Specification
- **Type**: Quadcopter (Matternet M2-style) — VTOL, hover for delivery
- **Frame**: PX4 X500 with attached payload box (colored medical container via SDF)
- **Range**: ~20km round trip
- **Max payload**: 5kg medical supplies
- **Cruise speed**: 15 m/s (~54 km/h)
- **Max altitude**: 120m (UK air law compliant)
- **Delivery method**: Hover at 10m, lower package on tether / actuator release
- **3D model**: Default X500 + red medical payload box attached underneath via Gazebo SDF joint

---

## Phase 1: PX4 Core + Google Maps (Day 1)

**Goal**: Drone flies OR-Tools route in Gazebo. Google Maps geocoding works.

### 1.1 Build PX4 SITL
```bash
cd ~/PX4-Autopilot && bash Tools/setup/macos.sh && make px4_sitl gz_x500
```

### 1.2 PX4 Adapter
**New**: `simulation/px4_adapter.py`
- `PX4Adapter` class wrapping MAVSDK async calls
- Methods: `connect()`, `arm_and_takeoff(alt)`, `goto_gps(lat,lon,alt,speed)`, `hold()`, `land()`, `get_position()`, `get_battery()`, `get_flight_mode()`, `start_telemetry_stream()`, `release_payload()` (actuator trigger for Zipline-style drop)
- Background asyncio event loop in thread for sync compat
- Sequential `goto_location()` for mid-flight re-routing support
- Ref: `simulation/MAVLinkMCP/src/server/mavlinkmcp.py` for MAVSDK patterns

### 1.3 DroneController PX4 Mode
**Modify**: `simulation/drone_control.py`
- Add `DroneMode` enum: MOCK, AIRSIM, PX4
- Add `mode` param (backward-compat with `use_airsim`)
- PX4 branch in: `connect()`, `takeoff()`, `move_to()`, `get_position()`, `land()`, `get_battery()`, `pause()`, `resume()`
- `move_to(location_name)` resolves lat/lon from LOCATIONS → `px4_adapter.goto_gps()`
- Auto-fallback: if PX4 connection fails → switch to mock with warning
- If PX4 disconnects mid-flight → trigger RTL failsafe → log failure → mock for remaining

### 1.4 Google Maps Backend
**New**: `backend/google_maps.py`
```python
class GoogleMapsService:
    geocode(address) -> {lat, lon, formatted_address}
    reverse_geocode(lat, lon) -> str
    elevation(lat, lon) -> float
    elevation_along_path(points, samples) -> list[float]
    find_hospitals(lat, lon, radius_m) -> list[dict]  # Places API
    distance_matrix(origins, destinations) -> dict     # Routes API
```
- Uses `googlemaps` Python library with existing `GOOGLE_MAPS_API_KEY`

### 1.5 Config + CLI + Env
**Modify**: `config.py` — add `PX4_ENABLED`, `PX4_CONNECTION`, `PX4_ALTITUDE_M`, `PX4_HOME_LAT/LON`, `GOOGLE_MAPS_API_KEY` import
**Modify**: `main.py` — add `--px4` flag
**Modify**: `.env` / `.env.example` — add PX4 vars
**New**: `scripts/launch_px4.sh` — sets PX4_HOME_LAT/LON, runs `make px4_sitl gz_x500`

### 1.6 Install deps
```bash
source simulation/px4-env/bin/activate && pip install googlemaps
```

**Verify**: Terminal 1: `scripts/launch_px4.sh` → Terminal 2: `PYTHONPATH=. PX4_ENABLED=true python3 main.py --px4 --skip-ai` → drone flies in Gazebo

---

## Phase 2: Dynamic Re-Routing + Real Data (Day 2)

**Goal**: Weather re-routing, real no-fly zones, terrain-aware altitude, time windows in VRP.

### 2.1 Haversine + Time Windows
**Modify**: `backend/route_planner.py`
- Add `_haversine_distance(loc1, loc2)` for GPS distances
- Add time window constraints to OR-Tools: urgent = 10-min window, normal = relaxed
- Add `use_gps=True` param (default False for backward compat)
- Reuse: existing `compute_route()` / `recompute_route()` signatures unchanged

### 2.2 Real No-Fly Zone Data
**New**: `backend/nofly_data.py`
- Download FAA P-56 restricted zones (GeoJSON from data.gov)
- Download Netherlands PDOK drone zones via API
- `load_nofly_zones(country="UK") -> list[dict]` merges hardcoded + real data
- Reuse: `backend/geofence.py` `is_in_no_fly_zone()` unchanged

### 2.3 Terrain-Aware Altitude
- Before each leg: `google_maps.elevation_along_path(start, end, samples=20)`
- Min flight altitude = max(terrain_height) + 50m safety margin
- If terrain too high for battery → flag unsafe → re-route

### 2.4 Dynamic TFRs (Temporary Flight Restrictions)
**Modify**: `backend/geofence.py`
- Add `active_tfrs: list[dict]` — no-fly zones that appear mid-flight
- `add_tfr(polygon, reason, expiry)` and `remove_tfr(id)`
- Triggers re-route when drone's planned path intersects new TFR
- Demo: simulate disaster area TFR appearing mid-mission

### 2.5 Pre-flight Checklist
**New**: `backend/preflight.py`
```python
class PreflightChecklist:
    check_battery(drone) -> (bool, str)      # Above 80%?
    check_gps_lock(drone) -> (bool, str)     # Satellite count > 6?
    check_weather(destination) -> (bool, str) # Wind < 15m/s, no storm?
    check_airspace(route) -> (bool, str)      # No active TFRs?
    check_payload(weight_kg) -> (bool, str)   # Under max?
    check_comms(drone) -> (bool, str)         # Link quality?
    run_all(drone, route, payload) -> PreflightReport
```
- Block launch if any CRITICAL check fails
- Inspired by: Zipline, Wing, Matternet pre-flight procedures

**Verify**: `python3 main.py --px4 --demo-weather` → drone pauses, re-routes, continues

---

## Phase 3: Vision-Based Obstacle Detection (Day 3)

**Goal**: YOLOv8 on Gazebo camera feed detects obstacles, triggers evasive re-routing.

### 3.1 YOLOv8 Detector
**New**: `simulation/cv_obstacle_detector.py`
```python
class CVObstacleDetector:
    __init__(model_path="yolov8n.pt", confidence=0.5)
    detect(image_frame) -> list[Detection]
    is_obstacle_ahead(detections, threshold) -> bool
    get_evasion_vector(detections) -> {direction, magnitude}
```
- YOLOv8 nano (CPU, fast inference)
- Subscribe to Gazebo camera topic
- On detection → pause → log bounding box → recompute_route with penalty → resume

### 3.2 TensorRT/ONNX Benchmark (NVIDIA wow)
- Export YOLOv8 to ONNX: `model.export(format="onnx")`
- Benchmark: PyTorch vs ONNX vs TensorRT inference times
- Display in dashboard: "TensorRT: 0.8ms vs PyTorch: 12ms (15x speedup)"
- Architecture slide: Jetson Orin Nano onboard for edge inference

### 3.3 Gazebo World with Obstacles + Drone Model
**New**: `simulation/gazebo/dronemedic_world.sdf`
- Hospital markers (green cylinders), disaster sites (red), depot (blue)
- Obstacle objects (trees, buildings) for CV testing
- Terrain variation for elevation testing

**Modify**: X500 drone SDF model — attach payload box:
- Red box (0.2×0.15×0.1m) with medical cross texture underneath drone
- Fixed joint to drone base_link
- Detachable via `set_actuator()` for delivery drop simulation
- Box falls with gravity when joint is released (Gazebo physics)

### 3.4 Install CV deps
```bash
source simulation/px4-env/bin/activate && pip install ultralytics opencv-python-headless
```

**Verify**: Place obstacle in Gazebo → YOLOv8 detects → drone evades

---

## Phase 4: Air Laws + Payload + Audit Trail (Day 4)

**Goal**: Multi-country compliance, payload weight effects, chain of custody.

### 4.1 Multi-Country Air Laws
**New**: `backend/airlaw.py`
```python
@dataclass(frozen=True)
class AirLawProfile:
    country: str
    max_altitude_m: float        # UK:120, US:122, Germany:100
    max_range_km: float
    requires_vlos: bool
    max_weight_kg: float
    restricted_hours: tuple|None
    no_fly_buffer_m: float
    requires_registration: bool
    requires_remote_id: bool

COUNTRY_PROFILES = {"UK","US","UAE","Germany","Netherlands","India",...}
detect_country_from_coords(lat, lon) -> str  # reverse geocode
validate_mission_compliance(route, country, altitude, payload_kg, time_utc) -> list[str]
```

### 4.2 Payload Weight Modeling
**Modify**: `config.py` + `simulation/drone_control.py`
```python
DRONE_EMPTY_WEIGHT_KG = 2.5
DRONE_MAX_PAYLOAD_KG = 5.0
BATTERY_DRAIN_RATE_BASE = 0.08
BATTERY_DRAIN_RATE_PER_KG = 0.015
SUPPLY_WEIGHTS = {"blood_pack":0.5, "vaccine_kit":0.3, "defibrillator":2.0, "first_aid":1.0, "medication":0.2}
```
- `DroneController.load_payload(supplies)` → calculates total weight
- Battery drain adjusted by payload weight
- Speed reduced for heavy payloads

### 4.3 Chain of Custody + Cold Chain
**New**: `backend/audit.py`
```python
@dataclass
class DeliveryRecord:
    delivery_id: str (UUID)
    drone_id, origin, destination, supplies: list[str]
    payload_kg: float
    requested_at, departed_at, arrived_at: datetime
    status: "pending"|"in_transit"|"delivered"|"failed"|"returned"
    temperature_log: list[{timestamp, temp_c}]  # cold chain
    tamper_status: bool
    route_taken: list[{lat, lon, timestamp}]
    re_routes: int
    compliance_check: list[str]

class AuditLog:
    record_departure/arrival/reroute/failure()
    get_delivery(id) -> DeliveryRecord
    export_csv() -> compliance report
```
- Temperature simulation: 2-8°C for vaccines, drift based on ambient + insulation
- Tamper detection flag
- Inspired by: Matternet chain of custody

### 4.4 LLM Hallucination Safeguards
**Modify**: `ai/task_parser.py` + `ai/coordinator.py`
- Pydantic model validation on LLM JSON output
- Verify locations exist or can be geocoded
- Verify no impossible constraints
- If validation fails → re-prompt once with error → reject if still fails

### 4.5 Comms-Loss Return-to-Base
**Modify**: `simulation/px4_adapter.py`
- Configure PX4 failsafe: `COM_DL_LOSS_T=10` (10s timeout)
- On comms loss → PX4 auto-RTL (Return To Launch)
- Log event in audit trail

**Verify**: Fly with 5kg payload → battery drains faster. Invalid LLM input → rejected.

---

## Phase 5: Multi-Drone + Deconfliction + Priority Queue (Day 5)

**Goal**: 2+ drones flying simultaneously, no collisions, emergency preemption.

### 5.1 Multi-Drone PX4 SITL
```bash
# Terminal 1: Drone 1
PX4_HOME_LAT=51.5074 PX4_HOME_LON=-0.1278 make px4_sitl gz_x500
# Terminal 2: Drone 2
PX4_SYS_AUTOSTART=4001 PX4_GZ_MODEL_POSE="2,0" PX4_INSTANCE=1 make px4_sitl gz_x500
```
- `PX4Adapter` accepts instance ID, connects port `14540 + (instance * 10)`
- `FleetController` creates multiple PX4Adapter instances

### 5.2 Airspace Deconfliction
**New**: `backend/deconfliction.py`
```python
class AirspaceManager:
    register_drone(drone_id, pos)
    update_position(drone_id, lat, lon, alt)
    check_conflict(drone_id, target) -> list[conflicting_ids]
    resolve_conflict(drone_id, conflict_id) -> {action: "hold"|"altitude_change"|"reroute"}
```
- Vertical separation: drones at different altitudes (30m, 60m, 90m)
- Temporal separation: if paths cross, delay one drone
- Check before each `move_to()`

### 5.3 Priority Queue + Emergency Preemption
**New**: `backend/scheduler.py`
```python
class DeliveryScheduler:
    submit(delivery: DeliveryRequest) -> delivery_id
    preempt(delivery_id, new_delivery) -> bool
    get_queue() -> list[DeliveryRequest]
    get_active() -> dict[drone_id, DeliveryRequest]
```
- Priority: CRITICAL > HIGH > NORMAL > LOW
- CRITICAL delivery preempts lowest-priority active drone
- Paused drone resumes original mission after CRITICAL completes

**Verify**: 2 drones fly without collision. Submit CRITICAL → preempts lower priority.

---

## Phase 6: RL Optimizer + Predictive Demand (Day 6)

**Goal**: PyTorch RL vs OR-Tools comparison. Prophet demand prediction with heatmap.

### 6.1 RL Route Optimizer (PyTorch — impresses PyTorch judges)
**New**: `ai/rl_route_planner.py`
```python
from rl4co.envs import CVRPEnv
from rl4co.models import AttentionModel
from rl4co.utils import RL4COTrainer

class RLRoutePlanner:
    __init__(model_path=None)
    train(num_locations=20, epochs=5)  # ~15 min on CPU
    compute_route(locations, priorities, battery_capacity) -> same dict format as route_planner
```
- Uses rl4co `CVRPEnv` + `AttentionModel` (transformer-based)
- Same output format as `backend/route_planner.py` for drop-in comparison
- Show side-by-side: OR-Tools route (red) vs RL route (blue) on map
- Key metric: at 50+ nodes, RL inference is milliseconds vs OR-Tools seconds

**New**: `scripts/train_rl_model.py` — standalone training script
**New**: `scripts/compare_solvers.py` — OR-Tools vs RL benchmark

```bash
source simulation/px4-env/bin/activate && pip install rl4co torch lightning tensordict
```

### 6.2 Predictive Demand (Meta Prophet — impresses Meta judges)
**New**: `ai/demand_predictor.py`
```python
from prophet import Prophet

class DemandPredictor:
    train(historical_data: pd.DataFrame)  # one model per location
    predict(hours_ahead=48) -> dict[location_id, predictions]
    get_heatmap_data() -> list[{lat, lon, weight}]
```

**New**: `scripts/generate_synthetic_data.py`
- 365 days × 5 locations × 24 hours of emergency data
- Encoded patterns: cardiac AM peak, trauma night peak, respiratory cold weather, event surges
- ~40K-60K rows

**New**: `backend/preposition.py`
```python
def compute_prepositions(predictions, num_drones, locations) -> list[DronePosition]
def calculate_response_improvement(emergencies, base_pos, prepositioned, speed) -> dict
```
- Pre-position idle drones at predicted high-demand locations
- Impact metric: "37% faster than reactive dispatch"

```bash
pip install prophet
```

### 6.3 TorchRL Environment (open-source contribution narrative)
**New**: `ai/torchrl_env.py`
- `MedicalDroneEnv(EnvBase)` with state: drone_pos, battery, visited, demands, weather, no_fly_mask
- Action: next location index (discrete)
- Reward: delivery_speed × priority - battery_cost - risk
- Frame as: "We plan to submit this as a TorchRL community environment"

**Verify**: `python scripts/compare_solvers.py` shows RL vs OR-Tools comparison chart.

---

## Phase 7: Voice Control + Explainable AI + 3D Visualization (Day 7)

**Goal**: Voice commands control fleet. AI explains decisions. Stunning deck.gl map.

### 7.1 Voice-Controlled Fleet (biggest demo moment)
**New**: `web/src/hooks/useVoiceInput.ts`
- Web Speech API hook: continuous listening, speech-to-text
- Browser-native, zero dependencies

**New**: `web/src/components/dashboard/VoiceCommandBar.tsx`
- Mic button with pulsing animation when listening
- Text fallback input
- Interim transcript display

**New**: `backend/voice_command.py` (FastAPI endpoint)
```python
@router.post("/api/voice-command")
async def handle_voice_command(req: VoiceCommandRequest):
    # OpenAI function calling with fleet tools:
    # redirect_drone, get_delivery_eta, get_fleet_status, pause_drone, emergency_recall
    # Returns: {action, parameters, explanation, reasoning}
```

### 7.2 Explainable AI Decision Panel
**New**: `web/src/components/dashboard/DecisionPanel.tsx`
- When re-routing: shows WHY with visual gauges
- Severity-colored cards: battery (red), weather (yellow), priority (blue)
- Progress bars: metric_value vs threshold
- Route comparison: old_route → new_route

**Modify**: `backend/route_planner.py`
- Add `build_reroute_reasons(drone_state, weather, destination) -> list[DecisionReason]`
- Each reason: factor, description, metric_value, threshold, severity, impact

### 7.3 Real-Time AI Reasoning Stream
**New**: `backend/reasoning_stream.py`
- FastAPI SSE endpoint: `/api/reasoning-stream`
- Streams OpenAI chain-of-thought as it re-plans routes
- Frontend: `useReasoningStream()` hook + `ReasoningLog` component
- Shows tool calls in real-time: "Executing: redirect_drone..."

### 7.4 Anomaly Detection Toasts
**New**: `backend/anomaly_detector.py`
```python
class TelemetryBaseline:
    check_battery_drain(drone_id, distance, battery_start, battery_now) -> Anomaly|None
    check_speed(drone_id, actual_speed) -> Anomaly|None
```
- Compare expected vs actual telemetry
- SSE stream: `/api/anomaly-stream`
- Frontend: sonner toasts with severity levels

**New**: `web/src/components/dashboard/AnomalyToastProvider.tsx`

### 7.5 deck.gl 3D Animated Flight Paths (visual wow)
```bash
cd web && npm install @deck.gl/react @deck.gl/core @deck.gl/layers @deck.gl/geo-layers @deck.gl/google-maps @vis.gl/react-google-maps
```

**Rewrite**: `web/src/components/dashboard/MapView.tsx`
- Replace Leaflet with deck.gl + Google Maps
- `TripsLayer` — glowing comet-tail animated drone trails
- `ScatterplotLayer` — facility markers (hospitals green, disaster red, depot blue)
- `PolygonLayer` — no-fly zones (red semi-transparent)
- `ArcLayer` — origin-destination arcs
- 45° tilted dark satellite view
- Multiple simultaneous drone trails with different colors

### 7.6 Demand Heatmap
**New**: `web/src/components/dashboard/DemandHeatmap.tsx`
- deck.gl `HeatmapLayer` showing predicted demand
- Color gradient: blue (low) → red (high)
- Toggle: "Show predicted demand next 2 hours"

**Verify**: Voice command "redirect drone 2 to hospital" → drone moves on map with glowing trail

---

## Phase 8: Evaluation Metrics + Polish + Demo (Day 8)

**Goal**: All 5 metrics, QGroundControl, demo video, final polish.

### 8.1 Evaluation Metrics
**Modify**: `backend/metrics.py`
```python
class MissionMetrics:
    delivery_time_reduction(optimized, naive) -> float %
    throughput(completed, hours) -> deliveries/hour
    rerouting_success_rate(disruptions, successful) -> float %
    robustness(obstacles, avoidances) -> float %
    coverage_lives_saved(distances, response_time) -> {km, est_lives}
```
- Log per mission to `data/metrics_log.json`
- Dashboard chart: bar chart comparing metrics

### 8.2 Supply Inventory Panel
**New**: `web/src/components/dashboard/SupplyPanel.tsx`
- What supplies on each drone, payload weight, remaining capacity
- Temperature monitoring display for cold-chain items
- Chain of custody timeline view

### 8.3 ETA Display
- Show estimated arrival time per active delivery
- ETA = remaining_distance / drone_speed, updated from telemetry
- Info bubble on drone marker on map

### 8.4 Address Autocomplete
**Modify**: `web/src/components/dashboard/DeliveryInput.tsx`
- Google Places Autocomplete for origin + destination
- "Find nearby hospitals" button
- Any address worldwide → geocode → fly there

### 8.5 QGroundControl
```bash
brew install --cask qgroundcontrol
```
- Auto-connects to PX4 SITL on UDP:14550
- Shows raw flight data alongside custom dashboard

### 8.6 Triple Split-Screen Demo Layout
- Panel 1: Gazebo 3D simulation (drone flying)
- Panel 2: deck.gl map with animated trails + heatmap
- Panel 3: AI reasoning log + decision panel + anomaly toasts
- All three react simultaneously to events

**Verify**: Full end-to-end demo runs smoothly. Metrics display. All features integrated.

---

## Phase 9: Demo Prep (Separate — when ready)

**Goal**: Record polished 1-3 min demo video.

### 9.1 Demo Scenarios
1. **Happy path**: Voice "deliver insulin to London Bridge Hospital" → AI parses → route optimized → drone flies in Gazebo with payload box → delivered with chain of custody log
2. **Weather disruption**: Mid-flight storm → AI reasoning streams "Re-routing: wind 18m/s exceeds 15m/s limit" → drone re-routes → decision panel shows factors → successful
3. **Multi-drone emergency**: 2 drones active → CRITICAL blood delivery arrives → preempts lower priority → CV detects obstacle → evades → RL vs OR-Tools comparison shown

### 9.2 Triple Split-Screen Recording
- Panel 1: Gazebo 3D simulation (X500 + payload box flying)
- Panel 2: deck.gl map with animated trails + demand heatmap
- Panel 3: AI reasoning log + decision panel + anomaly toasts

### 9.3 Pre-tested Demo Commands
- Prepare 3-4 delivery requests that produce visually impressive results
- Pre-warm all services (PX4, FastAPI, React, Gazebo)
- Never improvise in front of judges — rehearse exact flow

---

## Critical Files Summary

| File | Action | Phase |
|------|--------|-------|
| `simulation/px4_adapter.py` | Create | 1 |
| `simulation/drone_control.py` | Modify | 1,4,5 |
| `simulation/cv_obstacle_detector.py` | Create | 3 |
| `simulation/gazebo/dronemedic_world.sdf` | Create | 3 |
| `backend/google_maps.py` | Create | 1 |
| `backend/route_planner.py` | Modify | 2,7 |
| `backend/nofly_data.py` | Create | 2 |
| `backend/preflight.py` | Create | 2 |
| `backend/airlaw.py` | Create | 4 |
| `backend/audit.py` | Create | 4 |
| `backend/deconfliction.py` | Create | 5 |
| `backend/scheduler.py` | Create | 5 |
| `backend/preposition.py` | Create | 6 |
| `backend/metrics.py` | Modify | 8 |
| `backend/anomaly_detector.py` | Create | 7 |
| `backend/voice_command.py` | Create | 7 |
| `backend/reasoning_stream.py` | Create | 7 |
| `ai/rl_route_planner.py` | Create | 6 |
| `ai/demand_predictor.py` | Create | 6 |
| `ai/torchrl_env.py` | Create | 6 |
| `ai/task_parser.py` | Modify | 4 |
| `ai/coordinator.py` | Modify | 4 |
| `config.py` | Modify | 1,4 |
| `main.py` | Modify | 1,4 |
| `api/server.py` | Modify | 7,8 |
| `.mcp.json` | Modify | 1 |
| `.env` / `.env.example` | Modify | 1 |
| `scripts/launch_px4.sh` | Create | 1 |
| `scripts/train_rl_model.py` | Create | 6 |
| `scripts/compare_solvers.py` | Create | 6 |
| `scripts/generate_synthetic_data.py` | Create | 6 |
| `web/src/components/dashboard/MapView.tsx` | Rewrite | 7 |
| `web/src/components/dashboard/DeliveryInput.tsx` | Modify | 8 |
| `web/src/components/dashboard/DecisionPanel.tsx` | Create | 7 |
| `web/src/components/dashboard/VoiceCommandBar.tsx` | Create | 7 |
| `web/src/components/dashboard/DemandHeatmap.tsx` | Create | 7 |
| `web/src/components/dashboard/SupplyPanel.tsx` | Create | 8 |
| `web/src/components/dashboard/AnomalyToastProvider.tsx` | Create | 7 |
| `web/src/hooks/useVoiceInput.ts` | Create | 7 |
| `web/src/hooks/useReasoningStream.ts` | Create | 7 |

## Reuse Existing Code

- `simulation/MAVLinkMCP/src/server/mavlinkmcp.py` → MAVSDK patterns for px4_adapter
- `simulation/drone_control.py` → extend, don't replace
- `simulation/obstacle_detector.py` → trigger pattern for CV integration
- `backend/route_planner.py` → compute_route/recompute_route unchanged, add haversine + time windows
- `backend/geofence.py` → is_in_no_fly_zone() reused with real zone data + TFRs
- `backend/weather_service.py` → reuse for pre-flight checks
- `ai/coordinator.py` → MissionCoordinator reused for detour reasoning
- `config.py` → LOCATIONS already has lat/lon
- `web/src/components/ui/ai-prompt-box.tsx` → extend for voice input

## Python Dependencies (simulation/px4-env)
```
googlemaps, ultralytics, opencv-python-headless, rl4co, torch, lightning,
tensordict, torchrl, prophet, pandas, numpy, sonner (npm)
```

## npm Dependencies (web/)
```
@deck.gl/react, @deck.gl/core, @deck.gl/layers, @deck.gl/geo-layers,
@deck.gl/google-maps, @vis.gl/react-google-maps, sonner
```

## Verification (per phase)

1. Drone flies route in Gazebo via PX4
2. Weather re-route works, pre-flight checklist blocks bad conditions
3. YOLOv8 detects Gazebo obstacle → drone evades
4. Payload weight affects battery. Invalid LLM input rejected. Audit log generated.
5. 2 drones fly without collision. CRITICAL preempts lower priority.
6. RL vs OR-Tools comparison chart. Prophet heatmap shows demand. Pre-positioning reduces response time.
7. Voice "redirect drone 2" → drone moves on deck.gl map with glowing trail. AI reasoning streams live. Anomaly toasts fire.
8. Full demo runs. Metrics display. Video recorded. QGC shows flight data.

## Pitch Keywords
- **"Digital twin"** + **"Physical AI"** → NVIDIA
- **"TorchRL environment"** + **"ExecuTorch edge"** → PyTorch Foundation
- **"Agentic pipeline"** → AR26 judging language
- **"Sim-to-real transfer"** → robotics credibility
