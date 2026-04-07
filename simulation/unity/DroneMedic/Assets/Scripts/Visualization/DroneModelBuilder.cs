using UnityEngine;

namespace DroneMedic
{
    /// <summary>
    /// Builds a quadcopter 3D model from primitives at runtime,
    /// OR detects a custom GLB model child and sets up rotor spin on it.
    /// Always removes the old cube mesh/collider from root.
    /// </summary>
    public class DroneModelBuilder : MonoBehaviour
    {
        [Header("Dimensions")]
        [SerializeField] private float bodyLength = 0.6f;
        [SerializeField] private float bodyWidth = 0.3f;
        [SerializeField] private float bodyHeight = 0.12f;
        [SerializeField] private float armLength = 0.7f;
        [SerializeField] private float armThickness = 0.06f;
        [SerializeField] private float rotorRadius = 0.22f;
        [SerializeField] private float rotorHeight = 0.02f;

        [Header("Colors")]
        [SerializeField] private Color bodyColor = new Color(0.15f, 0.15f, 0.18f);
        [SerializeField] private Color armColor = new Color(0.25f, 0.25f, 0.28f);
        [SerializeField] private Color rotorColor = new Color(0.4f, 0.4f, 0.45f, 0.7f);
        [SerializeField] private Color ledFrontColor = new Color(0f, 1f, 0f);
        [SerializeField] private Color ledRearColor = new Color(1f, 0f, 0f);

        [Header("Trail")]
        [SerializeField] private bool addTrail = true;
        [SerializeField] private float trailTime = 8f;
        [SerializeField] private Color trailColor = new Color(0.2f, 0.6f, 1f, 0.5f);

        private bool _built;

        private void Start()
        {
            if (_built) return;
            BuildModel();
            _built = true;
        }

        private void BuildModel()
        {
            // ALWAYS remove old cube mesh/collider from root first (fixes "black box" issue)
            var existingMF = GetComponent<MeshFilter>();
            var existingMR = GetComponent<MeshRenderer>();
            var existingBC = GetComponent<BoxCollider>();
            if (existingMF != null) Destroy(existingMF);
            if (existingMR != null) Destroy(existingMR);
            if (existingBC != null) Destroy(existingBC);

            // Check if a custom 3D model (GLB import) is already a child
            bool hasCustomModel = false;
            if (transform.childCount > 0)
            {
                var firstChild = transform.GetChild(0);
                bool hasMesh = firstChild.GetComponent<MeshRenderer>() != null
                            || firstChild.GetComponentInChildren<MeshRenderer>() != null
                            || firstChild.GetComponentInChildren<SkinnedMeshRenderer>() != null;
                bool isNotPrimitive = firstChild.name != "Body" && firstChild.name != "Arm_0";
                hasCustomModel = hasMesh && isNotPrimitive;
            }

            if (hasCustomModel)
            {
                Debug.Log("[DroneModelBuilder] Custom 3D model detected — setting up rotor spin.");
                SetupCustomModelRotors();
                AddTrailRenderer();
                return;
            }

            // --- Build primitive quadcopter model ---
            BuildPrimitiveModel();
            AddTrailRenderer();
        }

        // -- Custom Model Rotor Setup --

        private void SetupCustomModelRotors()
        {
            // Search all children recursively for rotor/propeller objects
            string[] rotorKeywords = { "rotor", "propeller", "prop", "motor", "blade", "fan" };
            int rotorIndex = 0;

            var allChildren = GetComponentsInChildren<Transform>(true);
            foreach (var child in allChildren)
            {
                if (child == transform) continue;

                string nameLower = child.name.ToLowerInvariant();
                bool isRotor = false;
                foreach (var keyword in rotorKeywords)
                {
                    if (nameLower.Contains(keyword))
                    {
                        isRotor = true;
                        break;
                    }
                }

                if (isRotor && child.GetComponent<DroneRotorSpin>() == null)
                {
                    var spin = child.gameObject.AddComponent<DroneRotorSpin>();
                    SetRotorDirection(spin, rotorIndex % 2 == 0);
                    rotorIndex++;
                    Debug.Log($"[DroneModelBuilder] Added DroneRotorSpin to '{child.name}' (CW={rotorIndex % 2 == 0})");
                }
            }

            // If no rotors found by name, spin the entire model subtly as fallback
            if (rotorIndex == 0)
            {
                Debug.Log("[DroneModelBuilder] No rotor children found — model will display without spinning rotors.");
            }
            else
            {
                Debug.Log($"[DroneModelBuilder] Attached DroneRotorSpin to {rotorIndex} rotor(s).");
            }
        }

        // -- Primitive Model Builder --

