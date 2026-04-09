import { motion, useScroll, useTransform, useInView } from 'framer-motion';
import { useNavigate, Link } from 'react-router-dom';
import { MessageSquare, Brain, Globe, ShieldCheck, Shield, ArrowRight, Rocket, AtSign, Share2, Radio } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../hooks/useAuth';
import RotatingGlobe from '../components/ui/wireframe-dotted-globe';
import Starfield from '../components/ui/starfield';
import { useRef, useEffect, useState } from 'react';

function AnimatedCounter({ value, suffix = '', decimals = 0, duration = 2000 }: { value: number; suffix?: string; decimals?: number; duration?: number }) {
  const [display, setDisplay] = useState('0');
  const ref = useRef<HTMLSpanElement>(null);
  const isInView = useInView(ref, { once: true, amount: 0.5 });

  useEffect(() => {
    if (!isInView) return;
    const startTime = Date.now();
    const tick = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = eased * value;
      setDisplay(decimals > 0 ? current.toFixed(decimals) : Math.round(current).toString());
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [isInView, value, duration, decimals]);

  return <span ref={ref}>{display}{suffix}</span>;
}

const DRONE_IMG = '/drone-photo.png';

const DRONE_ICON_SVG = (
  <svg className="w-8 h-8" fill="none" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
    <path d="M13.8261 17.4264C16.7203 18.1174 20.2244 18.5217 24 18.5217C27.7756 18.5217 31.2797 18.1174 34.1739 17.4264C36.9144 16.7722 39.9967 15.2331 41.3563 14.1648L24.8486 40.6391C24.4571 41.267 23.5429 41.267 23.1514 40.6391L6.64374 14.1648C8.00331 15.2331 11.0856 16.7722 13.8261 17.4264Z" fill="currentColor" />
    <path clipRule="evenodd" d="M39.998 12.236C39.9944 12.2537 39.9875 12.2845 39.9748 12.3294C39.9436 12.4399 39.8949 12.5741 39.8346 12.7175C39.8168 12.7597 39.7989 12.8007 39.7813 12.8398C38.5103 13.7113 35.9788 14.9393 33.7095 15.4811C30.9875 16.131 27.6413 16.5217 24 16.5217C20.3587 16.5217 17.0125 16.131 14.2905 15.4811C12.0012 14.9346 9.44505 13.6897 8.18538 12.8168C8.17384 12.7925 8.16216 12.767 8.15052 12.7408C8.09919 12.6249 8.05721 12.5114 8.02977 12.411C8.00356 12.3152 8.00039 12.2667 8.00004 12.2612C8.00004 12.261 8 12.2607 8.00004 12.2612C8.00004 12.2359 8.0104 11.9233 8.68485 11.3686C9.34546 10.8254 10.4222 10.2469 11.9291 9.72276C14.9242 8.68098 19.1919 8 24 8C28.8081 8 33.0758 8.68098 36.0709 9.72276C37.5778 10.2469 38.6545 10.8254 39.3151 11.3686C39.9006 11.8501 39.9857 12.1489 39.998 12.236ZM4.95178 15.2312L21.4543 41.6973C22.6288 43.5809 25.3712 43.5809 26.5457 41.6973L43.0534 15.223C43.0709 15.1948 43.0878 15.1662 43.104 15.1371L41.3563 14.1648C43.104 15.1371 43.1038 15.1374 43.104 15.1371L43.1051 15.135L43.1065 15.1325L43.1101 15.1261L43.1199 15.1082C43.1276 15.094 43.1377 15.0754 43.1497 15.0527C43.1738 15.0075 43.2062 14.9455 43.244 14.8701C43.319 14.7208 43.4196 14.511 43.5217 14.2683C43.6901 13.8679 44 13.0689 44 12.2609C44 10.5573 43.003 9.22254 41.8558 8.2791C40.6947 7.32427 39.1354 6.55361 37.385 5.94477C33.8654 4.72057 29.133 4 24 4C18.867 4 14.1346 4.72057 10.615 5.94478C8.86463 6.55361 7.30529 7.32428 6.14419 8.27911C4.99695 9.22255 3.99999 10.5573 3.99999 12.2609C3.99999 13.1275 4.29264 13.9078 4.49321 14.3607C4.60375 14.6102 4.71348 14.8196 4.79687 14.9689C4.83898 15.0444 4.87547 15.1065 4.9035 15.1529C4.91754 15.1762 4.92954 15.1957 4.93916 15.2111L4.94662 15.223L4.95178 15.2312ZM35.9868 18.996L24 38.22L12.0131 18.996C12.4661 19.1391 12.9179 19.2658 13.3617 19.3718C16.4281 20.1039 20.0901 20.5217 24 20.5217C27.9099 20.5217 31.5719 20.1039 34.6383 19.3718C35.082 19.2658 35.5339 19.1391 35.9868 18.996Z" fill="currentColor" fillRule="evenodd" />
  </svg>
);

function CapabilityBanner() {
  const bannerRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: bannerRef,
    offset: ['start end', 'end start'],
  });
  const scale = useTransform(scrollYProgress, [0, 0.5, 1], [1, 1.08, 1.15]);

  return (
    <div ref={bannerRef} className="relative mb-16 2xl:mb-20 w-full overflow-hidden rounded-xl h-[280px] lg:h-[360px] 2xl:h-[420px]">
      <motion.img
        src="/images/drone-flying.jpg"
        alt="Drone in flight"
        className="absolute inset-0 h-full w-full object-cover"
        style={{ scale }}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/30 to-transparent" />
    </div>
  );
}

