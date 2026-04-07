using UnityEngine;
using UnityEditor;
using UnityEditor.SceneManagement;

namespace DroneMedic.Editor
{
    public static class SceneCleanup
    {
        [MenuItem("DroneMedic/Clean Up Demo Markers")]
        public static void CleanUpDemoMarkers()
        {
            int removed = 0;

            // Remove LocationMarkers parent (contains all Marker_ and Label_ objects)
            var locationMarkers = GameObject.Find("LocationMarkers");
            if (locationMarkers != null)
            {
                Undo.DestroyObjectImmediate(locationMarkers);
                removed++;
            }

            // Remove NoFlyZones parent (contains red zone visualizations)
            var noFlyZones = GameObject.Find("NoFlyZones");
            if (noFlyZones != null)
            {
                Undo.DestroyObjectImmediate(noFlyZones);
                removed++;
            }

            if (removed > 0)
            {
                EditorSceneManager.MarkSceneDirty(EditorSceneManager.GetActiveScene());
                Debug.Log($"[SceneCleanup] Removed {removed} root objects. Save the scene to persist.");
            }
            else
            {
                Debug.Log("[SceneCleanup] Nothing to remove — scene is already clean.");
            }
        }

        [MenuItem("DroneMedic/Fix Duplicate Objects")]
        public static void FixDuplicates()
        {
            int removed = 0;

            // Remove duplicate SimulationManagers (keep first)
            var sims = Object.FindObjectsByType<SimulationManager>(FindObjectsSortMode.None);
            for (int i = 1; i < sims.Length; i++)
            {
                Debug.Log($"[SceneCleanup] Removing duplicate SimulationManager: {sims[i].gameObject.name}");
                Undo.DestroyObjectImmediate(sims[i].gameObject);
                removed++;
            }

            // Remove duplicate CesiumGeoreferences that aren't under CesiumWorld
            var geoRefs = Object.FindObjectsByType<CesiumForUnity.CesiumGeoreference>(FindObjectsSortMode.None);
            foreach (var geo in geoRefs)
            {
                if (geo.transform.parent == null && geo.GetComponent<GoogleMaps3DTiles>() == null)
                {
                    Debug.Log($"[SceneCleanup] Removing orphan CesiumGeoreference: {geo.gameObject.name}");
                    Undo.DestroyObjectImmediate(geo.gameObject);
                    removed++;
                }
            }

            // Add BackendAPIClient if missing
            var apiClient = Object.FindAnyObjectByType<BackendAPIClient>();
            if (apiClient == null)
            {
                var go = new GameObject("BackendAPIClient");
                go.AddComponent<BackendAPIClient>();
                Undo.RegisterCreatedObjectUndo(go, "Add BackendAPIClient");
                Debug.Log("[SceneCleanup] Added BackendAPIClient to scene.");
            }

            if (removed > 0)
                EditorSceneManager.MarkSceneDirty(EditorSceneManager.GetActiveScene());

            Debug.Log($"[SceneCleanup] Done — removed {removed} duplicates.");
        }
    }
}
