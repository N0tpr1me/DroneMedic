using UnityEngine;

namespace DroneMedic
{
    /// <summary>
    /// Visualizes no-fly zones as transparent red polygons.
    /// Positions are resolved from geo-coordinates via DroneConfig.
    /// </summary>
    public class NoFlyZoneVisualizer : MonoBehaviour
    {
        [SerializeField] private string zoneName = "";
        [SerializeField] private Color zoneColor = new Color(1f, 0f, 0f, 0.3f);

        private GeoPoint[] _corners;
        private DroneConfig _config;
        private Mesh _mesh;
        private Material _material;
        private float _warningTimer;
        private Color _baseColor;

        private void Awake()
        {
            _baseColor = zoneColor;
        }

        private void Update()
        {
            if (_warningTimer > 0f)
            {
                _warningTimer -= Time.deltaTime;
                float flash = Mathf.PingPong(Time.time * 6f, 1f);
                Color warningColor = new Color(
                    _baseColor.r, _baseColor.g, _baseColor.b,
                    Mathf.Lerp(_baseColor.a, 0.8f, flash));
                _material.color = warningColor;

                if (_warningTimer <= 0f)
                    _material.color = _baseColor;
            }
        }

        private void OnRenderObject()
        {
            if (_mesh == null || _material == null) return;
            _material.SetPass(0);
            Graphics.DrawMeshNow(_mesh, Matrix4x4.identity);
        }

        public void ShowWarning()
        {
            _warningTimer = 2f;
        }

        /// <summary>
        /// Create a visualizer from geo-based zone data.
        /// </summary>
        public static NoFlyZoneVisualizer CreateFromData(NoFlyZoneData data, DroneConfig config)
        {
            var go = new GameObject($"NoFlyZone_{data.name}");
            var viz = go.AddComponent<NoFlyZoneVisualizer>();
            viz.zoneName = data.name;
            viz._corners = data.corners;
            viz._config = config;
            viz._baseColor = viz.zoneColor;
            viz.BuildMesh();
            viz.CreateMaterial();
            return viz;
        }

        private void BuildMesh()
        {
            if (_corners == null || _corners.Length < 3 || _config == null) return;

            _mesh = new Mesh();

            // Convert geo corners to Unity world positions at ground level
            var vertices = new Vector3[_corners.Length];
            for (int i = 0; i < _corners.Length; i++)
            {
                Vector3 world = _config.GeoToWorld(_corners[i].latitude, _corners[i].longitude, 1.0);
                vertices[i] = world;
            }

            _mesh.vertices = vertices;
            _mesh.triangles = Triangulate(vertices);
            _mesh.RecalculateNormals();
        }

        private void CreateMaterial()
        {
            _material = new Material(Shader.Find("Sprites/Default"));
            _material.color = zoneColor;
        }

        private static int[] Triangulate(Vector3[] points)
        {
            // Simple ear-clipping in XZ plane
            var indices = new System.Collections.Generic.List<int>();
            var remaining = new System.Collections.Generic.List<int>();
            for (int i = 0; i < points.Length; i++) remaining.Add(i);

            while (remaining.Count > 2)
            {
                bool earFound = false;
                for (int i = 0; i < remaining.Count; i++)
                {
                    int prev = remaining[(i - 1 + remaining.Count) % remaining.Count];
                    int curr = remaining[i];
                    int next = remaining[(i + 1) % remaining.Count];

                    Vector2 a = new Vector2(points[prev].x, points[prev].z);
                    Vector2 b = new Vector2(points[curr].x, points[curr].z);
                    Vector2 c = new Vector2(points[next].x, points[next].z);

                    float cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
                    if (cross <= 0f) continue;

                    indices.Add(prev);
                    indices.Add(curr);
                    indices.Add(next);
                    remaining.RemoveAt(i);
                    earFound = true;
                    break;
                }
                if (!earFound) break;
            }
            return indices.ToArray();
        }

#if UNITY_EDITOR
        private void OnDrawGizmos()
        {
            if (_corners == null || _corners.Length < 3 || _config == null) return;

            Gizmos.color = new Color(zoneColor.r, zoneColor.g, zoneColor.b, 1f);
            for (int i = 0; i < _corners.Length; i++)
            {
                int j = (i + 1) % _corners.Length;
                Vector3 from = _config.GeoToWorld(_corners[i].latitude, _corners[i].longitude, 1.0);
                Vector3 to = _config.GeoToWorld(_corners[j].latitude, _corners[j].longitude, 1.0);
                Gizmos.DrawLine(from, to);
            }

            if (!string.IsNullOrEmpty(zoneName))
            {
                Vector3 center = Vector3.zero;
                for (int i = 0; i < _corners.Length; i++)
                    center += _config.GeoToWorld(_corners[i].latitude, _corners[i].longitude, 1.0);
                center /= _corners.Length;
                UnityEditor.Handles.Label(center + Vector3.up * 5f, zoneName);
            }
        }
#endif
    }
}
