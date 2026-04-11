import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ClipboardList,
  CloudLightning,
  Download,
  Search,
  Clock,
  MapPin,
  Battery,
  Thermometer,
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Radio,
  Wifi,
  WifiOff,
  Shield,
} from 'lucide-react';
import { SideNav } from '../components/layout/SideNav';
import { PageHeader } from '../components/layout/PageHeader';
import { SlidingNumber } from '@/components/ui/sliding-number';
import { LiquidButton } from '@/components/ui/liquid-glass-button';
import { api } from '../lib/api';
import { useLiveMission } from '../hooks/useLiveMission';
import { usePX4Telemetry } from '../hooks/usePX4Telemetry';
import { useMissionContext } from '../context/MissionContext';
import type { FlightLogEntry } from '../lib/api';

// ── Types ──

interface LogEvent {
  id: string;
  timestamp: string;
  type: 'flight' | 'weather' | 'system' | 'delivery' | 'error' | 'safety';
  severity: 'info' | 'warning' | 'critical';
  event: string;
  location: string;
  details: string;
  battery: number;
  payload: string;
  position: { x: number; y: number; z: number };
  safetyAction?: string;
  safetyReasons?: string[];
  affectedStops?: string[];
}

interface CustodyStep {
  label: string;
  time: string;
  status: 'completed' | 'current' | 'future';
}

// ── Demo Data ──

const DEMO_EVENTS: LogEvent[] = [
  { id: '1', timestamp: '2026-04-01T14:02:00Z', type: 'delivery', severity: 'info', event: 'Payload Packed', location: 'Edinburgh Depot', details: 'O- Blood (2 units) sealed in thermal container. Initial temp: 4.0\u00b0C', battery: 100, payload: 'O- Blood, 2 units', position: { x: 0, y: 0, z: 0 } },
  { id: '2', timestamp: '2026-04-01T14:03:00Z', type: 'delivery', severity: 'info', event: 'Payload Sealed', location: 'Edinburgh Depot', details: 'Container sealed. Chain of custody initiated. Seal ID: SEAL-4821', battery: 100, payload: 'O- Blood, 2 units', position: { x: 0, y: 0, z: 0 } },
  { id: '3', timestamp: '2026-04-01T14:05:00Z', type: 'flight', severity: 'info', event: 'Takeoff', location: 'Edinburgh Depot', details: 'Drone Alpha launched. Altitude: 120m. Heading: 185\u00b0 SSW', battery: 98, payload: 'O- Blood, 2 units', position: { x: 0, y: 0, z: -30 } },
  { id: '4', timestamp: '2026-04-01T14:12:00Z', type: 'flight', severity: 'info', event: 'Checkpoint Alpha', location: 'Newcastle Corridor', details: 'Waypoint 1 reached. Ground speed: 82 km/h. Payload temp: 4.1\u00b0C', battery: 89, payload: 'O- Blood, 2 units', position: { x: 50, y: 30, z: -30 } },
  { id: '5', timestamp: '2026-04-01T14:18:00Z', type: 'flight', severity: 'info', event: 'Checkpoint Bravo', location: 'Yorkshire Sector', details: 'Waypoint 2 reached. Ground speed: 78 km/h. Payload temp: 4.2\u00b0C', battery: 79, payload: 'O- Blood, 2 units', position: { x: 80, y: 55, z: -30 } },
  { id: '6', timestamp: '2026-04-01T14:22:00Z', type: 'weather', severity: 'warning', event: 'Weather Alert', location: 'Midlands Corridor', details: 'Storm cell detected ahead. Wind: 22kt gusting 35kt. Visibility: 2km', battery: 74, payload: 'O- Blood, 2 units', position: { x: 95, y: 65, z: -30 } },
  { id: '7', timestamp: '2026-04-01T14:23:00Z', type: 'system', severity: 'warning', event: 'Route Recalculation', location: 'Midlands Corridor', details: 'Initiating reroute to avoid storm cell. New path via Western corridor. ETA adjusted: +8 minutes', battery: 73, payload: 'O- Blood, 2 units', position: { x: 95, y: 65, z: -30 } },
  { id: '8', timestamp: '2026-04-01T14:24:00Z', type: 'flight', severity: 'info', event: 'Reroute Active', location: 'Western Corridor', details: 'Flying detour via Western corridor. Ground speed: 74 km/h. Payload temp: 4.4\u00b0C', battery: 71, payload: 'O- Blood, 2 units', position: { x: 90, y: 70, z: -30 } },
  { id: '9', timestamp: '2026-04-01T14:30:00Z', type: 'weather', severity: 'info', event: 'Weather Clear', location: 'Coventry Sector', details: 'Past storm cell. Visibility restored to 10km+. Wind: 8kt. Resuming direct route', battery: 62, payload: 'O- Blood, 2 units', position: { x: 85, y: 80, z: -30 } },
  { id: '10', timestamp: '2026-04-01T14:31:00Z', type: 'system', severity: 'info', event: 'Payload Check', location: 'Coventry Sector', details: 'Automated payload integrity check. Temp: 4.8\u00b0C \u2014 within safe range (2-6\u00b0C). Integrity: Nominal', battery: 60, payload: 'O- Blood, 2 units', position: { x: 85, y: 80, z: -30 } },
  { id: '11', timestamp: '2026-04-01T14:35:00Z', type: 'flight', severity: 'warning', event: 'Temp Warning', location: 'Birmingham Sector', details: 'Payload temp rising: 5.8\u00b0C. Approaching upper boundary (6\u00b0C). Sun exposure on container', battery: 55, payload: 'O- Blood, 2 units', position: { x: 80, y: 90, z: -30 } },
  { id: '12', timestamp: '2026-04-01T14:36:00Z', type: 'system', severity: 'info', event: 'Altitude Adjusted', location: 'Birmingham Sector', details: 'Increased altitude to 150m for cooler air. Payload temp stabilizing at 5.4\u00b0C', battery: 53, payload: 'O- Blood, 2 units', position: { x: 80, y: 92, z: -35 } },
  { id: '13', timestamp: '2026-04-01T14:40:00Z', type: 'flight', severity: 'info', event: 'Checkpoint Charlie', location: 'Northampton Sector', details: 'Waypoint 3 reached. Ground speed: 80 km/h. Payload temp: 4.9\u00b0C \u2014 stable', battery: 47, payload: 'O- Blood, 2 units', position: { x: 75, y: 100, z: -35 } },
  { id: '14', timestamp: '2026-04-01T14:45:00Z', type: 'flight', severity: 'info', event: 'Final Approach', location: 'London Airspace', details: 'Entering London approach corridor. Descending to 80m. Speed: 65 km/h', battery: 40, payload: 'O- Blood, 2 units', position: { x: 60, y: 110, z: -25 } },
  { id: '15', timestamp: '2026-04-01T14:49:00Z', type: 'flight', severity: 'info', event: 'Landing Sequence', location: 'Royal London Hospital', details: 'Initiating vertical descent to rooftop helipad. Wind check: 6kt NW. Clear to land', battery: 36, payload: 'O- Blood, 2 units', position: { x: 50, y: 115, z: -15 } },
  { id: '16', timestamp: '2026-04-01T14:51:00Z', type: 'flight', severity: 'info', event: 'Landed', location: 'Royal London Hospital', details: 'Touchdown confirmed. Flight time: 46 minutes. Distance: 280km. Payload temp: 4.6\u00b0C', battery: 34, payload: 'O- Blood, 2 units', position: { x: 50, y: 115, z: 0 } },
  { id: '17', timestamp: '2026-04-01T14:53:00Z', type: 'delivery', severity: 'info', event: 'Delivery Confirmed', location: 'Royal London Hospital', details: 'Received by Dr. Osei, Trauma Surgeon. Payload condition: Intact. Temp: 4.5\u00b0C. Seal verified', battery: 34, payload: 'O- Blood, 2 units', position: { x: 50, y: 115, z: 0 } },
];

