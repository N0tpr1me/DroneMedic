using UnityEngine;

namespace DroneMedic
{
    public class WaypointMarker : MonoBehaviour
    {
        [SerializeField] private string locationName = "";
        [SerializeField] private Color normalColor = Color.blue;
        [SerializeField] private Color highPriorityColor = Color.red;
        [SerializeField] private Color approachingColor = Color.yellow;

        private Renderer _renderer;
        private Color _currentBaseColor;
        private bool _isApproaching;

        private void Awake()
        {
            _renderer = GetComponent<Renderer>();
            _currentBaseColor = normalColor;
            ApplyColor(_currentBaseColor);
        }

        private void Update()
        {
            if (!_isApproaching)
            {
                return;
            }

            float t = Mathf.PingPong(Time.time * 2f, 1f);
            Color pulsed = Color.Lerp(_currentBaseColor, approachingColor, t);
            ApplyColor(pulsed);
        }

        public void SetPriority(string priority)
        {
            _currentBaseColor = priority == "high" ? highPriorityColor : normalColor;

            if (!_isApproaching)
            {
                ApplyColor(_currentBaseColor);
            }
        }

        public void SetApproaching(bool approaching)
        {
            _isApproaching = approaching;

            if (!approaching)
            {
                ApplyColor(_currentBaseColor);
            }
        }

        private void ApplyColor(Color color)
        {
            if (_renderer != null)
            {
                _renderer.material.color = color;
            }
        }

#if UNITY_EDITOR
        private void OnDrawGizmos()
        {
            if (!string.IsNullOrEmpty(locationName))
            {
                UnityEditor.Handles.Label(transform.position + Vector3.up * 2f, locationName);
            }

            Gizmos.color = normalColor;
            Gizmos.DrawWireSphere(transform.position, 0.5f);
        }
#endif
    }
}