        private void BuildPrimitiveModel()
        {
            var body = CreatePrimitive("Body", PrimitiveType.Cube,
                Vector3.zero,
                new Vector3(bodyLength, bodyHeight, bodyWidth),
                bodyColor);
            DestroyChildCollider(body);

            float armAngle = 45f;
            float armOffset = armLength * 0.5f;
            for (int i = 0; i < 4; i++)
            {
                float angle = armAngle + (i * 90f);
                float rad = angle * Mathf.Deg2Rad;
                Vector3 dir = new Vector3(Mathf.Cos(rad), 0f, Mathf.Sin(rad));
                Vector3 armCenter = dir * armOffset;

                var arm = CreatePrimitive($"Arm_{i}", PrimitiveType.Cube,
                    armCenter,
                    new Vector3(armLength, armThickness, armThickness),
                    armColor);
                arm.transform.localRotation = Quaternion.Euler(0f, -angle, 0f);
                DestroyChildCollider(arm);

                Vector3 rotorPos = dir * armLength + Vector3.up * (bodyHeight * 0.5f + rotorHeight);
                var rotor = CreatePrimitive($"Rotor_{i}", PrimitiveType.Cylinder,
                    rotorPos,
                    new Vector3(rotorRadius * 2f, rotorHeight, rotorRadius * 2f),
                    rotorColor, transparent: true);
                DestroyChildCollider(rotor);

                var spin = rotor.AddComponent<DroneRotorSpin>();
                SetRotorDirection(spin, i % 2 == 0);

                Color ledColor = (i < 2) ? ledFrontColor : ledRearColor;
                var led = CreatePrimitive($"LED_{i}", PrimitiveType.Sphere,
                    dir * armLength + Vector3.up * bodyHeight * 0.3f,
                    Vector3.one * 0.04f,
                    ledColor, emissive: true);
                DestroyChildCollider(led);
            }

            float skidOffset = bodyWidth * 0.4f;
            float skidLength = bodyLength * 0.8f;
            for (int s = 0; s < 2; s++)
            {
                float zOff = (s == 0) ? skidOffset : -skidOffset;
                var skid = CreatePrimitive($"Skid_{s}", PrimitiveType.Cube,
                    new Vector3(0f, -bodyHeight * 0.7f, zOff),
                    new Vector3(skidLength, 0.02f, 0.03f),
                    armColor);
                DestroyChildCollider(skid);

                for (int leg = 0; leg < 2; leg++)
                {
                    float xOff = (leg == 0) ? skidLength * 0.35f : -skidLength * 0.35f;
                    var legObj = CreatePrimitive($"SkidLeg_{s}_{leg}", PrimitiveType.Cube,
                        new Vector3(xOff, -bodyHeight * 0.35f, zOff),
                        new Vector3(0.03f, bodyHeight * 0.7f, 0.03f),
                        armColor);
                    DestroyChildCollider(legObj);
                }
            }
        }

        // -- Trail --

        private void AddTrailRenderer()
        {
            if (!addTrail || GetComponent<TrailRenderer>() != null) return;

            var trail = gameObject.AddComponent<TrailRenderer>();
            trail.time = trailTime;
            trail.startWidth = 0.15f;
            trail.endWidth = 0.02f;
            trail.material = new Material(Shader.Find("Sprites/Default"));
            trail.startColor = trailColor;
            trail.endColor = new Color(trailColor.r, trailColor.g, trailColor.b, 0f);
            trail.minVertexDistance = 0.5f;
        }

        // -- Helpers --

        private GameObject CreatePrimitive(string name, PrimitiveType type, Vector3 localPos, Vector3 scale, Color color, bool transparent = false, bool emissive = false)
        {
            var obj = GameObject.CreatePrimitive(type);
            obj.name = name;
            obj.transform.SetParent(transform, false);
            obj.transform.localPosition = localPos;
            obj.transform.localScale = scale;

            var renderer = obj.GetComponent<Renderer>();
            if (renderer != null)
            {
                Material mat;
                if (transparent)
                {
                    mat = new Material(Shader.Find("Standard"));
                    mat.SetFloat("_Mode", 3);
                    mat.SetInt("_SrcBlend", (int)UnityEngine.Rendering.BlendMode.SrcAlpha);
                    mat.SetInt("_DstBlend", (int)UnityEngine.Rendering.BlendMode.OneMinusSrcAlpha);
                    mat.SetInt("_ZWrite", 0);
                    mat.DisableKeyword("_ALPHATEST_ON");
                    mat.EnableKeyword("_ALPHABLEND_ON");
                    mat.DisableKeyword("_ALPHAPREMULTIPLY_ON");
                    mat.renderQueue = 3000;
                }
                else
                {
                    mat = new Material(Shader.Find("Standard"));
                }

                mat.color = color;

                if (emissive)
                {
                    mat.EnableKeyword("_EMISSION");
                    mat.SetColor("_EmissionColor", color * 2f);
                }

                renderer.material = mat;
            }

            return obj;
        }

        private static void DestroyChildCollider(GameObject obj)
        {
            var col = obj.GetComponent<Collider>();
            if (col != null) Destroy(col);
        }

        private static void SetRotorDirection(DroneRotorSpin spin, bool clockwise)
        {
            var field = typeof(DroneRotorSpin).GetField("clockwise",
                System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);
            field?.SetValue(spin, clockwise);
        }
    }
}
