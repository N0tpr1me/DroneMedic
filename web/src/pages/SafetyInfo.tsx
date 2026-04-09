import { useState, useEffect, useRef } from 'react';
import { motion, useInView } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
  Shield,
  ShieldCheck,
  Eye,
  AlertTriangle,
  MapPin,
  Cpu,
  Wifi,
  Activity,
  Radar,
  Thermometer,
  Navigation,
  Lock,
  FileCheck,
  Siren,
  BatteryCharging,
} from 'lucide-react';
import { InfoPageLayout } from '../components/layout/InfoPageLayout';

const fadeUp = {
  initial: { opacity: 0, y: 20 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true },
};

const SAFETY_STATS = [
  { value: '99.9%', label: 'Flight Stability Rating', icon: Activity },
  { value: '0', label: 'Critical Incidents', icon: ShieldCheck },
  { value: 'Triple', label: 'Redundant Systems', icon: Cpu },
  { value: '24/7', label: 'Safety Monitoring', icon: Radar },
];

const DETECTION_FEATURES = [
  {
    icon: Eye,
    title: 'Neural Network Hazard Detection',
    desc: 'Real-time object classification using onboard ML models. Identifies birds, buildings, power lines, and other aircraft at 200m+ range with 98.7% accuracy.',
  },
  {
    icon: Radar,
    title: 'LiDAR Point Cloud',
    desc: '360-degree environmental mapping updated 10x per second for precise obstacle avoidance. Generates 300,000 points per scan for centimetre-level spatial awareness.',
  },
  {
    icon: Thermometer,
    title: 'Thermal Imaging',
    desc: 'Detects heat signatures for people, animals, and vehicles in the flight path during day and night operations. Ensures safe low-altitude transit over populated areas.',
  },
  {
    icon: Navigation,
    title: 'Predictive Collision Avoidance',
    desc: 'Trajectory prediction algorithms calculate collision probability and initiate evasive manoeuvres 5 seconds before impact. Multi-vector escape path planning in <50ms.',
  },
];

const GEOFENCE_RULES = [
  { text: 'Dynamic no-fly zone enforcement using point-in-polygon checks' },
  { text: 'Automatic route deflection around restricted airspace' },
  { text: 'Hospital helipad coordination for landing clearance' },
  { text: 'Military zone avoidance with real-time updates' },
];

const NO_FLY_ZONES = [
  {
    name: 'Military Zone Alpha',
    desc: 'Restricted military airspace with active radar surveillance. All routes automatically deflected with minimum 500m buffer zone.',
  },
  {
    name: 'Airport Exclusion Zone',
    desc: 'CAA-mandated exclusion perimeter around London City Airport. Drone operations prohibited without explicit ATC clearance.',
  },
];

const REDUNDANCY_SYSTEMS = [
  {
    icon: Cpu,
    title: 'Flight Controllers',
    desc: 'Triple-redundant autopilot with automatic failover. If the primary controller fails, the secondary takes over in <100ms. A tertiary watchdog monitors both and can trigger emergency landing independently.',
  },
  {
    icon: Wifi,
    title: 'Communication',
    desc: 'Dual-link comms (4G LTE primary + 900MHz backup). If both fail, the drone enters autonomous return-to-base mode using pre-cached waypoints and onboard GPS — no ground input required.',
  },
  {
    icon: BatteryCharging,
    title: 'Power Systems',
    desc: 'Dual battery packs with hot-swap capability. Emergency reserve provides 5 minutes of flight time for safe landing. Voltage monitoring triggers return-to-base at 20% remaining capacity.',
  },
];

const COMPLIANCE_ITEMS = [
  {
    icon: FileCheck,
    label: 'UK CAA',
    desc: 'Compliant with CAP 722 for UAS operations, BVLOS authorisation',
  },
  {
    icon: FileCheck,
    label: 'FAA',
    desc: 'Part 107 waiver for medical cargo, Remote ID compliant',
  },
  {
    icon: FileCheck,
    label: 'EASA',
    desc: 'EU drone regulation compliance, C5 class identification',
  },
  {
    icon: Shield,
    label: 'Medical Cargo',
    desc: 'GDP (Good Distribution Practice) certified for pharmaceutical transport',
  },
  {
    icon: Lock,
    label: 'Data Protection',
    desc: 'GDPR compliant telemetry and mission data handling',
  },
];

