import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface BootStep {
  label: string;
  status: 'pending' | 'loading' | 'done';
}

interface BootSequenceProps {
  locationsLoaded: boolean;
  weatherLoaded: boolean;
  noFlyLoaded: boolean;
  onComplete: () => void;
}

const STEPS = [
  'Connecting to satellite network',
  'Scanning weather corridors',
  'Checking restricted airspace',
  'Loading YOLOv8n obstacle detection model',
  'Flight systems nominal',
];

export function BootSequence({ locationsLoaded, weatherLoaded, noFlyLoaded, onComplete }: BootSequenceProps) {
  const [steps, setSteps] = useState<BootStep[]>(
    STEPS.map((label) => ({ label, status: 'pending' }))
  );
  const [allDone, setAllDone] = useState(false);

  // Progress steps based on API load state
  useEffect(() => {
    setSteps((prev) => {
      const next = [...prev];
      // Step 0: locations
      if (locationsLoaded && next[0].status !== 'done') {
        next[0] = { ...next[0], status: 'done' };
      } else if (!locationsLoaded && next[0].status === 'pending') {
        next[0] = { ...next[0], status: 'loading' };
      }
      // Step 1: weather
      if (weatherLoaded && next[1].status !== 'done') {
        next[1] = { ...next[1], status: 'done' };
      } else if (locationsLoaded && !weatherLoaded && next[1].status === 'pending') {
        next[1] = { ...next[1], status: 'loading' };
      }
      // Step 2: no-fly zones
      if (noFlyLoaded && next[2].status !== 'done') {
        next[2] = { ...next[2], status: 'done' };
      } else if (weatherLoaded && !noFlyLoaded && next[2].status === 'pending') {
        next[2] = { ...next[2], status: 'loading' };
      }
      // Step 3: CV model (auto-completes once no-fly zones are loaded)
      if (noFlyLoaded && next[3].status !== 'done') {
        next[3] = { ...next[3], status: 'done' };
      } else if (noFlyLoaded && next[3].status === 'pending') {
        next[3] = { ...next[3], status: 'loading' };
      }
      // Step 4: all clear
      if (locationsLoaded && weatherLoaded && noFlyLoaded && next[4].status !== 'done') {
        next[4] = { ...next[4], status: 'done' };
      } else if (noFlyLoaded && next[4].status === 'pending') {
        next[4] = { ...next[4], status: 'loading' };
      }
      return next;
    });
  }, [locationsLoaded, weatherLoaded, noFlyLoaded]);

  // Stable ref for onComplete to avoid timeout reset on re-renders
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const firedRef = useRef(false);

  // When all steps done, wait briefly then signal complete
  useEffect(() => {
    if (firedRef.current) return;
    const allComplete = steps.every((s) => s.status === 'done');
    if (allComplete) {
      firedRef.current = true;
      setAllDone(true);
      const timer = setTimeout(() => onCompleteRef.current(), 800);
      return () => clearTimeout(timer);
    }
  }, [steps]);

  const progressCount = steps.filter((s) => s.status === 'done').length;
  const progressBar = STEPS.map((_, i) => (i < progressCount ? '■' : '□')).join('');

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      background: '#0a0f13',
      fontFamily: "'Space Grotesk', monospace",
    }}>
      {/* Logo */}
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
        style={{ marginBottom: 40, textAlign: 'center' }}
      >
        <div style={{ fontSize: 24, fontWeight: 900, color: '#dfe3e9', textTransform: 'uppercase', letterSpacing: '0.15em' }}>
          DroneMedic
        </div>
        <div style={{ fontSize: 10, color: '#00daf3', textTransform: 'uppercase', letterSpacing: '0.2em', marginTop: 4 }}>
          Mission Control System
        </div>
      </motion.div>

      {/* Terminal-style boot lines */}
      <div style={{ width: 380, maxWidth: '90vw' }}>
        <AnimatePresence>
          {steps.map((step, i) => {
            if (step.status === 'pending') return null;
            return (
              <motion.div
                key={step.label}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3, delay: i * 0.05 }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  marginBottom: 12,
                  fontSize: 12,
                  fontFamily: "'Space Grotesk', monospace",
                }}
              >
                {/* Status indicator */}
                <span style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  flexShrink: 0,
                  background: step.status === 'done' ? '#4ade80' : '#00daf3',
                  boxShadow: step.status === 'done'
                    ? '0 0 8px rgba(74,222,128,0.5)'
                    : '0 0 8px rgba(0,218,243,0.5)',
                  animation: step.status === 'loading' ? 'boot-pulse 1s ease-in-out infinite' : 'none',
                }} />

                {/* Label */}
                <span style={{
                  color: step.status === 'done' ? '#dfe3e9' : '#00daf3',
                  letterSpacing: '0.02em',
                  flex: 1,
                }}>
                  {step.label}
                </span>

                {/* Status text */}
                <span style={{
                  fontSize: 10,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  color: step.status === 'done' ? '#4ade80' : '#00daf3',
                  fontWeight: 700,
                  opacity: 0.8,
                }}>
                  {step.status === 'done' ? 'OK' : '...'}
                </span>
              </motion.div>
            );
          })}
        </AnimatePresence>

        {/* Progress bar */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          style={{
            marginTop: 20,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            fontSize: 11,
            color: '#8d90a0',
            letterSpacing: '0.15em',
          }}
        >
          <span style={{ fontFamily: 'monospace', color: allDone ? '#4ade80' : '#00daf3' }}>
            [{progressBar}]
          </span>
          <span>
            {allDone ? 'ALL SYSTEMS READY' : 'INITIALIZING...'}
          </span>
        </motion.div>
      </div>
    </div>
  );
}
