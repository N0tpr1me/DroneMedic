import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowUp, Mic, Package, Route, CloudLightning, Plane, CheckCircle, Brain, Activity } from 'lucide-react';
import type { Task, Route as RouteType, Metrics, FlightLogEntry } from '../../lib/api';
import type { AiReasoningMessage } from '../../hooks/useLiveMission';

// ── Message Types ──

interface ChatMessage {
  id: string;
  type: 'user' | 'ai' | 'system';
  content: string;
  timestamp: Date;
  task?: Task;
  route?: RouteType;
  metrics?: Metrics;
  actions?: ChatAction[];
  flightEvent?: FlightLogEntry;
  isReasoning?: boolean;
  reasoningSeverity?: 'info' | 'success' | 'warning' | 'error';
}

interface ChatAction {
  label: string;
  icon: string;
  variant: 'primary' | 'danger' | 'secondary';
  onClick: () => void;
}

// Suggestion chips shown after AI asks a question
const SUPPLY_CHIPS = ['O-neg Blood', 'Platelets', 'Insulin', 'Surgical Kit', 'Antibiotics', 'Epinephrine'];
const PRIORITY_CHIPS = ['P1 - Immediate', 'P2 - Urgent', 'P3 - Routine'];
const QUANTITY_CHIPS = ['2 units', '4 units', '6 units', '10 units'];

function detectSuggestionChips(aiMessage: string, answered: Set<string>): string[] {
  const lower = aiMessage.toLowerCase();
  // Only show chips when the AI is asking a question, not confirming
  if (!lower.includes('?')) return [];
  if (!answered.has('supply') && (lower.includes('blood type') || lower.includes('what supply') || lower.includes('what do you need') || lower.includes('which supplies') || lower.includes('type of'))) {
    return SUPPLY_CHIPS;
  }
  if (!answered.has('priority') && (lower.includes('priority') || lower.includes('urgency') || lower.includes('how urgent'))) {
    return PRIORITY_CHIPS;
  }
  if (!answered.has('quantity') && (lower.includes('how many') || lower.includes('quantity') || lower.includes('units'))) {
    return QUANTITY_CHIPS;
  }
  return [];
}

// ── Chat Panel Props ──

interface PhysicsNarrationEntry {
  message: string;
  severity: string;
  timestamp: number;
}

interface ChatPanelProps {
  onParseTask: (input: string) => Promise<Task | null>;
  onPlanRoute: () => Promise<RouteType | null>;
  onStartDelivery: () => Promise<void>;
  onSimulateStorm: () => Promise<void>;
  onReset: () => void;
  onAiChat?: (message: string) => Promise<string>;
  task: Task | null;
  route: RouteType | null;
  metrics: Metrics | null;
  flightLog: FlightLogEntry[];
  status: string;
  aiReasoningMessages?: AiReasoningMessage[];
  physicsNarration?: PhysicsNarrationEntry[];
}