const CHAIN_OF_CUSTODY: CustodyStep[] = [
  { label: 'Packed', time: '14:02', status: 'completed' as const },
  { label: 'Sealed', time: '14:03', status: 'completed' as const },
  { label: 'Launched', time: '14:05', status: 'completed' as const },
  { label: 'Checkpoint A', time: '14:12', status: 'completed' as const },
  { label: 'Checkpoint B', time: '14:18', status: 'completed' as const },
  { label: 'Rerouted', time: '14:23', status: 'completed' as const },
  { label: 'Checkpoint C', time: '14:40', status: 'completed' as const },
  { label: 'Landed', time: '14:51', status: 'completed' as const },
  { label: 'Received', time: '14:53', status: 'completed' as const },
];

// ── Helpers ──

const ITEMS_PER_PAGE = 10;

const TYPE_COLORS: Record<string, string> = {
  flight: '#00daf3',
  weather: '#fbbf24',
  system: '#3b82f6',
  delivery: '#4ade80',
  error: '#ff4444',
  safety: '#a855f7',
};

type SafetyFilter = 'all' | 'safety' | 'warnings' | 'critical' | 'waypoints';

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function glassPanel(extra: React.CSSProperties = {}): React.CSSProperties {
  return {
    background: 'rgba(30,35,40,0.85)',
    border: '1px solid rgba(67,70,84,0.2)',
    borderRadius: 14,
    padding: 20,
    backdropFilter: 'blur(16px)',
    ...extra,
  };
}

