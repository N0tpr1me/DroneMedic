import { useState, useEffect, useMemo, useCallback } from 'react';
import { APIProvider, Map } from '@vis.gl/react-google-maps';
import { GoogleMapsOverlay } from '@deck.gl/google-maps';
import { ScatterplotLayer, ArcLayer, PolygonLayer } from '@deck.gl/layers';
import { TripsLayer } from '@deck.gl/geo-layers';
import type { Location, NoFlyZone } from '../../lib/api';

// ── Types ──

interface DroneTrail {
  id: string;
  path: Array<{ coordinates: [number, number]; timestamp: number }>;
  color: [number, number, number];
}

interface FacilityMarker {
  name: string;
  position: [number, number];
  type: 'hospital' | 'disaster' | 'depot' | 'clinic';
}

interface ArcData {
  from: [number, number];
  to: [number, number];
  priority: string;
}

interface DeckGLMapProps {
  locations: Record<string, Location>;
  route?: string[];
  reroute?: string[];
  priorities?: Record<string, string>;
  noFlyZones?: NoFlyZone[];
  droneProgress?: number;
  isFlying?: boolean;
  facilities?: FacilityMarker[];
}

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';

const TRAIL_COLORS: Array<[number, number, number]> = [
  [0, 218, 243],   // cyan
  [179, 197, 255],  // blue
  [255, 179, 172],  // red-ish
  [52, 211, 153],   // green
  [168, 85, 247],   // purple
];

const FACILITY_COLORS: Record<string, [number, number, number, number]> = {
  hospital: [52, 211, 153, 200],
  disaster: [255, 68, 68, 200],
  depot: [179, 197, 255, 200],
  clinic: [0, 218, 243, 200],
};

function getMarkerType(name: string): 'hospital' | 'disaster' | 'depot' | 'clinic' {
  if (name === 'Depot') return 'depot';
  if (name.toLowerCase().includes('hospital')) return 'hospital';
  if (name.toLowerCase().includes('disaster') || name.toLowerCase().includes('emergency')) return 'disaster';
  return 'clinic';
}

// ── Overlay Manager ──

function useDeckOverlay(layers: unknown[]) {
  const [overlay] = useState(() => new GoogleMapsOverlay({ interleaved: true }));

  useEffect(() => {
    overlay.setProps({ layers });
  }, [overlay, layers]);

  const onMapLoad = useCallback(
    (map: google.maps.Map) => {
      overlay.setMap(map);
    },
    [overlay],
  );

  useEffect(() => {
    return () => {
      overlay.setMap(null);
    };
  }, [overlay]);

  return { onMapLoad };
}

// ── Main Component ──

