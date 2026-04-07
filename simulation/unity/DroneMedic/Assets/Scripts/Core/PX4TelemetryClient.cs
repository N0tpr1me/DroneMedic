using System;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;

namespace DroneMedic
{
    [Serializable]
    public class PX4TelemetryData
    {
        public string type;
        public string source;
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
    }

    /// <summary>
    /// WebSocket CLIENT that connects to the telemetry bridge (telemetry_bridge.py)
    /// and receives real PX4 SITL telemetry. Dispatches data to the main thread
    /// so DroneController can consume it.
    /// </summary>
    public class PX4TelemetryClient : MonoBehaviour
    {
        [Header("Connection")]
        [SerializeField] private string telemetryBridgeUrl = "ws://localhost:8765";
        [SerializeField] private float reconnectDelay = 2f;

        public event Action<PX4TelemetryData> OnTelemetryReceived;

        public bool IsConnected { get; private set; }
        public PX4TelemetryData LatestTelemetry { get; private set; }
        public string BridgeUrl => telemetryBridgeUrl;

        private ClientWebSocket _ws;
        private CancellationTokenSource _cts;
        private bool _shouldRun;

        private void OnEnable()
        {
            _shouldRun = true;
            _cts = new CancellationTokenSource();
            _ = ConnectLoop(_cts.Token);
        }

        private void OnDisable()
        {
            _shouldRun = false;
            _cts?.Cancel();
            _cts?.Dispose();
            _cts = null;
            CloseSocket();
        }

        private void OnDestroy()
        {
            _shouldRun = false;
            _cts?.Cancel();
            _cts?.Dispose();
            _cts = null;
            CloseSocket();
        }

        private void CloseSocket()
        {
            if (_ws == null) return;
            try
            {
                if (_ws.State == WebSocketState.Open)
                    _ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "", CancellationToken.None);
            }
            catch { /* ignore during shutdown */ }
            _ws.Dispose();
            _ws = null;
            IsConnected = false;
        }

        // --- Connection Loop with Auto-Reconnect ---

        private async Task ConnectLoop(CancellationToken ct)
        {
            while (_shouldRun && !ct.IsCancellationRequested)
            {
                try
                {
                    _ws = new ClientWebSocket();
                    Debug.Log($"[PX4TelemetryClient] Connecting to {telemetryBridgeUrl} ...");
                    await _ws.ConnectAsync(new Uri(telemetryBridgeUrl), ct);

                    IsConnected = true;
                    Debug.Log("[PX4TelemetryClient] Connected to telemetry bridge.");

                    await ReceiveLoop(ct);
                }
                catch (OperationCanceledException)
                {
                    break;
                }
                catch (Exception ex)
                {
                    if (!ct.IsCancellationRequested)
                        Debug.LogWarning($"[PX4TelemetryClient] Connection failed: {ex.Message}");
                }
                finally
                {
                    IsConnected = false;
                    CloseSocket();
                }

                if (_shouldRun && !ct.IsCancellationRequested)
                {
                    Debug.Log($"[PX4TelemetryClient] Reconnecting in {reconnectDelay}s ...");
                    await Task.Delay((int)(reconnectDelay * 1000), ct);
                }
            }
        }

        // --- Receive Loop ---

        private async Task ReceiveLoop(CancellationToken ct)
        {
            var buffer = new byte[4096];

            while (_ws != null && _ws.State == WebSocketState.Open && !ct.IsCancellationRequested)
            {
                var result = await _ws.ReceiveAsync(new ArraySegment<byte>(buffer), ct);

                if (result.MessageType == WebSocketMessageType.Close)
                {
                    Debug.Log("[PX4TelemetryClient] Server closed connection.");
                    break;
                }

                if (result.MessageType == WebSocketMessageType.Text)
                {
                    string json = Encoding.UTF8.GetString(buffer, 0, result.Count);
                    var data = JsonUtility.FromJson<PX4TelemetryData>(json);

                    if (data != null && data.type == "telemetry")
                    {
                        LatestTelemetry = data;
                        MainThreadDispatcher.Enqueue(() => OnTelemetryReceived?.Invoke(data));
                    }
                }
            }
        }

        // --- Send Commands to Telemetry Bridge ---

        /// <summary>Send a takeoff command to PX4 via the telemetry bridge.</summary>
        public void SendTakeoff()
        {
            SendCommand("{\"cmd\":\"takeoff\"}");
        }

        /// <summary>Send a goto command to PX4 via the telemetry bridge.</summary>
        public void SendGoto(double lat, double lon, float alt = 30f)
        {
            string json = $"{{\"cmd\":\"goto\",\"lat\":{lat},\"lon\":{lon},\"alt\":{alt}}}";
            SendCommand(json);
        }

        /// <summary>Send a land command to PX4 via the telemetry bridge.</summary>
        public void SendLand()
        {
            SendCommand("{\"cmd\":\"land\"}");
        }

        /// <summary>Send a hold command to PX4 via the telemetry bridge.</summary>
        public void SendHold()
        {
            SendCommand("{\"cmd\":\"hold\"}");
        }

        /// <summary>Send a start_mission command to PX4 via the telemetry bridge.</summary>
        public void SendStartMission()
        {
            SendCommand("{\"cmd\":\"start_mission\"}");
        }

        private void SendCommand(string json)
        {
            if (_ws == null || _ws.State != WebSocketState.Open)
            {
                Debug.LogWarning("[PX4TelemetryClient] Cannot send command — not connected.");
                return;
            }

            var data = new ArraySegment<byte>(Encoding.UTF8.GetBytes(json));
            _ = _ws.SendAsync(data, WebSocketMessageType.Text, true, CancellationToken.None);
        }
    }
}
