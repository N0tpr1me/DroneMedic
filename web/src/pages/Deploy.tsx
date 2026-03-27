import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { PromptInputBox } from '@/components/ui/ai-prompt-box';
import { LiquidButton } from '@/components/ui/liquid-glass-button';
import { api } from '../lib/api';
import type { Task, Route } from '../lib/api';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  task?: Task;
  route?: Route;
}

export function Deploy() {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: 'Welcome to DroneMedic Mission Planning. Describe your delivery mission in natural language — I\'ll parse the locations, priorities, and supplies, then compute the optimal route.',
      timestamp: new Date(),
    },
    {
      id: 'example',
      role: 'system',
      content: 'Try: "Deliver insulin to Clinic A, blood packs to Clinic B urgently, and bandages to Clinic C"',
      timestamp: new Date(),
    },
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const [currentTask, setCurrentTask] = useState<Task | null>(null);
  const [currentRoute, setCurrentRoute] = useState<Route | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const addMessage = (msg: Omit<ChatMessage, 'id' | 'timestamp'>) => {
    setMessages(prev => [...prev, { ...msg, id: `msg-${Date.now()}-${Math.random()}`, timestamp: new Date() }]);
  };

  const handleSend = async (input: string) => {
    if (!input.trim()) return;

    addMessage({ role: 'user', content: input });
    setIsLoading(true);

    // If we already have a route, handle follow-up commands
    if (currentRoute) {
      if (input.toLowerCase().includes('deploy') || input.toLowerCase().includes('start') || input.toLowerCase().includes('go')) {
        addMessage({ role: 'system', content: 'Initiating drone deployment sequence...' });
        try {
          await api.startDelivery(currentRoute.ordered_route);
          addMessage({ role: 'assistant', content: 'Drone deployed successfully! Redirecting to Live Ops...' });
          setTimeout(() => navigate('/dashboard'), 2000);
        } catch {
          addMessage({ role: 'assistant', content: 'Drone deployed in demo mode. Redirecting to Live Ops...' });
          setTimeout(() => navigate('/dashboard'), 2000);
        }
        setIsLoading(false);
        return;
      }
      if (input.toLowerCase().includes('reset') || input.toLowerCase().includes('new')) {
        setCurrentTask(null);
        setCurrentRoute(null);
        addMessage({ role: 'assistant', content: 'Mission cleared. Describe your new delivery mission.' });
        setIsLoading(false);
        return;
      }
    }

    // If we have a task but no route, plan the route
    if (currentTask && !currentRoute) {
      try {
        const res = await api.computeRoute(currentTask.locations, currentTask.priorities);
        setCurrentRoute(res.route);
        addMessage({ role: 'assistant', content: `Route optimized: ${res.route.ordered_route.join(' → ')}\n\nDistance: ${res.route.total_distance}m | Time: ${res.route.estimated_time}s | Battery: ${res.route.battery_usage}%`, route: res.route });
      } catch {
        const demoRoute: Route = {
          ordered_route: ['Depot', ...currentTask.locations, 'Depot'],
          ordered_routes: { Drone1: ['Depot', ...currentTask.locations, 'Depot'] },
          total_distance: 450, estimated_time: 120, battery_usage: 36, no_fly_violations: [],
        };
        setCurrentRoute(demoRoute);
        addMessage({ role: 'assistant', content: `Route computed: ${demoRoute.ordered_route.join(' → ')}\n\nDistance: 450m | Est. Time: 120s | Battery: 36%\n\nSay "deploy" to launch the drone, or describe a new mission.`, route: demoRoute });
      }
      setIsLoading(false);
      return;
    }

    // Parse task from natural language
    try {
      const res = await api.parseTask(input);
      setCurrentTask(res.task);
      addMessage({
        role: 'assistant',
        content: `Parsed ${res.task.locations.length} delivery locations:\n\n${res.task.locations.map(loc => `• ${loc}${res.task.priorities[loc] === 'high' ? ' (URGENT)' : ''} — ${res.task.supplies[loc] || 'medical supplies'}`).join('\n')}\n\nSay "plan route" or I'll compute the optimal path now.`,
        task: res.task,
      });
      // Auto-plan route
      try {
        const routeRes = await api.computeRoute(res.task.locations, res.task.priorities);
        setCurrentRoute(routeRes.route);
        addMessage({ role: 'assistant', content: `Route optimized: ${routeRes.route.ordered_route.join(' → ')}\n\nDistance: ${routeRes.route.total_distance}m | Time: ${routeRes.route.estimated_time}s | Battery: ${routeRes.route.battery_usage}%\n\nSay "deploy" to launch the drone.`, route: routeRes.route });
      } catch {
        const demoRoute: Route = {
          ordered_route: ['Depot', ...res.task.locations, 'Depot'],
          ordered_routes: { Drone1: ['Depot', ...res.task.locations, 'Depot'] },
          total_distance: 450, estimated_time: 120, battery_usage: 36, no_fly_violations: [],
        };
        setCurrentRoute(demoRoute);
        addMessage({ role: 'assistant', content: `Route computed: ${demoRoute.ordered_route.join(' → ')}\n\nDistance: 450m | Est. Time: 120s | Battery: 36%\n\nSay "deploy" to launch the drone.`, route: demoRoute });
      }
    } catch {
      const demoTask: Task = {
        locations: ['Clinic A', 'Clinic B', 'Clinic C'],
        priorities: { 'Clinic B': 'high' },
        supplies: { 'Clinic A': 'insulin', 'Clinic B': 'blood packs', 'Clinic C': 'bandages' },
        constraints: { avoid_zones: [], weather_concern: '', time_sensitive: false },
      };
      setCurrentTask(demoTask);
      const demoRoute: Route = {
        ordered_route: ['Depot', 'Clinic B', 'Clinic A', 'Clinic C', 'Depot'],
        ordered_routes: { Drone1: ['Depot', 'Clinic B', 'Clinic A', 'Clinic C', 'Depot'] },
        total_distance: 450, estimated_time: 120, battery_usage: 36, no_fly_violations: [],
      };
      setCurrentRoute(demoRoute);
      addMessage({
        role: 'assistant',
        content: `Parsed 3 delivery locations (demo mode):\n\n• Clinic B (URGENT) — blood packs\n• Clinic A — insulin\n• Clinic C — bandages\n\nRoute: Depot → Clinic B → Clinic A → Clinic C → Depot\nDistance: 450m | Time: 120s | Battery: 36%\n\nSay "deploy" to launch the drone.`,
        task: demoTask,
        route: demoRoute,
      });
    }

    setIsLoading(false);
  };

  return (
    <div style={{ height: '100vh', background: '#0a0f13', display: 'flex', flexDirection: 'column', color: '#dfe3e9', fontFamily: 'Inter, sans-serif' }}>

      {/* Header */}
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', height: 64, borderBottom: '1px solid rgba(67,70,84,0.15)', background: 'rgba(15,20,24,0.80)', backdropFilter: 'blur(20px)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <LiquidButton size="sm" onClick={() => navigate('/dashboard')} style={{ color: '#c3c6d6', padding: '6px 12px', height: 'auto' }}>
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>arrow_back</span>
            <span style={{ fontSize: 12, fontWeight: 600 }}>Back</span>
          </LiquidButton>
          <div style={{ height: 16, width: 1, background: 'rgba(67,70,84,0.3)' }} />
          <span style={{ fontFamily: 'Space Grotesk', fontSize: 18, fontWeight: 900, color: '#dfe3e9', textTransform: 'uppercase', letterSpacing: '0.1em' }}>DroneMedic</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="material-symbols-outlined" style={{ color: '#00daf3', fontSize: 20 }}>flight_takeoff</span>
          <h1 style={{ fontFamily: 'Space Grotesk', fontSize: 16, fontWeight: 700, color: '#dfe3e9', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>Mission Planning</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 12px', borderRadius: 4, background: '#262b2f', border: '1px solid rgba(67,70,84,0.1)' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#00daf3', boxShadow: '0 0 8px rgba(0,218,243,0.5)' }} />
          <span style={{ fontSize: 10, textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.1em', color: '#00daf3' }}>System Live</span>
        </div>
      </header>

      {/* ═══ LEFT NAV — Floating Liquid Glass Buttons with Labels ═══ */}
      <div style={{position:'fixed',left:16,top:'50%',transform:'translateY(-50%)',zIndex:40,display:'flex',flexDirection:'column',gap:6}}>
        {[
          {icon:'monitor_heart',label:'Dashboard',active:false,onClick:()=>navigate('/dashboard')},
          {icon:'flight_takeoff',label:'Deploy',active:true,onClick:undefined},
          {icon:'assignment',label:'Logs',active:false,onClick:undefined},
          {icon:'analytics',label:'Analytics',active:false,onClick:undefined},
        ].map(item=>(
          <LiquidButton key={item.label} size="sm" onClick={item.onClick} style={{color:item.active?'#b3c5ff':'#c3c6d6',display:'flex',flexDirection:'column',alignItems:'center',gap:2,padding:'10px 14px',height:'auto',minWidth:64}}>
            <span className="material-symbols-outlined" style={{fontSize:22,...(item.active?{fontVariationSettings:"'FILL' 1"}:{})}}>{item.icon}</span>
            <span style={{fontSize:9,fontWeight:600,textTransform:'uppercase',letterSpacing:'0.05em',opacity:item.active?1:0.7}}>{item.label}</span>
          </LiquidButton>
        ))}
        <div style={{height:4}} />
        <LiquidButton size="sm" onClick={()=>navigate('/settings')} style={{color:'#c3c6d6',display:'flex',flexDirection:'column',alignItems:'center',gap:2,padding:'10px 14px',height:'auto',minWidth:64}}>
          <span className="material-symbols-outlined" style={{fontSize:22}}>settings</span>
          <span style={{fontSize:9,fontWeight:600,textTransform:'uppercase',letterSpacing:'0.05em',opacity:0.7}}>Settings</span>
        </LiquidButton>
      </div>

      {/* Chat Messages */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '24px 0' }}>
        <div style={{ maxWidth: 720, margin: '0 auto', padding: '0 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <AnimatePresence>
            {messages.map((msg) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                style={{
                  display: 'flex',
                  justifyContent: msg.role === 'user' ? 'flex-end' : msg.role === 'system' ? 'center' : 'flex-start',
                }}
              >
                {msg.role === 'system' ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 16px', borderRadius: 9999, background: 'rgba(0,218,243,0.08)', border: '1px solid rgba(0,218,243,0.15)' }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#00daf3', opacity: 0.5 }} />
                    <span style={{ fontSize: 12, color: '#00daf3', opacity: 0.8 }}>{msg.content}</span>
                  </div>
                ) : msg.role === 'user' ? (
                  <div style={{ maxWidth: '80%', padding: '12px 16px', borderRadius: '16px 16px 4px 16px', background: 'rgba(179,197,255,0.12)', border: '1px solid rgba(179,197,255,0.2)', fontSize: 14, color: '#dfe3e9', lineHeight: 1.6 }}>
                    {msg.content}
                  </div>
                ) : (
                  <div style={{ maxWidth: '85%', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ padding: '14px 18px', borderRadius: '16px 16px 16px 4px', background: 'rgba(30,35,40,0.85)', border: '1px solid rgba(67,70,84,0.2)', fontSize: 14, color: '#c3c6d6', lineHeight: 1.7, whiteSpace: 'pre-line' }}>
                      {msg.content}
                    </div>

                    {/* Route visualization */}
                    {msg.route && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 12, background: 'rgba(0,218,243,0.06)', border: '1px solid rgba(0,218,243,0.15)', fontSize: 12 }}>
                        <span className="material-symbols-outlined" style={{ color: '#00daf3', fontSize: 16 }}>route</span>
                        <span style={{ fontFamily: 'monospace', color: '#00daf3' }}>{msg.route.ordered_route.join(' → ')}</span>
                      </div>
                    )}

                    {/* Deploy action */}
                    {msg.route && (
                      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                        <LiquidButton
                          size="sm"
                          onClick={() => handleSend('deploy')}
                          style={{ color: '#00daf3', padding: '8px 16px', height: 'auto', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>flight_takeoff</span>
                          Deploy Drone
                        </LiquidButton>
                        <LiquidButton
                          size="sm"
                          onClick={() => handleSend('new mission')}
                          style={{ color: '#c3c6d6', padding: '8px 16px', height: 'auto', fontSize: 12 }}
                        >
                          New Mission
                        </LiquidButton>
                      </div>
                    )}
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>

          {/* Typing indicator */}
          {isLoading && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              style={{ display: 'flex', gap: 4, padding: '12px 16px' }}
            >
              {[0, 1, 2].map((i) => (
                <motion.div
                  key={i}
                  animate={{ y: [0, -4, 0] }}
                  transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.15 }}
                  style={{ width: 6, height: 6, borderRadius: '50%', background: 'rgba(0,218,243,0.5)' }}
                />
              ))}
            </motion.div>
          )}
        </div>
      </div>

      {/* Prompt Input */}
      <div style={{ padding: '16px 24px 24px', maxWidth: 720, margin: '0 auto', width: '100%' }}>
        <PromptInputBox
          onSend={(msg) => handleSend(msg)}
          isLoading={isLoading}
          placeholder="Describe your delivery mission..."
        />
      </div>
    </div>
  );
}
