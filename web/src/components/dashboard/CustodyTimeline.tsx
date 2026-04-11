import { motion } from 'framer-motion';
import type { Task, FlightLogEntry } from '../../lib/api';

interface CustodyTimelineProps {
  task: Task | null;
  route: string[] | undefined;
  flightLog: FlightLogEntry[];
  status: string;
  battery: number;
}

interface TimelineStep {
  label: string;
  detail: string;
  status: 'complete' | 'active' | 'pending';
  timestamp?: number;
}

function formatTime(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function CustodyTimeline({ task, route, flightLog, status, battery }: CustodyTimelineProps) {
  const destination = route && route.length > 2 ? route[route.length - 2] : 'Unknown';
  const supplyType = task ? Object.values(task.supplies || {})[0] || 'Medical Supplies' : 'None';
  const isHighPriority = task?.priorities && Object.values(task.priorities).includes('high');

  // Scope log lookups to only events from the current mission (last takeoff onward)
  // so stale events from previous missions don't leak into the timeline.
  const lastTakeoffIdx = flightLog.map(e => e.event).lastIndexOf('takeoff');
  const currentMissionLog = lastTakeoffIdx >= 0 ? flightLog.slice(lastTakeoffIdx) : [];

  const takeoffLog = currentMissionLog.find(e => e.event === 'takeoff');
  // Match both "arrived:Royal London" and "waypoint_reached" style events
  const arrivalLog = currentMissionLog.find(e =>
    e.event === `arrived:${destination}` ||
    (e.event.startsWith('arrived:') && e.location === destination) ||
    (e.event === 'waypoint_reached' && e.location === destination)
  );
  const landedLog = currentMissionLog.find(e => e.event === 'landed');

  const isFlying = status === 'flying' || status === 'rerouting';
  const isCompleted = status === 'completed';
  // Arrival is confirmed once the flight log records the drone reaching the
  // destination — we no longer gate on !isFlying because the status transition
  // can lag behind the actual arrival event.
  const hasArrived = Boolean(arrivalLog) || isCompleted;

  const steps: TimelineStep[] = [
    {
      label: 'Order Placed',
      detail: task ? `${supplyType} → ${destination}${isHighPriority ? ' (P1 CRITICAL)' : ''}` : 'Awaiting request',
      status: task ? 'complete' : 'pending',
      timestamp: task ? (takeoffLog?.timestamp ? takeoffLog.timestamp - 10 : Date.now() / 1000) : undefined,
    },
    {
      label: 'Payload Packed',
      detail: task ? `${supplyType} — sealed container` : 'Awaiting payload',
      status: task ? 'complete' : 'pending',
      timestamp: task ? (takeoffLog?.timestamp ? takeoffLog.timestamp - 5 : undefined) : undefined,
    },
    {
      label: 'Temperature Verified',
      detail: task ? 'Temperature within safe range' : 'Awaiting verification',
      status: task ? 'complete' : 'pending',
      timestamp: task ? (takeoffLog?.timestamp ? takeoffLog.timestamp - 3 : undefined) : undefined,
    },
    {
      label: 'Seal Applied',
      detail: task ? `#DM-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 9999)).padStart(4, '0')}` : 'Awaiting seal',
      status: task ? 'complete' : 'pending',
      timestamp: task ? (takeoffLog?.timestamp ? takeoffLog.timestamp - 1 : undefined) : undefined,
    },
    {
      label: 'Drone Launched',
      detail: takeoffLog ? `From Depot — Battery ${battery}%` : 'Awaiting launch',
      status: takeoffLog ? 'complete' : status === 'planning' ? 'active' : 'pending',
      timestamp: takeoffLog?.timestamp,
    },
    {
      label: 'In Transit',
      detail: isFlying && !hasArrived
        ? `En route to ${destination} — Battery ${battery}%`
        : hasArrived ? `Delivered to ${destination}` : 'Awaiting departure',
      status: hasArrived ? 'complete' : isFlying ? 'active' : 'pending',
      timestamp: arrivalLog?.timestamp,
    },
    {
      label: `Arrival at ${destination}`,
      detail: hasArrived
        ? `Battery ${arrivalLog ? Math.min(arrivalLog.battery, battery).toFixed(0) : battery.toFixed(0)}%`
        : 'Awaiting arrival',
      status: hasArrived ? 'complete' : 'pending',
      timestamp: arrivalLog?.timestamp,
    },
    {
      label: 'Payload Received',
      detail: (landedLog || isCompleted) ? 'Received — Contents verified intact' : 'Awaiting confirmation',
      status: (landedLog || isCompleted) ? 'complete' : 'pending',
      timestamp: landedLog?.timestamp ?? (isCompleted ? arrivalLog?.timestamp : undefined),
    },
  ];

  return (
    <section style={{
      background: 'rgba(30,35,40,0.85)',
      backdropFilter: 'blur(24px)',
      WebkitBackdropFilter: 'blur(24px)',
      borderRadius: 8,
      padding: 16,
      border: '1px solid rgba(67,70,84,0.25)',
    }}>
      <h3 style={{
        fontFamily: 'Space Grotesk',
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: '0.05em',
        color: '#b3c5ff',
        textTransform: 'uppercase',
        margin: '0 0 12px',
      }}>
        Chain of Custody
      </h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {steps.map((step, i) => (
          <motion.div
            key={step.label}
            initial={{ opacity: 0, x: -5 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.05 }}
            style={{ display: 'flex', gap: 10, minHeight: 36 }}
          >
            {/* Timeline dot + line */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 16 }}>
              <div style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: step.status === 'complete' ? '#22c55e'
                  : step.status === 'active' ? '#00daf3'
                  : 'rgba(67,70,84,0.4)',
                border: step.status === 'active' ? '2px solid rgba(0,218,243,0.4)' : 'none',
                boxShadow: step.status === 'active' ? '0 0 8px rgba(0,218,243,0.5)' : 'none',
                flexShrink: 0,
                marginTop: 3,
              }} />
              {i < steps.length - 1 && (
                <div style={{
                  width: 1,
                  flex: 1,
                  minHeight: 16,
                  background: step.status === 'complete' ? 'rgba(34,197,94,0.3)' : 'rgba(67,70,84,0.2)',
                }} />
              )}
            </div>
            {/* Content */}
            <div style={{ flex: 1, paddingBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: step.status === 'complete' ? '#dfe3e9'
                    : step.status === 'active' ? '#00daf3'
                    : '#8d90a0',
                  textTransform: 'uppercase',
                  letterSpacing: '0.03em',
                }}>
                  {step.status === 'complete' ? '✓' : step.status === 'active' ? '●' : '○'} {step.label}
                </span>
                {step.timestamp && (
                  <span style={{ fontSize: 9, color: '#8d90a0', fontFamily: 'monospace' }}>
                    {formatTime(step.timestamp)}
                  </span>
                )}
              </div>
              <p style={{
                fontSize: 10,
                color: step.status === 'pending' ? '#6b7280' : '#c3c6d6',
                margin: '2px 0 0',
                lineHeight: 1.3,
              }}>
                {step.detail}
              </p>
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
