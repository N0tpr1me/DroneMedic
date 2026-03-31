import { Pill } from 'lucide-react';

export function DroneOverlay() {
  return (
    <div className="absolute inset-0 z-10 pointer-events-none flex items-center justify-center -translate-y-12">
      {/* Subtle backdrop glow */}
      <div className="absolute w-[500px] h-[300px] rounded-full opacity-20" style={{
        background: 'radial-gradient(ellipse, rgba(179,197,255,0.3) 0%, transparent 70%)',
        filter: 'blur(40px)',
      }} />

      <div className="drone-container w-[600px] h-[400px] flex items-center justify-center">
        <div className="drone-body relative w-64 h-24">
          {/* Central Chassis */}
          <div className="absolute inset-0 rounded-full border border-[#38bdf8] flex items-center justify-center overflow-hidden transition-colors duration-1000"
            style={{
              background: 'linear-gradient(135deg, #0f172a, #1e293b)',
              boxShadow: '0 0 50px rgba(179,197,255,0.25), inset 0 0 20px rgba(179,197,255,0.05)',
            }}
          >
            <div
              className="absolute inset-0 opacity-30"
              style={{
                backgroundImage: "url('https://www.transparenttextures.com/patterns/carbon-fibre.png')",
              }}
            />
            {/* Status light bar */}
            <div className="w-24 h-1.5 bg-primary/50 rounded-full absolute top-4" style={{ boxShadow: '0 0 8px rgba(179,197,255,0.4)' }} />
            {/* Center icon */}
            <div className="w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center border border-primary/40" style={{ boxShadow: '0 0 15px rgba(179,197,255,0.2)' }}>
              <Pill size={16} className="text-primary" />
            </div>
          </div>

          {/* Structural Arms */}
          <div className="absolute top-1/2 left-0 w-full h-[2px] -translate-y-1/2" style={{ background: 'linear-gradient(to right, transparent, #434654, transparent)' }} />
          <div className="absolute top-1/2 left-1/2 w-[2px] h-48 -translate-x-1/2 -translate-y-1/2" style={{ background: 'linear-gradient(to bottom, transparent, #434654, transparent)' }} />

          {/* Rotors */}
          {[
            '-top-14 -left-14',
            '-top-14 -right-14',
            '-bottom-14 -left-14',
            '-bottom-14 -right-14',
          ].map((pos, i) => (
            <div key={i} className={`absolute ${pos}`}>
              <div className="w-14 h-14 bg-[#1b2024] rounded-full border border-white/10 relative" style={{ boxShadow: '0 4px 20px rgba(0,0,0,0.5)' }}>
                <div className="rotor w-36 h-[2px] bg-white/15 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full" />
                <div
                  className="rotor w-[2px] h-36 bg-white/10 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
                  style={{ animationDelay: '-0.05s' }}
                />
              </div>
            </div>
          ))}

          {/* Camera / Sensor */}
          <div className="absolute bottom-[-12px] left-1/2 -translate-x-1/2 w-9 h-9 bg-[#0a0f13] rounded-full border border-white/15 flex items-center justify-center">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" style={{ boxShadow: '0 0 12px rgba(255,0,0,0.6)' }} />
          </div>
        </div>
      </div>
    </div>
  );
}
