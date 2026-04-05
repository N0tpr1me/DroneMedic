# DroneMedic -- 10-Minute Demo Script

**Event**: AR26 HackXelerator | **Deadline**: April 10, 2026
**Judges**: NVIDIA, Meta, PyTorch representatives

---

## Pre-Demo Checklist (5 min before)

- [ ] Backend running: `PYTHONPATH=. uvicorn backend.main:app --reload`
- [ ] Frontend running: `cd web && npm run dev`
- [ ] Browser open to Dashboard (full screen, dark mode)
- [ ] Supabase project active (check green status at supabase.com)
- [ ] `.env` has valid keys (ANTHROPIC_API_KEY, SUPABASE_URL, GOOGLE_MAPS_API_KEY)
- [ ] Phone on silent, notifications off
- [ ] Terminal ready for CLI fallback demos
- [ ] Unity sim open in background (optional, for 3D scene)

**Fallback**: If backend is down, use `PYTHONPATH=. python3 main.py --demo-full` for CLI demo. If Supabase is down, mock data in `demo-scenario.ts` still works.

---

## Demo Flow

### [0:00 - 1:00] The Problem (1 min)

**What to say:**
> "Every year, 2 million people die because medical supplies don't reach them in time. Traffic, remote terrain, and hospital logistics create fatal delays. DroneMedic solves this with autonomous medical drone delivery -- AI-powered routing that adapts in real-time to weather, no-fly zones, and emergencies."

**What to show:**
- Landing page with hero visual
- Quick scroll through problem stats (if on landing page)

**Judge alignment:** All judges -- establishes real-world impact.

---

### [1:00 - 2:30] Natural Language Mission Creation (1.5 min)

**What to say:**
> "A clinician doesn't need to learn software. They just say what they need in plain English."

**What to click:**
1. Navigate to **Deploy** page
2. Type in chat: `"Send blood packs and a defibrillator to Royal London Hospital, urgent priority"`
3. Show AI parsing the request into structured JSON (destinations, supplies, priority)
4. Point out the supply weight calculation (blood pack 0.5 kg + defibrillator 2.0 kg = 2.5 kg payload)

**Judge alignment:**
- **Meta** -- NL interface, LLM integration
- **PyTorch** -- AI pipeline architecture

**Fallback:** If LLM API is slow, switch to pre-loaded demo scenario: "Let me show you one we prepared earlier" and trigger the demo scenario.

---

### [2:30 - 4:00] Route Optimization + Physics (1.5 min)

**What to say:**
> "Behind the scenes, Google OR-Tools solves a Vehicle Routing Problem with real constraints -- battery capacity, no-fly zones, delivery priorities, and weather penalties. But before any drone launches, our aerospace physics engine runs a full feasibility check."

**What to click:**
1. Show the **Dashboard** map with the computed route
2. Point out the no-fly zones (red polygons) on the map
3. Highlight route distance, ETA, and battery usage in the mission panel
4. Open flight log to show physics preflight check: thrust-to-weight ratio, energy budget, range margin

**What to say about physics:**
> "This isn't a toy simulation. We model actuator disk theory for hover power, account for headwind drag, climb/descent energy, and enforce a 15% emergency reserve. The drone won't launch if the math says it can't make it back."

**Judge alignment:**
- **NVIDIA** -- compute-heavy optimization, physics simulation
- **PyTorch** -- engineering rigor in the ML pipeline

**Fallback:** Run `PYTHONPATH=. python3 main.py --skip-ai` to show route computation in terminal with distance and battery stats.

---

### [4:00 - 5:30] Live Mission Execution (1.5 min)

**What to say:**
> "Watch the mission execute in real-time. Every position update, battery drain, and waypoint arrival streams through Supabase Realtime to the dashboard."

**What to click:**
1. Start the mission from Dashboard
2. Watch the drone icon move on the 3D map
3. Point out real-time telemetry: battery %, speed, altitude, ETA countdown
4. Show the flight log updating live with events (takeoff, waypoint reached, delivering)
5. Show the boot sequence animation when mission initializes

**Judge alignment:**
- **Meta** -- real-time UX, streaming architecture
- **NVIDIA** -- 3D visualization (Three.js drone model)

---

