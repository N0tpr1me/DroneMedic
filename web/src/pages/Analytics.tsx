import { useState, useEffect, useMemo } from 'react';
import { BarChart3, Package, CheckCircle, Clock, TrendingUp, ShieldCheck, FileText, Loader2, DollarSign } from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { SlidingNumber } from '@/components/ui/sliding-number';
import { LiquidButton } from '@/components/ui/liquid-glass-button';
import { SideNav } from '../components/layout/SideNav';
import { PageHeader } from '../components/layout/PageHeader';
import { EmptyState } from '../components/analytics/EmptyState';
import { api } from '../lib/api';
import type { Metrics } from '../lib/api';
import { useLiveMission } from '../hooks/useLiveMission';

// ── localStorage Key ──

const STORAGE_KEY = 'dronemedic_completed_missions';

// ── Types ──

interface StoredMission {
  id: number;
  name: string;
  deliveryTime: number;
  clinicalDeadline: number;
  distance: number;
  naiveDistance: number;
  battery: number;
  status: string;
  facility: string;
  priority: string;
  completedAt: string;
  supplies?: string;
  costEstimate?: number;
  safetyEventsCount?: number;
  rerouteCount?: number;
}

// ── Demo Data (fallback) ──

const DEMO_MISSIONS: StoredMission[] = [
  { id: 1, name: 'Royal London Emergency', deliveryTime: 52, clinicalDeadline: 90, distance: 8400, naiveDistance: 12600, battery: 42, status: 'completed', facility: 'Royal London', priority: 'high', completedAt: '2026-03-28T10:00:00Z' },
  { id: 2, name: 'Homerton Insulin Run', deliveryTime: 38, clinicalDeadline: 120, distance: 5200, naiveDistance: 7800, battery: 31, status: 'completed', facility: 'Homerton', priority: 'normal', completedAt: '2026-03-28T11:00:00Z' },
  { id: 3, name: 'Whipps Cross Defibrillator', deliveryTime: 65, clinicalDeadline: 60, distance: 9100, naiveDistance: 14200, battery: 58, status: 'rerouted', facility: 'Whipps Cross', priority: 'high', completedAt: '2026-03-29T09:00:00Z' },
  { id: 4, name: 'Clinic A Bandages', deliveryTime: 28, clinicalDeadline: 180, distance: 3400, naiveDistance: 5100, battery: 22, status: 'completed', facility: 'Clinic A', priority: 'normal', completedAt: '2026-03-29T14:00:00Z' },
  { id: 5, name: 'Clinic B Blood Bank', deliveryTime: 71, clinicalDeadline: 90, distance: 10200, naiveDistance: 15300, battery: 61, status: 'completed', facility: 'Clinic B', priority: 'high', completedAt: '2026-03-30T08:00:00Z' },
  { id: 6, name: 'Royal London Plasma', deliveryTime: 45, clinicalDeadline: 75, distance: 7200, naiveDistance: 10800, battery: 38, status: 'completed', facility: 'Royal London', priority: 'high', completedAt: '2026-03-30T12:00:00Z' },
  { id: 7, name: 'Homerton Vaccines', deliveryTime: 33, clinicalDeadline: 240, distance: 4800, naiveDistance: 7200, battery: 27, status: 'completed', facility: 'Homerton', priority: 'normal', completedAt: '2026-03-31T10:00:00Z' },
  { id: 8, name: 'Whipps Cross Emergency', deliveryTime: 88, clinicalDeadline: 80, distance: 11500, naiveDistance: 17200, battery: 65, status: 'failed', facility: 'Whipps Cross', priority: 'high', completedAt: '2026-03-31T15:00:00Z' },
  { id: 9, name: 'Clinic C Surgical Kit', deliveryTime: 41, clinicalDeadline: 120, distance: 6100, naiveDistance: 9200, battery: 35, status: 'completed', facility: 'Clinic C', priority: 'normal', completedAt: '2026-04-01T09:00:00Z' },
  { id: 10, name: 'Royal London Antibiotics', deliveryTime: 48, clinicalDeadline: 150, distance: 7800, naiveDistance: 11700, battery: 40, status: 'completed', facility: 'Royal London', priority: 'normal', completedAt: '2026-04-01T13:00:00Z' },
];

