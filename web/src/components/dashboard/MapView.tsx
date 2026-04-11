import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import type { Location, Weather, NoFlyZone } from '../../lib/api';
import type { EONETEvent } from '../../hooks/useEONET';

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

function createLabelMarker(color: string, name: string, isDepot: boolean): HTMLDivElement {
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:2px;';

  // Label chip
  const lbl = document.createElement('div');
  lbl.style.cssText = `font-family:Space Grotesk,system-ui,sans-serif;font-size:10px;font-weight:600;color:#fff;white-space:nowrap;letter-spacing:0.02em;padding:3px 8px;background:rgba(15,20,24,0.85);border-radius:6px;border:1px solid ${color}66;backdrop-filter:blur(4px);`;
  lbl.textContent = name;
  wrapper.appendChild(lbl);

  // Pin icon
  const pin = document.createElement('div');
  const sz = isDepot ? 14 : 10;
  pin.style.cssText = `width:${sz}px;height:${sz}px;background:${color};border-radius:50%;border:2px solid rgba(255,255,255,0.5);box-shadow:0 0 6px ${color};`;
  wrapper.appendChild(pin);

  return wrapper;
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
  naturalEvents?: EONETEvent[];
  onLocationClick?: (name: string, description: string) => void;
}

export function MapView({
  locations, route, reroute, priorities = {}, noFlyZones = [], weather = {},
  droneProgress = 0, isFlying = false, mapCommand = null,
  onCommandHandled, tileLayerIndex = 0, onCenteredChange, onUserLocation,
  onMapReady, naturalEvents = [], onLocationClick,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const markerClickTimeRef = useRef(0);
  const markersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);
  const polylinesRef = useRef<google.maps.Polyline[]>([]);
  const polygonsRef = useRef<google.maps.Polygon[]>([]);
  const eonetMarkersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);
  const infoClickLockedRef = useRef(false);
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

  // ── Initialize map — reinitializes on remount ──
  useEffect(() => {
    if (!containerRef.current) return;

    // If map already exists for this container, skip
    if (mapRef.current) return;

    let observer: MutationObserver | null = null;
    let cancelled = false;

    // Wait for Google Maps to be loaded
    const init = () => {
      if (cancelled || !containerRef.current) return;
      if (typeof google === 'undefined' || !google?.maps?.Map) {
        setTimeout(init, 100);
        return;
      }

      const mapOptions: google.maps.MapOptions = {
        center,
        zoom: 14,
        disableDefaultUI: true,
        gestureHandling: 'greedy',
        minZoom: 3,
        maxZoom: 22,
        tilt: 45,
        heading: 0,
        backgroundColor: '#0a0f13',
      };
      // Only set mapId if explicitly configured — empty string causes errors
      if (MAP_ID) mapOptions.mapId = MAP_ID;

      const map = new google.maps.Map(containerRef.current!, mapOptions);

      mapRef.current = map;
      infoWindowRef.current = new google.maps.InfoWindow();
      setMapReady(true);
      onMapReady?.(map);

      // Auto-dismiss Google Maps billing error dialog
      observer = new MutationObserver(() => {
        const dismissBtn = document.querySelector('.dismissButton') as HTMLElement;
        if (dismissBtn) { dismissBtn.click(); return; }
        // Also catch the modal overlay Google injects
        document.querySelectorAll('.gm-err-container, .gm-style-mot').forEach(el => el.remove());
        // Remove "This page can't load Google Maps correctly" dialog
        document.querySelectorAll('div[role="dialog"]').forEach(el => {
          if (el.textContent?.includes("can't load Google Maps")) el.remove();
        });
      });
      observer.observe(document.body, { childList: true, subtree: true });

      // Log rendering type when ready
      map.addListener('renderingtype_changed', () => {
        console.log('Google Maps rendering type:', map.getRenderingType());
      });
    };

    init();

    return () => {
      // Cleanup on unmount
      cancelled = true;
      observer?.disconnect();
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      polylinesRef.current.forEach((p) => p.setMap(null));
      polylinesRef.current = [];
      polygonsRef.current.forEach((p) => p.setMap(null));
      polygonsRef.current = [];
      eonetMarkersRef.current.forEach((m) => m.remove());
      eonetMarkersRef.current = [];
      droneMarkerRef.current?.remove();
      droneMarkerRef.current = null;
      trailMarkerRef.current?.remove();
      trailMarkerRef.current = null;
      mapRef.current = null;
      setMapReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        const el = document.createElement('div');
        el.style.cssText = 'width:16px;height:16px;background:#4285F4;border-radius:50%;border:3px solid white;box-shadow:0 0 8px rgba(66,133,244,0.6);';
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady]);

  // ── Location markers ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !google.maps.marker?.AdvancedMarkerElement) return;

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
        position: { lat: loc.lat, lng: loc.lon }, map,
        content: createLabelMarker(color, name, isDepot),
        zIndex: isDepot ? 25 : 20,
      });

      markersRef.current.push(marker);

      // Click: show location info popup
      marker.addEventListener('gmp-click', () => {
        if (!infoWindowRef.current) infoWindowRef.current = new google.maps.InfoWindow();
        markerClickTimeRef.current = Date.now();

        const isHosp = name.toLowerCase().includes('hospital') || ['Royal London','Homerton','Newham General','Whipps Cross'].includes(name);
        const typeLabel = isDepot ? 'DEPOT' : isHosp ? 'HOSPITAL' : 'CLINIC';
        const typeColor = isDepot ? '#b3c5ff' : isHosp ? '#ff8a80' : '#00daf3';
        const coords = `${loc.lat.toFixed(4)}°N, ${Math.abs(loc.lon).toFixed(4)}°${loc.lon < 0 ? 'W' : 'E'}`;

        let distHTML = '';
        const dl = locations['Depot'];
        if (dl && !isDepot) {
          const R = 6371000, dLa = (loc.lat-dl.lat)*Math.PI/180, dLo = (loc.lon-dl.lon)*Math.PI/180;
          const a2 = Math.sin(dLa/2)**2+Math.cos(dl.lat*Math.PI/180)*Math.cos(loc.lat*Math.PI/180)*Math.sin(dLo/2)**2;
          const d = R*2*Math.atan2(Math.sqrt(a2),Math.sqrt(1-a2));
          distHTML = `<tr><td style="color:#999;padding:3px 10px 3px 0;font-size:10px;text-transform:uppercase">DISTANCE</td><td style="font-weight:600">${d<1000?Math.round(d)+'m':(d/1000).toFixed(1)+'km'}</td></tr><tr><td style="color:#999;padding:3px 10px 3px 0;font-size:10px;text-transform:uppercase">EST. FLIGHT</td><td style="font-weight:600;color:#0a8a5a">~${Math.ceil(d/12/60)} min</td></tr>`;
        }

        const deployBtn = !isDepot ? `<button id="dm-deploy-${name.replace(/\\s/g,'')}" style="margin-top:8px;width:100%;padding:8px;border:none;border-radius:6px;background:linear-gradient(135deg,#00daf3,#0088cc);color:#fff;font-size:11px;font-weight:700;cursor:pointer;text-transform:uppercase">DEPLOY HERE</button>` : '';

        infoWindowRef.current.setContent(`<div style="font-family:system-ui,sans-serif;width:220px"><span style="display:inline-block;padding:2px 6px;border-radius:4px;font-size:9px;font-weight:700;letter-spacing:0.08em;background:${typeColor}22;color:${typeColor};border:1px solid ${typeColor}44">${typeLabel}</span><div style="font-weight:700;font-size:14px;margin:4px 0 2px;color:#222">${name}</div>${loc.description ? `<div style="color:#666;font-size:11px;margin-bottom:6px">${loc.description}</div>` : ''}<hr style="border:none;border-top:1px solid #e0e0e0;margin:4px 0"><table style="width:100%;font-size:11px;color:#333"><tr><td style="color:#999;padding:3px 10px 3px 0;font-size:10px;text-transform:uppercase">COORDS</td><td style="font-weight:600">${coords}</td></tr>${distHTML}<tr><td style="color:#999;padding:3px 10px 3px 0;font-size:10px;text-transform:uppercase">PRIORITY</td><td style="font-weight:600;color:${isHighPriority?'#d32f2f':'#0a8a5a'}">${isHighPriority?'HIGH':'Normal'}</td></tr></table>${deployBtn}</div>`);
        infoWindowRef.current.open({ anchor: marker, map });

        if (!isDepot) {
          setTimeout(() => {
            const btn = document.getElementById(`dm-deploy-${name.replace(/\\s/g,'')}`);
            btn?.addEventListener('click', () => {
              infoWindowRef.current?.close();
              onLocationClick?.(name, loc.description || '');
            });
          }, 50);
        }
      });
    });

    const mapClickListener = map.addListener('click', () => {
      if (Date.now() - markerClickTimeRef.current > 300) infoWindowRef.current?.close();
    });

    return () => {
      google.maps.event.removeListener(mapClickListener);
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
    };
  }, [locations, weather, priorities, mapReady]);


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
        // Completed: wide glow + solid line
        polylinesRef.current.push(new google.maps.Polyline({ path: cp, strokeColor: '#00daf3', strokeWeight: 14, strokeOpacity: 0.08, map }));
        polylinesRef.current.push(new google.maps.Polyline({ path: cp, strokeColor: '#00daf3', strokeWeight: 6, strokeOpacity: 0.25, map }));
        polylinesRef.current.push(new google.maps.Polyline({ path: cp, strokeColor: '#00daf3', strokeWeight: 3, strokeOpacity: 1, map }));
      }
      if (rp.length >= 2) {
        // Remaining: animated dashes with glow
        polylinesRef.current.push(new google.maps.Polyline({ path: rp, strokeColor: '#00daf3', strokeWeight: 8, strokeOpacity: 0.06, map }));
        polylinesRef.current.push(new google.maps.Polyline({
          path: rp, strokeColor: '#00daf3', strokeWeight: 2, strokeOpacity: 0,
          icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.5, strokeColor: '#00daf3', scale: 3 }, offset: '0', repeat: '14px' }], map,
        }));
      }
    } else if (routeCoords.length >= 2) {
      const path = routeCoords.map(toLatLng);
      const color = hasReroute ? '#ffb3ac' : '#00daf3';
      // Outer glow
      polylinesRef.current.push(new google.maps.Polyline({
        path, strokeColor: color, strokeWeight: 12, strokeOpacity: 0.08, map,
      }));
      // Middle glow
      polylinesRef.current.push(new google.maps.Polyline({
        path, strokeColor: color, strokeWeight: 6, strokeOpacity: 0.15, map,
      }));
      // Animated dashes
      polylinesRef.current.push(new google.maps.Polyline({
        path, strokeColor: color, strokeWeight: hasReroute ? 2 : 3, strokeOpacity: 0,
        icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: hasReroute ? 0.4 : 0.9, scale: 3 }, offset: '0', repeat: '14px' }], map,
      }));
    }
    if (rerouteCoords.length >= 2) {
      const rp = rerouteCoords.map(toLatLng);
      // Reroute glow
      polylinesRef.current.push(new google.maps.Polyline({
        path: rp, strokeColor: '#22c55e', strokeWeight: 10, strokeOpacity: 0.1, map,
      }));
      polylinesRef.current.push(new google.maps.Polyline({
        path: rp, strokeColor: '#22c55e', strokeWeight: 3, strokeOpacity: 0,
        icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.9, scale: 3 }, offset: '0', repeat: '14px' }], map,
      }));
    }

    return () => { polylinesRef.current.forEach((p) => p.setMap(null)); polylinesRef.current = []; };
  }, [routeCoords, rerouteCoords, droneProgress, isFlying, hasReroute, mapReady]);

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

  // ── Drone marker LIFECYCLE ──────────────────────────────────────────
  // Create exactly ONE drone + trail marker when a flight starts, destroy
  // them when the flight ends. Position updates live in a separate effect
  // below so telemetry ticks (~30 Hz) never recreate DOM nodes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !google.maps.marker?.AdvancedMarkerElement) return;
    if (!isFlying || routeCoords.length < 2) return;

    // Drone marker — dark body + cyan accent quadcopter
    const el = document.createElement('div');
    el.style.cssText = 'position:relative;width:64px;height:64px;';
    const pulse = document.createElement('div');
    pulse.style.cssText = 'position:absolute;inset:-10px;border-radius:50%;border:2px solid rgba(0,218,243,0.55);animation:dronePulse 2s ease-in-out infinite;';
    const arrow = document.createElement('div');
    arrow.className = 'drone-heading';
    arrow.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;transition:transform 0.3s ease;';
    arrow.innerHTML = '<svg width="64" height="64" viewBox="0 0 64 64"><defs><filter id="droneGlow"><feGaussianBlur stdDeviation="2" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><circle cx="32" cy="32" r="12" fill="#0d1117" stroke="#00daf3" stroke-width="2"/><circle cx="32" cy="32" r="4" fill="#00daf3" opacity="0.9"/><line x1="22" y1="22" x2="12" y2="12" stroke="#1a2030" stroke-width="3" stroke-linecap="round"/><line x1="42" y1="22" x2="52" y2="12" stroke="#1a2030" stroke-width="3" stroke-linecap="round"/><line x1="22" y1="42" x2="12" y2="52" stroke="#1a2030" stroke-width="3" stroke-linecap="round"/><line x1="42" y1="42" x2="52" y2="52" stroke="#1a2030" stroke-width="3" stroke-linecap="round"/><circle cx="12" cy="12" r="8" fill="none" stroke="#00daf3" stroke-width="1.5" opacity="0.6"/><circle cx="52" cy="12" r="8" fill="none" stroke="#00daf3" stroke-width="1.5" opacity="0.6"/><circle cx="12" cy="52" r="8" fill="none" stroke="#00daf3" stroke-width="1.5" opacity="0.6"/><circle cx="52" cy="52" r="8" fill="none" stroke="#00daf3" stroke-width="1.5" opacity="0.6"/><circle cx="12" cy="12" r="3" fill="#0d1117" stroke="#00daf3" stroke-width="1"/><circle cx="52" cy="12" r="3" fill="#0d1117" stroke="#00daf3" stroke-width="1"/><circle cx="12" cy="52" r="3" fill="#0d1117" stroke="#00daf3" stroke-width="1"/><circle cx="52" cy="52" r="3" fill="#0d1117" stroke="#00daf3" stroke-width="1"/><polygon points="32,4 35,12 29,12" fill="#00daf3" filter="url(#droneGlow)"/></svg>';
    el.appendChild(pulse);
    el.appendChild(arrow);
    if (!document.getElementById('drone-pulse-style')) {
      const style = document.createElement('style');
      style.id = 'drone-pulse-style';
      style.textContent = '@keyframes dronePulse{0%,100%{transform:scale(1);opacity:0.4}50%{transform:scale(1.5);opacity:0}}';
      document.head.appendChild(style);
    }

    const startPos: google.maps.LatLngLiteral = {
      lat: routeCoords[0][0],
      lng: routeCoords[0][1],
    };

    const droneMarker = new google.maps.marker.AdvancedMarkerElement({
      position: startPos,
      map,
      content: el,
      zIndex: 100,
    });

    // Soft trail glow marker
    const trailEl = document.createElement('div');
    trailEl.style.cssText = 'width:40px;height:40px;border-radius:50%;background:radial-gradient(circle,rgba(0,218,243,0.4),transparent 70%);filter:blur(3px);';
    const trailMarker = new google.maps.marker.AdvancedMarkerElement({
      position: startPos,
      map,
      content: trailEl,
      zIndex: 99,
    });

    droneMarkerRef.current = droneMarker;
    trailMarkerRef.current = trailMarker;
    prevDronePosRef.current = null;

    return () => {
      // Hard teardown: unset map AND clear the ref so the update effect
      // below can't write to a stale marker. Unsetting `.map` on an
      // AdvancedMarkerElement is the documented way to remove it.
      droneMarker.map = null;
      trailMarker.map = null;
      if (droneMarkerRef.current === droneMarker) droneMarkerRef.current = null;
      if (trailMarkerRef.current === trailMarker) trailMarkerRef.current = null;
      prevDronePosRef.current = null;
    };
    // Intentionally NOT depending on droneProgress — recreating the marker
    // on every telemetry tick was leaving ghost drones along the path.
    // mapReady ensures the map is initialized before creating markers.
  }, [isFlying, routeCoords, mapReady]);

  // ── Drone marker POSITION UPDATE ────────────────────────────────────
  // Cheap: just mutates the position of the single marker created above.
  // No DOM creation, no teardown, no effect cleanup.
  useEffect(() => {
    const droneMarker = droneMarkerRef.current;
    const trailMarker = trailMarkerRef.current;
    if (!droneMarker || !trailMarker) return;
    if (!isFlying || routeCoords.length < 2) return;

    const ts = routeCoords.length - 1;
    const si = Math.min(Math.floor(droneProgress * ts), ts - 1);
    const sp = droneProgress * ts - si;
    const f = routeCoords[si];
    const t = routeCoords[Math.min(si + 1, routeCoords.length - 1)];
    const pos: google.maps.LatLngLiteral = {
      lat: f[0] + (t[0] - f[0]) * sp,
      lng: f[1] + (t[1] - f[1]) * sp,
    };
    const prevPos = prevDronePosRef.current;
    const trail: google.maps.LatLngLiteral = prevPos
      ? {
          lat: prevPos.lat + (pos.lat - prevPos.lat) * 0.9,
          lng: prevPos.lng + (pos.lng - prevPos.lng) * 0.9,
        }
      : pos;

    droneMarker.position = pos;
    trailMarker.position = trail;

    const headingEl = (droneMarker.content as HTMLElement | null)?.querySelector(
      '.drone-heading',
    ) as HTMLElement | null;
    if (headingEl && prevPos) {
      const angle =
        Math.atan2(pos.lng - prevPos.lng, pos.lat - prevPos.lat) * (180 / Math.PI);
      headingEl.style.transform = `rotate(${angle}deg)`;
    }

    prevDronePosRef.current = pos;
  }, [droneProgress, isFlying, routeCoords]);

  // ── EONET natural disaster markers ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !google?.maps?.marker?.AdvancedMarkerElement) return;

    // Clear old markers
    eonetMarkersRef.current.forEach(m => m.remove());
    eonetMarkersRef.current = [];

    if (!naturalEvents || naturalEvents.length === 0) return;

    const categoryStyles: Record<string, { emoji: string; color: string }> = {
      wildfires: { emoji: '🔥', color: '#ff4444' },
      severeStorms: { emoji: '🌪️', color: '#9333ea' },
      volcanoes: { emoji: '🌋', color: '#f97316' },
      floods: { emoji: '🌊', color: '#3b82f6' },
      earthquakes: { emoji: '📳', color: '#eab308' },
      seaLakeIce: { emoji: '🧊', color: '#06b6d4' },
      drought: { emoji: '☀️', color: '#f59e0b' },
      landslides: { emoji: '⛰️', color: '#78716c' },
    };

    for (const event of naturalEvents) {
      const geo = event.geometry?.[0];
      if (!geo?.coordinates) continue;

      const [lon, lat] = geo.coordinates;
      if (!lat || !lon) continue;

      const catId = event.categories?.[0]?.id || '';
      const style = categoryStyles[catId] || { emoji: '⚠️', color: '#f5a623' };

      // Create marker element
      const el = document.createElement('div');
      el.style.cssText = `
        display:flex;align-items:center;justify-content:center;
        width:32px;height:32px;font-size:18px;
        background:rgba(0,0,0,0.6);border:2px solid ${style.color};
        border-radius:50%;cursor:pointer;
        box-shadow:0 0 12px ${style.color}80;
        transition:transform 0.2s;
      `;
      el.textContent = style.emoji;
      el.title = event.title;
      el.onmouseenter = () => { el.style.transform = 'scale(1.3)'; };
      el.onmouseleave = () => { el.style.transform = 'scale(1)'; };

      const marker = new google.maps.marker.AdvancedMarkerElement({
        map,
        position: { lat, lng: lon },
        content: el,
        title: event.title,
      });

      // Info window on click
      marker.addListener('click', () => {
        if (!infoWindowRef.current) {
          infoWindowRef.current = new google.maps.InfoWindow();
        }
        const catName = event.categories?.map(c => c.title).join(', ') || 'Unknown';
        const date = geo.date ? new Date(geo.date).toLocaleDateString() : '';
        infoWindowRef.current.setContent(`
          <div style="font-family:Inter,sans-serif;max-width:220px;padding:4px">
            <div style="font-weight:700;font-size:13px;margin-bottom:4px">${style.emoji} ${event.title}</div>
            <div style="font-size:11px;color:#666">${catName}</div>
            ${date ? `<div style="font-size:10px;color:#999;margin-top:2px">${date}</div>` : ''}
            <div style="font-size:10px;color:#999;margin-top:2px">${lat.toFixed(2)}°, ${lon.toFixed(2)}°</div>
          </div>
        `);
        infoWindowRef.current.open({ map, anchor: marker });
      });

      eonetMarkersRef.current.push(marker);
    }
  }, [naturalEvents, mapReady]);


  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
}
