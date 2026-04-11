/**
 * DroneMedic — Demo Scenario Data
 *
 * The Story: A 6-year-old at Royal London Hospital needs emergency O-negative blood.
 * The nearest supply is at the East London Blood Centre (our depot).
 * Ambulance: stuck in traffic, estimated 45+ minutes. Clinical window: 90 minutes.
 * A drone can do it in 12.
 */

export const DEMO_SCENARIO = {
  /** The natural language request to type into Deploy */
  request:
    'Emergency: O-negative blood needed at Royal London Hospital urgently. 2 units. Patient is a 6-year-old with ruptured spleen, 90 minute clinical window.',

  /** Pre-parsed task */
  task: {
    locations: ['Royal London'],
    priorities: { 'Royal London': 'high' },
    supplies: { 'Royal London': 'O- blood (2 units)' },
    constraints: {
      avoid_zones: ['North London storm corridor'],
      weather_concern: 'storm over North London',
      time_sensitive: true,
    },
  },

  /** Clinical context */
  clinicalDeadline: 90, // minutes
  payload: { type: 'O- blood', units: 2, tempRange: [2, 6] as [number, number] },
  recipient: {
    name: 'Dr. Osei',
    role: 'Trauma Surgeon',
    department: 'Paediatric Emergency',
  },

  /** Pre-computed route */
  route: {
    ordered_route: ['Depot', 'Royal London', 'Depot'],
    ordered_routes: { Drone1: ['Depot', 'Royal London', 'Depot'] },
    total_distance: 8400,
    estimated_time: 560,
    battery_usage: 42,
    no_fly_violations: [],
  },

  /** Risk assessment */
  risk: {
    score: 34,
    level: 'low',
    factors: [
      'Storm cell over North London — Southern corridor detour available',
      'Battery margin: 58% remaining after delivery',
      'Payload temperature stable at 4.0°C',
    ],
    recommendation: 'Proceed via Southern corridor. Monitor storm movement.',
    contingency: 'Drone Beta on standby at Canary Wharf depot, 8 min intercept capability.',
  },

  /** Transport comparison */
  comparison: {
    drone: { time_min: 12, cost_gbp: 85 },
    helicopter: { time_min: 0, cost_gbp: 8200, available: false },
    ambulance: { time_min: 47, cost_gbp: 180 },
  },

  /** Demo presenter script */
  script: [
    { step: 1, page: 'deploy', duration: 30, action: 'Type the delivery request. AI parses it. Risk score: 34/100 LOW. Click Deploy.' },
    { step: 2, page: 'dashboard', duration: 90, action: 'Drone launches. AI narrates. At ~40%, storm triggers reroute. AI explains. ETA updates. Payload temp holds.' },
    { step: 3, page: 'dashboard', duration: 30, action: 'Drone arrives at Royal London. Delivery confirmation: Dr. Osei, Trauma Surgeon. Chain of custody complete.' },
    { step: 4, page: 'logs', duration: 20, action: 'Show full chain of custody timeline. Payload integrity chart. Click Weather Briefing.' },
    { step: 5, page: 'analytics', duration: 30, action: 'Show KPIs: 97.3% on-time. Transport comparison: Drone 12min vs Ambulance 47min. Generate AI board report.' },
    { step: 6, page: 'close', duration: 10, action: 'This child is alive because a drone flew across London in 12 minutes with blood at 3.8°C while an ambulance sat in traffic.' },
  ],

  /** Closing statement */
  closingLine:
    'This child is alive because a drone flew across London in 12 minutes with blood at 3.8°C while an ambulance sat in traffic.',
} as const;

// ---------------------------------------------------------------------------
// 3 Instant-Launch Demo Scenarios (Deploy page buttons)
// ---------------------------------------------------------------------------

export interface DemoReroutePayload {
  delayMs: number;
  newRoute: {
    ordered_route: string[];
    ordered_routes: Record<string, string[]>;
    total_distance: number;
    estimated_time: number;
    battery_usage: number;
    no_fly_violations: never[];
  };
  rerouteWaypoints: Array<{ lat: number; lon: number; name: string }>;
  emergencyLocation: string;
  emergencySupply: string;
}

