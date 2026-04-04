using System;
using System.Collections.Generic;
using UnityEngine;

namespace DroneMedic
{
    /// <summary>
    /// Detects simulated obstacles during a drone flight based on flight
    /// progress. Mirrors simulation/obstacle_detector.py behaviour.
    /// </summary>
    public class ObstacleDetector : MonoBehaviour
    {
        // ----------------------------------------------------------------
        // Singleton
        // ----------------------------------------------------------------

        public static ObstacleDetector Instance { get; private set; }

        // ----------------------------------------------------------------
        // Inspector
        // ----------------------------------------------------------------

        [SerializeField] private DroneConfig config;

        // ----------------------------------------------------------------
        // Obstacle Data
        // ----------------------------------------------------------------

        [Serializable]
        public struct ObstacleData
        {
            [Tooltip("Flight progress (0-1) at which this obstacle triggers")]
            public float triggerAtProgress;
            public string type;
            public string nearLocation;
            public string description;
            public string severity;
        }

        // ----------------------------------------------------------------
        // Events
        // ----------------------------------------------------------------

        public event Action<ObstacleData> OnObstacleDetected;

        // ----------------------------------------------------------------
        // Pre-configured Obstacles
        // ----------------------------------------------------------------

        private static readonly ObstacleData[] _preconfigured = new ObstacleData[]
        {
            new ObstacleData
            {
                triggerAtProgress = 0.6f,
                type = "fallen_tree",
                nearLocation = "Clinic C",
                description = "Fallen tree blocking approach to Clinic C",
                severity = "high"
            }
        };

        // ----------------------------------------------------------------
        // State
        // ----------------------------------------------------------------

        private readonly List<ObstacleData> _obstacles = new List<ObstacleData>();
        private readonly HashSet<int> _triggered = new HashSet<int>();

        // ----------------------------------------------------------------
        // Lifecycle
        // ----------------------------------------------------------------

        private void Awake()
        {
            if (Instance != null && Instance != this)
            {
                Destroy(gameObject);
                return;
            }

            Instance = this;

            // Seed with pre-configured obstacles.
            _obstacles.AddRange(_preconfigured);
        }

        // ----------------------------------------------------------------
        // Public API
        // ----------------------------------------------------------------

        /// <summary>
        /// Clear the triggered set so obstacles can fire again on a new flight.
        /// </summary>
        public void ResetObstacles()
        {
            _triggered.Clear();
        }

        /// <summary>
        /// Check whether an obstacle should be triggered at the current
        /// flight progress. Each obstacle triggers at most once per flight.
        /// Returns null when no obstacle fires.
        /// </summary>
        public ObstacleData? CheckForObstacle(Vector3 position, float flightProgress)
        {
            for (int i = 0; i < _obstacles.Count; i++)
            {
                if (_triggered.Contains(i))
                    continue;

                ObstacleData obstacle = _obstacles[i];

                if (flightProgress >= obstacle.triggerAtProgress)
                {
                    _triggered.Add(i);
                    OnObstacleDetected?.Invoke(obstacle);
                    return obstacle;
                }
            }

            return null;
        }

        /// <summary>
        /// Return location names that should be avoided when re-routing
        /// around the given obstacle.
        /// </summary>
        public string[] GetAvoidanceLocations(ObstacleData obstacle)
        {
            if (string.IsNullOrEmpty(obstacle.nearLocation))
                return Array.Empty<string>();

            return new[] { obstacle.nearLocation };
        }
    }
}
