import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Radar, Thermometer, Eye, Satellite, ShieldCheck, Weight, Snowflake, Vibrate, ScanBarcode, Layers, Umbrella, Clock, DollarSign, Leaf } from 'lucide-react';
import { InfoPageLayout } from '../components/layout/InfoPageLayout';

// ── Animation Helpers ──

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

// ── Specification Data ──

const SPECS: readonly { label: string; value: string }[] = [
  { label: 'Payload Capacity', value: '15 kg' },
  { label: 'Mission Range', value: '120 km' },
  { label: 'Max Speed', value: '72 km/h (45 mph)' },
  { label: 'Flight Endurance', value: '45 minutes' },
  { label: 'Operating Altitude', value: '50-400 ft AGL' },
  { label: 'Wind Tolerance', value: 'Up to 35 km/h' },
  { label: 'IP Rating', value: 'IP54 (dust/splash resistant)' },
  { label: 'Navigation', value: 'Multi-constellation GNSS (GPS, GLONASS, Galileo)' },
  { label: 'Communication', value: '4G LTE + 900MHz backup' },
  { label: 'Airframe', value: 'Carbon-fiber composite' },
] as const;

// ── Sensor Data ──

interface SensorCard {
  icon: React.ReactNode;
  title: string;
  description: string;
}

const SENSORS: readonly SensorCard[] = [
  {
    icon: <Radar size={28} className="text-blue-300" />,
    title: 'LiDAR',
    description: '360\u00B0 obstacle detection, 100m range, real-time point cloud processing for autonomous navigation.',
  },
  {
    icon: <Thermometer size={28} className="text-blue-300" />,
    title: 'Thermal Imaging',
    description: 'FLIR-grade thermal camera for night operations and landing zone assessment in low-visibility conditions.',
  },
  {
    icon: <Eye size={28} className="text-blue-300" />,
    title: 'Stereo Vision',
    description: 'Dual HD cameras for depth perception and visual odometry, enabling precise hover and landing.',
  },
  {
    icon: <Satellite size={28} className="text-blue-300" />,
    title: 'Multi-GNSS',
    description: 'GPS + GLONASS + Galileo + BeiDou with RTK positioning for \u00B12cm accuracy in urban canyons.',
  },
] as const;

// ── Payload Features ──

interface PayloadFeature {
  icon: React.ReactNode;
  title: string;
  description: string;
}

const PAYLOAD_FEATURES: readonly PayloadFeature[] = [
  {
    icon: <Snowflake size={24} className="text-blue-300" />,
    title: 'Temperature Control',
    description: 'Active heating/cooling maintains 2-8\u00B0C for vaccines, 15-25\u00B0C for general medications.',
  },
  {
    icon: <Vibrate size={24} className="text-blue-300" />,
    title: 'Shock Absorption',
    description: 'Vibration-dampened suspension protects fragile cargo during turbulence and rapid manoeuvres.',
  },
  {
    icon: <ScanBarcode size={24} className="text-blue-300" />,
    title: 'Automated Loading',
    description: 'Standardized medical containers with RFID tracking and tamper-evident seals for chain-of-custody.',
  },
  {
    icon: <Layers size={24} className="text-blue-300" />,
    title: 'Compartmentalization',
    description: 'Dual-chamber design for simultaneous transport of incompatible items with isolated environments.',
  },
  {
    icon: <Weight size={24} className="text-blue-300" />,
    title: 'Weight Sensing',
    description: 'Real-time payload monitoring with CG adjustment for optimal flight stability and efficiency.',
  },
  {
    icon: <Umbrella size={24} className="text-blue-300" />,
    title: 'Emergency Jettison',
    description: 'Parachute-deployed payload release for critical situations, ensuring ground safety.',
  },
] as const;

// ── Comparison Data ──

interface ComparisonMetric {
  label: string;
  icon: React.ReactNode;
  drone: { value: string; raw: number };
  traditional: { value: string; raw: number };
  unit: string;
  droneWins: boolean;
}

const COMPARISONS: readonly ComparisonMetric[] = [
  {
    label: 'Delivery Time',
    icon: <Clock size={20} className="text-blue-300" />,
    drone: { value: '12 min', raw: 12 },
    traditional: { value: '28 min', raw: 28 },
    unit: 'avg',
    droneWins: true,
  },
  {
    label: 'Cost per Delivery',
    icon: <DollarSign size={20} className="text-blue-300" />,
    drone: { value: '$4.50', raw: 4.5 },
    traditional: { value: '$45', raw: 45 },
    unit: '',
    droneWins: true,
  },
  {
    label: 'Carbon Footprint',
    icon: <Leaf size={20} className="text-blue-300" />,
    drone: { value: '0 emissions', raw: 0 },
    traditional: { value: '2.3 kg CO\u2082', raw: 2.3 },
    unit: 'per delivery',
    droneWins: true,
  },
] as const;

// ── Page Component ──

