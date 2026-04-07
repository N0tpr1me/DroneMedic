using UnityEngine;
using UnityEditor;

namespace DroneMedic.Editor
{
    /// <summary>
    /// Fixes the imported drone model:
    /// 1. Replaces pink/missing materials with Standard shader
    /// 2. Extracts textures from GLB if needed
    ///
    /// Usage: DroneMedic → Fix Drone Materials
    /// </summary>
    public static class FixDroneModel
    {
        [MenuItem("DroneMedic/Fix Drone Materials")]
        public static void Fix()
        {
            // Fix GLB import settings first
            var modelGuids = AssetDatabase.FindAssets("DroneMedicModel", new[] { "Assets/Models" });
            foreach (var guid in modelGuids)
            {
                string path = AssetDatabase.GUIDToAssetPath(guid);
                var importer = AssetImporter.GetAtPath(path) as ModelImporter;
                if (importer == null) continue;

                // Extract materials so they can be edited
                importer.materialImportMode = ModelImporterMaterialImportMode.ImportStandard;
                importer.materialLocation = ModelImporterMaterialLocation.External;

                // Extract textures
                importer.ExtractTextures("Assets/Models/Textures");

                importer.SaveAndReimport();
                Debug.Log($"[FixDroneModel] Reimported {path} with external materials.");
            }

            // Now fix all materials on the Drone prefab
            var prefabGuids = AssetDatabase.FindAssets("Drone t:Prefab", new[] { "Assets/Prefabs" });
            foreach (var guid in prefabGuids)
            {
                string path = AssetDatabase.GUIDToAssetPath(guid);
                var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(path);
                if (prefab == null) continue;

                var renderers = prefab.GetComponentsInChildren<Renderer>(true);
                foreach (var renderer in renderers)
                {
                    var mats = renderer.sharedMaterials;
                    bool changed = false;

                    for (int i = 0; i < mats.Length; i++)
                    {
                        if (mats[i] == null || mats[i].shader == null ||
                            mats[i].shader.name == "Hidden/InternalErrorShader" ||
                            mats[i].shader.name.Contains("Error"))
                        {
                            // Create a replacement material
                            var newMat = new Material(Shader.Find("Standard"));
                            newMat.color = new Color(0.2f, 0.2f, 0.25f); // Dark grey drone color
                            newMat.SetFloat("_Metallic", 0.6f);
                            newMat.SetFloat("_Glossiness", 0.7f);

                            string matPath = $"Assets/Models/Materials/DroneMat_{i}.mat";
                            EnsureDirectory("Assets/Models/Materials");
                            AssetDatabase.CreateAsset(newMat, matPath);
                            mats[i] = newMat;
                            changed = true;
                            Debug.Log($"[FixDroneModel] Replaced broken material {i} on {renderer.name}");
                        }
                        else if (mats[i].shader.name.Contains("glTF") ||
                                 mats[i].shader.name.Contains("GLTF") ||
                                 !mats[i].shader.isSupported)
                        {
                            // Convert glTF shader to Standard
                            Color color = mats[i].HasProperty("_Color") ? mats[i].color : new Color(0.3f, 0.3f, 0.35f);
                            Texture mainTex = mats[i].HasProperty("_MainTex") ? mats[i].mainTexture : null;

                            var newMat = new Material(Shader.Find("Standard"));
                            newMat.color = color;
                            if (mainTex != null) newMat.mainTexture = mainTex;
                            newMat.SetFloat("_Metallic", 0.5f);
                            newMat.SetFloat("_Glossiness", 0.6f);

                            string matPath = $"Assets/Models/Materials/DroneMat_{renderer.name}_{i}.mat";
                            EnsureDirectory("Assets/Models/Materials");
                            AssetDatabase.CreateAsset(newMat, matPath);
                            mats[i] = newMat;
                            changed = true;
                            Debug.Log($"[FixDroneModel] Converted glTF material to Standard on {renderer.name}");
                        }
                    }

                    if (changed)
                    {
                        renderer.sharedMaterials = mats;
                        EditorUtility.SetDirty(renderer);
                    }
                }

                EditorUtility.SetDirty(prefab);
                AssetDatabase.SaveAssets();
            }

            Debug.Log("[FixDroneModel] Done! Materials fixed. Press Play to see the result.");
        }

        private static void EnsureDirectory(string path)
        {
            if (!AssetDatabase.IsValidFolder(path))
            {
                string parent = System.IO.Path.GetDirectoryName(path);
                string folder = System.IO.Path.GetFileName(path);
                AssetDatabase.CreateFolder(parent, folder);
            }
        }
    }
}
