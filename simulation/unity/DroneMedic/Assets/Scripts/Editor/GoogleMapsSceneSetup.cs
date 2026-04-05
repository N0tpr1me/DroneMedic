using UnityEngine;
using UnityEditor;
using CesiumForUnity;

namespace DroneMedic.Editor
{
    /// <summary>
    /// Editor menu to set up the Google Maps 3D Tiles scene in one click.
    /// Creates: CesiumGeoreference root → Google3DTiles child, plus camera and lighting.
    /// </summary>
    public static class GoogleMapsSceneSetup
    {
        [MenuItem("DroneMedic/Setup Google Maps Scene")]
        public static void SetupScene()
        {
            // 1. Create root with CesiumGeoreference + GoogleMaps3DTiles
            var existing = Object.FindAnyObjectByType<GoogleMaps3DTiles>();
            if (existing != null)
            {
                Debug.LogWarning("[SceneSetup] GoogleMaps3DTiles already exists in scene. Skipping.");
                Selection.activeGameObject = existing.gameObject;
                return;
            }

            var root = new GameObject("CesiumWorld");
            var mapTiles = root.AddComponent<GoogleMaps3DTiles>();

            // 2. Add sun/directional light for the Cesium globe
            var sunObj = new GameObject("CesiumSun");
            sunObj.transform.SetParent(root.transform, false);
            var sunComp = sunObj.AddComponent<CesiumSunSky>();

            // 3. Create camera with CesiumCameraController for globe navigation
            var camObj = new GameObject("MainCamera");
            camObj.tag = "MainCamera";
            var cam = camObj.AddComponent<Camera>();
            cam.nearClipPlane = 1f;
            cam.farClipPlane = 100000f;
            camObj.AddComponent<CesiumCameraController>();
            camObj.AddComponent<CesiumOriginShift>();

            // Position camera above depot looking down
            camObj.transform.position = new Vector3(0f, 200f, -100f);
            camObj.transform.LookAt(Vector3.zero);

            // 4. Clean up default scene objects
            var defaultCam = GameObject.Find("Main Camera");
            if (defaultCam != null && defaultCam != camObj)
                Object.DestroyImmediate(defaultCam);

            var defaultLight = GameObject.Find("Directional Light");
            if (defaultLight != null)
                Object.DestroyImmediate(defaultLight);

            Undo.RegisterCreatedObjectUndo(root, "Setup Google Maps Scene");
            Undo.RegisterCreatedObjectUndo(camObj, "Setup Google Maps Scene");
            Selection.activeGameObject = root;

            Debug.Log("[SceneSetup] Google Maps 3D Tiles scene created. Set your API key on the GoogleMaps3DTiles component.");
        }
    }
}
