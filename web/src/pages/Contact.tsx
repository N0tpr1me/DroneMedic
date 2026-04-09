import { useState, useRef } from 'react';
import { motion, useInView } from 'framer-motion';
import { Mail, Phone, MapPin, Building2, Headphones, Handshake, Check } from 'lucide-react';
import { toast } from 'sonner';
import { InfoPageLayout } from '../components/layout/InfoPageLayout';

const fadeUp = {
  initial: { opacity: 0, y: 20 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true },
};

const INTEREST_OPTIONS = [
  'Medical Delivery',
  'Emergency Response',
  'Research Partnership',
  'Enterprise Deployment',
  'Other',
];

const CONTACT_CARDS = [
  {
    icon: Building2,
    title: 'Sales Inquiries',
    email: 'sales@dronemedic.aero',
    detail: 'Response within 4 hours',
  },
  {
    icon: Headphones,
    title: 'Technical Support',
    email: 'support@dronemedic.aero',
    detail: '24/7 for active missions',
  },
  {
    icon: Handshake,
    title: 'Partnerships',
    email: 'partners@dronemedic.aero',
    detail: 'Research & institutional collaborations',
  },
];

const PLANS = [
  {
    name: 'Starter',
    highlighted: false,
    features: [
      '1-3 drones',
      'Single depot',
      'Basic dashboard',
      'Email support',
    ],
  },
  {
    name: 'Professional',
    highlighted: true,
    features: [
      '4-12 drones',
      'Multi-depot network',
      'Advanced analytics',
      'Priority support + SLA',
    ],
  },
  {
    name: 'Enterprise',
    highlighted: false,
    features: [
      'Unlimited fleet',
      'Custom integration',
      'Dedicated account team',
      '24/7 phone support',
      'On-premise option',
    ],
  },
];

const OFFICES = [
  {
    city: 'London HQ',
    address: '10 Finsbury Square, London EC2A 1AF, United Kingdom',
  },
  {
    city: 'San Francisco',
    address: '100 California St, Suite 800, San Francisco, CA 94111',
  },
  {
    city: 'Singapore',
    address: '1 Raffles Place, #20-61, Singapore 048616',
  },
];

interface FormState {
  fullName: string;
  email: string;
  organization: string;
  interest: string;
  message: string;
}

const INITIAL_FORM: FormState = {
  fullName: '',
  email: '',
  organization: '',
  interest: '',
  message: '',
};

function BouncingMapPin() {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true });

  return (
    <motion.div
      ref={ref}
      animate={
        isInView
          ? { y: [0, -6, 0, -3, 0] }
          : { y: 0 }
      }
      transition={{ duration: 0.8, ease: 'easeOut', delay: 0.3 }}
      className="mb-3 w-fit"
    >
      <MapPin size={24} className="text-blue-300" />
    </motion.div>
  );
}