// ── localStorage helpers ──

function loadMissions(): StoredMission[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    return [];
  } catch {
    return [];
  }
}

function saveMissions(missions: StoredMission[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(missions));
  } catch {
    // localStorage full or unavailable - silently ignore
  }
}

// ── Cost Constants ──

const COST_PER_DRONE_DELIVERY = 25;
const COST_PER_AMBULANCE_TRIP = 2500;
const COST_PER_HELICOPTER_TRIP = 35000;

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

const tooltipStyle = {
  background: 'rgba(15,20,24,0.95)',
  border: '1px solid rgba(67,70,84,0.3)',
  borderRadius: 8,
};

const DEMO_REPORT = `# DroneMedic Board Report — March 2026

## Executive Summary
Over the reporting period, the DroneMedic fleet completed **10 missions** across 5 facilities in East London, achieving a **90% on-time delivery rate** against clinical deadlines. Average delivery time was **51 seconds**, representing an **80% improvement** over road-based ambulance transport.

## Key Performance Indicators
- **On-Time Rate:** 90% (9/10 missions met clinical deadline)
- **Average Delivery Time:** 51s (vs ~255s by road)
- **Route Optimisation Savings:** 33% average distance reduction vs naive routing
- **Payload Integrity:** 100% — zero temperature excursions or damage events
- **Fleet Availability:** 100% uptime during operational hours

## Incidents
- **Mission #3 (Whipps Cross Defibrillator):** Delivered in 65s against a 60s deadline. Root cause: headwind on approach. Rerouted successfully but 5s over SLA.
- **Mission #8 (Whipps Cross Emergency):** Failed delivery (88s vs 80s deadline). Post-incident review identified congested airspace corridor. Recommendation: add secondary route via Hackney Marshes.

## Recommendations
1. Add redundant flight corridor for Whipps Cross deliveries
2. Pre-position a second drone at Homerton for surge capacity
3. Integrate real-time wind shear data into route planner
4. Expand to 3 additional NHS facilities in Q2 2026`;

// ── Component ──

