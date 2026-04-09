import { motion } from 'framer-motion';
import {
  ShieldCheck, Lock, MessageSquare, Map, HeartPulse, BadgeCheck,
  Clock, Route, ArrowRight, Stethoscope,
} from 'lucide-react';
import { InfoPageLayout } from '../components/layout/InfoPageLayout';

// ── Animation helpers ──

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, delay: i * 0.08, ease: 'easeOut' as const },
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
    transition: { duration: 0.7, ease: 'easeOut' as const },
  },
};

const pulseNode = {
  hidden: { opacity: 0, scale: 0.95 },
  visible: (i: number) => ({
    opacity: 1,
    scale: 1,
    transition: { duration: 0.4, delay: i * 0.15, ease: 'easeOut' as const },
  }),
};

// ── Data ──

interface CapabilityCard {
  category: string;
  icon: React.ReactNode;
  techs: string[];
}

const CAPABILITIES: CapabilityCard[] = [
  {
    category: 'Certified Airframe',
    icon: <ShieldCheck size={22} className="text-blue-300" />,
    techs: ['Carbon-fiber body', 'Redundant flight controllers', 'Failsafe parachute', 'Weather-rated to 45 km/h winds'],
  },
  {
    category: 'Secure Payload',
    icon: <Lock size={22} className="text-blue-300" />,
    techs: ['Tamper-evident locking', 'Cold-chain capable bay', '15 kg capacity', 'Temperature + humidity logging'],
  },
  {
    category: 'AI Dispatch',
    icon: <MessageSquare size={22} className="text-blue-300" />,
    techs: ['Plain-language requests', 'Priority-based scheduling', 'Automatic re-routing', 'Multi-drone coordination'],
  },
  {
    category: 'Live Tracking',
    icon: <Map size={22} className="text-blue-300" />,
    techs: ['Web + mobile dashboard', 'ETA updates every second', 'Audible mission alerts', 'Delivery photo confirmation'],
  },
  {
    category: 'Clinical Integration',
    icon: <HeartPulse size={22} className="text-blue-300" />,
    techs: ['Works with existing dispatch workflow', 'Secure hospital login', 'Role-based access', 'Audit-ready activity logs'],
  },
  {
    category: 'Safety & Compliance',
    icon: <BadgeCheck size={22} className="text-blue-300" />,
    techs: ['GDPR & HIPAA aligned', 'CAA-approved flight corridors', 'Public safety monitoring', '24/7 human oversight'],
  },
];

interface FaqItem {
  question: string;
  answer: string;
}

const FAQ: FaqItem[] = [
  {
    question: 'How long does an emergency delivery take?',
    answer: 'Most urban deliveries arrive in 8–15 minutes from request to touchdown.',
  },
  {
    question: 'What happens if the weather changes mid-flight?',
    answer: 'The system monitors wind, rain, and visibility continuously and re-routes or safely lands if conditions exceed limits.',
  },
  {
    question: 'Can we carry temperature-sensitive payloads?',
    answer: 'Yes. Payload bays are insulated and temperature-logged for blood, biologics, and vaccines.',
  },
  {
    question: 'Who is in control of the drone?',
    answer: 'A certified human dispatcher authorizes every flight. The drone flies autonomously but a trained operator can intervene at any moment.',
  },
  {
    question: 'Is patient data shared with DroneMedic?',
    answer: 'No. We receive only the destination and payload description. Patient records stay inside your hospital systems.',
  },
  {
    question: 'How do you handle restricted airspace?',
    answer: 'All routes are pre-cleared against UK CAA flight corridors and no-fly zones. Violations are impossible by design.',
  },
];

interface WorkflowCard {
  title: string;
  icon: React.ReactNode;
  description: string;
}

