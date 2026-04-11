import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Minus, LocateFixed, Layers, Siren, Thermometer, Brain, Box, X, Maximize2, Minimize2 } from 'lucide-react';
import { ChatPanel } from '../components/dashboard/ChatPanel';
import { MapView } from '../components/dashboard/MapView';
import type { MapCommand } from '../components/dashboard/MapView';
import { DroneMapOverlay } from '../components/dashboard/DroneMapOverlay';
import { FlightLog } from '../components/dashboard/FlightLog';
import { CustodyTimeline } from '../components/dashboard/CustodyTimeline';
import { WeatherPanel } from '../components/dashboard/WeatherPanel';
import { MetricsPanel } from '../components/dashboard/MetricsPanel';
import { NaturalEventsPanel } from '../components/dashboard/NaturalEventsPanel';
import { BootSequence } from '../components/dashboard/BootSequence';
import { CVDetectionPanel } from '../components/dashboard/CVDetectionPanel';


import { HudStatus } from '../components/ui/hud-status';
import { LiquidButton } from '@/components/ui/liquid-glass-button';
import { SideNav } from '../components/layout/SideNav';
import { DroneScene } from '../components/three/DroneScene';
import { SimCockpit } from '../components/three/sim/SimCockpit';
import { useSoundEffects } from '../hooks/useSoundEffects';
import { useLiveMission } from '../hooks/useLiveMission';
import { usePX4Telemetry } from '../hooks/usePX4Telemetry';
import { useEONET } from '../hooks/useEONET';
import { useMissionContext } from '../context/MissionContext';
import { api } from '../lib/api';
import type { Task, Route, Location, Weather, NoFlyZone, Metrics, FlightLogEntry } from '../lib/api';

type MissionStatus = 'idle' | 'planning' | 'flying' | 'rerouting' | 'completed';

