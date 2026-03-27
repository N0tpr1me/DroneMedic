import { useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

const EARTH_BG = '/earth-bg.png';

export function Signup() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const { signUp } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await signUp(email, password);
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign up failed');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center overflow-hidden relative">
        <div className="fixed inset-0 z-0 bg-bg">
          <img alt="Globe Background" className="w-full h-full object-cover opacity-60" src={EARTH_BG} />
          <div className="absolute inset-0 bg-gradient-to-r from-bg via-bg/40 to-transparent" />
        </div>
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="relative z-10 glass-panel p-8 lg:p-10 rounded-xl shadow-2xl w-full max-w-md text-center"
        >
          <span className="material-symbols-outlined text-tertiary text-5xl mb-4">check_circle</span>
          <h2 className="font-headline text-xl font-bold text-on-surface mb-2">Account Created</h2>
          <p className="text-sm text-on-surface-variant mb-6">Check your email for a confirmation link.</p>
          <button
            onClick={() => navigate('/login')}
            className="w-full btn-primary-gradient py-4 rounded-md font-headline font-bold text-on-primary-fixed uppercase tracking-widest cursor-pointer"
          >
            Go to Login
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center overflow-hidden relative">
      {/* Background */}
      <div className="fixed inset-0 z-0 bg-bg">
        <img alt="Globe Background" className="w-full h-full object-cover opacity-60" src={EARTH_BG} />
        <div className="absolute inset-0 bg-gradient-to-r from-bg via-bg/40 to-transparent" />
      </div>

      <main className="relative z-10 w-full max-w-[1200px] px-6 flex flex-col md:flex-row items-center gap-12 lg:gap-24">
        {/* Left: Branding */}
        <motion.div
          initial={{ opacity: 0, x: -30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6 }}
          className="w-full md:w-1/2 space-y-8 text-center md:text-left"
        >
          <div className="space-y-4">
            <div className="flex items-center justify-center md:justify-start gap-3">
              <span className="material-symbols-outlined text-primary text-4xl">medical_services</span>
              <h1 className="font-headline font-black text-3xl tracking-widest uppercase text-on-surface">DroneMedic</h1>
            </div>
            <h2 className="font-headline text-5xl lg:text-7xl font-bold tracking-tight leading-none text-on-surface">
              JOIN THE <br /><span className="text-primary">MISSION</span>
            </h2>
            <p className="text-on-surface-variant text-lg max-w-md mx-auto md:mx-0 font-light leading-relaxed">
              Create your operator account and begin coordinating life-saving drone deliveries.
            </p>
          </div>
          <div className="flex items-center justify-center md:justify-start gap-6 pt-4">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-tertiary" style={{ boxShadow: '0 0 8px #00daf3' }} />
              <span className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant">System Live</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-tertiary" style={{ boxShadow: '0 0 8px #00daf3' }} />
              <span className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant">Fleet Secure</span>
            </div>
          </div>
        </motion.div>

        {/* Right: Signup Form */}
        <motion.div
          initial={{ opacity: 0, x: 30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6, delay: 0.15 }}
          className="w-full md:w-[440px]"
        >
          <div className="glass-panel p-8 lg:p-10 rounded-xl shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 btn-primary-gradient" />

            <div className="mb-10 text-center md:text-left">
              <h3 className="font-headline text-2xl font-bold text-on-surface mb-2">Create Account</h3>
              <p className="text-on-surface-variant text-sm">Register for Mission Control access.</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-2">
                <label className="font-label text-[11px] uppercase tracking-widest text-on-surface-variant flex items-center gap-2">
                  <span className="material-symbols-outlined text-sm">alternate_email</span>
                  Email Address
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="coordinator@dronemedic.ai"
                  required
                  className="w-full bg-surface-container-lowest border-none text-on-surface placeholder:text-outline-variant/50 px-4 py-4 rounded-md focus:outline-none focus:ring-0 focus:bg-surface-bright transition-all duration-200 border-b-2 border-transparent focus:border-b-primary"
                />
              </div>

              <div className="space-y-2">
                <label className="font-label text-[11px] uppercase tracking-widest text-on-surface-variant flex items-center gap-2">
                  <span className="material-symbols-outlined text-sm">lock</span>
                  Secure Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  required
                  minLength={6}
                  className="w-full bg-surface-container-lowest border-none text-on-surface placeholder:text-outline-variant/50 px-4 py-4 rounded-md focus:outline-none focus:ring-0 focus:bg-surface-bright transition-all duration-200 border-b-2 border-transparent focus:border-b-primary"
                />
              </div>

              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-center gap-2 text-sm text-error bg-error-container/20 p-3 rounded-md"
                >
                  <span className="material-symbols-outlined text-base">error</span>
                  {error}
                </motion.div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full btn-primary-gradient py-4 rounded-md font-headline font-bold text-on-primary-fixed uppercase tracking-widest flex items-center justify-center gap-3 active:scale-[0.98] transition-all duration-200 shadow-lg shadow-primary-container/20 cursor-pointer disabled:opacity-50"
              >
                {loading ? 'Creating Account...' : 'Create Account'}
                <span className="material-symbols-outlined text-lg">arrow_forward</span>
              </button>
            </form>

            <div className="mt-6 text-center text-sm text-on-surface-variant">
              Already have an account?{' '}
              <Link to="/login" className="text-primary hover:text-primary/80 font-medium transition-colors">Sign in</Link>
            </div>

            <div className="mt-8 pt-6 border-t border-outline-variant/15 flex items-center justify-between">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-on-surface-variant/60">
                <span className="material-symbols-outlined text-sm">verified_user</span>
                AES-256 Encrypted
              </div>
              <div className="flex gap-3">
                <span className="material-symbols-outlined text-on-surface-variant/40 hover:text-on-surface cursor-pointer text-lg">help_center</span>
                <span className="material-symbols-outlined text-on-surface-variant/40 hover:text-on-surface cursor-pointer text-lg">info</span>
              </div>
            </div>
          </div>
        </motion.div>
      </main>

      {/* Bottom telemetry */}
      <div className="hidden lg:block fixed bottom-8 left-8 z-20 space-y-1">
        <div className="flex items-center gap-4 text-[10px] font-label tracking-[0.2em] text-on-surface-variant/40">
          <span>LATENCY: 14MS</span>
          <span className="w-1 h-1 bg-outline-variant/30 rounded-full" />
          <span>NODE: LHR-04</span>
          <span className="w-1 h-1 bg-outline-variant/30 rounded-full" />
          <span>VER: 4.2.0-STABLE</span>
        </div>
      </div>
    </div>
  );
}
