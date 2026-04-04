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
  getLocations: () =>
    request<{ locations: Record<string, Location>; valid_names: string[] }>('/api/locations'),

  parseTask: (userInput: string) =>
    request<{ task: Task }>('/api/parse-task', {
      method: 'POST',
      body: JSON.stringify({ user_input: userInput }),
    }),

  computeRoute: (locations: string[], priorities: Record<string, string> = {}, numDrones = 1) =>
    request<{ route: Route }>('/api/compute-route', {
      method: 'POST',
      body: JSON.stringify({ locations, priorities, num_drones: numDrones }),
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

  getWeather: () =>
    request<{ weather: Record<string, Weather> }>('/api/weather'),

  simulateWeather: (eventType: string, affectedLocations: string[]) =>
    request<{ event: Weather; all_weather: Record<string, Weather> }>('/api/simulate-weather', {
      method: 'POST',
      body: JSON.stringify({ event_type: eventType, affected_locations: affectedLocations }),
    }),

  clearWeather: () =>
    request<{ status: string }>('/api/clear-weather', { method: 'POST' }),

  getNoFlyZones: () =>
    request<{ zones: NoFlyZone[] }>('/api/no-fly-zones'),

  checkRouteSafety: (route: string[]) =>
    request<{ safe: boolean; violations: Array<{ from: string; to: string; zone: string }> }>(
      '/api/check-route-safety',
      { method: 'POST', body: JSON.stringify({ route }) },
    ),

  startDelivery: (route: string[]) =>
    request<{ status: string; visited: string[]; battery: number; flight_log: FlightLogEntry[] }>(
      '/api/start-delivery',
      { method: 'POST', body: JSON.stringify({ route }) },
    ),

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

  chat: (message: string, context: { task?: Task; route?: Route; weather?: Record<string, Weather>; flightLog?: FlightLogEntry[] } = {}) =>
    request<{ reply: string }>('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message, context }),
    }),

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
