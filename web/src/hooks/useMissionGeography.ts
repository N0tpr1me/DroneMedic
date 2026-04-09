// Fetches mission geography (clinics + no-fly zones) once per session from the
// existing FastAPI endpoints and validates the shape with Zod. Returns a stable
// object that the 3D simulator's overlays can consume without defensive checks.

import { useEffect, useState } from 'react';
import { z } from 'zod';
import { backendHttpUrl } from '../lib/backendUrls';

const LocationSchema = z.object({
  name: z.string(),
  lat: z.number(),
  lon: z.number(),
  z: z.number().optional(),
  type: z.string().optional(),
  description: z.string().optional(),
});

const LocationsPayload = z.union([
  z.array(LocationSchema),
  z.record(z.string(), LocationSchema),
]);

const NoFlyZoneSchema = z.object({
  name: z.string(),
  polygon: z.array(z.tuple([z.number(), z.number()])).optional(),
  lat_lon: z.array(z.tuple([z.number(), z.number()])).optional(),
});

const NoFlyPayload = z.array(NoFlyZoneSchema);

export type MissionLocation = z.infer<typeof LocationSchema>;
export type MissionNoFlyZone = z.infer<typeof NoFlyZoneSchema>;

export interface MissionGeography {
  locations: MissionLocation[];
  noFlyZones: MissionNoFlyZone[];
  loaded: boolean;
  error: string | null;
}

const EMPTY: MissionGeography = {
  locations: [],
  noFlyZones: [],
  loaded: false,
  error: null,
};

let _cache: MissionGeography | null = null;
let _inflight: Promise<MissionGeography> | null = null;

async function fetchMissionGeography(): Promise<MissionGeography> {
  if (_cache) return _cache;
  if (_inflight) return _inflight;

  _inflight = (async () => {
    const result: MissionGeography = { ...EMPTY };
    const tryEndpoints = async <T,>(
      paths: string[],
      schema: z.ZodType<T>,
    ): Promise<T | null> => {
      for (const path of paths) {
        try {
          const res = await fetch(backendHttpUrl(path));
          if (!res.ok) continue;
          const data = await res.json();
          const parsed = schema.safeParse(data);
          if (parsed.success) return parsed.data;
        } catch {
          /* fall through */
        }
      }
      return null;
    };

    const rawLocations = await tryEndpoints(
      ['/api/facilities', '/api/locations'],
      LocationsPayload,
    );
    if (rawLocations) {
      result.locations = Array.isArray(rawLocations)
        ? rawLocations
        : Object.entries(rawLocations).map(([name, loc]) => ({
            ...(loc as MissionLocation),
            name: loc.name ?? name,
          }));
    }

    const noFly = await tryEndpoints(
      ['/api/geofence/zones', '/api/geofence'],
      NoFlyPayload,
    );
    if (noFly) {
      result.noFlyZones = noFly;
    }

    result.loaded = true;
    if (!rawLocations && !noFly) {
      result.error = 'mission geography API unreachable';
    }
    _cache = result;
    _inflight = null;
    return result;
  })();

  return _inflight;
}

export function useMissionGeography(): MissionGeography {
  const [state, setState] = useState<MissionGeography>(_cache ?? EMPTY);

  useEffect(() => {
    let cancelled = false;
    fetchMissionGeography().then((result) => {
      if (!cancelled) setState(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

/** Reset the module-level cache — useful for tests / dev tools. */
export function resetMissionGeographyCache(): void {
  _cache = null;
  _inflight = null;
}
