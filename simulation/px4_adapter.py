"""
DroneMedic - PX4 MAVSDK Adapter

Wraps MAVSDK async calls in a sync-compatible API so the existing
synchronous DroneController and main.py can drive a real PX4 drone.

A background daemon thread runs an asyncio event loop; sync wrappers
use asyncio.run_coroutine_threadsafe() to bridge the gap.

Requires: pip install mavsdk
"""

import asyncio
import logging
import math
import threading
from typing import Optional

from mavsdk import System
from mavsdk.action import ActionError
from mavsdk.offboard import OffboardError

from config import DRONE_VELOCITY

logger = logging.getLogger("DroneMedic.PX4Adapter")

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_ACCEPTANCE_RADIUS_M = 2.0  # how close we need to be to declare "arrived"
_TELEMETRY_RATE_HZ = 2.0
_POSITION_POLL_INTERVAL_S = 0.5


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Return great-circle distance in metres between two GPS points."""
    R = 6_371_000  # Earth radius in metres
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return 2 * R * math.atan2(math.sqrt(a), math.sqrt(1 - a))


# ---------------------------------------------------------------------------
# PX4Adapter
# ---------------------------------------------------------------------------


class PX4Adapter:
    """
    Async-first PX4/MAVSDK adapter with synchronous wrappers.

    Usage (sync):
        adapter = PX4Adapter("udp://:14540")
        adapter.connect_sync()
        adapter.takeoff_sync(30.0)
        adapter.goto_gps_sync(51.5124, -0.1200, 30.0)
        adapter.release_payload_sync()
        adapter.land_sync()

    Usage (async):
        adapter = PX4Adapter()
        await adapter.connect()
        await adapter.arm_and_takeoff(30.0)
        await adapter.goto_gps(51.5124, -0.1200, 30.0)
        await adapter.land()
    """

    def __init__(self, connection_url: str = "udp://:14540") -> None:
        self._connection_url = connection_url
        self._drone = System()

        # Cached telemetry ---------------------------------------------------
        self._position: dict = {
            "lat": 0.0,
            "lon": 0.0,
            "alt_m": 0.0,
            "relative_alt_m": 0.0,
        }
        self._battery_pct: float = 100.0
        self._flight_mode: str = "UNKNOWN"
        self._is_connected: bool = False

        # Background event loop -----------------------------------------------
        self._loop: asyncio.AbstractEventLoop = asyncio.new_event_loop()
        self._thread = threading.Thread(
            target=self._run_loop, daemon=True, name="px4-event-loop"
        )
        self._thread.start()

        # Telemetry background task handles
        self._telemetry_tasks: list[asyncio.Task] = []

    # ------------------------------------------------------------------
    # Background event loop
    # ------------------------------------------------------------------

    def _run_loop(self) -> None:
        """Target for the daemon thread — runs the asyncio loop forever."""
        asyncio.set_event_loop(self._loop)
        self._loop.run_forever()

    def _run_async(self, coro):
        """Schedule *coro* on the background loop and block until done."""
        future = asyncio.run_coroutine_threadsafe(coro, self._loop)
        return future.result()  # blocks calling thread

    # ------------------------------------------------------------------
    # Async API
    # ------------------------------------------------------------------

    async def connect(self) -> None:
        """Connect to PX4, wait for GPS lock and basic health checks."""
        logger.info("Connecting to PX4 at %s ...", self._connection_url)
        await self._drone.connect(system_address=self._connection_url)

        # Wait for connection
        async for state in self._drone.core.connection_state():
            if state.is_connected:
                logger.info("Connected to PX4")
                break

        # Wait for global position estimate
        logger.info("Waiting for GPS lock ...")
        async for health in self._drone.telemetry.health():
            if health.is_global_position_ok and health.is_home_position_ok:
                logger.info("GPS lock acquired (global=%s, home=%s)",
                            health.is_global_position_ok,
                            health.is_home_position_ok)
                break

        self._is_connected = True
        await self.start_telemetry_stream()

    async def arm_and_takeoff(self, altitude_m: float = 30.0) -> None:
        """Arm the drone, set takeoff altitude, take off, and wait until airborne."""
        if not self._is_connected:
            raise RuntimeError("Not connected. Call connect() first.")

        logger.info("Setting takeoff altitude to %.1f m", altitude_m)
        await self._drone.action.set_takeoff_altitude(altitude_m)

        logger.info("Arming ...")
        await self._drone.action.arm()

        logger.info("Taking off ...")
        await self._drone.action.takeoff()

        # Wait until we are roughly at the target altitude
        async for position in self._drone.telemetry.position():
            if position.relative_altitude_m >= altitude_m * 0.95:
                logger.info("Reached takeoff altitude (%.1f m)",
                            position.relative_altitude_m)
                break

    async def goto_gps(
        self,
        lat: float,
        lon: float,
        alt_m: float,
        speed_m_s: float = 5.0,
    ) -> None:
        """Fly to a GPS coordinate and block until within acceptance radius."""
        if not self._is_connected:
            raise RuntimeError("Not connected. Call connect() first.")

        logger.info("Flying to (%.6f, %.6f) alt=%.1f m @ %.1f m/s",
                     lat, lon, alt_m, speed_m_s)

        await self._drone.action.set_maximum_speed(speed_m_s)
        await self._drone.action.goto_location(lat, lon, alt_m, float("nan"))

        # Poll position until within acceptance radius
        while True:
            pos = self._position
            dist = _haversine_m(pos["lat"], pos["lon"], lat, lon)
            if dist <= _ACCEPTANCE_RADIUS_M:
                logger.info("Arrived at (%.6f, %.6f) — distance %.2f m",
                            lat, lon, dist)
                break
            await asyncio.sleep(_POSITION_POLL_INTERVAL_S)

    async def hold(self) -> None:
        """Hold / hover at the current position."""
        logger.info("Holding position")
        await self._drone.action.hold()

    async def land(self) -> None:
        """Land at current position and wait until on the ground."""
        logger.info("Landing ...")
        await self._drone.action.land()

        async for in_air in self._drone.telemetry.in_air():
            if not in_air:
                logger.info("Landed successfully")
                break

        # Disarm after landing
        try:
            await self._drone.action.disarm()
            logger.info("Disarmed")
        except ActionError as exc:
            logger.warning("Disarm failed (may already be disarmed): %s", exc)

    async def get_position(self) -> dict:
        """Return the most recently cached position dict."""
        return {
            "lat": self._position["lat"],
            "lon": self._position["lon"],
            "alt_m": self._position["alt_m"],
            "relative_alt_m": self._position["relative_alt_m"],
        }

    async def get_battery(self) -> float:
        """Return cached battery percentage (0-100)."""
        return self._battery_pct

    async def get_flight_mode(self) -> str:
        """Return current flight mode string."""
        return self._flight_mode

    # ------------------------------------------------------------------
    # Telemetry streaming
    # ------------------------------------------------------------------

    async def start_telemetry_stream(self) -> None:
        """Start background tasks that cache position, battery, and flight mode."""
        logger.info("Starting telemetry streams")

        await self._drone.telemetry.set_rate_position(_TELEMETRY_RATE_HZ)

        self._telemetry_tasks = [
            asyncio.ensure_future(self._stream_position()),
            asyncio.ensure_future(self._stream_battery()),
            asyncio.ensure_future(self._stream_flight_mode()),
        ]

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

    # ------------------------------------------------------------------
    # Payload release
    # ------------------------------------------------------------------

    async def release_payload(self) -> None:
        """Trigger actuator index 1 to release the payload."""
        logger.info("Releasing payload (actuator 1 -> 1.0)")
        await self._drone.action.set_actuator(1, 1.0)
        # Brief pause then reset actuator
        await asyncio.sleep(1.0)
        await self._drone.action.set_actuator(1, 0.0)
        logger.info("Payload released, actuator reset")

    # ------------------------------------------------------------------
    # Sync wrappers (for DroneController / main.py compatibility)
    # ------------------------------------------------------------------

    def connect_sync(self) -> None:
        """Synchronous connect — blocks until GPS lock."""
        self._run_async(self.connect())

    def takeoff_sync(self, altitude_m: float = 30.0) -> None:
        """Synchronous arm + takeoff — blocks until at altitude."""
        self._run_async(self.arm_and_takeoff(altitude_m))

    def goto_gps_sync(
        self,
        lat: float,
        lon: float,
        alt_m: float,
        speed: float = 5.0,
    ) -> None:
        """Synchronous goto — blocks until within acceptance radius."""
        self._run_async(self.goto_gps(lat, lon, alt_m, speed))

    def hold_sync(self) -> None:
        """Synchronous hold / hover."""
        self._run_async(self.hold())

    def land_sync(self) -> None:
        """Synchronous land — blocks until on ground."""
        self._run_async(self.land())

    def get_position_sync(self) -> dict:
        """Synchronous position fetch."""
        return self._run_async(self.get_position())

    def get_battery_sync(self) -> float:
        """Synchronous battery fetch."""
        return self._run_async(self.get_battery())

    def release_payload_sync(self) -> None:
        """Synchronous payload release."""
        self._run_async(self.release_payload())

    # ------------------------------------------------------------------
    # Cleanup
    # ------------------------------------------------------------------

    async def close(self) -> None:
        """Cancel telemetry tasks and close the MAVSDK connection."""
        for task in self._telemetry_tasks:
            task.cancel()
        self._telemetry_tasks.clear()
        self._is_connected = False
        logger.info("PX4Adapter closed")

    def close_sync(self) -> None:
        """Synchronous cleanup."""
        self._run_async(self.close())
        self._loop.call_soon_threadsafe(self._loop.stop)
        self._thread.join(timeout=5.0)


# ---------------------------------------------------------------------------
# Standalone test
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import sys

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(name)s] %(levelname)s — %(message)s",
    )

    url = sys.argv[1] if len(sys.argv) > 1 else "udp://:14540"
    logger.info("=== PX4Adapter standalone test ===")
    logger.info("Connection URL: %s", url)

    adapter = PX4Adapter(connection_url=url)

    try:
        logger.info("--- Step 1: Connect ---")
        adapter.connect_sync()

        logger.info("--- Step 2: Arm & Takeoff ---")
        adapter.takeoff_sync(altitude_m=30.0)

        logger.info("--- Step 3: Read telemetry ---")
        pos = adapter.get_position_sync()
        bat = adapter.get_battery_sync()
        logger.info("Position: %s", pos)
        logger.info("Battery : %.1f%%", bat)

        logger.info("--- Step 4: Fly to Clinic A (51.5124, -0.1200) ---")
        adapter.goto_gps_sync(51.5124, -0.1200, 30.0, speed=DRONE_VELOCITY)

        logger.info("--- Step 5: Release payload ---")
        adapter.release_payload_sync()

        logger.info("--- Step 6: Land ---")
        adapter.land_sync()

        logger.info("=== Test complete ===")

    except KeyboardInterrupt:
        logger.info("Interrupted by user")
    except Exception:
        logger.exception("Test failed")
    finally:
        adapter.close_sync()
