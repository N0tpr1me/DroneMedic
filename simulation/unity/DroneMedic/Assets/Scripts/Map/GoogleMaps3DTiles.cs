using UnityEngine;
using Unity.Mathematics;
using CesiumForUnity;
using System.Collections;

namespace DroneMedic
{
    /// <summary>
    /// Sets up Google Maps Photorealistic 3D Tiles via Cesium for Unity.
    /// Attach to a root GameObject — it creates the full Cesium hierarchy at runtime.
    /// </summary>
    [ExecuteInEditMode]
    public class GoogleMaps3DTiles : MonoBehaviour
    {
        [Header("Google Maps")]
        [SerializeField] private string apiKey = "";

        [Header("Origin (Depot)")]
        [SerializeField] private double originLatitude = 51.5074;
        [SerializeField] private double originLongitude = -0.1278;
        [SerializeField] private double originHeight = 0.0;

        [Header("Tileset")]
        [SerializeField] private float maximumScreenSpaceError = 8f;

        private CesiumGeoreference _georeference;
        private Cesium3DTileset _tileset;
        private string _lastApiKey;
        private bool _ready;

        public CesiumGeoreference Georeference => _georeference;

        /// <summary>True once the georeference is initialized and GeoToUnity returns valid positions.</summary>
        public bool IsReady => _ready && _georeference != null;

        private void Awake()
        {
            // Get existing georeference (may already exist in the scene)
            _georeference = GetComponent<CesiumGeoreference>();
            FindOrCreateTileset();
        }

        private void Start()
        {
            SetupGeoreference();
            // Mark ready after one frame to let Cesium process the georeference
            StartCoroutine(MarkReadyNextFrame());
        }

        private IEnumerator MarkReadyNextFrame()
        {
            yield return null; // wait one frame
            yield return null; // wait second frame for safety
            _ready = true;
            Debug.Log("[GoogleMaps3DTiles] Georeference ready — GeoToUnity is now valid.");
        }

        /// <summary>Wait until GeoToUnity will return valid positions.</summary>
        public IEnumerator WaitForReady()
        {
            while (!IsReady)
                yield return null;
        }

        private void OnValidate()
        {
            if (_georeference != null)
            {
                _georeference.latitude = originLatitude;
                _georeference.longitude = originLongitude;
                _georeference.height = originHeight;
            }

            if (_tileset != null && apiKey != _lastApiKey)
            {
                _lastApiKey = apiKey;
                _tileset.url = $"https://tile.googleapis.com/v1/3dtiles/root.json?key={apiKey}";
            }
        }

        private void SetupGeoreference()
        {
            if (_georeference == null)
                _georeference = GetComponent<CesiumGeoreference>();
            if (_georeference == null)
                _georeference = gameObject.AddComponent<CesiumGeoreference>();

            _georeference.latitude = originLatitude;
            _georeference.longitude = originLongitude;
            _georeference.height = originHeight;
        }

        private void FindOrCreateTileset()
        {
            var existing = GetComponentInChildren<Cesium3DTileset>();
            if (existing != null)
            {
                _tileset = existing;
                _tileset.url = $"https://tile.googleapis.com/v1/3dtiles/root.json?key={apiKey}";
                _lastApiKey = apiKey;
                return;
            }

            var tilesetObj = new GameObject("Google3DTiles");
            tilesetObj.transform.SetParent(transform, false);

            _tileset = tilesetObj.AddComponent<Cesium3DTileset>();
            _tileset.url = $"https://tile.googleapis.com/v1/3dtiles/root.json?key={apiKey}";
            _tileset.maximumScreenSpaceError = maximumScreenSpaceError;
            _tileset.showCreditsOnScreen = true;
            _lastApiKey = apiKey;
        }

        /// <summary>
        /// Convert WGS84 lat/lon/height to Unity world position via the georeference.
        /// Returns Vector3.zero if not ready — use IsReady or WaitForReady() first.
        /// </summary>
        public Vector3 GeoToUnity(double latitude, double longitude, double height)
        {
            if (_georeference == null) return Vector3.zero;

            double3 ecef = CesiumWgs84Ellipsoid.LongitudeLatitudeHeightToEarthCenteredEarthFixed(
                new double3(longitude, latitude, height)
            );

            double3 local = _georeference.TransformEarthCenteredEarthFixedPositionToUnity(ecef);
            return new Vector3((float)local.x, (float)local.y, (float)local.z);
        }

        /// <summary>
        /// Convert Unity world position back to WGS84 lat/lon/height.
        /// </summary>
        public (double latitude, double longitude, double height) UnityToGeo(Vector3 worldPos)
        {
            if (_georeference == null) return (0, 0, 0);

            double3 ecef = _georeference.TransformUnityPositionToEarthCenteredEarthFixed(
                new double3(worldPos.x, worldPos.y, worldPos.z)
            );

            double3 llh = CesiumWgs84Ellipsoid.EarthCenteredEarthFixedToLongitudeLatitudeHeight(ecef);
            return (llh.y, llh.x, llh.z);
        }
    }
}
