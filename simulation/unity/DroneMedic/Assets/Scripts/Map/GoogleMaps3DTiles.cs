using UnityEngine;
using Unity.Mathematics;
using CesiumForUnity;

namespace DroneMedic
{
    /// <summary>
    /// Sets up Google Maps Photorealistic 3D Tiles via Cesium for Unity.
    /// Attach to a root GameObject — it creates the full Cesium hierarchy at runtime.
    /// </summary>
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

        public CesiumGeoreference Georeference => _georeference;

        private void Awake()
        {
            SetupGeoreference();
            SetupTileset();
        }

        private void SetupGeoreference()
        {
            _georeference = GetComponent<CesiumGeoreference>();
            if (_georeference == null)
                _georeference = gameObject.AddComponent<CesiumGeoreference>();

            _georeference.latitude = originLatitude;
            _georeference.longitude = originLongitude;
            _georeference.height = originHeight;
        }

        private void SetupTileset()
        {
            // Create tileset as child
            var tilesetObj = new GameObject("Google3DTiles");
            tilesetObj.transform.SetParent(transform, false);

            _tileset = tilesetObj.AddComponent<Cesium3DTileset>();
            _tileset.url = $"https://tile.googleapis.com/v1/3dtiles/root.json?key={apiKey}";
            _tileset.maximumScreenSpaceError = maximumScreenSpaceError;
            _tileset.showCreditsOnScreen = true;

            Debug.Log("[GoogleMaps3DTiles] Tileset configured — loading Google Photorealistic 3D Tiles.");
        }

        /// <summary>
        /// Convert WGS84 lat/lon/height to Unity world position via the georeference.
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
