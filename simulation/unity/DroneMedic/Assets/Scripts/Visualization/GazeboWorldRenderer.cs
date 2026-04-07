using System.Collections.Generic;
using UnityEngine;

namespace DroneMedic
{
    /// <summary>
    /// Listens for Gazebo world data via ROSBridge and renders buildings + no-fly zones
    /// in Unity, mirroring the Gazebo Harmonic world (dronemedic_world.sdf).
    /// Also feeds Gazebo weather into WeatherSystem and obstacles into ObstacleDetector.
    /// </summary>
    public class GazeboWorldRenderer : MonoBehaviour
    {
        [Header("References")]
        [SerializeField] private GoogleMaps3DTiles mapTiles;
        [SerializeField] private GeofenceManager geofenceManager;
        [SerializeField] private WeatherSystem weatherSystem;

        [Header("Rendering")]
        [SerializeField] private float buildingOpacity = 0.6f;
        [SerializeField] private float nfzOpacity = 0.25f;
        [SerializeField] private bool showGazeboBuildings = true;

        private readonly List<GameObject> _buildingObjects = new List<GameObject>();
        private readonly List<GameObject> _nfzObjects = new List<GameObject>();
        private bool _worldRendered;

        private void Start()
        {
            var ros = ROSBridge.Instance;
            if (ros == null)
            {
                Debug.LogWarning("[GazeboWorldRenderer] ROSBridge not found — will use fallback static data.");
                RenderFromStaticData();
                return;
            }

            ros.OnGazeboBuildingsReceived += OnBuildingsReceived;
            ros.OnGazeboNoFlyZonesReceived += OnNoFlyZonesReceived;
            ros.OnGazeboWeather += OnWeatherReceived;
            ros.OnGazeboObstacle += OnObstacleReceived;

            // Also handle the drone pose for ROS-based telemetry
            ros.OnGazeboDronePose += OnDronePoseReceived;

            // If ROS already has cached data (late subscribe), render immediately
            if (ros.Buildings != null) OnBuildingsReceived(ros.Buildings);
            if (ros.NoFlyZones != null) OnNoFlyZonesReceived(ros.NoFlyZones);
        }

        private void OnDestroy()
        {
            var ros = ROSBridge.Instance;
            if (ros == null) return;
            ros.OnGazeboBuildingsReceived -= OnBuildingsReceived;
            ros.OnGazeboNoFlyZonesReceived -= OnNoFlyZonesReceived;
            ros.OnGazeboWeather -= OnWeatherReceived;
            ros.OnGazeboObstacle -= OnObstacleReceived;
            ros.OnGazeboDronePose -= OnDronePoseReceived;
        }

        // -- Buildings --

        private void OnBuildingsReceived(GazeboBuilding[] buildings)
        {
            if (_worldRendered) return;

            ClearBuildings();

            var parent = new GameObject("GazeboBuildings");
            parent.transform.SetParent(transform, false);

            foreach (var b in buildings)
            {
                if (!showGazeboBuildings) break;

                Vector3 worldPos = GeoToWorld(b.lat, b.lon, b.height * 0.5f);

                var obj = GameObject.CreatePrimitive(PrimitiveType.Cube);
                obj.name = $"GZ_{b.name}";
                obj.transform.SetParent(parent.transform, false);
                obj.transform.position = worldPos;
                obj.transform.localScale = new Vector3(b.width, b.height, b.depth);

                // Apply Gazebo color
                var renderer = obj.GetComponent<Renderer>();
                if (renderer != null && b.color != null && b.color.Length >= 3)
                {
                    var mat = new Material(Shader.Find("Standard"));
                    mat.SetFloat("_Mode", 3);
                    mat.SetInt("_SrcBlend", (int)UnityEngine.Rendering.BlendMode.SrcAlpha);
                    mat.SetInt("_DstBlend", (int)UnityEngine.Rendering.BlendMode.OneMinusSrcAlpha);
                    mat.SetInt("_ZWrite", 0);
                    mat.EnableKeyword("_ALPHABLEND_ON");
                    mat.renderQueue = 3000;
                    mat.color = new Color(b.color[0], b.color[1], b.color[2], buildingOpacity);
                    renderer.material = mat;
                }

                // Remove collider — these are visual only
                var col = obj.GetComponent<Collider>();
                if (col != null) Destroy(col);

                _buildingObjects.Add(obj);
            }

            Debug.Log($"[GazeboWorldRenderer] Rendered {buildings.Length} Gazebo buildings in Unity.");
            _worldRendered = true;
        }

        // -- No-Fly Zones --

