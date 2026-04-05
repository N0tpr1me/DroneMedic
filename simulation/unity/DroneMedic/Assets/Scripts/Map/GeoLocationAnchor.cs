using UnityEngine;
using Unity.Mathematics;
using CesiumForUnity;

namespace DroneMedic
{
    /// <summary>
    /// Anchors a GameObject to a WGS84 lat/lon/height position on the Cesium globe.
    /// Attach to any object that needs to be geo-positioned (waypoints, drones, markers).
    /// </summary>
    [ExecuteInEditMode]
    public class GeoLocationAnchor : MonoBehaviour
    {
        [Header("WGS84 Coordinates")]
        [SerializeField] private double latitude;
        [SerializeField] private double longitude;
        [SerializeField] private double height;

        [Header("Auto-update")]
        [SerializeField] private bool updateEveryFrame;

        private CesiumGeoreference _georeference;
        private bool _initialized;

        public double Latitude => latitude;
        public double Longitude => longitude;
        public double Height => height;

        private void Start()
        {
            FindGeoreference();
            UpdatePosition();
        }

        private void Update()
        {
            if (updateEveryFrame && _initialized)
                UpdatePosition();
        }

        public void SetCoordinates(double lat, double lon, double h)
        {
            latitude = lat;
            longitude = lon;
            height = h;

            if (_initialized)
                UpdatePosition();
        }

        public void FindGeoreference()
        {
            _georeference = FindAnyObjectByType<CesiumGeoreference>();
            _initialized = _georeference != null;

            if (!_initialized)
                Debug.LogWarning($"[GeoLocationAnchor] No CesiumGeoreference found for {gameObject.name}.");
        }

        private void UpdatePosition()
        {
            if (_georeference == null) return;

            double3 ecef = CesiumWgs84Ellipsoid.LongitudeLatitudeHeightToEarthCenteredEarthFixed(
                new double3(longitude, latitude, height)
            );

            double3 local = _georeference.TransformEarthCenteredEarthFixedPositionToUnity(ecef);
            transform.position = new Vector3((float)local.x, (float)local.y, (float)local.z);
        }
    }
}
