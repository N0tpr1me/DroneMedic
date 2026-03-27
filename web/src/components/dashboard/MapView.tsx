import { useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, Polyline, CircleMarker, Popup, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Location, Weather, NoFlyZone } from '../../lib/api';

// ── Custom drone icon ──
const droneIcon = L.divIcon({
  className: '',
  html: `<div style="
    width: 20px; height: 20px;
    background: #b3c5ff;
    transform: rotate(45deg);
    border-radius: 2px;
    box-shadow: 0 0 20px rgba(179, 197, 255, 0.6), 0 0 40px rgba(179, 197, 255, 0.3);
  "></div>`,
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

const clinicIcon = (color: string) => L.divIcon({
  className: '',
  html: `<div style="
    width: 12px; height: 12px;
    background: ${color};
    border-radius: 50%;
    border: 2px solid rgba(255,255,255,0.3);
    box-shadow: 0 0 10px ${color};
  "></div>`,
  iconSize: [12, 12],
  iconAnchor: [6, 6],
});

// ── Animate drone along route ──
interface AnimatedDroneProps {
  route: Array<[number, number]>;
  progress: number;
  isFlying: boolean;
}

function AnimatedDrone({ route, progress, isFlying }: AnimatedDroneProps) {
  const map = useMap();
  const markerRef = useRef<L.Marker | null>(null);

  useEffect(() => {
    if (!isFlying || route.length < 2) {
      if (markerRef.current) {
        markerRef.current.remove();
        markerRef.current = null;
      }
      return;
    }

    if (!markerRef.current) {
      markerRef.current = L.marker(route[0], { icon: droneIcon }).addTo(map);
    }

    const totalSegments = route.length - 1;
    const segIndex = Math.min(Math.floor(progress * totalSegments), totalSegments - 1);
    const segProgress = (progress * totalSegments) - segIndex;

    const from = route[segIndex];
    const to = route[Math.min(segIndex + 1, route.length - 1)];
    const lat = from[0] + (to[0] - from[0]) * segProgress;
    const lng = from[1] + (to[1] - from[1]) * segProgress;

    markerRef.current.setLatLng([lat, lng]);

    return () => {
      if (markerRef.current) {
        markerRef.current.remove();
        markerRef.current = null;
      }
    };
  }, [map, route, progress, isFlying]);

  return null;
}

// ── Map controller for external commands ──
interface MapControllerProps {
  command: MapCommand | null;
  onCommandHandled: () => void;
}

export type MapCommand =
  | { type: 'zoom-in' }
  | { type: 'zoom-out' }
  | { type: 'center-depot'; lat: number; lon: number }
  | { type: 'toggle-layer' };

const LEFT_NAV_WIDTH = 90;
const RIGHT_HUD_WIDTH = 360;

function centerWithOffset(map: L.Map, lat: number, lon: number, zoom: number, animate = true) {
  const targetZoom = zoom;
  const targetPoint = map.project([lat, lon], targetZoom);
  // Shift map so depot is centered in the visible area between left nav and right HUD
  // Positive offsetX shifts the depot to the right on screen
  const offsetX = (RIGHT_HUD_WIDTH - LEFT_NAV_WIDTH) / 2;
  const adjustedPoint = L.point(targetPoint.x + offsetX, targetPoint.y);
  const adjustedLatLng = map.unproject(adjustedPoint, targetZoom);
  if (animate) {
    map.flyTo(adjustedLatLng, targetZoom, { animate: true, duration: 1 });
  } else {
    map.setView(adjustedLatLng, targetZoom);
  }
}

function MapController({ command, onCommandHandled, depotLat, depotLon, onCenteredChange }: MapControllerProps & { depotLat?: number; depotLon?: number; onCenteredChange?: (centered: boolean) => void }) {
  const map = useMap();
  const initialCentered = useRef(false);

  // On first render, offset the center to account for the sidebar
  useEffect(() => {
    if (initialCentered.current || !depotLat || !depotLon) return;
    initialCentered.current = true;
    // Small delay to let the map container size settle
    setTimeout(() => {
      centerWithOffset(map, depotLat, depotLon, 14, false);
    }, 100);
  }, [map, depotLat, depotLon]);

  useEffect(() => {
    if (!depotLat || !depotLon || !onCenteredChange) return;

    const checkCentered = () => {
      const center = map.getCenter();
      const zoom = map.getZoom();
      const offsetX = (RIGHT_HUD_WIDTH - LEFT_NAV_WIDTH) / 2;
      const centerPoint = map.project(center, zoom);
      const expectedPoint = L.point(
        map.project([depotLat, depotLon], zoom).x + offsetX,
        map.project([depotLat, depotLon], zoom).y
      );
      const dist = Math.abs(expectedPoint.x - centerPoint.x) + Math.abs(expectedPoint.y - centerPoint.y);
      onCenteredChange(dist < 30);
    };

    map.on('moveend', checkCentered);
    return () => { map.off('moveend', checkCentered); };
  }, [map, depotLat, depotLon, onCenteredChange]);

  useEffect(() => {
    if (!command) return;

    switch (command.type) {
      case 'zoom-in':
        map.zoomIn(1, { animate: true });
        break;
      case 'zoom-out':
        map.zoomOut(1, { animate: true });
        break;
      case 'center-depot':
        centerWithOffset(map, command.lat, command.lon, map.getZoom());
        break;
    }

    onCommandHandled();
  }, [command, map, onCommandHandled]);

  return null;
}

// ── User live location ──
function UserLocation() {
  const map = useMap();
  const markerRef = useRef<L.Marker | null>(null);
  const circleRef = useRef<L.Circle | null>(null);

  useEffect(() => {
    if (!navigator.geolocation) return;

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        const latlng: L.LatLngExpression = [latitude, longitude];

        if (!markerRef.current) {
          const userIcon = L.divIcon({
            className: '',
            html: `<div style="
              width: 14px; height: 14px;
              background: #4285F4;
              border-radius: 50%;
              border: 3px solid white;
              box-shadow: 0 0 10px rgba(66,133,244,0.6), 0 0 20px rgba(66,133,244,0.3);
            "></div>`,
            iconSize: [14, 14],
            iconAnchor: [7, 7],
          });
          markerRef.current = L.marker(latlng, { icon: userIcon, zIndexOffset: 1000 }).addTo(map);
          markerRef.current.bindPopup(
            `<div style="color:#dfe3e9;background:#1b2024;padding:8px 12px;border-radius:8px;font-size:12px">
              <div style="font-family:Space Grotesk;font-weight:700;font-size:13px;margin-bottom:4px">Your Location</div>
              <div style="opacity:0.7;font-size:11px">Accuracy: ${Math.round(accuracy)}m</div>
            </div>`
          );
        } else {
          markerRef.current.setLatLng(latlng);
        }

        if (!circleRef.current) {
          circleRef.current = L.circle(latlng, {
            radius: accuracy,
            color: '#4285F4',
            fillColor: '#4285F4',
            fillOpacity: 0.1,
            weight: 1,
            opacity: 0.3,
          }).addTo(map);
        } else {
          circleRef.current.setLatLng(latlng);
          circleRef.current.setRadius(accuracy);
        }
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
      if (markerRef.current) { markerRef.current.remove(); markerRef.current = null; }
      if (circleRef.current) { circleRef.current.remove(); circleRef.current = null; }
    };
  }, [map]);

  return null;
}

// ── Tile layer switcher ──
const TILE_LAYERS = [
  { name: 'Dark', url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png' },
  { name: 'Satellite', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}' },
  { name: 'Light', url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png' },
];

// ── Main map component ──
interface MapViewProps {
  locations: Record<string, Location>;
  route?: string[];
  reroute?: string[];
  priorities?: Record<string, string>;
  noFlyZones?: NoFlyZone[];
  weather?: Record<string, Weather>;
  droneProgress?: number;
  isFlying?: boolean;
  mapCommand?: MapCommand | null;
  onCommandHandled?: () => void;
  tileLayerIndex?: number;
  onCenteredChange?: (centered: boolean) => void;
}

export function MapView({
  locations,
  route,
  reroute,
  priorities = {},
  noFlyZones = [],
  weather = {},
  droneProgress = 0,
  isFlying = false,
  mapCommand = null,
  onCommandHandled,
  tileLayerIndex = 0,
  onCenteredChange,
}: MapViewProps) {
  const routeCoords: Array<[number, number]> = (route || [])
    .filter((name) => locations[name])
    .map((name) => [locations[name].lat, locations[name].lon]);

  const rerouteCoords: Array<[number, number]> = (reroute || [])
    .filter((name) => locations[name])
    .map((name) => [locations[name].lat, locations[name].lon]);

  const depot = locations['Depot'];
  const center: [number, number] = depot ? [depot.lat, depot.lon] : [51.5074, -0.1278];
  const tileUrl = TILE_LAYERS[tileLayerIndex % TILE_LAYERS.length].url;

  return (
    <MapContainer
      center={center}
      zoom={14}
      style={{ width: '100%', height: '100%' }}
      zoomControl={false}
      attributionControl={false}
    >
      <TileLayer url={tileUrl} />

      {/* Map controller for external commands */}
      {onCommandHandled && (
        <MapController command={mapCommand} onCommandHandled={onCommandHandled} depotLat={depot?.lat} depotLon={depot?.lon} onCenteredChange={onCenteredChange} />
      )}

      {/* No-fly zones — filled red at 30% opacity */}
      {noFlyZones.map((zone) => {
        const positions: Array<[number, number]> = zone.lat_lon.map((ll) => [ll[0], ll[1]]);
        return (
          <Polyline
            key={zone.name}
            positions={[...positions, positions[0]]}
            pathOptions={{
              color: '#ff4444',
              weight: 1,
              opacity: 0.3,
              fillColor: '#ff4444',
              fillOpacity: 0.3,
              fill: true,
            }}
          />
        );
      })}

      {/* Original route */}
      {routeCoords.length >= 2 && (
        <Polyline
          positions={routeCoords}
          pathOptions={{
            color: reroute ? '#ffb3ac' : '#00daf3',
            weight: reroute ? 2 : 3,
            opacity: reroute ? 0.3 : 0.8,
            dashArray: reroute ? '10 5' : undefined,
          }}
        />
      )}

      {/* Rerouted path */}
      {rerouteCoords.length >= 2 && (
        <Polyline
          positions={rerouteCoords}
          pathOptions={{
            color: '#00daf3',
            weight: 3,
            opacity: 0.9,
          }}
        />
      )}

      {/* Location markers */}
      {Object.entries(locations).map(([name, loc]) => {
        const isDepot = name === 'Depot';
        const isHighPriority = priorities[name] === 'high';
        const locWeather = weather[name];
        const isBadWeather = locWeather && !locWeather.flyable;

        let color = isDepot ? '#b3c5ff' : '#00daf3';
        if (isHighPriority) color = '#ffb3ac';
        if (isBadWeather) color = '#ff4444';

        return (
          <Marker key={name} position={[loc.lat, loc.lon]} icon={clinicIcon(color)}>
            <Popup>
              <div style={{ color: '#dfe3e9', background: '#1b2024', padding: '8px 12px', borderRadius: '8px', fontSize: '12px', minWidth: '140px' }}>
                <div style={{ fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: '13px', marginBottom: '4px' }}>{name}</div>
                <div style={{ opacity: 0.7, fontSize: '11px' }}>{loc.description}</div>
                {locWeather && (
                  <div style={{ marginTop: '6px', fontSize: '10px', opacity: 0.6 }}>
                    Wind: {locWeather.wind_speed} m/s | {locWeather.description}
                  </div>
                )}
              </div>
            </Popup>
          </Marker>
        );
      })}

      {/* Pulsing rings around active delivery locations */}
      {(route || []).filter((n) => n !== 'Depot' && locations[n]).map((name) => (
        <CircleMarker
          key={`ring-${name}`}
          center={[locations[name].lat, locations[name].lon]}
          radius={15}
          pathOptions={{
            color: priorities[name] === 'high' ? '#ffb3ac' : '#0051ce',
            weight: 1,
            opacity: 0.3,
            fillColor: priorities[name] === 'high' ? '#ffb3ac' : '#0051ce',
            fillOpacity: 0.08,
          }}
        />
      ))}

      {/* Animated drone */}
      <AnimatedDrone
        route={routeCoords}
        progress={droneProgress}
        isFlying={isFlying}
      />

      {/* User's live location */}
      <UserLocation />
    </MapContainer>
  );
}
