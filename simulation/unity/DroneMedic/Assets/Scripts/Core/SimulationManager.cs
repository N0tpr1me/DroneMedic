using System.Collections;
using System.Collections.Generic;
using UnityEngine;

namespace DroneMedic
{
    public enum DemoMode
    {
        Basic,
        Weather,
        Obstacle,
        Full,
        MultiDrone
    }

    public class SimulationManager : MonoBehaviour
    {
        public static SimulationManager Instance { get; private set; }

        [Header("Configuration")]
        [SerializeField] private DroneConfig config;
        [SerializeField] private DemoMode demoMode = DemoMode.Basic;
        [SerializeField] private bool autoStart = false;
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

        private readonly List<DroneController> activeDrones = new List<DroneController>();
        private bool isRunning;
        private float telemetryTimer;
        private const float TelemetryInterval = 0.5f;

        public DroneConfig Config => config;
        public DemoMode CurrentDemoMode => demoMode;
        public bool IsRunning => isRunning;
        public IReadOnlyList<DroneController> ActiveDrones => activeDrones;

        private void Awake()
        {
            if (Instance != null && Instance != this)
            {
                Destroy(gameObject);
                return;
            }
            Instance = this;

            // Wire the map reference so DroneConfig can convert geo->world coords
            if (mapTiles == null)
                mapTiles = FindAnyObjectByType<GoogleMaps3DTiles>();
            if (mapTiles != null && config != null)
                config.SetMapReference(mapTiles);
        }

