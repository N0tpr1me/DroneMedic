import { motion } from 'framer-motion';
import {
  Cpu, Globe, Database, Radio, Code2, BarChart3,
  ArrowRight, Zap, Brain, Route, Server, Wifi,
  Terminal, Plug, Wrench,
} from 'lucide-react';
import { InfoPageLayout } from '../components/layout/InfoPageLayout';

// ── Animation helpers ──

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, delay: i * 0.08, ease: 'easeOut' },
  }),
};

const stagger = {
  visible: { transition: { staggerChildren: 0.08 } },
};

const fadeInUp = {
  hidden: { opacity: 0, y: 30 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.7, ease: 'easeOut' },
  },
};

const staggerFromLeft = {
  hidden: { opacity: 0, x: -40 },
  visible: (i: number) => ({
    opacity: 1,
    x: 0,
    transition: { duration: 0.45, delay: i * 0.1, ease: 'easeOut' },
  }),
};

const codeBlockFade = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: 0.8, delay: 0.3, ease: 'easeOut' },
  },
};

const pulseNode = {
  hidden: { opacity: 0, scale: 0.95 },
  visible: (i: number) => ({
    opacity: 1,
    scale: 1,
    transition: { duration: 0.4, delay: i * 0.15, ease: 'easeOut' },
  }),
};

// ── Data ──

interface TechCard {
  category: string;
  icon: React.ReactNode;
  techs: string[];
}

const TECH_STACK: TechCard[] = [
  {
    category: 'Frontend',
    icon: <Globe size={22} className="text-blue-300" />,
    techs: ['React 19', 'TypeScript', 'Tailwind CSS', 'Framer Motion', 'Google Maps API'],
  },
  {
    category: 'Backend',
    icon: <Server size={22} className="text-blue-300" />,
    techs: ['FastAPI (Python)', 'WebSocket streaming', 'REST API'],
  },
  {
    category: 'AI Engine',
    icon: <Brain size={22} className="text-blue-300" />,
    techs: ['Claude API (NLP)', 'Google OR-Tools (VRP optimization)'],
  },
  {
    category: 'Simulation',
    icon: <Radio size={22} className="text-blue-300" />,
    techs: ['PX4 SITL', 'Gazebo Harmonic', 'MAVSDK', 'MAVLink MCP'],
  },
  {
    category: 'Data',
    icon: <Database size={22} className="text-blue-300" />,
    techs: ['Supabase (auth + database)', 'Real-time subscriptions'],
  },
  {
    category: 'Visualization',
    icon: <BarChart3 size={22} className="text-blue-300" />,
    techs: ['Deck.gl', 'Three.js', 'Plotly', 'Recharts'],
  },
];

interface Endpoint {
  method: string;
  path: string;
  description: string;
}

const ENDPOINTS: Endpoint[] = [
  { method: 'POST', path: '/api/missions', description: 'Create a new mission' },
  { method: 'GET', path: '/api/missions/:id', description: 'Get mission status' },
  { method: 'GET', path: '/api/fleet', description: 'List all drones and status' },
  { method: 'GET', path: '/api/telemetry/:droneId', description: 'Stream telemetry data' },
  { method: 'POST', path: '/api/route/optimize', description: 'Run VRP optimization' },
];

interface IntegrationCard {
  title: string;
  icon: React.ReactNode;
  description: string;
}

const INTEGRATIONS: IntegrationCard[] = [
  {
    title: 'REST API',
    icon: <Terminal size={22} className="text-blue-300" />,
    description:
      'Standard HTTP endpoints with JSON payloads for mission management, fleet monitoring, and route optimization. Full OpenAPI documentation available.',
  },
  {
    title: 'WebSocket Events',
    icon: <Plug size={22} className="text-blue-300" />,
    description:
      'Real-time bidirectional channel for live telemetry, mission state changes, and safety alerts. Subscribe to specific drone or mission streams.',
  },
  {
    title: 'MCP Tools',
    icon: <Wrench size={22} className="text-blue-300" />,
    description:
      'MAVLink MCP exposes drone control as AI-callable tools: arm, takeoff, goto, land, and return-to-launch. Build autonomous agents that fly drones via natural language.',
  },
];

