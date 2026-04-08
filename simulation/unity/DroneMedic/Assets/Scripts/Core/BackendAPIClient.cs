using System;
using System.Collections;
using System.Collections.Generic;
using System.Text;
using UnityEngine;
using UnityEngine.Networking;
using Newtonsoft.Json;

namespace DroneMedic
{
    public class BackendAPIClient : MonoBehaviour
    {
        public static BackendAPIClient Instance { get; private set; }

        [Header("Backend")]
        [SerializeField] private string baseUrl = "http://localhost:8000";
        [SerializeField] private float timeoutSeconds = 5f;

        [Header("Debug")]
        [SerializeField] private bool logRequests = true;

        public bool IsBackendReachable { get; private set; }

        private void Awake()
        {
            if (Instance != null && Instance != this)
            {
                Destroy(gameObject);
                return;
            }
            Instance = this;
        }

        private void Start()
        {
            StartCoroutine(CheckBackendHealth());
        }

        private void OnDestroy()
        {
            if (Instance == this) Instance = null;
        }

        // ── Health Check ───────────────────────────────────────────────

        private IEnumerator CheckBackendHealth()
        {
            using var req = UnityWebRequest.Get($"{baseUrl}/api/health");
            req.timeout = 3;
            yield return req.SendWebRequest();
            IsBackendReachable = req.result == UnityWebRequest.Result.Success;
            Log(IsBackendReachable
                ? "Backend connected"
                : $"Backend unreachable — using fallback mode ({req.error})");
        }

        // ── Route Planning ─────────────────────────────────────────────

        public IEnumerator ComputeRoute(
            string[] locations,
            Dictionary<string, string> priorities,
            int numDrones,
            Action<RouteResponse> onSuccess,
            Action<string> onError = null)
        {
            var body = new ComputeRouteRequest
            {
                locations = locations,
                priorities = priorities ?? new Dictionary<string, string>(),
                num_drones = numDrones
            };

            yield return Post("/api/compute-route", body, (string json) =>
            {
                var wrapper = JsonConvert.DeserializeObject<RouteResponseWrapper>(json);
                onSuccess?.Invoke(wrapper?.route);
            }, onError);
        }

        public IEnumerator RecomputeRoute(
            string currentLocation,
            string[] remaining,
            string[] newLocations,
            Dictionary<string, string> priorities,
            Action<RouteResponse> onSuccess,
            Action<string> onError = null)
        {
            var body = new RecomputeRouteRequest
            {
                current_location = currentLocation,
                remaining_locations = remaining,
                new_locations = newLocations,
                priorities = priorities ?? new Dictionary<string, string>()
            };

            yield return Post("/api/recompute-route", body, (string json) =>
            {
                var wrapper = JsonConvert.DeserializeObject<RouteResponseWrapper>(json);
                onSuccess?.Invoke(wrapper?.route);
            }, onError);
        }

        // ── Weather ────────────────────────────────────────────────────

        public IEnumerator SimulateWeather(
            string eventType,
            string[] affectedLocations,
            Action<string> onSuccess = null,
            Action<string> onError = null)
        {
            var body = new SimulateWeatherRequest
            {
                event_type = eventType,
                affected_locations = affectedLocations
            };

            yield return Post("/api/simulate-weather", body, onSuccess, onError);
        }

        public IEnumerator ClearWeather(Action<string> onSuccess = null)
        {
            yield return Post("/api/clear-weather", new { }, onSuccess);
        }

        // ── Mission Controller ─────────────────────────────────────────

        public IEnumerator PrepareMission(
            string[] route,
            float payloadKg,
            Dictionary<string, string> supplies,
            Dictionary<string, string> priorities,
            float headwindMs = 0f,
            float precipitationMmh = 0f,
            float temperatureC = 18f,
            Action<PrepareMissionResponse> onSuccess = null,
            Action<string> onError = null)
        {
            var body = new PrepareMissionRequest
            {
                route = route,
                payload_kg = payloadKg,
                supplies = supplies ?? new Dictionary<string, string>(),
                priorities = priorities ?? new Dictionary<string, string>(),
                headwind_ms = headwindMs,
                precipitation_mmh = precipitationMmh,
                temperature_c = temperatureC
            };

            yield return Post("/api/mission/prepare", body, (string json) =>
            {
                var result = JsonConvert.DeserializeObject<PrepareMissionResponse>(json);
                onSuccess?.Invoke(result);
            }, onError);
        }

        public IEnumerator LaunchMission(
            Action<string> onSuccess = null,
            Action<string> onError = null)
        {
            yield return Post("/api/mission/launch", new { }, onSuccess, onError);
        }

        public IEnumerator ControlTick(
            double lat, double lon,
            float batteryWh, float batteryPct,
            string currentLocation,
            float headwindMs = 0f,
            float precipitationMmh = 0f,
            float temperatureC = 18f,
            Action<ControlTickResponse> onSuccess = null,
            Action<string> onError = null)
        {
            var body = new ControlTickRequest
            {
                lat = lat,
                lon = lon,
                battery_wh = batteryWh,
                battery_pct = batteryPct,
                current_location = currentLocation,
                headwind_ms = headwindMs,
                precipitation_mmh = precipitationMmh,
                temperature_c = temperatureC
            };

            yield return Post("/api/mission/control-tick", body, (string json) =>
            {
                var result = JsonConvert.DeserializeObject<ControlTickResponse>(json);
                onSuccess?.Invoke(result);
            }, onError);
        }

        public IEnumerator MarkWaypoint(
            string location,
            Action<MissionStateResponse> onSuccess = null,
            Action<string> onError = null)
        {
            yield return Post($"/api/mission/waypoint/{location}", new { }, (string json) =>
            {
                var result = JsonConvert.DeserializeObject<MissionStateResponse>(json);
                onSuccess?.Invoke(result);
            }, onError);
        }