export function Landing() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const goToDashboard = () => navigate(user ? '/dashboard' : '/login');

  return (
    <div className="relative flex min-h-screen w-full flex-col overflow-x-hidden bg-bg text-on-surface font-body">
      {/* ── Header ── */}
      <header className="fixed top-0 z-50 w-full border-b border-outline-variant/15 bg-bg/80 backdrop-blur-md px-6 lg:px-20 2xl:px-28 py-4 2xl:py-5">
        <div className="mx-auto flex max-w-[1440px] 2xl:max-w-[1800px] items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="text-blue-300">{DRONE_ICON_SVG}</div>
            <h2 className="font-headline text-xl 2xl:text-2xl font-bold tracking-tight text-on-surface">DroneMedic</h2>
          </div>
          <nav className="hidden items-center gap-10 2xl:gap-14 md:flex">
            <Link className="text-sm 2xl:text-base font-medium text-on-surface-variant transition-colors hover:text-primary" to="/">Home</Link>
            <Link className="text-sm 2xl:text-base font-medium text-on-surface-variant transition-colors hover:text-primary" to="/missions">Missions</Link>
            <Link className="text-sm 2xl:text-base font-medium text-on-surface-variant transition-colors hover:text-primary" to="/fleet-info">Fleet</Link>
            <Link className="text-sm 2xl:text-base font-medium text-on-surface-variant transition-colors hover:text-primary" to="/technology">How It Works</Link>
            <Link className="text-sm 2xl:text-base font-medium text-on-surface-variant transition-colors hover:text-primary" to="/safety">Safety</Link>
          </nav>
          <button
            onClick={goToDashboard}
            className="btn-primary-gradient flex h-11 2xl:h-13 items-center justify-center rounded px-6 2xl:px-8 text-sm 2xl:text-base font-bold tracking-wide text-white transition-transform hover:scale-105 active:scale-95 cursor-pointer"
          >
            Start Your First Mission
          </button>
        </div>
      </header>

      <main className="flex-1">
        {/* ── Hero ── */}
        <section className="relative flex min-h-[100dvh] items-center pt-20 overflow-hidden">
          <Starfield />
          <div className="relative z-10 mx-auto flex flex-col lg:flex-row max-w-[1440px] 2xl:max-w-[1800px] w-full items-center px-6 lg:px-20 2xl:px-28 gap-8 lg:gap-0">
            {/* Text — left half on desktop, full width + centered on mobile */}
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.2 }}
              className="w-full lg:w-1/2 shrink-0 space-y-7 2xl:space-y-9 text-center lg:text-left"
            >
              <motion.div
                animate={{ y: [0, -6, 0] }}
                transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                className="inline-flex items-center gap-2 rounded-full border border-tertiary/20 bg-tertiary/5 px-4 py-1.5 2xl:px-5 2xl:py-2 text-[11px] 2xl:text-[13px] font-bold uppercase tracking-[0.15em] text-tertiary"
              >
                <span className="flex h-2 w-2 2xl:h-2.5 2xl:w-2.5 rounded-full bg-tertiary animate-pulse" />
                AeroRescue Control: Online
              </motion.div>
              <h1 className="font-headline text-4xl font-black leading-[1.1] tracking-tight text-on-surface sm:text-5xl md:text-6xl lg:text-7xl 2xl:text-8xl">
                The Future of<br /> <span className="text-blue-300">Medical</span> Logistics
              </h1>
              <p className="mx-auto lg:mx-0 max-w-xl 2xl:max-w-2xl text-base leading-relaxed text-on-surface-variant md:text-lg 2xl:text-xl">
                Autonomous UAV delivery systems for life-critical medical supplies. Engineered for precision, built for urgency.
              </p>
              <div className="flex justify-center lg:justify-start pt-2 2xl:pt-4">
                <button
                  onClick={goToDashboard}
                  className="btn-primary-gradient h-12 lg:h-14 2xl:h-16 px-8 lg:px-10 2xl:px-12 rounded-lg text-sm lg:text-base 2xl:text-lg font-bold text-white transition-all hover:shadow-[0_0_30px_rgba(0,81,206,0.4)] cursor-pointer"
                >
                  Start Your First Mission
                </button>
              </div>
            </motion.div>

            {/* Drone image — mobile/tablet fallback */}
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.8, delay: 0.4 }}
              className="block lg:hidden w-full max-w-sm mx-auto"
            >
              <div className="relative">
                <img src={DRONE_IMG} alt="AeroRescue UAV" className="w-full rounded-xl border border-outline-variant/20 shadow-2xl shadow-primary/20" />
                <div className="absolute inset-0 rounded-xl ring-1 ring-inset ring-white/10 pointer-events-none" />
              </div>
            </motion.div>

            {/* Globe — desktop only */}
            <div className="hidden lg:block w-1/2 h-[500px] xl:h-[650px] 2xl:h-[900px]">
              <RotatingGlobe />
            </div>
          </div>
        </section>

        {/* ── Stats Bar — visible on scroll ── */}
        <div className="z-30 w-full bg-surface-container-low/80 py-8 2xl:py-12 backdrop-blur-xl border-t border-outline-variant/10">
          <div className="mx-auto max-w-[1440px] 2xl:max-w-[1800px] px-6 lg:px-20 2xl:px-28">
            <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
              <div className="flex flex-col items-center gap-2 text-center md:items-start md:text-left">
                <span className="text-xs 2xl:text-sm font-bold uppercase tracking-widest text-on-surface-variant">Flight Stability</span>
                <div className="flex items-baseline gap-2">
                  <span className="font-headline text-4xl 2xl:text-5xl font-bold text-blue-300"><AnimatedCounter value={99.9} suffix="%" decimals={1} duration={2000} /></span>
                  <span className="text-xs 2xl:text-sm font-medium text-tertiary">&#9650; 0.1%</span>
                </div>
              </div>
              <div className="flex flex-col items-center gap-2 text-center md:items-start md:text-left">
                <span className="text-xs 2xl:text-sm font-bold uppercase tracking-widest text-on-surface-variant">Avg. Response Time</span>
                <div className="flex items-baseline gap-2">
                  <span className="font-headline text-4xl 2xl:text-5xl font-bold text-blue-300"><AnimatedCounter value={12} suffix="m" duration={1800} /></span>
                  <span className="text-xs 2xl:text-sm font-bold text-red-500">&#9660; 2m</span>
                </div>
              </div>
              <div className="flex flex-col items-center gap-2 text-center md:items-start md:text-left">
                <span className="text-xs 2xl:text-sm font-bold uppercase tracking-widest text-on-surface-variant">Global Fleet</span>
                <div className="flex items-baseline gap-2">
                  <span className="font-headline text-4xl 2xl:text-5xl font-bold text-blue-300">Ready</span>
                  <span className="text-xs 2xl:text-sm font-medium text-tertiary">Active 24/7</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Core Mission Capabilities ── */}
        <section id="capabilities" className="bg-surface py-24 lg:py-40 2xl:py-48">
          <div className="mx-auto max-w-[1440px] 2xl:max-w-[1800px] px-6 lg:px-20 2xl:px-28">
            <div className="mb-16 max-w-2xl 2xl:max-w-3xl lg:mb-24 2xl:mb-32">
              <h2 className="mb-6 font-headline text-4xl font-bold tracking-tight text-on-surface md:text-5xl 2xl:text-6xl">Core Mission Capabilities</h2>
              <p className="text-lg 2xl:text-xl text-on-surface-variant">Advanced AI-driven logistics for life-critical operations. Our platform integrates state-of-the-art UAV technology with proprietary AI orchestration.</p>
            </div>
            {/* Drone banner with zoom-on-scroll */}
            <CapabilityBanner />

            <div className="grid grid-cols-1 gap-6 2xl:gap-8 lg:grid-cols-3">
              {[
                {
                  icon: <MessageSquare size={24} />,
                  bgIcon: <Brain size={120} />,
                  title: 'AI Mission Coordinator',
                  desc: 'Interpreting natural language tasks for seamless mission planning. Our LLM-integrated core allows medical staff to initiate deliveries with simple verbal or text instructions.',
                  linkText: 'Learn More',
                  linkTo: '/missions',
                  accentColor: 'primary',
                },
                {
                  icon: <Globe size={24} />,
                  bgIcon: <Globe size={120} />,
                  title: 'Real-time Telemetry',
                  desc: 'Dynamic day and night mapping with active flight path tracking. Monitor every vector of your fleet\'s journey with millisecond latency and high-fidelity 3D visualization.',
                  linkText: 'Live Dashboard',
                  linkTo: '',
                  accentColor: 'tertiary',
                },
                {
                  icon: <ShieldCheck size={24} />,
                  bgIcon: <Shield size={120} />,
                  title: 'Autonomous Detection',
                  desc: 'Computer vision-powered safety systems for complex environments. Our UAVs utilize neural networks to navigate dense urban areas and unpredictable weather patterns.',
                  linkText: 'Safety Protocols',
                  linkTo: '/safety',
                  accentColor: 'secondary',
                },
              ].map((card, i) => (
                <motion.div
                  key={card.title}
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.2 }}
                  transition={{ duration: 0.5, delay: i * 0.15 }}
                  whileHover={{ scale: 1.03 }}
                  className="group relative flex flex-col justify-between overflow-hidden rounded-xl bg-surface-container-low p-8 2xl:p-10 transition-colors hover:bg-surface-container-high">
                  <div className={`absolute -right-4 -top-4 transition-transform duration-500 group-hover:scale-110 ${
                    card.accentColor === 'primary' ? 'text-primary/15 group-hover:text-primary/25' :
                    card.accentColor === 'tertiary' ? 'text-tertiary/15 group-hover:text-tertiary/25' :
                    'text-red-500/20 group-hover:text-red-500/35'
                  }`}>
                    {card.bgIcon}
                  </div>
                  <div className="relative z-10 space-y-4">
                    <div className={`inline-flex h-12 w-12 items-center justify-center rounded-lg ${
                      card.accentColor === 'primary' ? 'bg-primary-container text-primary' :
                      card.accentColor === 'tertiary' ? 'bg-tertiary-container text-tertiary' :
                      'bg-red-900/50 text-red-400'
                    }`}>
                      {card.icon}
                    </div>
                    <h3 className="font-headline text-2xl 2xl:text-3xl font-bold text-on-surface">{card.title}</h3>
                    <p className="text-on-surface-variant 2xl:text-lg">{card.desc}</p>
                  </div>
                  <button
                    onClick={() => navigate(card.linkTo || (user ? '/dashboard' : '/login'))}
                    className={`mt-8 flex items-center text-sm 2xl:text-base font-bold cursor-pointer bg-transparent border-0 p-0 ${
                      card.accentColor === 'primary' ? 'text-primary' :
                      card.accentColor === 'tertiary' ? 'text-tertiary' :
                      'text-red-400'
                    }`}
                  >
                    <span>{card.linkText}</span>
                    <ArrowRight size={14} className="ml-2" />
                  </button>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* ── How It Works ── */}
        <section id="how-it-works" className="relative py-24 lg:py-32 2xl:py-40 overflow-hidden">
          {/* Parallax background */}
          <div className="absolute inset-0 z-0">
            <div
              className="absolute inset-0 bg-cover bg-center bg-fixed"
              style={{ backgroundImage: 'url(/images/london-skyline.jpg)' }}
            />
            <div className="absolute inset-0 bg-black/75" />
          </div>
          <div className="relative z-10 mx-auto max-w-[1440px] 2xl:max-w-[1800px] px-6 lg:px-20 2xl:px-28">
            <div className="mb-16 2xl:mb-20 text-center">
              <h2 className="mb-4 font-headline text-4xl font-bold tracking-tight text-on-surface md:text-5xl 2xl:text-6xl">How It Works</h2>
              <p className="text-lg 2xl:text-xl text-on-surface-variant">From request to delivery in four steps</p>
            </div>
            <div className="grid grid-cols-1 gap-6 2xl:gap-8 md:grid-cols-2 lg:grid-cols-4">
              {[
                { step: '01', name: 'Describe', desc: 'Tell us what you need in plain language. Our AI parses locations, supplies, and urgency.' },
                { step: '02', name: 'Plan', desc: 'AI optimizes the route in seconds, accounting for weather, no-fly zones, and priorities.' },
                { step: '03', name: 'Deploy', desc: 'Drone launches autonomously from the nearest depot with your medical payload.' },
                { step: '04', name: 'Monitor', desc: 'Track every meter in real-time. Live telemetry, ETA, and delivery confirmation.' },
              ].map((item, i) => (
                <motion.div
                  key={item.step}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.3 }}
                  transition={{ duration: 0.5, delay: i * 0.1 }}
                  whileHover={{ scale: 1.04 }}
                  className="relative rounded-xl bg-surface-container-low/90 backdrop-blur-sm p-8 2xl:p-10 border border-outline-variant/10"
                >
                  <div className="font-headline text-4xl 2xl:text-5xl font-bold text-blue-300 mb-3">{item.step}</div>
                  <h3 className="text-lg 2xl:text-xl font-bold text-on-surface uppercase tracking-wide mb-2">{item.name}</h3>
                  <p className="text-sm 2xl:text-base text-on-surface-variant leading-relaxed">{item.desc}</p>
                  {i < 3 && (
                    <div className="hidden lg:block absolute -right-4 top-1/2 -translate-y-1/2 text-2xl text-outline-variant/30 z-10">&rarr;</div>
                  )}
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Drone Showcase ── */}
        <section id="drone" className="relative bg-surface-container-low py-32 2xl:py-40 overflow-visible">
          <div className="mx-auto max-w-[1440px] 2xl:max-w-[1800px] px-6 lg:px-20 2xl:px-28">
            <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2 lg:gap-24 2xl:gap-32">
              <div className="order-2 lg:order-1">
                <div className="relative overflow-hidden rounded-xl border border-outline-variant/20 shadow-2xl shadow-primary/10">
                  <img
                    alt="AeroRescue UAV Drone in field"
                    className="h-full w-full object-cover"
                    src={DRONE_IMG}
                  />
                </div>
              </div>
              <div className="order-1 space-y-8 2xl:space-y-10 lg:order-2">
                <div>
                  <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#b3c5ff]/20 bg-[#b3c5ff]/5 px-4 py-1 2xl:px-5 2xl:py-1.5 text-xs 2xl:text-sm font-bold uppercase tracking-widest text-[#b3c5ff]">
                    Technological Excellence
                  </div>
                  <h2 className="font-headline text-4xl font-bold tracking-tight text-on-surface md:text-5xl lg:text-6xl 2xl:text-7xl">
                    Engineered for the Unpredictable
                  </h2>
                </div>
                <p className="text-lg 2xl:text-xl leading-relaxed text-on-surface-variant">
                  Our flagship AeroRescue UAV is the pinnacle of medical logistics. Featuring multi-redundant flight controllers and a carbon-fiber airframe, it maintains operational integrity in extreme wind and thermal conditions.
                </p>
                <div className="grid grid-cols-2 gap-8">
                  <div className="space-y-1">
                    <div className="font-headline text-4xl 2xl:text-5xl font-bold text-blue-300">15kg</div>
                    <div className="text-[10px] 2xl:text-xs font-bold uppercase tracking-[0.2em] text-on-surface-variant">Payload Capacity</div>
                  </div>
                  <div className="space-y-1">
                    <div className="font-headline text-4xl 2xl:text-5xl font-bold text-blue-300">120km</div>
                    <div className="text-[10px] 2xl:text-xs font-bold uppercase tracking-[0.2em] text-on-surface-variant">Mission Range</div>
                  </div>
                </div>
                <div className="pt-4">
                  <button
                    onClick={() => navigate('/fleet-info')}
                    className="h-12 2xl:h-14 border border-outline-variant bg-transparent px-8 2xl:px-10 text-sm 2xl:text-base font-bold tracking-wide text-on-surface transition-colors hover:bg-surface-container-high cursor-pointer"
                  >
                    View Fleet Specifications
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── CTA Section ── */}
        <section id="cta" className="relative overflow-hidden py-32 2xl:py-40">
          {/* CTA background image */}
          <div className="absolute inset-0 z-0">
            <div
              className="absolute inset-0 bg-cover bg-center"
              style={{ backgroundImage: 'url(/images/city-aerial.jpg)' }}
            />
            <div className="absolute inset-0 bg-black/70" />
          </div>
          <div className="relative z-10 mx-auto max-w-[1440px] 2xl:max-w-[1800px] px-6 lg:px-20 2xl:px-28">
            <div className="glass-panel flex flex-col items-center rounded-2xl border border-outline-variant/15 bg-surface/60 backdrop-blur-xl p-12 text-center md:p-24 2xl:p-32">
              <div className="mb-8 rounded-full bg-[#b3c5ff]/10 p-4 2xl:p-5 text-[#b3c5ff]">
                <Rocket size={36} />
              </div>
              <h2 className="mb-6 font-headline text-4xl font-black tracking-tight text-on-surface md:text-6xl 2xl:text-7xl">
                Ready to revolutionize your medical logistics?
              </h2>
              <p className="mb-10 max-w-2xl 2xl:max-w-3xl text-lg 2xl:text-xl text-on-surface-variant">
                Join the global network of autonomous UAV delivery. Start your first mission in under 15 minutes with our rapid integration kits.
              </p>
              <div className="flex flex-col gap-4 sm:flex-row">
                <button
                  onClick={goToDashboard}
                  className="btn-primary-gradient h-14 2xl:h-16 px-10 2xl:px-12 rounded-lg text-base 2xl:text-lg font-bold text-white shadow-xl cursor-pointer"
                >
                  Get Started Now
                </button>
                <button
                  onClick={() => navigate('/contact')}
                  className="h-14 2xl:h-16 px-10 2xl:px-12 rounded-lg border border-outline-variant text-base 2xl:text-lg font-bold text-on-surface hover:bg-surface-container-high transition-colors cursor-pointer"
                >
                  Talk to Sales
                </button>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* ── Footer ── */}
      <footer id="footer" className="border-t border-outline-variant/15 bg-surface-container-lowest py-16 2xl:py-20">
        <div className="mx-auto max-w-[1440px] 2xl:max-w-[1800px] px-6 lg:px-20 2xl:px-28">
          <div className="grid grid-cols-1 gap-12 lg:grid-cols-4">
            <div className="space-y-6">
              <div className="flex items-center gap-3">
                <div className="text-primary">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
                    <path d="M13.8261 17.4264C16.7203 18.1174 20.2244 18.5217 24 18.5217C27.7756 18.5217 31.2797 18.1174 34.1739 17.4264C36.9144 16.7722 39.9967 15.2331 41.3563 14.1648L24.8486 40.6391C24.4571 41.267 23.5429 41.267 23.1514 40.6391L6.64374 14.1648C8.00331 15.2331 11.0856 16.7722 13.8261 17.4264Z" fill="currentColor" />
                  </svg>
                </div>
                <h2 className="font-headline text-lg 2xl:text-xl font-bold tracking-tight text-on-surface">DroneMedic</h2>
              </div>
              <p className="text-sm 2xl:text-base text-on-surface-variant">Leading the global transition to autonomous, zero-emission medical logistics.</p>
              <div className="flex gap-4">
                <button aria-label="Email" className="text-on-surface-variant transition-colors hover:text-primary cursor-pointer bg-transparent border-0 p-0" onClick={() => toast('Social links coming soon')}><AtSign size={20} /></button>
                <button aria-label="Share" className="text-on-surface-variant transition-colors hover:text-primary cursor-pointer bg-transparent border-0 p-0" onClick={() => toast('Social links coming soon')}><Share2 size={20} /></button>
                <button aria-label="Updates" className="text-on-surface-variant transition-colors hover:text-primary cursor-pointer bg-transparent border-0 p-0" onClick={() => toast('Social links coming soon')}><Radio size={20} /></button>
              </div>
            </div>
            <div>
              <h3 className="mb-6 text-sm 2xl:text-base font-bold uppercase tracking-widest text-on-surface">Platform</h3>
              <ul className="space-y-4 text-sm 2xl:text-base text-on-surface-variant">
                <li><Link className="hover:text-primary transition-colors" to="/missions">Mission Control</Link></li>
                <li><Link className="hover:text-primary transition-colors" to="/fleet-info">Fleet Management</Link></li>
                <li><Link className="hover:text-primary transition-colors" to="/technology">API Reference</Link></li>
                <li><Link className="hover:text-primary transition-colors" to="/safety">Safety Systems</Link></li>
              </ul>
            </div>
            <div>
              <h3 className="mb-6 text-sm 2xl:text-base font-bold uppercase tracking-widest text-on-surface">Resources</h3>
              <ul className="space-y-4 text-sm 2xl:text-base text-on-surface-variant">
                <li><Link className="hover:text-primary transition-colors" to="/resources">Case Studies</Link></li>
                <li><Link className="hover:text-primary transition-colors" to="/technology">Documentation</Link></li>
                <li><Link className="hover:text-primary transition-colors" to="/resources">Support Center</Link></li>
                <li><Link className="hover:text-primary transition-colors" to="/safety">Compliance</Link></li>
              </ul>
            </div>
            <div>
              <h3 className="mb-6 text-sm 2xl:text-base font-bold uppercase tracking-widest text-on-surface">Newsletter</h3>
              <p className="mb-4 text-sm 2xl:text-base text-on-surface-variant">Get the latest mission reports and system updates.</p>
              <div className="flex flex-col gap-2">
                <input className="h-11 2xl:h-13 rounded border-0 bg-surface-container-high text-sm 2xl:text-base text-on-surface focus:ring-2 focus:ring-primary px-4" placeholder="Email Address" type="email" />
                <button
                  onClick={() => toast.success('Subscribed! You\'ll receive mission reports and system updates.')}
                  className="btn-primary-gradient h-11 2xl:h-13 rounded text-sm 2xl:text-base font-bold text-white cursor-pointer"
                >
                  Subscribe
                </button>
              </div>
            </div>
          </div>
          <div className="mt-16 border-t border-outline-variant/15 pt-8 text-center text-xs 2xl:text-sm text-on-surface-variant">
            <p>&copy; 2025 DroneMedic Aerospace. All rights reserved. Precision in flight, reliability in care.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