// ── Flow node component ──

function FlowNode({ label, sub, accent, index = 0 }: { label: string; sub?: string; accent?: boolean; index?: number }) {
  return (
    <motion.div
      variants={pulseNode}
      custom={index}
      className={`rounded-lg border px-4 py-3 text-center text-sm font-medium transition-shadow duration-500 ${
        accent
          ? 'border-blue-400/30 bg-blue-400/10 text-blue-300'
          : 'border-outline-variant/10 bg-surface-container-low text-on-surface'
      }`}
      style={{
        animation: `nodePulse 3s ease-in-out ${index * 0.4}s infinite`,
      }}
    >
      <div>{label}</div>
      {sub && <div className="mt-0.5 text-xs text-on-surface-variant">{sub}</div>}
    </motion.div>
  );
}

function FlowArrow() {
  return (
    <div className="flex items-center justify-center text-on-surface-variant">
      <ArrowRight size={16} />
    </div>
  );
}

// ── Telemetry stat ──

function TelemetryStat({ value, label }: { value: string; label: string }) {
  return (
    <div className="text-center">
      <div className="font-headline text-3xl font-bold text-blue-300">{value}</div>
      <div className="mt-1 text-sm text-on-surface-variant">{label}</div>
    </div>
  );
}

// ── Page ──

