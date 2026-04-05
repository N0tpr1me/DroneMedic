import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Camera, Eye, AlertTriangle, X } from 'lucide-react';
import { GlassPanel } from '../ui/GlassPanel';
import type { CVDetection } from '../../hooks/useLiveMission';

interface CVDetectionPanelProps {
  detection: CVDetection | null;
  onDismiss: () => void;
}

/** Map detection class names to bounding-box colours. */
function classColor(cls: string): string {
  const lower = cls.toLowerCase();
  if (lower.includes('building') || lower.includes('wall') || lower.includes('structure')) return '#ef4444';
  if (lower.includes('vehicle') || lower.includes('car') || lower.includes('truck')) return '#eab308';
  if (lower.includes('tree') || lower.includes('vegetation') || lower.includes('plant')) return '#22c55e';
  if (lower.includes('person') || lower.includes('pedestrian')) return '#f97316';
  if (lower.includes('bird') || lower.includes('animal')) return '#a855f7';
  if (lower.includes('wire') || lower.includes('cable') || lower.includes('powerline')) return '#ec4899';
  return '#00daf3';
}

/** Severity colour for the evasion action badge. */
function evasionBadgeColor(action: string): { bg: string; text: string } {
  const upper = action.toUpperCase();
  if (upper.includes('ABORT') || upper.includes('EMERGENCY')) return { bg: 'rgba(239,68,68,0.25)', text: '#ef4444' };
  if (upper.includes('EVADE') || upper.includes('CLIMB') || upper.includes('DESCEND')) return { bg: 'rgba(245,166,35,0.25)', text: '#f5a623' };
  if (upper.includes('HOLD') || upper.includes('SLOW')) return { bg: 'rgba(0,218,243,0.2)', text: '#00daf3' };
  return { bg: 'rgba(234,179,8,0.2)', text: '#eab308' };
}

const AUTO_DISMISS_MS = 15_000;

// Camera-frame viewport dimensions (the dark rectangle)
const FRAME_W = 320;
const FRAME_H = 200;

