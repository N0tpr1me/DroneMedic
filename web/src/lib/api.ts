import { publishDecision } from './decisionBus';

const API_BASE = import.meta.env.VITE_API_URL || '';

function newDecisionId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now()}-${rand}`;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `API error ${res.status}`);
  }
  return res.json();
}

// ── Client-side LLM for when backend is unreachable (Netlify deploy) ──

const LLM_KEY = 'sk-1f595ec788c84bd3907382222f91ef36';
const LLM_BASE = 'https://chat.kxsb.org/api/v1';
const LLM_MODEL = 'azure/gpt-5.3-chat';

const CHAT_SYSTEM_PROMPT = `You are DroneMedic Mission Control — an AI operations coordinator for NHS emergency medical drone deliveries across London. You speak like a professional air traffic controller: precise, calm, and authoritative. Never use emojis.

Active Delivery Network:
- Depot: Main drone depot / base station (lat: 51.5074, lon: -0.1278)
- Clinic A / Whitechapel Clinic: General medical clinic (lat: 51.5124, lon: -0.12)
- Clinic B: Emergency care facility (lat: 51.5174, lon: -0.135)
- Clinic C: Rural health outpost (lat: 51.5044, lon: -0.11)
- Clinic D: Disaster relief camp (lat: 51.5, lon: -0.14)
- Royal London: Royal London Hospital - Major trauma centre (lat: 51.5185, lon: -0.059)
- Homerton: Homerton Hospital - Urgent care facility (lat: 51.5468, lon: -0.0456)
- Newham General: Newham General Hospital - Trauma kit resupply (lat: 51.5155, lon: 0.0285)
- Whipps Cross: Whipps Cross Hospital - Cardiac unit (lat: 51.569, lon: 0.0066)

Fleet Status (3 drones available):
- Drone Alpha: idle at Central Depot, battery 94%, range 12km
- Drone Beta: idle at Royal London depot, battery 87%, range 10km
- Drone Gamma: idle at Homerton depot, battery 91%, range 11km

When a user requests deliveries to multiple locations, reason through the optimal drone assignment:
1. Evaluate patient priority (life-critical vs routine)
2. Consider each drone's proximity to destinations and current battery
3. Assign the closest drone with sufficient battery to the highest-priority delivery
4. Explain your reasoning: which patient is more critical, which drone is closer, which route minimises total response time
5. Present the assignment as a fleet dispatch plan with per-drone routes

After presenting the plan, tell the user to say "deploy" to launch. Keep responses concise and professional.`;

const PARSE_SYSTEM_PROMPT = `You are a delivery request parser for DroneMedic. Convert natural language into JSON.

Valid locations: Depot, Clinic A, Clinic B, Clinic C, Clinic D, Royal London, Homerton, Newham General, Whipps Cross
Aliases: "Whitechapel Clinic" = "Clinic A", "Whitechapel" = "Clinic A"

Output ONLY valid JSON with this schema:
{"locations": ["..."], "priorities": {"loc": "high"}, "supplies": {"loc": "supply"}, "constraints": {"avoid_zones": [], "weather_concern": "", "time_sensitive": false}}

