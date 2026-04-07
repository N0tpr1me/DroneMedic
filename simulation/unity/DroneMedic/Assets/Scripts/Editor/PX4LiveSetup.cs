using UnityEngine;
using UnityEditor;
using UnityEditor.SceneManagement;

namespace DroneMedic.Editor
{
    /// <summary>
    /// One-click setup for PX4 Live mode. Creates all required GameObjects,
    /// wires references, and configures the scene for live PX4 SITL telemetry.
    ///
    /// Usage: DroneMedic → Setup PX4 Live Mode
    /// </summary>
    public static class PX4LiveSetup
    {
        [MenuItem("DroneMedic/Setup PX4 Live Mode")]
        public static void SetupPX4LiveMode()
        {
            int created = 0;

            // --- 1. PX4TelemetryClient ---
            var px4Client = Object.FindAnyObjectByType<PX4TelemetryClient>();
            if (px4Client == null)
            {
                var go = new GameObject("[PX4TelemetryClient]");
                px4Client = go.AddComponent<PX4TelemetryClient>();
                Undo.RegisterCreatedObjectUndo(go, "Create PX4TelemetryClient");
                created++;
                Debug.Log("[PX4LiveSetup] Created [PX4TelemetryClient].");
            }

            // --- 2. DroneControlPanel ---
            var controlPanel = Object.FindAnyObjectByType<DroneControlPanel>();
            if (controlPanel == null)
            {
                var go = new GameObject("[DroneControlPanel]");
                controlPanel = go.AddComponent<DroneControlPanel>();
                Undo.RegisterCreatedObjectUndo(go, "Create DroneControlPanel");
                created++;
                Debug.Log("[PX4LiveSetup] Created [DroneControlPanel].");
            }

            // --- 3. MissionMetricsOverlay ---
            var metrics = Object.FindAnyObjectByType<MissionMetricsOverlay>();
            if (metrics == null)
            {
                var go = new GameObject("[MissionMetricsOverlay]");
                go.AddComponent<MissionMetricsOverlay>();
                Undo.RegisterCreatedObjectUndo(go, "Create MissionMetricsOverlay");
                created++;
                Debug.Log("[PX4LiveSetup] Created [MissionMetricsOverlay].");
            }

            // --- 4. GazeboWorldRenderer ---
            var gazeboRenderer = Object.FindAnyObjectByType<GazeboWorldRenderer>();
            if (gazeboRenderer == null)
            {
                var go = new GameObject("[GazeboWorldRenderer]");
                gazeboRenderer = go.AddComponent<GazeboWorldRenderer>();
                Undo.RegisterCreatedObjectUndo(go, "Create GazeboWorldRenderer");
                created++;
                Debug.Log("[PX4LiveSetup] Created [GazeboWorldRenderer].");
            }

            // --- Pre-find scene references needed below ---
            var mapTiles = Object.FindAnyObjectByType<GoogleMaps3DTiles>();
            var geofence = Object.FindAnyObjectByType<GeofenceManager>();
            var weather = Object.FindAnyObjectByType<WeatherSystem>();

            // --- 5. Find or create SimulationManager ---
            var sim = Object.FindAnyObjectByType<SimulationManager>();
            if (sim == null)
            {
                var go = new GameObject("[SimulationManager]");
                sim = go.AddComponent<SimulationManager>();
                Undo.RegisterCreatedObjectUndo(go, "Create SimulationManager");
                created++;
                Debug.Log("[PX4LiveSetup] Created [SimulationManager].");
            }

            {
                var so = new SerializedObject(sim);

                // Set px4Client reference
                var px4Prop = so.FindProperty("px4Client");
                if (px4Prop != null)
                    px4Prop.objectReferenceValue = px4Client;

                // Set demo mode to PX4Live (enum index 5)
                var modeProp = so.FindProperty("demoMode");
                if (modeProp != null)
                    modeProp.enumValueIndex = 5; // PX4Live

                // Auto-start so the drone spawns immediately on Play
                var autoStartProp = so.FindProperty("autoStart");
                if (autoStartProp != null)
                    autoStartProp.boolValue = true;

                // Wire map tiles reference
                var mapProp = so.FindProperty("mapTiles");
                if (mapProp != null && mapTiles != null)
                    mapProp.objectReferenceValue = mapTiles;

                // Wire WebSocket bridge
                var wsBridgeProp = so.FindProperty("wsBridge");
                var wsBridge = Object.FindAnyObjectByType<WebSocketBridge>();
                if (wsBridgeProp != null && wsBridge != null)
                    wsBridgeProp.objectReferenceValue = wsBridge;

                // Wire DroneConfig asset
                var configProp = so.FindProperty("config");
                if (configProp != null && configProp.objectReferenceValue == null)
                {
                    // Find DroneConfig asset in project
                    var configGuids = AssetDatabase.FindAssets("t:DroneConfig", new[] { "Assets/Settings" });
                    if (configGuids.Length > 0)
                    {
                        string configPath = AssetDatabase.GUIDToAssetPath(configGuids[0]);
                        var droneConfig = AssetDatabase.LoadAssetAtPath<DroneConfig>(configPath);
                        if (droneConfig != null)
                        {
                            configProp.objectReferenceValue = droneConfig;
                            Debug.Log($"[PX4LiveSetup] Wired DroneConfig from {configPath}.");
                        }
                    }
                }

                // Wire drone prefab
                var prefabProp = so.FindProperty("dronePrefab");
                if (prefabProp != null && prefabProp.objectReferenceValue == null)
                {
                    var dronePrefabGuids = AssetDatabase.FindAssets("Drone t:Prefab", new[] { "Assets/Prefabs" });
                    if (dronePrefabGuids.Length > 0)
                    {
                        string prefabPath = AssetDatabase.GUIDToAssetPath(dronePrefabGuids[0]);
                        var dronePrefab = AssetDatabase.LoadAssetAtPath<GameObject>(prefabPath);
                        if (dronePrefab != null)
                        {
                            prefabProp.objectReferenceValue = dronePrefab;
                            Debug.Log($"[PX4LiveSetup] Wired Drone prefab from {prefabPath}.");
                        }
                    }
                }

                so.ApplyModifiedProperties();
                EditorUtility.SetDirty(sim);
                Debug.Log("[PX4LiveSetup] SimulationManager wired: px4Client, config, prefab, demoMode=PX4Live, autoStart=true.");
            }

            // --- 6. Wire GazeboWorldRenderer references ---
            if (gazeboRenderer != null)
            {
                var gso = new SerializedObject(gazeboRenderer);
                var mapProp = gso.FindProperty("mapTiles");
                if (mapProp != null && mapTiles != null)
                    mapProp.objectReferenceValue = mapTiles;
                var geoProp = gso.FindProperty("geofenceManager");
                if (geoProp != null && geofence != null)
                    geoProp.objectReferenceValue = geofence;
                var weatherProp = gso.FindProperty("weatherSystem");
                if (weatherProp != null && weather != null)
                    weatherProp.objectReferenceValue = weather;
                gso.ApplyModifiedProperties();
                EditorUtility.SetDirty(gazeboRenderer);
            }

            // --- 7. Wire DroneControlPanel references ---
            if (controlPanel != null)
            {
                var cso = new SerializedObject(controlPanel);
                var clientProp = cso.FindProperty("px4Client");
                if (clientProp != null)
                    clientProp.objectReferenceValue = px4Client;

                // Find DroneConfig from SimulationManager
                if (sim != null)
                {
                    var simSo = new SerializedObject(sim);
                    var configProp = simSo.FindProperty("config");
                    if (configProp != null)
                    {
                        var panelConfigProp = cso.FindProperty("config");
                        if (panelConfigProp != null)
                            panelConfigProp.objectReferenceValue = configProp.objectReferenceValue;
                    }
                }
                cso.ApplyModifiedProperties();
                EditorUtility.SetDirty(controlPanel);
            }

            // --- 8. Add DroneModelBuilder to drone prefab ---
            var prefabGuids = AssetDatabase.FindAssets("Drone t:Prefab", new[] { "Assets/Prefabs" });
            foreach (var guid in prefabGuids)
            {
                string path = AssetDatabase.GUIDToAssetPath(guid);
                var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(path);
                if (prefab == null || prefab.GetComponent<DroneModelBuilder>() != null) continue;

                var prefabRoot = PrefabUtility.LoadPrefabContents(path);
                prefabRoot.AddComponent<DroneModelBuilder>();
                PrefabUtility.SaveAsPrefabAsset(prefabRoot, path);
                PrefabUtility.UnloadPrefabContents(prefabRoot);
                Debug.Log($"[PX4LiveSetup] Added DroneModelBuilder to {path}.");
            }

            // --- Done ---
            EditorSceneManager.MarkSceneDirty(EditorSceneManager.GetActiveScene());
            Debug.Log($"[PX4LiveSetup] Complete! Created {created} new GameObjects. Save the scene to persist.");
        }
    }
}