export function CVDetectionPanel({ detection, onDismiss }: CVDetectionPanelProps) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Show panel when a new detection arrives; reset auto-dismiss timer.
  useEffect(() => {
    if (detection) {
      setVisible(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setVisible(false);
        onDismiss();
      }, AUTO_DISMISS_MS);
    } else {
      setVisible(false);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [detection, onDismiss]);

  const handleClose = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisible(false);
    onDismiss();
  };

  return (
    <AnimatePresence>
      {visible && detection && (
        <motion.div
          initial={{ opacity: 0, y: 30, scale: 0.92 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.95 }}
          transition={{ type: 'spring', damping: 22, stiffness: 260 }}
          style={{ pointerEvents: 'auto' }}
        >
          <GlassPanel glow className="relative flex flex-col gap-3 w-[360px]">
            {/* Close button */}
            <button
              onClick={handleClose}
              style={{
                position: 'absolute',
                top: 10,
                right: 10,
                background: 'rgba(48,53,58,0.6)',
                border: 'none',
                borderRadius: 4,
                padding: 4,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <X size={14} style={{ color: '#8d90a0' }} />
            </button>

            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Camera size={16} style={{ color: '#00daf3' }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: '#dfe3e9', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                CV Obstacle Detection
              </span>
              <span style={{ marginLeft: 'auto', fontSize: 10, fontFamily: 'Space Grotesk, monospace', color: '#00daf3', background: 'rgba(0,218,243,0.12)', padding: '2px 6px', borderRadius: 4 }}>
                {detection.model}
              </span>
            </div>

            {/* Camera frame with bounding boxes */}
            <div
              style={{
                position: 'relative',
                width: FRAME_W,
                height: FRAME_H,
                background: 'rgba(10,15,19,0.9)',
                borderRadius: 6,
                border: '1px solid rgba(0,218,243,0.15)',
                overflow: 'hidden',
                alignSelf: 'center',
              }}
            >
              {/* Scanline overlay for style */}
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,218,243,0.03) 3px, rgba(0,218,243,0.03) 4px)',
                  pointerEvents: 'none',
                  zIndex: 2,
                }}
              />

              {/* "LIVE" badge */}
              <div
                style={{
                  position: 'absolute',
                  top: 6,
                  left: 6,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  zIndex: 3,
                }}
              >
                <span style={{
                  width: 6, height: 6, borderRadius: '50%', background: '#ef4444',
                  boxShadow: '0 0 6px rgba(239,68,68,0.6)',
                  animation: 'boot-pulse 1.2s ease-in-out infinite',
                }} />
                <span style={{ fontSize: 9, fontWeight: 700, color: '#ef4444', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  Live
                </span>
              </div>

              {/* Crosshair center */}
              <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 24, height: 24, pointerEvents: 'none', zIndex: 1 }}>
                <div style={{ position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)', width: 1, height: 8, background: 'rgba(0,218,243,0.3)' }} />
                <div style={{ position: 'absolute', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: 1, height: 8, background: 'rgba(0,218,243,0.3)' }} />
                <div style={{ position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)', width: 8, height: 1, background: 'rgba(0,218,243,0.3)' }} />
                <div style={{ position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)', width: 8, height: 1, background: 'rgba(0,218,243,0.3)' }} />
              </div>

              {/* Bounding boxes */}
              {detection.detections.map((det, i) => {
                const [x1, y1, x2, y2] = det.bbox;
                const color = classColor(det.class);
                // bbox coords are normalised 0-1 or pixel — normalise to frame
                const normX1 = x1 <= 1 ? x1 : x1 / 640;
                const normY1 = y1 <= 1 ? y1 : y1 / 480;
                const normX2 = x2 <= 1 ? x2 : x2 / 640;
                const normY2 = y2 <= 1 ? y2 : y2 / 480;

                return (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: i * 0.08 }}
                    style={{
                      position: 'absolute',
                      left: normX1 * FRAME_W,
                      top: normY1 * FRAME_H,
                      width: (normX2 - normX1) * FRAME_W,
                      height: (normY2 - normY1) * FRAME_H,
                      border: `2px solid ${color}`,
                      borderRadius: 3,
                      boxShadow: `0 0 8px ${color}40`,
                      zIndex: 3,
                    }}
                  >
                    {/* Label */}
                    <span
                      style={{
                        position: 'absolute',
                        top: -18,
                        left: -1,
                        fontSize: 9,
                        fontWeight: 700,
                        fontFamily: 'Space Grotesk, monospace',
                        color: '#fff',
                        background: color,
                        padding: '1px 5px',
                        borderRadius: '3px 3px 0 0',
                        whiteSpace: 'nowrap',
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                      }}
                    >
                      {det.class} {Math.round(det.confidence * 100)}%
                    </span>
                    {/* Distance tag */}
                    {det.distance_m > 0 && (
                      <span
                        style={{
                          position: 'absolute',
                          bottom: -16,
                          left: -1,
                          fontSize: 8,
                          fontWeight: 600,
                          fontFamily: 'Space Grotesk, monospace',
                          color: '#dfe3e9',
                          background: 'rgba(10,15,19,0.85)',
                          padding: '1px 4px',
                          borderRadius: 2,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {det.distance_m.toFixed(0)}m
                      </span>
                    )}
                  </motion.div>
                );
              })}
            </div>

            {/* Evasion decision */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
              <AlertTriangle size={14} style={{ color: evasionBadgeColor(detection.evasion.action).text, flexShrink: 0 }} />
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  color: evasionBadgeColor(detection.evasion.action).text,
                  background: evasionBadgeColor(detection.evasion.action).bg,
                  padding: '3px 8px',
                  borderRadius: 4,
                }}
              >
                {detection.evasion.action}
              </span>
              <span style={{ fontSize: 11, color: '#c3c6d6', flex: 1 }}>
                {detection.evasion.reason}
              </span>
            </div>

            {/* Stats row */}
            <div style={{ display: 'flex', gap: 16, paddingTop: 4, borderTop: '1px solid rgba(67,70,84,0.15)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <Eye size={12} style={{ color: '#8d90a0' }} />
                <span style={{ fontSize: 10, fontFamily: 'Space Grotesk, monospace', color: '#8d90a0' }}>
                  {detection.detections.length} detection{detection.detections.length !== 1 ? 's' : ''}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: 10, fontFamily: 'Space Grotesk, monospace', color: '#8d90a0' }}>
                  {detection.inference_ms}ms inference
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}>
                <span style={{ fontSize: 10, fontFamily: 'Space Grotesk, monospace', color: '#00daf3' }}>
                  {detection.model}
                </span>
              </div>
            </div>
          </GlassPanel>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