export interface DemoScenarioEntry {
  id: string;
  title: string;
  subtitle: string;
  request: string;
  icon: 'siren' | 'route' | 'zap';
  color: string;
  accentBorder: string;
  estMinutes: number;
  stops: number;
  /** When true, dispatches multiple drones simultaneously */
  fleetMode?: boolean;
  task: {
    locations: string[];
    priorities: Record<string, string>;
    supplies: Record<string, string>;
    constraints: { avoid_zones: string[]; weather_concern: string; time_sensitive: boolean };
  };
  route: {
    ordered_route: string[];
    ordered_routes: Record<string, string[]>;
    total_distance: number;
    estimated_time: number;
    battery_usage: number;
    no_fly_violations: never[];
  };
  /** Per-drone route data for fleet dispatch demos */
  fleetRoutes?: Record<string, {
    ordered_route: string[];
    total_distance: number;
    estimated_time: number;
    battery_usage: number;
  }>;
  reroute?: DemoReroutePayload;
}

export const DEMO_SCENARIOS: DemoScenarioEntry[] = [
  // ── Demo 1: Emergency Blood Delivery ──────────────────────────────
  {
    id: 'emergency-blood',
    title: 'Emergency Blood Delivery',
    subtitle: 'O-negative blood to Royal London — 6-year-old trauma patient',
    request: 'Emergency: O-negative blood needed at Royal London Hospital urgently. 2 units. Patient is a 6-year-old with ruptured spleen, 90 minute clinical window.',
    icon: 'siren',
    color: '#ff4444',
    accentBorder: 'rgba(255,68,68,0.3)',
    estMinutes: 9,
    stops: 1,
    task: {
      locations: ['Royal London'],
      priorities: { 'Royal London': 'high' },
      supplies: { 'Royal London': 'O- blood (2 units)' },
      constraints: { avoid_zones: [], weather_concern: 'none', time_sensitive: true },
    },
    route: {
      ordered_route: ['Depot', 'Royal London', 'Depot'],
      ordered_routes: { Drone1: ['Depot', 'Royal London', 'Depot'] },
      total_distance: 8400,
      estimated_time: 560,
      battery_usage: 42,
      no_fly_violations: [],
    },
  },

  // ── Demo 2: 3-Drone Fleet Dispatch ────────────────────────────────
  {
    id: 'fleet-dispatch',
    title: '3-Drone Fleet Dispatch',
    subtitle: '3 drones, 3 hospitals — simultaneous delivery blitz',
    request: 'Fleet dispatch: O-negative blood to Royal London urgently, surgical kit to Homerton, and insulin to Newham General. Deploy all 3 drones simultaneously.',
    icon: 'route',
    color: '#00daf3',
    accentBorder: 'rgba(0,218,243,0.3)',
    estMinutes: 12,
    stops: 3,
    fleetMode: true,
    task: {
      locations: ['Royal London', 'Homerton', 'Newham General'],
      priorities: { 'Royal London': 'high', 'Homerton': 'normal', 'Newham General': 'normal' },
      supplies: { 'Royal London': 'O- blood (2 units)', 'Homerton': 'surgical_kit', 'Newham General': 'insulin' },
      constraints: { avoid_zones: [], weather_concern: 'none', time_sensitive: true },
    },
    route: {
      ordered_route: ['Depot', 'Royal London', 'Homerton', 'Newham General', 'Depot'],
      ordered_routes: {
        'drone-1': ['Depot', 'Royal London', 'Depot'],
        'drone-2': ['Depot', 'Homerton', 'Depot'],
        'drone-3': ['Depot', 'Newham General', 'Depot'],
      },
      total_distance: 28400,
      estimated_time: 560,
      battery_usage: 48,
      no_fly_violations: [],
    },
    fleetRoutes: {
      'drone-1': {
        ordered_route: ['Depot', 'Royal London', 'Depot'],
        total_distance: 8400,
        estimated_time: 560,
        battery_usage: 42,
      },
      'drone-2': {
        ordered_route: ['Depot', 'Homerton', 'Depot'],
        total_distance: 9800,
        estimated_time: 520,
        battery_usage: 38,
      },
      'drone-3': {
        ordered_route: ['Depot', 'Newham General', 'Depot'],
        total_distance: 10200,
        estimated_time: 540,
        battery_usage: 44,
      },
    },
  },

  // ── Demo 3: 2-Drone Split Delivery ────────────────────────────────
  {
    id: 'dual-dispatch',
    title: '2-Drone Split Delivery',
    subtitle: '2 drones split urgent blood & vaccine — parallel routes',
    request: 'Split delivery: O-negative blood to Royal London urgently, and a vaccine kit to Newham General. Deploy 2 drones simultaneously.',
    icon: 'zap',
    color: '#4ade80',
    accentBorder: 'rgba(74,222,128,0.3)',
    estMinutes: 10,
    stops: 2,
    fleetMode: true,
    task: {
      locations: ['Royal London', 'Newham General'],
      priorities: { 'Royal London': 'high', 'Newham General': 'normal' },
      supplies: { 'Royal London': 'O- blood (2 units)', 'Newham General': 'vaccine_kit' },
      constraints: { avoid_zones: [], weather_concern: 'none', time_sensitive: true },
    },
    route: {
      ordered_route: ['Depot', 'Royal London', 'Newham General', 'Depot'],
      ordered_routes: {
        'drone-1': ['Depot', 'Royal London', 'Depot'],
        'drone-2': ['Depot', 'Newham General', 'Depot'],
      },
      total_distance: 18600,
      estimated_time: 560,
      battery_usage: 43,
      no_fly_violations: [],
    },
    fleetRoutes: {
      'drone-1': {
        ordered_route: ['Depot', 'Royal London', 'Depot'],
        total_distance: 8400,
        estimated_time: 560,
        battery_usage: 42,
      },
      'drone-2': {
        ordered_route: ['Depot', 'Newham General', 'Depot'],
        total_distance: 10200,
        estimated_time: 540,
        battery_usage: 44,
      },
    },
  },

  // ── Demo 4: Dynamic Emergency Reroute ─────────────────────────────
  {
    id: 'dynamic-reroute',
    title: 'Dynamic Reroute',
    subtitle: 'Routine delivery interrupted by P1 emergency — live replanning',
    request: 'Deliver a vaccine kit to Newham General Hospital. Standard priority, no rush.',
    icon: 'zap',
    color: '#ffb020',
    accentBorder: 'rgba(255,176,32,0.3)',
    estMinutes: 13,
    stops: 2,
    task: {
      locations: ['Newham General'],
      priorities: { 'Newham General': 'normal' },
      supplies: { 'Newham General': 'vaccine_kit' },
      constraints: { avoid_zones: [], weather_concern: 'none', time_sensitive: false },
    },
    route: {
      ordered_route: ['Depot', 'Newham General', 'Depot'],
      ordered_routes: { Drone1: ['Depot', 'Newham General', 'Depot'] },
      total_distance: 12200,
      estimated_time: 640,
      battery_usage: 38,
      no_fly_violations: [],
    },
    reroute: {
      delayMs: 12000,
      newRoute: {
        ordered_route: ['Depot', 'Homerton', 'Newham General', 'Depot'],
        ordered_routes: { Drone1: ['Depot', 'Homerton', 'Newham General', 'Depot'] },
        total_distance: 22800,
        estimated_time: 780,
        battery_usage: 58,
        no_fly_violations: [],
      },
      rerouteWaypoints: [
        { lat: 51.5468, lon: -0.0456, name: 'Homerton' },
        { lat: 51.5155, lon: 0.0285, name: 'Newham General' },
        { lat: 51.5074, lon: -0.1278, name: 'Depot' },
      ],
      emergencyLocation: 'Homerton',
      emergencySupply: 'O- blood (emergency)',
    },
  },
];