export function DeckGLMap({
  locations,
  route = [],
  reroute,
  priorities = {},
  noFlyZones = [],
  droneProgress = 0,
  isFlying = false,
}: DeckGLMapProps) {
  const [animationTime, setAnimationTime] = useState(0);

  // Animate the trips layer
  useEffect(() => {
    if (!isFlying) return;
    let frame: number;
    const start = performance.now();
    const loop = () => {
      const elapsed = (performance.now() - start) / 1000;
      setAnimationTime(elapsed);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [isFlying]);

  // Build facility markers from locations
  const markers: FacilityMarker[] = useMemo(
    () =>
      Object.entries(locations).map(([name, loc]) => ({
        name,
        position: [loc.lon, loc.lat] as [number, number],
        type: getMarkerType(name),
      })),
    [locations],
  );

  // Build drone trails from route
  const trails: DroneTrail[] = useMemo(() => {
    const activeRoute = reroute && reroute.length > 1 ? reroute : route;
    if (activeRoute.length < 2) return [];

    const coords = activeRoute
      .filter((name) => locations[name])
      .map((name) => locations[name]);

    if (coords.length < 2) return [];

    const trail: DroneTrail = {
      id: 'drone-0',
      path: coords.map((loc, i) => ({
        coordinates: [loc.lon, loc.lat] as [number, number],
        timestamp: i * 10,
      })),
      color: TRAIL_COLORS[0],
    };

    return [trail];
  }, [locations, route, reroute]);

  // Build arc data for origin-destination visualization
  const arcs: ArcData[] = useMemo(() => {
    const activeRoute = reroute && reroute.length > 1 ? reroute : route;
    if (activeRoute.length < 2) return [];
    const result: ArcData[] = [];
    for (let i = 0; i < activeRoute.length - 1; i++) {
      const from = locations[activeRoute[i]];
      const to = locations[activeRoute[i + 1]];
      if (from && to) {
        result.push({
          from: [from.lon, from.lat],
          to: [to.lon, to.lat],
          priority: priorities[activeRoute[i + 1]] || 'normal',
        });
      }
    }
    return result;
  }, [locations, route, reroute, priorities]);

  // Build no-fly zone polygons
  const nfzPolygons = useMemo(
    () =>
      noFlyZones.map((zone) => ({
        name: zone.name,
        polygon: zone.lat_lon.map((ll) => [ll[1], ll[0]] as [number, number]),
      })),
    [noFlyZones],
  );

  // Current drone position for pulsing dot
  const dronePosition = useMemo(() => {
    const activeRoute = reroute && reroute.length > 1 ? reroute : route;
    const coords = activeRoute
      .filter((name) => locations[name])
      .map((name) => locations[name]);
    if (coords.length < 2 || !isFlying) return null;

    const totalSegments = coords.length - 1;
    const segIndex = Math.min(Math.floor(droneProgress * totalSegments), totalSegments - 1);
    const segProgress = droneProgress * totalSegments - segIndex;
    const from = coords[segIndex];
    const to = coords[Math.min(segIndex + 1, coords.length - 1)];
    return {
      lon: from.lon + (to.lon - from.lon) * segProgress,
      lat: from.lat + (to.lat - from.lat) * segProgress,
    };
  }, [locations, route, reroute, droneProgress, isFlying]);

  // Pulsing radius for drone dot
  const pulseRadius = useMemo(() => {
    const base = 80;
    const pulse = Math.sin(animationTime * 4) * 30;
    return base + pulse;
  }, [animationTime]);

  // Build deck.gl layers
  const layers = useMemo(() => {
    const result: unknown[] = [];

    // No-fly zone polygons
    if (nfzPolygons.length > 0) {
      result.push(
        new PolygonLayer({
          id: 'no-fly-zones',
          data: nfzPolygons,
          getPolygon: (d: { polygon: [number, number][] }) => d.polygon,
          getFillColor: [255, 68, 68, 40],
          getLineColor: [255, 68, 68, 100],
          getLineWidth: 2,
          lineWidthMinPixels: 1,
          filled: true,
          stroked: true,
          pickable: true,
        }),
      );
    }

    // Origin-destination arcs
    if (arcs.length > 0) {
      result.push(
        new ArcLayer({
          id: 'route-arcs',
          data: arcs,
          getSourcePosition: (d: ArcData) => d.from,
          getTargetPosition: (d: ArcData) => d.to,
          getSourceColor: (d: ArcData) =>
            d.priority === 'high' ? [255, 179, 172, 180] : [0, 218, 243, 120],
          getTargetColor: (d: ArcData) =>
            d.priority === 'high' ? [255, 100, 100, 180] : [0, 218, 243, 180],
          getWidth: 2,
          greatCircle: false,
        }),
      );
    }

    // Animated drone trails (trips layer)
    if (trails.length > 0) {
      const maxTimestamp = Math.max(
        ...trails.flatMap((t) => t.path.map((p) => p.timestamp)),
      );
      const currentTime = isFlying ? droneProgress * maxTimestamp : maxTimestamp;

      result.push(
        new TripsLayer({
          id: 'drone-trails',
          data: trails,
          getPath: (d: DroneTrail) => d.path.map((p) => p.coordinates),
          getTimestamps: (d: DroneTrail) => d.path.map((p) => p.timestamp),
          getColor: (d: DroneTrail) => d.color,
          opacity: 0.9,
          widthMinPixels: 4,
          trailLength: maxTimestamp * 0.3,
          currentTime,
          shadowEnabled: false,
        }),
      );
    }

    // Facility markers
    result.push(
      new ScatterplotLayer({
        id: 'facility-markers',
        data: markers,
        getPosition: (d: FacilityMarker) => d.position,
        getFillColor: (d: FacilityMarker) => FACILITY_COLORS[d.type] || [0, 218, 243, 200],
        getRadius: (d: FacilityMarker) => (d.type === 'depot' ? 60 : 40),
        radiusMinPixels: 5,
        radiusMaxPixels: 15,
        stroked: true,
        getLineColor: [255, 255, 255, 100],
        lineWidthMinPixels: 1,
        pickable: true,
      }),
    );

    // Pulsing drone position
    if (dronePosition) {
      result.push(
        new ScatterplotLayer({
          id: 'drone-position',
          data: [dronePosition],
          getPosition: (d: { lon: number; lat: number }) => [d.lon, d.lat],
          getFillColor: [179, 197, 255, 200],
          getRadius: pulseRadius,
          radiusMinPixels: 6,
          radiusMaxPixels: 20,
          stroked: true,
          getLineColor: [179, 197, 255, 100],
          lineWidthMinPixels: 2,
        }),
      );

      // Inner bright core dot
      result.push(
        new ScatterplotLayer({
          id: 'drone-core',
          data: [dronePosition],
          getPosition: (d: { lon: number; lat: number }) => [d.lon, d.lat],
          getFillColor: [255, 255, 255, 240],
          getRadius: 30,
          radiusMinPixels: 3,
          radiusMaxPixels: 8,
        }),
      );
    }

    return result;
  }, [markers, trails, arcs, nfzPolygons, dronePosition, pulseRadius, isFlying, droneProgress]);

  const { onMapLoad } = useDeckOverlay(layers);

  // Map center
  const depot = locations['Depot'];
  const center = depot
    ? { lat: depot.lat, lng: depot.lon }
    : { lat: 51.5074, lng: -0.1278 };

  if (!GOOGLE_MAPS_API_KEY) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-surface-dim text-on-surface-variant text-sm">
        <div className="text-center space-y-2">
          <p className="font-medium">Google Maps API key not configured</p>
          <p className="text-xs opacity-60">
            Set VITE_GOOGLE_MAPS_API_KEY in web/.env
          </p>
        </div>
      </div>
    );
  }

  return (
    <APIProvider apiKey={GOOGLE_MAPS_API_KEY}>
      <Map
        defaultCenter={center}
        defaultZoom={14}
        defaultTilt={45}
        mapId="dronemedic-dark"
        gestureHandling="greedy"
        disableDefaultUI
        colorScheme="DARK"
        onTilesLoaded={(ev) => {
          const map = (ev as unknown as { map: google.maps.Map }).map;
          if (map) onMapLoad(map);
        }}
        style={{ width: '100%', height: '100%' }}
      />
    </APIProvider>
  );
}
