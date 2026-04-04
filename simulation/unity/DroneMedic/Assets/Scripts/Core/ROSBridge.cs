using System;
using UnityEngine;

#if ROS_TCP_CONNECTOR
using Unity.Robotics.ROSTCPConnector;
using Unity.Robotics.ROSTCPConnector.MessageGeneration;
#endif

namespace DroneMedic
{
    // ---------------------------------------------------------------------------
    // Lightweight ROS-compatible message classes (JSON-serializable, no ROS deps)
    // ---------------------------------------------------------------------------

    [Serializable]
    public class DroneTelemetryMsg
    {
        public string droneId;
        public float posX;
        public float posY;
        public float posZ;
        public float battery;
        public string state;
        public string currentLocation;
    }

    [Serializable]
    public class RouteCommandMsg
    {
        public string droneId;
        public string[] waypoints;
    }

    [Serializable]
    public class WeatherEventMsg
    {
        public string eventType;
        public string[] affectedLocations;
    }

    [Serializable]
    public class ObstacleEventMsg
    {
        public string obstacleType;
        public string nearLocation;
        public string description;
    }

    // ---------------------------------------------------------------------------
    // ROSBridge — singleton MonoBehaviour that bridges Unity ↔ Python via ROS
    // ---------------------------------------------------------------------------

    public class ROSBridge : MonoBehaviour
    {
        public static ROSBridge Instance { get; private set; }

        [SerializeField] private DroneConfig config;
        [SerializeField] private string rosIPAddress = "127.0.0.1";
        [SerializeField] private int rosPort = 10000;

        // Topic names
        private const string TopicTelemetry = "/dronemedic/telemetry";
        private const string TopicWeather = "/dronemedic/weather";
        private const string TopicObstacles = "/dronemedic/obstacles";
        private const string TopicRouteCommands = "/dronemedic/route_commands";

#if ROS_TCP_CONNECTOR
        private ROSConnection rosConnection;
#endif

        private void Awake()
        {
            if (Instance != null && Instance != this)
            {
                Destroy(gameObject);
                return;
            }

            Instance = this;
            DontDestroyOnLoad(gameObject);
        }

        /// <summary>
        /// Set up the ROS connection. Call once after Awake (e.g. from Start or
        /// an initialisation manager).
        /// </summary>
        public void Initialize()
        {
#if ROS_TCP_CONNECTOR
            rosConnection = ROSConnection.GetOrCreateInstance();
            rosConnection.RosIPAddress = rosIPAddress;
            rosConnection.RosPort = rosPort;
            rosConnection.Connect();

            Debug.Log($"[ROSBridge] Connected to ROS at {rosIPAddress}:{rosPort}");
#else
            Debug.Log($"[ROSBridge] ROS_TCP_CONNECTOR not defined. Running in debug/log-only mode ({rosIPAddress}:{rosPort}).");
#endif
        }

        // ------------------------------------------------------------------
        // Publishing
        // ------------------------------------------------------------------

        public void PublishTelemetry(string droneId, Vector3 pos, float battery, string state, string location)
        {
            var msg = new DroneTelemetryMsg
            {
                droneId = droneId,
                posX = pos.x,
                posY = pos.y,
                posZ = pos.z,
                battery = battery,
                state = state,
                currentLocation = location
            };

#if ROS_TCP_CONNECTOR
            rosConnection.Publish(TopicTelemetry, msg);
#else
            Debug.Log($"[ROSBridge] Telemetry → drone={droneId} pos=({pos.x:F1},{pos.y:F1},{pos.z:F1}) battery={battery:F1} state={state} location={location}");
#endif
        }

        public void PublishWeatherEvent(string eventType, string[] locations)
        {
            var msg = new WeatherEventMsg
            {
                eventType = eventType,
                affectedLocations = locations
            };

#if ROS_TCP_CONNECTOR
            rosConnection.Publish(TopicWeather, msg);
#else
            Debug.Log($"[ROSBridge] Weather → type={eventType} locations=[{string.Join(", ", locations)}]");
#endif
        }

        public void PublishObstacleEvent(string type, string nearLocation, string description)
        {
            var msg = new ObstacleEventMsg
            {
                obstacleType = type,
                nearLocation = nearLocation,
                description = description
            };

#if ROS_TCP_CONNECTOR
            rosConnection.Publish(TopicObstacles, msg);
#else
            Debug.Log($"[ROSBridge] Obstacle → type={type} near={nearLocation} desc={description}");
#endif
        }

        // ------------------------------------------------------------------
        // Subscribing
        // ------------------------------------------------------------------

        public void SubscribeToRouteCommands(Action<RouteCommandMsg> callback)
        {
#if ROS_TCP_CONNECTOR
            rosConnection.Subscribe<RouteCommandMsg>(TopicRouteCommands, (msg) =>
            {
                callback?.Invoke(msg);
            });
            Debug.Log($"[ROSBridge] Subscribed to {TopicRouteCommands}");
#else
            Debug.Log($"[ROSBridge] SubscribeToRouteCommands registered (log-only mode, no ROS). Callback will not fire automatically.");
#endif
        }
    }
}