const INCIDENT_LEVELS = [
  {
    level: 1,
    title: 'Anomaly Detected',
    desc: 'Onboard AI flags deviation from expected flight parameters. Auto-corrective action initiated — heading, altitude, and speed adjustments applied within 200ms.',
    color: 'text-yellow-400',
    border: 'border-yellow-400/30',
    bg: 'bg-yellow-400/5',
  },
  {
    level: 2,
    title: 'System Degradation',
    desc: 'Backup systems engaged. Ground control notified via priority alert channel. Mission continues on backup hardware with reduced operational envelope.',
    color: 'text-orange-400',
    border: 'border-orange-400/30',
    bg: 'bg-orange-400/5',
  },
  {
    level: 3,
    title: 'Critical Failure',
    desc: 'Emergency landing protocol activated. Parachute deployment system armed. Ground team dispatched to predicted landing coordinates with ETA updates.',
    color: 'text-red-400',
    border: 'border-red-400/30',
    bg: 'bg-red-400/5',
  },
  {
    level: 4,
    title: 'Loss of Communication',
    desc: 'Autonomous return-to-base engaged. Pre-programmed safe landing site activated. Onboard transponder broadcasts location on emergency frequency until recovery.',
    color: 'text-red-500',
    border: 'border-red-500/30',
    bg: 'bg-red-500/5',
  },
];

