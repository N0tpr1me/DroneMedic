import { useEffect, useRef, useState } from 'react';
import { motion, useSpring, useTransform, MotionValue } from 'framer-motion';

const SPRING_CONFIG = { stiffness: 280, damping: 18, mass: 0.3 };

interface SlidingNumberProps {
  value: number;
  className?: string;
  prefix?: string;
  suffix?: string;
}

/**
 * Animated number display with spring-physics digit rolling.
 * Each digit independently animates from its current value to the target.
 */
export function SlidingNumber({ value, className = '', prefix = '', suffix = '' }: SlidingNumberProps) {
  const [inView, setInView] = useState(false);
  const [displayValue, setDisplayValue] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  // Trigger animation when scrolled into view
  useEffect(() => {
    if (!ref.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setInView(true); },
      { threshold: 0.3 }
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  // Animate value when in view
  useEffect(() => {
    if (!inView) return;
    setDisplayValue(value);
  }, [inView, value]);

  const digits = String(displayValue).split('');
  const places = digits.map((_, i) => Math.pow(10, digits.length - i - 1));

  return (
    <div ref={ref} className={`inline-flex items-baseline ${className}`}>
      {prefix && <span>{prefix}</span>}
      <div className="flex" style={{ fontVariantNumeric: 'tabular-nums' }}>
        {digits.map((_, i) => (
          <Digit key={`${places[i]}`} value={displayValue} place={places[i]} />
        ))}
      </div>
      {suffix && <span>{suffix}</span>}
    </div>
  );
}

function Digit({ value, place }: { value: number; place: number }) {
  const valueAtPlace = Math.floor(value / place) % 10;
  const animatedValue = useSpring(0, SPRING_CONFIG);

  useEffect(() => {
    animatedValue.set(valueAtPlace);
  }, [animatedValue, valueAtPlace]);

  return (
    <div className="relative inline-block w-[1ch] overflow-hidden" style={{ lineHeight: 1 }}>
      <div className="invisible">0</div>
      {Array.from({ length: 10 }, (_, i) => (
        <DigitSlot key={i} mv={animatedValue} number={i} />
      ))}
    </div>
  );
}

function DigitSlot({ mv, number }: { mv: MotionValue<number>; number: number }) {
  const y = useTransform(mv, (latest) => {
    const placeValue = latest % 10;
    const offset = (10 + number - placeValue) % 10;
    let memo = offset * 100; // percentage
    if (offset > 5) memo -= 1000;
    return `${memo}%`;
  });

  return (
    <motion.span
      style={{ y }}
      className="absolute inset-0 flex items-center justify-center"
    >
      {number}
    </motion.span>
  );
}