/** Convert a FlightLogEntry from the live WebSocket into a LogEvent */
function flightLogToLogEvent(entry: FlightLogEntry, index: number): LogEvent {
  const eventLower = (entry.event || '').toLowerCase();

  let type: LogEvent['type'] = 'flight';
  let severity: LogEvent['severity'] = 'info';
  let safetyAction: string | undefined;
  let safetyReasons: string[] | undefined;
  let affectedStops: string[] | undefined;

  // Detect safety decision events
  if (eventLower.includes('divert') || eventLower.includes('abort')) {
    type = 'safety';
    severity = 'critical';
    safetyAction = entry.event;
    safetyReasons = ['Safety system triggered'];
  } else if (eventLower.includes('reroute') || eventLower.includes('red')) {
    type = 'safety';
    severity = 'critical';
    safetyAction = entry.event;
    safetyReasons = ['Route deviation required'];
  } else if (eventLower.includes('amber') || eventLower.includes('caution')) {
    type = 'safety';
    severity = 'warning';
    safetyAction = entry.event;
    safetyReasons = ['Caution level safety event'];
  } else if (eventLower.includes('green') || eventLower.includes('safe') || eventLower.includes('clear')) {
    type = 'safety';
    severity = 'info';
    safetyAction = entry.event;
  } else if (eventLower.includes('weather') || eventLower.includes('wind') || eventLower.includes('storm')) {
    type = 'weather';
    severity = 'warning';
  } else if (eventLower.includes('battery_low') || eventLower.includes('low_battery')) {
    type = 'system';
    severity = 'warning';
  } else if (eventLower.includes('arrived') || eventLower.includes('waypoint') || eventLower.includes('landed')) {
    type = 'delivery';
    severity = 'info';
  } else if (eventLower.includes('error') || eventLower.includes('fail')) {
    type = 'error';
    severity = 'critical';
  }

  // Extract affected stops if present in event string (e.g. "arrived:Hospital A")
  if (eventLower.includes('arrived:')) {
    const stopName = entry.event.split(':')[1]?.trim();
    if (stopName) {
      affectedStops = [stopName];
    }
  }

  const ts = entry.timestamp
    ? new Date(typeof entry.timestamp === 'number' ? entry.timestamp * 1000 : entry.timestamp).toISOString()
    : new Date().toISOString();

  return {
    id: `live-${index}-${Date.now()}`,
    timestamp: ts,
    type,
    severity,
    event: entry.event,
    location: entry.location || 'Unknown',
    details: `Battery: ${entry.battery ?? 'N/A'}% | Position: (${entry.position?.x?.toFixed(1) ?? 0}, ${entry.position?.y?.toFixed(1) ?? 0}, ${entry.position?.z?.toFixed(1) ?? 0})`,
    battery: entry.battery ?? 100,
    payload: 'Active Mission',
    position: entry.position || { x: 0, y: 0, z: 0 },
    safetyAction,
    safetyReasons,
    affectedStops,
  };
}

// ── Component ──

