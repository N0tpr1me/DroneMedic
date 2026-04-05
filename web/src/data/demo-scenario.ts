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
