using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Net;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;

namespace DroneMedic
{
    /// <summary>
    /// WebSocket server that bridges Unity drone simulation to the React dashboard.
    /// Broadcasts telemetry on ws://localhost:8765 in the same JSON format the
    /// dashboard's usePX4Telemetry hook already consumes.
    /// Also accepts commands from the dashboard (start, stop, set demo mode).
    /// </summary>
    public class WebSocketBridge : MonoBehaviour
    {
        public static WebSocketBridge Instance { get; private set; }

        [Header("Server")]
        [SerializeField] private int port = 8765;
        [SerializeField] private float broadcastInterval = 0.1f; // 10 Hz

        [Header("References")]
        [SerializeField] private DroneConfig config;

        // --- Events the SimulationManager can subscribe to ---
        public event Action<string> OnStartCommand;    // payload: demo mode name
        public event Action OnStopCommand;
        public event Action<string[]> OnRouteCommand;  // waypoint names

        private HttpListener _httpListener;
        private CancellationTokenSource _cts;
        private readonly ConcurrentBag<WebSocket> _clients = new ConcurrentBag<WebSocket>();
        private readonly ConcurrentQueue<string> _outgoing = new ConcurrentQueue<string>();
        private float _broadcastTimer;
        private bool _serverRunning;

        // --- Unity Lifecycle ---

        private void Awake()
        {
            if (Instance != null && Instance != this)
            {
                Destroy(gameObject);
                return;
            }
            Instance = this;
        }

        private void OnEnable()
        {
            StartServer();
        }

        private void OnDisable()
        {
            StopServer();
        }

        private void OnDestroy()
        {
            StopServer();
            if (Instance == this) Instance = null;
        }

        private void Update()
        {
            if (!_serverRunning) return;

            _broadcastTimer += Time.deltaTime;
            if (_broadcastTimer >= broadcastInterval)
            {
                _broadcastTimer = 0f;
                BroadcastAllDroneTelemetry();
            }
        }

        // --- Server Start / Stop ---

        private void StartServer()
        {
            if (_serverRunning) return;

            _cts = new CancellationTokenSource();
            _httpListener = new HttpListener();
            _httpListener.Prefixes.Add($"http://localhost:{port}/");

            try
            {
                _httpListener.Start();
                _serverRunning = true;
                Debug.Log($"[WebSocketBridge] Listening on ws://localhost:{port}");
                _ = AcceptClientsAsync(_cts.Token);
            }
            catch (Exception ex)
            {
                Debug.LogError($"[WebSocketBridge] Failed to start: {ex.Message}");
            }
        }

        private void StopServer()
        {
            if (!_serverRunning) return;
            _serverRunning = false;

            _cts?.Cancel();
            _cts?.Dispose();
            _cts = null;

            try { _httpListener?.Stop(); } catch { /* ignore */ }
            _httpListener = null;

            Debug.Log("[WebSocketBridge] Server stopped.");
        }

        // --- Async Client Accept Loop ---

        private async Task AcceptClientsAsync(CancellationToken ct)
        {
            while (!ct.IsCancellationRequested && _httpListener != null && _httpListener.IsListening)
            {
                try
                {
                    var context = await _httpListener.GetContextAsync();

                    if (context.Request.IsWebSocketRequest)
                    {
                        var wsContext = await context.AcceptWebSocketAsync(null);
                        var ws = wsContext.WebSocket;
                        _clients.Add(ws);
                        Debug.Log("[WebSocketBridge] Client connected.");
                        _ = ReceiveLoop(ws, ct);
                    }
                    else
                    {
                        // Return a simple status page for non-WS requests
                        context.Response.StatusCode = 200;
                        var body = Encoding.UTF8.GetBytes("{\"status\":\"ok\",\"source\":\"unity\"}");
                        context.Response.ContentType = "application/json";
                        context.Response.ContentLength64 = body.Length;
                        await context.Response.OutputStream.WriteAsync(body, 0, body.Length, ct);
                        context.Response.Close();
                    }
                }
                catch (ObjectDisposedException) { break; }
                catch (HttpListenerException) { break; }
                catch (Exception ex)
                {
                    if (!ct.IsCancellationRequested)
                        Debug.LogWarning($"[WebSocketBridge] Accept error: {ex.Message}");
                }
            }
        }

        // --- Receive Loop (commands from dashboard) ---

        private async Task ReceiveLoop(WebSocket ws, CancellationToken ct)
        {
            var buffer = new byte[4096];

            try
            {
                while (ws.State == WebSocketState.Open && !ct.IsCancellationRequested)
                {
                    var result = await ws.ReceiveAsync(new ArraySegment<byte>(buffer), ct);

                    if (result.MessageType == WebSocketMessageType.Close)
                    {
                        await ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "", ct);
                        break;
                    }

                    if (result.MessageType == WebSocketMessageType.Text)
                    {
                        string json = Encoding.UTF8.GetString(buffer, 0, result.Count);
                        HandleIncomingCommand(json);
                    }
                }
            }
            catch (OperationCanceledException) { }
            catch (WebSocketException) { }
            catch (Exception ex)
            {
                Debug.LogWarning($"[WebSocketBridge] Receive error: {ex.Message}");
            }
        }