        public IEnumerator CompleteMission(
            Action<MissionSummary> onSuccess = null,
            Action<string> onError = null)
        {
            yield return Post("/api/mission/complete", new { }, (string json) =>
            {
                var result = JsonConvert.DeserializeObject<MissionSummary>(json);
                onSuccess?.Invoke(result);
            }, onError);
        }

        // ── Physics ────────────────────────────────────────────────────

        public IEnumerator PreflightCheck(
            string[] route,
            float payloadKg,
            float headwindMs = 0f,
            float precipitationMmh = 0f,
            float temperatureC = 18f,
            Action<PrepareMissionResponse> onSuccess = null,
            Action<string> onError = null)
        {
            var body = new
            {
                route,
                payload_kg = payloadKg,
                headwind_ms = headwindMs,
                precipitation_mmh = precipitationMmh,
                temperature_c = temperatureC
            };

            yield return Post("/api/physics/preflight", body, (string json) =>
            {
                var result = JsonConvert.DeserializeObject<PrepareMissionResponse>(json);
                onSuccess?.Invoke(result);
            }, onError);
        }

        public IEnumerator TriageRoute(
            string[] route,
            Dictionary<string, string> supplies,
            Dictionary<string, string> priorities,
            float energyAvailableWh,
            float payloadKg = 2.5f,
            Action<TriageResponse> onSuccess = null,
            Action<string> onError = null)
        {
            var body = new TriageRequest
            {
                route = route,
                supplies = supplies ?? new Dictionary<string, string>(),
                priorities = priorities ?? new Dictionary<string, string>(),
                energy_available_wh = energyAvailableWh,
                payload_kg = payloadKg
            };

            yield return Post("/api/physics/triage", body, (string json) =>
            {
                var result = JsonConvert.DeserializeObject<TriageResponse>(json);
                onSuccess?.Invoke(result);
            }, onError);
        }

        // ── Metrics ────────────────────────────────────────────────────

        public IEnumerator ComputeMetrics(
            MetricsRequest metricsReq,
            Action<MetricsResponse> onSuccess = null,
            Action<string> onError = null)
        {
            yield return Post("/api/metrics", metricsReq, (string json) =>
            {
                var wrapper = JsonConvert.DeserializeObject<MetricsResponseWrapper>(json);
                onSuccess?.Invoke(wrapper?.metrics);
            }, onError);
        }

        // ── HTTP Helpers ───────────────────────────────────────────────

        private IEnumerator Post(string endpoint, object body,
            Action<string> onSuccess, Action<string> onError = null)
        {
            string json = JsonConvert.SerializeObject(body);
            string url = $"{baseUrl}{endpoint}";

            if (logRequests)
                Log($"POST {endpoint}");

            using var req = new UnityWebRequest(url, "POST");
            req.uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(json));
            req.downloadHandler = new DownloadHandlerBuffer();
            req.SetRequestHeader("Content-Type", "application/json");
            req.timeout = (int)timeoutSeconds;

            yield return req.SendWebRequest();

            if (req.result != UnityWebRequest.Result.Success)
            {
                string error = $"{endpoint} failed: {req.error} — {req.downloadHandler?.text}";
                if (logRequests) Log(error);
                onError?.Invoke(error);
                yield break;
            }

            string responseText = req.downloadHandler.text;
            if (logRequests)
                Log($"← {endpoint} OK ({responseText.Length} chars)");

            onSuccess?.Invoke(responseText);
        }

        private IEnumerator Get(string endpoint,
            Action<string> onSuccess, Action<string> onError = null)
        {
            string url = $"{baseUrl}{endpoint}";

            if (logRequests)
                Log($"GET {endpoint}");

            using var req = UnityWebRequest.Get(url);
            req.timeout = (int)timeoutSeconds;

            yield return req.SendWebRequest();

            if (req.result != UnityWebRequest.Result.Success)
            {
                string error = $"{endpoint} failed: {req.error}";
                if (logRequests) Log(error);
                onError?.Invoke(error);
                yield break;
            }

            onSuccess?.Invoke(req.downloadHandler.text);
        }

        // ── Fallback Routes (when backend is down) ─────────────────────

        public static RouteResponse GetFallbackRoute(string[] locations, int numDrones)
        {
            // Simple sequential route matching current hardcoded demo behavior
            var route = new List<string> { "Depot" };
            route.AddRange(locations);
            route.Add("Depot");

            return new RouteResponse
            {
                ordered_route = route.ToArray(),
                ordered_routes = numDrones > 1
                    ? SplitRouteForDrones(locations, numDrones)
                    : null,
                total_distance = 1200f,
                estimated_time = 300f,
                battery_usage = 10f
            };
        }

        private static Dictionary<string, string[]> SplitRouteForDrones(string[] locations, int numDrones)
        {
            var routes = new Dictionary<string, string[]>();
            int perDrone = Mathf.CeilToInt((float)locations.Length / numDrones);

            for (int i = 0; i < numDrones; i++)
            {
                string droneId = $"Drone{i + 1}";
                var droneRoute = new List<string> { "Depot" };
                int start = i * perDrone;
                int end = Mathf.Min(start + perDrone, locations.Length);
                for (int j = start; j < end; j++)
                    droneRoute.Add(locations[j]);
                droneRoute.Add("Depot");
                routes[droneId] = droneRoute.ToArray();
            }

            return routes;
        }

        private void Log(string message)
        {
            Debug.Log($"[BackendAPI] {message}");
        }
    }
}
