"""
DroneMedic - Google Maps backend service.

Provides geocoding, elevation, nearby facility search, distance matrix,
and country detection via the Google Maps Python client.
"""

import logging
import os
from functools import lru_cache
from typing import Optional

import googlemaps
from googlemaps.exceptions import ApiError, TransportError, Timeout

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Facility type groups used by find_medical_facilities
# ---------------------------------------------------------------------------
_MEDICAL_FACILITY_TYPES = ("hospital", "pharmacy", "doctor", "health")


class GoogleMapsError(Exception):
    """Raised when a Google Maps API call fails."""


class GoogleMapsService:
    """Thin wrapper around the googlemaps client with error handling."""

    def __init__(self, api_key: Optional[str] = None) -> None:
        key = api_key or os.getenv("GOOGLE_MAPS_API_KEY", "")
        if not key:
            raise GoogleMapsError(
                "Google Maps API key is missing. "
                "Set GOOGLE_MAPS_API_KEY in .env or pass it explicitly."
            )
        self._client = googlemaps.Client(key=key)
        logger.info("GoogleMapsService initialised.")

    # ------------------------------------------------------------------
    # Geocoding
    # ------------------------------------------------------------------

    def geocode(self, address: str) -> Optional[dict]:
        """Convert *address* to ``{lat, lon, formatted_address}``.

        Returns ``None`` when the address cannot be resolved.
        """
        try:
            results = self._client.geocode(address)
        except (ApiError, TransportError, Timeout) as exc:
            logger.error("Geocode failed for %r: %s", address, exc)
            raise GoogleMapsError(f"Geocode request failed: {exc}") from exc

        if not results:
            logger.warning("No geocode results for %r", address)
            return None

        location = results[0]["geometry"]["location"]
        return {
            "lat": location["lat"],
            "lon": location["lng"],
            "formatted_address": results[0].get("formatted_address", ""),
        }

    # ------------------------------------------------------------------
    # Reverse geocoding
    # ------------------------------------------------------------------

    def reverse_geocode(self, lat: float, lon: float) -> Optional[str]:
        """Return the formatted address for *lat*/*lon*, or ``None``."""
        try:
            results = self._client.reverse_geocode((lat, lon))
        except (ApiError, TransportError, Timeout) as exc:
            logger.error("Reverse geocode failed for (%s, %s): %s", lat, lon, exc)
            raise GoogleMapsError(f"Reverse geocode request failed: {exc}") from exc

        if not results:
            return None
        return results[0].get("formatted_address")

    # ------------------------------------------------------------------
    # Elevation
    # ------------------------------------------------------------------

    def elevation(self, lat: float, lon: float) -> float:
        """Get elevation in metres above sea level for a single point."""
        try:
            results = self._client.elevation((lat, lon))
        except (ApiError, TransportError, Timeout) as exc:
            logger.error("Elevation failed for (%s, %s): %s", lat, lon, exc)
            raise GoogleMapsError(f"Elevation request failed: {exc}") from exc

        if not results:
            raise GoogleMapsError(f"No elevation data for ({lat}, {lon})")
        return results[0]["elevation"]

    def elevation_along_path(
        self,
        points: list[tuple[float, float]],
        samples: int = 20,
    ) -> list[float]:
        """Return elevation profile along *points* (list of ``(lat, lon)``).

        *samples* controls how many evenly-spaced elevation readings are
        returned along the path.
        """
        if len(points) < 2:
            raise GoogleMapsError("elevation_along_path requires at least 2 points")

        try:
            results = self._client.elevation_along_path(points, samples)
        except (ApiError, TransportError, Timeout) as exc:
            logger.error("Elevation along path failed: %s", exc)
            raise GoogleMapsError(f"Elevation along path failed: {exc}") from exc

        return [r["elevation"] for r in results]

    # ------------------------------------------------------------------
    # Places – hospital / medical facility search
    # ------------------------------------------------------------------

    def _places_nearby(
        self,
        lat: float,
        lon: float,
        radius_m: int,
        place_type: str,
    ) -> list[dict]:
        """Low-level wrapper for the Places Nearby Search."""
        try:
            resp = self._client.places_nearby(
                location=(lat, lon),
                radius=radius_m,
                type=place_type,
            )
        except (ApiError, TransportError, Timeout) as exc:
            logger.error("Places nearby (%s) failed: %s", place_type, exc)
            raise GoogleMapsError(f"Places nearby request failed: {exc}") from exc

        results: list[dict] = []
        for place in resp.get("results", []):
            loc = place.get("geometry", {}).get("location", {})
            results.append({
                "name": place.get("name", ""),
                "lat": loc.get("lat"),
                "lon": loc.get("lng"),
                "address": place.get("vicinity", ""),
                "place_id": place.get("place_id", ""),
                "types": place.get("types", []),
            })
        return results

    def find_hospitals(
        self, lat: float, lon: float, radius_m: int = 5000
    ) -> list[dict]:
        """Find nearby hospitals using Places API.

        Returns ``[{name, lat, lon, address, place_id}]``.
        """
        return self._places_nearby(lat, lon, radius_m, "hospital")

    def find_medical_facilities(
        self, lat: float, lon: float, radius_m: int = 5000
    ) -> list[dict]:
        """Find hospitals, clinics, pharmacies, and doctors nearby.

        Merges results from multiple facility types, de-duplicated by
        ``place_id``.
        """
        seen: set[str] = set()
        merged: list[dict] = []

        for ftype in _MEDICAL_FACILITY_TYPES:
            for facility in self._places_nearby(lat, lon, radius_m, ftype):
                pid = facility.get("place_id", "")
                if pid and pid not in seen:
                    seen.add(pid)
                    merged.append(facility)

        return merged

    # ------------------------------------------------------------------
    # Distance Matrix
    # ------------------------------------------------------------------

    def distance_matrix(
        self,
        origins: list[tuple[float, float]],
        destinations: list[tuple[float, float]],
    ) -> dict:
        """Get driving distance/duration matrix.

        Returns::

            {
                "rows": [
                    {
                        "elements": [
                            {"distance_m": int, "duration_s": int, "status": str},
                            ...
                        ]
                    },
                    ...
                ]
            }
        """
        try:
            resp = self._client.distance_matrix(
                origins=origins,
                destinations=destinations,
                mode="driving",
            )
        except (ApiError, TransportError, Timeout) as exc:
            logger.error("Distance matrix failed: %s", exc)
            raise GoogleMapsError(f"Distance matrix request failed: {exc}") from exc

        rows: list[dict] = []
        for row in resp.get("rows", []):
            elements: list[dict] = []
            for elem in row.get("elements", []):
                status = elem.get("status", "UNKNOWN")
                elements.append({
                    "distance_m": (
                        elem["distance"]["value"] if status == "OK" else None
                    ),
                    "duration_s": (
                        elem["duration"]["value"] if status == "OK" else None
                    ),
                    "status": status,
                })
            rows.append({"elements": elements})

        return {"rows": rows}

    # ------------------------------------------------------------------
    # Country detection
    # ------------------------------------------------------------------

    def detect_country(self, lat: float, lon: float) -> Optional[str]:
        """Reverse geocode to extract the short country code (e.g. ``'GB'``).

        Returns ``None`` when the country cannot be determined.
        """
        try:
            results = self._client.reverse_geocode(
                (lat, lon),
                result_type="country",
            )
        except (ApiError, TransportError, Timeout) as exc:
            logger.error("Detect country failed for (%s, %s): %s", lat, lon, exc)
            raise GoogleMapsError(f"Detect country request failed: {exc}") from exc

        if not results:
            return None

        for component in results[0].get("address_components", []):
            if "country" in component.get("types", []):
                return component.get("short_name")
        return None


