import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Cpu, Battery, MapPin, CheckCircle, XCircle, AlertTriangle, Wrench, Activity } from 'lucide-react';
import { SlidingNumber } from '@/components/ui/sliding-number';
import { GlassPanel } from '../components/ui/GlassPanel';
import { SideNav } from '../components/layout/SideNav';
import { PageHeader } from '../components/layout/PageHeader';
import { useDrones } from '../hooks/useSupabase';
import { useMissionContext } from '../context/MissionContext';

// ── Types ──

interface DroneData {
  id: string;
  status: string;
  battery: number;
  current_location: string;
  speed: number;
  altitude: number;
  total_completed_missions: number;
  total_failed_missions: number;
  maintenance_risk?: number;
  active_mission_id?: string;
}

// ── Demo Fallback ──

const DEMO_FLEET: DroneData[] = [
  { id: 'Drone1', status: 'idle', battery: 94, current_location: 'Depot', speed: 0, altitude: 0, total_completed_missions: 47, total_failed_missions: 2 },
  { id: 'Drone2', status: 'en_route', battery: 67, current_location: 'Royal London', speed: 42, altitude: 120, total_completed_missions: 33, total_failed_missions: 1, maintenance_risk: 35, active_mission_id: 'MSN-0042' },
  { id: 'Drone3', status: 'offline', battery: 12, current_location: 'Homerton', speed: 0, altitude: 0, total_completed_missions: 28, total_failed_missions: 3, maintenance_risk: 82 },
];

// ── Demo Maintenance Alerts ──

const DEMO_ALERTS = [
  { droneId: 'Drone3', severity: 'critical' as const, message: 'Battery below 15% — ground immediately for charging', ts: '2 min ago' },
  { droneId: 'Drone3', severity: 'warning' as const, message: 'Motor 2 vibration anomaly detected — inspect before next flight', ts: '18 min ago' },
  { droneId: 'Drone2', severity: 'info' as const, message: 'Propeller replacement due in 12 flight hours', ts: '1 hr ago' },
];

// ── Status Config ──

const statusConfig: Record<string, { label: string; color: string; pulse: boolean }> = {
  idle: { label: 'Idle', color: '#6b7280', pulse: false },
  en_route: { label: 'En Route', color: '#00daf3', pulse: true },
  returning: { label: 'Returning', color: '#f59e0b', pulse: true },
  emergency: { label: 'Emergency', color: '#ef4444', pulse: true },
  offline: { label: 'Offline', color: '#374151', pulse: false },
  charging: { label: 'Charging', color: '#22c55e', pulse: false },
};

// ── Styles ──

const glassCard: React.CSSProperties = {
  background: 'rgba(23,28,32,0.7)',
  backdropFilter: 'blur(24px)',
  border: '1px solid rgba(141,144,160,0.1)',
  borderRadius: 12,
  padding: 20,
};

const sectionTitle: React.CSSProperties = {
  fontFamily: 'Space Grotesk',
  fontSize: 11,
  fontWeight: 700,
  color: '#8d90a0',
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
  marginBottom: 12,
};

// ── Battery Gauge (SVG Circle) ──

function BatteryGauge({ value, size = 80 }: { value: number; size?: number }) {
  const strokeWidth = 5;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.min(value / 100, 1);
  const dashoffset = circumference * (1 - progress);
  const color = value > 50 ? '#22c55e' : value > 20 ? '#f59e0b' : '#ef4444';

  return (
    <div role="meter" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100} aria-label="Battery level" style={{ width: size, height: size, position: 'relative' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }} aria-hidden="true">
        <defs>
          <filter id={`batteryGlow-${value}`}>
            <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor={color} floodOpacity="0.5" />
          </filter>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#30353a" strokeWidth={strokeWidth} />
        <circle
          cx={size / 2} cy={size / 2} r={radius} fill="none"
          stroke={color} strokeWidth={strokeWidth} strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={dashoffset}
          style={{ transition: 'stroke-dashoffset 0.6s ease-out', filter: `url(#batteryGlow-${value})` }}
        />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
        <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 18, fontWeight: 700, color: '#ffffff', lineHeight: 1 }}>{Math.round(value)}</span>
        <span style={{ fontSize: 8, color: '#9ca3af', marginTop: 1 }}>%</span>
      </div>
    </div>
  );
}

