using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

namespace DroneMedic
{
    public enum DroneState
    {
        Idle,
        TakingOff,
        Flying,
        Hovering,
        Landing,
        Landed
    }

    [Serializable]
    public class FlightLogEntry
    {
        public string eventName;
        public string location;
        public Vector3 position;
        public float battery;
        public float timestamp;

        public FlightLogEntry(string eventName, string location, Vector3 position, float battery)
        {
            this.eventName = eventName;
            this.location = location;
            this.position = position;
            this.battery = battery;
            this.timestamp = Time.time;
        }
    }

    public class DroneController : MonoBehaviour
    {
        // -- Events ----------------------------------------------------------

        public event Action<DroneState> OnStateChanged;
        public event Action<float> OnBatteryChanged;
        public event Action<string> OnArrivedAtWaypoint;
        public event Action<float> OnLowBattery;

        // -- Inspector -------------------------------------------------------

        [Header("Configuration")]
        [SerializeField] private DroneConfig config;

        [Header("Runtime (read-only)")]
        [SerializeField] private DroneState currentState = DroneState.Idle;
        [SerializeField] private float battery;
        [SerializeField] private string currentLocation = "Depot";
        [SerializeField] private bool isPaused;

        [Header("Flight Log")]
        [SerializeField] private List<FlightLogEntry> flightLog = new List<FlightLogEntry>();

        // -- External Telemetry (PX4 Live Mode) ---------------------------------

        /// <summary>When true, position/state are driven by external PX4 telemetry, not coroutines.</summary>
        public bool IsExternallyDriven { get; set; }

        private Vector3 _externalTargetPos;
        private Quaternion _externalTargetRot;
        private const float ExternalLerpSpeed = 5f;

        // -- Weather & Physics Modifiers --------------------------------------

        /// <summary>Speed multiplier applied by mission controller (1.0 = normal, 0.73 = conservation).</summary>
        public float SpeedMultiplier { get; set; } = 1f;

        /// <summary>Battery drain multiplier from weather/conditions.</summary>
        public float BatteryDrainMultiplier { get; set; } = 1f;

        // -- Payload ---------------------------------------------------------

        private float payloadWeightKg;
        private string payloadType = "";

        public float PayloadWeight => payloadWeightKg;
        public string PayloadType => payloadType;

        // -- Public Properties -----------------------------------------------

        public DroneState CurrentState => currentState;
        public float Battery => battery;
        public string CurrentLocation => currentLocation;
        public bool IsFlying => currentState == DroneState.TakingOff
                             || currentState == DroneState.Flying
                             || currentState == DroneState.Hovering;
        public IReadOnlyList<FlightLogEntry> FlightLog => flightLog;

        /// <summary>Battery in Wh for physics engine (800Wh * 0.80 usable * 0.85 non-reserve = 544Wh at 100%).</summary>
        public float BatteryWh => (battery / 100f) * 544f;

        // -- Private State ---------------------------------------------------

        private Coroutine activeFlightCoroutine;

        // -- Unity Lifecycle -------------------------------------------------

        private void Awake()
        {
            if (config != null)
                battery = config.batteryCapacity;
            else
                battery = 100f; // default for externally driven drones
        }

        /// <summary>Assign config at runtime (used by SimulationManager when spawning).</summary>
        public void SetConfig(DroneConfig cfg)
        {
            config = cfg;
            if (config != null)
                battery = config.batteryCapacity;
        }

        private void Update()
        {
            if (!IsExternallyDriven) return;

            transform.position = Vector3.Lerp(transform.position, _externalTargetPos, Time.deltaTime * ExternalLerpSpeed);
            transform.rotation = Quaternion.Slerp(transform.rotation, _externalTargetRot, Time.deltaTime * ExternalLerpSpeed);
        }

        // -- External Telemetry API ------------------------------------------

