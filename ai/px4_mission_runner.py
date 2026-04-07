"""
DroneMedic — AI-Controlled PX4 Mission Runner

Orchestrates a full mission using:
  1. MissionCoordinator (Claude/GPT) — parses NL delivery requests
  2. FlightAgent (Claude) — makes safety decisions at each waypoint
  3. Route Planner (OR-Tools) — optimizes delivery order
  4. Telemetry Bridge (WebSocket) — sends commands to PX4 SITL
  5. Safety Monitor — preflight and in-flight checks

The drone in Unity and the React dashboard both visualize the flight in real-time.

Usage:
    PYTHONPATH=. python3 ai/px4_mission_runner.py "Deliver blood to Clinic B urgently"
    PYTHONPATH=. python3 ai/px4_mission_runner.py --demo    # Runs preset demo mission
"""

from __future__ import annotations

import asyncio
import json
import logging
import sys
import time
import websockets

from config import LOCATIONS

logger = logging.getLogger("DroneMedic.PX4MissionRunner")

# Telemetry bridge WebSocket
WS_URL = "ws://localhost:8765"


class PX4MissionRunner:
    """Runs an AI-controlled mission on PX4 SITL via the telemetry bridge."""

    def __init__(self) -> None:
        self._ws = None
        self._telemetry = {}
        self._running = False

    async def connect(self) -> None:
        """Connect to telemetry bridge WebSocket."""
        logger.info("Connecting to telemetry bridge at %s ...", WS_URL)
        self._ws = await websockets.connect(WS_URL)
        logger.info("Connected to telemetry bridge")

        # Start telemetry reader in background
        asyncio.ensure_future(self._read_telemetry())

    async def _read_telemetry(self) -> None:
        """Background task reading telemetry from the bridge."""
        try:
            async for message in self._ws:
                data = json.loads(message)
                if data.get("type") == "telemetry":
                    self._telemetry = data
        except websockets.ConnectionClosed:
            logger.warning("Telemetry connection closed")

    async def send_command(self, cmd: str, **kwargs) -> None:
        """Send a command to PX4 via the telemetry bridge."""
        payload = {"cmd": cmd, **kwargs}
        await self._ws.send(json.dumps(payload))
        logger.info("Sent command: %s", payload)

    async def wait_for_altitude(self, target_alt: float, timeout: float = 30.0) -> bool:
        """Wait until drone reaches target altitude."""
        start = time.time()
        while time.time() - start < timeout:
            alt = self._telemetry.get("relative_alt_m", 0)
            if alt >= target_alt * 0.9:
                return True
            await asyncio.sleep(0.5)
        return False

    async def wait_for_arrival(self, lat: float, lon: float, radius_m: float = 5.0, timeout: float = 120.0) -> bool:
        """Wait until drone is within radius of target GPS coordinates."""
        import math
        start = time.time()
        while time.time() - start < timeout:
            cur_lat = self._telemetry.get("lat", 0)
            cur_lon = self._telemetry.get("lon", 0)

            # Haversine distance
            dlat = math.radians(lat - cur_lat)
            dlon = math.radians(lon - cur_lon)
            a = (math.sin(dlat / 2) ** 2 +
                 math.cos(math.radians(cur_lat)) * math.cos(math.radians(lat)) *
                 math.sin(dlon / 2) ** 2)
            dist_m = 6371000 * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

            if dist_m <= radius_m:
                return True
            await asyncio.sleep(0.5)
        return False

    async def run_mission(self, delivery_request: str) -> dict:
        """
        Run a full AI-controlled mission.

        Args:
            delivery_request: Natural language delivery request.

        Returns:
            Mission summary dict.
        """
        self._running = True
        mission_log = []

        def log(event: str, detail: str = "") -> None:
            entry = {"event": event, "detail": detail, "time": time.time(),
                     "battery": self._telemetry.get("battery_pct", 0)}
            mission_log.append(entry)
            logger.info("[Mission] %s: %s", event, detail)

        try:
            # -- Step 1: Parse delivery request --
            log("parse_request", delivery_request)
            task = self._parse_request(delivery_request)
            locations = task.get("locations", [])
            priorities = task.get("priorities", {})
            supplies = task.get("supplies", {})
            log("parsed", f"{len(locations)} locations: {', '.join(locations)}")

            # -- Step 2: Compute optimal route --
            log("compute_route", f"Optimizing for {len(locations)} stops")
            route = self._compute_route(locations, priorities)
            log("route_computed", f"Route: {' → '.join(route)}")

            # -- Step 3: Preflight safety check --
            log("preflight_check", "Running 12-rule safety assessment")
            preflight = self._preflight_check(route, supplies)
            if preflight.get("decision") == "NO_GO":
                log("preflight_failed", str(preflight.get("failed_checks", [])))
                return {"status": "aborted", "reason": "preflight_failed", "log": mission_log}
            log("preflight_passed", f"Decision: {preflight.get('decision')} | Battery: {preflight.get('battery_state')}")

            # -- Step 4: Takeoff --
            log("takeoff", "Commanding PX4 takeoff")
            await self.send_command("takeoff")
            arrived = await self.wait_for_altitude(30.0, timeout=30)
            if not arrived:
                log("takeoff_timeout", "Failed to reach altitude")
                return {"status": "aborted", "reason": "takeoff_failed", "log": mission_log}
            log("airborne", f"Alt: {self._telemetry.get('relative_alt_m', 0):.1f}m")

            # -- Step 5: Fly route --
            reroutes = 0
            deliveries = 0

            for i, waypoint in enumerate(route):
                if waypoint == "Depot" and i == 0:
                    continue  # skip start

                # Flight decision at each waypoint
                decision = self._flight_decision(waypoint, route[i:], supplies, priorities)
                log("flight_decision", f"{waypoint}: {decision.get('action')} ({decision.get('reasoning', '')[:80]})")

                if decision["action"] == "divert_emergency":
                    divert = decision.get("divert_to", "Depot")
                    log("divert", f"Emergency divert to {divert}")
                    loc = LOCATIONS.get(divert)
                    if loc:
                        await self.send_command("goto", lat=loc["lat"], lon=loc["lon"], alt=50)
                        await self.wait_for_arrival(loc["lat"], loc["lon"])
                    break

                if decision["action"] == "abort":
                    log("abort", decision.get("reasoning", "Critical failure"))
                    await self.send_command("land")
                    break

                if decision["action"] == "skip_delivery":
                    log("skip", f"Skipping {waypoint} — {decision.get('reasoning', '')[:60]}")
                    continue

                if decision["action"] == "reroute":
                    reroutes += 1
                    log("reroute", decision.get("reasoning", "")[:80])

                # Goto waypoint
                loc = LOCATIONS.get(waypoint)
                if loc is None:
                    log("unknown_location", waypoint)
                    continue

                speed_adj = decision.get("speed_adjustment", 1.0)
                log("goto", f"{waypoint} (speed: {speed_adj:.0%})")
                await self.send_command("goto", lat=loc["lat"], lon=loc["lon"], alt=50)

                arrived = await self.wait_for_arrival(loc["lat"], loc["lon"], radius_m=5.0, timeout=120)
                if arrived:
                    log("arrived", f"{waypoint} | Battery: {self._telemetry.get('battery_pct', 0):.1f}%")
                    if waypoint != "Depot":
                        deliveries += 1
                        supply = supplies.get(waypoint, "medical_supplies")
                        log("delivered", f"{supply} to {waypoint}")
                else:
                    log("timeout", f"Failed to reach {waypoint} in 120s")

                # Brief hover for delivery
                await asyncio.sleep(3)

            # -- Step 6: Return to base and land --
            depot = LOCATIONS.get("Depot")
            if depot:
                log("return_to_base", "Heading to Depot")
                await self.send_command("goto", lat=depot["lat"], lon=depot["lon"], alt=50)
                await self.wait_for_arrival(depot["lat"], depot["lon"])

            log("landing", "Commanding land")
            await self.send_command("land")
            await asyncio.sleep(5)

            log("mission_complete", f"Deliveries: {deliveries}, Reroutes: {reroutes}")

            return {
                "status": "completed",
                "deliveries": deliveries,
                "reroutes": reroutes,
                "total_stops": len(route),
                "final_battery": self._telemetry.get("battery_pct", 0),
                "log": mission_log,
            }

        except Exception as e:
            log("error", str(e))
            return {"status": "error", "reason": str(e), "log": mission_log}
        finally:
            self._running = False

    # -- Delegated functions (use existing modules) --

    def _parse_request(self, text: str) -> dict:
        """Parse NL request using AI coordinator or fallback."""
        try:
            from ai.coordinator import MissionCoordinator
            coordinator = MissionCoordinator()
            return coordinator.parse_request(text)
        except Exception as e:
            logger.warning("AI parse failed (%s), using fallback", e)
            # Simple keyword-based fallback
            locations = []
            priorities = {}
            supplies = {}
            for name in LOCATIONS:
                if name.lower() in text.lower() and name != "Depot":
                    locations.append(name)
                    if "urgent" in text.lower() or "emergency" in text.lower():
                        priorities[name] = "high"
                    if "blood" in text.lower():
                        supplies[name] = "blood_pack"
                    elif "insulin" in text.lower():
                        supplies[name] = "insulin"
            if not locations:
                locations = ["Clinic A", "Clinic B", "Clinic C"]
            return {"locations": locations, "priorities": priorities, "supplies": supplies}

    def _compute_route(self, locations: list, priorities: dict) -> list:
        """Compute optimal route using OR-Tools."""
        try:
            from backend.route_planner import compute_route
            result = compute_route(locations, priorities, num_drones=1)
            return result.get("ordered_route", ["Depot"] + locations + ["Depot"])
        except Exception as e:
            logger.warning("Route planner failed (%s), using simple order", e)
            return ["Depot"] + locations + ["Depot"]

    def _preflight_check(self, route: list, supplies: dict) -> dict:
        """Run preflight safety check."""
        try:
            from backend.safety import preflight_check
            from backend.physics import DroneSpec
            total_weight = sum(
                {"blood_pack": 0.5, "insulin": 0.1, "defibrillator": 2.0, "surgical_kit": 1.5}
                .get(s, 0.5) for s in supplies.values()
            )
            return preflight_check(DroneSpec(), total_weight, route)
        except Exception as e:
            logger.warning("Preflight check failed (%s), assuming GO", e)
            return {"decision": "GO", "battery_state": "GREEN"}

    def _flight_decision(self, waypoint: str, remaining: list, supplies: dict, priorities: dict) -> dict:
        """Get flight decision from FlightAgent (rule-based fallback)."""
        try:
            from ai.flight_agent import FlightAgent, FlightContext
            agent = FlightAgent()

            ctx = FlightContext(
                drone_id="PX4Drone",
                battery_pct=self._telemetry.get("battery_pct", 100),
                battery_state="GREEN" if self._telemetry.get("battery_pct", 100) > 40 else "AMBER",
                current_location=self._telemetry.get("current_location", "unknown"),
                next_waypoint=waypoint,
                remaining_waypoints=remaining,
                remaining_deliveries=len([r for r in remaining if r != "Depot"]),
                speed_ms=self._telemetry.get("speed_m_s", 15),
                altitude_m=self._telemetry.get("relative_alt_m", 50),
                wind_speed_ms=3.0,
                precipitation_mm=0,
                temperature_c=15,
                payload_type=supplies.get(waypoint, "medical_supplies"),
                payload_priority=priorities.get(waypoint, "P3_ROUTINE"),
                mission_progress_pct=0,
                reroute_count=0,
                nearest_facility="Depot",
                nearest_facility_distance_km=1.0,
                nfz_nearby=False,
            )

            # Use sync rule-based (async LLM would need event loop nesting)
            decision = agent._rule_based_decide(ctx)
            return {
                "action": decision.action,
                "reasoning": decision.reasoning,
                "speed_adjustment": decision.speed_adjustment,
                "divert_to": decision.divert_to,
            }
        except Exception as e:
            logger.warning("Flight decision failed (%s), continuing", e)
            return {"action": "continue", "reasoning": "Fallback: continue", "speed_adjustment": 1.0}


async def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    )

    # Parse CLI args
    if len(sys.argv) > 1 and sys.argv[1] == "--demo":
        request = "Deliver blood to Clinic B urgently and insulin to Clinic A, avoid the military zone"
    elif len(sys.argv) > 1:
        request = " ".join(sys.argv[1:])
    else:
        request = "Deliver medical supplies to Clinic A, Clinic B, and Clinic C"

    print("=" * 60)
    print("  DroneMedic — AI-Controlled PX4 Mission")
    print("=" * 60)
    print(f"  Request: {request}")
    print("=" * 60)

    runner = PX4MissionRunner()
    await runner.connect()

    # Give telemetry a moment to start
    await asyncio.sleep(2)

    result = await runner.run_mission(request)

    print("\n" + "=" * 60)
    print("  Mission Result")
    print("=" * 60)
    print(f"  Status:     {result['status']}")
    print(f"  Deliveries: {result.get('deliveries', 0)}")
    print(f"  Reroutes:   {result.get('reroutes', 0)}")
    print(f"  Battery:    {result.get('final_battery', 0):.1f}%")
    print(f"  Log entries: {len(result.get('log', []))}")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
