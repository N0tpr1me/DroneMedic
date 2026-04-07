using UnityEngine;

namespace DroneMedic
{
    /// <summary>
    /// Spins a rotor transform when the parent DroneController is flying.
    /// Attach to each rotor child of the drone prefab.
    /// </summary>
    public class DroneRotorSpin : MonoBehaviour
    {
        [Header("Spin Settings")]
        [SerializeField] private float maxRpm = 3000f;
        [SerializeField] private float rampUpSpeed = 8f;
        [SerializeField] private bool clockwise = true;

        private DroneController _drone;
        private float _currentRpm;

        private void Start()
        {
            _drone = GetComponentInParent<DroneController>();
            if (_drone == null)
                Debug.LogWarning("[DroneRotorSpin] No DroneController found in parent hierarchy.", this);
        }

        private void Update()
        {
            if (_drone == null) return;

            float targetRpm = _drone.IsFlying ? maxRpm : 0f;
            _currentRpm = Mathf.Lerp(_currentRpm, targetRpm, Time.deltaTime * rampUpSpeed);

            float degreesPerSecond = _currentRpm * 6f; // 360 / 60
            float direction = clockwise ? 1f : -1f;
            transform.Rotate(Vector3.up, degreesPerSecond * direction * Time.deltaTime, Space.Self);
        }
    }
}