        /// <summary>
        /// Called by SimulationManager in PX4Live mode to feed real telemetry.
        /// Smoothly interpolates position/rotation in Update().
        /// </summary>
        public void SetExternalTelemetry(Vector3 worldPos, float heading, float batteryPct, string flightMode, float speed)
        {
            if (!IsExternallyDriven) return;

            _externalTargetPos = worldPos;
            _externalTargetRot = Quaternion.Euler(0f, heading, 0f);

            // Update battery from real PX4 data
            float previousBattery = battery;
            battery = batteryPct;
            if (Mathf.Abs(previousBattery - battery) > 0.1f)
                OnBatteryChanged?.Invoke(battery);

            float reserve = config != null ? config.batteryMinReserve : 20f;
            if (battery <= reserve)
                OnLowBattery?.Invoke(battery);

            // Map PX4 flight mode to DroneState
            DroneState mapped = MapFlightMode(flightMode);
            if (mapped != currentState)
                SetState(mapped);
        }

        private static DroneState MapFlightMode(string px4Mode)
        {
            if (string.IsNullOrEmpty(px4Mode)) return DroneState.Idle;

            string upper = px4Mode.ToUpperInvariant();
            if (upper.Contains("TAKEOFF")) return DroneState.TakingOff;
            if (upper.Contains("LAND")) return DroneState.Landing;
            if (upper.Contains("HOLD") || upper.Contains("LOITER")) return DroneState.Hovering;
            if (upper.Contains("MISSION") || upper.Contains("OFFBOARD") || upper.Contains("POSCTL") || upper.Contains("ALTCTL"))
                return DroneState.Flying;
            return DroneState.Idle;
        }

        // -- State Management ------------------------------------------------

        private void SetState(DroneState newState)
        {
            if (currentState == newState) return;
            currentState = newState;
            OnStateChanged?.Invoke(newState);
        }

        // -- Battery ---------------------------------------------------------

        private void DrainBattery(float distance)
        {
            float weightFactor = 1f + (payloadWeightKg * 0.15f);
            float drain = distance * config.batteryDrainRate * weightFactor * BatteryDrainMultiplier;
            battery = Mathf.Max(0f, battery - drain);
            OnBatteryChanged?.Invoke(battery);

            if (battery <= config.batteryMinReserve)
            {
                OnLowBattery?.Invoke(battery);
            }
        }

        /// <summary>
        /// Returns true if the drone has enough battery to fly to the Depot
        /// from its current position, accounting for the minimum reserve.
        /// </summary>
        public bool CheckBatteryForReturn()
        {
            if (config == null) return false;
            Vector3 depotPos = config.GetWorldPosition("Depot");
            float distanceToDepot = Vector3.Distance(transform.position, depotPos);
            float drainNeeded = distanceToDepot * config.batteryDrainRate;
            return battery - drainNeeded >= config.batteryMinReserve;
        }

        // -- Payload ---------------------------------------------------------

        public bool LoadPayload(string type, float weightKg)
        {
            if (weightKg > config.maxPayloadKg)
            {
                Debug.LogWarning($"[DroneController] Payload {weightKg}kg exceeds max {config.maxPayloadKg}kg");
                return false;
            }

            payloadWeightKg = weightKg;
            payloadType = type;
            Log($"PayloadLoaded:{weightKg:F1}kg", currentLocation);
            return true;
        }

        public void ReleasePayload()
        {
            if (payloadWeightKg <= 0f) return;
            Log("PayloadReleased", currentLocation);
            payloadWeightKg = 0f;
            payloadType = "";
        }

        // -- Logging ---------------------------------------------------------

        private void Log(string eventName, string location)
        {
            var entry = new FlightLogEntry(eventName, location, transform.position, battery);
            flightLog.Add(entry);
        }

        // -- Pause / Resume --------------------------------------------------

        public void Pause()
        {
            if (!IsFlying) return;
            isPaused = true;
            SetState(DroneState.Hovering);
            Log("Paused", currentLocation);
        }

        public void Resume()
        {
            if (!isPaused) return;
            isPaused = false;
            SetState(DroneState.Flying);
            Log("Resumed", currentLocation);
        }

        // -- Flight Commands -------------------------------------------------

        /// <summary>
        /// Takeoff: vertical rise to config.droneAltitude over approximately 1 second.
        /// </summary>
        public Coroutine Takeoff()
        {
            if (IsExternallyDriven)
            {
                Debug.Log("[DroneController] Takeoff ignored — externally driven by PX4.");
                return null;
            }

            if (currentState != DroneState.Idle && currentState != DroneState.Landed)
            {
                Debug.LogWarning("[DroneController] Cannot take off from state: " + currentState);
                return null;
            }

            activeFlightCoroutine = StartCoroutine(TakeoffCoroutine());
            return activeFlightCoroutine;
        }

