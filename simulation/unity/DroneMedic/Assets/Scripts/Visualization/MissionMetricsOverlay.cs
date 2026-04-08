using UnityEngine;

namespace DroneMedic
{
    /// <summary>
    /// Real-time mission metrics overlay — shows energy budget, safety state,
    /// delivery progress, and flight stats in the top-right corner.
    /// Works with both simulated and PX4Live modes.
    /// </summary>
    public class MissionMetricsOverlay : MonoBehaviour
    {
        [Header("Display")]
        [SerializeField] private float panelWidth = 300f;
        [SerializeField] private float panelMargin = 10f;

        private void OnGUI()
        {
            var sim = SimulationManager.Instance;
            if (sim == null || !sim.IsRunning) return;

            float panelX = Screen.width - panelWidth - panelMargin;
            float panelY = panelMargin;

            int droneCount = sim.ActiveDrones.Count;
            float panelHeight = 140f + (droneCount * 100f);

            GUI.Box(new Rect(panelX, panelY, panelWidth, panelHeight), "");

            GUILayout.BeginArea(new Rect(panelX + 8f, panelY + 8f, panelWidth - 16f, panelHeight - 16f));

            // Header
            var header = new GUIStyle(GUI.skin.label) { fontStyle = FontStyle.Bold, fontSize = 14 };
            GUILayout.Label("Mission Metrics", header);

            // Mode
            GUILayout.Label($"Mode: {sim.CurrentDemoMode}");

            // Safety state
            string safetyState = sim.BatteryState;
            string action = sim.MissionAction;
            Color safetyColor = safetyState switch
            {
                "GREEN" => Color.green,
                "AMBER" => Color.yellow,
                "RED" => Color.red,
                _ => Color.white
            };
            var safetyStyle = new GUIStyle(GUI.skin.label) { fontStyle = FontStyle.Bold };
            safetyStyle.normal.textColor = safetyColor;
            GUILayout.Label($"Safety: {safetyState} | Action: {action}", safetyStyle);

            GUILayout.Space(6f);

            // Per-drone metrics
            foreach (var drone in sim.ActiveDrones)
            {
                if (drone == null) continue;

                GUILayout.Label($"━━ {drone.name} ━━");

                // Battery bar
                float batteryPct = drone.Battery / 100f;
                Color batteryColor = batteryPct > 0.4f ? Color.green : batteryPct > 0.2f ? Color.yellow : Color.red;

                Rect barRect = GUILayoutUtility.GetRect(panelWidth - 20f, 16f);
                GUI.color = new Color(0.2f, 0.2f, 0.2f);
                GUI.DrawTexture(barRect, Texture2D.whiteTexture);
                GUI.color = batteryColor;
                GUI.DrawTexture(new Rect(barRect.x, barRect.y, barRect.width * batteryPct, barRect.height), Texture2D.whiteTexture);
                GUI.color = Color.white;

                GUILayout.Label($"Battery: {drone.Battery:F1}% ({drone.BatteryWh:F0} Wh)");
                GUILayout.Label($"State: {drone.CurrentState} | Location: {drone.CurrentLocation}");

                // Speed (estimate from PX4 telemetry if available)
                var px4Client = FindAnyObjectByType<PX4TelemetryClient>();
                if (px4Client?.LatestTelemetry != null)
                {
                    var t = px4Client.LatestTelemetry;
                    GUILayout.Label($"Speed: {t.speed_m_s:F1} m/s | Heading: {t.heading_deg:F0}°");
                    GUILayout.Label($"Alt: {t.alt_m:F1}m | Armed: {(t.is_armed ? "YES" : "NO")}");
                }

                // Payload
                if (drone.PayloadWeight > 0)
                    GUILayout.Label($"Payload: {drone.PayloadType} ({drone.PayloadWeight:F1} kg)");

                // Flight log count
                GUILayout.Label($"Flight log: {drone.FlightLog.Count} entries");

                GUILayout.Space(4f);
            }

            // Weather (from Gazebo if available)
            var ros = ROSBridge.Instance;
            if (ros?.LatestWeather != null)
            {
                var w = ros.LatestWeather;
                GUILayout.Space(4f);
                GUILayout.Label("━━ Gazebo Weather ━━");
                GUILayout.Label($"Wind: {w.wind_speed_ms:F1} m/s @ {w.wind_direction_deg:F0}°");
                GUILayout.Label($"Precip: {w.precipitation_mm_h:F1} mm/h | Vis: {w.visibility_km:F0} km");
                GUILayout.Label($"Temp: {w.temperature_c:F0}°C");
            }

            GUILayout.EndArea();
        }
    }
}