// ── Drone Card ──

function DroneCard({ drone }: { drone: DroneData }) {
  const config = statusConfig[drone.status] ?? statusConfig.idle;
  const maintenanceRisk = drone.maintenance_risk ?? Math.round(Math.random() * 40 + 10);
  const riskHigh = maintenanceRisk > 70;

  return (
    <GlassPanel className="flex flex-col gap-4" role="article" aria-label={`${drone.id} status`}>
      {/* Header: ID + Status */}
      <div className="flex items-center justify-between">
        <span style={{ fontFamily: 'Space Grotesk', fontSize: 14, fontWeight: 700, color: '#dfe3e9' }}>{drone.id}</span>
        <div className="flex items-center gap-2">
          <div className="relative">
            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: config.color }} />
            {config.pulse && (
              <motion.div
                animate={{ scale: [1, 2.2], opacity: [0.5, 0] }}
                transition={{ duration: 1.5, repeat: Infinity }}
                className="absolute inset-0 rounded-full"
                style={{ backgroundColor: config.color }}
              />
            )}
          </div>
          <span style={{ fontSize: 11, fontWeight: 600, color: config.color }}>{config.label}</span>
        </div>
      </div>

      {/* Battery Gauge + Location */}
      <div className="flex items-center gap-4">
        <BatteryGauge value={drone.battery} />
        <div className="flex flex-col gap-2 flex-1 min-w-0">
          <div className="flex items-center gap-1.5 text-xs" style={{ color: '#8d90a0' }}>
            <MapPin size={12} />
            <span className="truncate">{drone.current_location}</span>
          </div>
          {drone.active_mission_id && (
            <div className="flex items-center gap-1.5 text-xs" style={{ color: '#00daf3' }}>
              <Activity size={12} />
              <span className="truncate">{drone.active_mission_id}</span>
            </div>
          )}
          <div className="flex items-center gap-3 text-xs" style={{ color: '#8d90a0' }}>
            <span className="flex items-center gap-1"><CheckCircle size={11} style={{ color: '#22c55e' }} /> {drone.total_completed_missions}</span>
            <span className="flex items-center gap-1"><XCircle size={11} style={{ color: '#ef4444' }} /> {drone.total_failed_missions}</span>
          </div>
        </div>
      </div>

      {/* Maintenance Risk */}
      <div className="flex items-center justify-between">
        <span style={{ fontSize: 10, color: '#8d90a0', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Maint. Risk</span>
        <span
          className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold"
          style={{
            backgroundColor: riskHigh ? 'rgba(239,68,68,0.15)' : 'rgba(34,197,94,0.1)',
            color: riskHigh ? '#ef4444' : '#22c55e',
            fontSize: 11,
          }}
        >
          {riskHigh && <AlertTriangle size={11} />}
          {maintenanceRisk}%
        </span>
      </div>
    </GlassPanel>
  );
}

// ── Fleet Page ──

