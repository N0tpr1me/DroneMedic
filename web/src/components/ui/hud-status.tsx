import { motion } from 'framer-motion';
import { useState, useEffect, useRef, useCallback } from 'react';

interface HudStatusProps {
  variant: 'idle' | 'planning' | 'flying' | 'rerouting' | 'completed' | 'emergency';
  className?: string;
}

const variantConfig: Record<
  HudStatusProps['variant'],
  { color: string; text: string }
> = {
  idle: { color: '#4ade80', text: 'SYSTEMS NOMINAL' },
  planning: { color: '#fbbf24', text: 'PLANNING ROUTE' },
  flying: { color: '#00daf3', text: 'IN FLIGHT' },
  rerouting: { color: '#fbbf24', text: 'REROUTING' },
  completed: { color: '#4ade80', text: 'DELIVERY COMPLETE' },
  emergency: { color: '#ff4444', text: 'EMERGENCY' },
};

const SCRAMBLE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const SCRAMBLE_DURATION_MS = 600;
const SCRAMBLE_INTERVAL_MS = 30;

function getRandomChar(): string {
  return SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
}

function useHyperTextScramble(targetText: string): string {
  const [displayText, setDisplayText] = useState(targetText);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isFirstRender = useRef(true);

  const cleanup = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      setDisplayText(targetText);
      return;
    }

    cleanup();

    const totalSteps = Math.ceil(SCRAMBLE_DURATION_MS / SCRAMBLE_INTERVAL_MS);
    let step = 0;

    intervalRef.current = setInterval(() => {
      step += 1;
      const revealedCount = Math.floor((step / totalSteps) * targetText.length);

      const nextDisplay = targetText
        .split('')
        .map((char, i) => {
          if (i < revealedCount) {
            return char;
          }
          return char === ' ' ? ' ' : getRandomChar();
        })
        .join('');

      setDisplayText(nextDisplay);

      if (step >= totalSteps) {
        cleanup();
        setDisplayText(targetText);
      }
    }, SCRAMBLE_INTERVAL_MS);

    return cleanup;
  }, [targetText, cleanup]);

  return displayText;
}

export function HudStatus({ variant, className = '' }: HudStatusProps) {
  const { color, text } = variantConfig[variant];
  const scrambledText = useHyperTextScramble(text);

  return (
    <div
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 12px',
        borderRadius: 4,
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        border: `1px solid ${color}33`,
        fontFamily: '"JetBrains Mono", "Fira Code", "SF Mono", monospace',
        fontSize: 10,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        color,
        userSelect: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      {/* Pulsing dot indicator */}
      <span
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 6,
          height: 6,
          flexShrink: 0,
        }}
      >
        <span
          style={{
            position: 'absolute',
            width: 6,
            height: 6,
            borderRadius: '50%',
            backgroundColor: color,
          }}
        />
        <motion.span
          animate={{
            scale: [1, 2.2],
            opacity: [0.6, 0],
          }}
          transition={{
            duration: 1.4,
            repeat: Infinity,
            ease: 'easeOut',
          }}
          style={{
            position: 'absolute',
            width: 6,
            height: 6,
            borderRadius: '50%',
            backgroundColor: color,
          }}
        />
      </span>

      {/* Scrambled text label */}
      <span>{scrambledText}</span>
    </div>
  );
}
