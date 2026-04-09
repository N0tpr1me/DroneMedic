const API_BASE = import.meta.env.VITE_API_URL || '';

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
- Clinic A: General medical clinic (lat: 51.5124, lon: -0.12)
- Clinic B: Emergency care facility (lat: 51.5174, lon: -0.135)
- Clinic C: Rural health outpost (lat: 51.5044, lon: -0.11)
- Clinic D: Disaster relief camp (lat: 51.5, lon: -0.14)
- Royal London: Royal London Hospital - Major trauma centre (lat: 51.5185, lon: -0.059)
- Homerton: Homerton Hospital - Urgent care facility (lat: 51.5468, lon: -0.0456)
- Newham General: Newham General Hospital - Trauma kit resupply (lat: 51.5155, lon: 0.0285)
- Whipps Cross: Whipps Cross Hospital - Cardiac unit (lat: 51.569, lon: 0.0066)

When a user requests a delivery, confirm destination, supply type, and priority before proceeding. Keep responses concise and professional.`;

const PARSE_SYSTEM_PROMPT = `You are a delivery request parser for DroneMedic. Convert natural language into JSON.

Valid locations: Depot, Clinic A, Clinic B, Clinic C, Clinic D, Royal London, Homerton, Newham General, Whipps Cross

Output ONLY valid JSON with this schema:
{"locations": ["..."], "priorities": {"loc": "high"}, "supplies": {"loc": "supply"}, "constraints": {"avoid_zones": [], "weather_concern": "", "time_sensitive": false}}

Rules:
- Only use valid location names above
- Priority is "high" only for urgent/emergency/critical/ASAP
- Default supply is "medical supplies"
- Output ONLY the JSON, nothing else`;

const _chatHistory: Array<{role: string; content: string}> = [];

async function llmChat(message: string): Promise<string> {
  _chatHistory.push({ role: 'user', content: message });
  if (_chatHistory.length > 20) _chatHistory.splice(0, _chatHistory.length - 20);

  const messages = [
    { role: 'system', content: CHAT_SYSTEM_PROMPT },
    ..._chatHistory,
  ];

  const res = await fetch(`${LLM_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${LLM_KEY}` },
    body: JSON.stringify({ model: LLM_MODEL, max_tokens: 1024, messages }),
  });

  if (!res.ok) throw new Error(`LLM error ${res.status}`);
  const data = await res.json();
  const reply = data.choices?.[0]?.message?.content?.trim() || 'No response from AI.';
  _chatHistory.push({ role: 'assistant', content: reply });
  return reply;
}

async function llmParse(userInput: string): Promise<Task> {
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
  let content = data.choices?.[0]?.message?.content?.trim() || '';
  // Strip markdown code fences if present
  content = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  // Strip <thinking> blocks
  content = content.replace(/<thinking>[\s\S]*?<\/thinking>/g, '').trim();
  return JSON.parse(content);
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
      // Backend unreachable — call LLM directly from browser
      const reply = await llmChat(message);
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
