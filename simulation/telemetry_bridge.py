"""
DroneMedic - Telemetry WebSocket Bridge

Bridges PX4 SITL telemetry to the browser via WebSocket.
Falls back to MockTelemetrySource if PX4/MAVSDK is unavailable.

Usage:
    python -m simulation.telemetry_bridge          # from project root
    python simulation/telemetry_bridge.py           # direct

Connects to PX4 at udp://:14540, serves WebSocket on 0.0.0.0:8765.
Browser connects to ws://localhost:8765 to receive telemetry JSON at ~5 Hz.
"""

import asyncio
import json
import logging
import os
import sys
import time

# Ensure project root is on sys.path for config imports
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)

import websockets
from websockets.server import serve

from simulation.mock_telemetry import MockTelemetrySource

logger = logging.getLogger("DroneMedic.TelemetryBridge")

# --- Configuration ---
WS_HOST = os.getenv("TELEMETRY_WS_HOST", "0.0.0.0")
WS_PORT = int(os.getenv("TELEMETRY_WS_PORT", "8765"))
PX4_CONNECTION = os.getenv("PX4_CONNECTION", "udp://:14540")
PX4_CONNECT_TIMEOUT = float(os.getenv("PX4_CONNECT_TIMEOUT", "5"))
TELEMETRY_HZ = 5.0


# ---------------------------------------------------------------------------
# PX4 Telemetry Source (real drone via MAVSDK)
# ---------------------------------------------------------------------------

class PX4TelemetrySource:
    """Streams telemetry from a real PX4 SITL instance via MAVSDK."""

    def __init__(self, connection_url: str = PX4_CONNECTION) -> None:
        from mavsdk import System
        self._drone = System()
        self._connection_url = connection_url
        self._position: dict = {"lat": 0.0, "lon": 0.0, "alt_m": 0.0, "relative_alt_m": 0.0}
        self._battery_pct: float = 100.0
        self._flight_mode: str = "UNKNOWN"
        self._is_armed: bool = False
        self._is_flying: bool = False
        self._heading_deg: float = 0.0
        self._speed_m_s: float = 0.0
        self._connected: bool = False

    async def connect(self) -> None:
        """Connect to PX4 and start telemetry streams."""
        logger.info("Connecting to PX4 at %s ...", self._connection_url)
        await self._drone.connect(system_address=self._connection_url)

        # Wait for connection with timeout
        async for state in self._drone.core.connection_state():
            if state.is_connected:
                logger.info("Connected to PX4")
                break

        # Wait for GPS lock
        logger.info("Waiting for GPS lock ...")
        async for health in self._drone.telemetry.health():
            if health.is_global_position_ok and health.is_home_position_ok:
                logger.info("GPS lock acquired")
                break

        self._connected = True
        # Start background telemetry streams
        asyncio.ensure_future(self._stream_position())
        asyncio.ensure_future(self._stream_battery())
        asyncio.ensure_future(self._stream_flight_mode())
        asyncio.ensure_future(self._stream_in_air())
        asyncio.ensure_future(self._stream_heading())

    async def _stream_position(self) -> None:
        async for pos in self._drone.telemetry.position():
            self._position = {
                "lat": pos.latitude_deg,
                "lon": pos.longitude_deg,
                "alt_m": pos.absolute_altitude_m,
                "relative_alt_m": pos.relative_altitude_m,
            }

    async def _stream_battery(self) -> None:
        async for battery in self._drone.telemetry.battery():
            self._battery_pct = battery.remaining_percent * 100.0

    async def _stream_flight_mode(self) -> None:
        async for mode in self._drone.telemetry.flight_mode():
            self._flight_mode = str(mode)

    async def _stream_in_air(self) -> None:
        async for in_air in self._drone.telemetry.in_air():
            self._is_flying = in_air

    async def _stream_heading(self) -> None:
        async for heading in self._drone.telemetry.heading():
            self._heading_deg = heading.heading_deg

    async def get_telemetry(self) -> dict:
        """Return current telemetry snapshot."""
        await asyncio.sleep(1.0 / TELEMETRY_HZ)
        return {
            "type": "telemetry",
            "source": "px4",
            "lat": round(self._position["lat"], 7),
            "lon": round(self._position["lon"], 7),
            "alt_m": round(self._position["alt_m"], 1),
            "relative_alt_m": round(self._position["relative_alt_m"], 1),
            "battery_pct": round(self._battery_pct, 1),
            "flight_mode": self._flight_mode,
            "is_armed": self._is_armed,
            "is_flying": self._is_flying,
            "heading_deg": round(self._heading_deg, 1),
            "speed_m_s": round(self._speed_m_s, 1),
            "timestamp": time.time(),
        }

    # --- Commands ---

    async def command_takeoff(self) -> None:
        await self._drone.action.set_takeoff_altitude(30.0)
        await self._drone.action.arm()
        self._is_armed = True
        await self._drone.action.takeoff()

    async def command_goto(self, lat: float, lon: float, alt: float) -> None:
        await self._drone.action.goto_location(lat, lon, alt, float("nan"))

    async def command_land(self) -> None:
        await self._drone.action.land()

    async def command_hold(self) -> None:
        await self._drone.action.hold()


