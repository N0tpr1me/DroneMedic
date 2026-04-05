using System;
using System.Collections.Generic;
using UnityEngine;

namespace DroneMedic
{
    [Serializable]
    public class RouteViolation
    {
        public string fromLocation;
        public string toLocation;
        public string zoneName;
    }

    public class GeofenceManager : MonoBehaviour
    {
        public static GeofenceManager Instance { get; private set; }

        [SerializeField] private DroneConfig config;

        private List<NoFlyZoneData> _runtimeZones = new List<NoFlyZoneData>();

        private void Awake()
        {
            if (Instance != null && Instance != this)
            {
                Destroy(gameObject);
                return;
            }
            Instance = this;
            ResetNoFlyZones();
        }

        /// <summary>
        /// Ray-casting algorithm to check if a geo point is inside a zone polygon.
        /// Works in lat/lon space (sufficient for small areas like a city).
        /// </summary>
        public bool PointInPolygon(double lat, double lon, GeoPoint[] polygon)
        {
            int n = polygon.Length;
            bool inside = false;
            int j = n - 1;

            for (int i = 0; i < n; i++)
            {
                double yi = polygon[i].latitude;
                double xi = polygon[i].longitude;
                double yj = polygon[j].latitude;
                double xj = polygon[j].longitude;

                if (((yi > lat) != (yj > lat)) &&
                    (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi))
                {
                    inside = !inside;
                }
                j = i;
            }
            return inside;
        }

        /// <summary>
        /// Check if a geo point falls inside any no-fly zone.
        /// </summary>
        public (bool inZone, string zoneName) IsInNoFlyZone(double lat, double lon)
        {
            foreach (var zone in _runtimeZones)
            {
                if (zone.corners != null && PointInPolygon(lat, lon, zone.corners))
                    return (true, zone.name);
            }
            return (false, null);
        }

        /// <summary>
        /// Check if line segment (p1,p2) intersects with segment (p3,p4).
        /// </summary>
        private static bool SegmentsIntersect(
            double x1, double y1, double x2, double y2,
            double x3, double y3, double x4, double y4)
        {
            double Cross(double ox, double oy, double ax, double ay, double bx, double by)
                => (ax - ox) * (by - oy) - (ay - oy) * (bx - ox);

            double d1 = Cross(x3, y3, x4, y4, x1, y1);
            double d2 = Cross(x3, y3, x4, y4, x2, y2);
            double d3 = Cross(x1, y1, x2, y2, x3, y3);
            double d4 = Cross(x1, y1, x2, y2, x4, y4);

            return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
                   ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
        }

        /// <summary>
        /// Check if a flight path segment (in lat/lon) crosses any no-fly zone.
        /// </summary>
        public (bool crosses, string zoneName) SegmentCrossesNoFlyZone(
            double fromLat, double fromLon, double toLat, double toLon)
        {
            foreach (var zone in _runtimeZones)
            {
                if (zone.corners == null || zone.corners.Length < 3) continue;

                // Endpoint containment
                if (PointInPolygon(fromLat, fromLon, zone.corners) ||
                    PointInPolygon(toLat, toLon, zone.corners))
                    return (true, zone.name);

                // Edge intersection
                int n = zone.corners.Length;
                for (int i = 0; i < n; i++)
                {
                    int j = (i + 1) % n;
                    if (SegmentsIntersect(
                        fromLon, fromLat, toLon, toLat,
                        zone.corners[i].longitude, zone.corners[i].latitude,
                        zone.corners[j].longitude, zone.corners[j].latitude))
                        return (true, zone.name);
                }
            }
            return (false, null);
        }

        /// <summary>
        /// Check an ordered route for no-fly zone violations.
        /// </summary>
        public List<RouteViolation> CheckRouteSafety(List<string> locationNames)
        {
            var violations = new List<RouteViolation>();

            for (int i = 0; i < locationNames.Count - 1; i++)
            {
                string loc1Name = locationNames[i];
                string loc2Name = locationNames[i + 1];

                LocationData loc1 = config.GetLocation(loc1Name);
                LocationData loc2 = config.GetLocation(loc2Name);
                if (loc1 == null || loc2 == null) continue;

                var (crosses, zoneName) = SegmentCrossesNoFlyZone(
                    loc1.latitude, loc1.longitude,
                    loc2.latitude, loc2.longitude);

                if (crosses)
                {
                    violations.Add(new RouteViolation
                    {
                        fromLocation = loc1Name,
                        toLocation = loc2Name,
                        zoneName = zoneName
                    });
                    Debug.LogWarning($"[GEOFENCE] Route {loc1Name} → {loc2Name} crosses {zoneName}");
                }
            }
            return violations;
        }

        public void AddNoFlyZone(NoFlyZoneData zone)
        {
            _runtimeZones.RemoveAll(z => z.name == zone.name);
            _runtimeZones.Add(zone);
            Debug.Log($"[GEOFENCE] Added/updated zone: {zone.name}");
        }

        public bool RemoveNoFlyZone(string name)
        {
            int removed = _runtimeZones.RemoveAll(z => z.name == name);
            if (removed > 0) Debug.Log($"[GEOFENCE] Removed zone: {name}");
            return removed > 0;
        }

        public void ResetNoFlyZones()
        {
            _runtimeZones.Clear();
            if (config != null && config.noFlyZones != null)
            {
                foreach (var zone in config.noFlyZones)
                {
                    var copy = new GeoPoint[zone.corners.Length];
                    for (int i = 0; i < zone.corners.Length; i++)
                        copy[i] = new GeoPoint(zone.corners[i].latitude, zone.corners[i].longitude);

                    _runtimeZones.Add(new NoFlyZoneData
                    {
                        name = zone.name,
                        corners = copy
                    });
                }
            }
        }

        public List<NoFlyZoneData> GetAllZones() => new List<NoFlyZoneData>(_runtimeZones);
    }
}
