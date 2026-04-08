import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { PlaneTakeoff, Route as RouteIcon, Zap } from 'lucide-react';
import { PromptInputBox } from '@/components/ui/ai-prompt-box';
import { LiquidButton } from '@/components/ui/liquid-glass-button';
import { SideNav } from '../components/layout/SideNav';
import { PageHeader } from '../components/layout/PageHeader';
import { api } from '../lib/api';
import type { Task, Route } from '../lib/api';
import { DEMO_SCENARIO } from '../data/demo-scenario';

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
      content: 'Try: "Deliver O- plasma to Royal London urgently, insulin to Homerton, and defibrillator pads to Whipps Cross"',
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
          setTimeout(() => navigate('/dashboard', { state: { task: currentTask, route: currentRoute } }), 2000);
        } catch (err) {
          console.error('startDelivery failed:', err);
          addMessage({ role: 'assistant', content: 'Drone deployed in demo mode. Redirecting to Live Ops...' });
          setTimeout(() => navigate('/dashboard', { state: { task: currentTask, route: currentRoute } }), 2000);
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
      } catch (err) {
        console.error('computeRoute failed:', err);
        addMessage({ role: 'assistant', content: 'Route computation failed. Please check the backend is running and try again.' });
      }
      setIsLoading(false);
      return;
    }

    // Use conversational AI chat first — it handles typos, clarifying
    // questions, and incomplete requests naturally. Only parse as a
    // structured task when the AI returns a JSON block with locations.
    try {
      const chatRes = await api.chat(input, { task: currentTask ?? undefined, route: currentRoute ?? undefined });
      const reply = chatRes.reply;

      // Check if the AI response contains a structured task (JSON block)
      const jsonMatch = reply.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        try {
          const taskData = JSON.parse(jsonMatch[1]);
          if (taskData.locations && taskData.locations.length > 0) {
            // We got a structured task back — parse it properly
            const res = await api.parseTask(input);
            setCurrentTask(res.task);
            addMessage({
              role: 'assistant',
              content: `Parsed ${res.task.locations.length} delivery locations:\n\n${res.task.locations.map((loc: string) => `• ${loc}${res.task.priorities[loc] === 'high' ? ' (URGENT)' : ''} — ${res.task.supplies[loc] || 'medical supplies'}`).join('\n')}\n\nSay "plan route" or I'll compute the optimal path now.`,
              task: res.task,
            });
            // Auto-plan route
            try {
              const routeRes = await api.computeRoute(res.task.locations, res.task.priorities);
              setCurrentRoute(routeRes.route);
              addMessage({ role: 'assistant', content: `Route optimized: ${routeRes.route.ordered_route.join(' → ')}\n\nDistance: ${routeRes.route.total_distance}m | Time: ${routeRes.route.estimated_time}s | Battery: ${routeRes.route.battery_usage}%\n\nSay "deploy" to launch the drone.`, route: routeRes.route });
            } catch (err) {
              console.error('auto computeRoute failed:', err);
            }
            setIsLoading(false);
            return;
          }
        } catch { /* not valid JSON, show as conversational reply */ }
      }

      // Show as a normal conversational response (clarifying question, suggestion, etc.)
      addMessage({ role: 'assistant', content: reply });
    } catch {
      // Chat failed — fall back to direct parse
      try {
        const res = await api.parseTask(input);
        setCurrentTask(res.task);
        addMessage({
          role: 'assistant',
          content: `Parsed ${res.task.locations.length} delivery locations:\n\n${res.task.locations.map((loc: string) => `• ${loc}${res.task.priorities[loc] === 'high' ? ' (URGENT)' : ''} — ${res.task.supplies[loc] || 'medical supplies'}`).join('\n')}\n\nSay "plan route" or I'll compute the optimal path now.`,
          task: res.task,
        });
        try {
          const routeRes = await api.computeRoute(res.task.locations, res.task.priorities);
          setCurrentRoute(routeRes.route);
          addMessage({ role: 'assistant', content: `Route optimized: ${routeRes.route.ordered_route.join(' → ')}\n\nDistance: ${routeRes.route.total_distance}m | Time: ${routeRes.route.estimated_time}s | Battery: ${routeRes.route.battery_usage}%\n\nSay "deploy" to launch the drone.`, route: routeRes.route });
        } catch (err) {
          console.error('auto computeRoute failed:', err);
        }
      } catch (err) {
        console.error('parseTask failed:', err);
        addMessage({ role: 'assistant', content: 'I\'m having trouble understanding that request. Could you try rephrasing? For example: "Deliver blood to Royal London urgently"' });
      }
    }

    setIsLoading(false);
  };

  return (
    <div style={{ height: '100vh', background: '#0a0f13', display: 'flex', flexDirection: 'column', color: '#dfe3e9', fontFamily: 'Inter, sans-serif' }}>

      {/* Header */}
      <PageHeader title="Mission Planning" icon={PlaneTakeoff} statusVariant={currentRoute ? 'completed' : currentTask ? 'planning' : 'idle'} />

      {/* ═══ LEFT NAV ═══ */}
      <SideNav currentPage="deploy" />

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
                        <RouteIcon size={16} style={{ color: '#00daf3' }} />
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
                          <PlaneTakeoff size={16} />
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
        {/* Demo scenario suggestion chip */}
        {!currentTask && !isLoading && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <button
              onClick={() => handleSend(DEMO_SCENARIO.request)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 14px',
                borderRadius: 9999,
                background: 'rgba(0,218,243,0.08)',
                border: '1px solid rgba(0,218,243,0.25)',
                color: '#00daf3',
                fontSize: 12,
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(0,218,243,0.15)';
                e.currentTarget.style.borderColor = 'rgba(0,218,243,0.4)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(0,218,243,0.08)';
                e.currentTarget.style.borderColor = 'rgba(0,218,243,0.25)';
              }}
            >
              <Zap size={13} />
              Demo: Emergency Blood Delivery
            </button>
          </div>
        )}
        <PromptInputBox
          onSend={(msg) => handleSend(msg)}
          isLoading={isLoading}
          placeholder="Describe your delivery mission..."
        />
      </div>
    </div>
  );
}
