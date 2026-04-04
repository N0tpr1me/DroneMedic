using System;
using System.Collections.Generic;
using UnityEngine;

namespace DroneMedic
{
    /// <summary>
    /// Loads hospitals.json and spawns geo-anchored markers on the Cesium globe.
    /// Place hospitals.json in Assets/Resources/ so it can be loaded at runtime.
    /// </summary>
    public class HospitalLoader : MonoBehaviour
    {
        [Header("References")]
        [SerializeField] private GoogleMaps3DTiles mapTiles;
        [SerializeField] private DroneConfig config;

        [Header("Marker Settings")]
        [SerializeField] private float markerHeight = 30f; // meters above ground
        [SerializeField] private float markerScale = 2f;
        [SerializeField] private Color hospitalColor = new Color(0.2f, 0.83f, 0.6f, 1f); // #34d399
        [SerializeField] private Color selectedColor = new Color(0f, 0.85f, 0.95f, 1f);  // #00daf3

        [Header("Loading")]
        [SerializeField] private bool loadOnStart = true;
        [SerializeField] private string jsonResourceName = "hospitals";

        private readonly List<HospitalMarker> _markers = new List<HospitalMarker>();
        private HospitalData[] _hospitals;

        public IReadOnlyList<HospitalMarker> Markers => _markers;
        public HospitalData[] Hospitals => _hospitals;

        private void Start()
        {
            if (mapTiles == null)
                mapTiles = FindAnyObjectByType<GoogleMaps3DTiles>();

            if (loadOnStart)
                LoadHospitals();
        }

        public void LoadHospitals()
        {
            var jsonAsset = Resources.Load<TextAsset>(jsonResourceName);
            if (jsonAsset == null)
            {
                Debug.LogError($"[HospitalLoader] Could not load Resources/{jsonResourceName}.json");
                return;
            }

            _hospitals = JsonHelper.FromJson<HospitalData>(jsonAsset.text);
            Debug.Log($"[HospitalLoader] Loaded {_hospitals.Length} hospitals.");

            SpawnMarkers();

            // Also inject hospitals as available locations in DroneConfig
            if (config != null)
                InjectLocationsIntoConfig();
        }

        private void SpawnMarkers()
        {
            // Clear existing
            foreach (var m in _markers)
            {
                if (m != null && m.gameObject != null)
                    Destroy(m.gameObject);
            }
            _markers.Clear();

            var parent = new GameObject("Hospitals");
            parent.transform.SetParent(transform, false);

            foreach (var hospital in _hospitals)
            {
                if (hospital.lat == 0 && hospital.lon == 0) continue;

                var go = GameObject.CreatePrimitive(PrimitiveType.Sphere);
                go.name = hospital.name;
                go.transform.SetParent(parent.transform, false);
                go.transform.localScale = Vector3.one * markerScale;

                // Remove collider to save perf with 500+ objects
                var col = go.GetComponent<Collider>();
                if (col != null) Destroy(col);

                // Color
                var rend = go.GetComponent<Renderer>();
                if (rend != null)
                {
                    var mat = new Material(Shader.Find("Sprites/Default"));
                    mat.color = hospitalColor;
                    rend.material = mat;
                }

                // Position via Cesium geo-conversion
                Vector3 worldPos;
                if (mapTiles != null)
                    worldPos = mapTiles.GeoToUnity(hospital.lat, hospital.lon, markerHeight);
                else if (config != null)
                    worldPos = config.GeoToWorld(hospital.lat, hospital.lon, markerHeight);
                else
                    worldPos = Vector3.zero;

                go.transform.position = worldPos;

                // Add anchor for geo tracking
                var anchor = go.AddComponent<GeoLocationAnchor>();
                anchor.SetCoordinates(hospital.lat, hospital.lon, markerHeight);

                var marker = go.AddComponent<HospitalMarker>();
                marker.Initialize(hospital, hospitalColor, selectedColor);
                _markers.Add(marker);
            }

            Debug.Log($"[HospitalLoader] Spawned {_markers.Count} hospital markers.");
        }

        /// <summary>
        /// Inject all hospitals as selectable delivery locations in DroneConfig.
        /// Keeps the Depot, replaces the demo clinics.
        /// </summary>
        private void InjectLocationsIntoConfig()
        {
            var locations = new List<LocationData>();

            // Keep Depot
            var depot = config.GetLocation("Depot");
            if (depot != null)
                locations.Add(depot);

            // Add all hospitals
            foreach (var h in _hospitals)
            {
                if (h.lat == 0 && h.lon == 0) continue;
                locations.Add(new LocationData
                {
                    name = h.name,
                    latitude = h.lat,
                    longitude = h.lon,
                    description = $"{h.type} — {h.region} — {h.beds} beds",
                    priority = "normal"
                });
            }

            config.locations = locations.ToArray();
            Debug.Log($"[HospitalLoader] Injected {locations.Count} locations into DroneConfig.");
        }

        /// <summary>
        /// Highlight a specific hospital by name (e.g. when selected as delivery target).
        /// </summary>
        public HospitalMarker SelectHospital(string hospitalName)
        {
            foreach (var m in _markers)
            {
                bool isTarget = m.Data.name == hospitalName;
                m.SetSelected(isTarget);
                if (isTarget) return m;
            }
            return null;
        }
    }

    // ── Data Types ──

    [Serializable]
    public class HospitalData
    {
        public string name;
        public string type;
        public string address;
        public double lat;
        public double lon;
        public string region;
        public int beds;
    }

    /// <summary>
    /// Helper to deserialize JSON arrays (Unity's JsonUtility doesn't support root arrays).
    /// </summary>
    public static class JsonHelper
    {
        public static T[] FromJson<T>(string json)
        {
            string wrapped = "{\"items\":" + json + "}";
            var wrapper = JsonUtility.FromJson<Wrapper<T>>(wrapped);
            return wrapper.items;
        }

        [Serializable]
        private class Wrapper<T>
        {
            public T[] items;
        }
    }

    /// <summary>
    /// Attached to each hospital sphere in the scene.
    /// </summary>
    public class HospitalMarker : MonoBehaviour
    {
        private HospitalData _data;
        private Color _normalColor;
        private Color _selectedColor;
        private Renderer _renderer;
        private bool _selected;

        public HospitalData Data => _data;
        public bool IsSelected => _selected;

        public void Initialize(HospitalData data, Color normal, Color selected)
        {
            _data = data;
            _normalColor = normal;
            _selectedColor = selected;
            _renderer = GetComponent<Renderer>();
        }

        public void SetSelected(bool selected)
        {
            _selected = selected;
            if (_renderer != null)
                _renderer.material.color = selected ? _selectedColor : _normalColor;

            // Scale up selected markers
            transform.localScale = selected
                ? Vector3.one * 4f
                : Vector3.one * 2f;
        }

        private void Update()
        {
            if (!_selected) return;
            // Pulse effect for selected hospital
            float pulse = 1f + Mathf.Sin(Time.time * 3f) * 0.15f;
            transform.localScale = Vector3.one * 4f * pulse;
        }

#if UNITY_EDITOR
        private void OnDrawGizmosSelected()
        {
            if (_data != null)
            {
                UnityEditor.Handles.Label(
                    transform.position + Vector3.up * 5f,
                    $"{_data.name}\n{_data.beds} beds — {_data.region}");
            }
        }
#endif
    }
}
