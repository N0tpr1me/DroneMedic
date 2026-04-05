import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Map, AdvancedMarker } from '@vis.gl/react-google-maps';
import { Activity, Package, Clock, Building2, Radio } from 'lucide-react';
import { GlassPanel } from '../components/ui/GlassPanel';
import { SlidingNumber } from '../components/ui/sliding-number';
import { useFacilities } from '../hooks/useSupabase';

// ── Demo fallback data ────────────────────────────────────────────────────────

interface StatusEvent {
  text: string;
  time: string;
}

interface StatusData {
  active_drones: number;
  deliveries_today: number;
  avg_delivery_time_min: number;
  facilities_served: number;
  recent_events: StatusEvent[];
}

const DEMO_STATUS: StatusData = {
  active_drones: 3,
  deliveries_today: 12,
  avg_delivery_time_min: 14.2,
  facilities_served: 7,
  recent_events: [
    { text: 'Blood delivery to Royal London', time: '6 min ago' },
    { text: 'Drone rerouted — storm avoidance', time: '12 min ago' },
    { text: 'Insulin delivery to Homerton', time: '18 min ago' },
    { text: 'Surgical kit to Newham General', time: '25 min ago' },
  ],
};

// ── Demo drone positions (anonymized dots) ────────────────────────────────────

interface DroneDot {
  id: string;
  lat: number;
  lng: number;
  color: string;
}

const DEMO_DRONES: DroneDot[] = [
  { id: 'd1', lat: 51.5185, lng: -0.0590, color: '#00e5ff' },
  { id: 'd2', lat: 51.5280, lng: -0.0420, color: '#76ff03' },
  { id: 'd3', lat: 51.5120, lng: -0.0710, color: '#ffab00' },
];

// ── No-fly zone polygons ──────────────────────────────────────────────────────

const NO_FLY_ZONES = [
  {
    name: 'Military Zone Alpha',
    paths: [
      { lat: 51.525, lng: -0.080 },
      { lat: 51.530, lng: -0.075 },
      { lat: 51.528, lng: -0.065 },
      { lat: 51.523, lng: -0.070 },
    ],
  },
  {
    name: 'Airport Exclusion',
    paths: [
      { lat: 51.505, lng: -0.050 },
      { lat: 51.510, lng: -0.040 },
      { lat: 51.508, lng: -0.030 },
      { lat: 51.503, lng: -0.035 },
    ],
  },
];

// ── Map center (East London) ──────────────────────────────────────────────────

const MAP_CENTER = { lat: 51.518, lng: -0.058 };
const MAP_ID = import.meta.env.VITE_GOOGLE_MAP_ID || '';

// ── Stat card ─────────────────────────────────────────────────────────────────

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: number;
  suffix?: string;
  decimals?: boolean;
}

function StatCard({ icon, label, value, suffix = '', decimals = false }: StatCardProps) {
  const displayValue = decimals ? Math.floor(value) : value;

  return (
    <div className="flex items-center gap-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/5 text-blue-300">
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-white/50">{label}</div>
        <div className="flex items-baseline gap-0.5 font-headline text-2xl font-bold text-white">
          <SlidingNumber value={displayValue} />
          {decimals && (
            <span className="text-lg text-white/70">.{Math.round((value % 1) * 10)}</span>
          )}
          {suffix && <span className="ml-0.5 text-sm font-medium text-white/50">{suffix}</span>}
        </div>
      </div>
    </div>
  );
}

// ── Event ticker ──────────────────────────────────────────────────────────────

