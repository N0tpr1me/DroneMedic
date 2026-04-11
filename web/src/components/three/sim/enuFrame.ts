// ENU frame helpers anchored at the London depot. Used for all non-SettledObject
// geometry so that mission overlays share the same coordinate basis as the
// Google 3D Tiles ENU frame they're nested inside.
//
// Inside the <EastNorthUpFrame lat lon height=0> the axes are:
//   +x : East
//   +y : Up
//   -z : North   (three.js convention — North is -z)
// so a lat/lon offset from the depot is projected into meters (East, North)
// via the small-angle flat-earth approximation. At city scale (<10 km) the
// error is a few cm which is far below the tile LOD.

export const DEG = Math.PI / 180;

// Depot location (must match config.py PX4_HOME_LAT / PX4_HOME_LON).
export const DEPOT_LAT = 51.5074;
export const DEPOT_LON = -0.1278;
export const DEPOT_LAT_RAD = DEPOT_LAT * DEG;
export const DEPOT_LON_RAD = DEPOT_LON * DEG;

// Meters per degree at the depot latitude (precomputed once).
const METERS_PER_DEG_LAT = 111_132.92; // geodesic, small-angle
const METERS_PER_DEG_LON = 111_412.84 * Math.cos(DEPOT_LAT_RAD);

export interface LatLonAlt {
  lat: number;
  lon: number;
  alt?: number;
}

export interface EnuMeters {
  east: number;
  north: number;
  up: number;
}

/** Project lat/lon/alt to local ENU meters relative to the London depot. */
export function enuFromLatLon(lat: number, lon: number, alt = 0): EnuMeters {
  const east = (lon - DEPOT_LON) * METERS_PER_DEG_LON;
  const north = (lat - DEPOT_LAT) * METERS_PER_DEG_LAT;
  return { east, north, up: alt };
}

/** Three.js position tuple for a lat/lon/alt, compatible with +y=up / -z=north. */
export function threePosFromLatLon(
  lat: number,
  lon: number,
  alt = 0,
): [number, number, number] {
  const { east, north, up } = enuFromLatLon(lat, lon, alt);
  return [east, up, -north];
}

/** Haversine distance in meters between two lat/lon points. */
export function haversineMeters(
  a: LatLonAlt,
  b: LatLonAlt,
): number {
  const R = 6_371_000;
  const phi1 = a.lat * DEG;
  const phi2 = b.lat * DEG;
  const dPhi = (b.lat - a.lat) * DEG;
  const dLambda = (b.lon - a.lon) * DEG;
  const h =
    Math.sin(dPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Great-circle initial bearing in degrees [0, 360). */
export function bearingDeg(from: LatLonAlt, to: LatLonAlt): number {
  const phi1 = from.lat * DEG;
  const phi2 = to.lat * DEG;
  const dLambda = (to.lon - from.lon) * DEG;
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  const brg = (Math.atan2(y, x) * 180) / Math.PI;
  return (brg + 360) % 360;
}