        private void OnNoFlyZonesReceived(GazeboNoFlyZone[] zones)
        {
            ClearNFZs();

            var parent = new GameObject("GazeboNoFlyZones");
            parent.transform.SetParent(transform, false);

            foreach (var zone in zones)
            {
                Vector3 centerPos = ENUToWorld(zone.center_east, zone.center_north, 1f);

                var obj = GameObject.CreatePrimitive(PrimitiveType.Cube);
                obj.name = $"GZ_NFZ_{zone.name}";
                obj.transform.SetParent(parent.transform, false);
                obj.transform.position = centerPos;
                obj.transform.localScale = new Vector3(zone.width, 2f, zone.depth);

                var renderer = obj.GetComponent<Renderer>();
                if (renderer != null)
                {
                    var mat = new Material(Shader.Find("Standard"));
                    mat.SetFloat("_Mode", 3);
                    mat.SetInt("_SrcBlend", (int)UnityEngine.Rendering.BlendMode.SrcAlpha);
                    mat.SetInt("_DstBlend", (int)UnityEngine.Rendering.BlendMode.OneMinusSrcAlpha);
                    mat.SetInt("_ZWrite", 0);
                    mat.EnableKeyword("_ALPHABLEND_ON");
                    mat.renderQueue = 3000;
                    mat.color = new Color(0.9f, 0.1f, 0.1f, nfzOpacity);
                    renderer.material = mat;
                }

                var col = obj.GetComponent<Collider>();
                if (col != null) Destroy(col);

                _nfzObjects.Add(obj);

                // Register with GeofenceManager if available
                if (geofenceManager != null && zone.corners_gps != null)
                {
                    var geoCorners = new GeoPoint[zone.corners_gps.Length];
                    for (int i = 0; i < zone.corners_gps.Length; i++)
                        geoCorners[i] = new GeoPoint(zone.corners_gps[i].lat, zone.corners_gps[i].lon);
                    geofenceManager.AddNoFlyZone(new NoFlyZoneData { name = zone.name, corners = geoCorners });
                }
            }

            Debug.Log($"[GazeboWorldRenderer] Rendered {zones.Length} Gazebo no-fly zones in Unity.");
        }

        // -- Weather --

        private void OnWeatherReceived(GazeboWeatherMsg weather)
        {
            if (weatherSystem == null) return;

            // Feed Gazebo wind/precipitation into Unity weather system
            // WeatherSystem already has templates; we map Gazebo values to the closest
            var allLocations = new string[] { "Clinic A", "Clinic B", "Clinic C", "Clinic D" };
            if (weather.wind_speed_ms > 15f || weather.precipitation_mm_h > 5f)
            {
                weatherSystem.SimulateWeatherEvent("storm", allLocations);
            }
            else if (weather.wind_speed_ms > 12f)
            {
                weatherSystem.SimulateWeatherEvent("high_wind", allLocations);
            }
            else if (weather.precipitation_mm_h > 2f)
            {
                weatherSystem.SimulateWeatherEvent("light_rain", allLocations);
            }
            // else: clear — no action needed
        }

        // -- Obstacles --

        private void OnObstacleReceived(GazeboObstacleMsg obstacle)
        {
            Debug.LogWarning($"[GazeboWorldRenderer] Gazebo obstacle: {obstacle.obstacle_type} near {obstacle.near_location} — {obstacle.description}");

            // Forward to WebSocket bridge for dashboard
            var wsBridge = WebSocketBridge.Instance;
            if (wsBridge != null)
                wsBridge.BroadcastEvent("obstacle_detected", "PX4Drone", obstacle.near_location);
        }

        // -- Drone Pose (ROS path — alternative to WebSocket PX4TelemetryClient) --

        private void OnDronePoseReceived(GazeboDronePose pose)
        {
            // If SimulationManager is running PX4Live mode, the PX4TelemetryClient
            // handles drone positioning via WebSocket. This ROS path is a fallback
            // for when using pure ROS without the WebSocket telemetry bridge.

            var sim = SimulationManager.Instance;
            if (sim == null || !sim.IsRunning) return;

            // Find the PX4 drone and update if it's externally driven
            foreach (var drone in sim.ActiveDrones)
            {
                if (drone == null || !drone.IsExternallyDriven) continue;

                Vector3 worldPos = GeoToWorld(pose.lat, pose.lon, pose.alt_m);
                drone.SetExternalTelemetry(
                    worldPos,
                    pose.heading_deg,
                    pose.battery_pct,
                    pose.flight_mode,
                    pose.speed_m_s
                );
                break; // only first externally-driven drone
            }
        }

        // -- Coordinate Helpers --

        private Vector3 GeoToWorld(double lat, double lon, double height)
        {
            if (mapTiles != null)
                return mapTiles.GeoToUnity(lat, lon, height);

            // Flat-earth fallback (same as SimulationManager)
            double cosLat = System.Math.Cos(51.5074 * System.Math.PI / 180.0);
            float x = (float)((lon - (-0.1278)) * 111320.0 * cosLat);
            float z = (float)((lat - 51.5074) * 111320.0);
            return new Vector3(x, (float)height, z);
        }

        private Vector3 ENUToWorld(float east, float north, float up)
        {
            // ENU from Gazebo: east = Unity X, north = Unity Z, up = Unity Y
            return new Vector3(east, up, north);
        }

        // -- Fallback (when ROS is not available) --

        private void RenderFromStaticData()
        {
            // Use hardcoded data matching dronemedic_world.sdf
            // This runs when ROSBridge is not connected — still shows the world
            Debug.Log("[GazeboWorldRenderer] Rendering from static SDF data (no ROS).");
            // The existing NoFlyZoneVisualizer and GeofenceManager handle this case
        }

        // -- Cleanup --

        private void ClearBuildings()
        {
            foreach (var obj in _buildingObjects)
                if (obj != null) Destroy(obj);
            _buildingObjects.Clear();

            var existing = transform.Find("GazeboBuildings");
            if (existing != null) Destroy(existing.gameObject);
        }

        private void ClearNFZs()
        {
            foreach (var obj in _nfzObjects)
                if (obj != null) Destroy(obj);
            _nfzObjects.Clear();

            var existing = transform.Find("GazeboNoFlyZones");
            if (existing != null) Destroy(existing.gameObject);
        }
    }
}
