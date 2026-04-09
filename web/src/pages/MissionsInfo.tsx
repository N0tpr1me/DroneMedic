import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
  MessageSquare,
  Route,
  Rocket,
  Monitor,
  Brain,
  Tags,
  ListOrdered,
  AlertTriangle,
  Cpu,
  Battery,
  ShieldOff,
  Zap,
  Pill,
  Heart,
  Droplets,
  Truck,
} from 'lucide-react';
import { InfoPageLayout } from '../components/layout/InfoPageLayout';

const fadeUp = {
  initial: { opacity: 0, y: 20 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true },
};

const WORKFLOW_STEPS = [
  {
    num: '01',
    title: 'Describe',
    icon: MessageSquare,
    text: 'Medical staff describe needs in natural language. Claude AI parses locations, supplies, urgency levels, and constraints from free-text input.',
  },
  {
    num: '02',
    title: 'Plan',
    icon: Route,
    text: 'OR-Tools VRP solver optimizes routes in seconds. Accounts for weather conditions, no-fly zones, battery constraints, and delivery priorities.',
  },
  {
    num: '03',
    title: 'Deploy',
    icon: Rocket,
    text: 'Drone launches autonomously from the nearest depot. PX4 autopilot handles takeoff, waypoint navigation, and precision landing.',
  },
  {
    num: '04',
    title: 'Monitor',
    icon: Monitor,
    text: 'Real-time telemetry streams to the dashboard. Track position, battery, ETA, and receive delivery confirmation.',
  },
];

const AI_FEATURES = [
  { icon: Brain, label: 'Entity Extraction', desc: 'Identifies locations, supply types, and quantities from natural text' },
  { icon: Tags, label: 'Priority Classification', desc: 'Assigns urgency levels based on medical context and keywords' },
  { icon: ListOrdered, label: 'Multi-Stop Optimization', desc: 'Batches multiple deliveries into optimal drone routes' },
  { icon: AlertTriangle, label: 'Constraint Detection', desc: 'Recognises weather, no-fly, and timing constraints automatically' },
];

const ROUTE_STATS = [
  { icon: Cpu, title: 'Multi-Drone VRP', desc: 'Coordinate 2+ drones simultaneously' },
  { icon: Zap, title: 'Priority Weighting', desc: 'High-priority destinations appear 70% closer to solver' },
  { icon: Battery, title: 'Battery Constraints', desc: 'Max range ~1,250m per charge cycle' },
  { icon: ShieldOff, title: 'No-Fly Zone Avoidance', desc: 'Automatic penalty-based route deflection' },
];

const MISSION_TYPES = [
  {
    icon: Pill,
    title: 'Emergency Medical Supply',
    desc: 'Rapid delivery of critical medications, epinephrine, and emergency kits. Prioritised above all other missions with sub-15-minute target response times.',
  },
  {
    icon: Heart,
    title: 'Routine Pharmaceutical',
    desc: 'Scheduled distribution of insulin, antibiotics, and prescription refills to clinics. Batched into optimised multi-stop routes for maximum efficiency.',
  },
  {
    icon: Droplets,
    title: 'Blood & Organ Transport',
    desc: 'Temperature-sensitive payloads with strict chain-of-custody tracking. Real-time condition monitoring ensures viability throughout transit.',
  },
  {
    icon: Truck,
    title: 'Disaster Relief',
    desc: 'Coordinated multi-drone sorties delivering first-aid supplies to disaster zones. Adaptive re-routing around dynamic no-fly zones and debris fields.',
  },
];