export function Fleet() {
  const { fleetPhysics, droneAlerts, fleetSummary, completedMissions } = useMissionContext();
  const { drones: liveDrones, loading } = useDrones();

  const fleet: DroneData[] = useMemo(() => {
    // Primary: build from physics simulation
    const mapData = fleetPhysics.getDroneMapData();
    if (mapData.length > 0) {
      const physicsFleet: DroneData[] = mapData.map((d) => {
        const telemetry = fleetPhysics.getTelemetry(d.id);
        const droneCompletedMissions = completedMissions.filter((m) => m.droneId === d.id).length;
        return {
          id: d.id,
          status: d.status === 'flying' ? 'en_route' : d.status,
          battery: telemetry?.battery_pct ?? 100,
          current_location: telemetry ? `${telemetry.lat.toFixed(4)}, ${telemetry.lon.toFixed(4)}` : 'Depot',
          speed: Math.round((telemetry?.speed_ms ?? 0) * 3.6),
          altitude: Math.round(telemetry?.alt ?? 0),
          total_completed_missions: droneCompletedMissions,
          total_failed_missions: 0,
          maintenance_risk: telemetry?.battery_pct != null && telemetry.battery_pct < 30 ? 80 : 15,
          active_mission_id: d.status === 'flying' ? `MSN-${d.id}` : undefined,
        };
      });

      // Merge with Supabase data if available
      if (liveDrones.length > 0) {
        const physicsIds = new Set(physicsFleet.map((d) => d.id));
        const supabaseOnly = liveDrones
          .filter((d) => !physicsIds.has(d.id))
          .map((d) => ({
            id: d.id,
            status: (d as Record<string, unknown>).status as string ?? 'idle',
            battery: (d as Record<string, unknown>).battery as number ?? 100,
            current_location: (d as Record<string, unknown>).current_location as string ?? 'Unknown',
            speed: (d as Record<string, unknown>).speed as number ?? 0,
            altitude: (d as Record<string, unknown>).altitude as number ?? 0,
            total_completed_missions: (d as Record<string, unknown>).total_completed_missions as number ?? 0,
            total_failed_missions: (d as Record<string, unknown>).total_failed_missions as number ?? 0,
            maintenance_risk: (d as Record<string, unknown>).maintenance_risk as number | undefined,
            active_mission_id: (d as Record<string, unknown>).active_mission_id as string | undefined,
          }));
        return [...physicsFleet, ...supabaseOnly];
      }

      return physicsFleet;
    }

    // Secondary: Supabase data
    if (liveDrones.length > 0) {
      return liveDrones.map((d) => ({
        id: d.id,
        status: (d as Record<string, unknown>).status as string ?? 'idle',
        battery: (d as Record<string, unknown>).battery as number ?? 100,
        current_location: (d as Record<string, unknown>).current_location as string ?? 'Unknown',
        speed: (d as Record<string, unknown>).speed as number ?? 0,
        altitude: (d as Record<string, unknown>).altitude as number ?? 0,
        total_completed_missions: (d as Record<string, unknown>).total_completed_missions as number ?? 0,
        total_failed_missions: (d as Record<string, unknown>).total_failed_missions as number ?? 0,
        maintenance_risk: (d as Record<string, unknown>).maintenance_risk as number | undefined,
        active_mission_id: (d as Record<string, unknown>).active_mission_id as string | undefined,
      }));
    }

    // Fallback: demo data
    return DEMO_FLEET;
  }, [fleetPhysics, liveDrones, completedMissions]);

  // Summary stats — prefer fleetSummary from context, fall back to local computation
  const totalDrones = fleetSummary.totalDrones > 0 ? fleetSummary.totalDrones : fleet.length;
  const availableCount = fleetSummary.totalDrones > 0 ? fleetSummary.idleDrones : fleet.filter((d) => d.status === 'idle' || d.status === 'charging').length;
  const activeMissions = fleetSummary.totalDrones > 0 ? fleetSummary.activeDrones : fleet.filter((d) => d.status === 'en_route' || d.status === 'returning' || d.status === 'emergency').length;
  const avgBattery = fleetSummary.totalDrones > 0 ? Math.round(fleetSummary.avgBattery) : (fleet.length > 0 ? Math.round(fleet.reduce((sum, d) => sum + d.battery, 0) / fleet.length) : 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0f1418' }}>
      <PageHeader title="Fleet Management" icon={Cpu} />

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <SideNav currentPage="fleet" />

        {/* Main content */}
        <main className="flex-1 overflow-y-auto p-6 pb-20 md:pl-20 lg:pl-24" style={{}}>
          {/* Fleet Summary Bar */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-7"
            style={{}}
          >
            {[
              { label: 'Total Drones', value: totalDrones, icon: <Cpu size={16} style={{ color: '#00daf3' }} /> },
              { label: 'Available', value: availableCount, icon: <CheckCircle size={16} style={{ color: '#22c55e' }} /> },
              { label: 'Active Missions', value: activeMissions, icon: <Activity size={16} style={{ color: '#f59e0b' }} /> },
              { label: 'Avg Battery', value: avgBattery, icon: <Battery size={16} style={{ color: avgBattery > 50 ? '#22c55e' : avgBattery > 20 ? '#f59e0b' : '#ef4444' }} />, suffix: '%' },
            ].map((stat) => (
              <div key={stat.label} style={glassCard}>
                <div className="flex items-center gap-2 mb-2">
                  {stat.icon}
                  <span style={{ ...sectionTitle, marginBottom: 0 }}>{stat.label}</span>
                </div>
                <div className="flex items-baseline gap-1">
                  <span style={{ fontFamily: 'Space Grotesk', fontSize: 28, fontWeight: 800, color: '#dfe3e9' }}>
                    <SlidingNumber value={stat.value} />
                  </span>
                  {stat.suffix && <span style={{ fontSize: 14, color: '#8d90a0' }}>{stat.suffix}</span>}
                </div>
              </div>
            ))}
          </motion.div>

          {/* Drone Grid */}
          <div style={{ ...sectionTitle, marginBottom: 16 }}>Fleet Status</div>

          {loading ? (
            <div className="flex items-center justify-center py-12" style={{ color: '#8d90a0' }}>
              <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}>
                <Cpu size={24} />
              </motion.div>
              <span className="ml-3 text-sm">Loading fleet data...</span>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16, marginBottom: 32 }}>
              {fleet.map((drone, i) => (
                <motion.div
                  key={drone.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: i * 0.08 }}
                >
                  <DroneCard drone={drone} />
                </motion.div>
              ))}
            </div>
          )}

          {/* Maintenance Alerts */}
          <div style={{ ...sectionTitle, marginBottom: 16 }}>
            <span className="flex items-center gap-2">
              <Wrench size={13} style={{ color: '#f59e0b' }} />
              Predictive Maintenance Alerts
            </span>
          </div>

          <div className="flex flex-col gap-3 mb-8">
            {/* Live alerts from context, then demo fallback */}
            {[
              ...droneAlerts
                .filter((a) => !a.acknowledged)
                .map((a) => ({
                  droneId: a.droneId,
                  severity: a.severity as 'critical' | 'warning' | 'info',
                  message: a.message,
                  ts: new Date(a.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
                })),
              ...DEMO_ALERTS,
            ].map((alert, i) => {
              const severityColors = {
                critical: { bg: 'rgba(239,68,68,0.1)', border: 'rgba(239,68,68,0.25)', text: '#ef4444' },
                warning: { bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.25)', text: '#f59e0b' },
                info: { bg: 'rgba(0,218,243,0.06)', border: 'rgba(0,218,243,0.15)', text: '#00daf3' },
              };
              const sc = severityColors[alert.severity];

              return (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.3, delay: i * 0.06 }}
                  style={{
                    ...glassCard,
                    padding: '14px 18px',
                    borderLeft: `3px solid ${sc.text}`,
                    background: sc.bg,
                    border: `1px solid ${sc.border}`,
                    borderLeftWidth: 3,
                    borderLeftColor: sc.text,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                  }}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <AlertTriangle size={16} style={{ color: sc.text, flexShrink: 0 }} />
                    <div className="min-w-0">
                      <span style={{ fontSize: 12, fontWeight: 700, color: sc.text, marginRight: 8 }}>{alert.droneId}</span>
                      <span style={{ fontSize: 12, color: '#dfe3e9' }}>{alert.message}</span>
                    </div>
                  </div>
                  <span style={{ fontSize: 10, color: '#8d90a0', whiteSpace: 'nowrap', flexShrink: 0 }}>{alert.ts}</span>
                </motion.div>
              );
            })}
          </div>
        </main>
      </div>
    </div>
  );
}
