using UnityEngine;
using UnityEditor;

namespace DroneMedic.Editor
{
    /// <summary>
    /// One-click: replaces the Drone prefab's mesh with the custom DroneMedicModel.glb.
    /// Removes old cube mesh, BoxCollider, and properly sets up the GLB child.
    /// Usage: DroneMedic → Setup Drone 3D Model
    /// </summary>
    public static class SetupDroneModel
    {
        [MenuItem("DroneMedic/Setup Drone 3D Model")]
        public static void Setup()
        {
            // Find the imported GLB model — search everywhere in Assets
            var modelGuids = AssetDatabase.FindAssets("DroneMedicModel t:Model");
            if (modelGuids.Length == 0)
                modelGuids = AssetDatabase.FindAssets("DroneMedic t:Model");
            if (modelGuids.Length == 0)
            {
                // Try searching for any .glb file
                modelGuids = AssetDatabase.FindAssets("Drone t:Model");
            }
            if (modelGuids.Length == 0)
            {
                Debug.LogError("[SetupDroneModel] Could not find any drone 3D model. Import a .glb/.fbx/.obj into Assets/Models/ first.");
                return;
            }

            string modelPath = AssetDatabase.GUIDToAssetPath(modelGuids[0]);
            var modelPrefab = AssetDatabase.LoadAssetAtPath<GameObject>(modelPath);
            if (modelPrefab == null)
            {
                Debug.LogError($"[SetupDroneModel] Failed to load model at {modelPath}");
                return;
            }
            Debug.Log($"[SetupDroneModel] Found model: {modelPath}");

            // Find the Drone prefab
            var prefabGuids = AssetDatabase.FindAssets("Drone t:Prefab", new[] { "Assets/Prefabs" });
            if (prefabGuids.Length == 0)
            {
                Debug.LogError("[SetupDroneModel] Could not find Drone prefab in Assets/Prefabs/.");
                return;
            }

            string prefabPath = AssetDatabase.GUIDToAssetPath(prefabGuids[0]);
            Debug.Log($"[SetupDroneModel] Editing prefab: {prefabPath}");

            // Open prefab for editing
            var prefabRoot = PrefabUtility.LoadPrefabContents(prefabPath);

            // Remove ALL old children
            for (int i = prefabRoot.transform.childCount - 1; i >= 0; i--)
                Object.DestroyImmediate(prefabRoot.transform.GetChild(i).gameObject);

            // Remove old MeshFilter, MeshRenderer, AND BoxCollider from root (fixes black box)
            var oldMF = prefabRoot.GetComponent<MeshFilter>();
            if (oldMF != null) Object.DestroyImmediate(oldMF);
            var oldMR = prefabRoot.GetComponent<MeshRenderer>();
            if (oldMR != null) Object.DestroyImmediate(oldMR);
            var oldBC = prefabRoot.GetComponent<BoxCollider>();
            if (oldBC != null) Object.DestroyImmediate(oldBC);

            // Instantiate the 3D model as a child
            var modelInstance = (GameObject)PrefabUtility.InstantiatePrefab(modelPrefab);
            modelInstance.transform.SetParent(prefabRoot.transform, false);
            modelInstance.name = "DroneModel";
            modelInstance.transform.localPosition = Vector3.zero;
            modelInstance.transform.localRotation = Quaternion.identity;

            // Auto-scale: normalize to roughly 1.5m wingspan
            float targetSize = 1.5f;
            var renderers = modelInstance.GetComponentsInChildren<Renderer>();
            if (renderers.Length > 0)
            {
                var bounds = renderers[0].bounds;
                for (int i = 1; i < renderers.Length; i++)
                    bounds.Encapsulate(renderers[i].bounds);

                float maxExtent = Mathf.Max(bounds.size.x, bounds.size.y, bounds.size.z);
                if (maxExtent > 0.001f)
                {
                    float scale = targetSize / maxExtent;
                    modelInstance.transform.localScale = Vector3.one * scale;
                    Debug.Log($"[SetupDroneModel] Scaled by {scale:F3} ({maxExtent:F2}m → {targetSize}m)");
                }

                // Recalculate bounds after scaling and center vertically
                bounds = new Bounds(Vector3.zero, Vector3.zero);
                foreach (var r in modelInstance.GetComponentsInChildren<Renderer>())
                    bounds.Encapsulate(r.bounds);
                float yOffset = -bounds.min.y + 0.05f;
                modelInstance.transform.localPosition = new Vector3(0, yOffset, 0);
            }

            // Ensure required components on root
            if (prefabRoot.GetComponent<DroneController>() == null)
                prefabRoot.AddComponent<DroneController>();
            if (prefabRoot.GetComponent<DroneModelBuilder>() == null)
                prefabRoot.AddComponent<DroneModelBuilder>();

            // Save
            PrefabUtility.SaveAsPrefabAsset(prefabRoot, prefabPath);
            PrefabUtility.UnloadPrefabContents(prefabRoot);

            Debug.Log("[SetupDroneModel] Done! Old cube removed, GLB model set up. Press Play.");
        }
    }
}
