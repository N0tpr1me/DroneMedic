import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

const HERO_BG = 'https://lh3.googleusercontent.com/aida-public/AB6AXuDegnE09p9oEZn3jk_r-968fNEJSU9oB3irERyD0QzUIVPnetenp_ABerwN3ktEYtGfL6n1zTimCd-zLbUk_PsCsW7UMb-vo6z1ODapAAARskr8mmvsQ1UkZ70aGgUV7W9qS4q6JQSOs4QGB4PkEt3FzRDvDw0mVwPxEzDDcBnL4jetuUPVMJEo5sCyiR8bv3f_C00hWXASKzAqPfNnr97u9-YNtNbxdPEPhV96agJGUDlyPq0Bt52WkbZENdHuxpGyirGakL6X7Rbd';
const DRONE_IMG = '/drone-photo.png';

const DRONE_ICON_SVG = (
  <svg className="w-8 h-8" fill="none" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
    <path d="M13.8261 17.4264C16.7203 18.1174 20.2244 18.5217 24 18.5217C27.7756 18.5217 31.2797 18.1174 34.1739 17.4264C36.9144 16.7722 39.9967 15.2331 41.3563 14.1648L24.8486 40.6391C24.4571 41.267 23.5429 41.267 23.1514 40.6391L6.64374 14.1648C8.00331 15.2331 11.0856 16.7722 13.8261 17.4264Z" fill="currentColor" />
    <path clipRule="evenodd" d="M39.998 12.236C39.9944 12.2537 39.9875 12.2845 39.9748 12.3294C39.9436 12.4399 39.8949 12.5741 39.8346 12.7175C39.8168 12.7597 39.7989 12.8007 39.7813 12.8398C38.5103 13.7113 35.9788 14.9393 33.7095 15.4811C30.9875 16.131 27.6413 16.5217 24 16.5217C20.3587 16.5217 17.0125 16.131 14.2905 15.4811C12.0012 14.9346 9.44505 13.6897 8.18538 12.8168C8.17384 12.7925 8.16216 12.767 8.15052 12.7408C8.09919 12.6249 8.05721 12.5114 8.02977 12.411C8.00356 12.3152 8.00039 12.2667 8.00004 12.2612C8.00004 12.261 8 12.2607 8.00004 12.2612C8.00004 12.2359 8.0104 11.9233 8.68485 11.3686C9.34546 10.8254 10.4222 10.2469 11.9291 9.72276C14.9242 8.68098 19.1919 8 24 8C28.8081 8 33.0758 8.68098 36.0709 9.72276C37.5778 10.2469 38.6545 10.8254 39.3151 11.3686C39.9006 11.8501 39.9857 12.1489 39.998 12.236ZM4.95178 15.2312L21.4543 41.6973C22.6288 43.5809 25.3712 43.5809 26.5457 41.6973L43.0534 15.223C43.0709 15.1948 43.0878 15.1662 43.104 15.1371L41.3563 14.1648C43.104 15.1371 43.1038 15.1374 43.104 15.1371L43.1051 15.135L43.1065 15.1325L43.1101 15.1261L43.1199 15.1082C43.1276 15.094 43.1377 15.0754 43.1497 15.0527C43.1738 15.0075 43.2062 14.9455 43.244 14.8701C43.319 14.7208 43.4196 14.511 43.5217 14.2683C43.6901 13.8679 44 13.0689 44 12.2609C44 10.5573 43.003 9.22254 41.8558 8.2791C40.6947 7.32427 39.1354 6.55361 37.385 5.94477C33.8654 4.72057 29.133 4 24 4C18.867 4 14.1346 4.72057 10.615 5.94478C8.86463 6.55361 7.30529 7.32428 6.14419 8.27911C4.99695 9.22255 3.99999 10.5573 3.99999 12.2609C3.99999 13.1275 4.29264 13.9078 4.49321 14.3607C4.60375 14.6102 4.71348 14.8196 4.79687 14.9689C4.83898 15.0444 4.87547 15.1065 4.9035 15.1529C4.91754 15.1762 4.92954 15.1957 4.93916 15.2111L4.94662 15.223L4.95178 15.2312ZM35.9868 18.996L24 38.22L12.0131 18.996C12.4661 19.1391 12.9179 19.2658 13.3617 19.3718C16.4281 20.1039 20.0901 20.5217 24 20.5217C27.9099 20.5217 31.5719 20.1039 34.6383 19.3718C35.082 19.2658 35.5339 19.1391 35.9868 18.996Z" fill="currentColor" fillRule="evenodd" />
  </svg>
);