function EventTicker({ events }: { events: StatusEvent[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollPosition, setScrollPosition] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setScrollPosition((prev) => prev + 1);
    }, 50);
    return () => clearInterval(interval);
  }, []);

  // Duplicate events for seamless loop
  const doubledEvents = [...events, ...events];

  return (
    <div className="overflow-hidden" ref={scrollRef}>
      <div
        className="flex gap-8 whitespace-nowrap transition-transform"
        style={{ transform: `translateX(-${scrollPosition % (events.length * 350)}px)` }}
      >
        {doubledEvents.map((event, i) => (
          <div key={`${event.text}-${i}`} className="flex shrink-0 items-center gap-3 text-sm">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400 animate-pulse" />
            <span className="text-white/80">{event.text}</span>
            <span className="text-white/30">{event.time}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── No-fly zone overlay ───────────────────────────────────────────────────────

function NoFlyZoneOverlay({ map }: { map: google.maps.Map | null }) {
  const polygonsRef = useRef<google.maps.Polygon[]>([]);

  useEffect(() => {
    if (!map) return;

    // Clear old polygons
    polygonsRef.current.forEach((p) => p.setMap(null));
    polygonsRef.current = [];

    NO_FLY_ZONES.forEach((zone) => {
      const polygon = new google.maps.Polygon({
        paths: zone.paths,
        strokeColor: '#ff1744',
        strokeOpacity: 0.6,
        strokeWeight: 2,
        fillColor: '#ff1744',
        fillOpacity: 0.12,
        map,
      });
      polygonsRef.current.push(polygon);
    });

    return () => {
      polygonsRef.current.forEach((p) => p.setMap(null));
      polygonsRef.current = [];
    };
  }, [map]);

  return null;
}

// ── Main component ────────────────────────────────────────────────────────────

export function Status() {
  const { facilities } = useFacilities();
  const [status] = useState<StatusData>(DEMO_STATUS);
  const [drones] = useState<DroneDot[]>(DEMO_DRONES);
  const [mapInstance, setMapInstance] = useState<google.maps.Map | null>(null);

  // Animate drone positions slightly for realism
  const [animatedDrones, setAnimatedDrones] = useState<DroneDot[]>(DEMO_DRONES);

  useEffect(() => {
    const interval = setInterval(() => {
      setAnimatedDrones((prev) =>
        prev.map((d) => ({
          ...d,
          lat: d.lat + (Math.random() - 0.5) * 0.0003,
          lng: d.lng + (Math.random() - 0.5) * 0.0003,
        }))
      );
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#0a0f13]">
      {/* ── Full-screen map ── */}
      <Map
        defaultCenter={MAP_CENTER}
        defaultZoom={14}
        mapId={MAP_ID}
        disableDefaultUI
        gestureHandling="greedy"
        className="h-full w-full"
        onTilesLoaded={(ev) => {
          // @ts-expect-error — map instance from event
          const map = ev.map ?? ev.detail?.map;
          if (map && !mapInstance) setMapInstance(map);
        }}
      >
        {/* Facility markers */}
        {facilities.map((f) => {
          const lat = f.lat;
          const lng = f.lon;
          if (lat == null || lng == null) return null;

          return (
            <AdvancedMarker key={f.id} position={{ lat: Number(lat), lng: Number(lng) }}>
              <div className="flex flex-col items-center">
                <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-white/30 bg-blue-600 shadow-lg shadow-blue-600/40">
                  <Building2 size={14} className="text-white" />
                </div>
                <div className="mt-1 rounded bg-black/70 px-1.5 py-0.5 text-[9px] font-bold text-white/80 backdrop-blur-sm">
                  {f.name}
                </div>
              </div>
            </AdvancedMarker>
          );
        })}

        {/* Anonymized drone dots */}
        {animatedDrones.map((d) => (
          <AdvancedMarker key={d.id} position={{ lat: d.lat, lng: d.lng }}>
            <div className="relative">
              <div
                className="h-4 w-4 rounded-full border-2 border-white/30"
                style={{
                  background: d.color,
                  boxShadow: `0 0 12px ${d.color}, 0 0 24px ${d.color}40`,
                }}
              />
              {/* Ping animation ring */}
              <div
                className="absolute inset-0 animate-ping rounded-full opacity-40"
                style={{ background: d.color }}
              />
            </div>
          </AdvancedMarker>
        ))}
      </Map>

      {/* No-fly zone polygons */}
      <NoFlyZoneOverlay map={mapInstance} />

      {/* ── Stats overlay panel (top-right) ── */}
      <motion.div
        initial={{ opacity: 0, x: 40 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.6, delay: 0.2 }}
        className="absolute right-4 top-4 z-10 w-72 sm:right-6 sm:top-6 md:w-80"
      >
        <GlassPanel glow className="space-y-5">
          {/* Title */}
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/20 text-blue-300">
              <Radio size={16} />
            </div>
            <div>
              <h1 className="font-headline text-sm font-bold tracking-tight text-white">DroneMedic Operations</h1>
              <div className="flex items-center gap-1.5 text-[10px] text-white/40">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Live
              </div>
            </div>
          </div>

          <div className="h-px bg-white/10" />

          {/* Stats grid */}
          <div className="grid grid-cols-1 gap-4">
            <StatCard
              icon={<Activity size={18} />}
              label="Active Drones"
              value={status.active_drones}
            />
            <StatCard
              icon={<Package size={18} />}
              label="Deliveries Today"
              value={status.deliveries_today}
            />
            <StatCard
              icon={<Clock size={18} />}
              label="Avg. Delivery Time"
              value={status.avg_delivery_time_min}
              suffix="min"
              decimals
            />
            <StatCard
              icon={<Building2 size={18} />}
              label="Facilities Served"
              value={status.facilities_served}
            />
          </div>
        </GlassPanel>
      </motion.div>

      {/* ── Event ticker (bottom) ── */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.4 }}
        className="absolute bottom-12 left-0 right-0 z-10 px-4 sm:px-6"
      >
        <div className="glass-panel rounded-xl px-5 py-3">
          <EventTicker events={status.recent_events} />
        </div>
      </motion.div>

      {/* ── Branding footer ── */}
      <div className="absolute bottom-0 left-0 right-0 z-10 flex items-center justify-center py-2.5 text-[10px] font-medium tracking-widest text-white/25">
        Powered by DroneMedic
      </div>
    </div>
  );
}
