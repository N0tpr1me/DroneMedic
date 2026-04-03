import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, X, ShieldAlert, Info } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || '';

type AnomalySeverity = 'critical' | 'warning' | 'info';

interface Anomaly {
  id: string;
  severity: AnomalySeverity;
  title: string;
  message: string;
  timestamp: number;
}

interface ToastEntry {
  anomaly: Anomaly;
  dismissTimeout?: ReturnType<typeof setTimeout>;
}

const SEVERITY_CONFIG: Record<
  AnomalySeverity,
  { bg: string; border: string; text: string; icon: React.ReactNode; autoDismiss: boolean }
> = {
  critical: {
    bg: 'bg-red-500/15',
    border: 'border-red-500/30',
    text: 'text-red-400',
    icon: <ShieldAlert className="w-4 h-4" />,
    autoDismiss: false,
  },
  warning: {
    bg: 'bg-amber-500/15',
    border: 'border-amber-500/30',
    text: 'text-amber-400',
    icon: <AlertTriangle className="w-4 h-4" />,
    autoDismiss: true,
  },
  info: {
    bg: 'bg-blue-500/15',
    border: 'border-blue-500/30',
    text: 'text-blue-400',
    icon: <Info className="w-4 h-4" />,
    autoDismiss: true,
  },
};

const AUTO_DISMISS_MS = 6000;

export function AnomalyToastProvider() {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const eventSourceRef = useRef<EventSource | null>(null);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => {
      const entry = prev.find((t) => t.anomaly.id === id);
      if (entry?.dismissTimeout) {
        clearTimeout(entry.dismissTimeout);
      }
      return prev.filter((t) => t.anomaly.id !== id);
    });
  }, []);

  const addToast = useCallback(
    (anomaly: Anomaly) => {
      const config = SEVERITY_CONFIG[anomaly.severity];

      const entry: ToastEntry = { anomaly };

      if (config.autoDismiss) {
        entry.dismissTimeout = setTimeout(() => {
          dismissToast(anomaly.id);
        }, AUTO_DISMISS_MS);
      }

      setToasts((prev) => {
        // Limit to 5 visible toasts
        const updated = [...prev, entry];
        if (updated.length > 5) {
          const removed = updated.shift();
          if (removed?.dismissTimeout) clearTimeout(removed.dismissTimeout);
        }
        return updated;
      });
    },
    [dismissToast],
  );

  useEffect(() => {
    const url = `${API_BASE}/api/anomaly-stream`;
    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as {
          severity?: AnomalySeverity;
          title?: string;
          message?: string;
        };

        const anomaly: Anomaly = {
          id: `anomaly-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          severity: data.severity ?? 'info',
          title: data.title ?? 'Anomaly Detected',
          message: data.message ?? '',
          timestamp: Date.now(),
        };

        addToast(anomaly);
      } catch {
        // Ignore malformed events
      }
    };

    eventSource.onerror = () => {
      // SSE will auto-reconnect; no action needed
    };

    return () => {
      eventSource.close();
      eventSourceRef.current = null;
    };
  }, [addToast]);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      toasts.forEach((t) => {
        if (t.dismissTimeout) clearTimeout(t.dismissTimeout);
      });
    };
    // Only run on unmount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      <AnimatePresence>
        {toasts.map(({ anomaly }) => {
          const config = SEVERITY_CONFIG[anomaly.severity];
          return (
            <motion.div
              key={anomaly.id}
              initial={{ opacity: 0, x: 80, scale: 0.95 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 80, scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              className={`
                pointer-events-auto rounded-xl p-3 border backdrop-blur-xl
                ${config.bg} ${config.border}
                shadow-lg shadow-black/20
              `}
            >
              <div className="flex items-start gap-2.5">
                <div className={`mt-0.5 shrink-0 ${config.text}`}>
                  {config.icon}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-sm font-medium ${config.text}`}>
                      {anomaly.title}
                    </span>
                    <button
                      type="button"
                      onClick={() => dismissToast(anomaly.id)}
                      className="shrink-0 p-0.5 rounded hover:bg-white/10 transition-colors text-on-surface-variant/60 hover:text-on-surface-variant"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {anomaly.message && (
                    <p className="text-xs text-on-surface-variant mt-0.5 line-clamp-2">
                      {anomaly.message}
                    </p>
                  )}
                  <span className="text-[10px] text-on-surface-variant/40 mt-1 block">
                    {new Date(anomaly.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