// ---------------------------------------------------------------------------
// Fleet Management Demo Data
// ---------------------------------------------------------------------------
export const DEMO_FLEET = {
  drones: [
    { id: 'Alpha', status: 'idle', battery: 94, current_location: 'Depot', speed: 0, altitude: 0, completed_missions: 47, failed_missions: 2, last_maintenance: '2026-03-28', next_maintenance: '2026-04-18', health_score: 92 },
    { id: 'Beta', status: 'en_route', battery: 67, current_location: 'Royal London', speed: 14.2, altitude: 78, completed_missions: 33, failed_missions: 1, last_maintenance: '2026-03-25', next_maintenance: '2026-04-15', health_score: 85 },
    { id: 'Gamma', status: 'idle', battery: 12, current_location: 'Homerton', speed: 0, altitude: 0, completed_missions: 28, failed_missions: 3, last_maintenance: '2026-03-15', next_maintenance: '2026-04-05', health_score: 41 },
  ],
  summary: { total: 3, available: 1, active: 1, offline: 1, avg_battery: 57.7 },
} as const;

// ---------------------------------------------------------------------------
// Autonomous Flight Decision Demo
// ---------------------------------------------------------------------------
export const DEMO_AUTONOMOUS_DECISION = {
  trigger: 'weather_alert',
  context: {
    battery_pct: 62,
    wind_speed_ms: 11.3,
    current_waypoint: 'Clinic B',
    next_waypoint: 'Royal London',
    remaining_stops: 2,
    payload_priority: 'P1_LIFE_CRITICAL',
  },
  ai_decision: {
    action: 'reroute',
    reasoning: 'Wind speed 11.3 m/s approaching max threshold (12 m/s). Southern corridor provides 40% wind reduction with only +2.3 km detour. P1 payload (blood) must be delivered — rerouting preferred over abort.',
    confidence: 0.94,
    speed_adjustment: 0.85,
    risk_assessment: 'medium',
    alternatives: [
      { action: 'continue', risk: 'high', reasoning: 'Direct path through storm — 23% abort probability' },
      { action: 'reroute', risk: 'medium', reasoning: 'Southern corridor — +3 min, safe delivery' },
      { action: 'hold_position', risk: 'low', reasoning: 'Hover and wait for storm to pass — unknown delay' },
    ],
    chosen: 'reroute',
  },
} as const;