export function Contact() {
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const formRef = useRef<HTMLDivElement>(null);

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
  ) {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    toast.success('Message sent! Our team will respond within 24 hours.');
    setForm(INITIAL_FORM);
  }

  function scrollToForm() {
    formRef.current?.scrollIntoView({ behavior: 'smooth' });
  }

  return (
    <InfoPageLayout>
      {/* ── Hero ── */}
      <section className="relative bg-bg py-24 lg:py-32 2xl:py-40 overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: "url('/images/city-aerial.jpg')" }}
        />
        <div className="absolute inset-0 bg-black/75" />
        <div className="relative mx-auto max-w-[1440px] 2xl:max-w-[1800px] px-6 lg:px-20 2xl:px-28 text-center">
          <motion.div {...fadeUp} transition={{ duration: 0.6 }}>
            <div className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-tertiary/20 bg-tertiary/5 px-4 py-1.5 2xl:px-5 2xl:py-2 text-[11px] 2xl:text-[13px] font-bold uppercase tracking-[0.15em] text-tertiary">
              <span className="flex h-2 w-2 2xl:h-2.5 2xl:w-2.5 rounded-full bg-tertiary animate-pulse" />
              Contact Us
            </div>
            <h1 className="font-headline text-4xl font-black leading-[1.1] tracking-tight text-on-surface md:text-5xl lg:text-6xl 2xl:text-7xl">
              Get in Touch
            </h1>
            <p className="mx-auto mt-6 max-w-2xl 2xl:max-w-3xl text-base leading-relaxed text-on-surface-variant md:text-lg 2xl:text-xl">
              Whether you're exploring drone delivery for your healthcare network or ready to deploy, our team is here to help.
            </p>
          </motion.div>
        </div>
      </section>

      {/* ── Contact Form + Info ── */}
      <section className="bg-surface py-24 lg:py-32 2xl:py-40">
        <div
          ref={formRef}
          className="mx-auto max-w-[1440px] 2xl:max-w-[1800px] px-6 lg:px-20 2xl:px-28"
        >
          <div className="grid gap-12 lg:grid-cols-2 lg:items-start">
            {/* Left: Form */}
            <motion.div {...fadeUp} transition={{ duration: 0.6 }}>
              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label className="mb-1.5 block text-sm 2xl:text-base font-medium text-on-surface">
                    Full Name
                  </label>
                  <input
                    type="text"
                    name="fullName"
                    value={form.fullName}
                    onChange={handleChange}
                    required
                    className="w-full h-11 2xl:h-13 rounded border-0 bg-surface-container-high text-sm 2xl:text-base text-on-surface focus:ring-2 focus:ring-primary px-4"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-sm 2xl:text-base font-medium text-on-surface">
                    Email Address
                  </label>
                  <input
                    type="email"
                    name="email"
                    value={form.email}
                    onChange={handleChange}
                    required
                    className="w-full h-11 2xl:h-13 rounded border-0 bg-surface-container-high text-sm 2xl:text-base text-on-surface focus:ring-2 focus:ring-primary px-4"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-sm 2xl:text-base font-medium text-on-surface">
                    Organization
                  </label>
                  <input
                    type="text"
                    name="organization"
                    value={form.organization}
                    onChange={handleChange}
                    className="w-full h-11 2xl:h-13 rounded border-0 bg-surface-container-high text-sm 2xl:text-base text-on-surface focus:ring-2 focus:ring-primary px-4"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-sm 2xl:text-base font-medium text-on-surface">
                    Interest
                  </label>
                  <select
                    name="interest"
                    value={form.interest}
                    onChange={handleChange}
                    required
                    className="w-full h-11 2xl:h-13 rounded border-0 bg-surface-container-high text-sm 2xl:text-base text-on-surface focus:ring-2 focus:ring-primary px-4"
                  >
                    <option value="" disabled>
                      Select an option
                    </option>
                    {INTEREST_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1.5 block text-sm 2xl:text-base font-medium text-on-surface">
                    Message
                  </label>
                  <textarea
                    name="message"
                    value={form.message}
                    onChange={handleChange}
                    rows={4}
                    required
                    className="w-full rounded border-0 bg-surface-container-high text-sm 2xl:text-base text-on-surface focus:ring-2 focus:ring-primary px-4 py-3"
                  />
                </div>

                <button
                  type="submit"
                  className="btn-primary-gradient h-12 2xl:h-14 w-full rounded-lg text-sm 2xl:text-base font-bold text-white transition-all hover:shadow-[0_0_30px_rgba(0,81,206,0.4)] hover:scale-105 active:scale-95 cursor-pointer"
                >
                  Send Message
                </button>
              </form>
            </motion.div>

            {/* Right: Contact Info Cards */}
            <motion.div
              {...fadeUp}
              transition={{ duration: 0.6, delay: 0.15 }}
              className="space-y-5"
            >
              {CONTACT_CARDS.map((card) => (
                <div
                  key={card.title}
                  className="rounded-xl bg-surface-container-low p-8 2xl:p-10 border border-outline-variant/10"
                >
                  <motion.div
                    animate={{ scale: [1, 1.15, 1] }}
                    transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                    className="mb-3 w-fit"
                  >
                    <card.icon size={24} className="text-blue-300" />
                  </motion.div>
                  <h3 className="font-headline text-lg 2xl:text-xl font-bold text-on-surface">
                    {card.title}
                  </h3>
                  <p className="mt-1 text-sm 2xl:text-base text-blue-300 font-medium">
                    {card.email}
                  </p>
                  <p className="mt-1 text-sm 2xl:text-base leading-relaxed text-on-surface-variant">
                    {card.detail}
                  </p>
                </div>
              ))}
            </motion.div>
          </div>
        </div>
      </section>

      {/* ── Enterprise Plans ── */}
      <section className="bg-bg py-24 lg:py-32 2xl:py-40">
        <div className="mx-auto max-w-[1440px] 2xl:max-w-[1800px] px-6 lg:px-20 2xl:px-28">
          <motion.div {...fadeUp} transition={{ duration: 0.6 }}>
            <h2 className="font-headline text-3xl font-bold tracking-tight text-on-surface md:text-4xl 2xl:text-5xl text-center">
              Enterprise Deployment
            </h2>
          </motion.div>

          <div className="mt-14 2xl:mt-18 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {PLANS.map((plan, i) => (
              <motion.div
                key={plan.name}
                {...fadeUp}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                whileHover={{ scale: 1.03, borderColor: 'rgba(96,165,250,0.5)' }}
                className={`rounded-xl p-8 2xl:p-10 border transition-colors ${
                  plan.highlighted
                    ? 'border-primary/30 bg-surface-container-low ring-1 ring-primary/20'
                    : 'border-outline-variant/10 bg-surface-container-low'
                }`}
              >
                <h3 className="font-headline text-xl 2xl:text-2xl font-bold text-on-surface">
                  {plan.name}
                </h3>
                <ul className="mt-6 space-y-3">
                  {plan.features.map((feat) => (
                    <li key={feat} className="flex items-start gap-2 text-sm 2xl:text-base text-on-surface-variant">
                      <Check size={16} className="mt-0.5 shrink-0 text-blue-300" />
                      {feat}
                    </li>
                  ))}
                </ul>
                <button
                  onClick={scrollToForm}
                  className={`mt-8 h-11 2xl:h-13 w-full rounded-lg text-sm 2xl:text-base font-bold transition-all hover:scale-105 active:scale-95 cursor-pointer ${
                    plan.highlighted
                      ? 'btn-primary-gradient text-white hover:shadow-[0_0_30px_rgba(0,81,206,0.4)]'
                      : 'border border-outline-variant/20 bg-surface text-on-surface hover:bg-surface-container-high'
                  }`}
                >
                  Contact Sales
                </button>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Offices ── */}
      <section className="bg-surface py-24 lg:py-32 2xl:py-40">
        <div className="mx-auto max-w-[1440px] 2xl:max-w-[1800px] px-6 lg:px-20 2xl:px-28">
          <motion.div {...fadeUp} transition={{ duration: 0.6 }}>
            <h2 className="font-headline text-3xl font-bold tracking-tight text-on-surface md:text-4xl 2xl:text-5xl text-center">
              Our Locations
            </h2>
          </motion.div>

          <div className="mt-14 2xl:mt-18 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {OFFICES.map((office, i) => (
              <motion.div
                key={office.city}
                {...fadeUp}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                className="rounded-xl bg-surface-container-low p-8 2xl:p-10 border border-outline-variant/10"
              >
                <BouncingMapPin />
                <h3 className="font-headline text-lg 2xl:text-xl font-bold text-on-surface">
                  {office.city}
                </h3>
                <p className="mt-2 text-sm 2xl:text-base leading-relaxed text-on-surface-variant">
                  {office.address}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>
    </InfoPageLayout>
  );
}
