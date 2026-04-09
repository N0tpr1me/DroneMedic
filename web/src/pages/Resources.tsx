import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
  ChevronDown,
  Quote,
  TrendingDown,
  Clock,
  PoundSterling,
  CheckCircle2,
  Wind,
  Package,
  ArrowRight,
  Cpu,
  Shield,
  Plane,
  Headphones,
  Mail,
} from 'lucide-react';
import { InfoPageLayout } from '../components/layout/InfoPageLayout';

const fadeUp = {
  initial: { opacity: 0, y: 20 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true },
};

const CASE_STUDY_IMAGES = [
  '/images/warehouse.jpg',
  '/images/emergency-medical.jpg',
  '/images/london-skyline.jpg',
];

interface CaseStudy {
  title: string;
  location: string;
  challenge: string;
  solution: string;
  results: string[];
  quote?: string;
  quoteAuthor?: string;
}

const CASE_STUDIES: CaseStudy[] = [
  {
    title: 'NHS Rural Hospital Network',
    location: 'Scotland',
    challenge:
      'Remote Highland hospitals waited 4+ hours for critical blood supplies, putting patients at risk during emergencies.',
    solution:
      'DroneMedic fleet of 3 UAVs covers 12 facilities across 2,400 km², operating autonomous supply runs with priority-based routing.',
    results: [
      '87% reduction in delivery time (4h to 31 min avg)',
      '340+ successful deliveries since deployment',
      '\u00A3180K annual cost savings vs ground transport',
    ],
    quote:
      'DroneMedic has fundamentally changed how we serve our rural communities.',
    quoteAuthor: 'Dr. Sarah McAllister, NHS Highland',
  },
  {
    title: 'Urban Emergency Response',
    location: 'London',
    challenge:
      'Traffic congestion delayed medical supply delivery to A&E departments during peak hours, with average road transit exceeding 45 minutes.',
    solution:
      'Rooftop-to-rooftop drone corridor network connecting 8 hospitals across Central London with automated dispatch and landing.',
    results: [
      '12-minute average delivery time (vs 45 min by road)',
      '99.7% delivery success rate',
      '24/7 automated operation with zero manual intervention',
    ],
  },
  {
    title: 'Island Medical Supply Chain',
    location: 'Channel Islands',
    challenge:
      'Ferry-dependent supply chain disrupted by weather, leaving clinics without essential medications for days at a time.',
    solution:
      'Weather-adaptive drone fleet maintaining daily supply runs across 5 islands with real-time route adjustment for wind and visibility.',
    results: [
      'Zero stockout days since deployment',
      '92% cost reduction vs emergency helicopter transport',
      'Operates in winds up to 35 km/h',
    ],
  },
];

interface FaqItem {
  question: string;
  answer: string;
}

const FAQ_ITEMS: FaqItem[] = [
  {
    question: 'How far can DroneMedic drones fly?',
    answer:
      'DroneMedic UAVs have a 120 km range with 45-minute endurance per charge cycle. Automatic battery management monitors cell voltage in real time and triggers return-to-base when reserves drop below safe thresholds, ensuring every mission completes with margin.',
  },
  {
    question: 'What happens if a drone loses communication?',
    answer:
      'All drones carry autonomous return-to-base logic that activates if communication is lost for more than 10 seconds. Pre-programmed safe landing sites along every route corridor provide fallback options if the home base is unreachable.',
  },
  {
    question: 'Can drones operate in bad weather?',
    answer:
      'DroneMedic UAVs tolerate sustained winds up to 35 km/h and carry an IP54 weather rating. Thermal cameras enable low-visibility navigation, and the route planner automatically adjusts flight paths around active weather cells.',
  },
  {
    question: 'What medical supplies can be transported?',
    answer:
      'Payloads up to 15 kg are supported with temperature-controlled compartments: 2-8\u00B0C for vaccines and blood products, or 15-25\u00B0C for standard medications. Common payloads include blood bags, vaccines, medications, and lab samples.',
  },
  {
    question: 'How is patient data protected?',
    answer:
      'DroneMedic is fully GDPR compliant. All telemetry is encrypted end-to-end, mission logs are anonymised before storage, and no patient-identifiable information is transmitted over the drone communication link.',
  },
  {
    question: 'What regulatory approvals are needed?',
    answer:
      'Operations require UK CAA CAP 722 authorisation, FAA Part 107 (for US deployments), and EASA compliance for European operations. DroneMedic handles all regulatory requirements including airspace coordination, pilot certification, and operational risk assessments.',
  },
  {
    question: 'How quickly can DroneMedic be deployed?',
    answer:
      'Under 15 minutes from unboxing to first mission. Rapid integration kits include pre-configured ground stations, automated calibration routines, and instant cloud connectivity so medical teams can begin operations immediately.',
  },
];

