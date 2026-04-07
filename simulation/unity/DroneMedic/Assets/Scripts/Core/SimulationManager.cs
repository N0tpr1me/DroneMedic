using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace DroneMedic
{
    public enum DemoMode
    {
        Basic,
        Weather,
        Obstacle,
        Full,
        MultiDrone,
        PX4Live
    }

    public class SimulationManager : MonoBehaviour
    {
        public static SimulationManager Instance { get; private set; }

        [Header("Configuration")]
        [SerializeField] private DroneConfig config;
        [SerializeField] private DemoMode demoMode = DemoMode.PX4Live;
        [SerializeField] private bool autoStart = true;
        [SerializeField] private GameObject dronePrefab;

        [Header("Map")]
        [SerializeField] private GoogleMaps3DTiles mapTiles;

        [Header("Subsystems")]
        [SerializeField] private FleetController fleetController;
        [SerializeField] private GeofenceManager geofenceManager;
        [SerializeField] private WeatherSystem weatherSystem;
        [SerializeField] private ObstacleDetector obstacleDetector;
        [SerializeField] private ROSBridge rosBridge;
        [SerializeField] private WebSocketBridge wsBridge;
        [SerializeField] private BackendAPIClient apiClient;
        [SerializeField] private PX4TelemetryClient px4Client;

        private readonly List<DroneController> activeDrones = new List<DroneController>();
        private bool isRunning;
        private float telemetryTimer;
        private const float TelemetryInterval = 0.5f;

        // Mission state from backend
        private string currentBatteryState = "GREEN";
        private string currentAction = "CONTINUE";
        private float controlTickTimer;
        private const float ControlTickInterval = 1.0f;

        // Demo task data
        private readonly string[] defaultLocations = { "Clinic A", "Clinic B", "Clinic C" };
        private readonly Dictionary<string, string> defaultPriorities = new() { { "Clinic B", "high" } };
        private readonly Dictionary<string, string> defaultSupplies = new()
        {
            { "Clinic A", "insulin" },
            { "Clinic B", "blood_pack" },
            { "Clinic C", "bandages" }
        };

        public DroneConfig Config => config;
        public DemoMode CurrentDemoMode => demoMode;
        public bool IsRunning => isRunning;
        public IReadOnlyList<DroneController> ActiveDrones => activeDrones;
        public string BatteryState => currentBatteryState;
        public string MissionAction => currentAction;

        private void Awake()
        {
            if (Instance != null && Instance != this)
            {
                Destroy(gameObject);
                return;
            }
            Instance = this;

            if (mapTiles == null)
                mapTiles = FindAnyObjectByType<GoogleMaps3DTiles>();
            if (mapTiles != null && config != null)
                config.SetMapReference(mapTiles);
        }

        private void Start()
        {
            if (apiClient == null)
                apiClient = FindAnyObjectByType<BackendAPIClient>();

            if (wsBridge == null)
                wsBridge = FindAnyObjectByType<WebSocketBridge>();

            if (wsBridge != null)
            {
                wsBridge.OnStartCommand += (mode) =>
                {
                    if (Enum.TryParse<DemoMode>(mode, true, out var parsed))
                        demoMode = parsed;
                    StartSimulation();
                };
                wsBridge.OnStopCommand += StopSimulation;
            }

            if (autoStart)
                StartSimulation();
        }

        private void Update()
        {
            if (!isRunning) return;

            telemetryTimer += Time.deltaTime;
            if (telemetryTimer >= TelemetryInterval)
            {
                telemetryTimer = 0f;
                PublishTelemetry();
            }
        }

        private void OnDestroy()
        {
            if (Instance == this)
                Instance = null;
        }

        // ==== Public API ====

        public void StartSimulation()
        {
            if (isRunning)
            {
                Debug.LogWarning("[SimulationManager] Already running.");
                return;
            }

            isRunning = true;
            currentBatteryState = "GREEN";
            currentAction = "CONTINUE";
            Debug.Log($"[SimulationManager] Starting — mode: {demoMode}");

            if (wsBridge != null)
                wsBridge.BroadcastEvent("mission_started", "", demoMode.ToString());

            switch (demoMode)
            {
                case DemoMode.Basic:      StartCoroutine(RunBackendDemo(enableWeather: false, enableObstacles: false)); break;
                case DemoMode.Weather:    StartCoroutine(RunBackendDemo(enableWeather: true,  enableObstacles: false)); break;
                case DemoMode.Obstacle:   StartCoroutine(RunBackendDemo(enableWeather: false, enableObstacles: true));  break;
                case DemoMode.Full:       StartCoroutine(RunBackendDemo(enableWeather: true,  enableObstacles: true));  break;
                case DemoMode.MultiDrone: StartCoroutine(RunMultiDroneDemo()); break;
                case DemoMode.PX4Live:   StartCoroutine(RunPX4LiveMode()); break;
            }
        }

        public void StopSimulation()
        {
            StopAllCoroutines();
            foreach (var drone in activeDrones)
            {
                if (drone != null) drone.Land();
            }
            isRunning = false;
            Debug.Log("[SimulationManager] Stopped.");
        }

        // ==== Backend-Driven Single Drone Demo ====

        private IEnumerator RunBackendDemo(bool enableWeather, bool enableObstacles)
        {
            DroneController drone = SpawnDrone("Drone1");

            // --- Step 1: Prepare mission via backend ---
            bool preflightDone = false;
            PrepareMissionResponse preflightResult = null;

            if (apiClient != null && apiClient.IsBackendReachable)
            {
                yield return apiClient.PrepareMission(
                    BuildFullRoute(defaultLocations),
                    2.5f,
                    defaultSupplies,
                    defaultPriorities,
                    onSuccess: (result) =>
                    {
                        preflightResult = result;
                        preflightDone = true;
                    },
                    onError: (_) => preflightDone = true
                );
            }
            else
            {
                preflightDone = true;
            }

            if (preflightResult != null)
            {
                currentBatteryState = preflightResult.battery_state ?? "GREEN";
                Debug.Log($"[Preflight] Decision: {preflightResult.decision} | Battery: {currentBatteryState}");

                if (preflightResult.decision == "NO_GO")
                {
                    Debug.LogError("[Preflight] NO_GO — aborting mission");
                    foreach (var check in preflightResult.failed_checks)
                        Debug.LogError($"  FAILED Rule {check.rule}: {check.name} — {check.detail}");
                    BroadcastMissionCompleted();
                    isRunning = false;
                    yield break;
                }

                if (wsBridge != null)
                    wsBridge.BroadcastEvent("preflight_complete", "Drone1", preflightResult.decision);
            }

            // --- Step 2: Compute route via backend ---
            RouteResponse route = null;
            bool routeDone = false;

            if (apiClient != null && apiClient.IsBackendReachable)
            {
                yield return apiClient.ComputeRoute(
                    defaultLocations, defaultPriorities, 1,
                    onSuccess: (r) => { route = r; routeDone = true; },
                    onError: (_) => routeDone = true
                );
            }
            else
            {
                routeDone = true;
            }

            // Fallback if backend unavailable
            if (route == null)
            {
                route = BackendAPIClient.GetFallbackRoute(defaultLocations, 1);
                Debug.Log("[SimulationManager] Using fallback route");
            }

            string[] stops = route.ordered_route;
            Debug.Log($"[Route] {string.Join(" → ", stops)} | Dist: {route.total_distance:F0}m");

            // --- Step 3: Launch mission on backend ---
            if (apiClient != null && apiClient.IsBackendReachable)
                yield return apiClient.LaunchMission();

            // --- Step 4: Load payload and fly ---
            drone.LoadPayload("medical_supplies", 2.5f);
            yield return drone.Takeoff();

            int reroutes = 0;
            int obstacles = 0;
            bool weatherTriggered = false;
            bool obstacleTriggered = false;

            for (int i = 0; i < stops.Length; i++)
            {
                string location = stops[i];
                if (location == "Depot" && i == 0) continue; // skip start depot

                float progress = (float)i / Mathf.Max(stops.Length - 1, 1);

                // --- Weather event at 30% ---
                if (enableWeather && !weatherTriggered && progress >= 0.3f)
                {
                    weatherTriggered = true;
                    Debug.LogWarning("[Demo] Weather event — storm at Clinic B");
                    drone.Pause();

                    if (weatherSystem != null)
                        weatherSystem.SimulateWeatherEvent("storm", new[] { "Clinic B" });

                    if (wsBridge != null)
                        wsBridge.BroadcastEvent("weather_alert", "Drone1", "Clinic B");

                    // Recompute route via backend
                    var remaining = stops.Skip(i).Where(s => s != "Clinic B").ToArray();
                    RouteResponse newRoute = null;

                    if (apiClient != null && apiClient.IsBackendReachable)
                    {
                        yield return apiClient.RecomputeRoute(
                            drone.CurrentLocation, remaining, new string[0], defaultPriorities,
                            onSuccess: (r) => newRoute = r
                        );
                    }

                    if (newRoute != null)
                    {
                        stops = newRoute.ordered_route;
                        i = 0; // restart from new route beginning
                        reroutes++;
                        Debug.Log($"[Reroute] New route: {string.Join(" → ", stops)}");

                        if (wsBridge != null)
                            wsBridge.BroadcastEvent("reroute", "Drone1", "weather");
                    }

                    drone.Resume();
                    if (weatherSystem != null)
                        weatherSystem.ClearWeatherOverrides();

                    continue;
                }

                // --- Obstacle event at 60% ---
                if (enableObstacles && !obstacleTriggered && progress >= 0.6f)
                {
                    obstacleTriggered = true;
                    var obstacle = obstacleDetector?.CheckForObstacle(drone.transform.position, progress);

                    if (obstacle.HasValue)
                    {
                        var obs = obstacle.Value;
                        Debug.LogWarning($"[Demo] Obstacle: {obs.type} near {obs.nearLocation}");
                        drone.Pause();
                        obstacles++;

                        if (wsBridge != null)
                            wsBridge.BroadcastEvent("obstacle_detected", "Drone1", obs.nearLocation);

                        var avoidLocations = obstacleDetector.GetAvoidanceLocations(obs);
                        var remaining = stops.Skip(i).Where(s => !avoidLocations.Contains(s)).ToArray();
                        RouteResponse newRoute = null;

                        if (apiClient != null && apiClient.IsBackendReachable)
                        {
                            yield return apiClient.RecomputeRoute(
                                drone.CurrentLocation, remaining, new string[0], defaultPriorities,
                                onSuccess: (r) => newRoute = r
                            );
                        }

                        if (newRoute != null)
                        {
                            stops = newRoute.ordered_route;
                            i = 0;
                            reroutes++;
                            Debug.Log($"[Reroute] Obstacle avoidance: {string.Join(" → ", stops)}");
                        }

                        drone.Resume();
                        continue;
                    }
                }

                // --- Fly to waypoint ---
                yield return drone.MoveToLocation(location);

                // Mark waypoint on backend
                if (apiClient != null && apiClient.IsBackendReachable)
                    yield return apiClient.MarkWaypoint(location);

                // Release payload at delivery stops
                if (location != "Depot" && drone.PayloadWeight > 0)
                {
                    drone.ReleasePayload();
                    Debug.Log($"[Delivery] {defaultSupplies.GetValueOrDefault(location, "supplies")} delivered to {location}");
                }

                // --- Control tick (physics/safety check) ---
                if (apiClient != null && apiClient.IsBackendReachable)
                {
                    yield return RunControlTick(drone);
                }
            }

            // --- Step 5: Land ---
            yield return drone.Land();

            // --- Step 6: Complete mission and get metrics ---
            if (apiClient != null && apiClient.IsBackendReachable)
            {
                yield return apiClient.CompleteMission(onSuccess: (summary) =>
                {
                    Debug.Log($"[Mission] Complete — visited: {string.Join(", ", summary.visited ?? new string[0])}");
                    Debug.Log($"[Mission] Reroutes: {summary.reroute_count}, Dropped: {string.Join(", ", summary.stops_dropped ?? new string[0])}");
                });
            }

            Debug.Log($"[Demo] Complete — reroutes: {reroutes}, obstacles: {obstacles}");
            BroadcastMissionCompleted();
            isRunning = false;
        }

        // ==== Multi-Drone Demo ====

        private IEnumerator RunMultiDroneDemo()
        {
            Debug.Log("[MultiDroneDemo] Computing routes for 2 drones...");

            string[] allLocations = { "Clinic A", "Clinic B", "Clinic C", "Clinic D" };
            RouteResponse route = null;
            bool done = false;

            if (apiClient != null && apiClient.IsBackendReachable)
            {
                yield return apiClient.ComputeRoute(
                    allLocations, defaultPriorities, 2,
                    onSuccess: (r) => { route = r; done = true; },
                    onError: (_) => done = true
                );
            }
            else
            {
                done = true;
            }

            if (route == null)
                route = BackendAPIClient.GetFallbackRoute(allLocations, 2);

            // Spawn drones
            DroneController drone1 = SpawnDrone("Drone1");
            DroneController drone2 = SpawnDrone("Drone2", new Vector3(3f, 0f, 0f));

            // Get per-drone routes
            string[] route1, route2;
            if (route.ordered_routes != null && route.ordered_routes.Count >= 2)
            {
                route.ordered_routes.TryGetValue("Drone1", out route1);
                route.ordered_routes.TryGetValue("Drone2", out route2);
                route1 ??= new[] { "Depot", "Clinic A", "Clinic B", "Depot" };
                route2 ??= new[] { "Depot", "Clinic C", "Clinic D", "Depot" };
            }
            else
            {
                route1 = new[] { "Depot", "Clinic A", "Clinic B", "Depot" };
                route2 = new[] { "Depot", "Clinic C", "Clinic D", "Depot" };
            }

            Debug.Log($"[Drone1] Route: {string.Join(" → ", route1)}");
            Debug.Log($"[Drone2] Route: {string.Join(" → ", route2)}");

            // Takeoff both
            yield return drone1.Takeoff();
            yield return drone2.Takeoff();

            // Fly routes in parallel
            Coroutine r1 = StartCoroutine(FlyRoute(drone1, route1));
            Coroutine r2 = StartCoroutine(FlyRoute(drone2, route2));
            yield return r1;
            yield return r2;

            // Land both
            yield return drone1.Land();
            yield return drone2.Land();

            Debug.Log("[MultiDroneDemo] Complete.");
            BroadcastMissionCompleted();
            isRunning = false;
        }

        private IEnumerator FlyRoute(DroneController drone, string[] locations)
        {
            foreach (string loc in locations)
            {
                if (loc == "Depot" && loc == locations[0]) continue;
                yield return drone.MoveToLocation(loc);
            }
        }

        // ==== Control Tick (Physics/Safety) ====

        private IEnumerator RunControlTick(DroneController drone)
        {
            ControlTickResponse tickResult = null;

            // Convert Unity position back to geo for backend
            double lat = 51.5074, lon = -0.1278; // fallback
            if (config != null)
            {
                var depot = config.GetLocation("Depot");
                if (depot != null)
                {
                    Vector3 pos = drone.transform.position;
                    double cosLat = System.Math.Cos(depot.latitude * System.Math.PI / 180.0);
                    lon = depot.longitude + (pos.x / (111320.0 * cosLat));
                    lat = depot.latitude + (pos.z / 111320.0);
                }
            }

            yield return apiClient.ControlTick(
                lat, lon,
                drone.BatteryWh, drone.Battery,
                drone.CurrentLocation,
                onSuccess: (result) => tickResult = result
            );

            if (tickResult == null) yield break;

            currentBatteryState = tickResult.battery_state ?? "GREEN";
            currentAction = tickResult.action ?? "CONTINUE";

            // Apply speed from backend policy
            if (tickResult.cruise_speed_ms > 0 && config != null && config.droneVelocity > 0)
                drone.SpeedMultiplier = tickResult.cruise_speed_ms / config.droneVelocity;

            // Broadcast safety status
            if (wsBridge != null)
                wsBridge.BroadcastEvent($"safety_{currentBatteryState.ToLower()}", drone.name, currentAction);

            // Handle emergency actions
            switch (tickResult.action)
            {
                case "DIVERT":
                    Debug.LogError($"[Safety] DIVERT to {tickResult.divert_location}");
                    if (tickResult.divert_location != null)
                        yield return drone.MoveToLocation(tickResult.divert_location);
                    yield return drone.Land();
                    break;

                case "ABORT":
                    Debug.LogError("[Safety] ABORT — immediate landing");
                    yield return drone.Land();
                    break;

                case "RETURN_TO_BASE":
                    Debug.LogWarning("[Safety] RED — returning to base");
                    yield return drone.MoveToLocation("Depot");
                    yield return drone.Land();
                    break;

                case "CONSERVE":
                    if (tickResult.reasons != null)
                    {
                        foreach (var reason in tickResult.reasons)
                            Debug.LogWarning($"[Safety] {reason}");
                    }
                    break;
            }
        }

        // ==== PX4 Live Mode ====

        private IEnumerator RunPX4LiveMode()
        {
            // Find or validate PX4 client
            if (px4Client == null)
                px4Client = FindAnyObjectByType<PX4TelemetryClient>();

            if (px4Client == null)
            {
                Debug.LogError("[SimulationManager] PX4TelemetryClient not found — cannot run PX4Live mode.");
                isRunning = false;
                yield break;
            }

            Debug.Log($"[PX4Live] Connecting to telemetry bridge at {px4Client.BridgeUrl}");

            // Wait for connection (up to 10 seconds)
            float timeout = 10f;
            float waited = 0f;
            while (!px4Client.IsConnected && waited < timeout)
            {
                waited += Time.deltaTime;
                yield return null;
            }

            if (!px4Client.IsConnected)
            {
                Debug.LogWarning("[PX4Live] Telemetry bridge not connected — will keep trying in background.");
            }

            // Wait for Cesium georeference to be ready before spawning
            if (mapTiles != null)
            {
                Debug.Log("[PX4Live] Waiting for Cesium georeference...");
                yield return mapTiles.WaitForReady();
                Debug.Log("[PX4Live] Cesium ready.");
            }
            else
            {
                // No Cesium — wait 1 frame for scene setup
                yield return null;
            }

            // Spawn drone at depot
            DroneController drone = SpawnDrone("PX4Drone");
            drone.IsExternallyDriven = true;

            Debug.Log("[PX4Live] Drone spawned — listening for PX4 telemetry.");

            // Set up camera to follow the drone
            var cam = Camera.main;
            if (cam != null)
            {
                var droneCam = cam.GetComponent<DroneCamera>();
                if (droneCam == null)
                    droneCam = cam.gameObject.AddComponent<DroneCamera>();
                droneCam.SetTarget(drone.transform);
                droneCam.SetDroneList(new[] { drone.transform });
                Debug.Log("[PX4Live] Camera following PX4Drone.");
            }

            if (wsBridge != null)
                wsBridge.BroadcastEvent("px4live_started", "PX4Drone");

            // Subscribe to telemetry and drive drone position
            px4Client.OnTelemetryReceived += (data) =>
            {
                if (drone == null) return;

                // Convert GPS to Unity world coordinates via Cesium georeference
                Vector3 worldPos;
                if (mapTiles != null)
                {
                    worldPos = mapTiles.GeoToUnity(data.lat, data.lon, data.alt_m);
                }
                else
                {
                    // Flat-earth fallback using depot as origin
                    double depotLat = 51.5074;
                    double depotLon = -0.1278;
                    if (config != null)
                    {
                        var depot = config.GetLocation("Depot");
                        if (depot != null)
                        {
                            depotLat = depot.latitude;
                            depotLon = depot.longitude;
                        }
                    }
                    double cosLat = System.Math.Cos(depotLat * System.Math.PI / 180.0);
                    float x = (float)((data.lon - depotLon) * 111320.0 * cosLat);
                    float z = (float)((data.lat - depotLat) * 111320.0);
                    worldPos = new Vector3(x, data.alt_m, z);
                }

                drone.SetExternalTelemetry(
                    worldPos,
                    data.heading_deg,
                    data.battery_pct,
                    data.flight_mode,
                    data.speed_m_s
                );
            };

            // Keep running until stopped
            while (isRunning)
            {
                yield return null;
            }

            // Cleanup
            drone.IsExternallyDriven = false;
            Debug.Log("[PX4Live] Mode stopped.");
        }

        // ==== Helpers ====

        private string[] BuildFullRoute(string[] locations)
        {
            var route = new List<string> { "Depot" };
            route.AddRange(locations);
            route.Add("Depot");
            return route.ToArray();
        }

        private DroneController SpawnDrone(string droneName, Vector3 offset = default)
        {
            // Use Cesium geo-conversion if available (critical for 3D tiles alignment)
            Vector3 depotPos;
            if (mapTiles != null)
            {
                depotPos = mapTiles.GeoToUnity(51.5074, -0.1278, 50.0) + offset;
                Debug.Log($"[SpawnDrone] Using Cesium coords: {depotPos}");
            }
            else if (config != null)
            {
                depotPos = config.GetWorldPosition("Depot") + offset;
            }
            else
            {
                depotPos = offset;
            }
            GameObject droneObj;

            if (dronePrefab != null)
            {
                droneObj = Instantiate(dronePrefab, depotPos, Quaternion.identity);
            }
            else
            {
                droneObj = GameObject.CreatePrimitive(PrimitiveType.Cube);
                droneObj.transform.position = depotPos;
                droneObj.transform.localScale = new Vector3(1f, 0.3f, 1f);
                if (droneObj.GetComponent<DroneController>() == null)
                    droneObj.AddComponent<DroneController>();
            }

            droneObj.name = droneName;

            // Ensure drone has a 3D model
            if (droneObj.GetComponent<DroneModelBuilder>() == null)
                droneObj.AddComponent<DroneModelBuilder>();

            var dc = droneObj.GetComponent<DroneController>();
            if (dc != null && config != null)
                dc.SetConfig(config);
            activeDrones.Add(dc);

            // Forward drone events to WebSocket
            if (wsBridge != null)
            {
                dc.OnArrivedAtWaypoint += (location) =>
                    wsBridge.BroadcastEvent("waypoint_reached", dc.name, location, dc.Battery);
                dc.OnStateChanged += (state) =>
                    wsBridge.BroadcastEvent("drone_status_changed", dc.name, dc.CurrentLocation, dc.Battery);
                dc.OnLowBattery += (battery) =>
                    wsBridge.BroadcastEvent("drone_battery_low", dc.name, dc.CurrentLocation, battery);
            }

            return dc;
        }

        private void PublishTelemetry()
        {
            if (rosBridge == null) return;
            foreach (var drone in activeDrones)
            {
                if (drone == null) continue;
                rosBridge.PublishTelemetry(
                    drone.name,
                    drone.transform.position,
                    drone.Battery,
                    drone.CurrentState.ToString(),
                    drone.CurrentLocation
                );
            }
        }

        private void BroadcastMissionCompleted()
        {
            if (wsBridge != null)
                wsBridge.BroadcastEvent("mission_completed", "");
        }

        // ==== Debug GUI ====

        private void OnGUI()
        {
            float boxWidth = 340f;
            float boxHeight = 30f + (activeDrones.Count * 60f) + 80f;
            GUI.Box(new Rect(10f, 10f, boxWidth, boxHeight), "");

            GUILayout.BeginArea(new Rect(15f, 15f, boxWidth - 10f, boxHeight - 10f));
            var header = new GUIStyle(GUI.skin.label) { fontStyle = FontStyle.Bold, fontSize = 14 };
            GUILayout.Label($"DroneMedic — {demoMode} Mode", header);
            GUILayout.Label(isRunning ? "Status: RUNNING" : "Status: STOPPED");

            // Safety status
            Color safetyColor = currentBatteryState switch
            {
                "GREEN" => Color.green,
                "AMBER" => Color.yellow,
                "RED" => Color.red,
                _ => Color.white
            };
            var safetyStyle = new GUIStyle(GUI.skin.label) { fontStyle = FontStyle.Bold };
            safetyStyle.normal.textColor = safetyColor;
            GUILayout.Label($"Safety: {currentBatteryState} | Action: {currentAction}", safetyStyle);

            // Backend status
            bool connected = apiClient != null && apiClient.IsBackendReachable;
            GUILayout.Label(connected ? "Backend: Connected" : "Backend: Offline (fallback)");

            foreach (var drone in activeDrones)
            {
                if (drone == null) continue;
                GUILayout.Space(4f);
                GUILayout.Label($"  {drone.name}");
                GUILayout.Label($"    State: {drone.CurrentState}  |  Battery: {drone.Battery:F1}%  ({drone.BatteryWh:F0} Wh)");
                if (drone.PayloadWeight > 0)
                    GUILayout.Label($"    Payload: {drone.PayloadType} ({drone.PayloadWeight:F1}kg)");
                Vector3 pos = drone.transform.position;
                GUILayout.Label($"    Pos: ({pos.x:F1}, {pos.y:F1}, {pos.z:F1})");
            }
            GUILayout.EndArea();
        }
    }
}