        private IEnumerator TakeoffCoroutine()
        {
            SetState(DroneState.TakingOff);
            Log("Takeoff", currentLocation);

            Vector3 startPos = transform.position;
            Vector3 targetPos = new Vector3(startPos.x, config.droneAltitude, startPos.z);
            float duration = 1f;
            float elapsed = 0f;

            while (elapsed < duration)
            {
                elapsed += Time.deltaTime;
                float t = Mathf.Clamp01(elapsed / duration);
                float smoothT = Mathf.SmoothStep(0f, 1f, t);
                transform.position = Vector3.Lerp(startPos, targetPos, smoothT);
                yield return null;
            }

            transform.position = targetPos;
            SetState(DroneState.Hovering);
            Log("Hovering", currentLocation);
        }

        /// <summary>
        /// Land: vertical descent to ground over approximately 1 second.
        /// </summary>
        public Coroutine Land()
        {
            if (IsExternallyDriven)
            {
                Debug.Log("[DroneController] Land ignored — externally driven by PX4.");
                return null;
            }

            if (!IsFlying)
            {
                Debug.LogWarning("[DroneController] Cannot land from state: " + currentState);
                return null;
            }

            activeFlightCoroutine = StartCoroutine(LandCoroutine());
            return activeFlightCoroutine;
        }

        private IEnumerator LandCoroutine()
        {
            SetState(DroneState.Landing);
            Log("Landing", currentLocation);

            Vector3 startPos = transform.position;
            Vector3 targetPos = new Vector3(startPos.x, 0f, startPos.z);
            float duration = 1f;
            float elapsed = 0f;

            while (elapsed < duration)
            {
                elapsed += Time.deltaTime;
                float t = Mathf.Clamp01(elapsed / duration);
                float smoothT = Mathf.SmoothStep(0f, 1f, t);
                transform.position = Vector3.Lerp(startPos, targetPos, smoothT);
                yield return null;
            }

            transform.position = targetPos;
            SetState(DroneState.Landed);
            Log("Landed", currentLocation);
        }

        /// <summary>
        /// Move to a named location from config. The drone must be airborne (Hovering or Flying).
        /// Battery is drained based on the distance travelled.
        /// Coordinate mapping: Python (x,y) -> Unity (x,z), Python z -> Unity y (altitude).
        /// </summary>
        public Coroutine MoveToLocation(string locationName)
        {
            if (IsExternallyDriven)
            {
                Debug.Log("[DroneController] MoveToLocation ignored — externally driven by PX4.");
                return null;
            }

            if (currentState != DroneState.Hovering && currentState != DroneState.Flying)
            {
                Debug.LogWarning("[DroneController] Must be airborne to move. Current state: " + currentState);
                return null;
            }

            LocationData loc = config.GetLocation(locationName);
            if (loc == null)
            {
                Debug.LogError("[DroneController] Unknown location: " + locationName);
                return null;
            }

            activeFlightCoroutine = StartCoroutine(MoveToLocationCoroutine(locationName));
            return activeFlightCoroutine;
        }

        private IEnumerator MoveToLocationCoroutine(string locationName)
        {
            SetState(DroneState.Flying);
            Log("Moving", locationName);

            Vector3 targetPos = config.GetWorldPosition(locationName);
            float speed = config.droneVelocity * SpeedMultiplier;
            Vector3 previousPos = transform.position;

            while (Vector3.Distance(transform.position, targetPos) > 0.01f)
            {
                // Wait while paused
                while (isPaused)
                {
                    yield return null;
                }

                previousPos = transform.position;
                transform.position = Vector3.MoveTowards(transform.position, targetPos, speed * Time.deltaTime);

                float stepDistance = Vector3.Distance(previousPos, transform.position);
                DrainBattery(stepDistance);

                yield return null;
            }

            transform.position = targetPos;
            currentLocation = locationName;

            SetState(DroneState.Hovering);
            Log("Arrived", locationName);
            OnArrivedAtWaypoint?.Invoke(locationName);
        }
    }
}
