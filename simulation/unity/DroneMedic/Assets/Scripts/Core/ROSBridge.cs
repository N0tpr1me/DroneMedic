using System;
using System.Collections.Generic;
using UnityEngine;

#if ROS_TCP_CONNECTOR
using Unity.Robotics.ROSTCPConnector;
using Unity.Robotics.ROSTCPConnector.MessageGeneration;
using RosMessageTypes.Std;
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

    // -- Gazebo world data messages --

    [Serializable]
    public class GazeboDronePose
    {
        public string type;
        public double lat;
        public double lon;
        public float alt_m;
        public float relative_alt_m;
        public float battery_pct;
        public string flight_mode;
        public bool is_armed;
        public float heading_deg;
        public float speed_m_s;
    }

    [Serializable]
    public class GazeboBuilding
    {
        public string name;
        public double lat;
        public double lon;
        public float east;
        public float north;
        public float width;
        public float depth;
        public float height;
        public float[] color;
    }

    [Serializable]
    public class GazeboBuildingsMsg
    {
        public string type;
        public GazeboBuilding[] buildings;
    }

    [Serializable]
    public class GazeboNFZCorner
    {
        public double lat;
        public double lon;
    }

    [Serializable]
    public class GazeboNoFlyZone
    {
        public string name;
        public float center_east;
        public float center_north;
        public float width;
        public float depth;
        public GazeboNFZCorner[] corners_gps;
    }

    [Serializable]
    public class GazeboNoFlyZonesMsg
    {
        public string type;
        public GazeboNoFlyZone[] zones;
    }

    [Serializable]
    public class GazeboWeatherMsg
    {
        public string type;
        public float wind_speed_ms;
        public float wind_direction_deg;
        public float precipitation_mm_h;
        public float visibility_km;
        public float temperature_c;
    }

    [Serializable]
    public class GazeboObstacleMsg
    {
        public string type;
        public string obstacle_type;
        public string near_location;
        public string description;
    }

    // ---------------------------------------------------------------------------
    // ROSBridge — singleton MonoBehaviour that bridges Unity ↔ Gazebo via ROS
    // ---------------------------------------------------------------------------

    public class ROSBridge : MonoBehaviour
    {
        public static ROSBridge Instance { get; private set; }

        [SerializeField] private DroneConfig config;
        [SerializeField] private string rosIPAddress = "127.0.0.1";
        [SerializeField] private int rosPort = 10000;

        // Topic names — publishing (Unity → ROS)
        private const string TopicTelemetry = "/dronemedic/telemetry";
        private const string TopicWeather = "/dronemedic/weather";
        private const string TopicObstacles = "/dronemedic/obstacles";

        // Topic names — subscribing (Gazebo/MAVROS → Unity)
        private const string TopicRouteCommands = "/dronemedic/route_commands";
        private const string TopicDronePose = "/dronemedic/drone_pose";
        private const string TopicWorldBuildings = "/dronemedic/world/buildings";
        private const string TopicWorldNoFly = "/dronemedic/world/nofly_zones";
        private const string TopicGazeboObstacles = "/dronemedic/gazebo/obstacles";
        private const string TopicGazeboWeather = "/dronemedic/gazebo/weather";

        // Events that other Unity scripts can subscribe to
#pragma warning disable CS0067 // Events are subscribed to by GazeboWorldRenderer at runtime
        public event Action<GazeboDronePose> OnGazeboDronePose;
        public event Action<GazeboBuilding[]> OnGazeboBuildingsReceived;
        public event Action<GazeboNoFlyZone[]> OnGazeboNoFlyZonesReceived;
        public event Action<GazeboObstacleMsg> OnGazeboObstacle;
        public event Action<GazeboWeatherMsg> OnGazeboWeather;
#pragma warning restore CS0067

        // Cached world data
        public GazeboBuilding[] Buildings { get; private set; }
        public GazeboNoFlyZone[] NoFlyZones { get; private set; }
        public GazeboWeatherMsg LatestWeather { get; private set; }
        public GazeboDronePose LatestDronePose { get; private set; }
        public bool IsConnected { get; private set; }

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
        /// Set up the ROS connection. Call once after Awake.
        /// </summary>
        public void Initialize()
        {
#if ROS_TCP_CONNECTOR
            rosConnection = ROSConnection.GetOrCreateInstance();
            rosConnection.RosIPAddress = rosIPAddress;
            rosConnection.RosPort = rosPort;
            rosConnection.Connect();
            IsConnected = true;

            // Subscribe to all Gazebo bridge topics
            SubscribeToGazeboTopics();

            Debug.Log($"[ROSBridge] Connected to ROS at {rosIPAddress}:{rosPort} — subscribing to Gazebo topics");
#else
            Debug.Log($"[ROSBridge] ROS_TCP_CONNECTOR not defined. Running in debug/log-only mode ({rosIPAddress}:{rosPort}).");
#endif
        }

        // ------------------------------------------------------------------
        // Gazebo Topic Subscriptions
        // ------------------------------------------------------------------

        private void SubscribeToGazeboTopics()
        {
#if ROS_TCP_CONNECTOR
            // Drone pose from MAVROS via bridge (10 Hz)
            rosConnection.Subscribe<StringMsg>(TopicDronePose, (msg) =>
            {
                var pose = JsonUtility.FromJson<GazeboDronePose>(msg.data);
                if (pose != null)
                {
                    LatestDronePose = pose;
                    OnGazeboDronePose?.Invoke(pose);
                }
            });

            // Static buildings from Gazebo world (once)
            rosConnection.Subscribe<StringMsg>(TopicWorldBuildings, (msg) =>
            {
                var data = JsonUtility.FromJson<GazeboBuildingsMsg>(msg.data);
                if (data?.buildings != null)
                {
                    Buildings = data.buildings;
                    OnGazeboBuildingsReceived?.Invoke(data.buildings);
                    Debug.Log($"[ROSBridge] Received {data.buildings.Length} Gazebo buildings");
                }
            });

            // Static no-fly zones from Gazebo world (once)
            rosConnection.Subscribe<StringMsg>(TopicWorldNoFly, (msg) =>
            {
                var data = JsonUtility.FromJson<GazeboNoFlyZonesMsg>(msg.data);
                if (data?.zones != null)
                {
                    NoFlyZones = data.zones;
                    OnGazeboNoFlyZonesReceived?.Invoke(data.zones);
                    Debug.Log($"[ROSBridge] Received {data.zones.Length} Gazebo no-fly zones");
                }
            });

            // Dynamic obstacles from Gazebo
            rosConnection.Subscribe<StringMsg>(TopicGazeboObstacles, (msg) =>
            {
                var data = JsonUtility.FromJson<GazeboObstacleMsg>(msg.data);
                if (data != null)
                {
                    OnGazeboObstacle?.Invoke(data);
                    Debug.Log($"[ROSBridge] Gazebo obstacle: {data.obstacle_type} near {data.near_location}");
                }
            });

            // Weather from Gazebo atmosphere (1 Hz)
            rosConnection.Subscribe<StringMsg>(TopicGazeboWeather, (msg) =>
            {
                var data = JsonUtility.FromJson<GazeboWeatherMsg>(msg.data);
                if (data != null)
                {
                    LatestWeather = data;
                    OnGazeboWeather?.Invoke(data);
                }
            });

            Debug.Log("[ROSBridge] Subscribed to Gazebo bridge topics: drone_pose, buildings, nofly_zones, obstacles, weather");
#endif
        }

        // ------------------------------------------------------------------
        // Publishing (Unity → ROS)
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
        // Subscribing (legacy custom topics)
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
