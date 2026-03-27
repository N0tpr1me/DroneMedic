import { motion } from 'framer-motion';

interface StatBadge {
  label: string;
  value: string;
}

interface InfoPanelProps {
  title: string;
  description: string;
  stats?: StatBadge[];
  visible: boolean;
  position?: 'right' | 'left';
}

export function InfoPanel({ title, description, stats, visible, position = 'right' }: InfoPanelProps) {
  return (
    <motion.div
      initial={{ opacity: 0, x: position === 'right' ? 60 : -60 }}
      animate={visible ? { opacity: 1, x: 0 } : { opacity: 0, x: position === 'right' ? 60 : -60 }}
      transition={{ duration: 0.7, ease: [0.25, 0.1, 0.25, 1] }}
      className={`
        absolute top-1/2 -translate-y-1/2 z-30
        ${position === 'right' ? 'right-12' : 'left-12'}
        w-[360px] p-8 rounded-2xl
        bg-black/30 backdrop-blur-2xl
        border border-white/10
      `}
    >
      {/* Accent line */}
      <div className="w-8 h-[2px] bg-[#00daf3] mb-6" />

      <h3 className="text-[13px] uppercase tracking-[0.2em] font-bold text-white mb-4">
        {title}
      </h3>

      <p className="text-[13px] text-white/50 leading-[1.8] mb-6">
        {description}
      </p>

      {stats && stats.length > 0 && (
        <div className="flex gap-4">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-white/8 bg-white/3"
            >
              <span className="text-[13px] font-bold text-[#00daf3]">{stat.value}</span>
              <span className="text-[10px] uppercase tracking-wider text-white/40">{stat.label}</span>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}