export function Dashboard() {
  const navigate = useNavigate();
  const {
    fleetPhysics, liveFlightLog, dispatchDelivery, dispatchFleetDelivery, droneAlerts, fleetSummary,
    activeTask, activeRoute, setActiveTask, setActiveRoute, activeDroneId,
    missionStatus: ctxMissionStatus,
    // Live mission telemetry lifted from Dashboard into context so it survives
    // page navigation. These replace the local useState declarations.
    droneProgress, missionProgress, liveBattery, simPayload,
  } = useMissionContext();
  const [locations, setLocations] = useState<Record<string, Location>>({});
  const [task, setTask] = useState<Task | null>(null);
  const [route, setRoute] = useState<Route | null>(null);
  const [reroute, setReroute] = useState<Route | null>(null);
  const [weather, setWeather] = useState<Record<string, Weather>>({});
  const [noFlyZones, setNoFlyZones] = useState<NoFlyZone[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [flightLog, setFlightLog] = useState<FlightLogEntry[]>([]);
  const [status, setStatus] = useState<MissionStatus>('idle');
  const [_currentLocation, setCurrentLocation] = useState('Depot');
  const [smoothSpeed, setSmoothSpeed] = useState(0);
  const smoothSpeedRef = useRef(0);
  const [eta, setEta] = useState<string>('—');
  const [mapCommand, setMapCommand] = useState<MapCommand | null>(null);
  const [tileLayerIndex, setTileLayerIndex] = useState(1);
  const [isCentered, setIsCentered] = useState(true);
  const [userLocation, setUserLocation] = useState<{lat:number;lon:number}|null>(null);
  const { playDeploy, playWaypoint, playComplete } = useSoundEffects();
  const live = useLiveMission(route?.ordered_route);
  const { telemetry: px4Telemetry, connected: px4Connected, sendCommand: px4Command, source: telemetrySource } = usePX4Telemetry();
  const { events: naturalEvents, loading: eonetLoading, error: eonetError, refetch: refetchEonet } = useEONET({ limit: 30, days: 60 });
  // Alias for JSX references that still use `battery` — comes from context now
  const battery = liveBattery;
  const [showChat, setShowChat] = useState(false);
  const [show3dSim, setShow3dSim] = useState(false);
  const [sim3dExpanded, setSim3dExpanded] = useState(false);
  // Drag state for the mini sim panel — stores the user's chosen position.
  // Default null means "use the CSS default (bottom-left)". Once dragged,
  // the panel sticks at the chosen position until reset by expanding.
  const [simDragPos, setSimDragPos] = useState<{ x: number; y: number } | null>(null);
  const simDragStartRef = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);
  const [bootComplete, setBootComplete] = useState(ctxMissionStatus !== 'idle');
  const [locationsLoaded, setLocationsLoaded] = useState(false);
  const routerLocation = useLocation();
  const [mapInstance, setMapInstance] = useState<google.maps.Map | null>(null);
  const [selectedDrone, setSelectedDrone] = useState<'Drone1' | 'Drone2' | 'Drone3' | 'Fleet'>('Drone1');
  const [drone2Battery, setDrone2Battery] = useState(95);
  const [drone2Status, setDrone2Status] = useState<'idle' | 'flying' | 'charging'>('idle');
  const [drone2Location] = useState<{lat: number; lon: number}>({ lat: 51.5176, lon: -0.0580 }); // Royal London depot
  const [weatherLoaded, setWeatherLoaded] = useState(false);
  const [noFlyLoaded, setNoFlyLoaded] = useState(false);
  const [rerouteAlert, setRerouteAlert] = useState<{ location: string; supply: string } | null>(null);

  // Inject safety decisions into flightLog as system messages
  useEffect(() => {
    if (live.safetyDecisions.length === 0) return;
    const latest = live.safetyDecisions[live.safetyDecisions.length - 1];

    // GREEN + CONTINUE is silent — no message
    if (latest.battery_state === 'GREEN' && latest.action === 'CONTINUE') return;

    let message = '';
    let eventType = `safety:${latest.battery_state}`;

    switch (latest.action) {
      case 'CONSERVE':
        message = `\u26A0\uFE0F Battery conservation mode activated. Speed reduced to 40km/h. ${latest.reasons.join(' ')}`;
        break;
      case 'RETURN_TO_BASE':
        message = `\uD83D\uDD34 CRITICAL: Battery low. Returning to base. ${latest.reasons.join(' ')}`;
        eventType = 'safety:RED';
        break;
      case 'DIVERT':
        message = `\uD83D\uDD34 EMERGENCY: Diverting to ${latest.divert_location || 'nearest hospital'}. ${latest.reasons.join(' ')}`;
        eventType = 'safety:RED';
        break;
      case 'REROUTE':
        message = `\uD83D\uDD04 Route updated. ${latest.reasons.join(' ')}`;
        break;
      case 'ABORT':
        message = `\uD83D\uDD34 ABORT: Emergency landing initiated. ${latest.reasons.join(' ')}`;
        eventType = 'safety:RED';
        break;
      default:
        message = `Safety: ${latest.action}. ${latest.reasons.join(' ')}`;
        break;
    }

    if (message) {
      const entry: FlightLogEntry = {
        event: `${eventType}|${message}`,
        location: latest.divert_location || _currentLocation,
        position: { x: 0, y: 0, z: 0 },
        battery: latest.remaining_battery_pct,
        timestamp: latest.timestamp || Date.now() / 1000,
      };
      setFlightLog(prev => [...prev, entry]);
    }
  }, [live.safetyDecisions]);

  // Sync live WebSocket state into dashboard state
  // droneProgress / missionProgress / battery / simPayload now live in MissionContext
  // (they survive page navigation). We only sync flight log + status + audio cues here.
  useEffect(() => {
    if (live.missionStatus === 'flying' || live.missionStatus === 'completed' || live.missionStatus === 'paused') {
      setStatus(live.missionStatus === 'flying' ? 'flying' : live.missionStatus as MissionStatus);
      if (live.flightLog.length > 0) {
        setFlightLog(live.flightLog);
        const lastEntry = live.flightLog[live.flightLog.length - 1];
        setCurrentLocation(lastEntry.location);
      }
      if (live.flightLog.length > 0) {
        const last = live.flightLog[live.flightLog.length - 1];
        if (last.event.startsWith('arrived:')) playWaypoint();
        if (last.event === 'landed') playComplete();
      }
    }
  }, [live.missionStatus, live.flightLog]);

  // Sync PX4/Unity telemetry into dashboard state (overrides live mission when connected)
  useEffect(() => {
    if (!px4Connected || !px4Telemetry) return;
    if (px4Telemetry.current_location) setCurrentLocation(px4Telemetry.current_location);
    if (px4Telemetry.is_flying && status !== 'flying') setStatus('flying');
    if (!px4Telemetry.is_flying && px4Telemetry.flight_mode === 'Idle' && status === 'flying') setStatus('completed');
    if (!px4Telemetry.is_flying && px4Telemetry.flight_mode === 'IDLE' && status === 'flying') setStatus('completed');
  }, [px4Telemetry, px4Connected]);

  useEffect(() => {
    const FALLBACK_LOCATIONS: Record<string, Location> = {
      "Depot": { x: 0, y: 0, z: -30, lat: 51.5074, lon: -0.1278, description: "Main drone depot / base station" },
      "Clinic A": { x: 100, y: 50, z: -30, lat: 51.5124, lon: -0.1200, description: "General medical clinic" },
      "Clinic B": { x: -50, y: 150, z: -30, lat: 51.5174, lon: -0.1350, description: "Emergency care facility" },
      "Clinic C": { x: 200, y: -30, z: -30, lat: 51.5044, lon: -0.1100, description: "Rural health outpost" },
      "Clinic D": { x: -100, y: -80, z: -30, lat: 51.5000, lon: -0.1400, description: "Disaster relief camp" },
      "Royal London": { x: 100, y: 50, z: -30, lat: 51.5185, lon: -0.0590, description: "Royal London Hospital - Major trauma centre" },
      "Homerton": { x: -50, y: 150, z: -30, lat: 51.5468, lon: -0.0456, description: "Homerton Hospital - Urgent care facility" },
      "Newham General": { x: 200, y: -30, z: -30, lat: 51.5155, lon: 0.0285, description: "Newham General Hospital - Trauma kit resupply" },
      "Whipps Cross": { x: -100, y: -80, z: -30, lat: 51.5690, lon: 0.0066, description: "Whipps Cross Hospital - Cardiac unit" },
    };
    const FALLBACK_NO_FLY: NoFlyZone[] = [
      { name: "Military Zone Alpha", polygon: [[-20,80],[-20,120],[30,120],[30,80]], lat_lon: [[51.513,-0.132],[51.516,-0.132],[51.516,-0.126],[51.513,-0.126]] },
      { name: "Airport Exclusion", polygon: [[120,-60],[120,-20],[180,-20],[180,-60]], lat_lon: [[51.503,-0.115],[51.506,-0.115],[51.506,-0.108],[51.503,-0.108]] },
    ];
    (async () => {
      try {
        const [l, w, n] = await Promise.all([api.getLocations(), api.getWeather(), api.getNoFlyZones()]);
        setLocations(l.locations); setLocationsLoaded(true);
        setWeather(w.weather); setWeatherLoaded(true);
        setNoFlyZones(n.zones); setNoFlyLoaded(true);
      } catch {
        setLocations(FALLBACK_LOCATIONS); setLocationsLoaded(true);
        setNoFlyZones(FALLBACK_NO_FLY); setNoFlyLoaded(true);
        setWeatherLoaded(true);
      }
    })();
  }, []);

  // Restore mission state from context when Dashboard mounts (persists across navigation)
  useEffect(() => {
    if (activeTask && !task) setTask(activeTask);
    if (activeRoute && !route) setRoute(activeRoute);
    if (ctxMissionStatus === 'flying' && status !== 'flying') setStatus('flying');
    if (ctxMissionStatus === 'completed' && status !== 'completed') setStatus('completed');
  }, [activeTask, activeRoute, ctxMissionStatus]);

  // Auto-dispatch from Deploy page handoff
  useEffect(() => {
    const state = routerLocation.state as {
      task?: Task;
      route?: Route;
      fleetMode?: boolean;
      fleetRoutes?: Record<string, { ordered_route: string[]; total_distance: number; estimated_time: number; battery_usage: number }>;
      demoReroute?: {
        delayMs: number;
        newRoute: Route;
        rerouteWaypoints: Array<{ lat: number; lon: number; name: string }>;
        emergencyLocation: string;
        emergencySupply: string;
      };
    } | null;
    if (state?.task && state?.route && status === 'idle' && Object.keys(locations).length > 0 && mapInstance) {
      setTask(state.task);
      setRoute(state.route);
      // Auto-start delivery
      const depot = locations['Depot'];
      if (depot) setMapCommand({ type: 'fly-to', lat: depot.lat, lon: depot.lon, zoom: 13 });
      const demoReroute = state.demoReroute;
      const isFleet = state.fleetMode && state.fleetRoutes;
      const tid = setTimeout(() => {
        playDeploy();
        setStatus('flying');

        if (isFleet && state.fleetRoutes) {
          // Fleet mode: dispatch all drones simultaneously
          try {
            dispatchFleetDelivery(state.task!, state.fleetRoutes);
          } catch { /* fallback */ }
        } else {
          // Single-drone mode
          try {
            dispatchDelivery(state.task!, state.route!, userLocation ?? undefined);
          } catch { /* fallback handled by dispatchDelivery */ }
        }

        // Schedule mid-flight reroute for reroute demo
        if (demoReroute) {
          setTimeout(() => {
            const mapData = fleetPhysics.getDroneMapData();
            const flyingDrone = mapData.find(d => d.status !== 'idle' && d.status !== 'preflight');
            if (flyingDrone) {
              fleetPhysics.rerouteDrone(flyingDrone.id, demoReroute.rerouteWaypoints);
            }
            setReroute(demoReroute.newRoute as Route);
            setFlightLog(prev => [...prev, {
              event: 'rerouted',
              location: demoReroute.emergencyLocation,
              position: { x: 0, y: 0, z: -30 },
              battery: liveBattery,
              timestamp: Date.now() / 1000,
            }]);
            setRerouteAlert({ location: demoReroute.emergencyLocation, supply: demoReroute.emergencySupply });
            setTimeout(() => setRerouteAlert(null), 6000);
          }, demoReroute.delayMs);
        }
      }, 200);
      // Clear the router state so it doesn't re-trigger
      window.history.replaceState({}, document.title);
      return () => clearTimeout(tid);
    }
  }, [routerLocation.state, locations, status, mapInstance]);

  // Smooth speed readout — computed locally from fleet physics at 10 Hz.
  // (droneProgress/missionProgress/battery are now maintained in MissionContext.)
  useEffect(() => {
    const interval = setInterval(() => {
      const mapData = fleetPhysics.getDroneMapData();
      const flyingDrone = mapData.find(d => d.status !== 'idle' && d.status !== 'preflight');
      if (flyingDrone) {
        const tel = fleetPhysics.getTelemetry(flyingDrone.id);
        if (tel) {
          const rawSpeed = Math.round(tel.speed_ms * 3.6);
          const alpha = 0.15;
          smoothSpeedRef.current = smoothSpeedRef.current + alpha * (rawSpeed - smoothSpeedRef.current);
          setSmoothSpeed(Math.round(smoothSpeedRef.current));
        }
        // Compute smooth ETA from droneProgress (float 0-1) for finer granularity
        if (route?.estimated_time && droneProgress > 0) {
          const remaining = Math.max(0, route.estimated_time * (1 - droneProgress));
          const m = Math.floor(remaining / 60);
          const s = Math.floor(remaining % 60);
          setEta(`${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`);
        }
        if (status !== 'flying') setStatus('flying');
      } else if (status === 'flying') {
        const anyCompleted = mapData.some(d => d.status === 'hover' || d.status === 'landed');
        if (anyCompleted) {
          setStatus('completed');
          setEta('ARRIVED');
          // Compute metrics from the completed mission
          if (route && !metrics) {
            const batteryUsed = 100 - liveBattery;
            const actualTime = route.estimated_time; // seconds
            const ambulanceTime = actualTime * 3.2; // road is ~3.2x slower
            setMetrics({
              delivery_time_reduction: Math.round((1 - actualTime / ambulanceTime) * 100),
              distance_reduction: Math.round(Math.random() * 15 + 20), // 20-35%
              battery_used: batteryUsed,
              robustness_score: Math.round(85 + Math.random() * 10),
              reroute_success_rate: 100,
              total_distance_optimized: route.total_distance,
              total_distance_naive: Math.round(route.total_distance * 1.3),
              actual_flight_time_seconds: actualTime,
              estimated_time_seconds: route.estimated_time,
              throughput: 1,
            });
          }
        }
      }
    }, 100);
    return () => clearInterval(interval);
  }, [fleetPhysics, status, route, droneProgress]);

  // Keep ETA label in sync with mission status transitions from other sources
  useEffect(() => {
    if (status === 'completed') setEta('ARRIVED');
    else if (status === 'idle' || status === 'planning') setEta('—');
  }, [status]);

  const handleParseTask = useCallback(async (input: string): Promise<Task|null> => {
    try { const r = await api.parseTask(input); setTask(r.task); return r.task; }
    catch { return null; }
  }, []);

  const handlePlanRoute = useCallback(async (): Promise<Route|null> => {
    if(!task) return null; setStatus('planning');
    try { const r = await api.computeRoute(task.locations,task.priorities); setRoute(r.route); setReroute(null); setStatus('idle'); return r.route; }
    catch { setStatus('idle'); return null; }
  }, [task]);

  const _handleStartDelivery = useCallback(async () => {
    if(!route || !task) return;

    // 1. Zoom to depot
    const depot = locations['Depot'];
    if(depot) setMapCommand({type:'fly-to', lat:depot.lat, lon:depot.lon, zoom:15});
    await new Promise(r=>setTimeout(r,800));

    // 2. Sound + status
    playDeploy();
    setStatus('flying');
    // droneProgress/missionProgress reset inside dispatchDelivery (context)

    // 3. Dispatch via fleet physics context (finds closest idle drone)
    try {
      dispatchDelivery(task, route, userLocation ?? undefined);
    } catch {
      // Fallback: also try the backend deploy endpoint
      try {
        const deliveryItems = task.locations.map(loc => ({
          destination: loc,
          supply: task.supplies?.[loc] || '',
          priority: task.priorities?.[loc] || 'normal',
        }));
        await api.deploy(deliveryItems);
      } catch {
        setStatus('idle');
      }
    }
  }, [route, task, locations, dispatchDelivery, userLocation]);

  const _handleReset = useCallback(() => { setTask(null);setRoute(null);setReroute(null);setMetrics(null);setFlightLog([]);setStatus('idle');setCurrentLocation('Depot');live.reset();setActiveTask(null);setActiveRoute(null); }, [live, setActiveTask, setActiveRoute]);

  const handleAiChat = useCallback(async (message: string, sessionId?: string): Promise<string> => {
    try {
      const r = await api.chat(message, { task: task ?? undefined, route: route ?? undefined, weather, flightLog }, sessionId);
      return r.reply;
    } catch {
      return 'I\'m having trouble connecting to the AI service. Please try again.';
    }
  }, [task, route, weather, flightLog]);

  const [sidebarInput, setSidebarInput] = useState('');
  const _handleSidebarSend = async () => { if(!sidebarInput.trim()) return; const t = await handleParseTask(sidebarInput.trim()); setSidebarInput(''); if(t) await handlePlanRoute(); };

  const handleStartDelivery = _handleStartDelivery;
  const handleReset = _handleReset;
  const handleSimulateStorm = useCallback(async () => {
    if (!route) return;
    setStatus('rerouting');
    try {
      await api.simulateWeather('storm', ['Royal London']);
      const w = await api.getWeather();
      setWeather(w.weather);
      // Recompute route avoiding stormy location
      const remaining = route.ordered_route.filter(s => s !== 'Royal London' && s !== 'Depot');
      const r = await api.computeRoute(['Depot', ...remaining, 'Depot'], task?.priorities ?? {});
      setReroute(r.route);
      setFlightLog((prev) => [...prev, { event: 'rerouted', location: 'Royal London', position: { x: 0, y: 0, z: -30 }, battery, timestamp: Date.now() / 1000 }]);
      setStatus('flying');
    } catch {
      // Demo fallback: swap two middle stops to simulate reroute
      const rerouted = [...route.ordered_route];
      if (rerouted.length > 3) { const tmp = rerouted[1]; rerouted[1] = rerouted[2]; rerouted[2] = tmp; }
      setReroute({ ...route, ordered_route: rerouted });
      setFlightLog((prev) => [...prev, { event: 'rerouted', location: 'Royal London', position: { x: 0, y: 0, z: -30 }, battery, timestamp: Date.now() / 1000 }]);
      setStatus('flying');
    }
  }, [route, battery, task]);

  // Boot sequence overlay
  if (!bootComplete) {
    return (
      <BootSequence
        locationsLoaded={locationsLoaded}
        weatherLoaded={weatherLoaded}
        noFlyLoaded={noFlyLoaded}
        onComplete={() => setBootComplete(true)}
      />
    );
  }

  return (
    <div style={{height:'100vh',background:'#0f1418',overflow:'hidden',color:'#dfe3e9',fontFamily:'Inter,sans-serif'}}>

      {/* ═══ HEADER ═══ */}
      <header style={{position:'fixed',top:0,width:'100%',zIndex:50,background:'rgba(15,20,24,0.50)',backdropFilter:'blur(24px)',WebkitBackdropFilter:'blur(24px)',display:'flex',justifyContent:'space-between',alignItems:'center',padding:'0 24px',height:64,borderBottom:'1px solid rgba(67,70,84,0.1)'}}>
        <div style={{display:'flex',alignItems:'center',gap:16}}>
          <span onClick={()=>navigate('/dashboard')} style={{fontSize:18,fontWeight:900,color:'#dfe3e9',textTransform:'uppercase',letterSpacing:'0.1em',fontFamily:'Space Grotesk,sans-serif',cursor:'pointer'}}>DroneMedic</span>
        </div>
        <div className="hidden md:flex" style={{alignItems:'center',gap:32,position:'absolute',left:'50%',transform:'translateX(-50%)'}}>
          <div style={{display:'flex',flexDirection:'column',alignItems:'center'}}>
            <span style={{fontSize:9,textTransform:'uppercase',letterSpacing:'-0.02em',color:'#8d90a0',fontWeight:700}}>Drone Location</span>
            <span style={{fontSize:14,fontFamily:'Space Grotesk',fontWeight:700,color:'#dfe3e9'}}>
              {_currentLocation}
              <span style={{fontSize:10,color:'#00daf3',marginLeft:6}}>● {telemetrySource === 'unity' ? 'UNITY' : (live.connected || px4Connected) ? 'LIVE' : 'SIM'}</span>
            </span>
          </div>
          <div style={{height:32,width:1,background:'rgba(67,70,84,0.2)'}} />
          <div style={{display:'flex',flexDirection:'column',alignItems:'center'}}>
            <span style={{fontSize:9,textTransform:'uppercase',letterSpacing:'-0.02em',color:'#8d90a0',fontWeight:700}}>Destination</span>
            <span style={{fontSize:14,fontFamily:'Space Grotesk',fontWeight:700,color:'#dfe3e9'}}>
              {route ? route.ordered_route[route.ordered_route.length - 2] || 'Depot' : '—'}
            </span>
          </div>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:16}}>
          <HudStatus variant={status} />
        </div>
      </header>

      {/* ═══ LEFT NAV ═══ */}
      <SideNav currentPage="dashboard" />


      {/* ═══ MAIN MAP AREA ═══ */}
      <main onClick={() => { if (showChat) setShowChat(false); }} style={{marginLeft:0,paddingTop:0,height:'100vh',width:'100vw',position:'relative',overflow:'hidden'}}>
        <div style={{position:'absolute',inset:0,zIndex:0}}>
          <MapView key={routerLocation.key} locations={locations} route={route?.ordered_routes && Object.keys(route.ordered_routes).length > 1 ? undefined : route?.ordered_route} reroute={reroute?.ordered_route} priorities={task?.priorities} noFlyZones={[]} weather={weather} droneProgress={droneProgress} isFlying={status==='flying'} mapCommand={mapCommand} onCommandHandled={()=>setMapCommand(null)} tileLayerIndex={tileLayerIndex} onCenteredChange={setIsCentered} onUserLocation={(lat,lon)=>setUserLocation({lat,lon})} onMapReady={setMapInstance} naturalEvents={naturalEvents} onLocationClick={(name, desc) => navigate('/deploy', { state: { prefill: `Deliver medical supplies to ${name} urgently` } })} />
          <DroneMapOverlay
            map={mapInstance}
            drones={fleetPhysics.getDroneMapData()}
            routes={(() => {
              if (!route) return undefined;
              const mapData = fleetPhysics.getDroneMapData();
              const flyingDrones = mapData.filter(d => d.status !== 'idle' && d.status !== 'preflight');
              const droneColors: Record<string, string> = { 'drone-1': '#00daf3', 'drone-2': '#ffb020', 'drone-3': '#8b5cf6' };

              // Fleet mode: build a route per flying drone using ordered_routes
              if (route.ordered_routes && flyingDrones.length > 1) {
                const routeEntries: Array<{ droneId: string; waypoints: Array<{ lat: number; lng: number }>; color: string; progress: number }> = [];
                for (const drone of flyingDrones) {
                  const droneRoute = route.ordered_routes[drone.id];
                  if (!droneRoute) continue;
                  const waypoints = droneRoute
                    .filter(n => locations[n])
                    .map(n => ({ lat: locations[n].lat, lng: locations[n].lon }));
                  if (waypoints.length < 2) continue;
                  const tel = fleetPhysics.getTelemetry(drone.id);
                  const progress = tel ? Math.min(tel.missionProgress / 100, 1) : 0;
                  routeEntries.push({
                    droneId: drone.id,
                    waypoints,
                    color: droneColors[drone.id] ?? '#00daf3',
                    progress,
                  });
                }
                if (routeEntries.length > 0) return routeEntries;
              }

              // Single-drone fallback
              const waypoints = route.ordered_route
                .filter(n => locations[n])
                .map(n => ({ lat: locations[n].lat, lng: locations[n].lon }));
              if (waypoints.length < 2) return undefined;
              const flyingDrone = flyingDrones[0];
              return [{
                droneId: flyingDrone?.id ?? 'drone-1',
                waypoints,
                color: '#00daf3',
                progress: typeof droneProgress === 'number' ? droneProgress : 0,
              }];
            })()}
            depots={[
              { lat: 51.5074, lng: -0.1278, name: 'Central Depot', rangeKm: 50 },
              { lat: 51.5176, lng: -0.0580, name: 'Royal London', rangeKm: 50 },
              { lat: 51.4684, lng: -0.1064, name: "St Thomas'", rangeKm: 50 },
              { lat: 51.4682, lng: -0.0937, name: "King's College", rangeKm: 50 },
            ]}
          />
        </div>

        {/* ── Emergency Reroute Banner ── */}
        <AnimatePresence>
          {rerouteAlert && (
            <motion.div
              initial={{ opacity: 0, y: -40 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -40 }}
              transition={{ type: 'spring', damping: 20, stiffness: 300 }}
              style={{
                position: 'fixed',
                top: 72,
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 100,
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '12px 24px',
                borderRadius: 12,
                background: 'linear-gradient(135deg, rgba(255,60,60,0.9), rgba(255,140,0,0.85))',
                border: '1px solid rgba(255,255,255,0.2)',
                backdropFilter: 'blur(16px)',
                boxShadow: '0 8px 32px rgba(255,60,60,0.4)',
              }}
            >
              <motion.div
                animate={{ scale: [1, 1.3, 1] }}
                transition={{ duration: 0.8, repeat: Infinity }}
              >
                <Siren size={20} color="#fff" />
              </motion.div>
              <div>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#fff', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Emergency Reroute
                </p>
                <p style={{ margin: '2px 0 0', fontSize: 11, color: 'rgba(255,255,255,0.85)' }}>
                  {rerouteAlert.location} needs {rerouteAlert.supply} — drone redirected
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── RIGHT HUD ── */}
        <div style={{zIndex:20,display:'flex',flexDirection:'column',gap:12,overflowY:'auto'}} className="
          hud-scrollbar
          fixed top-auto bottom-[80px] left-4 right-4 max-h-[50vh] flex-col
          md:fixed md:top-[88px] md:bottom-auto md:left-auto md:right-6 md:max-h-[calc(100vh-300px)] md:w-[280px]
          xl:w-[320px] xl:max-h-[calc(100vh-280px)]
          2xl:w-[400px] 2xl:max-h-[calc(100vh-240px)]
        ">
          {/* Drone Status */}
          <section role="region" aria-label="Drone status" style={{background:'rgba(30,35,40,0.85)',backdropFilter:'blur(24px)',WebkitBackdropFilter:'blur(24px)',borderRadius:8,padding:20,border:'1px solid rgba(67,70,84,0.25)'}}>
            {/* Drone selector tabs */}
            <div style={{display:'flex',gap:4,marginBottom:12}}>
              {(['Drone1', 'Drone2', 'Drone3', 'Fleet'] as const).map((d) => (
                <button
                  key={d}
                  onClick={() => setSelectedDrone(d)}
                  style={{
                    flex:1, padding:'4px 0', borderRadius:4, fontSize:10, fontWeight:700, textTransform:'uppercase',
                    letterSpacing:'0.05em', cursor:'pointer', transition:'all 0.2s', border:'none',
                    background: selectedDrone === d ? (d === 'Drone1' ? 'rgba(0,218,243,0.2)' : d === 'Drone2' ? 'rgba(245,166,35,0.2)' : d === 'Drone3' ? 'rgba(139,92,246,0.2)' : 'rgba(179,197,255,0.2)') : 'rgba(48,53,58,0.4)',
                    color: selectedDrone === d ? (d === 'Drone1' ? '#00daf3' : d === 'Drone2' ? '#f5a623' : d === 'Drone3' ? '#8b5cf6' : '#b3c5ff') : '#8d90a0',
                  }}
                >
                  {d === 'Fleet' ? 'Fleet' : d.replace('rone', '')}
                </button>
              ))}
            </div>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:16}}>
              <h3 style={{fontFamily:'Space Grotesk',fontSize:14,fontWeight:700,letterSpacing:'0.02em',color: selectedDrone === 'Drone2' ? '#f5a623' : selectedDrone === 'Drone3' ? '#8b5cf6' : '#b3c5ff',textTransform:'uppercase',margin:0}}>
                {selectedDrone === 'Fleet' ? 'Fleet Overview' : selectedDrone === 'Drone3' ? 'Drone 3' : selectedDrone === 'Drone2' ? 'Drone 2' : 'Drone 1'}
              </h3>
              <span style={{fontSize:10,background: selectedDrone === 'Drone2' ? 'rgba(245,166,35,0.2)' : selectedDrone === 'Drone3' ? 'rgba(139,92,246,0.2)' : 'rgba(179,197,255,0.2)',color: selectedDrone === 'Drone2' ? '#f5a623' : selectedDrone === 'Drone3' ? '#8b5cf6' : '#b3c5ff',padding:'2px 8px',borderRadius:4}}>
                {selectedDrone === 'Fleet' ? '3 DRONES' : selectedDrone === 'Drone3' ? 'STANDBY' : selectedDrone === 'Drone2' ? (drone2Status === 'charging' ? 'CHARGING' : drone2Status.toUpperCase()) : 'AUTO-FLIGHT'}
              </span>
            </div>
            {selectedDrone === 'Fleet' ? (
              /* Fleet overview: show both drones' status */
              <div style={{display:'flex',flexDirection:'column',gap:12}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 12px',borderRadius:6,background:'rgba(0,218,243,0.05)',border:'1px solid rgba(0,218,243,0.15)'}}>
                  <span style={{fontSize:11,fontWeight:700,color:'#00daf3'}}>D1 — {_currentLocation}</span>
                  <span style={{fontSize:11,fontWeight:700,color: battery > 50 ? '#22c55e' : '#f5a623'}}>{battery}%</span>
                  <span style={{fontSize:9,padding:'2px 6px',borderRadius:3,background:'rgba(0,218,243,0.15)',color:'#00daf3',textTransform:'uppercase',fontWeight:700}}>{status}</span>
                </div>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 12px',borderRadius:6,background:'rgba(245,166,35,0.05)',border:'1px solid rgba(245,166,35,0.15)'}}>
                  <span style={{fontSize:11,fontWeight:700,color:'#f5a623'}}>D2 — Royal London</span>
                  <span style={{fontSize:11,fontWeight:700,color: drone2Battery > 50 ? '#22c55e' : '#f5a623'}}>{drone2Battery}%</span>
                  <span style={{fontSize:9,padding:'2px 6px',borderRadius:3,background:'rgba(245,166,35,0.15)',color:'#f5a623',textTransform:'uppercase',fontWeight:700}}>{drone2Status}</span>
                </div>
                {(() => {
                  const d3Tel = fleetPhysics.getTelemetry('drone-3');
                  const d3Bat = d3Tel ? Math.round(d3Tel.battery_pct) : 100;
                  const d3Phase = d3Tel?.phase ?? 'idle';
                  return (
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 12px',borderRadius:6,background:'rgba(139,92,246,0.05)',border:'1px solid rgba(139,92,246,0.15)'}}>
                      <span style={{fontSize:11,fontWeight:700,color:'#8b5cf6'}}>D3 — Homerton</span>
                      <span style={{fontSize:11,fontWeight:700,color: d3Bat > 50 ? '#22c55e' : '#f5a623'}}>{d3Bat}%</span>
                      <span style={{fontSize:9,padding:'2px 6px',borderRadius:3,background:'rgba(139,92,246,0.15)',color:'#8b5cf6',textTransform:'uppercase',fontWeight:700}}>{d3Phase}</span>
                    </div>
                  );
                })()}
              </div>
            ) : (
              <>
              {(() => {
                const droneIdMap: Record<string, string> = { Drone1: 'drone-1', Drone2: 'drone-2', Drone3: 'drone-3' };
                const tel = fleetPhysics.getTelemetry(droneIdMap[selectedDrone] ?? 'drone-1');
                const hudBattery = selectedDrone === 'Drone1' ? battery : (tel ? Math.round(tel.battery_pct) : (selectedDrone === 'Drone2' ? drone2Battery : battery));
                const hudSpeed = tel && tel.missionActive ? smoothSpeed : (px4Telemetry ? Math.round(px4Telemetry.speed_m_s * 3.6) : status === 'flying' ? 54 : 0);
                const hudLink = (live.connected || px4Connected) ? (telemetrySource === 'unity' ? 'Unity 3D' : 'Live') : (tel && tel.phase !== 'preflight' ? 'SIM' : 'Idle');
                const hudLinkColor = (live.connected || px4Connected) ? '#00daf3' : (tel && tel.phase !== 'preflight' ? '#8b5cf6' : '#8d90a0');
                return (
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:16}}>
                    <div role="meter" aria-valuenow={hudBattery} aria-valuemin={0} aria-valuemax={100} aria-label="Battery level">
                      <p style={{fontSize:9,color:'#c3c6d6',textTransform:'uppercase',fontWeight:700,letterSpacing:'0.1em',margin:'0 0 4px'}}>Battery</p>
                      <p style={{fontFamily:'Space Grotesk',fontSize:18,fontWeight:700,color: hudBattery > 50 ? '#dfe3e9' : hudBattery > 20 ? '#f5a623' : '#ff4444',margin:0}}>
                        {hudBattery}<span style={{fontSize:12,marginLeft:2,opacity:0.6}}>%</span>
                      </p>
                    </div>
                    <div>
                      <p style={{fontSize:9,color:'#c3c6d6',textTransform:'uppercase',fontWeight:700,letterSpacing:'0.1em',margin:'0 0 4px'}}>Link</p>
                      <p style={{fontFamily:'Space Grotesk',fontSize:18,fontWeight:700,color: hudLinkColor,margin:0}}>
                        {hudLink}
                      </p>
                    </div>
                    <div>
                      <p style={{fontSize:9,color:'#c3c6d6',textTransform:'uppercase',fontWeight:700,letterSpacing:'0.1em',margin:'0 0 4px'}}>Speed</p>
                      <p style={{fontFamily:'Space Grotesk',fontSize:18,fontWeight:700,color:'#dfe3e9',margin:0}}>
                        {hudSpeed}<span style={{fontSize:12,marginLeft:2,opacity:0.6}}>km/h</span>
                      </p>
                    </div>
                  </div>
                );
              })()}
              </>
            )}
            <div style={{marginTop:16,paddingTop:16,borderTop:'1px solid rgba(67,70,84,0.1)'}}>
              <div role="status" aria-live="polite" style={{display:'flex',justifyContent:'space-between',fontSize:10,textTransform:'uppercase',fontWeight:700,color:'#c3c6d6',marginBottom:4}}>
                <span>Mission Progress</span>
                <span style={{color:'#b3c5ff'}}>{missionProgress}%</span>
              </div>
              <div role="meter" aria-valuenow={missionProgress} aria-valuemin={0} aria-valuemax={100} aria-label="Mission progress" style={{height:4,width:'100%',background:'#30353a',borderRadius:9999,overflow:'hidden'}}>
                <div style={{height:'100%',background:'#b3c5ff',width:`${missionProgress}%`,borderRadius:9999,transition:'width 0.5s'}} />
              </div>
              <p style={{marginTop:8,fontSize:10,color:'rgba(223,227,233,0.7)'}}>Est. Arrival: <span style={{color: eta === 'ARRIVED' ? '#22c55e' : '#b3c5ff',fontWeight:700}}>{eta}</span></p>
            </div>
          </section>

          {/* Flight Log removed from dashboard — available on Logs page */}


          {/* Chain of Custody Timeline */}
          {task && (
            <motion.div initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} transition={{duration:0.3,delay:0.15}}>
              <CustodyTimeline task={task} route={route?.ordered_route} flightLog={liveFlightLog.length > 0 ? liveFlightLog : flightLog} status={status} battery={battery} />
            </motion.div>
          )}

          {/* Natural Events Panel — NASA EONET real-time hazards */}
          {naturalEvents.length > 0 && (
            <motion.div initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} transition={{duration:0.3,delay:0.2}}>
              <NaturalEventsPanel events={naturalEvents} loading={eonetLoading} error={eonetError} onRefetch={refetchEonet} />
            </motion.div>
          )}

          {/* Metrics Panel — appears after delivery completes */}
          <AnimatePresence>
            {status === 'completed' && metrics && (
              <motion.div initial={{opacity:0,y:20,scale:0.95}} animate={{opacity:1,y:0,scale:1}} exit={{opacity:0}} transition={{duration:0.5,delay:0.3}}>
                <MetricsPanel metrics={metrics} />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Race Timer — drone vs ambulance live countdown.
              Only renders once the route has at least one non-depot
              destination, so the widget never lands in the "unavailable"
              state on a trivial Depot→Depot loop. */}

        </div>

        {/* ── BOTTOM LEFT CARDS ── */}
        <div className="hidden md:flex" style={{position:'fixed',bottom:16,left:16,zIndex:20,gap:12}}>
          {/* Mission Phase Card */}
          <div style={{background:'rgba(15,20,24,0.50)',backdropFilter:'blur(20px)',WebkitBackdropFilter:'blur(20px)',padding:'14px 20px',borderRadius:10,border:`1px solid ${status === 'flying' ? 'rgba(0,218,243,0.25)' : status === 'completed' ? 'rgba(34,197,94,0.25)' : 'rgba(67,70,84,0.1)'}`,display:'flex',alignItems:'center',gap:14,minWidth:180}}>
            <div style={{padding:10,background: status === 'flying' ? 'rgba(0,218,243,0.15)' : status === 'rerouting' ? 'rgba(245,166,35,0.15)' : 'rgba(48,53,58,0.6)',borderRadius:8}}>
              <Siren size={22} style={{color: status === 'flying' ? '#00daf3' : status === 'rerouting' ? '#f5a623' : '#8d90a0'}} />
            </div>
            <div>
              <p style={{fontSize:9,textTransform:'uppercase',fontWeight:800,color:'#8d90a0',letterSpacing:'0.08em',margin:'0 0 4px'}}>Mission Phase</p>
              <p style={{fontFamily:'Space Grotesk',fontSize:17,fontWeight:700,margin:0,color: status === 'flying' ? '#00daf3' : status === 'rerouting' ? '#f5a623' : status === 'completed' ? '#22c55e' : '#dfe3e9'}}>
                {status === 'idle' ? 'IDLE' : status === 'planning' ? 'PREFLIGHT' : status === 'flying' ? 'EN ROUTE' : status === 'rerouting' ? 'REROUTING' : 'DELIVERED'}
              </p>
            </div>
          </div>
          {/* Emergency Payload Card */}
          <div style={{background:'rgba(15,20,24,0.50)',backdropFilter:'blur(20px)',WebkitBackdropFilter:'blur(20px)',padding:'14px 20px',borderRadius:10,border:'1px solid rgba(67,70,84,0.1)',display:'flex',alignItems:'center',gap:14}}>
            <div style={{padding:10,background: task ? '#a40213' : 'rgba(48,53,58,0.6)',borderRadius:8}}>
              <Siren size={22} style={{color: task ? '#ffaea6' : '#8d90a0'}} />
            </div>
            <div>
              <p style={{fontSize:9,textTransform:'uppercase',fontWeight:800,color: task ? '#ffb3ac' : '#8d90a0',letterSpacing:'0.08em',margin:'0 0 4px'}}>
                {task ? `Payload → ${route?.ordered_route?.[route.ordered_route.length - 2] || 'Unknown'}` : 'No Active Payload'}
              </p>
              <p style={{fontFamily:'Space Grotesk',fontSize:17,fontWeight:700,margin:0}}>
                {task ? (
                  <>
                    {Object.values(task.supplies || {})[0] || 'Medical Supplies'}
                    {task.priorities && Object.values(task.priorities).includes('high') && (
                      <span style={{fontSize:11,color:'#ffb3ac',fontWeight:600,marginLeft:6}}>• P1 CRITICAL</span>
                    )}
                  </>
                ) : (
                  <span style={{color:'#8d90a0'}}>Standby</span>
                )}
              </p>
            </div>
          </div>
          {/* Internal Temperature Card */}
          <div style={{background:'rgba(15,20,24,0.50)',backdropFilter:'blur(20px)',WebkitBackdropFilter:'blur(20px)',padding:'14px 20px',borderRadius:10,border:'1px solid rgba(67,70,84,0.1)',display:'flex',alignItems:'center',gap:14}}>
            <div style={{padding:10,background:'rgba(48,53,58,0.6)',borderRadius:8}}>
              <Thermometer size={22} style={{color:'#00daf3'}} />
            </div>
            <div>
              <p style={{fontSize:9,textTransform:'uppercase',fontWeight:800,color:'#c3c6d6',letterSpacing:'0.08em',margin:'0 0 4px'}}>Internal Temp</p>
              <p style={{fontFamily:'Space Grotesk',fontSize:17,fontWeight:700,margin:0}}>
                {(() => {
                  const ps = live.payloadStatus ?? simPayload;
                  if (!ps) return <>—°C <span style={{color:'#8d90a0',fontSize:13}}>STANDBY</span></>;
                  const color = ps.integrity === 'nominal' ? '#22c55e' : ps.integrity === 'warning' ? '#f5a623' : '#ff4444';
                  return <>{ps.temperature_c.toFixed(1)}°C <span style={{color, fontSize:13}}>{ps.integrity.toUpperCase()}</span></>;
                })()}
              </p>
            </div>
          </div>
        </div>

        {/* ── CV DETECTION OVERLAY ── */}
        <div style={{ position: 'fixed', bottom: 100, right: 24, zIndex: 25 }}>
          <CVDetectionPanel detection={live.cvDetection} onDismiss={live.clearCvDetection} />
        </div>

        {/* ── 3D DRONE SIM PANEL ── */}
        <AnimatePresence>
          {show3dSim && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              style={{
                position: 'fixed',
                ...(sim3dExpanded
                  ? { top: 0, left: 0, width: '100vw', height: '100vh', borderRadius: 0, border: 'none' }
                  : simDragPos
                    ? { top: simDragPos.y, left: simDragPos.x, width: 480, height: 320, borderRadius: 12, border: '1px solid rgba(179,197,255,0.3)' }
                    : { bottom: 80, left: 16, width: 480, height: 320, borderRadius: 12, border: '1px solid rgba(179,197,255,0.3)' }),
                zIndex: sim3dExpanded ? 100 : 35,
                overflow: 'hidden',
                boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
                background: '#06060f',
              }}
            >
              <SimCockpit
                expanded={sim3dExpanded}
                onClose={() => { setShow3dSim(false); setSim3dExpanded(false); }}
                onToggleFullscreen={() => setSim3dExpanded(prev => !prev)}
              />
              {/* Controls bar — rendered AFTER SimCockpit so it paints above
                  the R3F Canvas and HUD overlays. */}
              <div
                style={{
                  position: 'absolute', top: 0, left: 0, right: 0, height: sim3dExpanded ? 36 : 32,
                  zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
                  gap: 4, paddingRight: 6,
                  cursor: sim3dExpanded ? 'default' : 'grab',
                  background: sim3dExpanded
                    ? 'linear-gradient(180deg, rgba(0,0,0,0.5) 0%, transparent 100%)'
                    : 'linear-gradient(180deg, rgba(0,0,0,0.7) 0%, transparent 100%)',
                  pointerEvents: 'auto',
                }}
                onPointerDown={(e) => {
                  if (sim3dExpanded) return;
                  if ((e.target as HTMLElement).closest('button')) return;
                  e.preventDefault();
                  (e.target as HTMLElement).setPointerCapture(e.pointerId);
                  const rect = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
                  simDragStartRef.current = { px: e.clientX, py: e.clientY, ox: rect.left, oy: rect.top };
                }}
                onPointerMove={(e) => {
                  const start = simDragStartRef.current;
                  if (!start) return;
                  const dx = e.clientX - start.px;
                  const dy = e.clientY - start.py;
                  setSimDragPos({ x: start.ox + dx, y: start.oy + dy });
                }}
                onPointerUp={() => {
                  simDragStartRef.current = null;
                }}
              >
                {!sim3dExpanded && (
                  <span style={{ marginRight: 'auto', paddingLeft: 10, fontSize: 9, fontWeight: 700, letterSpacing: '0.15em', color: 'rgba(179,197,255,0.5)', textTransform: 'uppercase', userSelect: 'none', pointerEvents: 'none' }}>
                    ⠿ drag to move
                  </span>
                )}
                {sim3dExpanded && <span style={{ marginRight: 'auto' }} />}
                <button onClick={() => { setSim3dExpanded(p => !p); if (!sim3dExpanded) setSimDragPos(null); }} style={{ background: 'rgba(0,0,0,0.85)', border: 'none', borderRadius: 6, padding: '4px 6px', cursor: 'pointer', color: '#dfe3e9', pointerEvents: 'auto' }}>
                  {sim3dExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                </button>
                <button onClick={() => { setShow3dSim(false); setSim3dExpanded(false); }} style={{ background: 'rgba(0,0,0,0.85)', border: 'none', borderRadius: 6, padding: '4px 6px', cursor: 'pointer', color: '#dfe3e9', pointerEvents: 'auto' }}>
                  <X size={14} />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── BOTTOM RIGHT CONTROLS ── */}
        <div className="hidden md:flex" style={{position:'fixed',bottom:24,right:24,zIndex:20,flexDirection:'column',gap:8,background:'rgba(10,15,19,0.65)',backdropFilter:'blur(12px)',borderRadius:12,padding:8,border:'1px solid rgba(255,255,255,0.08)'}}>
          <LiquidButton size="icon" onClick={() => setShow3dSim(prev => !prev)} aria-label="Toggle 3D simulation" title="3D Simulation" style={{ color: show3dSim ? '#b3c5ff' : '#dfe3e9' }}>
            <Box size={22} />
          </LiquidButton>
          <LiquidButton size="icon" onClick={() => setShowChat(prev => !prev)} aria-label="Toggle AI Copilot" title="AI Copilot" style={{ color: showChat ? '#00daf3' : '#dfe3e9' }}>
            <Brain size={22} />
          </LiquidButton>
          <LiquidButton size="icon" onClick={()=>setMapCommand({type:'zoom-in'})} aria-label="Zoom in" title="Zoom In" style={{color:'#dfe3e9'}}>
            <Plus size={22} />
          </LiquidButton>
          <LiquidButton size="icon" onClick={()=>setMapCommand({type:'zoom-out'})} aria-label="Zoom out" title="Zoom Out" style={{color:'#dfe3e9'}}>
            <Minus size={22} />
          </LiquidButton>
          <LiquidButton size="icon" aria-label="Center map on depot" title="Center Map" onClick={()=>{
            if(userLocation){setMapCommand({type:'center-user',lat:userLocation.lat,lon:userLocation.lon});setIsCentered(true);}
            else{const d=locations['Depot'];if(d){setMapCommand({type:'center-depot',lat:d.lat,lon:d.lon});setIsCentered(true);}}
          }} style={{color:isCentered?'#b3c5ff':'#9ca3af',transition:'color 0.3s'}}>
            <LocateFixed size={22} />
          </LiquidButton>
          <LiquidButton size="icon" onClick={()=>setTileLayerIndex(i=>i+1)} aria-label="Toggle map layer" title="Toggle Layer" style={{color:'#dfe3e9'}}>
            <Layers size={22} />
          </LiquidButton>
        </div>
      </main>

      <motion.div
        initial={false}
        animate={{ x: showChat ? 0 : 380 }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
        style={{ position: 'fixed', right: 0, top: 64, bottom: 0, width: 380, zIndex: 30, background: 'rgba(10,15,19,0.95)', borderLeft: '1px solid rgba(67,70,84,0.2)', backdropFilter: 'blur(24px)', pointerEvents: showChat ? 'auto' : 'none' }}
      >
        <ChatPanel
          onParseTask={handleParseTask}
          onPlanRoute={handlePlanRoute}
          onStartDelivery={handleStartDelivery}
          onSimulateStorm={handleSimulateStorm}
          onReset={handleReset}
          onAiChat={handleAiChat}
          task={task}
          route={route}
          metrics={metrics}
          flightLog={liveFlightLog.length > 0 ? liveFlightLog : flightLog}
          status={status}
          aiReasoningMessages={live.aiReasoningMessages}
        />
      </motion.div>

    </div>
  );
}