        private void Start()
        {
            // Wire up WebSocket bridge commands from the React dashboard
            if (wsBridge == null)
                wsBridge = FindAnyObjectByType<WebSocketBridge>();

            if (wsBridge != null)
            {
                wsBridge.OnStartCommand += (mode) =>
                {
                    if (System.Enum.TryParse<DemoMode>(mode, true, out var parsed))
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
            if (!isRunning || rosBridge == null) return;

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

        public void StartSimulation()
        {
            if (isRunning)
            {
                Debug.LogWarning("[SimulationManager] Already running.");
                return;
            }

            isRunning = true;
            Debug.Log($"[SimulationManager] Starting — mode: {demoMode}");

            // Broadcast mission_started to React dashboard
            if (wsBridge != null)
                wsBridge.BroadcastEvent("mission_started", "", demoMode.ToString());

            switch (demoMode)
            {
                case DemoMode.Basic:      StartCoroutine(RunBasicDemo()); break;
                case DemoMode.Weather:    StartCoroutine(RunWeatherDemo()); break;
                case DemoMode.Obstacle:   StartCoroutine(RunObstacleDemo()); break;
                case DemoMode.Full:       StartCoroutine(RunFullDemo()); break;
                case DemoMode.MultiDrone: StartCoroutine(RunMultiDroneDemo()); break;
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

        // ==== Demo Coroutines ====

        private IEnumerator RunBasicDemo()
        {
            Debug.Log("[BasicDemo] Depot -> A -> B -> C -> Depot");
            DroneController drone = SpawnDrone("Drone1");
            yield return drone.Takeoff();
            yield return drone.MoveToLocation("Clinic A");
            yield return drone.MoveToLocation("Clinic B");
            yield return drone.MoveToLocation("Clinic C");
            yield return drone.MoveToLocation("Depot");
            yield return drone.Land();
            Debug.Log("[BasicDemo] Complete.");
            BroadcastMissionCompleted();
            isRunning = false;
        }

        private IEnumerator RunWeatherDemo()
        {
            Debug.Log("[WeatherDemo] Route with storm at Clinic B");
            DroneController drone = SpawnDrone("Drone1");
            yield return drone.Takeoff();
            yield return drone.MoveToLocation("Clinic A");

            if (weatherSystem != null)
                weatherSystem.SimulateWeatherEvent("storm", new[] { "Clinic B" });
            Debug.LogWarning("[WeatherDemo] Storm at Clinic B — skipping.");

            yield return drone.MoveToLocation("Clinic C");
            yield return drone.MoveToLocation("Depot");
            yield return drone.Land();
            Debug.Log("[WeatherDemo] Complete.");
            BroadcastMissionCompleted();
            isRunning = false;
        }

        private IEnumerator RunObstacleDemo()
        {
            Debug.Log("[ObstacleDemo] Route with obstacle near Clinic C");
            DroneController drone = SpawnDrone("Drone1");
            yield return drone.Takeoff();
            yield return drone.MoveToLocation("Clinic A");
            yield return drone.MoveToLocation("Clinic B");

            if (obstacleDetector != null)
                obstacleDetector.CheckForObstacle(drone.transform.position, 0.6f);
            Debug.LogWarning("[ObstacleDemo] Obstacle detected — skipping Clinic C.");

            yield return drone.MoveToLocation("Depot");
            yield return drone.Land();
            Debug.Log("[ObstacleDemo] Complete.");
            BroadcastMissionCompleted();
            isRunning = false;
        }

        private IEnumerator RunFullDemo()
        {
            Debug.Log("[FullDemo] Weather + obstacle + geofence");
            DroneController drone = SpawnDrone("Drone1");
            yield return drone.Takeoff();

            // Clinic A with geofence check
            var locA = config.GetLocation("Clinic A");
            bool skipA = false;
            if (geofenceManager != null && locA != null)
            {
                var (inZone, _) = geofenceManager.IsInNoFlyZone(locA.latitude, locA.longitude);
                skipA = inZone;
            }
            if (!skipA)
                yield return drone.MoveToLocation("Clinic A");
            else
                Debug.LogWarning("[FullDemo] Clinic A in no-fly zone — skipping.");

            // Storm at Clinic B
            if (weatherSystem != null)
                weatherSystem.SimulateWeatherEvent("storm", new[] { "Clinic B" });
            Debug.LogWarning("[FullDemo] Storm at Clinic B — skipping.");

            // Obstacle near Clinic C
            if (obstacleDetector != null)
                obstacleDetector.CheckForObstacle(drone.transform.position, 0.6f);
            Debug.LogWarning("[FullDemo] Obstacle near Clinic C — rerouting to Clinic D.");

            // Fallback to Clinic D
            var locD = config.GetLocation("Clinic D");
            bool skipD = false;
            if (geofenceManager != null && locD != null)
            {
                var (inZone, _) = geofenceManager.IsInNoFlyZone(locD.latitude, locD.longitude);
                skipD = inZone;
            }
            if (!skipD)
                yield return drone.MoveToLocation("Clinic D");

            yield return drone.MoveToLocation("Depot");
            yield return drone.Land();
            Debug.Log("[FullDemo] Complete.");
            BroadcastMissionCompleted();
            isRunning = false;
        }

        private IEnumerator RunMultiDroneDemo()
        {
            Debug.Log("[MultiDroneDemo] 2 drones — Drone1: A->B, Drone2: C->D");
            DroneController drone1 = SpawnDrone("Drone1");
            DroneController drone2 = SpawnDrone("Drone2", new Vector3(3f, 0f, 0f));

            // Takeoff both
            Coroutine t1 = drone1.Takeoff();
            Coroutine t2 = drone2.Takeoff();
            yield return t1;
            yield return t2;

            // Fly routes in parallel
            Coroutine r1 = StartCoroutine(FlyRoute(drone1, new[] { "Clinic A", "Clinic B", "Depot" }));
            Coroutine r2 = StartCoroutine(FlyRoute(drone2, new[] { "Clinic C", "Clinic D", "Depot" }));
            yield return r1;
            yield return r2;

            // Land both
            Coroutine l1 = drone1.Land();
            Coroutine l2 = drone2.Land();
            yield return l1;
            yield return l2;

            Debug.Log("[MultiDroneDemo] Complete.");
            BroadcastMissionCompleted();
            isRunning = false;
        }

        private IEnumerator FlyRoute(DroneController drone, string[] locations)
        {
            foreach (string loc in locations)
                yield return drone.MoveToLocation(loc);
        }

        // ==== Helpers ====

        private DroneController SpawnDrone(string droneName, Vector3 offset = default)
        {
            Vector3 depotPos = config.GetWorldPosition("Depot") + offset;
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
            var dc = droneObj.GetComponent<DroneController>();
            activeDrones.Add(dc);

            // Subscribe to drone events and forward to WebSocket bridge
            if (wsBridge != null)
            {
                dc.OnArrivedAtWaypoint += (location) =>
                {
                    wsBridge.BroadcastEvent("waypoint_reached", dc.name, location, dc.Battery);
                };
                dc.OnStateChanged += (state) =>
                {
                    wsBridge.BroadcastEvent("drone_status_changed", dc.name, dc.CurrentLocation, dc.Battery);
                };
                dc.OnLowBattery += (battery) =>
                {
                    wsBridge.BroadcastEvent("drone_battery_low", dc.name, dc.CurrentLocation, battery);
                };
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
            float boxWidth = 320f;
            float boxHeight = 30f + (activeDrones.Count * 60f) + 40f;
            GUI.Box(new Rect(10f, 10f, boxWidth, boxHeight), "");

            GUILayout.BeginArea(new Rect(15f, 15f, boxWidth - 10f, boxHeight - 10f));
            var header = new GUIStyle(GUI.skin.label) { fontStyle = FontStyle.Bold, fontSize = 14 };
            GUILayout.Label($"DroneMedic — {demoMode} Mode", header);
            GUILayout.Label(isRunning ? "Status: RUNNING" : "Status: STOPPED");

            foreach (var drone in activeDrones)
            {
                if (drone == null) continue;
                GUILayout.Space(4f);
                GUILayout.Label($"  {drone.name}");
                GUILayout.Label($"    State: {drone.CurrentState}  |  Battery: {drone.Battery:F1}%");
                Vector3 pos = drone.transform.position;
                GUILayout.Label($"    Pos: ({pos.x:F1}, {pos.y:F1}, {pos.z:F1})");
            }
            GUILayout.EndArea();
        }
    }
}
