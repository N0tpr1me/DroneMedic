import { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Polyline, Polygon, CircleMarker, Popup, Marker, useMap } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Location, Weather, NoFlyZone } from '../../lib/api';
import hospitalsData from '../../data/hospitals.json';

interface HospitalData {
  name: string;
  type: string;
  address: string;
  lat: number;
  lon: number;
  region: string;
  beds: number;
}

const hospitals: HospitalData[] = hospitalsData as HospitalData[];

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

const hospitalIcon = L.divIcon({
  className: '',
  html: `<div style="
    width: 10px; height: 10px;
    background: #34d399;
    border-radius: 50%;
    border: 1.5px solid rgba(255,255,255,0.4);
    box-shadow: 0 0 6px rgba(52, 211, 153, 0.5);
  "></div>`,
  iconSize: [10, 10],
  iconAnchor: [5, 5],
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

// ── Hash-based wind direction (deterministic per location name) ──
function hashStringToAngle(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % 360;
}

const windArrowIcon = (angle: number, flyable: boolean) => L.divIcon({
  className: '',
  html: `<div style="transform: rotate(${angle}deg); pointer-events: none;">
    <svg width="16" height="16" viewBox="0 0 16 16">
      <path d="M8 2 L12 10 L8 8 L4 10 Z" fill="${flyable ? '#4ade80' : '#ff4444'}" opacity="0.8"/>
    </svg>
  </div>`,
  iconSize: [16, 16],
  iconAnchor: [-9, 8],
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
  const trailRef = useRef<L.Marker | null>(null);
  const prevPosRef = useRef<[number, number] | null>(null);

  useEffect(() => {
    if (!isFlying || route.length < 2) {
      if (markerRef.current) {
        markerRef.current.remove();
        markerRef.current = null;
      }
      if (trailRef.current) {
        trailRef.current.remove();
        trailRef.current = null;
      }
      prevPosRef.current = null;
      return;
    }

    const totalSegments = route.length - 1;
    const segIndex = Math.min(Math.floor(progress * totalSegments), totalSegments - 1);
    const segProgress = (progress * totalSegments) - segIndex;

    const from = route[segIndex];
    const to = route[Math.min(segIndex + 1, route.length - 1)];
    const lat = from[0] + (to[0] - from[0]) * segProgress;
    const lng = from[1] + (to[1] - from[1]) * segProgress;

    const currentPos: [number, number] = [lat, lng];

    // Trailing glow marker: lerp 90% toward current position from previous
    const trailPos: [number, number] = prevPosRef.current
      ? [
          prevPosRef.current[0] + (currentPos[0] - prevPosRef.current[0]) * 0.9,
          prevPosRef.current[1] + (currentPos[1] - prevPosRef.current[1]) * 0.9,
        ]
      : currentPos;

    if (!markerRef.current) {
      markerRef.current = L.marker(currentPos, { icon: droneIcon }).addTo(map);
    } else {
      markerRef.current.setLatLng(currentPos);
    }

    const trailIcon = L.divIcon({
      className: '',
      html: `<div style="
        width: 24px; height: 24px;
        background: rgba(179, 197, 255, 0.3);
        transform: rotate(45deg);
        border-radius: 2px;
        box-shadow: 0 0 30px rgba(179, 197, 255, 0.4), 0 0 60px rgba(179, 197, 255, 0.2);
        filter: blur(2px);
      "></div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    });

    if (!trailRef.current) {
      trailRef.current = L.marker(trailPos, { icon: trailIcon, zIndexOffset: -1 }).addTo(map);
    } else {
      trailRef.current.setIcon(trailIcon);
      trailRef.current.setLatLng(trailPos);
    }

    prevPosRef.current = currentPos;

    return () => {
      if (markerRef.current) {
        markerRef.current.remove();
        markerRef.current = null;
      }
      if (trailRef.current) {
        trailRef.current.remove();
        trailRef.current = null;
      }
      prevPosRef.current = null;
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
  | { type: 'toggle-layer' }
  | { type: 'fly-to'; lat: number; lon: number; zoom?: number }
  | { type: 'zoom-out-overview' }
  | { type: 'center-user'; lat: number; lon: number };

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
      case 'fly-to':
        centerWithOffset(map, command.lat, command.lon, command.zoom ?? map.getZoom());
        break;
      case 'center-user':
        centerWithOffset(map, command.lat, command.lon, 16);
        break;
      case 'zoom-out-overview':
        map.flyTo(map.getCenter(), 12, { animate: true, duration: 1.5 });
        break;
    }

    onCommandHandled();
  }, [command, map, onCommandHandled]);

  return null;
}

// ── User live location ──
// Hardcoded override for demo — Icon Tower, 8 Portal Way, W3 6DU
const USER_LOCATION_OVERRIDE: { lat: number; lon: number } | null = { lat: 51.5223, lon: -0.2618 };

function UserLocation({ onUserLocation }: { onUserLocation?: (lat: number, lon: number) => void }) {
  const map = useMap();
  const markerRef = useRef<L.Marker | null>(null);
  const circleRef = useRef<L.Circle | null>(null);

  useEffect(() => {
    const placeUser = (latitude: number, longitude: number, accuracy: number) => {
      onUserLocation?.(latitude, longitude);
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
    };

    // Use hardcoded override if set, otherwise fall back to browser geolocation
    if (USER_LOCATION_OVERRIDE) {
      placeUser(USER_LOCATION_OVERRIDE.lat, USER_LOCATION_OVERRIDE.lon, 10);
      return;
    }

    if (!navigator.geolocation) return;

    const watchId = navigator.geolocation.watchPosition(
      (pos) => placeUser(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy),
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
  onUserLocation?: (lat: number, lon: number) => void;
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
  onUserLocation,
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
      maxBounds={[[-85, -180], [85, 180]]}
      maxBoundsViscosity={1.0}
      minZoom={3}
    >
      <TileLayer url={tileUrl} />

      {/* Map controller for external commands */}
      {onCommandHandled && (
        <MapController command={mapCommand} onCommandHandled={onCommandHandled} depotLat={depot?.lat} depotLon={depot?.lon} onCenteredChange={onCenteredChange} />
      )}

      {/* No-fly zones — glowing danger polygons */}
      {noFlyZones.map((zone) => {
        const positions: Array<[number, number]> = zone.lat_lon.map((ll) => [ll[0], ll[1]]);
        return (
          <Polygon
            key={zone.name}
            className="danger-zone"
            positions={positions}
            pathOptions={{
              color: '#ff4444',
              weight: 2,
              opacity: 0.3,
              fillColor: '#ff4444',
              fillOpacity: 0.1,
            }}
          />
        );
      })}

      {/* Original route */}
      {routeCoords.length >= 2 && (() => {
        const hasReroute = Boolean(reroute && rerouteCoords.length >= 2);
        const showSplit = isFlying && droneProgress > 0 && droneProgress < 1 && !hasReroute;

        if (showSplit) {
          // Split route into completed and remaining portions
          const totalSegments = routeCoords.length - 1;
          const segIndex = Math.min(
            Math.floor(droneProgress * totalSegments),
            totalSegments - 1
          );
          const segProgress = (droneProgress * totalSegments) - segIndex;

          const from = routeCoords[segIndex];
          const to = routeCoords[Math.min(segIndex + 1, routeCoords.length - 1)];
          const interpPoint: [number, number] = [
            from[0] + (to[0] - from[0]) * segProgress,
            from[1] + (to[1] - from[1]) * segProgress,
          ];

          const completedCoords = [...routeCoords.slice(0, segIndex + 1), interpPoint];
          const remainingCoords = [interpPoint, ...routeCoords.slice(segIndex + 1)];

          return (
            <>
              {/* Completed portion — solid bright cyan with glow */}
              {completedCoords.length >= 2 && (
                <Polyline
                  className="route-completed"
                  positions={completedCoords}
                  pathOptions={{
                    color: '#00daf3',
                    weight: 4,
                    opacity: 1,
                  }}
                />
              )}
              {/* Remaining portion — dimmer, dashed, animated */}
              {remainingCoords.length >= 2 && (
                <Polyline
                  className="route-remaining"
                  positions={remainingCoords}
                  pathOptions={{
                    color: '#00daf3',
                    weight: 2,
                    opacity: 0.3,
                    dashArray: '12 8',
                  }}
                />
              )}
            </>
          );
        }

        // Static / preview route (not flying, or progress at 0/1)
        return (
          <Polyline
            className={hasReroute ? undefined : 'animated-route'}
            positions={routeCoords}
            pathOptions={{
              color: hasReroute ? '#ffb3ac' : '#00daf3',
              weight: hasReroute ? 2 : 3,
              opacity: hasReroute ? 0.3 : 0.8,
              dashArray: hasReroute ? '10 5' : '12 8',
            }}
          />
        );
      })()}

      {/* Rerouted path */}
      {rerouteCoords.length >= 2 && (
        <Polyline
          className="animated-route"
          positions={rerouteCoords}
          pathOptions={{
            color: '#00daf3',
            weight: 3,
            opacity: 0.9,
            dashArray: '12 8',
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

      {/* Wind direction arrows for locations with weather data */}
      {Object.entries(locations).map(([name, loc]) => {
        const locWeather = weather[name];
        if (!locWeather) return null;
        const angle = hashStringToAngle(name);
        return (
          <Marker
            key={`wind-${name}`}
            position={[loc.lat, loc.lon]}
            icon={windArrowIcon(angle, locWeather.flyable)}
            interactive={false}
          />
        );
      })}

      {/* Pulsing rings around active delivery locations (color-coded by weather) */}
      {(route || []).filter((n) => n !== 'Depot' && locations[n]).map((name) => {
        const locWeather = weather[name];
        const isBadWeather = locWeather && !locWeather.flyable;
        const isHighPriority = priorities[name] === 'high';

        let ringColor = isHighPriority ? '#ffb3ac' : '#0051ce';
        let ringFillOpacity = 0.08;
        if (isBadWeather) {
          ringColor = '#ff4444';
          ringFillOpacity = 0.15;
        }

        return (
          <CircleMarker
            key={`ring-${name}`}
            className="pulse-ring"
            center={[locations[name].lat, locations[name].lon]}
            radius={15}
            pathOptions={{
              color: ringColor,
              weight: 1,
              opacity: 0.3,
              fillColor: ringColor,
              fillOpacity: ringFillOpacity,
            }}
          />
        );
      })}

      {/* Animated drone */}
      <AnimatedDrone
        route={routeCoords}
        progress={droneProgress}
        isFlying={isFlying}
      />

      {/* User's live location */}
      <UserLocation onUserLocation={onUserLocation} />

      {/* Global hospital markers (clustered) */}
      <MarkerClusterGroup
        chunkedLoading
        maxClusterRadius={50}
        spiderfyOnMaxZoom
        showCoverageOnHover={false}
        iconCreateFunction={(cluster: L.MarkerCluster) => {
          const count = cluster.getChildCount();
          return L.divIcon({
            className: '',
            html: `<div style="
              display: flex; align-items: center; justify-content: center;
              width: ${count > 50 ? 36 : 28}px; height: ${count > 50 ? 36 : 28}px;
              background: rgba(52, 211, 153, 0.25);
              border: 1.5px solid rgba(52, 211, 153, 0.6);
              border-radius: 50%;
              color: #34d399;
              font-size: 11px;
              font-weight: 700;
              font-family: 'Space Grotesk', sans-serif;
              backdrop-filter: blur(4px);
            ">${count}</div>`,
            iconSize: [count > 50 ? 36 : 28, count > 50 ? 36 : 28],
            iconAnchor: [count > 50 ? 18 : 14, count > 50 ? 18 : 14],
          });
        }}
      >
        {hospitals.map((h) => (
          <Marker key={`hospital-${h.name}`} position={[h.lat, h.lon]} icon={hospitalIcon}>
            <Popup>
              <div style={{ color: '#dfe3e9', background: '#1b2024', padding: '8px 12px', borderRadius: '8px', fontSize: '12px', minWidth: '160px' }}>
                <div style={{ fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: '13px', marginBottom: '4px', color: '#34d399' }}>{h.name}</div>
                <div style={{ opacity: 0.7, fontSize: '11px', marginBottom: '2px' }}>{h.address}</div>
                <div style={{ opacity: 0.6, fontSize: '10px' }}>
                  {h.region} {h.beds > 0 ? `· ${h.beds} beds` : ''}
                </div>
              </div>
            </Popup>
          </Marker>
        ))}
      </MarkerClusterGroup>
    </MapContainer>
  );
}
