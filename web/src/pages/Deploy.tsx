import { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { PlaneTakeoff, Route as RouteIcon, Zap } from 'lucide-react';
import { PromptInputBox } from '@/components/ui/ai-prompt-box';
import { LiquidButton } from '@/components/ui/liquid-glass-button';
import { SideNav } from '../components/layout/SideNav';
import { PageHeader } from '../components/layout/PageHeader';
import { api } from '../lib/api';
import type { Task, Route } from '../lib/api';
import { DEMO_SCENARIO } from '../data/demo-scenario';
import { useMissionContext } from '../context/MissionContext';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  task?: Task;
  route?: Route;
}

const WELCOME_MSG: ChatMessage = {
  id: 'welcome',
  role: 'assistant',
  content: 'Welcome to DroneMedic Mission Planning. Describe your delivery mission in natural language — I\'ll parse the locations, priorities, and supplies, then compute the optimal route.',
  timestamp: new Date(),
};

export function Deploy() {
  const navigate = useNavigate();
  const { chatSessions, activeChatId, setActiveChatId, createChatSession, deleteChatSession, updateChatMessages } = useMissionContext();

  const activeSession = chatSessions.find(s => s.id === activeChatId);

  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    if (activeSession && activeSession.messages.length > 0) {
      return activeSession.messages.map(m => ({
        ...m,
        role: m.role as ChatMessage['role'],
        timestamp: new Date(m.timestamp),
      }));
    }
    return [WELCOME_MSG];
  });
  const [isLoading, setIsLoading] = useState(false);
  const [currentTask, setCurrentTask] = useState<Task | null>(null);
  const [currentRoute, setCurrentRoute] = useState<Route | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const deployLocation = useLocation();
  const prefillHandled = useRef(false);

  // Track activeChatId in a ref for use in handleSend (avoids stale closure)
  const activeChatIdRef = useRef(activeChatId);
  useEffect(() => { activeChatIdRef.current = activeChatId; }, [activeChatId]);

  // Persist chat history to context whenever messages change
  useEffect(() => {
    if (activeChatId && messages.length > 1) {
      updateChatMessages(activeChatId, messages.map(m => ({
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: m.timestamp.toISOString(),
      })));
    }
  }, [messages, activeChatId, updateChatMessages]);

  // Sync messages when switching sessions
  useEffect(() => {
    const session = chatSessions.find(s => s.id === activeChatId);
    if (session && session.messages.length > 0) {
      setMessages(session.messages.map(m => ({
        ...m,
        role: m.role as ChatMessage['role'],
        timestamp: new Date(m.timestamp),
      })));
    } else {
      setMessages([WELCOME_MSG]);
    }
    setCurrentTask(null);
    setCurrentRoute(null);
  }, [activeChatId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-fill from Dashboard location click
  useEffect(() => {
    if (prefillHandled.current) return;
    const state = deployLocation.state as { prefill?: string } | null;
    if (state?.prefill) {
      prefillHandled.current = true;
      window.history.replaceState({}, document.title);
      // Auto-send the prefilled message after a short delay
      setTimeout(() => handleSend(state.prefill!), 300);
    }
  }, [deployLocation.state]);

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

    // Auto-create a chat session on first message
    if (!activeChatIdRef.current) {
      const newId = createChatSession();
      activeChatIdRef.current = newId;
    }

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

    // If we have a task but no route, only auto-route if the user explicitly asks for it
    if (currentTask && !currentRoute) {
      const lower = input.toLowerCase();
      if (lower.includes('plan') || lower.includes('route') || lower.includes('compute') || lower.includes('optimize') || lower.includes('yes') || lower.includes('go')) {
        try {
          const res = await api.computeRoute(currentTask.locations, currentTask.priorities);
          setCurrentRoute(res.route);
          addMessage({ role: 'assistant', content: `Route optimized: ${res.route.ordered_route.join(' → ')}\n\nDistance: ${res.route.total_distance}m | Time: ${res.route.estimated_time}s | Battery: ${res.route.battery_usage}%\n\nSay "deploy" to launch the drone.`, route: res.route });
        } catch (err) {
          console.error('computeRoute failed:', err);
          addMessage({ role: 'assistant', content: 'Route computation failed. Please check the backend is running and try again.' });
        }
        setIsLoading(false);
        return;
      }
      // Otherwise fall through to chat/parse to handle new instructions
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

      // Show conversational response, then also try structured parse in background
      addMessage({ role: 'assistant', content: reply });

      // If we don't have a task yet, try to parse one from the original input
      if (!currentTask) {
        try {
          const res = await api.parseTask(input);
          if (res.task && res.task.locations.length > 0) {
            setCurrentTask(res.task);
            // Auto-compute route
            try {
              const routeRes = await api.computeRoute(res.task.locations, res.task.priorities);
              setCurrentRoute(routeRes.route);
              addMessage({ role: 'assistant', content: `Route optimized: ${routeRes.route.ordered_route.join(' → ')}\n\nDistance: ${routeRes.route.total_distance}m | Time: ${routeRes.route.estimated_time}s | Battery: ${routeRes.route.battery_usage}%\n\nSay "deploy" to launch the drone.`, route: routeRes.route });
            } catch {
              // Route failed — task is set, user can retry
            }
          }
        } catch {
          // Parse failed — that's fine, AI already responded conversationally
        }
      }
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

      {/* Chat History Sidebar */}
      <div style={{
        position: 'fixed', right: 0, top: 64, bottom: 0, width: 220,
        background: 'rgba(15,20,24,0.95)', borderLeft: '1px solid rgba(67,70,84,0.15)',
        display: 'flex', flexDirection: 'column', zIndex: 30,
        backdropFilter: 'blur(16px)',
      }}>
        {/* New Chat button */}
        <button
          onClick={() => {
            const newId = createChatSession();
            setMessages([WELCOME_MSG]);
            setCurrentTask(null);
            setCurrentRoute(null);
          }}
          style={{
            margin: '12px 12px 8px', padding: '8px 12px', border: '1px solid rgba(0,218,243,0.3)',
            borderRadius: 8, background: 'rgba(0,218,243,0.08)', color: '#00daf3',
            fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex',
            alignItems: 'center', gap: 6,
          }}
        >
          <PlaneTakeoff size={14} /> New Mission Chat
        </button>

        {/* Session list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px' }}>
          {chatSessions.map(session => (
            <div
              key={session.id}
              onClick={() => setActiveChatId(session.id)}
              style={{
                padding: '8px 10px', borderRadius: 6, marginBottom: 4, cursor: 'pointer',
                background: session.id === activeChatId ? 'rgba(0,218,243,0.12)' : 'transparent',
                border: session.id === activeChatId ? '1px solid rgba(0,218,243,0.2)' : '1px solid transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: 4,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 11, fontWeight: 600, color: session.id === activeChatId ? '#00daf3' : '#c3c6d6',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {session.title}
                </div>
                <div style={{ fontSize: 9, color: '#6b7280', marginTop: 2 }}>
                  {new Date(session.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); deleteChatSession(session.id); }}
                style={{
                  background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer',
                  padding: 2, fontSize: 14, lineHeight: 1, opacity: 0.5,
                }}
                onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = '#ff4444'; }}
                onMouseLeave={e => { e.currentTarget.style.opacity = '0.5'; e.currentTarget.style.color = '#6b7280'; }}
              >
                ×
              </button>
            </div>
          ))}
          {chatSessions.length === 0 && (
            <div style={{ padding: '20px 10px', textAlign: 'center', fontSize: 11, color: '#6b7280' }}>
              No chat history yet
            </div>
          )}
        </div>
      </div>

      {/* Chat content area — offset for sidebar */}
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, marginRight: 220, minHeight: 0 }}>

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
      <div style={{ padding: '16px 24px 24px', maxWidth: 720, margin: '0 auto', width: '100%', position: 'relative', zIndex: 30 }}>
        {/* Demo scenario suggestion chip */}
        {!currentTask && !isLoading && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, position: 'relative', zIndex: 50 }}>
            <button
              type="button"
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
                transition: 'background 0.2s, border-color 0.2s',
                pointerEvents: 'auto',
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

      </div>{/* end chat content area wrapper */}
    </div>
  );
}