// ---------------------------------------------------------------------------
// Predictive Maintenance Alerts Demo
// ---------------------------------------------------------------------------
export const DEMO_MAINTENANCE_ALERTS = [
  { drone_id: 'Gamma', alert: 'Battery degradation trend detected', risk_score: 78, confidence: 0.87, expected_drain_rate: 0.08, actual_drain_rate: 0.14, recommendation: 'Schedule battery replacement within 3 days', days_until_service: 3 },
  { drone_id: 'Beta', alert: 'Motor #3 vibration anomaly', risk_score: 45, confidence: 0.72, recommendation: 'Monitor — schedule inspection within 10 days', days_until_service: 10 },
  { drone_id: 'Alpha', alert: 'All systems nominal', risk_score: 8, confidence: 0.95, recommendation: 'No action required', days_until_service: 20 },
] as const;

// ---------------------------------------------------------------------------
// Demand Forecast Demo (7-day)
// ---------------------------------------------------------------------------
export const DEMO_DEMAND_FORECAST = {
  facility: 'Royal London',
  generated_at: '2026-04-05T10:00:00Z',
  forecast: [
    { date: '2026-04-06', predicted_deliveries: 4, supplies: { blood_pack: 2, insulin: 1, surgical_kit: 1 }, confidence_low: 2, confidence_high: 7 },
    { date: '2026-04-07', predicted_deliveries: 6, supplies: { blood_pack: 3, defibrillator: 1, vaccine_kit: 2 }, confidence_low: 3, confidence_high: 10 },
    { date: '2026-04-08', predicted_deliveries: 3, supplies: { blood_pack: 1, insulin: 1, medication: 1 }, confidence_low: 1, confidence_high: 5 },
    { date: '2026-04-09', predicted_deliveries: 5, supplies: { blood_pack: 2, surgical_kit: 2, first_aid: 1 }, confidence_low: 3, confidence_high: 8 },
    { date: '2026-04-10', predicted_deliveries: 7, supplies: { blood_pack: 3, defibrillator: 1, vaccine_kit: 2, insulin: 1 }, confidence_low: 4, confidence_high: 11 },
    { date: '2026-04-11', predicted_deliveries: 4, supplies: { blood_pack: 2, medication: 1, first_aid: 1 }, confidence_low: 2, confidence_high: 7 },
    { date: '2026-04-12', predicted_deliveries: 5, supplies: { blood_pack: 2, surgical_kit: 1, insulin: 1, vaccine_kit: 1 }, confidence_low: 3, confidence_high: 8 },
  ],
  trend: 'stable',
  peak_day: 'Friday',
  top_supply: 'blood_pack',
} as const;