const RESULT_ICONS = [TrendingDown, Clock, PoundSterling, CheckCircle2, Wind, Package];

function getResultIcon(index: number) {
  const Icon = RESULT_ICONS[index % RESULT_ICONS.length];
  return <Icon size={16} className="mt-0.5 shrink-0 text-blue-300" />;
}

const DOC_LINKS = [
  {
    icon: Cpu,
    title: 'Technology & Architecture',
    desc: 'Deep dive into the simulation stack, AI coordination layer, and route optimisation engine.',
    path: '/technology',
  },
  {
    icon: Shield,
    title: 'Safety Protocols',
    desc: 'Geofencing, battery management, weather monitoring, and fail-safe procedures.',
    path: '/safety',
  },
  {
    icon: Plane,
    title: 'Fleet Specifications',
    desc: 'Drone hardware, payload capacity, range, endurance, and sensor configurations.',
    path: '/fleet-info',
  },
];

export function Resources() {
  const navigate = useNavigate();
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  function toggleFaq(index: number) {
    setOpenFaq((prev) => (prev === index ? null : index));
  }

  return (
    <InfoPageLayout>
      {/* ── Hero ── */}
      <section className="bg-bg py-24 lg:py-32 2xl:py-40">
        <div className="mx-auto max-w-[1440px] 2xl:max-w-[1800px] px-6 lg:px-20 2xl:px-28 text-center">
          <motion.div {...fadeUp} transition={{ duration: 0.6 }}>
            <div className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-tertiary/20 bg-tertiary/5 px-4 py-1.5 2xl:px-5 2xl:py-2 text-[11px] 2xl:text-[13px] font-bold uppercase tracking-[0.15em] text-tertiary">
              <span className="flex h-2 w-2 2xl:h-2.5 2xl:w-2.5 rounded-full bg-tertiary animate-pulse" />
              Knowledge Base
            </div>
            <h1 className="font-headline text-4xl font-black leading-[1.1] tracking-tight text-on-surface md:text-5xl lg:text-6xl 2xl:text-7xl">
              Resources & Case Studies
            </h1>
            <p className="mx-auto mt-6 max-w-2xl 2xl:max-w-3xl text-base leading-relaxed text-on-surface-variant md:text-lg 2xl:text-xl">
              Learn from real-world deployments across the UK. Explore how DroneMedic
              is transforming medical logistics in rural, urban, and island
              environments — backed by measurable outcomes and operational data.
            </p>
          </motion.div>
        </div>
      </section>

      {/* ── Case Studies ── */}
      <section className="bg-surface py-24 lg:py-32 2xl:py-40">
        <div className="mx-auto max-w-[1440px] 2xl:max-w-[1800px] px-6 lg:px-20 2xl:px-28">
          <motion.div {...fadeUp} transition={{ duration: 0.6 }}>
            <h2 className="font-headline text-3xl font-bold tracking-tight text-on-surface md:text-4xl 2xl:text-5xl text-center">
              Real-World Impact
            </h2>
          </motion.div>

          <div className="mt-14 2xl:mt-18 grid gap-8 lg:grid-cols-3">
            {CASE_STUDIES.map((study, i) => (
              <motion.div
                key={study.title}
                {...fadeUp}
                transition={{ duration: 0.5, delay: i * 0.12 }}
                whileHover={{ y: -4, boxShadow: '0 12px 40px rgba(0,0,0,0.3)' }}
                className="flex flex-col rounded-xl bg-surface-container-low border border-outline-variant/10 overflow-hidden"
              >
                <img
                  src={CASE_STUDY_IMAGES[i]}
                  alt={study.title}
                  className="h-48 w-full object-cover"
                />
                <div className="p-8 2xl:p-10 flex flex-col flex-1">
                <div className="mb-4">
                  <span className="text-xs 2xl:text-sm font-bold uppercase tracking-widest text-blue-300">
                    {study.location}
                  </span>
                  <h3 className="mt-1 font-headline text-xl 2xl:text-2xl font-bold text-on-surface">
                    {study.title}
                  </h3>
                </div>

                <div className="mb-4">
                  <h4 className="text-xs 2xl:text-sm font-bold uppercase tracking-wider text-on-surface-variant mb-1">
                    Challenge
                  </h4>
                  <p className="text-sm 2xl:text-base leading-relaxed text-on-surface-variant">
                    {study.challenge}
                  </p>
                </div>

                <div className="mb-4">
                  <h4 className="text-xs 2xl:text-sm font-bold uppercase tracking-wider text-on-surface-variant mb-1">
                    Solution
                  </h4>
                  <p className="text-sm 2xl:text-base leading-relaxed text-on-surface-variant">
                    {study.solution}
                  </p>
                </div>

                <div className="mb-4">
                  <h4 className="text-xs 2xl:text-sm font-bold uppercase tracking-wider text-on-surface-variant mb-2">
                    Results
                  </h4>
                  <ul className="space-y-2">
                    {study.results.map((result, ri) => (
                      <li
                        key={ri}
                        className="flex items-start gap-2 text-sm 2xl:text-base leading-relaxed text-on-surface"
                      >
                        {getResultIcon(ri)}
                        {result}
                      </li>
                    ))}
                  </ul>
                </div>

                {study.quote && (
                  <div className="mt-auto pt-4 border-t border-outline-variant/10">
                    <Quote size={18} className="mb-2 text-blue-300/60" />
                    <p className="text-sm 2xl:text-base italic leading-relaxed text-on-surface-variant">
                      &ldquo;{study.quote}&rdquo;
                    </p>
                    {study.quoteAuthor && (
                      <p className="mt-2 text-xs 2xl:text-sm font-medium text-blue-300">
                        {study.quoteAuthor}
                      </p>
                    )}
                  </div>
                )}
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section className="bg-bg py-24 lg:py-32 2xl:py-40">
        <div className="mx-auto max-w-[1440px] 2xl:max-w-[1800px] px-6 lg:px-20 2xl:px-28">
          <motion.div {...fadeUp} transition={{ duration: 0.6 }}>
            <h2 className="font-headline text-3xl font-bold tracking-tight text-on-surface md:text-4xl 2xl:text-5xl text-center">
              Frequently Asked Questions
            </h2>
          </motion.div>

          <div className="mx-auto mt-14 2xl:mt-18 max-w-3xl 2xl:max-w-4xl space-y-3">
            {FAQ_ITEMS.map((item, i) => (
              <motion.div
                key={i}
                {...fadeUp}
                transition={{ duration: 0.4, delay: i * 0.06 }}
                className="rounded-xl bg-surface-container-low border border-outline-variant/10 overflow-hidden"
              >
                <button
                  onClick={() => toggleFaq(i)}
                  className="flex w-full items-center justify-between gap-4 p-6 2xl:p-8 text-left cursor-pointer"
                >
                  <span className="font-headline text-base 2xl:text-lg font-bold text-on-surface">
                    {item.question}
                  </span>
                  <motion.span
                    animate={{ rotate: openFaq === i ? 180 : 0 }}
                    transition={{ duration: 0.25, ease: 'easeInOut' }}
                    className="shrink-0"
                  >
                    <ChevronDown
                      size={20}
                      className={openFaq === i ? 'text-blue-300' : 'text-on-surface-variant'}
                    />
                  </motion.span>
                </button>

                <AnimatePresence initial={false}>
                  {openFaq === i && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.25, ease: 'easeInOut' }}
                    >
                      <div className="px-6 pb-6 2xl:px-8 2xl:pb-8">
                        <p className="text-sm 2xl:text-base leading-relaxed text-on-surface-variant">
                          {item.answer}
                        </p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Documentation Links ── */}
      <section className="bg-surface py-24 lg:py-32 2xl:py-40">
        <div className="mx-auto max-w-[1440px] 2xl:max-w-[1800px] px-6 lg:px-20 2xl:px-28">
          <motion.div {...fadeUp} transition={{ duration: 0.6 }}>
            <h2 className="font-headline text-3xl font-bold tracking-tight text-on-surface md:text-4xl 2xl:text-5xl text-center">
              Documentation & Guides
            </h2>
          </motion.div>

          <div className="mt-14 2xl:mt-18 grid gap-6 md:grid-cols-3">
            {DOC_LINKS.map((doc, i) => (
              <motion.div
                key={doc.title}
                {...fadeUp}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                onClick={() => navigate(doc.path)}
                className="group flex flex-col rounded-xl bg-surface-container-low p-8 2xl:p-10 border border-outline-variant/10 cursor-pointer transition-colors hover:border-blue-300/30"
              >
                <doc.icon size={28} className="mb-4 text-blue-300" />
                <h3 className="font-headline text-lg 2xl:text-xl font-bold text-on-surface">
                  {doc.title}
                </h3>
                <p className="mt-2 flex-1 text-sm 2xl:text-base leading-relaxed text-on-surface-variant">
                  {doc.desc}
                </p>
                <div className="mt-4 flex items-center gap-1 text-sm font-medium text-blue-300">
                  Learn more
                  <motion.span
                    className="inline-flex"
                    initial={{ x: 0 }}
                    whileHover={{ x: 4 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                  >
                    <ArrowRight size={16} className="transition-transform duration-200 group-hover:translate-x-1.5" />
                  </motion.span>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Support ── */}
      <section className="bg-bg py-24 lg:py-32 2xl:py-40">
        <div className="mx-auto max-w-[1440px] 2xl:max-w-[1800px] px-6 lg:px-20 2xl:px-28">
          <motion.div {...fadeUp} transition={{ duration: 0.6 }}>
            <h2 className="font-headline text-3xl font-bold tracking-tight text-on-surface md:text-4xl 2xl:text-5xl text-center">
              Need Help?
            </h2>
          </motion.div>

          <div className="mt-14 2xl:mt-18 grid gap-6 md:grid-cols-2">
            <motion.div
              {...fadeUp}
              transition={{ duration: 0.5 }}
              className="rounded-xl bg-surface-container-low p-8 2xl:p-10 border border-outline-variant/10"
            >
              <Headphones size={28} className="mb-4 text-blue-300" />
              <h3 className="font-headline text-xl 2xl:text-2xl font-bold text-on-surface">
                Technical Support
              </h3>
              <ul className="mt-4 space-y-3">
                <li className="flex items-start gap-2 text-sm 2xl:text-base leading-relaxed text-on-surface-variant">
                  <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-blue-300" />
                  24/7 engineering team availability
                </li>
                <li className="flex items-start gap-2 text-sm 2xl:text-base leading-relaxed text-on-surface-variant">
                  <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-blue-300" />
                  Priority response for active missions
                </li>
                <li className="flex items-start gap-2 text-sm 2xl:text-base leading-relaxed text-on-surface-variant">
                  <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-blue-300" />
                  Dedicated account manager
                </li>
              </ul>
            </motion.div>

            <motion.div
              {...fadeUp}
              transition={{ duration: 0.5, delay: 0.12 }}
              className="rounded-xl bg-surface-container-low p-8 2xl:p-10 border border-outline-variant/10"
            >
              <Mail size={28} className="mb-4 text-blue-300" />
              <h3 className="font-headline text-xl 2xl:text-2xl font-bold text-on-surface">
                Contact Sales
              </h3>
              <ul className="mt-4 space-y-3">
                <li className="flex items-start gap-2 text-sm 2xl:text-base leading-relaxed text-on-surface-variant">
                  <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-blue-300" />
                  Enterprise deployment packages
                </li>
                <li className="flex items-start gap-2 text-sm 2xl:text-base leading-relaxed text-on-surface-variant">
                  <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-blue-300" />
                  Custom integrations and API access
                </li>
                <li className="flex items-start gap-2 text-sm 2xl:text-base leading-relaxed text-on-surface-variant">
                  <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-blue-300" />
                  Volume pricing and SLA agreements
                </li>
              </ul>
              <button
                onClick={() => navigate('/contact')}
                className="mt-6 btn-primary-gradient h-11 2xl:h-13 px-6 2xl:px-8 rounded-lg text-sm 2xl:text-base font-bold text-white transition-all hover:shadow-[0_0_30px_rgba(0,81,206,0.4)] hover:scale-105 active:scale-95 cursor-pointer"
              >
                Get in Touch
              </button>
            </motion.div>
          </div>
        </div>
      </section>
    </InfoPageLayout>
  );
}