### [5:30 - 7:00] Dynamic Re-routing (1.5 min)

**What to say:**
> "Real flights don't go according to plan. Weather changes. Obstacles appear. DroneMedic adapts mid-flight."

**What to click/trigger:**
1. Trigger weather event: show storm warning appearing in dashboard
2. Watch the AI reasoning panel explain why it's re-routing
3. Show the reroute count incrementing in mission stats
4. Show new route avoiding the weather zone on the map
5. Point out geofence violation detection if drone approaches no-fly zone

**What to say:**
> "The system detected a storm cell on the planned route and autonomously re-routed. The clinician sees a simple notification -- the AI handles the complexity."

**Judge alignment:**
- **PyTorch** -- adaptive AI reasoning
- **NVIDIA** -- real-time constraint solving

**Fallback:** Run `PYTHONPATH=. python3 main.py --demo-weather` for weather re-routing, or `--demo-obstacle` for obstacle avoidance.

---

### [7:00 - 8:30] Fleet Management + Analytics (1.5 min)

**What to say:**
> "DroneMedic isn't a single drone. It manages a fleet with multi-drone VRP optimization."

**What to click:**
1. Navigate to **Fleet** page -- show multiple drones with status
2. Navigate to **Analytics** page -- show delivery success rates, average delivery time, battery efficiency
3. Point out predictive maintenance indicators (LSTM autoencoder for anomaly detection)
4. Show the multi-drone route optimization: 2+ drones splitting deliveries optimally

**Judge alignment:**
- **NVIDIA** -- fleet-scale compute, GPU-accelerated inference
- **Meta** -- production-scale system design

**Fallback:** Run `PYTHONPATH=. python3 main.py --multi-drone` to show 2-drone VRP in terminal.

---

### [8:30 - 9:30] Technical Deep Dive (1 min)

**What to say:**
> "Let me show you what's under the hood."

**What to show (quick flashes):**
1. **Supabase**: "20 Supabase features -- PostGIS for spatial queries, pgvector for semantic search, Realtime for live updates, Edge Functions for serverless compute, RLS for row-level security"
2. **Architecture**: Show the C4 diagram (ARCHITECTURE.md or a slide)
3. **Test suite**: `PYTHONPATH=. pytest tests/test_api.py -v` -- show green tests passing
4. **CI/CD**: GitHub Actions badge (if set up)

**Judge alignment:**
- **All judges** -- engineering maturity, testing, architecture

---

### [9:30 - 10:00] Closing + Q&A Setup (30 sec)

**What to say:**
> "DroneMedic combines OR-Tools optimization, aerospace physics, LLM-powered interfaces, and real-time 3D visualization into a platform that could save lives. We built this in 20 days with a team of four. Thank you."

**What to show:**
- Return to Dashboard with a completed mission (green checkmark)
- Team slide if available

---

## Contingency Plans

| Failure | Fallback |
|---------|----------|
| Backend crash | CLI demos: `python3 main.py --demo-full` |
| Supabase down | Demo scenario data in `web/src/data/demo-scenario.ts` |
| LLM API timeout | Pre-parsed JSON payload, skip NL parsing step |
| Map tiles fail | Show Streamlit dashboard: `streamlit run frontend/dashboard.py` |
| WebSocket drops | Refresh browser, data re-syncs from Supabase |
| Unity crash | Three.js drone scene in React dashboard still works |
| No internet | Mock mode for everything: weather, LLM, simulation |

## Judge-Specific Talking Points

### NVIDIA Judge
- Physics engine uses compute-intensive actuator disk theory
- Fleet-scale VRP is NP-hard, solved with constraint programming
- 3D visualization pipeline (Three.js + Deck.gl)
- Future: GPU-accelerated path planning with CUDA

### Meta Judge
- Natural language interface -- zero training for clinicians
- Real-time streaming architecture (WebSocket + Supabase Realtime)
- Social impact: medical supply access in underserved areas
- Production-grade auth, RLS, and multi-tenant architecture

### PyTorch Judge
- YOLOv8 for obstacle detection (computer vision pipeline)
- LSTM autoencoder for predictive maintenance anomaly detection
- Demand forecasting model for supply pre-positioning
- AI reasoning narration -- transparent decision-making