// ---------------------------------------------------------------------------
// Telemetry Heatmap Demo Data
// ---------------------------------------------------------------------------
export const DEMO_TELEMETRY_HEATMAP = [
  { lat: 51.5074, lon: -0.1278, weight: 35 },  // Depot (highest — home base)
  { lat: 51.5100, lon: -0.1200, weight: 22 },  // Approach corridor
  { lat: 51.5185, lon: -0.0590, weight: 28 },  // Royal London (frequent destination)
  { lat: 51.5468, lon: -0.0456, weight: 18 },  // Homerton
  { lat: 51.5155, lon: 0.0285, weight: 14 },   // Newham General
  { lat: 51.5690, lon: 0.0066, weight: 10 },   // Whipps Cross
  { lat: 51.5124, lon: -0.1200, weight: 12 },  // Clinic A
  { lat: 51.5174, lon: -0.1350, weight: 8 },   // Clinic B
  { lat: 51.5130, lon: -0.0900, weight: 15 },  // Common transit corridor
  { lat: 51.5200, lon: -0.0700, weight: 11 },  // Eastern approach
] as const;

// ---------------------------------------------------------------------------
// Waypoint ETAs Demo
// ---------------------------------------------------------------------------
export const DEMO_WAYPOINT_ETAS = [
  { location: 'Depot', eta_seconds: 0, distance_m: 0, status: 'completed' },
  { location: 'Royal London', eta_seconds: 420, distance_m: 8400, status: 'in_progress' },
  { location: 'Depot', eta_seconds: 840, distance_m: 16800, status: 'pending' },
] as const;

// ---------------------------------------------------------------------------
// Public Status Page Demo
// ---------------------------------------------------------------------------
export const DEMO_PUBLIC_STATUS = {
  active_drones: 3,
  deliveries_today: 12,
  deliveries_this_week: 67,
  avg_delivery_time_min: 14.2,
  on_time_rate: 97.3,
  facilities_served: 7,
  total_distance_km: 284.5,
  lives_impacted: 42,
  recent_events: [
    { text: 'O- blood delivered to Royal London', time: '6 min ago', severity: 'success' },
    { text: 'Drone Alpha rerouted — storm corridor avoidance', time: '12 min ago', severity: 'warning' },
    { text: 'Insulin delivery to Homerton confirmed', time: '18 min ago', severity: 'success' },
    { text: 'Surgical kit dispatched to Newham General', time: '25 min ago', severity: 'info' },
    { text: 'Fleet battery check — all nominal', time: '30 min ago', severity: 'info' },
    { text: 'Defibrillator emergency delivery completed', time: '45 min ago', severity: 'success' },
  ],
} as const;

// ---------------------------------------------------------------------------
// Multi-Facility Resupply Demo (second demo scenario)
// ---------------------------------------------------------------------------
export const DEMO_MULTI_FACILITY = {
  request: "Resupply run: 2 blood packs to Royal London, insulin to Homerton, and a surgical kit to Newham General. Use both drones, highest priority on the blood.",
  task: {
    locations: ['Royal London', 'Homerton', 'Newham General'],
    priorities: { 'Royal London': 'high', 'Homerton': 'normal', 'Newham General': 'normal' },
    supplies: { 'Royal London': 'blood_pack x2', 'Homerton': 'insulin', 'Newham General': 'surgical_kit' },
    constraints: { avoid_zones: [] as readonly string[], weather_concern: 'none', time_sensitive: true },
  },
  routes: {
    Drone1: ['Depot', 'Royal London', 'Depot'],
    Drone2: ['Depot', 'Homerton', 'Newham General', 'Depot'],
  },
  total_distance: 24600,
  estimated_time: 920,
  battery_usage: { Drone1: 42, Drone2: 58 },
} as const;
