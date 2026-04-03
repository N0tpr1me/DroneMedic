import { Link, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { BatteryFull, Signal, MapPin, LogOut } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';

export function Navbar() {
  const { user, signOut } = useAuth();
  const location = useLocation();
  const isLanding = location.pathname === '/';
  const isDashboard = location.pathname === '/dashboard';

  // Landing page: fully transparent minimal nav
  if (isLanding) {
    return (
      <motion.header
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5, duration: 0.8 }}
        className="fixed top-0 w-full z-50 flex justify-between items-center px-8 py-5"
      >
        <Link
          to="/#features"
          className="text-[11px] uppercase tracking-[0.2em] text-white/40 hover:text-white/70 transition-colors font-label"
        >
          Features
        </Link>

        <Link to="/" className="text-[13px] uppercase tracking-[0.3em] font-headline font-bold text-white/80">
          DroneMedic
        </Link>

        <Link
          to={user ? '/dashboard' : '/login'}
          className="text-[11px] uppercase tracking-[0.2em] text-white/40 hover:text-white/70 transition-colors font-label"
        >
          {user ? 'Dashboard' : 'Login'}
        </Link>
      </motion.header>
    );
  }

  // Dashboard: Stitch-matching header
  return (
    <motion.header
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      className="fixed top-0 w-full z-50 bg-bg/60 backdrop-blur-md flex justify-between items-center px-6 py-3 h-16 border-b border-outline-variant/10"
    >
      <div className="flex items-center gap-4">
        <Link to="/" className="text-lg font-black text-on-surface uppercase tracking-widest font-headline">
          DroneMedic
        </Link>
        {isDashboard && (
          <>
            <div className="h-4 w-px bg-outline-variant/30 hidden md:block" />
            <div className="hidden md:flex items-center gap-6">
              <span className="text-blue-400 font-bold underline decoration-2 underline-offset-4 font-headline tracking-tight text-sm cursor-pointer active:scale-95">Live Ops</span>
              <span className="text-on-surface-variant opacity-70 font-headline tracking-tight text-sm cursor-pointer hover:bg-surface-container-high transition-colors p-1 rounded">Fleet Status</span>
            </div>
          </>
        )}
      </div>

      {/* Local Time Indicators (dashboard only) */}
      {isDashboard && (
        <div className="hidden xl:flex items-center gap-8 absolute left-1/2 -translate-x-1/2">
          <div className="flex flex-col items-center">
            <span className="text-[9px] uppercase tracking-tighter text-outline font-bold">Drone Location</span>
            <span className="text-sm font-headline font-bold text-on-surface">14:42 <span className="text-[10px] opacity-60">PDT</span></span>
          </div>
          <div className="h-8 w-px bg-outline-variant/20" />
          <div className="flex flex-col items-center">
            <span className="text-[9px] uppercase tracking-tighter text-outline font-bold">Destination</span>
            <span className="text-sm font-headline font-bold text-on-surface">14:46 <span className="text-[10px] opacity-60">PDT</span></span>
          </div>
        </div>
      )}

      <div className="flex items-center gap-4">
        {isDashboard && (
          <>
            <div className="flex items-center gap-2 px-3 py-1 rounded bg-surface-container-high border border-outline-variant/10">
              <span className="w-2 h-2 rounded-full bg-tertiary" style={{ boxShadow: '0 0 8px rgba(0,218,243,0.5)' }} />
              <span className="text-[10px] uppercase font-bold tracking-widest text-tertiary">System Live</span>
            </div>
            <div className="hidden md:flex items-center gap-2">
              <BatteryFull size={14} className="text-primary cursor-pointer" />
              <Signal size={14} className="text-primary cursor-pointer" />
              <MapPin size={14} className="text-primary cursor-pointer" />
            </div>
          </>
        )}

        {!isDashboard && !user && location.pathname !== '/login' && location.pathname !== '/signup' && (
          <Link
            to="/login"
            className="text-sm px-5 py-2 rounded-md btn-primary-gradient text-on-primary-fixed font-headline font-bold uppercase tracking-widest text-xs"
          >
            Sign In
          </Link>
        )}

        {user && (
          <button
            onClick={signOut}
            className="text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer"
          >
            <LogOut size={18} />
          </button>
        )}
      </div>
    </motion.header>
  );
}