const WORKFLOW: WorkflowCard[] = [
  {
    title: 'Works With Your Dispatch Desk',
    icon: <Stethoscope size={22} className="text-blue-300" />,
    description: 'Staff request deliveries from a web dashboard or mobile device — no new hardware, no specialist training.',
  },
  {
    title: 'Role-Based Access',
    icon: <Lock size={22} className="text-blue-300" />,
    description: 'Doctors, nurses, pharmacy, and admin each get the right level of access. Audit logs for every action.',
  },
  {
    title: 'Onboarding in a Week',
    icon: <Clock size={22} className="text-blue-300" />,
    description: 'Our team handles site surveys, landing pad setup, and staff training. First mission within seven days of go-live.',
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
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage: `linear-gradient(to right, var(--color-bg) 40%, transparent 100%), url(/images/hospital.jpg)`,
            backgroundSize: 'cover',
            backgroundPosition: 'right center',
            opacity: 0.25,
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
              <Stethoscope size={14} />
              How It Works
            </motion.div>

            <motion.h1
              variants={fadeUp}
              custom={1}
              className="font-headline text-4xl font-black leading-[1.1] tracking-tight text-on-surface md:text-5xl lg:text-6xl 2xl:text-7xl"
            >
              Minutes That{' '}
              <span className="text-blue-300">Save Lives</span>
            </motion.h1>

            <motion.p
              variants={fadeUp}
              custom={2}
              className="mt-6 max-w-2xl text-lg leading-relaxed text-on-surface-variant 2xl:text-xl"
            >
              From the moment your staff describes a delivery, our platform plans,
              flies, and tracks it for you. Here&apos;s what happens end-to-end —
              no engineering background required.
            </motion.p>
          </motion.div>
        </div>
      </section>

      {/* ── 2. Delivery Workflow ── */}
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
              From Request to Delivery
            </motion.h2>

            <motion.p
              variants={fadeUp}
              custom={1}
              className="mt-4 max-w-2xl text-base leading-relaxed text-on-surface-variant 2xl:text-lg"
            >
              Every mission follows the same simple path. You describe what&apos;s
              needed; we handle everything from routing to landing, with human
              oversight at every step.
            </motion.p>

            <motion.div
              variants={fadeUp}
              custom={2}
              className="mt-12 rounded-xl border border-outline-variant/10 bg-surface-container-low p-8 2xl:p-10"
            >
              <div className="mb-4 text-xs font-bold uppercase tracking-[0.12em] text-on-surface-variant">
                Delivery Workflow
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <FlowNode label="Request" sub="Plain English" accent index={0} />
                <FlowArrow />
                <FlowNode label="Understand" sub="AI interprets need" accent index={1} />
                <FlowArrow />
                <FlowNode label="Plan" sub="Safest fastest route" index={2} />
                <FlowArrow />
                <FlowNode label="Prepare" sub="Payload & pre-flight" index={3} />
                <FlowArrow />
                <FlowNode label="Fly" sub="Autonomous flight" index={4} />
                <FlowArrow />
                <FlowNode label="Deliver" sub="Confirmed drop" accent index={5} />
              </div>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* ── 3. Every Flight, Fully Equipped ── */}
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
              Every Flight, Fully Equipped
            </motion.h2>

            <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {CAPABILITIES.map((card, i) => (
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

      {/* ── 4. Smart Dispatch, Human Oversight ── */}
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
              Smart Dispatch, Human Oversight
            </motion.h2>

            <div className="mt-12 grid gap-8 lg:grid-cols-2">
              {/* Understands Your Request */}
              <motion.div
                variants={fadeUp}
                custom={1}
                className="rounded-xl bg-surface p-8 2xl:p-10 border border-outline-variant/10"
              >
                <div className="flex items-center gap-3 mb-4">
                  <MessageSquare size={22} className="text-blue-300" />
                  <h3 className="font-headline text-lg font-bold text-on-surface">
                    Understands Your Request
                  </h3>
                </div>
                <p className="text-sm leading-relaxed text-on-surface-variant">
                  Type or speak requests the way your staff already communicate:
                  &quot;Insulin to St. Mary&apos;s, urgent.&quot; The system identifies
                  the destination, supplies, and urgency, then drafts a mission for
                  a dispatcher to confirm — no code, no forms, no training.
                </p>
                <div className="mt-6 space-y-3">
                  <div className="rounded-lg border border-outline-variant/10 bg-surface-container-low p-4 text-sm text-on-surface-variant">
                    <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-on-surface-variant/70">
                      Staff
                    </div>
                    Send 4 units of O-neg to King&apos;s ICU, high priority.
                  </div>
                  <div className="rounded-lg border border-blue-400/20 bg-blue-400/5 p-4 text-sm text-blue-300">
                    <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-blue-300/80">
                      DroneMedic
                    </div>
                    Dispatching to King&apos;s College ICU — ETA 8 min.
                  </div>
                </div>
              </motion.div>

              {/* Always the Safest Route */}
              <motion.div
                variants={fadeUp}
                custom={2}
                className="rounded-xl bg-surface p-8 2xl:p-10 border border-outline-variant/10"
              >
                <div className="flex items-center gap-3 mb-4">
                  <Route size={22} className="text-blue-300" />
                  <h3 className="font-headline text-lg font-bold text-on-surface">
                    Always the Safest Route
                  </h3>
                </div>
                <p className="text-sm leading-relaxed text-on-surface-variant">
                  Every flight automatically avoids restricted airspace, unsafe
                  weather, and other active missions. Urgent deliveries take
                  priority and are dispatched first.
                </p>
                <div className="mt-6 space-y-3">
                  {[
                    { label: 'Average dispatch time', value: '< 30 seconds' },
                    { label: 'Weather re-routes handled', value: 'Automatic' },
                    { label: 'Urgent missions prioritized', value: 'Always first' },
                    { label: 'Simultaneous flights supported', value: 'Multi-drone' },
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

      {/* ── 5. Live Tracking for Your Team ── */}
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
              Live Tracking for Your Team
            </motion.h2>

            <motion.div
              variants={fadeUp}
              custom={1}
              className="mt-12 rounded-xl border border-outline-variant/10 bg-surface-container-low p-8 2xl:p-10"
            >
              <div className="flex flex-wrap items-center justify-center gap-3">
                <FlowNode label="Active Flight" sub="Mission underway" index={0} />
                <FlowArrow />
                <FlowNode label="Live Position" sub="Updated every second" index={1} />
                <FlowArrow />
                <FlowNode label="Secure Uplink" sub="Encrypted channel" index={2} />
                <FlowArrow />
                <FlowNode label="Dispatch Screen" sub="Your control center" accent index={3} />
                <FlowArrow />
                <FlowNode label="Delivery Alert" sub="Confirmed to ward" accent index={4} />
              </div>
            </motion.div>

            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, amount: 0.3 }}
              variants={fadeInUp}
              className="mt-10"
            >
              <div className="relative overflow-hidden rounded-xl border border-outline-variant/10">
                <img
                  src="/images/emergency-medical.jpg"
                  alt="Emergency medical supplies ready for drone dispatch"
                  className="h-[320px] 2xl:h-[420px] w-full object-cover"
                />
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-bg via-bg/30 to-transparent" />
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-bg/60 via-transparent to-transparent" />
                <div className="absolute bottom-6 left-6 2xl:bottom-8 2xl:left-8 max-w-sm">
                  <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-blue-400/30 bg-blue-400/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.15em] text-blue-300">
                    <span className="flex h-1.5 w-1.5 rounded-full bg-blue-300 animate-pulse" />
                    Live Mission
                  </div>
                  <p className="text-sm 2xl:text-base text-on-surface-variant">
                    Staff track every delivery in real time — from liftoff on the helipad to touchdown at the receiving ward.
                  </p>
                </div>
              </div>
            </motion.div>

            <motion.div
              variants={fadeUp}
              custom={2}
              className="mt-8 flex flex-wrap items-center justify-center gap-12 lg:gap-20"
            >
              <TelemetryStat value="1s" label="Position refresh" />
              <TelemetryStat value="24/7" label="Mission monitoring" />
              <TelemetryStat value="End-to-end" label="Encrypted" />
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* ── 6. What Hospitals Ask First ── */}
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
              What Hospitals Ask First
            </motion.h2>

            <motion.p
              variants={fadeUp}
              custom={1}
              className="mt-4 max-w-2xl text-base leading-relaxed text-on-surface-variant 2xl:text-lg"
            >
              The questions we hear most from clinical leadership, compliance, and
              dispatch teams — answered plainly.
            </motion.p>

            <div className="mt-12 grid gap-4 2xl:gap-6 md:grid-cols-2">
              {FAQ.map((item, i) => (
                <motion.div
                  key={item.question}
                  variants={fadeUp}
                  custom={i + 2}
                  className="rounded-xl bg-surface-container-low p-6 2xl:p-8 border border-outline-variant/10"
                >
                  <h3 className="mb-3 font-headline text-base 2xl:text-lg font-bold text-on-surface">
                    {item.question}
                  </h3>
                  <p className="text-sm 2xl:text-base leading-relaxed text-on-surface-variant">
                    {item.answer}
                  </p>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── 7. Fits Your Existing Workflow ── */}
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
              Fits Your Existing Workflow
            </motion.h2>

            <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {WORKFLOW.map((card, i) => (
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