export function Landing() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const goToDashboard = () => navigate(user ? '/dashboard' : '/login');

  return (
    <div className="relative flex min-h-screen w-full flex-col overflow-x-hidden bg-bg text-on-surface font-body">
      {/* ── Header ── */}
      <header className="fixed top-0 z-50 w-full border-b border-outline-variant/15 bg-bg/80 backdrop-blur-md px-6 lg:px-20 py-4">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="text-blue-300">{DRONE_ICON_SVG}</div>
            <h2 className="font-headline text-xl font-bold tracking-tight text-on-surface">DroneMedic</h2>
          </div>
          <nav className="hidden items-center gap-10 md:flex">
            <a className="text-sm font-medium text-on-surface-variant transition-colors hover:text-primary" href="#capabilities">Missions</a>
            <a className="text-sm font-medium text-on-surface-variant transition-colors hover:text-primary" href="#drone">Fleet</a>
            <a className="text-sm font-medium text-on-surface-variant transition-colors hover:text-primary" href="#cta">Telemetry</a>
            <a className="text-sm font-medium text-on-surface-variant transition-colors hover:text-primary" href="#footer">Safety</a>
          </nav>
          <button
            onClick={goToDashboard}
            className="btn-primary-gradient flex h-11 items-center justify-center rounded px-6 text-sm font-bold tracking-wide text-white transition-transform hover:scale-105 active:scale-95 cursor-pointer"
          >
            Launch Dashboard
          </button>
        </div>
      </header>

      <main className="flex-1">
        {/* ── Hero ── */}
        <section className="relative flex min-h-screen flex-col items-center justify-center pb-40 pt-20">
          <div className="absolute inset-0 z-0 overflow-hidden">
            <img
              alt="Earth from space with glowing city lights"
              className="h-full w-full object-cover opacity-80"
              src={HERO_BG}
            />
            <div className="absolute inset-0 z-10" style={{ background: 'linear-gradient(180deg, rgba(15,20,24,0) 0%, rgba(15,20,24,0.95) 100%)' }} />
          </div>

          <svg className="absolute inset-0 z-20 h-full w-full opacity-40 pointer-events-none" fill="none" viewBox="0 0 1440 800">
            <path d="M-100 600 C 300 400, 800 500, 1540 100" stroke="#00DAF3" strokeDasharray="10 5" strokeWidth="2" />
            <path d="M-200 400 C 400 600, 900 200, 1640 500" stroke="#b3c5ff" strokeOpacity="0.6" strokeWidth="1.5" />
            <path d="M200 800 C 600 300, 1100 600, 1440 200" stroke="#00DAF3" strokeDasharray="20 10" strokeWidth="1" />
            <circle cx="800" cy="450" fill="#00DAF3" r="4" className="animate-pulse" />
            <circle cx="1100" cy="280" fill="#b3c5ff" r="3" className="animate-pulse" style={{ animationDelay: '1s' }} />
          </svg>

          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="relative z-30 mx-auto max-w-[1440px] px-6 text-center lg:px-20"
          >
            <div className="mx-auto max-w-4xl space-y-7">
              <div className="inline-flex items-center gap-2 rounded-full border border-tertiary/20 bg-tertiary/5 px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.15em] text-tertiary">
                <span className="flex h-2 w-2 rounded-full bg-tertiary animate-pulse" />
                AeroRescue Control: Online
              </div>
              <h1 className="font-headline text-5xl font-black leading-[1.1] tracking-tight text-on-surface md:text-6xl lg:text-7xl">
                The Future of<br /> <span className="text-blue-300">Medical</span> Logistics
              </h1>
              <p className="mx-auto max-w-xl text-base leading-relaxed text-on-surface-variant md:text-lg">
                Autonomous UAV delivery systems for life-critical medical supplies. Engineered for precision, built for urgency.
              </p>
              <div className="flex justify-center pt-2">
                <button
                  onClick={goToDashboard}
                  className="btn-primary-gradient h-12 px-8 rounded-lg text-sm font-bold text-white transition-all hover:shadow-[0_0_30px_rgba(0,81,206,0.4)] cursor-pointer"
                >
                  Launch Dashboard
                </button>
              </div>
            </div>
          </motion.div>

          {/* Stats bar */}
          <div className="absolute bottom-0 z-30 w-full bg-surface-container-low/80 py-8 backdrop-blur-xl border-t border-outline-variant/10">
            <div className="mx-auto max-w-[1440px] px-6 lg:px-20">
              <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
                <div className="flex flex-col items-center gap-2 text-center md:items-start md:text-left">
                  <span className="text-xs font-bold uppercase tracking-widest text-on-surface-variant">Flight Stability</span>
                  <div className="flex items-baseline gap-2">
                    <span className="font-headline text-4xl font-bold text-blue-300">99.9%</span>
                    <span className="text-xs font-medium text-tertiary">&#9650; 0.1%</span>
                  </div>
                </div>
                <div className="flex flex-col items-center gap-2 text-center md:items-start md:text-left">
                  <span className="text-xs font-bold uppercase tracking-widest text-on-surface-variant">Avg. Response Time</span>
                  <div className="flex items-baseline gap-2">
                    <span className="font-headline text-4xl font-bold text-blue-300">12m</span>
                    <span className="text-xs font-bold text-red-500">&#9660; 2m</span>
                  </div>
                </div>
                <div className="flex flex-col items-center gap-2 text-center md:items-start md:text-left">
                  <span className="text-xs font-bold uppercase tracking-widest text-on-surface-variant">Global Fleet</span>
                  <div className="flex items-baseline gap-2">
                    <span className="font-headline text-4xl font-bold text-blue-300">Ready</span>
                    <span className="text-xs font-medium text-tertiary">Active 24/7</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Core Mission Capabilities ── */}
        <section id="capabilities" className="bg-surface py-24 lg:py-40">
          <div className="mx-auto max-w-[1440px] px-6 lg:px-20">
            <div className="mb-16 max-w-2xl lg:mb-24">
              <h2 className="mb-6 font-headline text-4xl font-bold tracking-tight text-on-surface md:text-5xl">Core Mission Capabilities</h2>
              <p className="text-lg text-on-surface-variant">Advanced AI-driven logistics for life-critical operations. Our platform integrates state-of-the-art UAV technology with proprietary AI orchestration.</p>
            </div>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              {[
                {
                  icon: 'chat',
                  bgIcon: 'smart_toy',
                  title: 'AI Mission Coordinator',
                  desc: 'Interpreting natural language tasks for seamless mission planning. Our LLM-integrated core allows medical staff to initiate deliveries with simple verbal or text instructions.',
                  linkText: 'Learn More',
                  accentColor: 'primary',
                },
                {
                  icon: 'public',
                  bgIcon: 'public',
                  title: 'Real-time Telemetry',
                  desc: 'Dynamic day and night mapping with active flight path tracking. Monitor every vector of your fleet\'s journey with millisecond latency and high-fidelity 3D visualization.',
                  linkText: 'Live Dashboard',
                  accentColor: 'tertiary',
                },
                {
                  icon: 'verified_user',
                  bgIcon: 'security',
                  title: 'Autonomous Detection',
                  desc: 'Computer vision-powered safety systems for complex environments. Our UAVs utilize neural networks to navigate dense urban areas and unpredictable weather patterns.',
                  linkText: 'Safety Protocols',
                  accentColor: 'secondary',
                },
              ].map((card) => (
                <div key={card.title} className="group relative flex flex-col justify-between overflow-hidden rounded-xl bg-surface-container-low p-8 transition-all hover:bg-surface-container-high">
                  <div className={`absolute -right-4 -top-4 transition-transform duration-500 group-hover:scale-110 ${
                    card.accentColor === 'primary' ? 'text-primary/15 group-hover:text-primary/25' :
                    card.accentColor === 'tertiary' ? 'text-tertiary/15 group-hover:text-tertiary/25' :
                    'text-red-500/20 group-hover:text-red-500/35'
                  }`}>
                    <span className="material-symbols-outlined" style={{ fontSize: '120px' }}>{card.bgIcon}</span>
                  </div>
                  <div className="relative z-10 space-y-4">
                    <div className={`inline-flex h-12 w-12 items-center justify-center rounded-lg ${
                      card.accentColor === 'primary' ? 'bg-primary-container text-primary' :
                      card.accentColor === 'tertiary' ? 'bg-tertiary-container text-tertiary' :
                      'bg-red-900/50 text-red-400'
                    }`}>
                      <span className="material-symbols-outlined">{card.icon}</span>
                    </div>
                    <h3 className="font-headline text-2xl font-bold text-on-surface">{card.title}</h3>
                    <p className="text-on-surface-variant">{card.desc}</p>
                  </div>
                  <div className={`mt-8 flex items-center text-sm font-bold ${
                    card.accentColor === 'primary' ? 'text-primary' :
                    card.accentColor === 'tertiary' ? 'text-tertiary' :
                    'text-red-400'
                  }`}>
                    <span>{card.linkText}</span>
                    <span className="material-symbols-outlined ml-2 text-sm">arrow_forward</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Drone Showcase ── */}
        <section id="drone" className="relative bg-surface-container-low py-32 overflow-visible">
          <div className="mx-auto max-w-[1440px] px-6 lg:px-20">
            <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2 lg:gap-24">
              <div className="order-2 lg:order-1">
                <div className="relative overflow-hidden rounded-xl border border-outline-variant/20 shadow-2xl shadow-primary/10">
                  <img
                    alt="AeroRescue UAV Drone in field"
                    className="h-full w-full object-cover"
                    src={DRONE_IMG}
                  />
                </div>
              </div>
              <div className="order-1 space-y-8 lg:order-2">
                <div>
                  <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#b3c5ff]/20 bg-[#b3c5ff]/5 px-4 py-1 text-xs font-bold uppercase tracking-widest text-[#b3c5ff]">
                    Technological Excellence
                  </div>
                  <h2 className="font-headline text-4xl font-bold tracking-tight text-on-surface md:text-5xl lg:text-6xl">
                    Engineered for the Unpredictable
                  </h2>
                </div>
                <p className="text-lg leading-relaxed text-on-surface-variant">
                  Our flagship AeroRescue UAV is the pinnacle of medical logistics. Featuring multi-redundant flight controllers and a carbon-fiber airframe, it maintains operational integrity in extreme wind and thermal conditions.
                </p>
                <div className="grid grid-cols-2 gap-8">
                  <div className="space-y-1">
                    <div className="font-headline text-4xl font-bold text-blue-300">15kg</div>
                    <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-on-surface-variant">Payload Capacity</div>
                  </div>
                  <div className="space-y-1">
                    <div className="font-headline text-4xl font-bold text-blue-300">120km</div>
                    <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-on-surface-variant">Mission Range</div>
                  </div>
                </div>
                <div className="pt-4">
                  <button className="h-12 border border-outline-variant bg-transparent px-8 text-sm font-bold tracking-wide text-on-surface transition-colors hover:bg-surface-container-high cursor-pointer">
                    View Fleet Specifications
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── CTA Section ── */}
        <section id="cta" className="relative overflow-hidden bg-bg py-32">
          <div className="mx-auto max-w-[1440px] px-6 lg:px-20">
            <div className="glass-panel flex flex-col items-center rounded-2xl border border-outline-variant/15 p-12 text-center md:p-24">
              <div className="mb-8 rounded-full bg-[#b3c5ff]/10 p-4 text-[#b3c5ff]">
                <span className="material-symbols-outlined" style={{ fontSize: '36px' }}>rocket_launch</span>
              </div>
              <h2 className="mb-6 font-headline text-4xl font-black tracking-tight text-on-surface md:text-6xl">
                Ready to revolutionize your medical logistics?
              </h2>
              <p className="mb-10 max-w-2xl text-lg text-on-surface-variant">
                Join the global network of autonomous UAV delivery. Start your first mission in under 15 minutes with our rapid integration kits.
              </p>
              <div className="flex flex-col gap-4 sm:flex-row">
                <button
                  onClick={goToDashboard}
                  className="btn-primary-gradient h-14 px-10 rounded-lg text-base font-bold text-white shadow-xl cursor-pointer"
                >
                  Get Started Now
                </button>
                <button className="h-14 px-10 rounded-lg border border-outline-variant text-base font-bold text-on-surface hover:bg-surface-container-high transition-colors cursor-pointer">
                  Talk to Sales
                </button>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* ── Footer ── */}
      <footer id="footer" className="border-t border-outline-variant/15 bg-surface-container-lowest py-16">
        <div className="mx-auto max-w-[1440px] px-6 lg:px-20">
          <div className="grid grid-cols-1 gap-12 lg:grid-cols-4">
            <div className="space-y-6">
              <div className="flex items-center gap-3">
                <div className="text-primary">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
                    <path d="M13.8261 17.4264C16.7203 18.1174 20.2244 18.5217 24 18.5217C27.7756 18.5217 31.2797 18.1174 34.1739 17.4264C36.9144 16.7722 39.9967 15.2331 41.3563 14.1648L24.8486 40.6391C24.4571 41.267 23.5429 41.267 23.1514 40.6391L6.64374 14.1648C8.00331 15.2331 11.0856 16.7722 13.8261 17.4264Z" fill="currentColor" />
                  </svg>
                </div>
                <h2 className="font-headline text-lg font-bold tracking-tight text-on-surface">DroneMedic</h2>
              </div>
              <p className="text-sm text-on-surface-variant">Leading the global transition to autonomous, zero-emission medical logistics.</p>
              <div className="flex gap-4">
                <a className="text-on-surface-variant transition-colors hover:text-primary" href="#"><span className="material-symbols-outlined">alternate_email</span></a>
                <a className="text-on-surface-variant transition-colors hover:text-primary" href="#"><span className="material-symbols-outlined">share</span></a>
                <a className="text-on-surface-variant transition-colors hover:text-primary" href="#"><span className="material-symbols-outlined">podcasts</span></a>
              </div>
            </div>
            <div>
              <h4 className="mb-6 text-sm font-bold uppercase tracking-widest text-on-surface">Platform</h4>
              <ul className="space-y-4 text-sm text-on-surface-variant">
                <li><a className="hover:text-primary transition-colors" href="#">Mission Control</a></li>
                <li><a className="hover:text-primary transition-colors" href="#">Fleet Management</a></li>
                <li><a className="hover:text-primary transition-colors" href="#">API Reference</a></li>
                <li><a className="hover:text-primary transition-colors" href="#">Safety Systems</a></li>
              </ul>
            </div>
            <div>
              <h4 className="mb-6 text-sm font-bold uppercase tracking-widest text-on-surface">Resources</h4>
              <ul className="space-y-4 text-sm text-on-surface-variant">
                <li><a className="hover:text-primary transition-colors" href="#">Case Studies</a></li>
                <li><a className="hover:text-primary transition-colors" href="#">Documentation</a></li>
                <li><a className="hover:text-primary transition-colors" href="#">Support Center</a></li>
                <li><a className="hover:text-primary transition-colors" href="#">Compliance</a></li>
              </ul>
            </div>
            <div>
              <h4 className="mb-6 text-sm font-bold uppercase tracking-widest text-on-surface">Newsletter</h4>
              <p className="mb-4 text-sm text-on-surface-variant">Get the latest mission reports and system updates.</p>
              <div className="flex flex-col gap-2">
                <input className="h-11 rounded border-0 bg-surface-container-high text-sm text-on-surface focus:ring-2 focus:ring-primary px-4" placeholder="Email Address" type="email" />
                <button className="btn-primary-gradient h-11 rounded text-sm font-bold text-white cursor-pointer">Subscribe</button>
              </div>
            </div>
          </div>
          <div className="mt-16 border-t border-outline-variant/15 pt-8 text-center text-xs text-on-surface-variant">
            <p>&copy; 2024 DroneMedic Aerospace. All rights reserved. Precision in flight, reliability in care.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