        private void HandleIncomingCommand(string json)
        {
            try
            {
                var cmd = JsonUtility.FromJson<BridgeCommand>(json);
                if (cmd == null) return;

                // Dispatch on main thread via Update queue
                switch (cmd.command)
                {
                    case "start":
                        MainThreadDispatcher.Enqueue(() => OnStartCommand?.Invoke(cmd.mode ?? "Basic"));
                        break;
                    case "stop":
                        MainThreadDispatcher.Enqueue(() => OnStopCommand?.Invoke());
                        break;
                    case "route":
                        if (cmd.waypoints != null && cmd.waypoints.Length > 0)
                            MainThreadDispatcher.Enqueue(() => OnRouteCommand?.Invoke(cmd.waypoints));
                        break;
                    default:
                        Debug.Log($"[WebSocketBridge] Unknown command: {cmd.command}");
                        break;
                }
            }
            catch (Exception ex)
            {
                Debug.LogWarning($"[WebSocketBridge] Bad command JSON: {ex.Message}");
            }
        }

        // --- Telemetry Broadcasting ---

        private void BroadcastAllDroneTelemetry()
        {
            var sim = SimulationManager.Instance;
            if (sim == null) return;

            foreach (var drone in sim.ActiveDrones)
            {
                if (drone == null) continue;
                BroadcastDroneTelemetry(drone);
            }
        }

        private void BroadcastDroneTelemetry(DroneController drone)
        {
            // Convert Unity world position back to geo coordinates
            double lat = 0, lon = 0;
            if (config != null)
            {
                WorldToGeo(drone.transform.position, out lat, out lon);
            }

            var msg = new TelemetryMessage
            {
                type = "telemetry",
                source = "unity",
                drone_id = drone.name,
                lat = lat,
                lon = lon,
                alt_m = drone.transform.position.y,
                relative_alt_m = drone.transform.position.y,
                battery_pct = drone.Battery,
                flight_mode = drone.CurrentState.ToString(),
                is_armed = drone.IsFlying,
                is_flying = drone.IsFlying,
                heading_deg = drone.transform.eulerAngles.y,
                speed_m_s = 0f, // could track delta position
                timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() / 1000.0,
                current_location = drone.CurrentLocation
            };

            string json = JsonUtility.ToJson(msg);
            _ = BroadcastAsync(json);
        }

        /// <summary>
        /// Broadcast an event (waypoint_reached, mission_started, etc.) to all clients.
        /// Call this from SimulationManager when events occur.
        /// </summary>
        public void BroadcastEvent(string eventType, string droneId, string location = null, float battery = 0f)
        {
            var msg = new EventMessage
            {
                type = eventType,
                drone_id = droneId,
                waypoint = location ?? "",
                battery = battery,
                timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() / 1000.0
            };

            string json = JsonUtility.ToJson(msg);
            _ = BroadcastAsync(json);
        }

        private async Task BroadcastAsync(string json)
        {
            var data = new ArraySegment<byte>(Encoding.UTF8.GetBytes(json));
            var deadClients = new List<WebSocket>();

            foreach (var ws in _clients)
            {
                if (ws.State != WebSocketState.Open)
                {
                    deadClients.Add(ws);
                    continue;
                }

                try
                {
                    await ws.SendAsync(data, WebSocketMessageType.Text, true, CancellationToken.None);
                }
                catch
                {
                    deadClients.Add(ws);
                }
            }

            // ConcurrentBag doesn't support removal, so we just let dead sockets accumulate
            // For a hackathon demo this is fine — only a few clients ever connect
        }

        // --- Geo Conversion (inverse of DroneConfig.GetWorldPosition) ---

        private void WorldToGeo(Vector3 worldPos, out double lat, out double lon)
        {
            var depot = config.GetLocation("Depot");
            if (depot == null)
            {
                lat = 0;
                lon = 0;
                return;
            }

            double cosLat = Math.Cos(depot.latitude * Math.PI / 180.0);
            lon = depot.longitude + (worldPos.x / (111320.0 * cosLat));
            lat = depot.latitude + (worldPos.z / 111320.0);
        }

        // --- JSON Message Types ---

        [Serializable]
        private class TelemetryMessage
        {
            public string type;
            public string source;
            public string drone_id;
            public double lat;
            public double lon;
            public float alt_m;
            public float relative_alt_m;
            public float battery_pct;
            public string flight_mode;
            public bool is_armed;
            public bool is_flying;
            public float heading_deg;
            public float speed_m_s;
            public double timestamp;
            public string current_location;
        }

        [Serializable]
        private class EventMessage
        {
            public string type;
            public string drone_id;
            public string waypoint;
            public float battery;
            public double timestamp;
        }

        [Serializable]
        private class BridgeCommand
        {
            public string command;  // "start", "stop", "route"
            public string mode;     // demo mode for "start"
            public string[] waypoints; // for "route"
        }
    }

    // --- Main Thread Dispatcher (required to call Unity APIs from async threads) ---

    public class MainThreadDispatcher : MonoBehaviour
    {
        private static MainThreadDispatcher _instance;
        private static readonly ConcurrentQueue<Action> _actions = new ConcurrentQueue<Action>();

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        private static void Init()
        {
            if (_instance != null) return;
            var go = new GameObject("[MainThreadDispatcher]");
            _instance = go.AddComponent<MainThreadDispatcher>();
            DontDestroyOnLoad(go);
        }

        public static void Enqueue(Action action)
        {
            _actions.Enqueue(action);
        }

        private void Update()
        {
            while (_actions.TryDequeue(out var action))
            {
                try { action(); }
                catch (Exception ex) { Debug.LogError($"[MainThreadDispatcher] {ex}"); }
            }
        }
    }
}