export function FleetInfo() {
  const navigate = useNavigate();

  return (
    <InfoPageLayout>
      {/* ── 1. Hero ── */}
      <section className="bg-bg py-24 lg:py-32 2xl:py-40">
        <div className="mx-auto max-w-[1440px] 2xl:max-w-[1800px] px-6 lg:px-20 2xl:px-28">
          <div className="flex flex-col lg:flex-row items-center gap-12 lg:gap-20">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7 }}
              className="w-full lg:w-1/2 space-y-6"
            >
              <div className="inline-flex items-center gap-2 rounded-full border border-tertiary/20 bg-tertiary/5 px-4 py-1.5 2xl:px-5 2xl:py-2 text-[11px] 2xl:text-[13px] font-bold uppercase tracking-[0.15em] text-tertiary">
                <span className="flex h-2 w-2 2xl:h-2.5 2xl:w-2.5 rounded-full bg-tertiary animate-pulse" />
                Fleet Operations
              </div>
              <h1 className="font-headline text-4xl font-black leading-[1.1] tracking-tight text-on-surface md:text-5xl lg:text-6xl 2xl:text-7xl">
                AeroRescue <span className="text-blue-300">UAV</span> Fleet
              </h1>
              <p className="max-w-xl 2xl:max-w-2xl text-base leading-relaxed text-on-surface-variant md:text-lg 2xl:text-xl">
                Purpose-built autonomous drones engineered for medical logistics. Every component is optimized for
                speed, reliability, and the safe transport of life-critical supplies across urban environments.
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.8, delay: 0.2 }}
              className="w-full lg:w-1/2 flex justify-center"
            >
              <div className="relative rounded-2xl overflow-hidden border border-outline-variant/10 bg-surface-container-low p-4 2xl:p-6">
                <img
                  src="/drone-photo.png"
                  alt="AeroRescue UAV drone"
                  className="w-full max-w-[560px] 2xl:max-w-[700px] rounded-xl object-contain"
                />
                <div className="absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/5 pointer-events-none" />
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ── 2. Specifications Table ── */}
      <section className="bg-surface py-24 lg:py-32 2xl:py-40">
        <div className="mx-auto max-w-[1440px] 2xl:max-w-[1800px] px-6 lg:px-20 2xl:px-28">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.6 }}
          >
            <h2 className="mb-12 font-headline text-3xl font-bold tracking-tight text-on-surface md:text-4xl 2xl:text-5xl">
              Technical Specifications
            </h2>
          </motion.div>

          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: '-80px' }}
            variants={stagger}
            className="rounded-xl border border-outline-variant/10 overflow-hidden"
          >
            {SPECS.map((spec, i) => (
              <motion.div
                key={spec.label}
                custom={i}
                variants={fadeUp}
                className={`flex items-center justify-between px-6 py-4 2xl:px-8 2xl:py-5 ${
                  i % 2 === 0 ? 'bg-surface-container-low' : 'bg-surface'
                }`}
              >
                <span className="text-sm 2xl:text-base font-medium text-on-surface-variant">{spec.label}</span>
                <span className="text-sm 2xl:text-base font-semibold text-on-surface">{spec.value}</span>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ── 3. Sensor Suite ── */}
      <section className="bg-bg py-24 lg:py-32 2xl:py-40">
        <div className="mx-auto max-w-[1440px] 2xl:max-w-[1800px] px-6 lg:px-20 2xl:px-28">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.6 }}
          >
            <h2 className="mb-12 font-headline text-3xl font-bold tracking-tight text-on-surface md:text-4xl 2xl:text-5xl">
              Advanced Sensor Array
            </h2>
          </motion.div>

          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: '-80px' }}
            variants={stagger}
            className="grid grid-cols-1 gap-6 md:grid-cols-2 2xl:gap-8"
          >
            {SENSORS.map((sensor, i) => (
              <motion.div
                key={sensor.title}
                custom={i}
                variants={fadeUp}
                className="rounded-xl bg-surface-container-low p-8 2xl:p-10 border border-outline-variant/10 flex flex-col gap-4"
              >
                <div className="flex items-center gap-4">
                  {sensor.icon}
                  <h3 className="font-headline text-lg 2xl:text-xl font-bold text-on-surface">{sensor.title}</h3>
                </div>
                <p className="text-sm 2xl:text-base leading-relaxed text-on-surface-variant">{sensor.description}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ── 4. Payload Systems ── */}
      <section className="bg-surface-container-low py-24 lg:py-32 2xl:py-40">
        <div className="mx-auto max-w-[1440px] 2xl:max-w-[1800px] px-6 lg:px-20 2xl:px-28">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.6 }}
          >
            <h2 className="mb-4 font-headline text-3xl font-bold tracking-tight text-on-surface md:text-4xl 2xl:text-5xl">
              Medical-Grade Payload Bay
            </h2>
            <p className="mb-12 max-w-2xl text-base text-on-surface-variant 2xl:text-lg">
              Engineered from the ground up for the safe transport of pharmaceuticals, biologics, and emergency medical equipment.
            </p>
          </motion.div>

          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: '-80px' }}
            variants={stagger}
            className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3 2xl:gap-8"
          >
            {PAYLOAD_FEATURES.map((feature, i) => (
              <motion.div
                key={feature.title}
                custom={i}
                variants={fadeUp}
                className="rounded-xl bg-surface p-8 2xl:p-10 border border-outline-variant/10 flex flex-col gap-3"
              >
                {feature.icon}
                <h3 className="font-headline text-base 2xl:text-lg font-bold text-on-surface">{feature.title}</h3>
                <p className="text-sm 2xl:text-base leading-relaxed text-on-surface-variant">{feature.description}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ── 5. Comparison ── */}
      <section className="bg-bg py-24 lg:py-32 2xl:py-40">
        <div className="mx-auto max-w-[1440px] 2xl:max-w-[1800px] px-6 lg:px-20 2xl:px-28">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.6 }}
          >
            <h2 className="mb-12 font-headline text-3xl font-bold tracking-tight text-on-surface md:text-4xl 2xl:text-5xl">
              Drone vs. Traditional Delivery
            </h2>
          </motion.div>

          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: '-80px' }}
            variants={stagger}
            className="grid grid-cols-1 gap-6 md:grid-cols-3 2xl:gap-8"
          >
            {COMPARISONS.map((metric, i) => {
              const dronePercent = metric.traditional.raw > 0
                ? Math.max(8, (metric.drone.raw / metric.traditional.raw) * 100)
                : 8;
              const traditionalPercent = 100;

              return (
                <motion.div
                  key={metric.label}
                  custom={i}
                  variants={fadeUp}
                  className="rounded-xl bg-surface-container-low p-8 2xl:p-10 border border-outline-variant/10 flex flex-col gap-5"
                >
                  <div className="flex items-center gap-3">
                    {metric.icon}
                    <h3 className="font-headline text-base 2xl:text-lg font-bold text-on-surface">{metric.label}</h3>
                  </div>

                  {/* Drone bar */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs 2xl:text-sm">
                      <span className="font-medium text-blue-300">Drone</span>
                      <span className="font-bold text-on-surface">{metric.drone.value} <span className="text-on-surface-variant font-normal">{metric.unit}</span></span>
                    </div>
                    <div className="h-3 w-full rounded-full bg-surface overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        whileInView={{ width: `${dronePercent}%` }}
                        viewport={{ once: true }}
                        transition={{ duration: 0.8, delay: 0.2 + i * 0.1, ease: 'easeOut' as const }}
                        className="h-full rounded-full bg-gradient-to-r from-blue-500 to-blue-300"
                      />
                    </div>
                  </div>

                  {/* Traditional bar */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs 2xl:text-sm">
                      <span className="font-medium text-on-surface-variant">
                        {metric.label === 'Delivery Time' ? 'Ambulance' : 'Ground Vehicle'}
                      </span>
                      <span className="font-bold text-on-surface">{metric.traditional.value} <span className="text-on-surface-variant font-normal">{metric.unit}</span></span>
                    </div>
                    <div className="h-3 w-full rounded-full bg-surface overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        whileInView={{ width: `${traditionalPercent}%` }}
                        viewport={{ once: true }}
                        transition={{ duration: 0.8, delay: 0.35 + i * 0.1, ease: 'easeOut' as const }}
                        className="h-full rounded-full bg-red-500/60"
                      />
                    </div>
                  </div>

                  {metric.droneWins && (
                    <div className="flex items-center gap-1.5 mt-1">
                      <ShieldCheck size={14} className="text-tertiary" />
                      <span className="text-xs 2xl:text-sm font-medium text-tertiary">Drone advantage</span>
                    </div>
                  )}
                </motion.div>
              );
            })}
          </motion.div>
        </div>
      </section>

      {/* ── 6. CTA ── */}
      <section className="bg-surface py-24 lg:py-32 2xl:py-40">
        <div className="mx-auto max-w-[1440px] 2xl:max-w-[1800px] px-6 lg:px-20 2xl:px-28">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.6 }}
            className="flex flex-col items-center text-center gap-8"
          >
            <h2 className="font-headline text-3xl font-bold tracking-tight text-on-surface md:text-4xl 2xl:text-5xl">
              View the Fleet in Action
            </h2>
            <p className="max-w-xl text-base text-on-surface-variant 2xl:text-lg">
              Experience real-time fleet monitoring, mission deployment, and autonomous route optimization on the live dashboard.
            </p>
            <button
              onClick={() => navigate('/login')}
              className="btn-primary-gradient flex h-12 lg:h-14 2xl:h-16 items-center justify-center rounded-lg px-8 lg:px-10 2xl:px-12 text-sm lg:text-base 2xl:text-lg font-bold tracking-wide text-white transition-all hover:shadow-[0_0_30px_rgba(0,81,206,0.4)] hover:scale-105 active:scale-95 cursor-pointer"
            >
              View the Fleet in Action
            </button>
          </motion.div>
        </div>
      </section>
    </InfoPageLayout>
  );
}