Rules:
- Only use valid location names above (resolve aliases to canonical names)
- Priority is "high" only for urgent/emergency/critical/ASAP
- Default supply is "medical supplies"
- Output ONLY the JSON, nothing else`;

const _chatHistory: Array<{role: string; content: string}> = [];

/**
 * Build a live-mission briefing block that gets appended to the system
 * prompt so the LLM can answer status queries ("mission status",
 * "where is the drone?", "battery?") accurately.
 */
function buildMissionBriefing(
  ctx?: { task?: Task; route?: Route; weather?: Record<string, Weather>; flightLog?: FlightLogEntry[] },
): string {
  if (!ctx) return '';
  const parts: string[] = [];

  if (ctx.task) {
    const locs = ctx.task.locations.join(', ');
    const highPrio = Object.entries(ctx.task.priorities ?? {})
      .filter(([, v]) => v === 'high')
      .map(([k]) => k);
    const supplies = Object.entries(ctx.task.supplies ?? {})
      .map(([loc, s]) => `${loc}: ${s}`)
      .join('; ');
    parts.push(
      `ACTIVE MISSION:\n` +
      `  Destinations: ${locs}\n` +
      `  Supplies: ${supplies || 'medical supplies'}\n` +
      (highPrio.length > 0 ? `  HIGH PRIORITY: ${highPrio.join(', ')}\n` : ''),
    );
  }

  if (ctx.route) {
    const routeStr = ctx.route.ordered_route.join(' → ');
    parts.push(
      `PLANNED ROUTE: ${routeStr}\n` +
      `  Total distance: ${ctx.route.total_distance}m\n` +
      `  Estimated time: ${ctx.route.estimated_time}s\n` +
      `  Battery usage: ${ctx.route.battery_usage}%`,
    );
  }

  if (ctx.flightLog && ctx.flightLog.length > 0) {
    // Last 5 entries give the LLM enough to answer "where is the drone?"
    const recent = ctx.flightLog.slice(-5);
    const latest = recent[recent.length - 1];
    const bat = typeof latest.battery === 'number' ? `${latest.battery.toFixed(0)}%` : 'unknown';
    const logLines = recent
      .map((e) => `  ${e.event}${e.location ? ` at ${e.location}` : ''} (battery ${typeof e.battery === 'number' ? e.battery.toFixed(0) + '%' : '?'})`)
      .join('\n');
    parts.push(
      `LIVE TELEMETRY (latest first):\n` +
      `  Current location: ${latest.location || 'in transit'}\n` +
      `  Battery: ${bat}\n` +
      `  Recent events:\n${logLines}`,
    );
    // Derive mission phase
    const lastEvent = latest.event.toLowerCase();
    const phase =
      lastEvent.includes('takeoff') ? 'DEPARTED — en route to first waypoint' :
      lastEvent.includes('arrive') || lastEvent.includes('waypoint') ? `AT WAYPOINT — ${latest.location}` :
      lastEvent.includes('deliver') ? `DELIVERING at ${latest.location}` :
      lastEvent.includes('landed') || lastEvent.includes('completed') ? 'COMPLETED — drone has landed' :
      lastEvent.includes('reroute') ? 'REROUTING — path updated mid-flight' :
      'IN FLIGHT';
    parts.push(`MISSION PHASE: ${phase}`);
  }

  if (ctx.weather && Object.keys(ctx.weather).length > 0) {
    const summaries = Object.entries(ctx.weather)
      .slice(0, 4)
      .map(([loc, w]) => `  ${loc}: ${w.description}, wind ${w.wind_speed}m/s, ${w.flyable ? 'FLYABLE' : 'NOT FLYABLE'}`)
      .join('\n');
    parts.push(`WEATHER:\n${summaries}`);
  }

  if (parts.length === 0) return '';
  return '\n\n--- LIVE MISSION STATE ---\n' + parts.join('\n\n') +
    '\n\nUse this live state to answer status queries precisely. Report battery, location, route progress, and ETA when asked.';
}

async function llmChat(
  message: string,
  context?: { task?: Task; route?: Route; weather?: Record<string, Weather>; flightLog?: FlightLogEntry[] },
): Promise<string> {
  _chatHistory.push({ role: 'user', content: message });
  if (_chatHistory.length > 20) _chatHistory.splice(0, _chatHistory.length - 20);

  const systemPrompt = CHAT_SYSTEM_PROMPT + buildMissionBriefing(context);
  const messages = [
    { role: 'system', content: systemPrompt },
    ..._chatHistory,
  ];

  const startedAt = performance.now();
  const res = await fetch(`${LLM_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${LLM_KEY}` },
    body: JSON.stringify({ model: LLM_MODEL, max_tokens: 1024, messages }),
  });

  if (!res.ok) throw new Error(`LLM error ${res.status}`);
  const data = await res.json();
  const reply = data.choices?.[0]?.message?.content?.trim() || 'No response from AI.';
  const latencyMs = performance.now() - startedAt;
  _chatHistory.push({ role: 'assistant', content: reply });

  // Publish into the client-side decision bus so the DecisionStream panel
  // shows a real card for every chat turn.
  publishDecision({
    decision_id: newDecisionId('llm-chat'),
    intent: 'query',
    input: message,
    reasoning:
      `Mission Control routed a user query through the direct-LLM channel ` +
      `(kxsb proxy · ${LLM_MODEL}). Context window carries ` +
      `${_chatHistory.length} turn(s). Reply length ${reply.length} chars.`,
    decision: { reply: reply.length > 180 ? `${reply.slice(0, 180)}…` : reply },
    latency_ms: Math.round(latencyMs),
    model: LLM_MODEL,
    severity: 'info',
    timestamp: Date.now() / 1000,
  });

  return reply;
}

async function llmParse(userInput: string): Promise<Task> {
  const startedAt = performance.now();
  const res = await fetch(`${LLM_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${LLM_KEY}` },
    body: JSON.stringify({
      model: LLM_MODEL,
      max_tokens: 512,
      messages: [
        { role: 'system', content: PARSE_SYSTEM_PROMPT },
        { role: 'user', content: userInput },
      ],
    }),
  });

  if (!res.ok) throw new Error(`LLM parse error ${res.status}`);
  const data = await res.json();
  const rawContent: string = data.choices?.[0]?.message?.content?.trim() || '';
  // Capture the <thinking> block BEFORE stripping it — this feeds the
  // reasoning pane of the DecisionStream card we publish below.
  const thinkingMatch = rawContent.match(/<thinking>([\s\S]*?)<\/thinking>/);
  const capturedThinking = thinkingMatch ? thinkingMatch[1].trim() : '';
  // Strip markdown fences + thinking blocks for the JSON parse
  const jsonContent = rawContent
    .replace(/```json\s*/g, '')
    .replace(/```\s*/g, '')
    .replace(/<thinking>[\s\S]*?<\/thinking>/g, '')
    .trim();
  const task: Task = JSON.parse(jsonContent);
  const latencyMs = performance.now() - startedAt;

  const locationList = task.locations?.join(', ') || 'no locations';
  const highPriority = Object.keys(task.priorities ?? {}).filter(
    (k) => task.priorities[k] === 'high',
  );
  const reasoning =
    capturedThinking ||
    `Parsed delivery request via kxsb ${LLM_MODEL}. ` +
      `Identified ${task.locations?.length ?? 0} delivery location(s): ${locationList}. ` +
      (highPriority.length > 0
        ? `Inferred high-priority stops: ${highPriority.join(', ')}. `
        : 'No explicit priority cues in input. ') +
      `Constraints: avoid_zones=${(task.constraints?.avoid_zones ?? []).join('|') || 'none'}, ` +
      `time_sensitive=${task.constraints?.time_sensitive ? 'yes' : 'no'}.`;

  publishDecision({
    decision_id: newDecisionId('llm-parse'),
    intent: 'parse_request',
    input: userInput,
    reasoning,
    decision: {
      locations: task.locations,
      priorities: task.priorities,
      supplies: task.supplies,
    },
    latency_ms: Math.round(latencyMs),
    model: LLM_MODEL,
    severity: highPriority.length > 0 ? 'warning' : 'info',
    timestamp: Date.now() / 1000,
  });

  return task;
}

// ── Client-side fallback data for when backend is unreachable ──

const FALLBACK_LOCATIONS: Record<string, Location> = {
  "Depot": { x: 0, y: 0, z: -30, lat: 51.5074, lon: -0.1278, description: "Main drone depot / base station" },
  "Clinic A": { x: 100, y: 50, z: -30, lat: 51.5124, lon: -0.12, description: "General medical clinic" },
  "Clinic B": { x: -50, y: 150, z: -30, lat: 51.5174, lon: -0.135, description: "Emergency care facility" },
  "Clinic C": { x: 200, y: -30, z: -30, lat: 51.5044, lon: -0.11, description: "Rural health outpost" },
  "Clinic D": { x: -100, y: -80, z: -30, lat: 51.5, lon: -0.14, description: "Disaster relief camp" },
  "Royal London": { x: 100, y: 50, z: -30, lat: 51.5185, lon: -0.059, description: "Royal London Hospital - Major trauma centre" },
  "Homerton": { x: -50, y: 150, z: -30, lat: 51.5468, lon: -0.0456, description: "Homerton Hospital - Urgent care facility" },
  "Newham General": { x: 200, y: -30, z: -30, lat: 51.5155, lon: 0.0285, description: "Newham General Hospital - Trauma kit resupply" },
  "Whipps Cross": { x: -100, y: -80, z: -30, lat: 51.569, lon: 0.0066, description: "Whipps Cross Hospital - Cardiac unit" },
};

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function clientComputeRoute(locations: string[], priorities: Record<string, string> = {}): Route {
  // Simple nearest-neighbor route starting from Depot
  const stops = locations.filter(l => l !== 'Depot');
  const ordered: string[] = ['Depot'];
  const remaining = [...stops];
  let current = FALLBACK_LOCATIONS['Depot'];

  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const loc = FALLBACK_LOCATIONS[remaining[i]];
      if (!loc) continue;
      let dist = haversine(current.lat, current.lon, loc.lat, loc.lon);
      if (priorities[remaining[i]] === 'high') dist *= 0.3; // prioritize urgent
      if (dist < bestDist) { bestDist = dist; bestIdx = i; }
    }
    const next = remaining.splice(bestIdx, 1)[0];
    ordered.push(next);
    current = FALLBACK_LOCATIONS[next] || current;
  }
  ordered.push('Depot');

  let totalDist = 0;
  for (let i = 1; i < ordered.length; i++) {
    const a = FALLBACK_LOCATIONS[ordered[i - 1]];
    const b = FALLBACK_LOCATIONS[ordered[i]];
    if (a && b) totalDist += haversine(a.lat, a.lon, b.lat, b.lon);
  }

  return {
    ordered_route: ordered,
    ordered_routes: { Drone1: ordered },
    total_distance: Math.round(totalDist),
    estimated_time: Math.round(totalDist / 15),
    battery_usage: Math.round(totalDist * 0.005),
    no_fly_violations: [],
  };
}

// ── Types ──

export interface Location {
  x: number;
  y: number;
  z: number;
  lat: number;
  lon: number;
  description: string;
}

export interface Task {
  locations: string[];
  priorities: Record<string, string>;
  supplies: Record<string, string>;
  constraints: {
    avoid_zones: string[];
    weather_concern: string;
    time_sensitive: boolean;
  };
}

export interface Route {
  ordered_route: string[];
  ordered_routes: Record<string, string[]>;
  total_distance: number;
  estimated_time: number;
  battery_usage: number;
  no_fly_violations: Array<{ from: string; to: string; zone: string }>;
}

export interface Weather {
  wind_speed: number;
  precipitation: number;
  visibility: number;
  temperature: number;
  alerts: string[];
  flyable: boolean;
  description: string;
}

export interface NoFlyZone {
  name: string;
  polygon: Array<[number, number]>;
  lat_lon: Array<[number, number]>;
}

export interface Metrics {
  delivery_time_reduction: number;
  distance_reduction: number;
  throughput: number;
  reroute_success_rate: number;
  total_distance_optimized: number;
  total_distance_naive: number;
  battery_used: number;
  robustness_score: number;
  actual_flight_time_seconds: number;
  estimated_time_seconds: number;
  naive_time_seconds: number;
}

export interface Facility {
  name: string;
  type: string;
  phone: string;
  email: string;
  address: string;
  lat: number;
  lon: number;
  region: string;
  beds: number;
  website: string;
}

export interface FlightLogEntry {
  event: string;
  location: string;
  position: { x: number; y: number; z: number };
  battery: number;
  timestamp: number;
}

export interface RiskScore {
  score: number;
  level: string;
  factors: string[];
  recommendation: string;
  contingency: string;
}

export interface PayloadStatus {
  temperature_c: number;
  integrity: string;
  time_remaining_minutes: number;
}

export interface TransportComparison {
  drone: { time_min: number; cost_gbp: number };
  helicopter: { time_min: number; cost_gbp: number; available: boolean };
  ambulance: { time_min: number; cost_gbp: number };
}

export interface DeliveryConfirmation {
  timestamp: string;
  recipient: string;
  recipient_role: string;
  condition: string;
  signature_id: string;
}

export interface TelemetryData {
  lat: number;
  lon: number;
  alt_m: number;
  relative_alt_m: number;
  battery_pct: number;
  flight_mode: string;
  is_armed: boolean;
  is_flying: boolean;
  heading_deg: number;
  speed_m_s: number;
  timestamp: number;
  source: 'px4' | 'mock';
}

// ── AI Decision Stream types ──

export type AIDecisionIntent =
  | 'parse_request'
  | 'what_if'
  | 'replan'
  | 'policy_fire'
  | 'query'
  | 'followup';

export type AIDecisionSeverity = 'info' | 'success' | 'warning' | 'error';

export interface AIDecisionEvent {
  decision_id: string;
  intent: AIDecisionIntent;
  input: string;
  reasoning: string;
  decision: Record<string, unknown>;
  latency_ms: number | null;
  model: string | null;
  severity: AIDecisionSeverity;
  timestamp: number;
}

// ── Race Comparison types ──

export interface RaceComparisonAssumptions {
  drone_cruise_ms: number;
  ambulance_avg_ms: number;
  road_to_straight_ratio: number;
  ambulance_stop_overhead_s: number;
}

export interface RaceComparison {
  locations: string[];
  drone_seconds: number;
  ambulance_seconds: number;
  seconds_saved: number;
  percent_saved: number;
  drone_distance_m: number;
  ambulance_distance_m: number;
  assumptions: RaceComparisonAssumptions;
}

// ── Narrow helpers (no zod available) ──

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const VALID_INTENTS: readonly AIDecisionIntent[] = [
  'parse_request',
  'what_if',
  'replan',
  'policy_fire',
  'query',
  'followup',
];

const VALID_SEVERITIES: readonly AIDecisionSeverity[] = ['info', 'success', 'warning', 'error'];

function toAIDecisionEvent(raw: unknown): AIDecisionEvent | null {
  if (!isRecord(raw)) return null;

  const decisionId = typeof raw.decision_id === 'string' ? raw.decision_id : null;
  const intent = VALID_INTENTS.includes(raw.intent as AIDecisionIntent)
    ? (raw.intent as AIDecisionIntent)
    : 'query';
  const input = typeof raw.input === 'string' ? raw.input : '';
  const reasoning = typeof raw.reasoning === 'string' ? raw.reasoning : '';
  const decision = isRecord(raw.decision) ? raw.decision : {};
  const latencyMs = typeof raw.latency_ms === 'number' ? raw.latency_ms : null;
  const model = typeof raw.model === 'string' ? raw.model : null;
  const severity = VALID_SEVERITIES.includes(raw.severity as AIDecisionSeverity)
    ? (raw.severity as AIDecisionSeverity)
    : 'info';
  const timestamp = typeof raw.timestamp === 'number' ? raw.timestamp : Date.now() / 1000;

  if (!decisionId) return null;

  return {
    decision_id: decisionId,
    intent,
    input,
    reasoning,
    decision,
    latency_ms: latencyMs,
    model,
    severity,
    timestamp,
  };
}

function toRaceComparison(raw: unknown): RaceComparison | null {
  if (!isRecord(raw)) return null;

  const locations = Array.isArray(raw.locations)
    ? raw.locations.filter((l): l is string => typeof l === 'string')
    : [];
  const droneSeconds = typeof raw.drone_seconds === 'number' ? raw.drone_seconds : 0;
  const ambulanceSeconds = typeof raw.ambulance_seconds === 'number' ? raw.ambulance_seconds : 0;
  const secondsSaved = typeof raw.seconds_saved === 'number' ? raw.seconds_saved : Math.max(0, ambulanceSeconds - droneSeconds);
  const percentSaved = typeof raw.percent_saved === 'number' ? raw.percent_saved : 0;
  const droneDistanceM = typeof raw.drone_distance_m === 'number' ? raw.drone_distance_m : 0;
  const ambulanceDistanceM = typeof raw.ambulance_distance_m === 'number' ? raw.ambulance_distance_m : 0;

  const rawAssumptions = isRecord(raw.assumptions) ? raw.assumptions : {};
  const assumptions: RaceComparisonAssumptions = {
    drone_cruise_ms: typeof rawAssumptions.drone_cruise_ms === 'number' ? rawAssumptions.drone_cruise_ms : 20,
    ambulance_avg_ms: typeof rawAssumptions.ambulance_avg_ms === 'number' ? rawAssumptions.ambulance_avg_ms : 8,
    road_to_straight_ratio: typeof rawAssumptions.road_to_straight_ratio === 'number' ? rawAssumptions.road_to_straight_ratio : 1.6,
    ambulance_stop_overhead_s: typeof rawAssumptions.ambulance_stop_overhead_s === 'number' ? rawAssumptions.ambulance_stop_overhead_s : 0,
  };

  return {
    locations,
    drone_seconds: droneSeconds,
    ambulance_seconds: ambulanceSeconds,
    seconds_saved: secondsSaved,
    percent_saved: percentSaved,
    drone_distance_m: droneDistanceM,
    ambulance_distance_m: ambulanceDistanceM,
    assumptions,
  };
}

export async function fetchRecentDecisions(limit: number = 50): Promise<AIDecisionEvent[]> {
  try {
    const payload = await request<{ decisions?: unknown; count?: number }>(
      `/api/ai/decisions?limit=${encodeURIComponent(limit)}`,
    );
    if (!Array.isArray(payload.decisions)) return [];
    return payload.decisions
      .map(toAIDecisionEvent)
      .filter((d): d is AIDecisionEvent => d !== null);
  } catch {
    return [];
  }
}

/**
 * Compute an ambulance-vs-drone comparison entirely in the browser, using
 * FALLBACK_LOCATIONS coordinates + the same formula the backend uses in
 * backend/api/routes/race.py. This keeps the RaceTimer widget functional
 * when the backend is unreachable (fallback/static-deploy mode) or when
 * the backend has no route-comparison endpoint.
 */
function clientComputeRaceComparison(locations: string[]): RaceComparison {
  const DRONE_CRUISE_MS = 15;
  const AMBULANCE_AVG_MS = 8;
  const ROAD_TO_STRAIGHT_RATIO = 1.6;
  const AMBULANCE_STOP_OVERHEAD_S = 60;

  const assumptions: RaceComparisonAssumptions = {
    drone_cruise_ms: DRONE_CRUISE_MS,
    ambulance_avg_ms: AMBULANCE_AVG_MS,
    road_to_straight_ratio: ROAD_TO_STRAIGHT_RATIO,
    ambulance_stop_overhead_s: AMBULANCE_STOP_OVERHEAD_S,
  };

  const valid = locations.filter((l) => FALLBACK_LOCATIONS[l] !== undefined && l !== 'Depot');
  if (valid.length === 0) {
    return {
      locations: [],
      drone_seconds: 0,
      ambulance_seconds: 0,
      seconds_saved: 0,
      percent_saved: 0,
      drone_distance_m: 0,
      ambulance_distance_m: 0,
      assumptions,
    };
  }

  // Drone: use the same nearest-neighbor + haversine logic already in this file
  // so the comparison stays internally consistent even without the backend VRP.
  const route = clientComputeRoute(valid);
  const droneDistanceM = route.total_distance;
  const droneSeconds = Math.max(1, Math.round(droneDistanceM / DRONE_CRUISE_MS));

  // Ambulance: naive Depot → A → B → ... → Depot straight-line distance,
  // scaled up by road_to_straight_ratio and driven at ambulance_avg_ms.
  const orderedNaive = ['Depot', ...valid, 'Depot'];
  let straightDistance = 0;
  for (let i = 1; i < orderedNaive.length; i++) {
    const a = FALLBACK_LOCATIONS[orderedNaive[i - 1]];
    const b = FALLBACK_LOCATIONS[orderedNaive[i]];
    if (a && b) straightDistance += haversine(a.lat, a.lon, b.lat, b.lon);
  }
  const ambulanceDistanceM = Math.round(straightDistance * ROAD_TO_STRAIGHT_RATIO);
  const ambulanceSeconds = Math.max(
    1,
    Math.round(
      ambulanceDistanceM / AMBULANCE_AVG_MS + valid.length * AMBULANCE_STOP_OVERHEAD_S,
    ),
  );

  const secondsSaved = Math.max(0, ambulanceSeconds - droneSeconds);
  const percentSaved = ambulanceSeconds > 0
    ? Math.round((secondsSaved / ambulanceSeconds) * 100)
    : 0;

  return {
    locations: valid,
    drone_seconds: droneSeconds,
    ambulance_seconds: ambulanceSeconds,
    seconds_saved: secondsSaved,
    percent_saved: percentSaved,
    drone_distance_m: droneDistanceM,
    ambulance_distance_m: ambulanceDistanceM,
    assumptions,
  };
}

export async function fetchRaceComparison(locations: string[]): Promise<RaceComparison | null> {
  // Empty locations → nothing to compare, skip both fetch and fallback.
  if (locations.length === 0) return null;

  try {
    const qs = encodeURIComponent(locations.join(','));
    const payload = await request<unknown>(`/api/metrics/race-comparison?locations=${qs}`);
    const parsed = toRaceComparison(payload);
    // If the backend responded but the numbers are empty (e.g. all unknown
    // locations), fall through to the client-side compute so the widget
    // still has something to show.
    if (parsed && parsed.drone_seconds > 0) return parsed;
  } catch {
    // Backend unreachable — fall through to client-side compute.
  }

  const local = clientComputeRaceComparison(locations);
  if (local.drone_seconds === 0) return null;
  return local;
}

// ── API Functions ──

export const api = {
  getLocations: async (): Promise<{ locations: Record<string, Location>; valid_names: string[] }> => {
    try {
      return await request<{ locations: Record<string, Location>; valid_names: string[] }>('/api/locations');
    } catch {
      return { locations: FALLBACK_LOCATIONS, valid_names: Object.keys(FALLBACK_LOCATIONS) };
    }
  },

  parseTask: async (userInput: string): Promise<{ task: Task }> => {
    try {
      return await request<{ task: Task }>('/api/parse-task', {
        method: 'POST',
        body: JSON.stringify({ user_input: userInput }),
      });
    } catch {
      // Backend unreachable — parse via LLM directly
      const task = await llmParse(userInput);
      return { task };
    }
  },

  computeRoute: async (locations: string[], priorities: Record<string, string> = {}, numDrones = 1): Promise<{ route: Route }> => {
    try {
      return await request<{ route: Route }>('/api/compute-route', {
        method: 'POST',
        body: JSON.stringify({ locations, priorities, num_drones: numDrones }),
      });
    } catch {
      return { route: clientComputeRoute(locations, priorities) };
    }
  },

  /** One-shot deploy: create deliveries + schedule + start. Returns immediately. Live updates via WebSocket. */
  deploy: (deliveries: Array<{ destination: string; supply?: string; priority?: string; time_window_minutes?: number }>) =>
    request<{ status: string; deliveries: any[]; missions: any[] }>('/api/deploy', {
      method: 'POST',
      body: JSON.stringify({ deliveries }),
    }),


  recomputeRoute: (
    currentLocation: string,
    remainingLocations: string[],
    newLocations: string[],
    priorities: Record<string, string> = {},
  ) =>
    request<{ route: Route }>('/api/recompute-route', {
      method: 'POST',
      body: JSON.stringify({
        current_location: currentLocation,
        remaining_locations: remainingLocations,
        new_locations: newLocations,
        priorities,
      }),
    }),

  getWeather: async (): Promise<{ weather: Record<string, Weather> }> => {
    try {
      return await request<{ weather: Record<string, Weather> }>('/api/weather');
    } catch {
      return { weather: {} };
    }
  },

  simulateWeather: (eventType: string, affectedLocations: string[]) =>
    request<{ event: Weather; all_weather: Record<string, Weather> }>('/api/simulate-weather', {
      method: 'POST',
      body: JSON.stringify({ event_type: eventType, affected_locations: affectedLocations }),
    }),

  clearWeather: () =>
    request<{ status: string }>('/api/clear-weather', { method: 'POST' }),

  getNoFlyZones: async (): Promise<{ zones: NoFlyZone[] }> => {
    try {
      return await request<{ zones: NoFlyZone[] }>('/api/no-fly-zones');
    } catch {
      return { zones: [
        { name: "Military Zone Alpha", polygon: [[-20,80],[-20,120],[30,120],[30,80]], lat_lon: [[51.513,-0.132],[51.516,-0.132],[51.516,-0.126],[51.513,-0.126]] },
        { name: "Airport Exclusion", polygon: [[120,-60],[120,-20],[180,-20],[180,-60]], lat_lon: [[51.503,-0.115],[51.506,-0.115],[51.506,-0.108],[51.503,-0.108]] },
      ] };
    }
  },

  checkRouteSafety: (route: string[]) =>
    request<{ safe: boolean; violations: Array<{ from: string; to: string; zone: string }> }>(
      '/api/check-route-safety',
      { method: 'POST', body: JSON.stringify({ route }) },
    ),

  startDelivery: async (route: string[]): Promise<{ status: string; visited: string[]; battery: number; flight_log: FlightLogEntry[] }> => {
    try {
      return await request<{ status: string; visited: string[]; battery: number; flight_log: FlightLogEntry[] }>(
        '/api/start-delivery',
        { method: 'POST', body: JSON.stringify({ route }) },
      );
    } catch {
      return { status: 'demo', visited: route, battery: 58, flight_log: [] };
    }
  },

  computeMetrics: (params: {
    flight_log: FlightLogEntry[];
    optimized_route: Route;
    locations: string[];
    reroute_count?: number;
    reroute_successes?: number;
    obstacles_avoided?: number;
    obstacles_total?: number;
  }) =>
    request<{ metrics: Metrics }>('/api/metrics', {
      method: 'POST',
      body: JSON.stringify(params),
    }),

  getFacilities: (query = '', region = '', limit = 489) =>
    request<Facility[]>(`/api/facilities?query=${encodeURIComponent(query)}&region=${encodeURIComponent(region)}&limit=${limit}`),

  health: () => request<{ status: string }>('/api/health'),

  chat: async (message: string, context: { task?: Task; route?: Route; weather?: Record<string, Weather>; flightLog?: FlightLogEntry[] } = {}, sessionId?: string): Promise<{ reply: string }> => {
    try {
      return await request<{ reply: string }>('/api/chat', {
        method: 'POST',
        body: JSON.stringify({ message, context, sessionId }),
      });
    } catch {
      // Backend unreachable — call LLM directly from browser,
      // passing the mission context so status queries get real answers.
      const reply = await llmChat(message, context);
      return { reply };
    }
  },

  generateReport: (metrics: Metrics, missionSummary: Record<string, unknown> = {}) =>
    request<{ report: string }>('/api/generate-report', {
      method: 'POST',
      body: JSON.stringify({ metrics, mission_summary: missionSummary }),
    }),

  weatherBriefing: () =>
    request<{ briefing: string }>('/api/weather-briefing', { method: 'POST' }),

  riskScore: (route: string[], weather: Record<string, Weather> = {}, battery: number = 100, payloadPriority: string = 'normal') =>
    request<{ risk: RiskScore }>('/api/risk-score', {
      method: 'POST',
      body: JSON.stringify({ route, weather, battery, payload_priority: payloadPriority }),
    }),

  narrate: (event: Record<string, unknown>, context: Record<string, unknown> = {}) =>
    request<{ narration: string }>('/api/narrate', {
      method: 'POST',
      body: JSON.stringify({ event, context }),
    }),

  payloadStatus: (payloadType: string = 'blood', elapsedMinutes: number = 0, conditions: Record<string, unknown> = {}) =>
    request<{ temperature_c: number; integrity: string; time_remaining_minutes: number }>('/api/payload-status', {
      method: 'POST',
      body: JSON.stringify({ payload_type: payloadType, elapsed_minutes: elapsedMinutes, conditions }),
    }),

  missionComparison: (route: Record<string, unknown> = {}, locations: string[] = []) =>
    request<{ comparison: TransportComparison }>('/api/mission-comparison', {
      method: 'POST',
      body: JSON.stringify({ route, locations }),
    }),

  confirmDelivery: (missionId: string, recipient: string, role: string, condition: string = 'intact') =>
    request<{ confirmation: DeliveryConfirmation }>('/api/confirm-delivery', {
      method: 'POST',
      body: JSON.stringify({ mission_id: missionId, recipient, recipient_role: role, condition_on_arrival: condition }),
    }),
};
