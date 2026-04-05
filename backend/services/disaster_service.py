"""Disaster Intelligence Service — polls EONET, converts to geofence zones + mission events."""

from __future__ import annotations

import math
import logging
import asyncio
from datetime import datetime, timezone
from typing import Any

import requests

logger = logging.getLogger("DroneMedic.DisasterService")

EONET_URL = "https://eonet.gsfc.nasa.gov/api/v3/events"

# Threat radius per disaster category (km)
THREAT_RADIUS: dict[str, float] = {
    "wildfires": 5.0,
    "severeStorms": 10.0,
    "volcanoes": 20.0,
    "earthquakes": 15.0,
    "floods": 8.0,
    "landslides": 3.0,
    "seaLakeIce": 2.0,
    "tempExtremes": 5.0,
    "military": 3.0,
}

SEVERITY_MAP: dict[str, str] = {
    "wildfires": "CRITICAL",
    "severeStorms": "MAJOR",
    "volcanoes": "CRITICAL",
    "earthquakes": "CRITICAL",
    "floods": "MAJOR",
    "landslides": "MAJOR",
    "military": "CRITICAL",
}


class DisasterIntelligenceService:
    """Polls NASA EONET for real disaster data and converts events into
    dynamic no-fly zones and mission-level threat objects."""

    def __init__(self) -> None:
        self._active_threats: list[dict] = []
        self._processed_ids: set[str] = set()

    # ── Queries ───────────────────────────────────────────────────────

    def get_active_threats(self) -> list[dict]:
        """Return a snapshot of all active threat zones."""
        return list(self._active_threats)

    # ── EONET polling ─────────────────────────────────────────────────

    async def poll_eonet(self, days: int = 30, limit: int = 20) -> list[dict]:
        """Fetch recent open EONET events.  Returns raw event dicts."""
        try:
            resp = requests.get(
                EONET_URL,
                params={"days": days, "limit": limit, "status": "open"},
                timeout=10,
            )
            resp.raise_for_status()
            data = resp.json()
            return data.get("events", [])
        except Exception as e:
            logger.warning("EONET fetch failed: %s", e)
            return []

    # ── Conversion ────────────────────────────────────────────────────

    def event_to_threat_zone(self, event: dict) -> dict | None:
        """Convert a single EONET event to a threat-zone dict with polygon."""
        categories = event.get("categories", [])
        cat_id = categories[0].get("id", "") if categories else ""

        geometry = event.get("geometry", [])
        if not geometry:
            return None

        latest = geometry[-1]
        coords = latest.get("coordinates", [])
        if len(coords) < 2:
            return None

        lon, lat = coords[0], coords[1]
        radius_km = THREAT_RADIUS.get(cat_id, 5.0)
        severity = SEVERITY_MAP.get(cat_id, "MINOR")

        polygon = self._circle_polygon(lat, lon, radius_km)

        return {
            "id": event.get("id", ""),
            "title": event.get("title", "Unknown Event"),
            "category": cat_id,
            "severity": severity,
            "lat": lat,
            "lon": lon,
            "radius_km": radius_km,
            "polygon_latlon": polygon,
            "source": "EONET",
            "detected_at": datetime.now(timezone.utc).isoformat(),
        }

    # ── Geometry helpers ──────────────────────────────────────────────

    @staticmethod
    def _circle_polygon(
        center_lat: float,
        center_lon: float,
        radius_km: float,
        points: int = 16,
    ) -> list[tuple[float, float]]:
        """Generate a circular polygon (lat/lon pairs) around a centre point."""
        polygon: list[tuple[float, float]] = []
        for i in range(points):
            angle = 2 * math.pi * i / points
            dlat = (radius_km / 111.32) * math.cos(angle)
            dlon = (
                radius_km / (111.32 * math.cos(math.radians(center_lat)))
            ) * math.sin(angle)
            polygon.append((center_lat + dlat, center_lon + dlon))
        return polygon

    @staticmethod
    def _haversine_km(
        lat1: float, lon1: float, lat2: float, lon2: float
    ) -> float:
        """Great-circle distance between two lat/lon points in km."""
        R = 6371.0
        dlat = math.radians(lat2 - lat1)
        dlon = math.radians(lon2 - lon1)
        a = (
            math.sin(dlat / 2) ** 2
            + math.cos(math.radians(lat1))
            * math.cos(math.radians(lat2))
            * math.sin(dlon / 2) ** 2
        )
        return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

    # ── Route threat check ────────────────────────────────────────────

    def check_route_threatened(
        self,
        route_coords: list[tuple[float, float]],
        threat: dict,
    ) -> bool:
        """Return True if any point on *route_coords* falls inside *threat* radius."""
        for lat, lon in route_coords:
            dist = self._haversine_km(lat, lon, threat["lat"], threat["lon"])
            if dist < threat["radius_km"]:
                return True
        return False

    # ── Geofence injection ────────────────────────────────────────────

    def inject_threat_as_nfz(self, threat: dict) -> str:
        """Register the threat as a dynamic no-fly zone via the geofence module."""
        from backend.geofence import add_no_fly_zone

        zone_name = f"DISASTER_{threat['category']}_{threat['id'][:8]}"
        # Approximate AirSim-style polygon from lat/lon (scaled)
        sim_polygon = [
            (lat * 1000, lon * 1000) for lat, lon in threat["polygon_latlon"]
        ]
        add_no_fly_zone({
            "name": zone_name,
            "polygon": sim_polygon,
            "lat_lon": threat["polygon_latlon"],
        })
        logger.info("Added dynamic NFZ: %s (%s)", zone_name, threat["title"])
        return zone_name

    # ── Demo / simulation helpers ─────────────────────────────────────

    def inject_demo_disaster(
        self, disaster_type: str, lat: float, lon: float
    ) -> dict:
        """Create a simulated disaster threat for demo purposes."""
        threat: dict[str, Any] = {
            "id": f"demo_{disaster_type}_{int(datetime.now().timestamp())}",
            "title": f"Simulated {disaster_type.replace('_', ' ').title()}",
            "category": disaster_type,
            "severity": SEVERITY_MAP.get(disaster_type, "MAJOR"),
            "lat": lat,
            "lon": lon,
            "radius_km": THREAT_RADIUS.get(disaster_type, 5.0),
            "polygon_latlon": self._circle_polygon(
                lat, lon, THREAT_RADIUS.get(disaster_type, 5.0)
            ),
            "source": "DEMO",
            "detected_at": datetime.now(timezone.utc).isoformat(),
        }
        self._active_threats.append(threat)
        nfz_name = self.inject_threat_as_nfz(threat)
        return {**threat, "nfz_name": nfz_name}

    def inject_military_zone(
        self, lat: float, lon: float, radius_km: float = 3.0
    ) -> dict:
        """Inject a military exclusion zone."""
        return self.inject_demo_disaster("military", lat, lon)

    def clear_demo_threats(self) -> None:
        """Remove all demo/simulated threats and their NFZs."""
        from backend.geofence import remove_no_fly_zone

        for threat in self._active_threats:
            zone_name = f"DISASTER_{threat['category']}_{threat['id'][:8]}"
            try:
                remove_no_fly_zone(zone_name)
            except Exception:
                pass
        self._active_threats.clear()