# ---------------------------------------------------------------------------
# Module-level singleton accessor
# ---------------------------------------------------------------------------


@lru_cache(maxsize=1)
def get_maps_service() -> GoogleMapsService:
    """Return a cached singleton :class:`GoogleMapsService`."""
    return GoogleMapsService()


# ---------------------------------------------------------------------------
# Self-test
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import sys

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    # Ensure dotenv is loaded so GOOGLE_MAPS_API_KEY is available
    try:
        from dotenv import load_dotenv
        load_dotenv()
    except ImportError:
        pass

    try:
        svc = get_maps_service()
    except GoogleMapsError as exc:
        logger.error("Cannot start service: %s", exc)
        sys.exit(1)

    # --- 1. Geocode test ---
    print("\n=== Geocode: 'London Bridge' ===")
    result = svc.geocode("London Bridge")
    if result:
        print(f"  lat={result['lat']}, lon={result['lon']}")
        print(f"  address={result['formatted_address']}")
    else:
        print("  (no result)")

    # --- 2. Elevation test (London centre) ---
    test_lat, test_lon = 51.5074, -0.1278
    print(f"\n=== Elevation at ({test_lat}, {test_lon}) ===")
    try:
        elev = svc.elevation(test_lat, test_lon)
        print(f"  {elev:.1f} m above sea level")
    except GoogleMapsError as exc:
        print(f"  Error: {exc}")

    # --- 3. Hospital search near Depot ---
    print(f"\n=== Hospitals within 5 km of ({test_lat}, {test_lon}) ===")
    hospitals = svc.find_hospitals(test_lat, test_lon, radius_m=5000)
    for h in hospitals[:5]:
        print(f"  {h['name']:40s}  ({h['lat']:.4f}, {h['lon']:.4f})  {h['address']}")

    # --- 4. Country detection ---
    print(f"\n=== Country at ({test_lat}, {test_lon}) ===")
    country = svc.detect_country(test_lat, test_lon)
    print(f"  {country}")

    print("\nDone.")