export function MissionsInfo() {
  const navigate = useNavigate();

  return (
    <InfoPageLayout>
      {/* ── Hero ── */}
      <section className="relative bg-bg py-24 lg:py-32 2xl:py-40 overflow-hidden">
        {/* Background image with dark overlay */}
        <div className="absolute inset-0 z-0">
          <img
            src="/images/drone-flying.jpg"
            alt=""
            className="h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-black/[0.82]" />
        </div>
        <div className="relative z-10 mx-auto max-w-[1440px] 2xl:max-w-[1800px] px-6 lg:px-20 2xl:px-28 text-center">
          <motion.div {...fadeUp} transition={{ duration: 0.6 }}>
            <div className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-tertiary/20 bg-tertiary/5 px-4 py-1.5 2xl:px-5 2xl:py-2 text-[11px] 2xl:text-[13px] font-bold uppercase tracking-[0.15em] text-tertiary">
              <span className="flex h-2 w-2 2xl:h-2.5 2xl:w-2.5 rounded-full bg-tertiary animate-pulse" />
              Mission Intelligence
            </div>
            <h1 className="font-headline text-4xl font-black leading-[1.1] tracking-tight text-on-surface md:text-5xl lg:text-6xl 2xl:text-7xl">
              AI-Powered Mission<br />Coordination
            </h1>
            <p className="mx-auto mt-6 max-w-2xl 2xl:max-w-3xl text-base leading-relaxed text-on-surface-variant md:text-lg 2xl:text-xl">
              DroneMedic uses Claude AI to interpret natural-language requests, OR-Tools to optimise multi-drone routes, and PX4 autopilot to execute autonomous medical supply deliveries across London — all coordinated through a single intelligent pipeline.
            </p>
          </motion.div>
        </div>
      </section>

      {/* ── How Missions Work ── */}
      <section className="bg-surface py-24 lg:py-32 2xl:py-40">
        <div className="mx-auto max-w-[1440px] 2xl:max-w-[1800px] px-6 lg:px-20 2xl:px-28">
          <motion.div {...fadeUp} transition={{ duration: 0.6 }}>
            <h2 className="font-headline text-3xl font-bold tracking-tight text-on-surface md:text-4xl 2xl:text-5xl text-center">
              From Request to Delivery
            </h2>
          </motion.div>

          <div className="mt-14 2xl:mt-18 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {WORKFLOW_STEPS.map((step, i) => (
              <motion.div
                key={step.num}
                {...fadeUp}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                className="rounded-xl bg-surface-container-low p-8 2xl:p-10 border border-outline-variant/10 transition-all duration-300 hover:scale-[1.02] hover:shadow-lg hover:shadow-blue-500/10"
              >
                <div className="mb-4 flex items-center gap-3">
                  <span className="font-headline text-2xl 2xl:text-3xl font-bold text-blue-300 animate-[glowPulse_2s_ease-in-out_infinite]">{step.num}</span>
                  <step.icon size={22} className="text-on-surface-variant" />
                </div>
                <h3 className="font-headline text-lg 2xl:text-xl font-bold text-on-surface">{step.title}</h3>
                <p className="mt-2 text-sm 2xl:text-base leading-relaxed text-on-surface-variant">{step.text}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── AI Mission Coordinator ── */}
      <section className="bg-bg py-24 lg:py-32 2xl:py-40">
        <div className="mx-auto max-w-[1440px] 2xl:max-w-[1800px] px-6 lg:px-20 2xl:px-28">
          <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
            <motion.div {...fadeUp} transition={{ duration: 0.6 }}>
              <h2 className="font-headline text-3xl font-bold tracking-tight text-on-surface md:text-4xl 2xl:text-5xl">
                Natural Language Task Parsing
              </h2>
              <p className="mt-6 text-base leading-relaxed text-on-surface-variant 2xl:text-lg">
                Claude AI interprets free-text instructions like{' '}
                <span className="text-blue-300 font-medium">
                  &ldquo;Send insulin and bandages to St. Mary&apos;s Hospital urgently&rdquo;
                </span>{' '}
                and extracts structured mission parameters — locations, supplies, quantities, urgency levels, and constraints — without requiring medical staff to learn any specialised interface.
              </p>
              <p className="mt-4 text-sm leading-relaxed text-on-surface-variant 2xl:text-base">
                The parser handles ambiguous input gracefully, asking clarifying questions only when critical information is missing, and defaults to safe assumptions for non-critical fields.
              </p>
              <motion.img
                src="/images/medical-supplies.jpg"
                alt="Medical supplies"
                className="mt-8 w-full rounded-xl border border-outline-variant/20"
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.8, delay: 0.2 }}
              />
            </motion.div>

            <motion.div {...fadeUp} transition={{ duration: 0.6, delay: 0.15 }}>
              <div className="grid gap-4 sm:grid-cols-2">
                {AI_FEATURES.map((feat) => (
                  <div
                    key={feat.label}
                    className="rounded-xl bg-surface-container-low p-6 2xl:p-8 border border-outline-variant/10 transition-all duration-300 hover:scale-[1.02] hover:shadow-lg hover:shadow-blue-500/10"
                  >
                    <feat.icon size={24} className="mb-3 text-blue-300" />
                    <h4 className="font-headline text-sm 2xl:text-base font-bold text-on-surface">{feat.label}</h4>
                    <p className="mt-1 text-xs 2xl:text-sm leading-relaxed text-on-surface-variant">{feat.desc}</p>
                  </div>
                ))}
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ── Route Optimization ── */}
      <section className="bg-surface-container-low py-24 lg:py-32 2xl:py-40">
        <div className="mx-auto max-w-[1440px] 2xl:max-w-[1800px] px-6 lg:px-20 2xl:px-28">
          <motion.div {...fadeUp} transition={{ duration: 0.6 }}>
            <h2 className="font-headline text-3xl font-bold tracking-tight text-on-surface md:text-4xl 2xl:text-5xl text-center">
              Intelligent Route Planning
            </h2>
          </motion.div>

          <div className="mt-14 2xl:mt-18 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {ROUTE_STATS.map((stat, i) => (
              <motion.div
                key={stat.title}
                {...fadeUp}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                className="rounded-xl bg-surface p-8 2xl:p-10 border border-outline-variant/10 text-center transition-all duration-300 hover:scale-[1.02] hover:shadow-lg hover:shadow-blue-500/10"
              >
                <stat.icon size={28} className="mx-auto mb-4 text-blue-300" />
                <h3 className="font-headline text-base 2xl:text-lg font-bold text-on-surface">{stat.title}</h3>
                <p className="mt-2 text-sm 2xl:text-base leading-relaxed text-on-surface-variant">{stat.desc}</p>
              </motion.div>
            ))}
          </div>

          <motion.p
            {...fadeUp}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="mx-auto mt-10 max-w-3xl 2xl:max-w-4xl text-center text-sm 2xl:text-base leading-relaxed text-on-surface-variant"
          >
            Google OR-Tools solves the Vehicle Routing Problem with time windows, capacity constraints, and custom penalty matrices. Routes are re-optimised in real time as weather, battery levels, and new urgent requests change the mission landscape.
          </motion.p>
        </div>
      </section>

      {/* ── Mission Types ── */}
      <section className="bg-bg py-24 lg:py-32 2xl:py-40">
        <div className="mx-auto max-w-[1440px] 2xl:max-w-[1800px] px-6 lg:px-20 2xl:px-28">
          <motion.div {...fadeUp} transition={{ duration: 0.6 }}>
            <h2 className="font-headline text-3xl font-bold tracking-tight text-on-surface md:text-4xl 2xl:text-5xl text-center">
              Supported Mission Types
            </h2>
          </motion.div>

          {/* Hospital banner with parallax-like slow scroll */}
          <motion.div
            className="relative mt-10 overflow-hidden rounded-2xl"
            style={{ height: 240 }}
            {...fadeUp}
            transition={{ duration: 0.7, delay: 0.1 }}
          >
            <motion.img
              src="/images/hospital.jpg"
              alt="Hospital interior"
              className="absolute inset-0 h-[130%] w-full object-cover"
              initial={{ y: 0 }}
              whileInView={{ y: -40 }}
              viewport={{ once: false, amount: 0.3 }}
              transition={{ duration: 1.2, ease: 'easeOut' }}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
          </motion.div>

          <div className="mt-10 2xl:mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {MISSION_TYPES.map((mission, i) => (
              <motion.div
                key={mission.title}
                {...fadeUp}
                transition={{ duration: 0.5, delay: i * 0.15 }}
                className="rounded-xl bg-surface-container-low p-8 2xl:p-10 border border-outline-variant/10 transition-all duration-300 hover:scale-[1.02] hover:shadow-lg hover:shadow-blue-500/10"
              >
                <mission.icon size={28} className="mb-4 text-blue-300" />
                <h3 className="font-headline text-lg 2xl:text-xl font-bold text-on-surface">{mission.title}</h3>
                <p className="mt-2 text-sm 2xl:text-base leading-relaxed text-on-surface-variant">{mission.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="bg-surface py-24 lg:py-32 2xl:py-40">
        <div className="mx-auto max-w-[1440px] 2xl:max-w-[1800px] px-6 lg:px-20 2xl:px-28 text-center">
          <motion.div {...fadeUp} transition={{ duration: 0.6 }}>
            <h2 className="font-headline text-3xl font-bold tracking-tight text-on-surface md:text-4xl 2xl:text-5xl">
              Ready to Launch Your First Mission?
            </h2>
            <div className="mt-8">
              <button
                onClick={() => navigate('/login')}
                className="btn-primary-gradient h-12 lg:h-14 2xl:h-16 px-8 lg:px-10 2xl:px-12 rounded-lg text-sm lg:text-base 2xl:text-lg font-bold text-white transition-all hover:shadow-[0_0_30px_rgba(0,81,206,0.4)] hover:scale-105 active:scale-95 cursor-pointer"
              >
                Start Your First Mission
              </button>
            </div>
          </motion.div>
        </div>
      </section>
    </InfoPageLayout>
  );
}