export function Technology() {
  return (
    <InfoPageLayout>
      {/* ── Pulse keyframe for flow nodes ── */}
      <style>{`
        @keyframes nodePulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(96, 165, 250, 0); }
          50% { box-shadow: 0 0 12px 2px rgba(96, 165, 250, 0.15); }
        }
      `}</style>

      {/* ── 1. Hero ── */}
      <section className="relative overflow-hidden bg-bg py-24 lg:py-32 2xl:py-40">
        {/* Background image with dark gradient overlay */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage: `linear-gradient(to right, var(--color-bg) 40%, transparent 100%), url(/images/server-room.jpg)`,
            backgroundSize: 'cover',
            backgroundPosition: 'right bottom',
            opacity: 0.2,
          }}
        />
        <div className="relative mx-auto max-w-[1440px] 2xl:max-w-[1800px] px-6 lg:px-20 2xl:px-28">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.3 }}
            variants={stagger}
            className="max-w-3xl"
          >
            <motion.div
              variants={fadeUp}
              custom={0}
              className="mb-6 inline-flex items-center gap-2 rounded-full border border-blue-400/20 bg-blue-400/5 px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.15em] text-blue-300"
            >
              <Cpu size={14} />
              Engineering
            </motion.div>

            <motion.h1
              variants={fadeUp}
              custom={1}
              className="font-headline text-4xl font-black leading-[1.1] tracking-tight text-on-surface md:text-5xl lg:text-6xl 2xl:text-7xl"
            >
              The Technology Behind{' '}
              <span className="text-blue-300">DroneMedic</span>
            </motion.h1>

            <motion.p
              variants={fadeUp}
              custom={2}
              className="mt-6 max-w-2xl text-lg leading-relaxed text-on-surface-variant 2xl:text-xl"
            >
              An integrated platform combining AI-powered coordination, autonomous
              robotics simulation, and real-time telemetry systems to deliver
              life-critical medical supplies when every second counts.
            </motion.p>
          </motion.div>
        </div>
      </section>

      {/* ── 2. Architecture Overview ── */}

      <section className="bg-surface py-24 lg:py-32 2xl:py-40">
        <div className="mx-auto max-w-[1440px] 2xl:max-w-[1800px] px-6 lg:px-20 2xl:px-28">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.2 }}
            variants={stagger}
          >
            <motion.h2
              variants={fadeUp}
              custom={0}
              className="font-headline text-3xl font-bold tracking-tight text-on-surface md:text-4xl 2xl:text-5xl"
            >
              System Architecture
            </motion.h2>

            <motion.p
              variants={fadeUp}
              custom={1}
              className="mt-4 max-w-2xl text-base leading-relaxed text-on-surface-variant 2xl:text-lg"
            >
              DroneMedic uses a layered architecture where each module operates
              independently. Natural language flows through AI coordination into
              deterministic route optimization, then into simulation and live
              monitoring — all connected by event-driven messaging.
            </motion.p>

            {/* Primary pipeline */}
            <motion.div
              variants={fadeUp}
              custom={2}
              className="mt-12 rounded-xl border border-outline-variant/10 bg-surface-container-low p-8 2xl:p-10"
            >
              <div className="mb-4 text-xs font-bold uppercase tracking-[0.12em] text-on-surface-variant">
                Primary Pipeline
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <FlowNode label="User Input" sub="Natural language" accent index={0} />
                <FlowArrow />
                <FlowNode label="Claude LLM" sub="Task parsing" accent index={1} />
                <FlowArrow />
                <FlowNode label="OR-Tools VRP" sub="Route optimization" index={2} />
                <FlowArrow />
                <FlowNode label="FastAPI" sub="Backend API" index={3} />
                <FlowArrow />
                <FlowNode label="WebSocket" sub="Telemetry stream" index={4} />
                <FlowArrow />
                <FlowNode label="React Dashboard" sub="Live monitoring" accent index={5} />
              </div>
            </motion.div>

            {/* Simulation pipeline */}
            <motion.div
              variants={fadeUp}
              custom={3}
              className="mt-6 rounded-xl border border-outline-variant/10 bg-surface-container-low p-8 2xl:p-10"
            >
              <div className="mb-4 text-xs font-bold uppercase tracking-[0.12em] text-on-surface-variant">
                Simulation Pipeline
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <FlowNode label="MAVLink MCP" sub="AI tool interface" accent index={0} />
                <FlowArrow />
                <FlowNode label="PX4 SITL" sub="Autopilot firmware" index={1} />
                <FlowArrow />
                <FlowNode label="Gazebo Harmonic" sub="Physics engine" index={2} />
                <FlowArrow />
                <FlowNode label="MAVSDK" sub="Telemetry bridge" index={3} />
                <FlowArrow />
                <FlowNode label="WebSocket" sub="ws://localhost:8765" index={4} />
              </div>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* ── 3. Tech Stack ── */}
      <section className="bg-bg py-24 lg:py-32 2xl:py-40">
        <div className="mx-auto max-w-[1440px] 2xl:max-w-[1800px] px-6 lg:px-20 2xl:px-28">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.2 }}
            variants={stagger}
          >
            <motion.h2
              variants={fadeUp}
              custom={0}
              className="font-headline text-3xl font-bold tracking-tight text-on-surface md:text-4xl 2xl:text-5xl"
            >
              Built with Best-in-Class Tools
            </motion.h2>

            <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {TECH_STACK.map((card, i) => (
                <motion.div
                  key={card.category}
                  variants={fadeUp}
                  custom={i + 1}
                  whileHover={{
                    scale: 1.02,
                    boxShadow: '0 0 20px 2px rgba(96, 165, 250, 0.15)',
                    borderColor: 'rgba(96, 165, 250, 0.3)',
                  }}
                  transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                  className="rounded-xl bg-surface-container-low p-8 2xl:p-10 border border-outline-variant/10 cursor-default"
                >
                  <div className="flex items-center gap-3 mb-4">
                    {card.icon}
                    <h3 className="font-headline text-lg font-bold text-on-surface">
                      {card.category}
                    </h3>
                  </div>
                  <ul className="space-y-2">
                    {card.techs.map((tech) => (
                      <li
                        key={tech}
                        className="flex items-center gap-2 text-sm text-on-surface-variant"
                      >
                        <span className="h-1 w-1 shrink-0 rounded-full bg-blue-300" />
                        {tech}
                      </li>
                    ))}
                  </ul>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── 4. AI Engine ── */}
      <section className="bg-surface-container-low py-24 lg:py-32 2xl:py-40">
        <div className="mx-auto max-w-[1440px] 2xl:max-w-[1800px] px-6 lg:px-20 2xl:px-28">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.2 }}
            variants={stagger}
          >
            <motion.h2
              variants={fadeUp}
              custom={0}
              className="font-headline text-3xl font-bold tracking-tight text-on-surface md:text-4xl 2xl:text-5xl"
            >
              AI-Powered Intelligence
            </motion.h2>

            <div className="mt-12 grid gap-8 lg:grid-cols-2">
              {/* NLP */}
              <motion.div
                variants={fadeUp}
                custom={1}
                className="rounded-xl bg-surface p-8 2xl:p-10 border border-outline-variant/10"
              >
                <div className="flex items-center gap-3 mb-4">
                  <Brain size={22} className="text-blue-300" />
                  <h3 className="font-headline text-lg font-bold text-on-surface">
                    Natural Language Processing
                  </h3>
                </div>
                <p className="text-sm leading-relaxed text-on-surface-variant">
                  Claude AI parses free-text mission requests into structured JSON
                  with locations, supplies, priorities, and constraints. The task
                  parser extracts intent from natural language like{' '}
                  <span className="text-blue-300">
                    &quot;Send insulin to St. Mary&apos;s Hospital urgently&quot;
                  </span>{' '}
                  and maps it to actionable mission parameters with validated
                  coordinates and supply manifests.
                </p>
                <motion.div
                  initial="hidden"
                  whileInView="visible"
                  viewport={{ once: true }}
                  variants={codeBlockFade}
                  className="mt-6 rounded-lg bg-surface-container-low p-4 font-mono text-xs text-on-surface-variant border border-outline-variant/10"
                >
                  <div className="text-blue-300">// Parsed output</div>
                  <div>{'{'}</div>
                  <div className="pl-4">&quot;destination&quot;: &quot;st_marys_hospital&quot;,</div>
                  <div className="pl-4">&quot;supplies&quot;: [&quot;insulin&quot;, &quot;syringes&quot;],</div>
                  <div className="pl-4">&quot;priority&quot;: &quot;urgent&quot;,</div>
                  <div className="pl-4">&quot;constraints&quot;: {'{'} &quot;avoid_no_fly&quot;: true {'}'}</div>
                  <div>{'}'}</div>
                </motion.div>
              </motion.div>

              {/* Route Optimization */}
              <motion.div
                variants={fadeUp}
                custom={2}
                className="rounded-xl bg-surface p-8 2xl:p-10 border border-outline-variant/10"
              >
                <div className="flex items-center gap-3 mb-4">
                  <Route size={22} className="text-blue-300" />
                  <h3 className="font-headline text-lg font-bold text-on-surface">
                    Route Optimization
                  </h3>
                </div>
                <p className="text-sm leading-relaxed text-on-surface-variant">
                  Google OR-Tools solves the Vehicle Routing Problem with time
                  windows, capacity constraints, and priority weighting. High-priority
                  destinations appear 70% closer to the solver, ensuring urgent
                  deliveries are always dispatched first. The engine accounts for
                  battery drain rates, no-fly zone penalties, and weather adjustments
                  to produce optimal multi-drone routes.
                </p>
                <div className="mt-6 space-y-3">
                  {[
                    { label: 'Priority weighting', value: '0.3 (70% closer)' },
                    { label: 'Battery constraint', value: '0.08%/m drain rate' },
                    { label: 'Max drones', value: '2 (VRP multi-vehicle)' },
                    { label: 'No-fly penalties', value: 'Polygon exclusion zones' },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className="flex items-center justify-between text-sm"
                    >
                      <span className="text-on-surface-variant">{item.label}</span>
                      <span className="font-mono text-xs text-blue-300">{item.value}</span>
                    </div>
                  ))}
                </div>
              </motion.div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── 5. Real-time Telemetry ── */}
      <section className="bg-bg py-24 lg:py-32 2xl:py-40">
        <div className="mx-auto max-w-[1440px] 2xl:max-w-[1800px] px-6 lg:px-20 2xl:px-28">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.2 }}
            variants={stagger}
          >
            <motion.h2
              variants={fadeUp}
              custom={0}
              className="font-headline text-3xl font-bold tracking-tight text-on-surface md:text-4xl 2xl:text-5xl"
            >
              Live Telemetry Pipeline
            </motion.h2>

            {/* Flow diagram */}
            <motion.div
              variants={fadeUp}
              custom={1}
              className="mt-12 rounded-xl border border-outline-variant/10 bg-surface-container-low p-8 2xl:p-10"
            >
              <div className="flex flex-wrap items-center justify-center gap-3">
                <FlowNode label="PX4 Sensors" sub="GPS, IMU, Baro" index={0} />
                <FlowArrow />
                <FlowNode label="MAVLink UDP" sub="Port 14540" index={1} />
                <FlowArrow />
                <FlowNode label="MAVSDK Python" sub="Async wrapper" index={2} />
                <FlowArrow />
                <FlowNode label="WebSocket Bridge" sub="ws://localhost:8765" accent index={3} />
                <FlowArrow />
                <FlowNode label="React Dashboard" sub="Google Maps + 3D" accent index={4} />
              </div>
            </motion.div>

            {/* Control room image */}
            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, amount: 0.3 }}
              variants={fadeInUp}
              className="mt-10"
            >
              <img
                src="/images/control-room.jpg"
                alt="Live telemetry control room dashboard"
                className="w-full rounded-xl border border-outline-variant/10 object-cover"
              />
            </motion.div>

            {/* Stats */}
            <motion.div
              variants={fadeUp}
              custom={2}
              className="mt-8 flex flex-wrap items-center justify-center gap-12 lg:gap-20"
            >
              <TelemetryStat value="<50ms" label="End-to-end latency" />
              <TelemetryStat value="10 Hz" label="Update rate" />
              <TelemetryStat value="TLS" label="Encrypted transport" />
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* ── 6. API Reference ── */}
      <section className="bg-surface py-24 lg:py-32 2xl:py-40">
        <div className="mx-auto max-w-[1440px] 2xl:max-w-[1800px] px-6 lg:px-20 2xl:px-28">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.2 }}
            variants={stagger}
          >
            <motion.h2
              variants={fadeUp}
              custom={0}
              className="font-headline text-3xl font-bold tracking-tight text-on-surface md:text-4xl 2xl:text-5xl"
            >
              REST API Endpoints
            </motion.h2>

            {/* Endpoints table */}
            <motion.div
              variants={fadeUp}
              custom={1}
              className="mt-12 overflow-x-auto rounded-xl border border-outline-variant/10 bg-surface-container-low"
            >
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-outline-variant/10 text-xs font-bold uppercase tracking-[0.1em] text-on-surface-variant">
                    <th className="px-6 py-4">Method</th>
                    <th className="px-6 py-4">Endpoint</th>
                    <th className="px-6 py-4">Description</th>
                  </tr>
                </thead>
                <tbody>
                  {ENDPOINTS.map((ep, i) => (
                    <motion.tr
                      key={`${ep.method}-${ep.path}`}
                      variants={staggerFromLeft}
                      custom={i}
                      initial="hidden"
                      whileInView="visible"
                      viewport={{ once: true }}
                      className="border-b border-outline-variant/5 last:border-0"
                    >
                      <td className="px-6 py-4">
                        <span
                          className={`inline-block rounded px-2 py-0.5 font-mono text-xs font-bold ${
                            ep.method === 'POST'
                              ? 'bg-green-500/10 text-green-400'
                              : 'bg-blue-400/10 text-blue-300'
                          }`}
                        >
                          {ep.method}
                        </span>
                      </td>
                      <td className="px-6 py-4 font-mono text-on-surface">
                        {ep.path}
                      </td>
                      <td className="px-6 py-4 text-on-surface-variant">
                        {ep.description}
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </motion.div>

            {/* Example request */}
            <motion.div variants={fadeUp} custom={2} className="mt-8">
              <div className="mb-3 text-xs font-bold uppercase tracking-[0.12em] text-on-surface-variant">
                Example Request
              </div>
              <motion.div
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                variants={codeBlockFade}
                className="bg-surface-container-low rounded-lg p-6 font-mono text-sm text-on-surface-variant border border-outline-variant/10"
              >
                <div className="text-blue-300">POST /api/missions</div>
                <div className="mt-2">{'{'}</div>
                <div className="pl-4">
                  &quot;description&quot;: &quot;Send insulin to St. Mary&apos;s Hospital&quot;,
                </div>
                <div className="pl-4">&quot;priority&quot;: &quot;urgent&quot;,</div>
                <div className="pl-4">
                  &quot;supplies&quot;: [&quot;insulin&quot;, &quot;syringes&quot;],
                </div>
                <div className="pl-4">
                  &quot;destination&quot;: &quot;st_marys_hospital&quot;
                </div>
                <div>{'}'}</div>
              </motion.div>
            </motion.div>

            {/* Example response */}
            <motion.div variants={fadeUp} custom={3} className="mt-6">
              <div className="mb-3 text-xs font-bold uppercase tracking-[0.12em] text-on-surface-variant">
                Example Response
              </div>
              <motion.div
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                variants={codeBlockFade}
                className="bg-surface-container-low rounded-lg p-6 font-mono text-sm text-on-surface-variant border border-outline-variant/10"
              >
                <div>{'{'}</div>
                <div className="pl-4">&quot;success&quot;: <span className="text-green-400">true</span>,</div>
                <div className="pl-4">&quot;data&quot;: {'{'}</div>
                <div className="pl-8">&quot;mission_id&quot;: &quot;MSN-0087&quot;,</div>
                <div className="pl-8">&quot;status&quot;: &quot;dispatched&quot;,</div>
                <div className="pl-8">&quot;drone_id&quot;: &quot;Drone1&quot;,</div>
                <div className="pl-8">&quot;eta_seconds&quot;: 142</div>
                <div className="pl-4">{'}'},</div>
                <div className="pl-4">&quot;error&quot;: <span className="text-on-surface-variant">null</span></div>
                <div>{'}'}</div>
              </motion.div>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* ── 7. Developer Integration ── */}
      <section className="bg-bg py-24 lg:py-32 2xl:py-40">
        <div className="mx-auto max-w-[1440px] 2xl:max-w-[1800px] px-6 lg:px-20 2xl:px-28">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.2 }}
            variants={stagger}
          >
            <motion.h2
              variants={fadeUp}
              custom={0}
              className="font-headline text-3xl font-bold tracking-tight text-on-surface md:text-4xl 2xl:text-5xl"
            >
              Developer-Friendly Integration
            </motion.h2>

            <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {INTEGRATIONS.map((card, i) => (
                <motion.div
                  key={card.title}
                  variants={fadeUp}
                  custom={i + 1}
                  className="rounded-xl bg-surface-container-low p-8 2xl:p-10 border border-outline-variant/10"
                >
                  <div className="flex items-center gap-3 mb-4">
                    {card.icon}
                    <h3 className="font-headline text-lg font-bold text-on-surface">
                      {card.title}
                    </h3>
                  </div>
                  <p className="text-sm leading-relaxed text-on-surface-variant">
                    {card.description}
                  </p>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>
      </section>
    </InfoPageLayout>
  );
}