export function Logs() {
  const [filters, setFilters] = useState({ type: 'all', severity: 'all', search: '' });
  const [safetyFilter, setSafetyFilter] = useState<SafetyFilter>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [showBriefing, setShowBriefing] = useState(false);
  const [briefingText, setBriefingText] = useState('');
  const [isLoadingBriefing, setIsLoadingBriefing] = useState(false);
  const [liveEvents, setLiveEvents] = useState<LogEvent[]>([]);

  // Live data hooks
  const { liveFlightLog, droneAlerts } = useMissionContext();
  const liveMission = useLiveMission();
  const px4 = usePX4Telemetry();
  const prevFlightLogLenRef = useRef(0);
  const prevContextLogLenRef = useRef(0);

  // Auto-connect WebSocket on mount
  useEffect(() => {
    liveMission.connect();
    return () => {
      liveMission.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Convert new flight log entries into LogEvents and prepend them
  useEffect(() => {
    const currentLen = liveMission.flightLog.length;
    if (currentLen > prevFlightLogLenRef.current) {
      const newEntries = liveMission.flightLog.slice(prevFlightLogLenRef.current);
      const newLogEvents = newEntries.map((entry, i) =>
        flightLogToLogEvent(entry, prevFlightLogLenRef.current + i)
      );
      setLiveEvents((prev) => [...newLogEvents, ...prev]);
    }
    prevFlightLogLenRef.current = currentLen;
  }, [liveMission.flightLog]);

  // Merge liveFlightLog from MissionContext (physics + backend combined)
  useEffect(() => {
    const currentLen = liveFlightLog.length;
    if (currentLen > prevContextLogLenRef.current) {
      const newEntries = liveFlightLog.slice(prevContextLogLenRef.current);
      const newLogEvents = newEntries.map((entry, i) =>
        flightLogToLogEvent(entry, prevContextLogLenRef.current + i)
      );
      setLiveEvents((prev) => {
        // Deduplicate by checking timestamps already present
        const existingTimestamps = new Set(prev.map((e) => e.timestamp));
        const unique = newLogEvents.filter((e) => !existingTimestamps.has(e.timestamp));
        return unique.length > 0 ? [...unique, ...prev] : prev;
      });
    }
    prevContextLogLenRef.current = currentLen;
  }, [liveFlightLog]);

  // Also capture lastEvent for safety/weather/obstacle events not in flightLog
  useEffect(() => {
    const evt = liveMission.lastEvent;
    if (!evt) return;

    const eventType = evt.type;
    const d = evt.data || evt;

    if (eventType === 'weather_alert' || eventType === 'obstacle_detected' || eventType === 'geofence_violation') {
      const safetyEvent: LogEvent = {
        id: `live-safety-${Date.now()}`,
        timestamp: new Date().toISOString(),
        type: 'safety',
        severity: eventType === 'weather_alert' ? 'warning' : 'critical',
        event: eventType.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
        location: d.location || d.waypoint || 'Unknown',
        details: d.message || d.details || JSON.stringify(d),
        battery: d.battery ?? 100,
        payload: 'Active Mission',
        position: d.position || { x: 0, y: 0, z: 0 },
        safetyAction: eventType === 'geofence_violation' ? 'DIVERT' : eventType === 'obstacle_detected' ? 'REROUTE' : 'CAUTION',
        safetyReasons: [d.message || d.details || eventType],
        affectedStops: d.affected_stops || [],
      };
      setLiveEvents((prev) => [safetyEvent, ...prev]);
    }
  }, [liveMission.lastEvent]);

  // Merge live events (prepended) with demo fallback
  // Use liveFlightLog from context as additional signal — fall back to DEMO only when no live data
  const hasLiveData = liveEvents.length > 0 || liveFlightLog.length > 0;
  const allEvents: LogEvent[] = hasLiveData
    ? [...liveEvents, ...DEMO_EVENTS]
    : DEMO_EVENTS;

  // ── Safety filter logic ──
  const safetyFilteredEvents = allEvents.filter((ev) => {
    switch (safetyFilter) {
      case 'safety':
        return ev.type === 'safety';
      case 'warnings':
        return ev.severity === 'warning';
      case 'critical':
        return ev.severity === 'critical' || ev.safetyAction === 'DIVERT' || ev.safetyAction === 'ABORT';
      case 'waypoints':
        return ev.event.toLowerCase().includes('arrived') ||
               ev.event.toLowerCase().includes('checkpoint') ||
               ev.event.toLowerCase().includes('waypoint') ||
               ev.event.toLowerCase().includes('landed');
      default:
        return true;
    }
  });

  // ── Standard filtering ──
  const filteredEvents = safetyFilteredEvents.filter((ev) => {
    if (filters.type !== 'all' && ev.type !== filters.type) return false;
    if (filters.severity !== 'all' && ev.severity !== filters.severity) return false;
    if (filters.search) {
      const q = filters.search.toLowerCase();
      if (
        !ev.event.toLowerCase().includes(q) &&
        !ev.location.toLowerCase().includes(q) &&
        !ev.details.toLowerCase().includes(q)
      ) {
        return false;
      }
    }
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filteredEvents.length / ITEMS_PER_PAGE));
  const safePage = Math.min(currentPage, totalPages);
  const pagedEvents = filteredEvents.slice((safePage - 1) * ITEMS_PER_PAGE, safePage * ITEMS_PER_PAGE);

  // ── Weather Briefing ──
  const handleBriefing = async () => {
    if (showBriefing && briefingText) {
      setShowBriefing(false);
      return;
    }
    setShowBriefing(true);
    setIsLoadingBriefing(true);
    try {
      const res = await api.weatherBriefing();
      setBriefingText(res.briefing);
    } catch {
      setBriefingText(
        'All locations currently flyable. Light crosswind (8kt NW) at Royal London \u2014 no impact on operations. Clinic B corridor clear. Recommend standard approach patterns.',
      );
    } finally {
      setIsLoadingBriefing(false);
    }
  };

  // ── Export CSV ──
  const handleExport = () => {
    const header = 'Timestamp,Severity,Event,Location,Details,Battery,Payload,X,Y,Z';
    const rows = filteredEvents.map(
      (ev) =>
        `"${ev.timestamp}","${ev.severity}","${ev.event}","${ev.location}","${ev.details.replace(/"/g, '""')}",${ev.battery},"${ev.payload}",${ev.position.x},${ev.position.y},${ev.position.z}`,
    );
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'dronemedic-mission-log.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Severity Badge ──
  const renderSeverityBadge = (severity: LogEvent['severity']) => {
    const config = {
      info: { bg: 'rgba(0,218,243,0.12)', color: '#00daf3', icon: <CheckCircle size={12} /> },
      warning: { bg: 'rgba(251,191,36,0.12)', color: '#fbbf24', icon: <AlertTriangle size={12} /> },
      critical: { bg: 'rgba(255,68,68,0.12)', color: '#ff4444', icon: <AlertTriangle size={12} /> },
    }[severity];

    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: '2px 8px',
          borderRadius: 9999,
          background: config.bg,
          color: config.color,
          fontSize: 11,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}
      >
        {config.icon}
        {severity}
      </span>
    );
  };

  // ── Safety event styling ──
  const getSafetyBorderColor = (ev: LogEvent): string => {
    if (ev.type !== 'safety') return TYPE_COLORS[ev.type] || '#6b7280';
    const action = (ev.safetyAction || '').toUpperCase();
    if (action.includes('RED') || action.includes('DIVERT') || action.includes('ABORT')) return '#ff4444';
    if (action.includes('AMBER') || action.includes('CAUTION') || action.includes('REROUTE')) return '#fbbf24';
    return '#4ade80'; // GREEN
  };

  // ── Live mission data from context ──
  const { missionStatus, missionProgress, liveBattery, simPayload, activeTask, activeRoute, droneProgress } = useMissionContext();
  const liveTempValue = simPayload?.temperature_c ?? 4.0;
  const liveIntegrity = simPayload?.integrity ?? 'nominal';
  const livePayloadName = activeTask ? Object.values(activeTask.supplies).join(', ') : 'O- Blood, 2 units';
  const liveEtaMin = activeRoute?.estimated_time ? Math.max(0, Math.ceil((activeRoute.estimated_time * (1 - droneProgress)) / 60)) : 0;
  const liveDeadlineMin = activeRoute?.estimated_time ? Math.ceil(activeRoute.estimated_time / 60) : 90;

  // ── Temp bar position ──
  const tempValue = liveTempValue;
  const tempMin = 2;
  const tempMax = 6;
  const tempPercent = Math.max(0, Math.min(100, ((tempValue - tempMin) / (tempMax - tempMin)) * 100));

  // Connection status indicator
  const isLiveConnected = liveMission.connected || px4.connected;

  return (
    <div style={{ height: '100vh', background: '#0a0f13', display: 'flex', flexDirection: 'column', color: '#dfe3e9', fontFamily: 'Inter, sans-serif' }}>
      <PageHeader title="Mission Logs" icon={ClipboardList} statusVariant="completed" />
      <SideNav currentPage="logs" />

      <main style={{ flex: 1, overflowY: 'auto', marginLeft: 96, padding: 24 }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* ═══ Connection Status ═══ */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 16px',
            borderRadius: 8,
            background: isLiveConnected ? 'rgba(74,222,128,0.08)' : 'rgba(255,68,68,0.08)',
            border: `1px solid ${isLiveConnected ? 'rgba(74,222,128,0.2)' : 'rgba(255,68,68,0.2)'}`,
            fontSize: 12,
          }}>
            {isLiveConnected ? (
              <>
                <Wifi size={14} style={{ color: '#4ade80' }} />
                <span style={{ color: '#4ade80', fontWeight: 600 }}>Live</span>
                <span style={{ color: '#7a7e8c' }}>
                  {liveMission.connected && 'Mission WS'}
                  {liveMission.connected && px4.connected && ' + '}
                  {px4.connected && `PX4 Telemetry (${px4.source || 'connecting'})`}
                </span>
                {liveEvents.length > 0 && (
                  <span style={{ marginLeft: 'auto', color: '#00daf3', fontFamily: 'monospace' }}>
                    {liveEvents.length} live event{liveEvents.length !== 1 ? 's' : ''}
                  </span>
                )}
              </>
            ) : (
              <>
                <WifiOff size={14} style={{ color: '#ff4444' }} />
                <span style={{ color: '#ff4444', fontWeight: 600 }}>Offline</span>
                <span style={{ color: '#7a7e8c' }}>Using demo data</span>
              </>
            )}
          </div>

          {/* ═══ Safety Filter Bar ═══ */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 8px',
            borderRadius: 10,
            background: 'rgba(30,35,40,0.6)',
            border: '1px solid rgba(67,70,84,0.15)',
          }}>
            <Shield size={14} style={{ color: '#a855f7', marginLeft: 8 }} />
            <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#7a7e8c', marginRight: 4 }}>Filter:</span>
            {([
              { key: 'all' as SafetyFilter, label: 'All', color: '#dfe3e9' },
              { key: 'safety' as SafetyFilter, label: 'Safety', color: '#a855f7' },
              { key: 'warnings' as SafetyFilter, label: 'Warnings', color: '#fbbf24' },
              { key: 'critical' as SafetyFilter, label: 'Critical', color: '#ff4444' },
              { key: 'waypoints' as SafetyFilter, label: 'Waypoints', color: '#00daf3' },
            ]).map((btn) => (
              <button
                key={btn.key}
                onClick={() => { setSafetyFilter(btn.key); setCurrentPage(1); }}
                style={{
                  background: safetyFilter === btn.key ? `${btn.color}18` : 'transparent',
                  border: safetyFilter === btn.key ? `1px solid ${btn.color}40` : '1px solid transparent',
                  color: safetyFilter === btn.key ? btn.color : '#7a7e8c',
                  borderRadius: 6,
                  padding: '6px 14px',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                {btn.label}
              </button>
            ))}
          </div>

          {/* ═══ Section 1: Active Mission Banner ═══ */}
          <div
            style={{
              ...glassPanel(),
              borderColor: 'rgba(0,218,243,0.3)',
              boxShadow: '0 0 20px rgba(0,218,243,0.15)',
              display: 'flex',
              flexWrap: 'wrap',
              gap: 24,
              alignItems: 'center',
            }}
          >
            {/* ETA */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 120 }}>
              <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#7a7e8c' }}>
                {missionStatus === 'completed' ? 'STATUS' : 'ETA'}
              </span>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                {missionStatus === 'completed' ? (
                  <span style={{ fontSize: 20, fontFamily: 'Space Grotesk', fontWeight: 900, color: '#22c55e', lineHeight: 1 }}>ARRIVED</span>
                ) : missionStatus === 'flying' ? (
                  <>
                    <span style={{ fontSize: 36, fontFamily: 'Space Grotesk', fontWeight: 900, color: '#00daf3', lineHeight: 1 }}>
                      <SlidingNumber value={liveEtaMin} />
                    </span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: '#00daf3', opacity: 0.7 }}>MIN</span>
                  </>
                ) : (
                  <span style={{ fontSize: 20, fontFamily: 'Space Grotesk', fontWeight: 900, color: '#7a7e8c', lineHeight: 1 }}>IDLE</span>
                )}
              </div>
            </div>

            {/* Payload info */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 200 }}>
              <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#7a7e8c' }}>Payload</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
                <span style={{ fontWeight: 600 }}>{livePayloadName}</span>
                <span style={{ color: '#7a7e8c' }}>|</span>
                <span>{liveTempValue.toFixed(1)}&deg;C</span>
                <span style={{ color: '#7a7e8c' }}>|</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: liveIntegrity === 'critical' ? '#ff4444' : liveIntegrity === 'warning' ? '#fbbf24' : '#4ade80' }} />
                  <span style={{ color: liveIntegrity === 'critical' ? '#ff4444' : liveIntegrity === 'warning' ? '#fbbf24' : '#4ade80', fontWeight: 600 }}>
                    {liveIntegrity === 'critical' ? 'Critical' : liveIntegrity === 'warning' ? 'Warning' : 'Nominal'}
                  </span>
                </div>
              </div>
            </div>

            {/* PX4 Telemetry overlay */}
            {px4.telemetry && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 160 }}>
                <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#7a7e8c' }}>PX4 Telemetry</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontFamily: 'monospace', color: '#c3c6d6' }}>
                  <span>{px4.telemetry.speed_m_s.toFixed(1)} m/s</span>
                  <span style={{ color: '#7a7e8c' }}>|</span>
                  <span>{px4.telemetry.alt_m.toFixed(0)}m</span>
                  <span style={{ color: '#7a7e8c' }}>|</span>
                  <span style={{ color: px4.telemetry.battery_pct < 30 ? '#ff4444' : '#4ade80' }}>{px4.telemetry.battery_pct}%</span>
                </div>
              </div>
            )}

            {/* Clinical Deadline */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 260 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#7a7e8c' }}>
                <span>Clinical Deadline</span>
                <span>{liveEtaMin} / {liveDeadlineMin} min</span>
              </div>
              <div style={{ height: 6, borderRadius: 3, background: 'rgba(67,70,84,0.3)', overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${liveDeadlineMin > 0 ? Math.round(((liveDeadlineMin - liveEtaMin) / liveDeadlineMin) * 100) : 0}%`,
                    borderRadius: 3,
                    background: 'linear-gradient(90deg, #4ade80, #22c55e)',
                    transition: 'width 0.6s ease',
                  }}
                />
              </div>
            </div>

            {/* Contingency */}
            <div style={{ width: '100%', fontSize: 12, color: '#7a7e8c', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Radio size={13} style={{ color: '#fbbf24' }} />
              <span>Contingency: Drone Beta at Birmingham, 18 min intercept</span>
            </div>
          </div>

          {/* ═══ Section 2: Chain of Custody Timeline ═══ */}
          <div style={glassPanel()}>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#7a7e8c', marginBottom: 14, fontWeight: 600 }}>Chain of Custody</div>
            <div style={{ display: 'flex', alignItems: 'center', overflowX: 'auto', paddingBottom: 4 }}>
              {CHAIN_OF_CUSTODY.map((step, i) => {
                const isLast = i === CHAIN_OF_CUSTODY.length - 1;
                const circleColor =
                  step.status === 'completed' ? '#4ade80' : step.status === 'current' ? '#00daf3' : '#434654';
                const lineColor =
                  step.status === 'completed' && !isLast && CHAIN_OF_CUSTODY[i + 1].status !== 'future'
                    ? '#4ade80'
                    : '#434654';
                const lineDashed = step.status === 'future' || (CHAIN_OF_CUSTODY[i + 1]?.status === 'future');

                return (
                  <div key={step.label} style={{ display: 'flex', alignItems: 'center' }}>
                    {/* Node */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 64 }}>
                      <span style={{ fontSize: 10, textTransform: 'uppercase', color: step.status === 'future' ? '#434654' : '#c3c6d6', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>
                        {step.label}
                      </span>
                      <div
                        style={{
                          width: 16,
                          height: 16,
                          borderRadius: '50%',
                          background: step.status === 'future' ? 'transparent' : circleColor,
                          border: step.status === 'future' ? `2px solid ${circleColor}` : 'none',
                          boxShadow: step.status === 'current' ? '0 0 8px rgba(0,218,243,0.6)' : 'none',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        {step.status === 'completed' && <CheckCircle size={10} style={{ color: '#0a0f13' }} />}
                      </div>
                      <span style={{ fontSize: 11, fontFamily: 'monospace', color: step.status === 'future' ? '#434654' : '#7a7e8c' }}>
                        {step.time}
                      </span>
                    </div>

                    {/* Connector line */}
                    {!isLast && (
                      <div
                        style={{
                          width: 32,
                          height: 2,
                          background: lineColor,
                          borderStyle: lineDashed ? 'dashed' : 'solid',
                          borderWidth: lineDashed ? '1px 0 0 0' : 0,
                          borderColor: lineColor,
                          marginTop: -10,
                          ...(lineDashed ? { background: 'transparent', borderTopWidth: 2, borderTopStyle: 'dashed', height: 0 } : {}),
                        }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* ═══ Section 3: Payload Integrity ═══ */}
          <div style={glassPanel({ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' })}>
            <Thermometer size={18} style={{ color: '#00daf3' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 13, flex: 1, minWidth: 200 }}>
              <span style={{ fontWeight: 600 }}>Payload: O- Blood</span>
              <span style={{ color: '#7a7e8c' }}>|</span>
              <span>Temp: <span style={{ color: liveIntegrity === 'critical' ? '#ff4444' : liveIntegrity === 'warning' ? '#fbbf24' : '#4ade80', fontWeight: 600 }}>{liveTempValue.toFixed(1)}&deg;C</span></span>
              <span style={{ color: '#7a7e8c' }}>|</span>
              <span>Integrity: <span style={{ color: '#4ade80', fontWeight: 600 }}>Nominal</span></span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 220, flex: 1 }}>
              <span style={{ fontSize: 11, color: '#7a7e8c', fontFamily: 'monospace' }}>2&deg;C</span>
              <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'rgba(67,70,84,0.3)', position: 'relative', overflow: 'hidden' }}>
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    height: '100%',
                    width: `${tempPercent}%`,
                    borderRadius: 4,
                    background: 'linear-gradient(90deg, #3b82f6, #4ade80)',
                  }}
                />
                <div
                  style={{
                    position: 'absolute',
                    left: `${tempPercent}%`,
                    top: -2,
                    width: 12,
                    height: 12,
                    borderRadius: '50%',
                    background: '#4ade80',
                    border: '2px solid #0a0f13',
                    transform: 'translateX(-50%)',
                  }}
                />
              </div>
              <span style={{ fontSize: 11, color: '#7a7e8c', fontFamily: 'monospace' }}>6&deg;C</span>
            </div>
          </div>

          {/* ═══ Section 4: Filter Bar ═══ */}
          <div style={{ ...glassPanel(), display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            {/* Type filter */}
            <select
              value={filters.type}
              onChange={(e) => { setFilters({ ...filters, type: e.target.value }); setCurrentPage(1); }}
              style={{
                background: 'rgba(30,35,40,0.85)',
                border: '1px solid rgba(67,70,84,0.2)',
                color: '#dfe3e9',
                borderRadius: 8,
                padding: '8px 12px',
                fontSize: 13,
                outline: 'none',
                cursor: 'pointer',
              }}
            >
              <option value="all">All Types</option>
              <option value="flight">Flight</option>
              <option value="weather">Weather</option>
              <option value="system">System</option>
              <option value="delivery">Delivery</option>
              <option value="safety">Safety</option>
              <option value="error">Error</option>
            </select>

            {/* Severity filter */}
            <select
              value={filters.severity}
              onChange={(e) => { setFilters({ ...filters, severity: e.target.value }); setCurrentPage(1); }}
              style={{
                background: 'rgba(30,35,40,0.85)',
                border: '1px solid rgba(67,70,84,0.2)',
                color: '#dfe3e9',
                borderRadius: 8,
                padding: '8px 12px',
                fontSize: 13,
                outline: 'none',
                cursor: 'pointer',
              }}
            >
              <option value="all">All Severities</option>
              <option value="info">Info</option>
              <option value="warning">Warning</option>
              <option value="critical">Critical</option>
            </select>

            {/* Search */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(30,35,40,0.85)', border: '1px solid rgba(67,70,84,0.2)', borderRadius: 8, padding: '6px 12px', flex: 1, minWidth: 180 }}>
              <Search size={14} style={{ color: '#7a7e8c' }} />
              <input
                type="text"
                placeholder="Search events..."
                value={filters.search}
                onChange={(e) => { setFilters({ ...filters, search: e.target.value }); setCurrentPage(1); }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: '#dfe3e9',
                  fontSize: 13,
                  width: '100%',
                }}
              />
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
              <LiquidButton size="sm" onClick={handleBriefing} style={{ fontSize: 12, height: 'auto', padding: '8px 14px' }}>
                <CloudLightning size={14} />
                Weather Briefing
              </LiquidButton>
              <LiquidButton size="sm" onClick={handleExport} style={{ fontSize: 12, height: 'auto', padding: '8px 14px' }}>
                <Download size={14} />
                Export CSV
              </LiquidButton>
            </div>
          </div>

          {/* ═══ Section 5: Weather Briefing Panel ═══ */}
          <AnimatePresence>
            {showBriefing && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.3 }}
                style={{ overflow: 'hidden' }}
              >
                <div
                  style={{
                    ...glassPanel(),
                    borderColor: '#fbbf24',
                    borderWidth: 1,
                    borderStyle: 'solid',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 12,
                  }}
                >
                  <CloudLightning size={18} style={{ color: '#fbbf24', flexShrink: 0, marginTop: 2 }} />
                  {isLoadingBriefing ? (
                    <div style={{ display: 'flex', gap: 4 }}>
                      {[0, 1, 2].map((i) => (
                        <motion.div
                          key={i}
                          animate={{ y: [0, -4, 0] }}
                          transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.15 }}
                          style={{ width: 6, height: 6, borderRadius: '50%', background: 'rgba(251,191,36,0.5)' }}
                        />
                      ))}
                    </div>
                  ) : (
                    <p style={{ margin: 0, fontSize: 13, lineHeight: 1.7, color: '#c3c6d6' }}>{briefingText}</p>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ═══ Section 6: Log Table ═══ */}
          <div style={glassPanel({ padding: 0, overflow: 'hidden' })}>
            {/* Table header */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '90px 90px 1fr 140px 2fr 80px 140px 32px',
                gap: 0,
                padding: '12px 16px',
                borderBottom: '1px solid rgba(67,70,84,0.15)',
                fontSize: 10,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                color: '#7a7e8c',
                fontWeight: 600,
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Clock size={11} /> Time</span>
              <span>Severity</span>
              <span>Event</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><MapPin size={11} /> Location</span>
              <span>Details</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Battery size={11} /> Batt</span>
              <span>Payload</span>
              <span />
            </div>

            {/* Table rows */}
            {pagedEvents.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: '#7a7e8c', fontSize: 13 }}>
                No events match the current filters.
              </div>
            ) : (
              pagedEvents.map((ev) => {
                const accentColor = ev.type === 'safety' ? getSafetyBorderColor(ev) : (TYPE_COLORS[ev.type] || '#6b7280');
                const isExpanded = expandedId === ev.id;

                return (
                  <div key={ev.id}>
                    <div
                      onClick={() => setExpandedId(isExpanded ? null : ev.id)}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '90px 90px 1fr 140px 2fr 80px 140px 32px',
                        gap: 0,
                        padding: '10px 16px',
                        borderLeft: `3px solid ${accentColor}`,
                        borderBottom: '1px solid rgba(67,70,84,0.08)',
                        fontSize: 13,
                        cursor: 'pointer',
                        transition: 'background 0.15s',
                        background: isExpanded ? 'rgba(0,218,243,0.04)' : 'transparent',
                      }}
                      onMouseEnter={(e) => { if (!isExpanded) (e.currentTarget as HTMLDivElement).style.background = 'rgba(0,218,243,0.05)'; }}
                      onMouseLeave={(e) => { if (!isExpanded) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
                    >
                      <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#7a7e8c' }}>{formatTime(ev.timestamp)}</span>
                      <span>{renderSeverityBadge(ev.severity)}</span>
                      <span style={{ fontWeight: 600, color: accentColor }}>{ev.event}</span>
                      <span style={{ color: '#c3c6d6', fontSize: 12 }}>{ev.location}</span>
                      <span style={{ color: '#9a9dab', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev.details}</span>
                      <span style={{ fontFamily: 'monospace', fontSize: 12, color: ev.battery < 40 ? '#fbbf24' : '#7a7e8c' }}>{ev.battery}%</span>
                      <span style={{ fontSize: 12, color: '#9a9dab', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev.payload}</span>
                      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {isExpanded ? <ChevronUp size={14} style={{ color: '#7a7e8c' }} /> : <ChevronDown size={14} style={{ color: '#7a7e8c' }} />}
                      </span>
                    </div>

                    {/* ═══ Section 7: Expanded Event Detail ═══ */}
                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ duration: 0.2 }}
                          style={{ overflow: 'hidden' }}
                        >
                          <div
                            style={{
                              margin: '0 16px 12px 16px',
                              padding: 16,
                              borderRadius: 10,
                              background: 'rgba(15,20,24,0.6)',
                              border: `1px solid ${accentColor}30`,
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 10,
                            }}
                          >
                            <div style={{ display: 'flex', gap: 24, fontSize: 12 }}>
                              <div>
                                <span style={{ color: '#7a7e8c' }}>Position: </span>
                                <span style={{ fontFamily: 'monospace', color: '#c3c6d6' }}>
                                  x={ev.position.x}, y={ev.position.y}, z={ev.position.z}
                                </span>
                              </div>
                              <div>
                                <span style={{ color: '#7a7e8c' }}>Battery: </span>
                                <span style={{ fontFamily: 'monospace', color: ev.battery < 40 ? '#fbbf24' : '#4ade80' }}>{ev.battery}%</span>
                              </div>
                              <div>
                                <span style={{ color: '#7a7e8c' }}>Type: </span>
                                <span style={{ color: accentColor, fontWeight: 600, textTransform: 'uppercase', fontSize: 11 }}>{ev.type}</span>
                              </div>
                            </div>
                            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.7, color: '#c3c6d6' }}>{ev.details}</p>

                            {/* Safety event details */}
                            {ev.type === 'safety' && (
                              <div style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 8,
                                padding: '10px 14px',
                                borderRadius: 8,
                                background: ev.severity === 'critical'
                                  ? 'rgba(255,68,68,0.06)'
                                  : ev.severity === 'warning'
                                    ? 'rgba(251,191,36,0.06)'
                                    : 'rgba(74,222,128,0.06)',
                                border: `1px solid ${accentColor}25`,
                              }}>
                                {ev.safetyAction && (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                                    <Shield size={13} style={{ color: accentColor }} />
                                    <span style={{ fontWeight: 700, color: accentColor }}>Action: {ev.safetyAction}</span>
                                  </div>
                                )}
                                {ev.safetyReasons && ev.safetyReasons.length > 0 && (
                                  <div style={{ fontSize: 12, color: '#c3c6d6' }}>
                                    <span style={{ color: '#7a7e8c' }}>Reasons: </span>
                                    {ev.safetyReasons.join(', ')}
                                  </div>
                                )}
                                {ev.affectedStops && ev.affectedStops.length > 0 && (
                                  <div style={{ fontSize: 12, color: '#c3c6d6' }}>
                                    <span style={{ color: '#7a7e8c' }}>Affected Stops: </span>
                                    {ev.affectedStops.join(', ')}
                                  </div>
                                )}
                              </div>
                            )}

                            {ev.event.toLowerCase().includes('reroute') || ev.event.toLowerCase().includes('recalculation') ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#fbbf24', padding: '8px 12px', borderRadius: 8, background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.15)' }}>
                                <AlertTriangle size={13} />
                                <span>Route deviation event. Original ETA was adjusted due to airspace conditions.</span>
                              </div>
                            ) : null}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })
            )}

            {/* Pagination */}
            {filteredEvents.length > ITEMS_PER_PAGE && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 16,
                  padding: '12px 16px',
                  borderTop: '1px solid rgba(67,70,84,0.15)',
                  fontSize: 13,
                }}
              >
                <button
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={safePage <= 1}
                  style={{
                    background: 'rgba(30,35,40,0.85)',
                    border: '1px solid rgba(67,70,84,0.2)',
                    color: safePage <= 1 ? '#434654' : '#dfe3e9',
                    borderRadius: 6,
                    padding: '6px 14px',
                    fontSize: 12,
                    cursor: safePage <= 1 ? 'not-allowed' : 'pointer',
                  }}
                >
                  Prev
                </button>
                <span style={{ color: '#7a7e8c' }}>
                  Page {safePage} of {totalPages}
                </span>
                <button
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={safePage >= totalPages}
                  style={{
                    background: 'rgba(30,35,40,0.85)',
                    border: '1px solid rgba(67,70,84,0.2)',
                    color: safePage >= totalPages ? '#434654' : '#dfe3e9',
                    borderRadius: 6,
                    padding: '6px 14px',
                    fontSize: 12,
                    cursor: safePage >= totalPages ? 'not-allowed' : 'pointer',
                  }}
                >
                  Next
                </button>
              </div>
            )}
          </div>

          {/* Bottom spacer */}
          <div style={{ height: 24 }} />
        </div>
      </main>
    </div>
  );
}
