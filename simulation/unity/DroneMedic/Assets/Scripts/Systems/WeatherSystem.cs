using System;
using System.Collections.Generic;
using UnityEngine;

namespace DroneMedic
{
    /// <summary>
    /// Manages weather conditions per location with predefined templates and
    /// per-location overrides. Mirrors backend/weather_service.py behaviour.
    /// </summary>
    public class WeatherSystem : MonoBehaviour
    {
        // ----------------------------------------------------------------
        // Singleton
        // ----------------------------------------------------------------

        public static WeatherSystem Instance { get; private set; }

        // ----------------------------------------------------------------
        // Inspector
        // ----------------------------------------------------------------

        [SerializeField] private DroneConfig config;

        // ----------------------------------------------------------------
        // Weather Data
        // ----------------------------------------------------------------

        [Serializable]
        public struct WeatherData
        {
            public float windSpeed;
            public float precipitation;
            public float visibility;
            public float temperature;
            public bool flyable;
            public string description;
            public string[] alerts;
        }

        // ----------------------------------------------------------------
        // Predefined Templates
        // ----------------------------------------------------------------

        public static readonly WeatherData Clear = new WeatherData
        {
            windSpeed = 3f,
            precipitation = 0f,
            visibility = 10000f,
            temperature = 18f,
            flyable = true,
            description = "Clear skies",
            alerts = Array.Empty<string>()
        };

        public static readonly WeatherData Storm = new WeatherData
        {
            windSpeed = 22f,
            precipitation = 12f,
            visibility = 2000f,
            temperature = 10f,
            flyable = false,
            description = "Severe storm \u2014 grounding all flights",
            alerts = new[] { "Severe thunderstorm warning" }
        };

        public static readonly WeatherData HighWind = new WeatherData
        {
            windSpeed = 18f,
            precipitation = 0.5f,
            visibility = 8000f,
            temperature = 15f,
            flyable = false,
            description = "High winds \u2014 unsafe for drone operations",
            alerts = new[] { "High wind advisory" }
        };

        public static readonly WeatherData LightRain = new WeatherData
        {
            windSpeed = 5f,
            precipitation = 3f,
            visibility = 6000f,
            temperature = 14f,
            flyable = true,
            description = "Light rain \u2014 proceed with caution",
            alerts = Array.Empty<string>()
        };

        // ----------------------------------------------------------------
        // Events
        // ----------------------------------------------------------------

        public event Action<string, WeatherData> OnWeatherChanged;

        // ----------------------------------------------------------------
        // State
        // ----------------------------------------------------------------

        private readonly Dictionary<string, WeatherData> _overrides = new Dictionary<string, WeatherData>();

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
        }

        // ----------------------------------------------------------------
        // Public API
        // ----------------------------------------------------------------

        /// <summary>
        /// Return weather for a named location. Uses override if present,
        /// otherwise returns <see cref="Clear"/>.
        /// </summary>
        public WeatherData GetWeatherAtLocation(string locationName)
        {
            if (locationName == null)
                throw new ArgumentNullException(nameof(locationName));

            if (_overrides.TryGetValue(locationName, out WeatherData data))
                return data;

            return Clear;
        }

        /// <summary>
        /// Apply a weather template to one or more locations.
        /// Supported event types: "storm", "highwind", "lightrain", "clear".
        /// </summary>
        public void SimulateWeatherEvent(string eventType, string[] affectedLocations)
        {
            if (eventType == null)
                throw new ArgumentNullException(nameof(eventType));
            if (affectedLocations == null)
                throw new ArgumentNullException(nameof(affectedLocations));

            WeatherData template = ResolveTemplate(eventType);

            foreach (string location in affectedLocations)
            {
                _overrides[location] = template;
                OnWeatherChanged?.Invoke(location, template);
            }
        }

        /// <summary>
        /// Remove all per-location overrides, resetting everything to Clear.
        /// </summary>
        public void ClearWeatherOverrides()
        {
            _overrides.Clear();
        }

        /// <summary>
        /// Evaluate flyability against the config thresholds.
        /// </summary>
        public bool IsFlyable(WeatherData weather)
        {
            return weather.windSpeed < config.maxWindSpeed
                && weather.precipitation < config.maxPrecipitation;
        }

        /// <summary>
        /// Snapshot of weather for every location in config.
        /// </summary>
        public Dictionary<string, WeatherData> GetAllLocationWeather()
        {
            var result = new Dictionary<string, WeatherData>();

            foreach (LocationData loc in config.locations)
            {
                result[loc.name] = GetWeatherAtLocation(loc.name);
            }

            return result;
        }

        // ----------------------------------------------------------------
        // Helpers
        // ----------------------------------------------------------------

        private static WeatherData ResolveTemplate(string eventType)
        {
            switch (eventType.ToLowerInvariant())
            {
                case "storm":     return Storm;
                case "highwind":  return HighWind;
                case "lightrain": return LightRain;
                case "clear":     return Clear;
                default:
                    Debug.LogWarning($"[WeatherSystem] Unknown event type '{eventType}', defaulting to Clear.");
                    return Clear;
            }
        }
    }
}
