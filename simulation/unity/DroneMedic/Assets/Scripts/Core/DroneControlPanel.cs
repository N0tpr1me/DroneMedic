using System.Collections.Generic;
using UnityEngine;

namespace DroneMedic
{
    /// <summary>
    /// In-game control panel GUI for PX4Live mode.
    /// Provides buttons for Takeoff, Land, Hold, Goto waypoints, and Start Mission.
    /// Also sends commands back to PX4 via PX4TelemetryClient.
    /// </summary>
    public class DroneControlPanel : MonoBehaviour
    {
        [Header("References")]
        [SerializeField] private PX4TelemetryClient px4Client;
        [SerializeField] private DroneConfig config;

        [Header("Panel Settings")]
        [SerializeField] private float panelWidth = 420f;
        [SerializeField] private float panelX = 16f;

        private bool _showWaypointMenu;
        private Vector2 _waypointScroll;
        private string _selectedWaypoint = "";
        private float _gotoAltitude = 50f;

        // Cached styles
        private GUIStyle _headerStyle;
        private GUIStyle _subHeaderStyle;
        private GUIStyle _labelStyle;
        private GUIStyle _buttonStyle;
        private GUIStyle _toggleStyle;
        private GUIStyle _boxStyle;
        private bool _stylesInit;

        private void Start()
        {
            if (px4Client == null)
                px4Client = FindAnyObjectByType<PX4TelemetryClient>();
        }

        private void InitStyles()
        {
            if (_stylesInit) return;
            _stylesInit = true;

            _headerStyle = new GUIStyle(GUI.skin.label)
            {
                fontStyle = FontStyle.Bold,
                fontSize = 22,
                alignment = TextAnchor.MiddleLeft
            };
            _headerStyle.normal.textColor = Color.white;

            _subHeaderStyle = new GUIStyle(GUI.skin.label)
            {
                fontStyle = FontStyle.Bold,
                fontSize = 16
            };

            _labelStyle = new GUIStyle(GUI.skin.label) { fontSize = 15 };

            _buttonStyle = new GUIStyle(GUI.skin.button)
            {
                fontSize = 16,
                fontStyle = FontStyle.Bold
            };

            _toggleStyle = new GUIStyle(GUI.skin.toggle) { fontSize = 15 };

            _boxStyle = new GUIStyle(GUI.skin.box) { fontSize = 14 };
        }

        private void OnGUI()
        {
            if (px4Client == null) return;

            var sim = SimulationManager.Instance;
            if (sim == null || sim.CurrentDemoMode != DemoMode.PX4Live) return;

            InitStyles();

            // Scale for 4K
            float scale = Screen.height / 1080f;
            float pw = panelWidth * scale;
            float px = panelX * scale;

            // Position below the SimulationManager debug GUI
            float yOffset = 10f * scale + (sim.ActiveDrones.Count * 80f * scale) + 160f * scale;
            float panelHeight = (_showWaypointMenu ? 560f : 340f) * scale;

            GUI.Box(new Rect(px, yOffset, pw, panelHeight), "", _boxStyle);

            GUILayout.BeginArea(new Rect(px + 10f * scale, yOffset + 10f * scale, pw - 20f * scale, panelHeight - 20f * scale));

            GUILayout.Label("PX4 Drone Control", _headerStyle);
            GUILayout.Space(6f * scale);

            // Connection status
            string connStatus = px4Client.IsConnected ? "Connected" : "Disconnected";
            var connStyle = new GUIStyle(_labelStyle);
            connStyle.normal.textColor = px4Client.IsConnected ? Color.green : Color.red;
            connStyle.fontStyle = FontStyle.Bold;
            GUILayout.Label($"Bridge: {connStatus}", connStyle);

            // Telemetry source
            if (px4Client.LatestTelemetry != null)
            {
                var t = px4Client.LatestTelemetry;
                GUILayout.Label($"Source: {t.source}  |  Mode: {t.flight_mode}", _labelStyle);
                GUILayout.Label($"GPS: {t.lat:F5}, {t.lon:F5}  |  Alt: {t.alt_m:F1}m", _labelStyle);
            }

            GUILayout.Space(12f * scale);

            // -- Flight Commands --
            float btnH = 48f * scale;

            GUILayout.BeginHorizontal();
            if (GUILayout.Button("TAKEOFF", _buttonStyle, GUILayout.Height(btnH)))
                px4Client.SendTakeoff();
            if (GUILayout.Button("LAND", _buttonStyle, GUILayout.Height(btnH)))
                px4Client.SendLand();
            GUILayout.EndHorizontal();

            GUILayout.Space(4f * scale);

            GUILayout.BeginHorizontal();
            if (GUILayout.Button("HOLD", _buttonStyle, GUILayout.Height(btnH)))
                px4Client.SendHold();
            if (GUILayout.Button("MISSION", _buttonStyle, GUILayout.Height(btnH)))
                px4Client.SendStartMission();
            GUILayout.EndHorizontal();

            GUILayout.Space(8f * scale);

            // -- Goto Waypoint --
            _showWaypointMenu = GUILayout.Toggle(_showWaypointMenu, "  Goto Waypoint...", _toggleStyle, GUILayout.Height(28f * scale));

            if (_showWaypointMenu && config != null)
            {
                GUILayout.Space(4f * scale);
                _gotoAltitude = GUILayout.HorizontalSlider(_gotoAltitude, 10f, 120f, GUILayout.Height(20f * scale));
                GUILayout.Label($"Altitude: {_gotoAltitude:F0}m", _labelStyle);

                _waypointScroll = GUILayout.BeginScrollView(_waypointScroll, GUILayout.Height(180f * scale));

                string[] locations = { "Depot", "Clinic A", "Clinic B", "Clinic C", "Clinic D",
                                        "Royal London", "Homerton", "Newham General", "Whipps Cross" };

                foreach (string loc in locations)
                {
                    var locData = config.GetLocation(loc);
                    if (locData == null) continue;

                    var style = new GUIStyle(_buttonStyle);
                    if (_selectedWaypoint == loc)
                        style.normal.textColor = Color.cyan;

                    if (GUILayout.Button(loc, style, GUILayout.Height(36f * scale)))
                    {
                        _selectedWaypoint = loc;
                        px4Client.SendGoto(locData.latitude, locData.longitude, _gotoAltitude);
                        Debug.Log($"[ControlPanel] Goto {loc} ({locData.latitude:F5}, {locData.longitude:F5}) alt={_gotoAltitude:F0}m");
                    }
                }

                GUILayout.EndScrollView();
            }

            // -- Start/Stop Simulation --
            GUILayout.Space(8f * scale);
            if (sim.IsRunning)
            {
                var stopStyle = new GUIStyle(_buttonStyle);
                stopStyle.normal.textColor = new Color(1f, 0.4f, 0.4f);
                if (GUILayout.Button("STOP SIMULATION", stopStyle, GUILayout.Height(btnH)))
                    sim.StopSimulation();
            }
            else
            {
                var startStyle = new GUIStyle(_buttonStyle);
                startStyle.normal.textColor = Color.green;
                if (GUILayout.Button("START PX4 LIVE", startStyle, GUILayout.Height(btnH)))
                    sim.StartSimulation();
            }

            GUILayout.EndArea();
        }
    }
}