function CountUpValue({ value, className }: { value: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const isInView = useInView(ref, { once: true });
  const [display, setDisplay] = useState('0');

  useEffect(() => {
    if (!isInView) return;

    // Detect numeric-only values vs mixed
    const numericMatch = value.match(/^([\d.]+)(%?)$/);
    if (numericMatch) {
      const target = parseFloat(numericMatch[1]);
      const suffix = numericMatch[2];
      const duration = 1500;
      const steps = 40;
      const stepTime = duration / steps;
      let step = 0;
      const timer = setInterval(() => {
        step++;
        const progress = step / steps;
        // Ease out cubic
        const eased = 1 - Math.pow(1 - progress, 3);
        const current = target * eased;
        if (suffix === '%') {
          setDisplay(current.toFixed(1) + '%');
        } else {
          setDisplay(Math.round(current).toString());
        }
        if (step >= steps) {
          setDisplay(value);
          clearInterval(timer);
        }
      }, stepTime);
      return () => clearInterval(timer);
    }

    // For text values like "Triple" or "24/7", do a typewriter reveal
    const duration = 800;
    const steps = value.length;
    const stepTime = duration / steps;
    let step = 0;
    const timer = setInterval(() => {
      step++;
      setDisplay(value.slice(0, step));
      if (step >= steps) clearInterval(timer);
    }, stepTime);
    return () => clearInterval(timer);
  }, [isInView, value]);

  return (
    <span ref={ref} className={className}>
      {isInView ? display : '0'}
    </span>
  );
}

export function SafetyInfo() {
  const navigate = useNavigate();

  return (
    <InfoPageLayout>
      {/* ── Hero ── */}
      <section className="relative bg-bg py-24 lg:py-32 2xl:py-40 overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: "url('/images/drone-flying.jpg')" }}
        />
        <div className="absolute inset-0 bg-black/85" />
        <div className="relative mx-auto max-w-[1440px] 2xl:max-w-[1800px] px-6 lg:px-20 2xl:px-28 text-center">
          <motion.div {...fadeUp} transition={{ duration: 0.6 }}>
            <div className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-red-400/20 bg-red-400/5 px-4 py-1.5 2xl:px-5 2xl:py-2 text-[11px] 2xl:text-[13px] font-bold uppercase tracking-[0.15em] text-red-400">
              <span className="flex h-2 w-2 2xl:h-2.5 2xl:w-2.5 rounded-full bg-red-400 animate-pulse" />
              Safety First
            </div>
            <h1 className="font-headline text-4xl font-black leading-[1.1] tracking-tight text-on-surface md:text-5xl lg:text-6xl 2xl:text-7xl">
              Safety-First Autonomous<br />Operations
            </h1>
            <p className="mx-auto mt-6 max-w-2xl 2xl:max-w-3xl text-base leading-relaxed text-on-surface-variant md:text-lg 2xl:text-xl">
              A comprehensive safety framework ensuring every mission meets the highest standards of reliability, redundancy, and regulatory compliance — from pre-flight checks to post-landing verification.
            </p>
          </motion.div>
        </div>
      </section>

      {/* ── Safety Overview Stats ── */}
      <section className="bg-surface py-24 lg:py-32 2xl:py-40">
        <div className="mx-auto max-w-[1440px] 2xl:max-w-[1800px] px-6 lg:px-20 2xl:px-28">
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {SAFETY_STATS.map((stat, i) => (
              <motion.div
                key={stat.label}
                {...fadeUp}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                className="rounded-xl bg-surface-container-low p-8 2xl:p-10 border border-outline-variant/10 text-center"
              >
                <stat.icon size={28} className="mx-auto mb-4 text-red-400" />
                <CountUpValue value={stat.value} className="font-headline text-3xl 2xl:text-4xl font-black text-on-surface" />
                <p className="mt-2 text-sm 2xl:text-base leading-relaxed text-on-surface-variant">{stat.label}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Autonomous Detection ── */}
      <section className="bg-bg py-24 lg:py-32 2xl:py-40">
        <div className="mx-auto max-w-[1440px] 2xl:max-w-[1800px] px-6 lg:px-20 2xl:px-28">
          <motion.div {...fadeUp} transition={{ duration: 0.6 }}>
            <h2 className="font-headline text-3xl font-bold tracking-tight text-on-surface md:text-4xl 2xl:text-5xl text-center">
              Computer Vision &amp; Obstacle Avoidance
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-center text-base leading-relaxed text-on-surface-variant 2xl:text-lg">
              Multi-sensor fusion provides 360-degree situational awareness in all conditions.
            </p>
          </motion.div>

          <div className="mt-14 2xl:mt-18 grid gap-6 sm:grid-cols-2">
            {DETECTION_FEATURES.map((feat, i) => (
              <motion.div
                key={feat.title}
                {...fadeUp}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                whileHover={{ scale: 1.02 }}
                className="group rounded-xl bg-surface-container-low p-8 2xl:p-10 border border-outline-variant/10 transition-all duration-300 hover:border-blue-400/30 relative overflow-hidden"
              >
                <div className="absolute top-0 left-0 right-0 h-[3px] bg-blue-400 scale-x-0 group-hover:scale-x-100 transition-transform duration-300 origin-left" />
                <feat.icon size={28} className="mb-4 text-blue-300" />
                <h3 className="font-headline text-lg 2xl:text-xl font-bold text-on-surface">{feat.title}</h3>
                <p className="mt-2 text-sm 2xl:text-base leading-relaxed text-on-surface-variant">{feat.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Geofencing & No-Fly Zones ── */}
      <section className="bg-surface-container-low py-24 lg:py-32 2xl:py-40">
        <div className="mx-auto max-w-[1440px] 2xl:max-w-[1800px] px-6 lg:px-20 2xl:px-28">
          <div className="grid gap-12 lg:grid-cols-2 lg:items-start">
            <motion.div {...fadeUp} transition={{ duration: 0.6 }}>
              <h2 className="font-headline text-3xl font-bold tracking-tight text-on-surface md:text-4xl 2xl:text-5xl">
                Airspace Compliance
              </h2>
              <p className="mt-6 text-base leading-relaxed text-on-surface-variant 2xl:text-lg">
                Every route is validated against live airspace data before and during flight. The geofencing engine uses ray-casting point-in-polygon algorithms to enforce no-fly boundaries with zero tolerance.
              </p>

              <ul className="mt-8 space-y-4">
                {GEOFENCE_RULES.map((rule, i) => (
                  <motion.li
                    key={i}
                    {...fadeUp}
                    transition={{ duration: 0.4, delay: i * 0.08 }}
                    className="flex items-start gap-3"
                  >
                    <ShieldCheck size={18} className="mt-0.5 shrink-0 text-blue-300" />
                    <span className="text-sm 2xl:text-base leading-relaxed text-on-surface-variant">{rule.text}</span>
                  </motion.li>
                ))}
              </ul>
            </motion.div>

            <motion.div {...fadeUp} transition={{ duration: 0.6, delay: 0.15 }}>
              <div className="space-y-4">
                {NO_FLY_ZONES.map((zone) => (
                  <div
                    key={zone.name}
                    className="rounded-xl bg-surface p-6 2xl:p-8 border border-red-400/15"
                  >
                    <div className="flex items-center gap-3 mb-3">
                      <AlertTriangle size={20} className="text-red-400" />
                      <h4 className="font-headline text-base 2xl:text-lg font-bold text-red-400">{zone.name}</h4>
                    </div>
                    <p className="text-sm 2xl:text-base leading-relaxed text-on-surface-variant">{zone.desc}</p>
                  </div>
                ))}

                <div className="rounded-xl bg-surface p-6 2xl:p-8 border border-outline-variant/10">
                  <h4 className="font-headline text-sm 2xl:text-base font-bold text-on-surface mb-3">Route Deflection</h4>
                  <div className="flex items-center gap-3 text-xs 2xl:text-sm text-on-surface-variant">
                    <div className="flex items-center gap-2">
                      <MapPin size={14} className="text-blue-300" />
                      <span>Origin</span>
                    </div>
                    <div className="flex-1 border-t border-dashed border-on-surface-variant/30 relative">
                      <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-surface px-2 text-red-400 font-bold text-[10px] 2xl:text-xs">NO-FLY</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <MapPin size={14} className="text-blue-300" />
                      <span>Destination</span>
                    </div>
                  </div>
                  <p className="mt-3 text-xs 2xl:text-sm text-on-surface-variant leading-relaxed">
                    When a planned route intersects a restricted zone, the solver automatically introduces penalty waypoints that deflect the path around the boundary while minimising additional distance.
                  </p>
                </div>
              </div>

              <motion.div
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.8, delay: 0.3 }}
                className="mt-4"
              >
                <img
                  src="/images/london-skyline.jpg"
                  alt="London aerial view with Tower Bridge — airspace context"
                  className="w-full rounded-xl border border-outline-variant/10 shadow-lg shadow-black/20"
                />
              </motion.div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ── Redundancy Systems ── */}
      <section className="bg-bg py-24 lg:py-32 2xl:py-40">
        <div className="mx-auto max-w-[1440px] 2xl:max-w-[1800px] px-6 lg:px-20 2xl:px-28">
          <motion.div {...fadeUp} transition={{ duration: 0.6 }}>
            <h2 className="font-headline text-3xl font-bold tracking-tight text-on-surface md:text-4xl 2xl:text-5xl text-center">
              Multi-Layer Redundancy
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-center text-base leading-relaxed text-on-surface-variant 2xl:text-lg">
              Every critical system has at least one independent backup. No single point of failure.
            </p>
          </motion.div>

          <style>{`@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>
          <div className="mt-14 2xl:mt-18 grid gap-6 lg:grid-cols-3">
            {REDUNDANCY_SYSTEMS.map((system, i) => (
              <motion.div
                key={system.title}
                {...fadeUp}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                className="group relative rounded-xl bg-surface-container-low p-8 2xl:p-10 border border-outline-variant/10 overflow-hidden"
              >
                <div
                  className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
                  style={{
                    background: 'linear-gradient(105deg, transparent 40%, rgba(96, 165, 250, 0.06) 45%, rgba(96, 165, 250, 0.12) 50%, rgba(96, 165, 250, 0.06) 55%, transparent 60%)',
                    backgroundSize: '200% 100%',
                    animation: 'shimmer 1.5s ease-in-out infinite',
                  }}
                />
                <system.icon size={32} className="relative mb-5 text-blue-300" />
                <h3 className="relative font-headline text-xl 2xl:text-2xl font-bold text-on-surface">{system.title}</h3>
                <p className="relative mt-3 text-sm 2xl:text-base leading-relaxed text-on-surface-variant">{system.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Regulatory Compliance ── */}
      <section className="bg-surface py-24 lg:py-32 2xl:py-40">
        <div className="mx-auto max-w-[1440px] 2xl:max-w-[1800px] px-6 lg:px-20 2xl:px-28">
          <motion.div {...fadeUp} transition={{ duration: 0.6 }}>
            <h2 className="font-headline text-3xl font-bold tracking-tight text-on-surface md:text-4xl 2xl:text-5xl text-center">
              Regulatory Framework
            </h2>
          </motion.div>

          <div className="mt-14 2xl:mt-18 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {COMPLIANCE_ITEMS.map((item, i) => (
              <motion.div
                key={item.label}
                {...fadeUp}
                transition={{ duration: 0.5, delay: i * 0.08 }}
                className="rounded-xl bg-surface-container-low p-6 2xl:p-8 border border-outline-variant/10"
              >
                <div className="flex items-center gap-3 mb-3">
                  <item.icon size={20} className="text-blue-300" />
                  <h4 className="font-headline text-sm 2xl:text-base font-bold text-on-surface">{item.label}</h4>
                </div>
                <p className="text-sm 2xl:text-base leading-relaxed text-on-surface-variant">{item.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Incident Response ── */}
      <section className="bg-bg py-24 lg:py-32 2xl:py-40">
        <div className="mx-auto max-w-[1440px] 2xl:max-w-[1800px] px-6 lg:px-20 2xl:px-28">
          <motion.div {...fadeUp} transition={{ duration: 0.6 }}>
            <h2 className="font-headline text-3xl font-bold tracking-tight text-on-surface md:text-4xl 2xl:text-5xl text-center">
              Emergency Protocols
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-center text-base leading-relaxed text-on-surface-variant 2xl:text-lg">
              Graduated response system escalates automatically based on threat severity.
            </p>
          </motion.div>

          <div className="mt-14 2xl:mt-18 space-y-4">
            {INCIDENT_LEVELS.map((incident, i) => (
              <motion.div
                key={incident.level}
                {...fadeUp}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                className={`relative rounded-xl p-6 2xl:p-8 border ${incident.border} ${incident.bg} overflow-hidden`}
              >
                <motion.div
                  className={`absolute left-0 top-0 bottom-0 w-1 ${incident.color.replace('text-', 'bg-')}`}
                  initial={{ scaleY: 0 }}
                  whileInView={{ scaleY: 1 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.4, delay: i * 0.12 + 0.2, ease: 'easeOut' }}
                  style={{ transformOrigin: 'top' }}
                />
                <div className="flex items-start gap-4 lg:gap-6">
                  <div className={`flex h-10 w-10 2xl:h-12 2xl:w-12 shrink-0 items-center justify-center rounded-lg border ${incident.border} ${incident.bg}`}>
                    <span className={`font-headline text-lg 2xl:text-xl font-black ${incident.color}`}>{incident.level}</span>
                  </div>
                  <div>
                    <div className="flex items-center gap-3">
                      <Siren size={18} className={incident.color} />
                      <h3 className={`font-headline text-lg 2xl:text-xl font-bold ${incident.color}`}>
                        Level {incident.level} &mdash; {incident.title}
                      </h3>
                    </div>
                    <p className="mt-2 text-sm 2xl:text-base leading-relaxed text-on-surface-variant">{incident.desc}</p>
                  </div>
                </div>
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
              Built for Trust. Engineered for Safety.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-on-surface-variant 2xl:text-lg">
              Every system, every sensor, every protocol exists so medical supplies arrive safely — every time.
            </p>
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
