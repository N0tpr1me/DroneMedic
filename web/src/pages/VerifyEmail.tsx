import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

const EARTH_BG = '/earth-bg.png';

export function VerifyEmail() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();

  // If user is already verified, redirect to dashboard
  if (user?.email_confirmed_at) {
    navigate('/dashboard', { replace: true });
    return null;
  }

  return (
    <div className="min-h-screen flex items-center justify-center overflow-hidden relative">
      <div className="fixed inset-0 z-0 bg-bg">
        <img alt="Globe Background" className="w-full h-full object-cover opacity-60" src={EARTH_BG} />
        <div className="absolute inset-0 bg-gradient-to-r from-bg via-bg/40 to-transparent" />
      </div>

      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="relative z-10 glass-panel p-8 lg:p-12 rounded-xl shadow-2xl w-full max-w-md text-center"
      >
        <div className="absolute top-0 left-0 w-full h-1 btn-primary-gradient" />

        <div className="mb-6 mx-auto w-16 h-16 rounded-full flex items-center justify-center" style={{ background: 'rgba(0,218,243,0.1)' }}>
          <span className="material-symbols-outlined text-4xl" style={{ color: '#00daf3' }}>mark_email_read</span>
        </div>

        <h2 className="font-headline text-2xl font-bold text-on-surface mb-3">Verify Your Email</h2>

        <p className="text-on-surface-variant text-sm leading-relaxed mb-2">
          We've sent a confirmation link to:
        </p>
        <p className="text-[#b3c5ff] font-headline font-bold text-base mb-6">
          {user?.email || 'your email'}
        </p>
        <p className="text-on-surface-variant text-sm leading-relaxed mb-8">
          Click the link in the email to activate your account. Check your spam folder if you don't see it.
        </p>

        <div className="flex flex-col gap-3">
          <button
            onClick={() => window.location.reload()}
            className="w-full btn-primary-gradient py-3.5 rounded-md font-headline font-bold text-on-primary-fixed uppercase tracking-widest flex items-center justify-center gap-2 cursor-pointer active:scale-[0.98] transition-all"
          >
            <span className="material-symbols-outlined text-lg">refresh</span>
            I've Verified — Continue
          </button>

          <button
            onClick={async () => { await signOut(); navigate('/login'); }}
            className="w-full py-3 rounded-md font-label text-[11px] uppercase tracking-widest text-on-surface-variant hover:text-on-surface cursor-pointer transition-colors"
            style={{ background: 'rgba(67,70,84,0.15)', border: '1px solid rgba(67,70,84,0.2)' }}
          >
            Sign in with a different account
          </button>
        </div>

        <div className="mt-8 pt-6 border-t border-outline-variant/15">
          <div className="flex items-center justify-center gap-2 text-[10px] uppercase tracking-widest text-on-surface-variant/50">
            <span className="material-symbols-outlined text-sm">verified_user</span>
            AES-256 Encrypted
          </div>
        </div>
      </motion.div>
    </div>
  );
}
