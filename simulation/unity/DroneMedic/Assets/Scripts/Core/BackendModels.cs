using System;
using System.Collections.Generic;

namespace DroneMedic
{
    // ── Route Planning ──────────────────────────────────────────────────

    [Serializable]
    public class ComputeRouteRequest
    {
        public string[] locations;
        public Dictionary<string, string> priorities;
        public int num_drones = 1;
    }

    [Serializable]
    public class RecomputeRouteRequest
    {
        public string current_location;
        public string[] remaining_locations;
        public string[] new_locations;
        public Dictionary<string, string> priorities;
    }

    [Serializable]
    public class RouteResponse
    {
        public string[] ordered_route;
        public Dictionary<string, string[]> ordered_routes;
        public float total_distance;
        public float estimated_time;
        public float battery_usage;
    }

    [Serializable]
    public class RouteResponseWrapper
    {
        public RouteResponse route;
    }

    // ── Weather ─────────────────────────────────────────────────────────

    [Serializable]
    public class SimulateWeatherRequest
    {
        public string event_type;
        public string[] affected_locations;
    }

    // ── Mission Controller ──────────────────────────────────────────────

    [Serializable]
    public class PrepareMissionRequest
    {
        public string[] route;
        public float payload_kg = 2.5f;
        public Dictionary<string, string> supplies;
        public Dictionary<string, string> priorities;
        public float headwind_ms;
        public float crosswind_ms;
        public float precipitation_mmh;
        public float temperature_c = 18f;
        public string turbulence = "calm";
    }

    [Serializable]
    public class PrepareMissionResponse
    {
        public string decision;
        public string battery_state;
        public List<CheckEntry> checks;
        public List<CheckEntry> failed_checks;
        public List<string> recommendations;
        public EnergyBudgetData energy_budget;
    }

    [Serializable]
    public class CheckEntry
    {
        public int rule;
        public string name;
        public bool passed;
        public string detail;
    }

    [Serializable]
    public class EnergyBudgetData
    {
        public float cruise_wh;
        public float hover_wh;
        public float climb_wh;
        public float descent_wh;
        public float total_wh;
        public float available_wh;
        public float reserve_wh;
        public float ratio;
        public bool feasible;
        public float flight_time_s;
        public float max_range_km;
    }

    [Serializable]
    public class ControlTickRequest
    {
        public double lat = 51.5074;
        public double lon = -0.1278;
        public float battery_wh = 544f;
        public float battery_pct = 100f;
        public string current_location = "Depot";
        public float headwind_ms;
        public float crosswind_ms;
        public float precipitation_mmh;
        public float temperature_c = 18f;
        public string turbulence = "calm";
    }

    [Serializable]
    public class ControlTickResponse
    {
        public string action;           // CONTINUE, CONSERVE, REROUTE, RETURN_TO_BASE, DIVERT, ABORT
        public string battery_state;    // GREEN, AMBER, RED
        public float battery_wh;
        public float battery_pct;
        public float energy_ratio;
        public float energy_needed_wh;
        public float divert_energy_wh;
        public string divert_location;
        public float cruise_speed_ms;
        public string[] remaining_route;
        public string[] dropped_stops;
        public string[] reasons;
        public float weather_penalty;
        public bool weather_flyable;
    }

    [Serializable]
    public class MissionStateResponse
    {
        public string mission_id;
        public string status;
        public string battery_state;
        public string action;
        public float battery_wh;
        public float battery_pct;
        public string current_location;
        public string[] remaining_route;
        public string[] visited;
        public int reroute_count;
        public string[] stops_dropped;
        public float payload_kg;
        public bool is_flying;
    }

    [Serializable]
    public class MissionSummary
    {
        public string mission_id;
        public string status;
        public string[] planned_route;
        public string[] visited;
        public string[] stops_dropped;
        public float battery_final_wh;
        public float battery_final_pct;
        public int reroute_count;
        public int reroute_successes;
        public int emergency_events;
        public float elapsed_s;
    }

    // ── Metrics ─────────────────────────────────────────────────────────

    [Serializable]
    public class MetricsRequest
    {
        public List<Dictionary<string, object>> flight_log;
        public Dictionary<string, object> optimized_route;
        public string[] locations;
        public int reroute_count;
        public int reroute_successes;
        public int obstacles_avoided;
        public int obstacles_total;
    }

    [Serializable]
    public class MetricsResponse
    {
        public float delivery_time_reduction;
        public float distance_reduction;
        public int throughput;
        public float reroute_success_rate;
        public float total_distance_optimized;
        public float total_distance_naive;
        public float battery_used;
        public float robustness_score;
        public float actual_flight_time_seconds;
        public float estimated_time_seconds;
    }

    [Serializable]
    public class MetricsResponseWrapper
    {
        public MetricsResponse metrics;
    }

    // ── Triage ──────────────────────────────────────────────────────────

    [Serializable]
    public class TriageRequest
    {
        public string[] route;
        public Dictionary<string, string> supplies;
        public Dictionary<string, string> priorities;
        public float energy_available_wh = 544f;
        public float payload_kg = 2.5f;
        public float headwind_ms;
    }

    [Serializable]
    public class TriageResponse
    {
        public string[] triaged_route;
        public List<DroppedStop> dropped_stops;
        public string[] kept_stops;
        public float ratio;
        public string battery_state;
        public float energy_needed_wh;
        public float energy_available_wh;
    }

    [Serializable]
    public class DroppedStop
    {
        public string stop;
        public string priority;
        public string supply;
    }
}