# ---------------------------------------------------------------------------
# Bridge Server
# ---------------------------------------------------------------------------

class TelemetryBridge:
    """WebSocket server that streams telemetry to browser clients."""

    def __init__(self) -> None:
        self._source = None
        self._clients: set = set()
        self._using_mock: bool = False

    async def _init_source(self) -> None:
        """Try PX4 first, fall back to mock."""
        try:
            import mavsdk  # noqa: F401
            source = PX4TelemetrySource(PX4_CONNECTION)
            await asyncio.wait_for(source.connect(), timeout=PX4_CONNECT_TIMEOUT)
            self._source = source
            self._using_mock = False
            logger.info("Using PX4 telemetry source")
        except Exception as exc:
            logger.warning("PX4 unavailable (%s), falling back to mock telemetry", exc)
            self._source = MockTelemetrySource()
            self._source.start_mission()
            self._using_mock = True
            logger.info("Using mock telemetry source")

    async def _handle_client(self, websocket) -> None:
        """Handle a single WebSocket client connection."""
        self._clients.add(websocket)
        remote = websocket.remote_address
        logger.info("Client connected: %s", remote)

        try:
            # Start telemetry streaming task for this client
            stream_task = asyncio.ensure_future(self._stream_to_client(websocket))

            # Listen for commands from client
            async for message in websocket:
                await self._handle_command(message)

        except websockets.ConnectionClosed:
            logger.info("Client disconnected: %s", remote)
        finally:
            stream_task.cancel()
            self._clients.discard(websocket)

    async def _stream_to_client(self, websocket) -> None:
        """Continuously stream telemetry to a client."""
        try:
            while True:
                data = await self._source.get_telemetry()
                await websocket.send(json.dumps(data))
        except asyncio.CancelledError:
            pass
        except websockets.ConnectionClosed:
            pass

    async def _handle_command(self, message: str) -> None:
        """Process a command from the browser."""
        try:
            cmd = json.loads(message)
        except json.JSONDecodeError:
            logger.warning("Invalid JSON command: %s", message)
            return

        action = cmd.get("cmd")
        logger.info("Received command: %s", action)

        if action == "takeoff":
            if self._using_mock:
                self._source.command_takeoff()
            else:
                await self._source.command_takeoff()

        elif action == "goto":
            lat = cmd.get("lat", 0)
            lon = cmd.get("lon", 0)
            alt = cmd.get("alt", 30.0)
            if self._using_mock:
                self._source.command_goto(lat, lon, alt)
            else:
                await self._source.command_goto(lat, lon, alt)

        elif action == "land":
            if self._using_mock:
                self._source.command_land()
            else:
                await self._source.command_land()

        elif action == "hold":
            if self._using_mock:
                self._source.command_hold()
            else:
                await self._source.command_hold()

        elif action == "start_mission":
            if self._using_mock:
                self._source.start_mission()
            else:
                logger.info("Mission start via PX4 not yet implemented")

        else:
            logger.warning("Unknown command: %s", action)

    async def run(self) -> None:
        """Start the telemetry bridge server."""
        await self._init_source()

        source_label = "MOCK" if self._using_mock else "PX4"
        logger.info(
            "Telemetry bridge running on ws://%s:%d [%s]",
            WS_HOST, WS_PORT, source_label,
        )

        async with serve(self._handle_client, WS_HOST, WS_PORT):
            await asyncio.Future()  # run forever


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    )
    bridge = TelemetryBridge()
    try:
        asyncio.run(bridge.run())
    except KeyboardInterrupt:
        logger.info("Telemetry bridge stopped")


if __name__ == "__main__":
    main()
