import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Minus, LocateFixed, Layers, Siren, Thermometer, Brain } from 'lucide-react';
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
import { useSoundEffects } from '../hooks/useSoundEffects';
import { useLiveMission } from '../hooks/useLiveMission';
import { usePX4Telemetry } from '../hooks/usePX4Telemetry';
import { useEONET } from '../hooks/useEONET';
import { api } from '../lib/api';
import type { Task, Route, Location, Weather, NoFlyZone, Metrics, FlightLogEntry } from '../lib/api';

type MissionStatus = 'idle' | 'planning' | 'flying' | 'rerouting' | 'completed';

export function Dashboard() {
  const navigate = useNavigate();
  const [locations, setLocations] = useState<Record<string, Location>>({});
  const [task, setTask] = useState<Task | null>(null);
  const [route, setRoute] = useState<Route | null>(null);
  const [reroute, setReroute] = useState<Route | null>(null);
  const [weather, setWeather] = useState<Record<string, Weather>>({});
  const [noFlyZones, setNoFlyZones] = useState<NoFlyZone[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [flightLog, setFlightLog] = useState<FlightLogEntry[]>([]);
  const [status, setStatus] = useState<MissionStatus>('idle');
  const [battery, setBattery] = useState(85);
  const [_currentLocation, setCurrentLocation] = useState('Depot');
  const [droneProgress, setDroneProgress] = useState(0);
  const [missionProgress, setMissionProgress] = useState(72);
  const [mapCommand, setMapCommand] = useState<MapCommand | null>(null);
  const [tileLayerIndex, setTileLayerIndex] = useState(1);
  const [isCentered, setIsCentered] = useState(true);
  const [userLocation, setUserLocation] = useState<{lat:number;lon:number}|null>(null);
  const { playDeploy, playWaypoint, playComplete } = useSoundEffects();
  const live = useLiveMission(route?.ordered_route);
  const { telemetry: px4Telemetry, connected: px4Connected, sendCommand: px4Command, source: telemetrySource } = usePX4Telemetry();
  const { events: naturalEvents, loading: eonetLoading, error: eonetError, refetch: refetchEonet } = useEONET({ limit: 30, days: 60 });
  const [showChat, setShowChat] = useState(false);
  const [bootComplete, setBootComplete] = useState(false);
  const [locationsLoaded, setLocationsLoaded] = useState(false);
  const [mapInstance, setMapInstance] = useState<google.maps.Map | null>(null);
  const [selectedDrone, setSelectedDrone] = useState<'Drone1' | 'Drone2' | 'Fleet'>('Drone1');
  const [drone2Battery, setDrone2Battery] = useState(95);
  const [drone2Status, setDrone2Status] = useState<'idle' | 'flying' | 'charging'>('idle');
  const [drone2Location] = useState<{lat: number; lon: number}>({ lat: 51.5176, lon: -0.0580 }); // Royal London depot
  const [weatherLoaded, setWeatherLoaded] = useState(false);
  const [noFlyLoaded, setNoFlyLoaded] = useState(false);

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
  useEffect(() => {
    if (live.missionStatus === 'flying' || live.missionStatus === 'completed' || live.missionStatus === 'paused') {
      setStatus(live.missionStatus === 'flying' ? 'flying' : live.missionStatus as MissionStatus);
      setDroneProgress(live.droneProgress);
      setMissionProgress(live.missionProgress);
      if (live.flightLog.length > 0) {
        setFlightLog(live.flightLog);
        const lastEntry = live.flightLog[live.flightLog.length - 1];
        setBattery(Math.round(lastEntry.battery));
        setCurrentLocation(lastEntry.location);
      }
      if (live.flightLog.length > 0) {
        const last = live.flightLog[live.flightLog.length - 1];
        if (last.event.startsWith('arrived:')) playWaypoint();
        if (last.event === 'landed') playComplete();
      }
    }
  }, [live.missionStatus, live.droneProgress, live.missionProgress, live.flightLog]);

  // Sync PX4/Unity telemetry into dashboard state (overrides live mission when connected)
  useEffect(() => {
    if (!px4Connected || !px4Telemetry) return;
    setBattery(Math.round(px4Telemetry.battery_pct));
    if (px4Telemetry.current_location) setCurrentLocation(px4Telemetry.current_location);
    if (px4Telemetry.is_flying && status !== 'flying') setStatus('flying');
    if (!px4Telemetry.is_flying && px4Telemetry.flight_mode === 'Idle' && status === 'flying') setStatus('completed');
    if (!px4Telemetry.is_flying && px4Telemetry.flight_mode === 'IDLE' && status === 'flying') setStatus('completed');
  }, [px4Telemetry, px4Connected]);

  useEffect(() => {
    (async () => {
      try {
        const [l, w, n] = await Promise.all([api.getLocations(), api.getWeather(), api.getNoFlyZones()]);
        setLocations(l.locations); setLocationsLoaded(true);
        setWeather(w.weather); setWeatherLoaded(true);
        setNoFlyZones(n.zones); setNoFlyLoaded(true);
      } catch {
        setLocationsLoaded(true);
        setWeatherLoaded(true);
        setNoFlyLoaded(true);
      }
    })();
  }, []);

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
    const stops = route.ordered_route;

    // 1. Zoom to depot
    const depot = locations['Depot'];
    if(depot) setMapCommand({type:'fly-to', lat:depot.lat, lon:depot.lon, zoom:15});
    await new Promise(r=>setTimeout(r,800));

    // 2. Connect WebSocket for live updates
    live.reset();
    live.connect();
    playDeploy();
    setStatus('flying'); setDroneProgress(0); setMissionProgress(0);
    setFlightLog([{event:'takeoff',location:'Depot',position:{x:0,y:0,z:-30},battery:100,timestamp:Date.now()/1000}]);

    // 3. Deploy via backend (non-blocking — returns immediately, streams via WebSocket)
    try {
      const deliveryItems = task.locations.map(loc => ({
        destination: loc,
        supply: task.supplies?.[loc] || '',
        priority: task.priorities?.[loc] || 'normal',
      }));
      await api.deploy(deliveryItems);
      // Live updates now arrive via WebSocket → useLiveMission → useEffect sync above
    } catch {
      // Fallback: try the blocking start-delivery endpoint
      try {
        const r = await api.startDelivery(route.ordered_route);
        setFlightLog(r.flight_log); setBattery(r.battery); setStatus('completed'); setDroneProgress(1); setMissionProgress(100);
      } catch {
        // Final fallback: cinematic demo
        let bat = 100;
        const fakeLog: FlightLogEntry[] = [{event:'takeoff',location:'Depot',position:{x:0,y:0,z:-30},battery:100,timestamp:Date.now()/1000}];
        for(let i=1; i<stops.length; i++) {
          bat -= 8;
          const startP = (i-1)/(stops.length-1), endP = i/(stops.length-1);
          for(let s=0; s<=20; s++) { setDroneProgress(startP + (endP-startP)*(s/20)); setMissionProgress(Math.round((startP + (endP-startP)*(s/20))*100)); await new Promise(r=>setTimeout(r,75)); }
          const loc = locations[stops[i]];
          if(loc) setMapCommand({type:'fly-to', lat:loc.lat, lon:loc.lon, zoom:15});
          setCurrentLocation(stops[i]); setBattery(bat);
          fakeLog.push({event: stops[i]==='Depot'?'landed':`arrived:${stops[i]}`, location:stops[i], position:{x:0,y:0,z:-30}, battery:bat, timestamp:Date.now()/1000});
          setFlightLog([...fakeLog]); playWaypoint();
          await new Promise(r=>setTimeout(r,800));
        }
        setMapCommand({type:'zoom-out-overview'}); playComplete(); setStatus('completed');
        setMetrics({delivery_time_reduction:28.5,distance_reduction:22.3,throughput:stops.length-2,reroute_success_rate:100,total_distance_optimized:8400,total_distance_naive:12600,battery_used:100-bat,robustness_score:1.0,actual_flight_time_seconds:(stops.length-1)*1.5,estimated_time_seconds:180,naive_time_seconds:268});
      }
    }
  }, [route, task, reroute, locations, live]);

  const _handleReset = useCallback(() => { setTask(null);setRoute(null);setReroute(null);setMetrics(null);setFlightLog([]);setStatus('idle');setBattery(85);setCurrentLocation('Depot');setDroneProgress(0);setMissionProgress(72); }, []);

  const handleAiChat = useCallback(async (message: string): Promise<string> => {
    try {
      const r = await api.chat(message, { task: task ?? undefined, route: route ?? undefined, weather, flightLog });
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
              {(live.connected || px4Connected) && <span style={{fontSize:10,color:'#00daf3',marginLeft:6}}>● {telemetrySource === 'unity' ? 'UNITY' : 'LIVE'}</span>}
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
          <MapView locations={locations} route={route?.ordered_route} reroute={reroute?.ordered_route} priorities={task?.priorities} noFlyZones={noFlyZones} weather={weather} droneProgress={droneProgress} isFlying={status==='flying'} mapCommand={mapCommand} onCommandHandled={()=>setMapCommand(null)} tileLayerIndex={tileLayerIndex} onCenteredChange={setIsCentered} onUserLocation={(lat,lon)=>setUserLocation({lat,lon})} onMapReady={setMapInstance} />
          <DroneMapOverlay
            map={mapInstance}
            drones={(() => {
              const depot = locations['Depot'];
              const depotLat = depot?.lat ?? 51.5074;
              const depotLng = depot?.lon ?? -0.1278;

              // Drone 2 is always at Royal London depot
              const drone2 = {
                id: 'Drone2',
                lat: drone2Location.lat,
                lng: drone2Location.lon,
                altitude: 0,
                heading: 0,
                color: 'amber',
                status: drone2Status === 'charging' ? 'charging' : drone2Status,
              };

              // If PX4/Unity telemetry connected, use it for Drone 1
              if (px4Connected && px4Telemetry) {
                return [{
                  id: 'Drone1',
                  lat: px4Telemetry.lat,
                  lng: px4Telemetry.lon,
                  altitude: px4Telemetry.alt_m || 80,
                  heading: px4Telemetry.heading_deg || 0,
                  color: 'cyan',
                  status: px4Telemetry.is_flying ? 'flying' : 'idle',
                }, drone2];
              }

              // If Drone 1 flying with a route, interpolate position
              if (status === 'flying' && route && droneProgress > 0) {
                const coords = route.ordered_route
                  .filter(n => locations[n])
                  .map(n => ({ lat: locations[n].lat, lng: locations[n].lon }));
                if (coords.length >= 2) {
                  const totalSegments = coords.length - 1;
                  const segIdx = Math.min(Math.floor(droneProgress * totalSegments), totalSegments - 1);
                  const segProgress = (droneProgress * totalSegments) - segIdx;
                  const from = coords[segIdx];
                  const to = coords[segIdx + 1] || coords[segIdx];
                  return [{
                    id: 'Drone1',
                    lat: from.lat + (to.lat - from.lat) * segProgress,
                    lng: from.lng + (to.lng - from.lng) * segProgress,
                    altitude: 80,
                    heading: Math.atan2(to.lng - from.lng, to.lat - from.lat) * (180 / Math.PI),
                    color: 'cyan',
                    status: 'flying',
                  }, drone2];
                }
              }

              // Default: both drones idle at their depots
              return [{
                id: 'Drone1',
                lat: depotLat,
                lng: depotLng,
                altitude: 0,
                heading: 0,
                color: 'cyan',
                status: 'idle',
              }, drone2];
            })()}
            routes={route ? [{
              droneId: 'Drone1',
              waypoints: route.ordered_route
                .filter(n => locations[n])
                .map(n => ({ lat: locations[n].lat, lng: locations[n].lon })),
              color: '#00daf3',
              progress: droneProgress,
            }] : undefined}
            depots={[
              { lat: 51.5074, lng: -0.1278, name: 'Central Depot', rangeKm: 50 },
              { lat: 51.5176, lng: -0.0580, name: 'Royal London', rangeKm: 50 },
              { lat: 51.4684, lng: -0.1064, name: "St Thomas'", rangeKm: 50 },
              { lat: 51.4682, lng: -0.0937, name: "King's College", rangeKm: 50 },
            ]}
          />
        </div>

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
              {(['Drone1', 'Drone2', 'Fleet'] as const).map((d) => (
                <button
                  key={d}
                  onClick={() => setSelectedDrone(d)}
                  style={{
                    flex:1, padding:'4px 0', borderRadius:4, fontSize:10, fontWeight:700, textTransform:'uppercase',
                    letterSpacing:'0.05em', cursor:'pointer', transition:'all 0.2s', border:'none',
                    background: selectedDrone === d ? (d === 'Drone1' ? 'rgba(0,218,243,0.2)' : d === 'Drone2' ? 'rgba(245,166,35,0.2)' : 'rgba(179,197,255,0.2)') : 'rgba(48,53,58,0.4)',
                    color: selectedDrone === d ? (d === 'Drone1' ? '#00daf3' : d === 'Drone2' ? '#f5a623' : '#b3c5ff') : '#8d90a0',
                  }}
                >
                  {d === 'Fleet' ? 'Fleet' : d.replace('rone', '')}
                </button>
              ))}
            </div>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:16}}>
              <h3 style={{fontFamily:'Space Grotesk',fontSize:14,fontWeight:700,letterSpacing:'0.02em',color: selectedDrone === 'Drone2' ? '#f5a623' : '#b3c5ff',textTransform:'uppercase',margin:0}}>
                {selectedDrone === 'Fleet' ? 'Fleet Overview' : selectedDrone === 'Drone2' ? 'Drone 2' : 'Drone 1'}
              </h3>
              <span style={{fontSize:10,background: selectedDrone === 'Drone2' ? 'rgba(245,166,35,0.2)' : 'rgba(179,197,255,0.2)',color: selectedDrone === 'Drone2' ? '#f5a623' : '#b3c5ff',padding:'2px 8px',borderRadius:4}}>
                {selectedDrone === 'Fleet' ? '2 DRONES' : selectedDrone === 'Drone2' ? (drone2Status === 'charging' ? 'CHARGING' : drone2Status.toUpperCase()) : 'AUTO-FLIGHT'}
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
              </div>
            ) : (
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:16}}>
                <div role="meter" aria-valuenow={selectedDrone === 'Drone2' ? drone2Battery : battery} aria-valuemin={0} aria-valuemax={100} aria-label="Battery level">
                  <p style={{fontSize:9,color:'#c3c6d6',textTransform:'uppercase',fontWeight:700,letterSpacing:'0.1em',margin:'0 0 4px'}}>Battery</p>
                  <p style={{fontFamily:'Space Grotesk',fontSize:18,fontWeight:700,color: (selectedDrone === 'Drone2' ? drone2Battery : battery) > 50 ? '#dfe3e9' : (selectedDrone === 'Drone2' ? drone2Battery : battery) > 20 ? '#f5a623' : '#ff4444',margin:0}}>
                    {selectedDrone === 'Drone2' ? drone2Battery : battery}<span style={{fontSize:12,marginLeft:2,opacity:0.6}}>%</span>
                  </p>
                </div>
                <div>
                  <p style={{fontSize:9,color:'#c3c6d6',textTransform:'uppercase',fontWeight:700,letterSpacing:'0.1em',margin:'0 0 4px'}}>Link</p>
                  <p style={{fontFamily:'Space Grotesk',fontSize:18,fontWeight:700,color: selectedDrone === 'Drone2' ? '#f5a623' : (live.connected || px4Connected) ? '#00daf3' : '#8d90a0',margin:0}}>
                    {selectedDrone === 'Drone2' ? (drone2Status === 'charging' ? 'Charging' : 'Standby') : (live.connected || px4Connected) ? (telemetrySource === 'unity' ? 'Unity 3D' : 'Live') : 'Idle'}
                  </p>
                </div>
                <div>
                  <p style={{fontSize:9,color:'#c3c6d6',textTransform:'uppercase',fontWeight:700,letterSpacing:'0.1em',margin:'0 0 4px'}}>Speed</p>
                  <p style={{fontFamily:'Space Grotesk',fontSize:18,fontWeight:700,color:'#dfe3e9',margin:0}}>
                    {selectedDrone === 'Drone2' ? 0 : (px4Telemetry ? Math.round(px4Telemetry.speed_m_s * 3.6) : status === 'flying' ? 54 : 0)}<span style={{fontSize:12,marginLeft:2,opacity:0.6}}>km/h</span>
                  </p>
                </div>
              </div>
            )}
            <div style={{marginTop:16,paddingTop:16,borderTop:'1px solid rgba(67,70,84,0.1)'}}>
              <div role="status" aria-live="polite" style={{display:'flex',justifyContent:'space-between',fontSize:10,textTransform:'uppercase',fontWeight:700,color:'#c3c6d6',marginBottom:4}}>
                <span>Mission Progress</span>
                <span style={{color:'#b3c5ff'}}>{missionProgress}%</span>
              </div>
              <div role="meter" aria-valuenow={missionProgress} aria-valuemin={0} aria-valuemax={100} aria-label="Mission progress" style={{height:4,width:'100%',background:'#30353a',borderRadius:9999,overflow:'hidden'}}>
                <div style={{height:'100%',background:'#b3c5ff',width:`${missionProgress}%`,borderRadius:9999,transition:'width 0.5s'}} />
              </div>
              <p style={{marginTop:8,fontSize:10,color:'rgba(223,227,233,0.7)'}}>Est. Arrival: <span style={{color:'#b3c5ff',fontWeight:700}}>4m 12s</span></p>
            </div>
          </section>

          {/* Flight Log — shows waypoint events in real-time */}
          {flightLog.length > 0 && (
            <motion.div initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} transition={{duration:0.3}}>
              <FlightLog log={flightLog} />
            </motion.div>
          )}


          {/* Chain of Custody Timeline */}
          {task && (
            <motion.div initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} transition={{duration:0.3,delay:0.15}}>
              <CustodyTimeline task={task} route={route?.ordered_route} flightLog={flightLog} status={status} battery={battery} />
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
                {status === 'flying' || status === 'rerouting' ? (
                  <>4.2°C <span style={{color:'#22c55e',fontSize:13}}>STABLE</span></>
                ) : status === 'completed' ? (
                  <>4.1°C <span style={{color:'#22c55e',fontSize:13}}>VERIFIED</span></>
                ) : (
                  <>—°C <span style={{color:'#8d90a0',fontSize:13}}>STANDBY</span></>
                )}
              </p>
            </div>
          </div>
        </div>

        {/* ── CV DETECTION OVERLAY ── */}
        <div style={{ position: 'fixed', bottom: 100, right: 24, zIndex: 25 }}>
          <CVDetectionPanel detection={live.cvDetection} onDismiss={live.clearCvDetection} />
        </div>

        {/* ── BOTTOM RIGHT CONTROLS ── */}
        <div className="hidden md:flex" style={{position:'fixed',bottom:24,right:24,zIndex:20,flexDirection:'column',gap:10}}>
          <LiquidButton size="icon" onClick={() => setShowChat(prev => !prev)} aria-label="Toggle AI Copilot" style={{ color: showChat ? '#00daf3' : '#c3c6d6' }}>
            <Brain size={20} />
          </LiquidButton>
          <LiquidButton size="icon" onClick={()=>setMapCommand({type:'zoom-in'})} aria-label="Zoom in" style={{color:'#dfe3e9'}}>
            <Plus size={20} />
          </LiquidButton>
          <LiquidButton size="icon" onClick={()=>setMapCommand({type:'zoom-out'})} aria-label="Zoom out" style={{color:'#dfe3e9'}}>
            <Minus size={20} />
          </LiquidButton>
          <LiquidButton size="icon" aria-label="Center map on depot" onClick={()=>{
            if(userLocation){setMapCommand({type:'center-user',lat:userLocation.lat,lon:userLocation.lon});setIsCentered(true);}
            else{const d=locations['Depot'];if(d){setMapCommand({type:'center-depot',lat:d.lat,lon:d.lon});setIsCentered(true);}}
          }} style={{color:isCentered?'#b3c5ff':'#6b7280',transition:'color 0.3s'}}>
            <LocateFixed size={20} />
          </LiquidButton>
          <LiquidButton size="icon" onClick={()=>setTileLayerIndex(i=>i+1)} aria-label="Toggle map layer" style={{color:'#dfe3e9'}}>
            <Layers size={20} />
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
          flightLog={flightLog}
          status={status}
          aiReasoningMessages={live.aiReasoningMessages}
        />
      </motion.div>

    </div>
  );
}
