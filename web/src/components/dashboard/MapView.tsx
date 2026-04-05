import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import type { Location, Weather, NoFlyZone } from '../../lib/api';

function toLatLng(coord: [number, number]): google.maps.LatLngLiteral {
  return { lat: coord[0], lng: coord[1] };
}

function hashStringToAngle(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % 360;
}

function createDot(color: string, size: number): HTMLDivElement {
  const el = document.createElement('div');
  el.style.cssText = `width:${size}px;height:${size}px;background:${color};border-radius:50%;border:2px solid rgba(255,255,255,0.3);box-shadow:0 0 10px ${color};`;
  return el;
}

// ── Map command types ──
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
const CENTER_OFFSET_X = (RIGHT_HUD_WIDTH - LEFT_NAV_WIDTH) / 2;

const MAP_ID = import.meta.env.VITE_GOOGLE_MAP_ID || '';

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
  onMapReady?: (map: google.maps.Map) => void;
}

export function MapView({
  locations, route, reroute, priorities = {}, noFlyZones = [], weather = {},
  droneProgress = 0, isFlying = false, mapCommand = null,
  onCommandHandled, tileLayerIndex = 0, onCenteredChange, onUserLocation,
  onMapReady,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);
  const polylinesRef = useRef<google.maps.Polyline[]>([]);
  const polygonsRef = useRef<google.maps.Polygon[]>([]);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);
  const droneMarkerRef = useRef<google.maps.marker.AdvancedMarkerElement | null>(null);
  const trailMarkerRef = useRef<google.maps.marker.AdvancedMarkerElement | null>(null);
  const prevDronePosRef = useRef<google.maps.LatLngLiteral | null>(null);
  const initialCenteredRef = useRef(false);

  const routeCoords = useMemo<Array<[number, number]>>(() =>
    (route || []).filter((n) => locations[n]).map((n) => [locations[n].lat, locations[n].lon]),
    [route, locations]
  );
  const rerouteCoords = useMemo<Array<[number, number]>>(() =>
    (reroute || []).filter((n) => locations[n]).map((n) => [locations[n].lat, locations[n].lon]),
    [reroute, locations]
  );
  const depot = locations['Depot'];
  const center: google.maps.LatLngLiteral = depot ? { lat: depot.lat, lng: depot.lon } : { lat: 51.5074, lng: -0.1278 };
  const hasReroute = Boolean(reroute && rerouteCoords.length >= 2);

  // ── Initialize map ONCE with native constructor ──
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    // Wait for Google Maps to be loaded
    const init = () => {
      if (!google?.maps?.Map) {
        setTimeout(init, 100);
        return;
      }

      const map = new google.maps.Map(containerRef.current!, {
        center,
        zoom: 14,
        mapId: MAP_ID,
        disableDefaultUI: true,
        gestureHandling: 'greedy',
        minZoom: 3,
        tilt: 45,
        heading: 0,
        restriction: {
          latLngBounds: { north: 89.9, south: -89.9, east: 180, west: -180 },
          strictBounds: false,
        },
      });

      mapRef.current = map;
      infoWindowRef.current = new google.maps.InfoWindow();
      onMapReady?.(map);

      // Log rendering type when ready
      map.addListener('renderingtype_changed', () => {
        console.log('Google Maps rendering type:', map.getRenderingType());
      });
    };

    init();

    return () => {
      // Cleanup on unmount
      markersRef.current.forEach((m) => m.remove());
      polylinesRef.current.forEach((p) => p.setMap(null));
      polygonsRef.current.forEach((p) => p.setMap(null));
      droneMarkerRef.current?.remove();
      trailMarkerRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // ── Map type switching ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const mapTypeIds = ['roadmap', 'hybrid', 'roadmap'] as const;
    map.setMapTypeId(mapTypeIds[tileLayerIndex % 3]);
  }, [tileLayerIndex]);

  // ── Initial centering with offset ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || initialCenteredRef.current || !depot) return;
    initialCenteredRef.current = true;
    setTimeout(() => {
      map.setCenter({ lat: depot.lat, lng: depot.lon });
      map.setZoom(14);
      map.panBy(CENTER_OFFSET_X, 0);
    }, 300);
  }, [depot]);

  // ── Centered detection ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !depot || !onCenteredChange) return;
    const listener = map.addListener('idle', () => {
      const c = map.getCenter();
      const proj = map.getProjection();
      if (!c || !proj) return;
      const zoom = map.getZoom() ?? 14;
      const scale = Math.pow(2, zoom);
      const cPx = proj.fromLatLngToPoint(c);
      const dPx = proj.fromLatLngToPoint(new google.maps.LatLng(depot.lat, depot.lon));
      if (!cPx || !dPx) return;
      const dx = (dPx.x - cPx.x) * scale + CENTER_OFFSET_X;
      const dy = (dPx.y - cPx.y) * scale;
      onCenteredChange(Math.abs(dx) + Math.abs(dy) < 30);
    });
    return () => google.maps.event.removeListener(listener);
  }, [depot, onCenteredChange]);

  // ── Handle commands ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapCommand) return;
    switch (mapCommand.type) {
      case 'zoom-in': map.setZoom((map.getZoom() ?? 14) + 1); break;
      case 'zoom-out': map.setZoom((map.getZoom() ?? 14) - 1); break;
      case 'center-depot':
        map.panTo({ lat: mapCommand.lat, lng: mapCommand.lon });
        map.panBy(CENTER_OFFSET_X, 0);
        break;
      case 'fly-to':
        map.panTo({ lat: mapCommand.lat, lng: mapCommand.lon });
        if (mapCommand.zoom) map.setZoom(mapCommand.zoom);
        map.panBy(CENTER_OFFSET_X, 0);
        break;
      case 'center-user':
        map.panTo({ lat: mapCommand.lat, lng: mapCommand.lon });
        map.setZoom(16);
        map.panBy(CENTER_OFFSET_X, 0);
        break;
      case 'zoom-out-overview': map.setZoom(12); break;
    }
    onCommandHandled?.();
  }, [mapCommand, onCommandHandled]);


  // ── User live location ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !google.maps.marker?.AdvancedMarkerElement) return;

    let userMarker: google.maps.marker.AdvancedMarkerElement | null = null;
    let userCircle: google.maps.Circle | null = null;

    const placeUser = (lat: number, lng: number, accuracy: number) => {
      onUserLocation?.(lat, lng);
      const pos = { lat, lng };

      if (!userMarker) {
        const el = createDot('#4285F4', 14);
        el.style.border = '3px solid white';
        userMarker = new google.maps.marker.AdvancedMarkerElement({
          position: pos, map, content: el, zIndex: 1000,
        });
        userMarker.addListener('click', () => {
          infoWindowRef.current?.setContent(
            `<div style="color:#dfe3e9;background:#1b2024;padding:8px 12px;border-radius:8px;font-size:12px">
              <div style="font-family:Space Grotesk;font-weight:700;font-size:13px;margin-bottom:4px">Your Location</div>
              <div style="opacity:0.7;font-size:11px">Accuracy: ${Math.round(accuracy)}m</div></div>`
          );
          infoWindowRef.current?.open(map, userMarker);
        });
      } else {
        userMarker.position = pos;
      }

      if (!userCircle) {
        userCircle = new google.maps.Circle({
          center: pos, radius: accuracy,
          strokeColor: '#4285F4', strokeWeight: 1, strokeOpacity: 0.3,
          fillColor: '#4285F4', fillOpacity: 0.1, map,
        });
      } else {
        userCircle.setCenter(pos);
        userCircle.setRadius(accuracy);
      }
    };

    // Try real geolocation first, fall back to hardcoded demo location
    if (navigator.geolocation) {
      const watchId = navigator.geolocation.watchPosition(
        (pos) => placeUser(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy),
        () => {
          // Geolocation failed — use demo fallback (Icon Tower, London)
          placeUser(51.5223, -0.2618, 10);
        },
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
      );

      return () => {
        navigator.geolocation.clearWatch(watchId);
        userMarker?.remove();
        userCircle?.setMap(null);
      };
    } else {
      // No geolocation API — use demo fallback
      placeUser(51.5223, -0.2618, 10);
      return () => {
        userMarker?.remove();
        userCircle?.setMap(null);
      };
    }
  }, []);

  // ── Location markers + wind arrows ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !google.maps.marker?.AdvancedMarkerElement) return;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    Object.entries(locations).forEach(([name, loc]) => {
      const isDepot = name === 'Depot';
      const isHighPriority = priorities[name] === 'high';
      const locWeather = weather[name];
      const isBadWeather = locWeather && !locWeather.flyable;
      let color = isDepot ? '#b3c5ff' : '#00daf3';
      if (isHighPriority) color = '#ffb3ac';
      if (isBadWeather) color = '#ff4444';

      const marker = new google.maps.marker.AdvancedMarkerElement({
        position: { lat: loc.lat, lng: loc.lon }, map, content: createDot(color, 12), zIndex: 20,
      });
      marker.addListener('click', () => {
        let html = `<div style="color:#dfe3e9;background:#1b2024;padding:8px 12px;border-radius:8px;font-size:12px;min-width:140px">
          <div style="font-family:Space Grotesk;font-weight:700;font-size:13px;margin-bottom:4px">${name}</div>
          <div style="opacity:0.7;font-size:11px">${loc.description || ''}</div>`;
        if (locWeather) html += `<div style="margin-top:6px;font-size:10px;opacity:0.6">Wind: ${locWeather.wind_speed} m/s | ${locWeather.description}</div>`;
        html += '</div>';
        infoWindowRef.current?.setContent(html);
        infoWindowRef.current?.open(map, marker);
      });
      markersRef.current.push(marker);

      if (locWeather) {
        const angle = hashStringToAngle(name);
        const arrowEl = document.createElement('div');
        arrowEl.style.cssText = `transform:rotate(${angle}deg);pointer-events:none;`;
        arrowEl.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16"><path d="M8 2 L12 10 L8 8 L4 10 Z" fill="${locWeather.flyable ? '#4ade80' : '#ff4444'}" opacity="0.8"/></svg>`;
        markersRef.current.push(new google.maps.marker.AdvancedMarkerElement({
          position: { lat: loc.lat, lng: loc.lon }, map, content: arrowEl, zIndex: 15,
        }));
      }
    });

    return () => { markersRef.current.forEach((m) => m.remove()); markersRef.current = []; };
  }, [locations, weather, priorities]);


  // ── No-fly zones ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    polygonsRef.current.forEach((p) => p.setMap(null));
    polygonsRef.current = [];

    const polys = noFlyZones.map((zone) => new google.maps.Polygon({
      paths: zone.lat_lon.map(([lat, lon]: [number, number]) => ({ lat, lng: lon })),
      strokeColor: '#ff4444', strokeWeight: 2, strokeOpacity: 0.3,
      fillColor: '#ff4444', fillOpacity: 0.1, map,
    }));
    polygonsRef.current = polys;

    let t = 0;
    const id = setInterval(() => {
      t += 0.05;
      const fo = 0.1 + 0.15 * (0.5 + 0.5 * Math.sin(t));
      polys.forEach((p) => p.setOptions({ fillOpacity: fo, strokeOpacity: Math.min(fo * 3, 0.6) }));
    }, 50);

    return () => { clearInterval(id); polygonsRef.current.forEach((p) => p.setMap(null)); polygonsRef.current = []; };
  }, [noFlyZones]);

  // ── Route polylines ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    polylinesRef.current.forEach((p) => p.setMap(null));
    polylinesRef.current = [];

    if (routeCoords.length < 2 && rerouteCoords.length < 2) return;
    const showSplit = isFlying && droneProgress > 0 && droneProgress < 1 && !hasReroute;

    if (showSplit && routeCoords.length >= 2) {
      const ts = routeCoords.length - 1;
      const si = Math.min(Math.floor(droneProgress * ts), ts - 1);
      const sp = (droneProgress * ts) - si;
      const f = routeCoords[si], t = routeCoords[Math.min(si + 1, routeCoords.length - 1)];
      const ip: [number, number] = [f[0] + (t[0] - f[0]) * sp, f[1] + (t[1] - f[1]) * sp];
      const cp = [...routeCoords.slice(0, si + 1), ip].map(toLatLng);
      const rp = [ip, ...routeCoords.slice(si + 1)].map(toLatLng);

      if (cp.length >= 2) {
        polylinesRef.current.push(new google.maps.Polyline({ path: cp, strokeColor: '#00daf3', strokeWeight: 10, strokeOpacity: 0.15, map }));
        polylinesRef.current.push(new google.maps.Polyline({ path: cp, strokeColor: '#00daf3', strokeWeight: 4, strokeOpacity: 1, map }));
      }
      if (rp.length >= 2) {
        polylinesRef.current.push(new google.maps.Polyline({
          path: rp, strokeColor: '#00daf3', strokeWeight: 2, strokeOpacity: 0,
          icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.3, scale: 3 }, offset: '0', repeat: '16px' }], map,
        }));
      }
    } else if (routeCoords.length >= 2) {
      const path = routeCoords.map(toLatLng);
      const color = hasReroute ? '#ffb3ac' : '#00daf3';
      polylinesRef.current.push(new google.maps.Polyline({
        path, strokeColor: color, strokeWeight: hasReroute ? 2 : 3, strokeOpacity: 0,
        icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: hasReroute ? 0.3 : 0.8, scale: 3 }, offset: '0', repeat: '16px' }], map,
      }));
    }
    if (rerouteCoords.length >= 2) {
      polylinesRef.current.push(new google.maps.Polyline({
        path: rerouteCoords.map(toLatLng), strokeColor: '#00daf3', strokeWeight: 3, strokeOpacity: 0,
        icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.9, scale: 3 }, offset: '0', repeat: '16px' }], map,
      }));
    }

    return () => { polylinesRef.current.forEach((p) => p.setMap(null)); polylinesRef.current = []; };
  }, [routeCoords, rerouteCoords, droneProgress, isFlying, hasReroute]);

  // Dash animation
  useEffect(() => {
    if (polylinesRef.current.length === 0) return;
    let offset = 0;
    const id = setInterval(() => {
      offset = (offset + 1) % 200;
      polylinesRef.current.forEach((line) => {
        const icons = line.get('icons');
        if (icons?.[0]) { icons[0].offset = `${offset}px`; line.set('icons', icons); }
      });
    }, 50);
    return () => clearInterval(id);
  }, [routeCoords, rerouteCoords, droneProgress, isFlying, hasReroute]);

  // ── Animated drone ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !google.maps.marker?.AdvancedMarkerElement) return;
    if (!isFlying || routeCoords.length < 2) {
      droneMarkerRef.current?.remove(); trailMarkerRef.current?.remove();
      droneMarkerRef.current = null; trailMarkerRef.current = null; prevDronePosRef.current = null;
      return;
    }

    const ts = routeCoords.length - 1;
    const si = Math.min(Math.floor(droneProgress * ts), ts - 1);
    const sp = (droneProgress * ts) - si;
    const f = routeCoords[si], t = routeCoords[Math.min(si + 1, routeCoords.length - 1)];
    const pos = { lat: f[0] + (t[0] - f[0]) * sp, lng: f[1] + (t[1] - f[1]) * sp };
    const trail = prevDronePosRef.current
      ? { lat: prevDronePosRef.current.lat + (pos.lat - prevDronePosRef.current.lat) * 0.9, lng: prevDronePosRef.current.lng + (pos.lng - prevDronePosRef.current.lng) * 0.9 }
      : pos;
    prevDronePosRef.current = pos;

    if (!droneMarkerRef.current) {
      const el = document.createElement('div');
      el.style.cssText = 'width:20px;height:20px;background:#b3c5ff;transform:rotate(45deg);border-radius:2px;box-shadow:0 0 20px rgba(179,197,255,0.6),0 0 40px rgba(179,197,255,0.3);';
      droneMarkerRef.current = new google.maps.marker.AdvancedMarkerElement({ position: pos, map, content: el, zIndex: 100 });
    } else { droneMarkerRef.current.position = pos; }

    if (!trailMarkerRef.current) {
      const el = document.createElement('div');
      el.style.cssText = 'width:24px;height:24px;background:rgba(179,197,255,0.3);transform:rotate(45deg);border-radius:2px;filter:blur(2px);';
      trailMarkerRef.current = new google.maps.marker.AdvancedMarkerElement({ position: trail, map, content: el, zIndex: 99 });
    } else { trailMarkerRef.current.position = trail; }

    return () => {
      droneMarkerRef.current?.remove(); trailMarkerRef.current?.remove();
      droneMarkerRef.current = null; trailMarkerRef.current = null; prevDronePosRef.current = null;
    };
  }, [routeCoords, droneProgress, isFlying]);


  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
}
