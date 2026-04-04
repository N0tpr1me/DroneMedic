using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

namespace DroneMedic
{
    public class FleetController : MonoBehaviour
    {
        public static FleetController Instance { get; private set; }

        [Header("Configuration")]
        [SerializeField] private DroneConfig config;

        [Header("Spawning")]
        [SerializeField] private GameObject dronePrefab;
        [SerializeField] private Transform spawnPoint;

        private readonly Dictionary<string, DroneController> drones = new Dictionary<string, DroneController>();

        public event Action OnFleetRouteComplete;
        public event Action<string, DroneController> OnDroneSpawned;

        private void Awake()
        {
            if (Instance != null && Instance != this)
            {
                Destroy(gameObject);
                return;
            }
            Instance = this;
        }

        public void SpawnFleet()
        {
            for (int i = 0; i < config.numDrones; i++)
            {
                string droneName = i < config.droneNames.Length
                    ? config.droneNames[i]
                    : $"Drone{i + 1}";

                Vector3 offset = new Vector3(i * 3f, 0f, 0f);
                Vector3 position = spawnPoint != null
                    ? spawnPoint.position + offset
                    : offset;

                GameObject droneObj = Instantiate(dronePrefab, position, Quaternion.identity, transform);
                droneObj.name = droneName;

                DroneController controller = droneObj.GetComponent<DroneController>();
                if (controller == null)
                {
                    Debug.LogError($"[FleetController] Prefab missing DroneController for '{droneName}'.");
                    continue;
                }

                drones[droneName] = controller;
                OnDroneSpawned?.Invoke(droneName, controller);
            }

            Debug.Log($"[FleetController] Spawned {drones.Count} drones.");
        }

        public DroneController GetDrone(string droneId)
        {
            drones.TryGetValue(droneId, out DroneController controller);
            return controller;
        }

        public Coroutine ExecuteRoutes(Dictionary<string, List<string>> routes)
        {
            return StartCoroutine(ExecuteRoutesCoroutine(routes));
        }

        private IEnumerator ExecuteRoutesCoroutine(Dictionary<string, List<string>> routes)
        {
            var activeCoroutines = new List<Coroutine>();

            foreach (var kvp in routes)
            {
                string droneId = kvp.Key;
                List<string> waypoints = kvp.Value;

                if (!drones.TryGetValue(droneId, out DroneController controller))
                {
                    Debug.LogWarning($"[FleetController] Drone '{droneId}' not found. Skipping.");
                    continue;
                }

                Coroutine routine = StartCoroutine(ExecuteSingleRoute(controller, droneId, waypoints));
                activeCoroutines.Add(routine);
            }

            foreach (var routine in activeCoroutines)
                yield return routine;

            Debug.Log("[FleetController] All routes complete.");
            OnFleetRouteComplete?.Invoke();
        }

        private IEnumerator ExecuteSingleRoute(DroneController controller, string droneId, List<string> waypoints)
        {
            Debug.Log($"[FleetController] {droneId}: Taking off...");
            yield return controller.Takeoff();

            foreach (string waypoint in waypoints)
            {
                if (waypoint == "Depot" && waypoint == waypoints[0])
                    continue;

                Debug.Log($"[FleetController] {droneId}: Moving to {waypoint}...");
                yield return controller.MoveToLocation(waypoint);
            }

            Debug.Log($"[FleetController] {droneId}: Landing...");
            yield return controller.Land();

            Debug.Log($"[FleetController] {droneId}: Route complete. Battery: {controller.Battery:F1}%");
        }

        public Dictionary<string, float> GetAllBatteries()
        {
            var batteries = new Dictionary<string, float>();
            foreach (var kvp in drones)
                batteries[kvp.Key] = kvp.Value.Battery;
            return batteries;
        }

        public Dictionary<string, IReadOnlyList<FlightLogEntry>> GetAllLogs()
        {
            var logs = new Dictionary<string, IReadOnlyList<FlightLogEntry>>();
            foreach (var kvp in drones)
                logs[kvp.Key] = kvp.Value.FlightLog;
            return logs;
        }
    }
}
