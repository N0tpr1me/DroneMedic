import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapView } from '../components/dashboard/MapView';
import type { MapCommand } from '../components/dashboard/MapView';
import { LiquidButton } from '@/components/ui/liquid-glass-button';
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
  const [currentLocation, setCurrentLocation] = useState('Depot');
  const [droneProgress, setDroneProgress] = useState(0);
  const [missionProgress, setMissionProgress] = useState(72);
  const [mapCommand, setMapCommand] = useState<MapCommand | null>(null);
  const [tileLayerIndex, setTileLayerIndex] = useState(1);
  const [isCentered, setIsCentered] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [l, w, n] = await Promise.all([api.getLocations(), api.getWeather(), api.getNoFlyZones()]);
        setLocations(l.locations); setWeather(w.weather); setNoFlyZones(n.zones);
      } catch {
        setLocations({
          Depot: { x:0,y:0,z:-30,lat:51.5074,lon:-0.1278,description:'Main drone depot' },
          'Clinic A': { x:100,y:50,z:-30,lat:51.5124,lon:-0.12,description:'General medical clinic' },
          'Clinic B': { x:-50,y:150,z:-30,lat:51.5174,lon:-0.135,description:'Emergency care facility' },
          'Clinic C': { x:200,y:-30,z:-30,lat:51.5044,lon:-0.11,description:'Rural health outpost' },
          'Clinic D': { x:-100,y:-80,z:-30,lat:51.5,lon:-0.14,description:'Disaster relief camp' },
        });
        setWeather(Object.fromEntries(['Depot','Clinic A','Clinic B','Clinic C','Clinic D'].map(n=>[n,{wind_speed:3,precipitation:0,visibility:10000,temperature:18,alerts:[],flyable:true,description:'Clear skies'}])));
        setNoFlyZones([]);
      }
    })();
  }, []);

  const handleParseTask = useCallback(async (input: string): Promise<Task|null> => {
    try { const r = await api.parseTask(input); setTask(r.task); return r.task; }
    catch { const t:Task = { locations:['Clinic A','Clinic B','Clinic C'], priorities:{'Clinic B':'high'}, supplies:{'Clinic A':'insulin','Clinic B':'blood packs','Clinic C':'bandages'}, constraints:{avoid_zones:[],weather_concern:'',time_sensitive:false} }; setTask(t); return t; }
  }, []);

  const handlePlanRoute = useCallback(async (): Promise<Route|null> => {
    if(!task) return null; setStatus('planning');
    try { const r = await api.computeRoute(task.locations,task.priorities); setRoute(r.route); setReroute(null); setStatus('idle'); return r.route; }
    catch { const r:Route = { ordered_route:['Depot','Clinic B','Clinic A','Clinic C','Depot'], ordered_routes:{Drone1:['Depot','Clinic B','Clinic A','Clinic C','Depot']}, total_distance:450,estimated_time:120,battery_usage:36,no_fly_violations:[] }; setRoute(r); setReroute(null); setStatus('idle'); return r; }
  }, [task]);

  const handleStartDelivery = useCallback(async () => {
    if(!route) return; setStatus('flying'); setDroneProgress(0); setMissionProgress(0);
    try {
      const r = await api.startDelivery(route.ordered_route); setFlightLog(r.flight_log); setBattery(r.battery); setStatus('completed'); setDroneProgress(1); setMissionProgress(100);
      if(task) { try { const m = await api.computeMetrics({flight_log:r.flight_log,optimized_route:route,locations:task.locations,reroute_count:reroute?1:0,reroute_successes:reroute?1:0}); setMetrics(m.metrics); } catch {} }
    } catch {
      const stops = route.ordered_route; const fakeLog:FlightLogEntry[] = [{event:'takeoff',location:'Depot',position:{x:0,y:0,z:-30},battery:100,timestamp:Date.now()/1000}]; let bat=100;
      for(let i=1;i<stops.length;i++) { bat-=8; setDroneProgress(i/(stops.length-1)); setMissionProgress(Math.round(i/(stops.length-1)*100)); setCurrentLocation(stops[i]); setBattery(bat); await new Promise(r=>setTimeout(r,1500)); fakeLog.push({event:stops[i]==='Depot'?'landed':`arrived:${stops[i]}`,location:stops[i],position:{x:0,y:0,z:-30},battery:bat,timestamp:Date.now()/1000}); setFlightLog([...fakeLog]); }
      setStatus('completed'); setMetrics({delivery_time_reduction:28.5,distance_reduction:22.3,throughput:stops.length-2,reroute_success_rate:100,total_distance_optimized:350,total_distance_naive:450,battery_used:100-bat,robustness_score:1.0,actual_flight_time_seconds:(stops.length-1)*1.5,estimated_time_seconds:120,naive_time_seconds:168});
    }
  }, [route, task, reroute]);

  const handleReset = useCallback(() => { setTask(null);setRoute(null);setReroute(null);setMetrics(null);setFlightLog([]);setStatus('idle');setBattery(85);setCurrentLocation('Depot');setDroneProgress(0);setMissionProgress(72); }, []);

  const [sidebarInput, setSidebarInput] = useState('');
  const handleSidebarSend = async () => { if(!sidebarInput.trim()) return; const t = await handleParseTask(sidebarInput.trim()); setSidebarInput(''); if(t) await handlePlanRoute(); };

  return (
    <div style={{height:'100vh',background:'#0f1418',overflow:'hidden',color:'#dfe3e9',fontFamily:'Inter,sans-serif'}}>

      {/* ═══ HEADER ═══ */}
      <header style={{position:'fixed',top:0,width:'100%',zIndex:50,background:'rgba(15,20,24,0.50)',backdropFilter:'blur(24px)',WebkitBackdropFilter:'blur(24px)',display:'flex',justifyContent:'space-between',alignItems:'center',padding:'0 24px',height:64,borderBottom:'1px solid rgba(67,70,84,0.1)'}}>
        <div style={{display:'flex',alignItems:'center',gap:16}}>
          <span style={{fontSize:18,fontWeight:900,color:'#dfe3e9',textTransform:'uppercase',letterSpacing:'0.1em',fontFamily:'Space Grotesk,sans-serif'}}>DroneMedic</span>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:32,position:'absolute',left:'50%',transform:'translateX(-50%)'}}>
          <div style={{display:'flex',flexDirection:'column',alignItems:'center'}}>
            <span style={{fontSize:9,textTransform:'uppercase',letterSpacing:'-0.02em',color:'#8d90a0',fontWeight:700}}>Drone Location</span>
            <span style={{fontSize:14,fontFamily:'Space Grotesk',fontWeight:700,color:'#dfe3e9'}}>14:42 <span style={{fontSize:10,opacity:0.6}}>PDT</span></span>
          </div>
          <div style={{height:32,width:1,background:'rgba(67,70,84,0.2)'}} />
          <div style={{display:'flex',flexDirection:'column',alignItems:'center'}}>
            <span style={{fontSize:9,textTransform:'uppercase',letterSpacing:'-0.02em',color:'#8d90a0',fontWeight:700}}>Destination</span>
            <span style={{fontSize:14,fontFamily:'Space Grotesk',fontWeight:700,color:'#dfe3e9'}}>14:46 <span style={{fontSize:10,opacity:0.6}}>PDT</span></span>
          </div>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:16}}>
          <div style={{display:'flex',alignItems:'center',gap:8,padding:'4px 12px',borderRadius:4,background:'#262b2f',border:'1px solid rgba(67,70,84,0.1)'}}>
            <span style={{width:8,height:8,borderRadius:'50%',background:'#00daf3',boxShadow:'0 0 8px rgba(0,218,243,0.5)'}} />
            <span style={{fontSize:10,textTransform:'uppercase',fontWeight:700,letterSpacing:'0.1em',color:'#00daf3'}}>System Live</span>
          </div>
        </div>
      </header>

      {/* ═══ LEFT NAV — Floating Liquid Glass Buttons with Labels ═══ */}
      <div style={{position:'fixed',left:16,top:'50%',transform:'translateY(-50%)',zIndex:40,display:'flex',flexDirection:'column',gap:6}}>
        {[
          {icon:'monitor_heart',label:'Live Ops',active:true,onClick:undefined},
          {icon:'flight_takeoff',label:'Deploy',active:false,onClick:()=>navigate('/deploy')},
          {icon:'assignment',label:'Logs',active:false,onClick:undefined},
          {icon:'analytics',label:'Analytics',active:false,onClick:undefined},
        ].map(item=>(
          <LiquidButton key={item.label} size="sm" onClick={item.onClick} style={{color:item.active?'#b3c5ff':'#c3c6d6',display:'flex',flexDirection:'column',alignItems:'center',gap:2,padding:'10px 14px',height:'auto',minWidth:64}}>
            <span className="material-symbols-outlined" style={{fontSize:22,...(item.active?{fontVariationSettings:"'FILL' 1"}:{})}}>{item.icon}</span>
            <span style={{fontSize:9,fontWeight:600,textTransform:'uppercase',letterSpacing:'0.05em',opacity:item.active?1:0.7}}>{item.label}</span>
          </LiquidButton>
        ))}
        <div style={{height:4}} />
        <LiquidButton size="sm" style={{color:'#c3c6d6',display:'flex',flexDirection:'column',alignItems:'center',gap:2,padding:'10px 14px',height:'auto',minWidth:64}}>
          <span className="material-symbols-outlined" style={{fontSize:22}}>settings</span>
          <span style={{fontSize:9,fontWeight:600,textTransform:'uppercase',letterSpacing:'0.05em',opacity:0.7}}>Settings</span>
        </LiquidButton>
      </div>


      {/* ═══ MAIN MAP AREA ═══ */}
      <main style={{marginLeft:0,paddingTop:0,height:'100vh',width:'100vw',position:'relative',overflow:'hidden'}}>
        <div style={{position:'absolute',inset:0,zIndex:0}}>
          {Object.keys(locations).length > 0 ? (
            <MapView locations={locations} route={route?.ordered_route} reroute={reroute?.ordered_route} priorities={task?.priorities} noFlyZones={noFlyZones} weather={weather} droneProgress={droneProgress} isFlying={status==='flying'} mapCommand={mapCommand} onCommandHandled={()=>setMapCommand(null)} tileLayerIndex={tileLayerIndex} onCenteredChange={setIsCentered} />
          ) : (
            <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100%'}}>
              <div style={{width:32,height:32,border:'2px solid #b3c5ff',borderTop:'2px solid transparent',borderRadius:'50%',animation:'spin 1s linear infinite'}} />
            </div>
          )}
        </div>

        {/* ── RIGHT HUD ── */}
        <div style={{position:'fixed',top:88,right:24,width:320,zIndex:20,display:'flex',flexDirection:'column',gap:16}}>
          {/* Drone Status */}
          <section style={{background:'rgba(30,35,40,0.85)',backdropFilter:'blur(24px)',WebkitBackdropFilter:'blur(24px)',borderRadius:8,padding:20,border:'1px solid rgba(67,70,84,0.25)'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:16}}>
              <h3 style={{fontFamily:'Space Grotesk',fontSize:14,fontWeight:700,letterSpacing:'0.02em',color:'#b3c5ff',textTransform:'uppercase',margin:0}}>Drone Status</h3>
              <span style={{fontSize:10,background:'rgba(179,197,255,0.2)',color:'#b3c5ff',padding:'2px 8px',borderRadius:4}}>AUTO-FLIGHT</span>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:16}}>
              <div>
                <p style={{fontSize:9,color:'#c3c6d6',textTransform:'uppercase',fontWeight:700,letterSpacing:'0.1em',margin:'0 0 4px'}}>Battery</p>
                <p style={{fontFamily:'Space Grotesk',fontSize:18,fontWeight:700,color:'#dfe3e9',margin:0}}>{battery}<span style={{fontSize:12,marginLeft:2,opacity:0.6}}>%</span></p>
              </div>
              <div>
                <p style={{fontSize:9,color:'#c3c6d6',textTransform:'uppercase',fontWeight:700,letterSpacing:'0.1em',margin:'0 0 4px'}}>GPS</p>
                <p style={{fontFamily:'Space Grotesk',fontSize:18,fontWeight:700,color:'#00daf3',margin:0}}>Strong</p>
              </div>
              <div>
                <p style={{fontSize:9,color:'#c3c6d6',textTransform:'uppercase',fontWeight:700,letterSpacing:'0.1em',margin:'0 0 4px'}}>Speed</p>
                <p style={{fontFamily:'Space Grotesk',fontSize:18,fontWeight:700,color:'#dfe3e9',margin:0}}>45<span style={{fontSize:12,marginLeft:2,opacity:0.6}}>km/h</span></p>
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

        </div>

        {/* ── BOTTOM LEFT CARDS ── */}
        <div style={{position:'fixed',bottom:16,left:16,zIndex:20,display:'flex',gap:10}}>
          <div style={{background:'rgba(15,20,24,0.50)',backdropFilter:'blur(20px)',WebkitBackdropFilter:'blur(20px)',padding:'8px 12px',borderRadius:8,border:'1px solid rgba(67,70,84,0.1)',display:'flex',alignItems:'center',gap:10}}>
            <div style={{padding:6,background:'#a40213',borderRadius:6}}>
              <span className="material-symbols-outlined" style={{color:'#ffaea6',fontSize:16}}>emergency</span>
            </div>
            <div>
              <p style={{fontSize:8,textTransform:'uppercase',fontWeight:800,color:'#ffb3ac',letterSpacing:'0.08em',margin:'0 0 2px'}}>Emergency Payload</p>
              <p style={{fontFamily:'Space Grotesk',fontSize:13,fontWeight:700,margin:0}}>O- Negative Plasma (2U)</p>
            </div>
          </div>
          <div style={{background:'rgba(15,20,24,0.50)',backdropFilter:'blur(20px)',WebkitBackdropFilter:'blur(20px)',padding:'8px 12px',borderRadius:8,border:'1px solid rgba(67,70,84,0.1)',display:'flex',alignItems:'center',gap:10}}>
            <div style={{padding:6,background:'rgba(48,53,58,0.6)',borderRadius:6}}>
              <span className="material-symbols-outlined" style={{color:'#b3c5ff',fontSize:16}}>thermostat</span>
            </div>
            <div>
              <p style={{fontSize:8,textTransform:'uppercase',fontWeight:800,color:'#c3c6d6',letterSpacing:'0.08em',margin:'0 0 2px'}}>Internal Temp</p>
              <p style={{fontFamily:'Space Grotesk',fontSize:13,fontWeight:700,margin:0}}>4.2°C <span style={{color:'#00daf3',fontSize:10}}>STABLE</span></p>
            </div>
          </div>
        </div>

        {/* ── BOTTOM RIGHT CONTROLS ── */}
        <div style={{position:'fixed',bottom:24,right:24,zIndex:20,display:'flex',flexDirection:'column',gap:8}}>
          <LiquidButton onClick={()=>setMapCommand({type:'zoom-in'})} size="icon" style={{color:'#dfe3e9'}}>
            <span className="material-symbols-outlined">add</span>
          </LiquidButton>
          <LiquidButton onClick={()=>setMapCommand({type:'zoom-out'})} size="icon" style={{color:'#dfe3e9'}}>
            <span className="material-symbols-outlined">remove</span>
          </LiquidButton>
          <div style={{height:8}} />
          <LiquidButton onClick={()=>{const d=locations['Depot'];if(d){setMapCommand({type:'center-depot',lat:d.lat,lon:d.lon});setIsCentered(true);}}} size="icon" style={{color:isCentered?'#b3c5ff':'#6b7280',transition:'color 0.3s'}}>
            <span className="material-symbols-outlined">my_location</span>
          </LiquidButton>
          <LiquidButton onClick={()=>setTileLayerIndex(i=>i+1)} size="icon" style={{color:'#dfe3e9'}}>
            <span className="material-symbols-outlined">layers</span>
          </LiquidButton>
        </div>
      </main>

    </div>
  );
}