export function ChatPanel({
  onParseTask,
  onPlanRoute,
  onStartDelivery,
  onSimulateStorm,
  onReset,
  onAiChat,
  task,
  route,
  metrics,
  flightLog,
  status,
  aiReasoningMessages = [],
  physicsNarration = [],
}: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      type: 'ai',
      content: 'Welcome to DroneMedic Mission Control. Describe your delivery mission in natural language, and I\'ll coordinate the drones.',
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [suggestionChips, setSuggestionChips] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const answeredChipTypes = useRef<Set<string>>(new Set());

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  }, [input]);

  // Watch flight log for new events
  useEffect(() => {
    if (flightLog.length === 0) return;
    const latest = flightLog[flightLog.length - 1];
    const existingIds = messages.map((m) => m.id);
    const eventId = `flight-${flightLog.length}`;
    if (existingIds.includes(eventId)) return;

    const label =
      latest.event === 'takeoff' ? 'Drone taking off from Depot...' :
      latest.event === 'landed' ? 'Drone has landed. Mission complete.' :
      latest.event.startsWith('arrived:') ? `Arrived at ${latest.event.replace('arrived:', '')}. Battery: ${latest.battery.toFixed(0)}%` :
      latest.event === 'rerouted' ? 'Route recalculated — weather avoidance active.' :
      `${latest.event}`;

    setMessages((prev) => [...prev, {
      id: eventId,
      type: 'system',
      content: label,
      timestamp: new Date(),
      flightEvent: latest,
    }]);
  }, [flightLog, messages]);

  // Show metrics when available
  useEffect(() => {
    if (!metrics) return;
    const existingIds = messages.map((m) => m.id);
    if (existingIds.includes('metrics')) return;

    setMessages((prev) => [...prev, {
      id: 'metrics',
      type: 'ai',
      content: `Mission complete! Time saved: ${metrics.delivery_time_reduction.toFixed(1)}%, Distance saved: ${metrics.distance_reduction.toFixed(1)}%, Battery used: ${metrics.battery_used.toFixed(1)}%`,
      timestamp: new Date(),
      metrics,
      actions: [{ label: 'New Mission', icon: 'refresh', variant: 'secondary', onClick: handleReset }],
    }]);
  }, [metrics, messages]);

  // Watch AI reasoning messages from live mission
  const reasoningCountRef = useRef(0);
  useEffect(() => {
    if (aiReasoningMessages.length <= reasoningCountRef.current) return;
    const newMessages = aiReasoningMessages.slice(reasoningCountRef.current);
    reasoningCountRef.current = aiReasoningMessages.length;

    setMessages((prev) => [
      ...prev,
      ...newMessages.map((rm, idx) => ({
        id: `reasoning-${Date.now()}-${idx}`,
        type: 'ai' as const,
        content: rm.message,
        timestamp: new Date(rm.timestamp * 1000),
        isReasoning: true,
        reasoningSeverity: rm.severity,
      })),
    ]);
  }, [aiReasoningMessages]);

  // Watch physics narration events (phase transitions, battery milestones, wind changes)
  const physicsNarrationCountRef = useRef(0);
  useEffect(() => {
    if (physicsNarration.length <= physicsNarrationCountRef.current) return;
    const newEntries = physicsNarration.slice(physicsNarrationCountRef.current);
    physicsNarrationCountRef.current = physicsNarration.length;

    setMessages((prev) => [
      ...prev,
      ...newEntries.map((entry, idx) => ({
        id: `physics-${Date.now()}-${idx}`,
        type: 'system' as const,
        content: entry.message,
        timestamp: new Date(entry.timestamp),
      })),
    ]);
  }, [physicsNarration]);

  const addMessage = (msg: Omit<ChatMessage, 'id' | 'timestamp'>) => {
    setMessages((prev) => [...prev, { ...msg, id: `msg-${Date.now()}`, timestamp: new Date() }]);
  };

  const handleChipClick = (chip: string) => {
    setSuggestionChips([]);
    // Track which category was answered so it doesn't reappear
    if (SUPPLY_CHIPS.includes(chip)) answeredChipTypes.current.add('supply');
    if (PRIORITY_CHIPS.includes(chip)) answeredChipTypes.current.add('priority');
    if (QUANTITY_CHIPS.includes(chip)) answeredChipTypes.current.add('quantity');
    setInput(chip);
    // Auto-send the chip
    setTimeout(() => {
      const fakeInput = chip;
      setInput('');
      addMessage({ type: 'user', content: fakeInput });
      setIsTyping(true);
      // Route through AI chat
      if (onAiChat) {
        onAiChat(fakeInput).then((reply) => {
          setIsTyping(false);
          // Check if AI returned a structured task (JSON block in response)
          const jsonMatch = reply.match(/```json\s*([\s\S]*?)\s*```/);
          if (jsonMatch) {
            try {
              const taskData = JSON.parse(jsonMatch[1]);
              if (taskData.locations) {
                onParseTask(fakeInput).then((parsedTask) => {
                  if (parsedTask) {
                    addMessage({
                      type: 'ai',
                      content: reply.replace(/```json[\s\S]*?```/, '').trim() || `Mission confirmed: ${parsedTask.locations.length} delivery locations ready.`,
                      task: parsedTask,
                      actions: [{ label: 'Plan Route', icon: 'route', variant: 'primary', onClick: handlePlanRoute }],
                    });
                  }
                });
                return;
              }
            } catch { /* not valid JSON, fall through */ }
          }
          const chips = detectSuggestionChips(reply, answeredChipTypes.current);
          setSuggestionChips(chips);
          addMessage({ type: 'ai', content: reply });
        }).catch(() => {
          setIsTyping(false);
          addMessage({ type: 'ai', content: 'Connection issue. Please try again.' });
        });
      }
    }, 50);
  };

  const handleSend = async () => {
    if (!input.trim()) return;
    const userInput = input.trim();
    setInput('');
    setSuggestionChips([]);

    addMessage({ type: 'user', content: userInput });
    setIsTyping(true);

    // Always try AI chat first for conversational flow with follow-ups
    if (onAiChat) {
      try {
        const reply = await onAiChat(userInput);
        setIsTyping(false);

        // Check if AI returned a structured task (JSON block in response)
        const jsonMatch = reply.match(/```json\s*([\s\S]*?)\s*```/);
        if (jsonMatch) {
          try {
            const taskData = JSON.parse(jsonMatch[1]);
            if (taskData.locations) {
              const parsedTask = await onParseTask(userInput);
              if (parsedTask) {
                addMessage({
                  type: 'ai',
                  content: reply.replace(/```json[\s\S]*?```/, '').trim() || `Mission confirmed: ${parsedTask.locations.length} delivery locations ready.`,
                  task: parsedTask,
                  actions: [{ label: 'Plan Route', icon: 'route', variant: 'primary', onClick: handlePlanRoute }],
                });
                return;
              }
            }
          } catch { /* not valid JSON, fall through */ }
        }

        // Detect if AI is asking a follow-up question → show suggestion chips
        const chips = detectSuggestionChips(reply, answeredChipTypes.current);
        setSuggestionChips(chips);

        // Try to parse a task from the user input, then auto-plan the route
        const parsedFromReply = await onParseTask(userInput).catch(() => null);
        if (parsedFromReply) {
          addMessage({ type: 'ai', content: reply, task: parsedFromReply });
          // Small delay so Dashboard state updates with the new task
          await new Promise(r => setTimeout(r, 300));
          await handlePlanRoute();
        } else {
          addMessage({ type: 'ai', content: reply });
        }
        return;
      } catch {
        // AI chat failed, fall back to direct parsing
      }
    }

    // Fallback: direct task parsing
    try {
      const parsedTask = await onParseTask(userInput);
      setIsTyping(false);

      if (parsedTask) {
        addMessage({
          type: 'ai',
          content: `Parsed ${parsedTask.locations.length} delivery locations:`,
          task: parsedTask,
          actions: [
            { label: 'Plan Route', icon: 'route', variant: 'primary', onClick: handlePlanRoute },
          ],
        });
      } else {
        addMessage({ type: 'ai', content: 'I couldn\'t parse that request. Try something like: "Deliver O- blood to Royal London urgently"' });
      }
    } catch {
      setIsTyping(false);
      addMessage({ type: 'ai', content: 'I couldn\'t process that request. Try describing a delivery like: "Deliver O- blood to Royal London urgently"' });
    }
  };

  const handlePlanRoute = async () => {
    setIsTyping(true);
    try {
      const computedRoute = await onPlanRoute();
      setIsTyping(false);
      if (computedRoute) {
        addMessage({
          type: 'ai',
          content: `Route computed: ${computedRoute.ordered_route.join(' → ')}`,
          route: computedRoute,
          actions: [
            { label: 'Deploy Drone', icon: 'flight', variant: 'primary', onClick: handleDeploy },
            { label: 'Simulate Storm', icon: 'storm', variant: 'danger', onClick: handleStorm },
          ],
        });
      }
    } catch {
      setIsTyping(false);
    }
  };

  const handleDeploy = async () => {
    addMessage({ type: 'system', content: 'Initiating drone deployment sequence...' });
    await onStartDelivery();
  };

  const handleStorm = async () => {
    addMessage({ type: 'system', content: 'Simulating severe weather event at Royal London Hospital...' });
    await onSimulateStorm();
  };

  const handleReset = () => {
    onReset();
    reasoningCountRef.current = 0;
    answeredChipTypes.current.clear();
    setMessages([{
      id: 'reset',
      type: 'ai',
      content: 'Mission reset. Ready for new delivery request.',
      timestamp: new Date(),
    }]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="h-full flex flex-col bg-surface-container-lowest/50 border-r border-outline-variant/10">
      {/* Header */}
      <div className="px-5 py-4 border-b border-outline-variant/10">
        <div className="flex items-center gap-2">
          <Brain size={22} className="text-tertiary" />
          <h3 className="font-headline text-sm font-bold text-on-surface uppercase tracking-wider">Mission AI</h3>
        </div>
        <p className="text-[10px] text-on-surface-variant/60 mt-1 uppercase tracking-widest">Intelligent Delivery Coordinator</p>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        <AnimatePresence>
          {messages.map((msg) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className={`flex ${msg.type === 'user' ? 'justify-end' : msg.type === 'system' ? 'justify-center' : 'justify-start'}`}
            >
              {msg.type === 'system' ? (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/3 text-[10px] text-on-surface-variant/60 uppercase tracking-wider">
                  <div className="w-1.5 h-1.5 rounded-full bg-tertiary/50" />
                  {msg.content}
                </div>
              ) : msg.type === 'user' ? (
                <div className="max-w-[85%] px-4 py-3 rounded-2xl rounded-tr-sm bg-primary/15 border border-primary/20 text-sm text-on-surface">
                  {msg.content}
                </div>
              ) : (
                <div className="max-w-[90%] space-y-3">
                  {msg.isReasoning ? (
                    <div className={`flex items-start gap-2.5 px-4 py-3 rounded-2xl rounded-tl-sm border text-sm leading-relaxed ${
                      msg.reasoningSeverity === 'error' ? 'bg-red-500/8 border-red-500/20 text-red-200' :
                      msg.reasoningSeverity === 'warning' ? 'bg-amber-500/8 border-amber-500/20 text-amber-200' :
                      msg.reasoningSeverity === 'success' ? 'bg-emerald-500/8 border-emerald-500/20 text-emerald-200' :
                      'bg-sky-500/8 border-sky-500/20 text-sky-200'
                    }`}>
                      <Activity className={`w-4 h-4 mt-0.5 shrink-0 ${
                        msg.reasoningSeverity === 'error' ? 'text-red-400' :
                        msg.reasoningSeverity === 'warning' ? 'text-amber-400' :
                        msg.reasoningSeverity === 'success' ? 'text-emerald-400' :
                        'text-sky-400'
                      }`} />
                      <span>{msg.content}</span>
                    </div>
                  ) : (
                    <div className="px-4 py-3 rounded-2xl rounded-tl-sm bg-surface-container-high/60 border border-outline-variant/10 text-sm text-on-surface-variant leading-relaxed">
                      {msg.content}
                    </div>
                  )}

                  {/* Parsed task display */}
                  {msg.task && (
                    <div className="px-4 py-3 rounded-xl bg-surface-container/50 border border-outline-variant/10 space-y-2">
                      {msg.task.locations.map((loc) => (
                        <div key={loc} className="flex items-center gap-2 text-xs">
                          <Package className="w-3 h-3 text-tertiary" />
                          <span className="text-on-surface">{loc}</span>
                          {msg.task!.priorities[loc] === 'high' && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-secondary-container/30 text-secondary uppercase font-bold">Urgent</span>
                          )}
                          <span className="text-on-surface-variant/50 ml-auto text-[10px]">{msg.task!.supplies[loc] || 'medical supplies'}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Route display */}
                  {msg.route && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-tertiary/5 border border-tertiary/15 text-xs">
                      <Route className="w-3.5 h-3.5 text-tertiary" />
                      <span className="font-mono text-tertiary">{msg.route.ordered_route.join(' → ')}</span>
                    </div>
                  )}

                  {/* Metrics display */}
                  {msg.metrics && (
                    <div className="grid grid-cols-3 gap-2 px-3 py-3 rounded-lg bg-tertiary/5 border border-tertiary/15">
                      {[
                        { label: 'Time', value: `${msg.metrics.delivery_time_reduction.toFixed(0)}%`, icon: '⏱' },
                        { label: 'Distance', value: `${msg.metrics.distance_reduction.toFixed(0)}%`, icon: '📍' },
                        { label: 'Battery', value: `${msg.metrics.battery_used.toFixed(0)}%`, icon: '🔋' },
                      ].map((s) => (
                        <div key={s.label} className="text-center">
                          <div className="text-sm font-bold text-tertiary">{s.value}</div>
                          <div className="text-[9px] text-on-surface-variant/50 uppercase">{s.label} saved</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Action buttons */}
                  {msg.actions && (
                    <div className="flex gap-2">
                      {msg.actions.map((action) => (
                        <button
                          key={action.label}
                          onClick={action.onClick}
                          className={`
                            flex items-center gap-2 px-3 py-2 rounded-lg text-[11px] uppercase tracking-wider font-semibold cursor-pointer transition-all
                            ${action.variant === 'primary' ? 'bg-primary/15 border border-primary/25 text-primary hover:bg-primary/25' :
                              action.variant === 'danger' ? 'bg-secondary/10 border border-secondary/20 text-secondary hover:bg-secondary/20' :
                              'bg-white/5 border border-white/10 text-on-surface-variant hover:bg-white/10'}
                          `}
                        >
                          {action.icon === 'route' && <Route className="w-3 h-3" />}
                          {action.icon === 'flight' && <Plane className="w-3 h-3" />}
                          {action.icon === 'storm' && <CloudLightning className="w-3 h-3" />}
                          {action.icon === 'refresh' && <CheckCircle className="w-3 h-3" />}
                          {action.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Suggestion chips */}
        {suggestionChips.length > 0 && !isTyping && (
          <motion.div
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-wrap gap-2 px-2 py-1"
          >
            {suggestionChips.map((chip) => (
              <button
                key={chip}
                onClick={() => handleChipClick(chip)}
                className="px-3 py-1.5 rounded-full text-[11px] font-semibold border border-tertiary/25 bg-tertiary/10 text-tertiary hover:bg-tertiary/20 transition-colors cursor-pointer"
              >
                {chip}
              </button>
            ))}
          </motion.div>
        )}

        {/* Typing indicator */}
        {isTyping && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex gap-1 px-4 py-3"
          >
            {[0, 1, 2].map((i) => (
              <motion.div
                key={i}
                animate={{ y: [0, -4, 0] }}
                transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.15 }}
                className="w-1.5 h-1.5 rounded-full bg-tertiary/50"
              />
            ))}
          </motion.div>
        )}
      </div>

      {/* Input area */}
      <div className="px-4 py-4 border-t border-outline-variant/10">
        <div className="flex items-end gap-2 p-2 rounded-2xl border border-outline-variant/15 bg-surface-container-low/50 focus-within:border-primary/30 transition-colors">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              status === 'flying' ? 'Ask about the mission or report an issue...' :
              task && !route ? 'Route ready to plan...' :
              'Describe your delivery mission...'
            }
            disabled={false}
            className="flex-1 bg-transparent text-sm text-on-surface placeholder:text-on-surface-variant/40 resize-none border-none focus:outline-none focus:ring-0 min-h-[56px] max-h-[120px] py-2 px-2 overflow-hidden [&:not(:placeholder-shown)]:overflow-y-auto"
            rows={1}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim()}
            className={`
              shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-all cursor-pointer
              ${input.trim()
                ? 'bg-white text-surface hover:bg-white/90'
                : 'bg-transparent text-on-surface-variant/40'
              }
              disabled:opacity-30 disabled:cursor-not-allowed
            `}
          >
            {input.trim() ? <ArrowUp className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
