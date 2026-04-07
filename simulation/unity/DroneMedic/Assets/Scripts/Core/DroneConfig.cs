using System;
using System.Collections.Generic;
using UnityEngine;

namespace DroneMedic
{
    [CreateAssetMenu(fileName = "DroneConfig", menuName = "DroneMedic/Drone Config")]
    public class DroneConfig : ScriptableObject
    {
        [Header("Drone Settings")]
        public float droneVelocity = 5f;
        public float droneAltitude = 50f;  // meters above ground (WGS84 height)
        public float mockMoveDelay = 1.5f;

        [Header("Battery")]
        public float batteryCapacity = 100f;
        public float batteryDrainRate = 0.08f;
        public float batteryMinReserve = 20f;

        [Header("Weather Thresholds")]
        public float maxWindSpeed = 15f;
        public float maxPrecipitation = 5f;

        [Header("Payload")]
        public float maxPayloadKg = 5f;

        [Header("Priority")]
        [Range(0f, 1f)]
        public float priorityWeight = 0.3f;

        [Header("Fleet")]
        public int numDrones = 2;
        public string[] droneNames = { "Drone1", "Drone2" };

        [Header("Locations (Depot + hospitals injected at runtime by HospitalLoader)")]
        public LocationData[] locations = new[]
        {
            new LocationData
            {
                name = "Depot",
                latitude = 51.5074,
                longitude = -0.1278,
                description = "Main drone depot / base station"
            }
        };

        [Header("No-Fly Zones (WGS84 corners)")]
        public NoFlyZoneData[] noFlyZones = new[]
        {
            new NoFlyZoneData
            {
                name = "Military Zone Alpha",
                corners = new[]
                {
                    new GeoPoint(51.513, -0.132),
                    new GeoPoint(51.516, -0.132),
                    new GeoPoint(51.516, -0.126),
                    new GeoPoint(51.513, -0.126)
                }
            },
            new NoFlyZoneData
            {
                name = "Airport Exclusion",
                corners = new[]
                {
                    new GeoPoint(51.503, -0.115),
                    new GeoPoint(51.506, -0.115),
                    new GeoPoint(51.506, -0.108),
                    new GeoPoint(51.503, -0.108)
                }
            }
        };

        // -- Runtime reference to the map for geo->world conversion --
        private GoogleMaps3DTiles _mapRef;

        /// <summary>
        /// Must be called once at startup by SimulationManager to enable geo positioning.
        /// </summary>
        public void SetMapReference(GoogleMaps3DTiles map)
        {
            _mapRef = map;
        }

        public LocationData GetLocation(string locationName)
        {
            foreach (var loc in locations)
            {
                if (loc.name == locationName)
                    return loc;
            }
            return null;
        }

        /// <summary>
        /// Returns the Unity world position for a named location at drone altitude.
        /// Uses Cesium georeference when available, falls back to flat approximation.
        /// </summary>
        public Vector3 GetWorldPosition(string locationName)
        {
            var loc = GetLocation(locationName);
            if (loc == null) return Vector3.zero;

            if (_mapRef != null)
                return _mapRef.GeoToUnity(loc.latitude, loc.longitude, droneAltitude);

            // Fallback: flat Mercator approximation (1 degree lat ≈ 111320m)
            var depot = GetLocation("Depot");
            if (depot == null) return new Vector3(0, droneAltitude, 0);
            float dx = (float)((loc.longitude - depot.longitude) * 111320.0 * System.Math.Cos(depot.latitude * System.Math.PI / 180.0));
            float dz = (float)((loc.latitude - depot.latitude) * 111320.0);
            return new Vector3(dx, droneAltitude, dz);
        }

        /// <summary>
        /// Returns the Unity world position for a geo coordinate at the given height.
        /// </summary>
        public Vector3 GeoToWorld(double latitude, double longitude, double height)
        {
            if (_mapRef != null)
                return _mapRef.GeoToUnity(latitude, longitude, height);

            var depot = GetLocation("Depot");
            if (depot == null) return new Vector3(0, (float)height, 0);
            float dx = (float)((longitude - depot.longitude) * 111320.0 * System.Math.Cos(depot.latitude * System.Math.PI / 180.0));
            float dz = (float)((latitude - depot.latitude) * 111320.0);
            return new Vector3(dx, (float)height, dz);
        }

        public string[] GetLocationNames()
        {
            var names = new string[locations.Length];
            for (int i = 0; i < locations.Length; i++)
                names[i] = locations[i].name;
            return names;
        }
    }

    [Serializable]
    public class LocationData
    {
        public string name;
        public double latitude;
        public double longitude;
        public string description;
        [Tooltip("high or normal")]
        public string priority = "normal";
    }

    [Serializable]
    public class GeoPoint
    {
        public double latitude;
        public double longitude;

        public GeoPoint() { }
        public GeoPoint(double lat, double lon) { latitude = lat; longitude = lon; }
    }

    [Serializable]
    public class NoFlyZoneData
    {
        public string name;
        public GeoPoint[] corners;
    }
}
