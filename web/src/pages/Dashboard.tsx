import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Minus, LocateFixed, Layers, Siren, Thermometer, Brain } from 'lucide-react';
import { ChatPanel } from '../components/dashboard/ChatPanel';
import { MapView } from '../components/dashboard/MapView';
import type { MapCommand } from '../components/dashboard/MapView';
import { FlightLog } from '../components/dashboard/FlightLog';
import { WeatherPanel } from '../components/dashboard/WeatherPanel';
import { MetricsPanel } from '../components/dashboard/MetricsPanel';
import { BootSequence } from '../components/dashboard/BootSequence';
import { HudStatus } from '../components/ui/hud-status';
import { LiquidButton } from '@/components/ui/liquid-glass-button';
import { SideNav } from '../components/layout/SideNav';
import { useSoundEffects } from '../hooks/useSoundEffects';
import { useLiveMission } from '../hooks/useLiveMission';
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
  const [showChat, setShowChat] = useState(false);
  const [bootComplete, setBootComplete] = useState(false);
  const [locationsLoaded, setLocationsLoaded] = useState(false);
  const [weatherLoaded, setWeatherLoaded] = useState(false);
  const [noFlyLoaded, setNoFlyLoaded] = useState(false);

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
      // Play sounds on waypoint arrivals
      if (live.flightLog.length > 0) {
        const last = live.flightLog[live.flightLog.length - 1];
        if (last.event.startsWith('arrived:')) playWaypoint();
        if (last.event === 'landed') playComplete();
      }
    }
  }, [live.missionStatus, live.droneProgress, live.missionProgress, live.flightLog]);

  useEffect(() => {
    (async () => {
      try {
        const [l, w, n] = await Promise.all([api.getLocations(), api.getWeather(), api.getNoFlyZones()]);
        setLocations(l.locations); setLocationsLoaded(true);
        setWeather(w.weather); setWeatherLoaded(true);
        setNoFlyZones(n.zones); setNoFlyLoaded(true);
      } catch {
        // Stagger demo data loading for boot sequence effect
        await new Promise(r => setTimeout(r, 600));
        setLocations({
          Depot: { x:0,y:0,z:-30,lat:51.5415,lon:-0.0093,description:'DroneMedic East London Hub — Stratford Logistics Centre' },
          'Royal London': { x:100,y:50,z:-30,lat:51.5185,lon:-0.0590,description:'Royal London Hospital — Dr. Amara Osei, 3 patients awaiting O- plasma' },
          'Homerton': { x:-50,y:150,z:-30,lat:51.5468,lon:-0.0456,description:'Homerton Hospital — Dr. Priya Patel, urgent insulin delivery for 5 diabetic patients' },
          'Newham General': { x:200,y:-30,z:-30,lat:51.5155,lon:0.0285,description:'Newham General Hospital — Dr. James Okonkwo, trauma kit resupply' },
          'Whipps Cross': { x:-100,y:-80,z:-30,lat:51.5690,lon:0.0066,description:'Whipps Cross Hospital — Dr. Sarah Chen, defibrillator pads for cardiac unit' },
        });
        setLocationsLoaded(true);
        await new Promise(r => setTimeout(r, 500));
        const locationNames = ['Depot','Royal London','Homerton','Newham General','Whipps Cross'];
        setWeather(Object.fromEntries(locationNames.map(n=>[n,{
          wind_speed: n === 'Newham General' ? 12 : n === 'Whipps Cross' ? 8 : 3,
          precipitation: n === 'Newham General' ? 2 : 0,
          visibility: n === 'Newham General' ? 5000 : 10000,
          temperature: 14,
          alerts: n === 'Newham General' ? ['High wind warning'] : [],
          flyable: n !== 'Newham General',
          description: n === 'Newham General' ? 'Strong winds, light rain' : n === 'Whipps Cross' ? 'Moderate winds' : 'Clear skies',
        }])));
        setWeatherLoaded(true);
        await new Promise(r => setTimeout(r, 400));
        setNoFlyZones([]);
        setNoFlyLoaded(true);
      }
    })();
  }, []);

  const handleParseTask = useCallback(async (input: string): Promise<Task|null> => {
    try { const r = await api.parseTask(input); setTask(r.task); return r.task; }
    catch { const t:Task = { locations:['Royal London','Homerton','Whipps Cross'], priorities:{'Royal London':'high'}, supplies:{'Royal London':'O- plasma (2 units)','Homerton':'insulin pens (10x)','Whipps Cross':'defibrillator pads'}, constraints:{avoid_zones:[],weather_concern:'',time_sensitive:true} }; setTask(t); return t; }
  }, []);

  const handlePlanRoute = useCallback(async (): Promise<Route|null> => {
    if(!task) return null; setStatus('planning');
    try { const r = await api.computeRoute(task.locations,task.priorities); setRoute(r.route); setReroute(null); setStatus('idle'); return r.route; }
    catch { const r:Route = { ordered_route:['Depot','Royal London','Homerton','Whipps Cross','Depot'], ordered_routes:{Drone1:['Depot','Royal London','Homerton','Whipps Cross','Depot']}, total_distance:8400,estimated_time:180,battery_usage:42,no_fly_violations:[] }; setRoute(r); setReroute(null); setStatus('idle'); return r; }
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
        <div style={{display:'flex',alignItems:'center',gap:32,position:'absolute',left:'50%',transform:'translateX(-50%)'}}>
          <div style={{display:'flex',flexDirection:'column',alignItems:'center'}}>
            <span style={{fontSize:9,textTransform:'uppercase',letterSpacing:'-0.02em',color:'#8d90a0',fontWeight:700}}>Drone Location</span>
            <span style={{fontSize:14,fontFamily:'Space Grotesk',fontWeight:700,color:'#dfe3e9'}}>
              {_currentLocation}
              {live.connected && <span style={{fontSize:10,color:'#00daf3',marginLeft:6}}>● LIVE</span>}
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
          {Object.keys(locations).length > 0 ? (
            <MapView locations={locations} route={route?.ordered_route} reroute={reroute?.ordered_route} priorities={task?.priorities} noFlyZones={noFlyZones} weather={weather} droneProgress={droneProgress} isFlying={status==='flying'} mapCommand={mapCommand} onCommandHandled={()=>setMapCommand(null)} tileLayerIndex={tileLayerIndex} onCenteredChange={setIsCentered} onUserLocation={(lat,lon)=>setUserLocation({lat,lon})} />
          ) : (
            <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100%'}}>
              <div style={{width:32,height:32,border:'2px solid #b3c5ff',borderTop:'2px solid transparent',borderRadius:'50%',animation:'spin 1s linear infinite'}} />
            </div>
          )}
        </div>

        {/* ── RIGHT HUD ── */}
        <div style={{position:'fixed',top:88,right:24,zIndex:20,display:'flex',flexDirection:'column',gap:12,overflowY:'auto'}} className="hud-scrollbar w-[280px] max-h-[calc(100vh-300px)] xl:w-[320px] xl:max-h-[calc(100vh-280px)] 2xl:w-[400px] 2xl:max-h-[calc(100vh-240px)]">
          {/* Drone Status */}
          <section style={{background:'rgba(30,35,40,0.85)',backdropFilter:'blur(24px)',WebkitBackdropFilter:'blur(24px)',borderRadius:8,padding:20,border:'1px solid rgba(67,70,84,0.25)'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:16}}>
              <h3 style={{fontFamily:'Space Grotesk',fontSize:14,fontWeight:700,letterSpacing:'0.02em',color:'#b3c5ff',textTransform:'uppercase',margin:0}}>Drone Status</h3>
              <span style={{fontSize:10,background:'rgba(179,197,255,0.2)',color:'#b3c5ff',padding:'2px 8px',borderRadius:4}}>AUTO-FLIGHT</span>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:16}}>
              <div>
                <p style={{fontSize:9,color:'#c3c6d6',textTransform:'uppercase',fontWeight:700,letterSpacing:'0.1em',margin:'0 0 4px'}}>Battery</p>
                <p style={{fontFamily:'Space Grotesk',fontSize:18,fontWeight:700,color: battery > 50 ? '#dfe3e9' : battery > 20 ? '#f5a623' : '#ff4444',margin:0}}>{battery}<span style={{fontSize:12,marginLeft:2,opacity:0.6}}>%</span></p>
              </div>
              <div>
                <p style={{fontSize:9,color:'#c3c6d6',textTransform:'uppercase',fontWeight:700,letterSpacing:'0.1em',margin:'0 0 4px'}}>Link</p>
                <p style={{fontFamily:'Space Grotesk',fontSize:18,fontWeight:700,color: live.connected ? '#00daf3' : '#8d90a0',margin:0}}>{live.connected ? 'Live' : 'Idle'}</p>
              </div>
              <div>
                <p style={{fontSize:9,color:'#c3c6d6',textTransform:'uppercase',fontWeight:700,letterSpacing:'0.1em',margin:'0 0 4px'}}>Status</p>
                <p style={{fontFamily:'Space Grotesk',fontSize:18,fontWeight:700,color:'#dfe3e9',margin:0}}>{status === 'idle' ? 'Ready' : status === 'flying' ? 'Flying' : status === 'completed' ? 'Done' : status}</p>
              </div>
            </div>
            <div style={{marginTop:16,paddingTop:16,borderTop:'1px solid rgba(67,70,84,0.1)'}}>
              <div style={{display:'flex',justifyContent:'space-between',fontSize:10,textTransform:'uppercase',fontWeight:700,color:'#c3c6d6',marginBottom:4}}>
                <span>Mission Progress</span>
                <span style={{color:'#b3c5ff'}}>{missionProgress}%</span>
              </div>
              <div style={{height:4,width:'100%',background:'#30353a',borderRadius:9999,overflow:'hidden'}}>
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

          {/* Weather Panel */}
          {Object.keys(weather).length > 0 && (
            <motion.div initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} transition={{duration:0.3,delay:0.1}}>
              <WeatherPanel weather={weather} />
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
        <div style={{position:'fixed',bottom:16,left:16,zIndex:20,display:'flex',gap:12}}>
          <div style={{background:'rgba(15,20,24,0.50)',backdropFilter:'blur(20px)',WebkitBackdropFilter:'blur(20px)',padding:'14px 20px',borderRadius:10,border:'1px solid rgba(67,70,84,0.1)',display:'flex',alignItems:'center',gap:14}}>
            <div style={{padding:10,background:'#a40213',borderRadius:8}}>
              <Siren size={22} style={{color:'#ffaea6'}} />
            </div>
            <div>
              <p style={{fontSize:11,textTransform:'uppercase',fontWeight:800,color:'#ffb3ac',letterSpacing:'0.08em',margin:'0 0 4px'}}>Emergency Payload — Royal London</p>
              <p style={{fontFamily:'Space Grotesk',fontSize:17,fontWeight:700,margin:0}}>O- Plasma (2U) <span style={{fontSize:11,color:'#ffb3ac',fontWeight:600}}>• Dr. Osei, 3 patients</span></p>
            </div>
          </div>
          <div style={{background:'rgba(15,20,24,0.50)',backdropFilter:'blur(20px)',WebkitBackdropFilter:'blur(20px)',padding:'14px 20px',borderRadius:10,border:'1px solid rgba(67,70,84,0.1)',display:'flex',alignItems:'center',gap:14}}>
            <div style={{padding:10,background:'rgba(48,53,58,0.6)',borderRadius:8}}>
              <Thermometer size={22} style={{color:'#b3c5ff'}} />
            </div>
            <div>
              <p style={{fontSize:11,textTransform:'uppercase',fontWeight:800,color:'#c3c6d6',letterSpacing:'0.08em',margin:'0 0 4px'}}>Internal Temp</p>
              <p style={{fontFamily:'Space Grotesk',fontSize:17,fontWeight:700,margin:0}}>4.2°C <span style={{color:'#00daf3',fontSize:13}}>STABLE</span></p>
            </div>
          </div>
        </div>

        {/* ── BOTTOM RIGHT CONTROLS ── */}
        <div style={{position:'fixed',bottom:24,right:24,zIndex:20,display:'flex',flexDirection:'column',gap:8}}>
          <LiquidButton size="sm" onClick={() => setShowChat(prev => !prev)} aria-label="Toggle AI Copilot" style={{ color: showChat ? '#00daf3' : '#c3c6d6' }}>
            <Brain size={20} />
          </LiquidButton>
          <LiquidButton onClick={()=>setMapCommand({type:'zoom-in'})} size="icon" style={{color:'#dfe3e9'}}>
            <Plus size={20} />
          </LiquidButton>
          <LiquidButton onClick={()=>setMapCommand({type:'zoom-out'})} size="icon" style={{color:'#dfe3e9'}}>
            <Minus size={20} />
          </LiquidButton>
          <div style={{height:8}} />
          <LiquidButton onClick={()=>{
            if(userLocation){setMapCommand({type:'center-user',lat:userLocation.lat,lon:userLocation.lon});setIsCentered(true);}
            else{const d=locations['Depot'];if(d){setMapCommand({type:'center-depot',lat:d.lat,lon:d.lon});setIsCentered(true);}}
          }} size="icon" style={{color:isCentered?'#b3c5ff':'#6b7280',transition:'color 0.3s'}}>
            <LocateFixed size={20} />
          </LiquidButton>
          <LiquidButton onClick={()=>setTileLayerIndex(i=>i+1)} size="icon" style={{color:'#dfe3e9'}}>
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
        />
      </motion.div>

    </div>
  );
}
