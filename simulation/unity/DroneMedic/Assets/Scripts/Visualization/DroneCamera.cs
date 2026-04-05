using UnityEngine;

namespace DroneMedic
{
    public class DroneCamera : MonoBehaviour
    {
        [SerializeField] private Transform target;
        [SerializeField] private Vector3 offset = new Vector3(0f, 15f, -10f);
        [SerializeField] private float smoothSpeed = 5f;

        private bool _isOverview;
        private Transform[] _allDrones;
        private int _currentDroneIndex;

        private void LateUpdate()
        {
            HandleInput();

            if (_isOverview)
            {
                FollowOverview();
            }
            else
            {
                FollowTarget();
            }
        }

        public void SetTarget(Transform newTarget)
        {
            target = newTarget;
            _isOverview = false;
        }

        public void ToggleOverviewMode()
        {
            _isOverview = !_isOverview;
        }

        public void SetDroneList(Transform[] drones)
        {
            _allDrones = drones;
            _currentDroneIndex = 0;

            if (drones != null && drones.Length > 0 && target == null)
            {
                target = drones[0];
            }
        }

        private void HandleInput()
        {
            if (Input.GetKeyDown(KeyCode.Tab))
            {
                CycleTarget();
            }

            if (Input.GetKeyDown(KeyCode.O))
            {
                ToggleOverviewMode();
            }
        }

        private void CycleTarget()
        {
            if (_allDrones == null || _allDrones.Length == 0)
            {
                return;
            }

            _isOverview = false;
            _currentDroneIndex = (_currentDroneIndex + 1) % _allDrones.Length;
            target = _allDrones[_currentDroneIndex];
        }

        private void FollowTarget()
        {
            if (target == null)
            {
                return;
            }

            Vector3 desiredPosition = target.position + offset;
            Vector3 smoothed = Vector3.Lerp(transform.position, desiredPosition, smoothSpeed * Time.deltaTime);
            transform.position = smoothed;
            transform.LookAt(target);
        }

        private void FollowOverview()
        {
            if (_allDrones == null || _allDrones.Length == 0)
            {
                if (target != null)
                {
                    FollowTarget();
                }
                return;
            }

            Vector3 center = Vector3.zero;
            int activeCount = 0;

            for (int i = 0; i < _allDrones.Length; i++)
            {
                if (_allDrones[i] != null)
                {
                    center += _allDrones[i].position;
                    activeCount++;
                }
            }

            if (activeCount == 0)
            {
                return;
            }

            center /= activeCount;

            Vector3 overviewOffset = new Vector3(0f, 40f, -25f);
            Vector3 desiredPosition = center + overviewOffset;
            Vector3 smoothed = Vector3.Lerp(transform.position, desiredPosition, smoothSpeed * Time.deltaTime);
            transform.position = smoothed;
            transform.LookAt(center);
        }
    }
}