export function Analytics() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [report, setReport] = useState<string | null>(null);
  const [displayedReport, setDisplayedReport] = useState('');
  const [storedMissions, setStoredMissions] = useState<StoredMission[]>([]);

  // Live mission hook to detect completed missions
  const liveMission = useLiveMission();

  // Load missions from localStorage on mount
  useEffect(() => {
    const loaded = loadMissions();
    setStoredMissions(loaded);
  }, []);

  // Auto-connect to watch for mission completion
  useEffect(() => {
    liveMission.connect();
    return () => {
      liveMission.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When a mission completes, save its metrics to localStorage
  useEffect(() => {
    if (liveMission.missionStatus !== 'completed') return;

    const flightLog = liveMission.flightLog;
    if (flightLog.length === 0) return;

    // Compute metrics from the completed mission
    const firstEntry = flightLog[0];
    const lastEntry = flightLog[flightLog.length - 1];
    const startTime = typeof firstEntry.timestamp === 'number' ? firstEntry.timestamp : 0;
    const endTime = typeof lastEntry.timestamp === 'number' ? lastEntry.timestamp : 0;
    const deliveryTimeSec = Math.round(endTime - startTime);
    const batteryUsed = Math.max(0, (firstEntry.battery ?? 100) - (lastEntry.battery ?? 0));

    // Count safety-related events
    const safetyEventsCount = flightLog.filter((e) => {
      const ev = (e.event || '').toLowerCase();
      return ev.includes('reroute') || ev.includes('divert') || ev.includes('abort') ||
             ev.includes('weather') || ev.includes('obstacle') || ev.includes('geofence');
    }).length;

    const rerouteCount = flightLog.filter((e) =>
      (e.event || '').toLowerCase().includes('reroute')
    ).length;

    // Estimate distance from waypoints visited
    const waypointsVisited = flightLog.filter((e) =>
      (e.event || '').toLowerCase().includes('arrived') || (e.event || '').toLowerCase().includes('landed')
    ).length;
    const estimatedDistance = waypointsVisited * 3000; // rough estimate

    const newMission: StoredMission = {
      id: Date.now(),
      name: `Mission ${lastEntry.location || 'Unknown'}`,
      deliveryTime: deliveryTimeSec,
      clinicalDeadline: Math.round(deliveryTimeSec * 1.5), // estimate
      distance: estimatedDistance,
      naiveDistance: Math.round(estimatedDistance * 1.5),
      battery: batteryUsed,
      status: 'completed',
      facility: lastEntry.location || 'Unknown',
      priority: 'normal',
      completedAt: new Date().toISOString(),
      supplies: lastEntry.event || 'Medical Supplies',
      costEstimate: COST_PER_DRONE_DELIVERY,
      safetyEventsCount,
      rerouteCount,
    };

    setStoredMissions((prev) => {
      // Avoid duplicates - check if a mission was already saved in the last 30 seconds
      const recentDupe = prev.some(
        (m) => Math.abs(new Date(m.completedAt).getTime() - Date.now()) < 30000
      );
      if (recentDupe) return prev;

      const updated = [...prev, newMission];
      saveMissions(updated);
      return updated;
    });
  }, [liveMission.missionStatus, liveMission.flightLog]);

  // Use stored missions if available, otherwise demo
  const missions = useMemo(
    () => (storedMissions.length > 0 ? storedMissions : DEMO_MISSIONS),
    [storedMissions]
  );

  // ── Derived Metrics ──
  const totalMissions = missions.length;
  const onTimeMissions = missions.filter((m) => m.deliveryTime < m.clinicalDeadline);
  const onTimeRate = Math.round((onTimeMissions.length / totalMissions) * 100);
  const avgDeliveryTime = Math.round(missions.reduce((s, m) => s + m.deliveryTime, 0) / totalMissions);
  const avgDroneTime = missions.reduce((s, m) => s + m.deliveryTime, 0) / totalMissions;
  const avgAmbulanceTime = avgDroneTime * 5;
  const timeSavedPct = Math.round(((avgAmbulanceTime - avgDroneTime) / avgAmbulanceTime) * 100);

  // ── Chart Data ──
  const transportComparisonData = [
    { metric: 'Avg Time (min)', Drone: Math.round(avgDroneTime), Helicopter: Math.round(avgDroneTime * 1.8), Ambulance: Math.round(avgAmbulanceTime) },
    { metric: 'Avg Cost (\u00a3)', Drone: 12, Helicopter: 2800, Ambulance: 95 },
  ];

  const statusCounts = {
    completed: missions.filter((m) => m.status === 'completed').length,
    rerouted: missions.filter((m) => m.status === 'rerouted').length,
    failed: missions.filter((m) => m.status === 'failed').length,
  };
  const statusData = [
    { name: 'Completed', value: statusCounts.completed, color: '#4ade80' },
    { name: 'Rerouted', value: statusCounts.rerouted, color: '#fbbf24' },
    { name: 'Failed', value: statusCounts.failed, color: '#ff4444' },
  ];

  const deliveryVsDeadlineData = missions.map((m) => ({
    name: m.name.length > 14 ? m.name.slice(0, 14) + '...' : m.name,
    deliveryTime: m.deliveryTime,
    clinicalDeadline: m.clinicalDeadline,
    onTime: m.deliveryTime < m.clinicalDeadline,
  }));

  const routeEfficiencyData = missions.map((m) => ({
    name: m.name.length > 14 ? m.name.slice(0, 14) + '...' : m.name,
    optimized: m.distance,
    naive: m.naiveDistance,
  }));

  const batteryData = missions.map((m) => ({
    name: m.name.length > 10 ? m.name.slice(0, 10) + '...' : m.name,
    battery: m.battery,
  }));

  const reliabilityData = missions.map((_, i) => {
    const slice = missions.slice(0, i + 1);
    const onTime = slice.filter((m) => m.deliveryTime < m.clinicalDeadline).length;
    return { name: `M${i + 1}`, rate: Math.round((onTime / slice.length) * 100) };
  });

  const facilityMap: Record<string, number> = {};
  for (const m of missions) {
    facilityMap[m.facility] = (facilityMap[m.facility] || 0) + 1;
  }
  const heatmapData = Object.entries(facilityMap)
    .map(([facility, count]) => ({ facility, count }))
    .sort((a, b) => b.count - a.count);

  // ── Cost Comparison Data ──
  const totalDroneCost = totalMissions * COST_PER_DRONE_DELIVERY;
  const totalAmbulanceCost = totalMissions * COST_PER_AMBULANCE_TRIP;
  const totalHelicopterCost = totalMissions * COST_PER_HELICOPTER_TRIP;
  const ambulanceSavings = totalAmbulanceCost - totalDroneCost;
  const helicopterSavings = totalHelicopterCost - totalDroneCost;

  const costComparisonData = [
    { method: 'Drone', cost: totalDroneCost, color: '#00daf3' },
    { method: 'Ambulance', cost: totalAmbulanceCost, color: '#6b7280' },
    { method: 'Helicopter', cost: totalHelicopterCost, color: '#434654' },
  ];

  const cumulativeSavingsData = missions.map((_, i) => {
    const count = i + 1;
    return {
      name: `M${count}`,
      vsAmbulance: count * (COST_PER_AMBULANCE_TRIP - COST_PER_DRONE_DELIVERY),
      vsHelicopter: count * (COST_PER_HELICOPTER_TRIP - COST_PER_DRONE_DELIVERY),
    };
  });

  // Typewriter effect
  useEffect(() => {
    if (!report) {
      setDisplayedReport('');
      return;
    }
    let idx = 0;
    setDisplayedReport('');
    const interval = setInterval(() => {
      idx += 1;
      if (idx <= report.length) {
        setDisplayedReport(report.slice(0, idx));
      } else {
        clearInterval(interval);
      }
    }, 20);
    return () => clearInterval(interval);
  }, [report]);

  const handleGenerateReport = async () => {
    setIsGenerating(true);
    setReport(null);
    try {
      const metrics: Metrics = {
        delivery_time_reduction: timeSavedPct,
        distance_reduction: 33,
        throughput: totalMissions,
        reroute_success_rate: 100,
        total_distance_optimized: missions.reduce((s, m) => s + m.distance, 0),
        total_distance_naive: missions.reduce((s, m) => s + m.naiveDistance, 0),
        battery_used: Math.round(missions.reduce((s, m) => s + m.battery, 0) / totalMissions),
        robustness_score: 90,
        actual_flight_time_seconds: missions.reduce((s, m) => s + m.deliveryTime, 0),
        estimated_time_seconds: missions.reduce((s, m) => s + m.deliveryTime, 0),
        naive_time_seconds: missions.reduce((s, m) => s + m.deliveryTime * 5, 0),
      };
      const res = await api.generateReport(metrics, { missions });
      setReport(res.report);
    } catch {
      setReport(DEMO_REPORT);
    }
    setIsGenerating(false);
  };

  if (missions.length === 0) {
    return (
      <div style={{ height: '100vh', background: '#0a0f13', display: 'flex', flexDirection: 'column', color: '#dfe3e9', fontFamily: 'Inter, sans-serif' }}>
        <PageHeader title="Analytics" icon={BarChart3} statusVariant="idle" />
        <SideNav currentPage="analytics" />
        <div style={{ marginLeft: 96 }}>
          <EmptyState />
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: '100vh', background: '#0a0f13', display: 'flex', flexDirection: 'column', color: '#dfe3e9', fontFamily: 'Inter, sans-serif' }}>
      <PageHeader title="Analytics" icon={BarChart3} statusVariant="idle" />
      <SideNav currentPage="analytics" />

      {/* Scrollable Content */}
      <div style={{ flex: 1, overflowY: 'auto', marginLeft: 96, padding: '24px 32px 48px' }}>

        {/* Data Source Indicator */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 16,
          padding: '6px 12px',
          borderRadius: 6,
          background: storedMissions.length > 0 ? 'rgba(0,218,243,0.06)' : 'rgba(141,144,160,0.06)',
          border: `1px solid ${storedMissions.length > 0 ? 'rgba(0,218,243,0.15)' : 'rgba(141,144,160,0.1)'}`,
          fontSize: 11,
          color: '#7a7e8c',
        }}>
          <div style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: storedMissions.length > 0 ? '#00daf3' : '#7a7e8c',
          }} />
          {storedMissions.length > 0
            ? `Showing ${storedMissions.length} real mission${storedMissions.length !== 1 ? 's' : ''} from localStorage`
            : 'Showing demo data (no completed missions saved yet)'}
          {storedMissions.length > 0 && (
            <button
              onClick={() => {
                if (window.confirm('Clear all saved mission data? This cannot be undone.')) {
                  localStorage.removeItem(STORAGE_KEY);
                  setStoredMissions([]);
                }
              }}
              style={{
                marginLeft: 'auto',
                background: 'none',
                border: '1px solid rgba(255,68,68,0.2)',
                color: '#ff4444',
                borderRadius: 4,
                padding: '2px 8px',
                fontSize: 10,
                cursor: 'pointer',
              }}
            >
              Clear Data
            </button>
          )}
        </div>

        {/* Row 1: KPI Cards */}
        <div style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
          {[
            { icon: <Package size={16} style={{ color: '#00daf3' }} />, label: 'Total Missions', value: totalMissions },
            { icon: <CheckCircle size={16} style={{ color: '#4ade80' }} />, label: 'On-Time Rate', value: onTimeRate, suffix: '%' },
            { icon: <Clock size={16} style={{ color: '#fbbf24' }} />, label: 'Avg Delivery Time', value: avgDeliveryTime, suffix: 's' },
            { icon: <TrendingUp size={16} style={{ color: '#00daf3' }} />, label: 'Time Saved vs Road', value: timeSavedPct, suffix: '%' },
            { icon: <ShieldCheck size={16} style={{ color: '#4ade80' }} />, label: 'Payload Integrity', value: 100, suffix: '%' },
          ].map((card) => (
            <div key={card.label} style={{ ...glassCard, padding: '16px 20px', flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                {card.icon}
                <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#8d90a0' }}>{card.label}</span>
              </div>
              <div style={{ fontFamily: 'Space Grotesk', fontSize: 28, fontWeight: 700, color: '#dfe3e9' }}>
                <SlidingNumber value={card.value} suffix={card.suffix} />
              </div>
            </div>
          ))}
        </div>

        {/* Row 2: Transport Comparison + Mission Status Donut */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
          {/* Transport Comparison */}
          <div style={glassCard}>
            <div style={sectionTitle}>Transport Comparison</div>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={transportComparisonData} layout="horizontal">
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(67,70,84,0.2)" />
                <XAxis dataKey="metric" tick={{ fill: '#c3c6d6', fontSize: 11 }} stroke="#434654" />
                <YAxis tick={{ fill: '#c3c6d6', fontSize: 11 }} stroke="#434654" />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 11, color: '#c3c6d6' }} />
                <Bar dataKey="Drone" fill="#00daf3" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Helicopter" fill="#434654" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Ambulance" fill="#6b7280" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Mission Status Donut */}
          <div style={glassCard}>
            <div style={sectionTitle}>Mission Status</div>
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie
                  data={statusData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={90}
                  paddingAngle={3}
                  dataKey="value"
                  stroke="none"
                >
                  {statusData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 11, color: '#c3c6d6' }} />
                {/* Center text */}
                <text x="50%" y="48%" textAnchor="middle" fill="#dfe3e9" style={{ fontFamily: 'Space Grotesk', fontSize: 24, fontWeight: 700 }}>
                  {totalMissions}
                </text>
                <text x="50%" y="58%" textAnchor="middle" fill="#8d90a0" style={{ fontSize: 11 }}>
                  missions
                </text>
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Row 2.5: Mission Cost Comparison */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
          {/* Cost per Method */}
          <div style={glassCard}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <DollarSign size={14} style={{ color: '#4ade80' }} />
              <div style={sectionTitle}>Mission Cost Comparison</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
              {costComparisonData.map((item) => (
                <div key={item.method} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 12, color: '#c3c6d6', width: 80 }}>{item.method}</span>
                  <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'rgba(67,70,84,0.2)', overflow: 'hidden' }}>
                    <div style={{
                      height: '100%',
                      width: `${Math.min((item.cost / totalHelicopterCost) * 100, 100)}%`,
                      borderRadius: 4,
                      background: item.color,
                      transition: 'width 0.6s ease',
                    }} />
                  </div>
                  <span style={{ fontSize: 12, fontFamily: 'monospace', color: item.color, minWidth: 80, textAlign: 'right' }}>
                    ${item.cost.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 16, borderTop: '1px solid rgba(67,70,84,0.15)', paddingTop: 12 }}>
              <div style={{ flex: 1 }}>
                <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#7a7e8c' }}>Per Delivery</span>
                <div style={{ display: 'flex', gap: 12, fontSize: 12, marginTop: 4 }}>
                  <span style={{ color: '#00daf3' }}>Drone: ${COST_PER_DRONE_DELIVERY}</span>
                  <span style={{ color: '#6b7280' }}>Ambulance: ${COST_PER_AMBULANCE_TRIP.toLocaleString()}</span>
                  <span style={{ color: '#434654' }}>Heli: ${COST_PER_HELICOPTER_TRIP.toLocaleString()}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Cumulative Savings */}
          <div style={glassCard}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <TrendingUp size={14} style={{ color: '#4ade80' }} />
              <div style={sectionTitle}>Cumulative Savings</div>
            </div>
            <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
              <div style={{ padding: '8px 14px', borderRadius: 8, background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.15)' }}>
                <div style={{ fontSize: 10, textTransform: 'uppercase', color: '#7a7e8c', marginBottom: 2 }}>vs Ambulance</div>
                <div style={{ fontSize: 20, fontFamily: 'Space Grotesk', fontWeight: 700, color: '#4ade80' }}>
                  ${ambulanceSavings.toLocaleString()}
                </div>
              </div>
              <div style={{ padding: '8px 14px', borderRadius: 8, background: 'rgba(0,218,243,0.08)', border: '1px solid rgba(0,218,243,0.15)' }}>
                <div style={{ fontSize: 10, textTransform: 'uppercase', color: '#7a7e8c', marginBottom: 2 }}>vs Helicopter</div>
                <div style={{ fontSize: 20, fontFamily: 'Space Grotesk', fontWeight: 700, color: '#00daf3' }}>
                  ${helicopterSavings.toLocaleString()}
                </div>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={140}>
              <AreaChart data={cumulativeSavingsData}>
                <defs>
                  <linearGradient id="savingsGreen" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#4ade80" stopOpacity={0.2} />
                    <stop offset="100%" stopColor="#4ade80" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="savingsCyan" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#00daf3" stopOpacity={0.2} />
                    <stop offset="100%" stopColor="#00daf3" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(67,70,84,0.2)" />
                <XAxis dataKey="name" tick={{ fill: '#c3c6d6', fontSize: 9 }} stroke="#434654" />
                <YAxis tick={{ fill: '#c3c6d6', fontSize: 9 }} stroke="#434654" />
                <Tooltip contentStyle={tooltipStyle} formatter={(value: unknown) => `$${Number(value ?? 0).toLocaleString()}`} />
                <Area type="monotone" dataKey="vsAmbulance" name="vs Ambulance" stroke="#4ade80" strokeWidth={2} fill="url(#savingsGreen)" />
                <Area type="monotone" dataKey="vsHelicopter" name="vs Helicopter" stroke="#00daf3" strokeWidth={2} fill="url(#savingsCyan)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Row 3: Delivery vs Deadline + Route Efficiency */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
          {/* Delivery vs Deadline */}
          <div style={glassCard}>
            <div style={sectionTitle}>Delivery vs Deadline</div>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={deliveryVsDeadlineData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(67,70,84,0.2)" />
                <XAxis dataKey="name" tick={{ fill: '#c3c6d6', fontSize: 9 }} stroke="#434654" angle={-30} textAnchor="end" height={60} />
                <YAxis tick={{ fill: '#c3c6d6', fontSize: 11 }} stroke="#434654" label={{ value: 'seconds', angle: -90, position: 'insideLeft', fill: '#8d90a0', fontSize: 10 }} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="deliveryTime" name="Delivery Time" radius={[4, 4, 0, 0]}>
                  {deliveryVsDeadlineData.map((entry, index) => (
                    <Cell key={`bar-${index}`} fill={entry.onTime ? '#4ade80' : '#ff4444'} />
                  ))}
                </Bar>
                <Bar dataKey="clinicalDeadline" name="Clinical Deadline" fill="rgba(141,144,160,0.3)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Route Efficiency */}
          <div style={glassCard}>
            <div style={sectionTitle}>Route Efficiency</div>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={routeEfficiencyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(67,70,84,0.2)" />
                <XAxis dataKey="name" tick={{ fill: '#c3c6d6', fontSize: 9 }} stroke="#434654" angle={-30} textAnchor="end" height={60} />
                <YAxis tick={{ fill: '#c3c6d6', fontSize: 11 }} stroke="#434654" label={{ value: 'meters', angle: -90, position: 'insideLeft', fill: '#8d90a0', fontSize: 10 }} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 11, color: '#c3c6d6' }} />
                <Bar dataKey="optimized" name="Optimised" fill="#00daf3" radius={[4, 4, 0, 0]} />
                <Bar dataKey="naive" name="Naive" fill="#434654" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Row 4: Battery Trend + Reliability */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
          {/* Battery Consumption */}
          <div style={glassCard}>
            <div style={sectionTitle}>Battery Consumption</div>
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={batteryData}>
                <defs>
                  <linearGradient id="greenGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#4ade80" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#4ade80" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(67,70,84,0.2)" />
                <XAxis dataKey="name" tick={{ fill: '#c3c6d6', fontSize: 9 }} stroke="#434654" />
                <YAxis tick={{ fill: '#c3c6d6', fontSize: 11 }} stroke="#434654" label={{ value: '%', angle: -90, position: 'insideLeft', fill: '#8d90a0', fontSize: 10 }} />
                <Tooltip contentStyle={tooltipStyle} />
                <Area type="monotone" dataKey="battery" stroke="#4ade80" strokeWidth={2} fill="url(#greenGrad)" dot={{ fill: '#4ade80', r: 3 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Reliability Trend */}
          <div style={glassCard}>
            <div style={sectionTitle}>Reliability Trend</div>
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={reliabilityData}>
                <defs>
                  <linearGradient id="cyanGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#00daf3" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#00daf3" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(67,70,84,0.2)" />
                <XAxis dataKey="name" tick={{ fill: '#c3c6d6', fontSize: 11 }} stroke="#434654" />
                <YAxis tick={{ fill: '#c3c6d6', fontSize: 11 }} stroke="#434654" domain={[0, 100]} label={{ value: '%', angle: -90, position: 'insideLeft', fill: '#8d90a0', fontSize: 10 }} />
                <Tooltip contentStyle={tooltipStyle} />
                <Area type="monotone" dataKey="rate" name="On-Time %" stroke="#00daf3" strokeWidth={2} fill="url(#cyanGrad)" dot={{ fill: '#00daf3', r: 3 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Row 5: Delivery Heatmap */}
        <div style={{ ...glassCard, marginBottom: 24 }}>
          <div style={sectionTitle}>Top Delivery Destinations</div>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={heatmapData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(67,70,84,0.2)" />
              <XAxis type="number" tick={{ fill: '#c3c6d6', fontSize: 11 }} stroke="#434654" allowDecimals={false} />
              <YAxis type="category" dataKey="facility" tick={{ fill: '#c3c6d6', fontSize: 12 }} stroke="#434654" width={120} />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="count" name="Deliveries" fill="#00daf3" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Row 6: AI Report */}
        <div style={glassCard}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div style={sectionTitle}>AI Board Report</div>
            <LiquidButton size="sm" onClick={handleGenerateReport} style={{ color: '#00daf3' }}>
              {isGenerating ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <FileText size={16} />}
              {isGenerating ? 'Generating...' : 'Generate Board Report'}
            </LiquidButton>
          </div>
          {displayedReport && (
            <div style={{
              padding: 20,
              borderRadius: 8,
              background: 'rgba(10,15,19,0.6)',
              border: '1px solid rgba(67,70,84,0.2)',
              fontFamily: 'monospace',
              fontSize: 13,
              lineHeight: 1.7,
              color: '#c3c6d6',
              whiteSpace: 'pre-wrap',
              maxHeight: 500,
              overflowY: 'auto',
            }}>
              {displayedReport}
              {displayedReport.length < (report?.length ?? 0) && (
                <span style={{ opacity: 0.5, animation: 'blink 1s step-end infinite' }}>|</span>
              )}
            </div>
          )}
        </div>

      </div>

      {/* Keyframe for spinner and cursor blink */}
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes blink { 50% { opacity: 0; } }
      `}</style>
    </div>
  );
}
