import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { useGLTF, Float, OrbitControls, Grid, Sparkles, Line, Environment } from '@react-three/drei';
import { motion, AnimatePresence } from 'framer-motion';
import { Rocket, Play, Pause, RotateCcw, Flame, Droplets, Zap, Shield, Mountain, ChevronDown, Wind } from 'lucide-react';
import * as THREE from 'three';
import { SideNav } from '../components/layout/SideNav';
import { GlassPanel } from '../components/ui/GlassPanel';

// ── Types ──

type SimPhase = 'IDLE' | 'TAKEOFF' | 'CLIMB' | 'CRUISE' | 'DESCEND' | 'LANDING' | 'COMPLETE';
type Environment_t = 'Urban' | 'Rural' | 'Disaster';
type DecisionLevel = 'AUTO' | 'ADVISORY' | 'INFO' | 'WARN';

interface DecisionEntry {
  id: number;
  time: string;
  level: DecisionLevel;
  action: string;
  reasoning: string;
}

interface DisasterZone {
  id: string;
  type: string;
  label: string;
  lat: number;
  lon: number;
  radius: number;
  color: string;
}

interface SimState {
  running: boolean;
  phase: SimPhase;
  timeScale: number;
  elapsed: number;
  waypointIndex: number;
  progress: number; // 0-1 between current and next waypoint
  speed: number;
  power: number;
  battery: number;
  windSpeed: number;
  windDir: number;
  twr: number;
  altitude: number;
  range: number;
  environment: Environment_t;
  autonomy: number;
  payload: string;
}

// ── Config Waypoints ──

const WAYPOINTS = [
  { name: 'Depot', lat: 51.5074, lon: -0.1278 },
  { name: 'Royal London', lat: 51.5176, lon: -0.0590 },
  { name: 'Clinic A', lat: 51.5124, lon: -0.1200 },
  { name: 'Clinic B', lat: 51.5174, lon: -0.1350 },
  { name: 'Newham General', lat: 51.5308, lon: 0.0212 },
];

const ROUTES = [
  { label: 'Depot -> Royal London -> Depot', waypoints: [0, 1, 0] },
  { label: 'Multi-facility resupply', waypoints: [0, 2, 3, 1, 0] },
  { label: 'Emergency Newham', waypoints: [0, 4, 0] },
];

const PAYLOADS = ['blood_pack', 'insulin', 'defibrillator', 'epi_pen', 'plasma', 'vaccine_kit'];

const DEPOT_LAT = 51.5074;
const DEPOT_LON = -0.1278;
const SCENE_SCALE = 0.01;

function gpsToLocal(lat: number, lon: number, alt: number): [number, number, number] {
  const x = (lon - DEPOT_LON) * 111320 * Math.cos(DEPOT_LAT * Math.PI / 180) * SCENE_SCALE;
  const z = (lat - DEPOT_LAT) * 110540 * SCENE_SCALE;
  const y = alt * SCENE_SCALE;
  return [x, y, -z];
}

// ── Hexacopter Arms ──

const HEX_ARMS = Array.from({ length: 6 }, (_, i) => {
  const angle = (i * Math.PI * 2) / 6;
  return { x: Math.cos(angle) * 0.9, z: Math.sin(angle) * 0.9, angle };
});

// ── Fallback Procedural Drone ──

function FallbackDrone({ position, rotation }: { position: [number, number, number]; rotation: [number, number, number] }) {
  const propRefs = useRef<THREE.Mesh[]>([]);

  useFrame((_s, delta) => {
    propRefs.current.forEach(p => { if (p) p.rotation.y += delta * 25; });
  });

  return (
    <group position={position} rotation={rotation}>
      <mesh>
        <cylinderGeometry args={[0.35, 0.38, 0.18, 24]} />
        <meshStandardMaterial color="#0d1020" metalness={0.6} roughness={0.3} />
      </mesh>
      <mesh position={[0, 0.15, 0]}>
        <sphereGeometry args={[0.22, 20, 20, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#00daf3" metalness={0.6} roughness={0.3} transparent opacity={0.55} />
      </mesh>
      {HEX_ARMS.map((arm, i) => (
        <group key={i}>
          <mesh position={[arm.x * 0.5, 0, arm.z * 0.5]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.035, 0.035, 0.9, 8]} />
            <meshStandardMaterial color="#1a1a30" metalness={0.7} roughness={0.3} />
          </mesh>
          <mesh position={[arm.x, 0.08, arm.z]}>
            <cylinderGeometry args={[0.07, 0.07, 0.12, 12]} />
            <meshStandardMaterial color="#222" metalness={0.9} roughness={0.1} />
          </mesh>
          <mesh
            ref={(el) => { if (el) propRefs.current[i] = el; }}
            position={[arm.x, 0.16, arm.z]}
            rotation={[Math.PI / 2, 0, 0]}
          >
            <circleGeometry args={[0.3, 24]} />
            <meshStandardMaterial color="#00daf3" transparent opacity={0.1} side={THREE.DoubleSide} />
          </mesh>
        </group>
      ))}
      {[0, 2, 4].map(idx => {
        const arm = HEX_ARMS[idx];
        return (
          <group key={`leg-${idx}`}>
            <mesh position={[arm.x * 0.6, -0.2, arm.z * 0.6]}>
              <cylinderGeometry args={[0.02, 0.02, 0.25, 6]} />
              <meshStandardMaterial color="#1a1a30" metalness={0.7} roughness={0.3} />
            </mesh>
          </group>
        );
      })}
      <pointLight position={[0, -0.25, 0]} intensity={0.6} color="#00daf3" distance={2.5} />
    </group>
  );
}

// ── GLB Drone Model ──

let glbAvailable = true;

function DroneModel({ position, rotation }: { position: [number, number, number]; rotation: [number, number, number] }) {
  if (!glbAvailable) {
    return <FallbackDrone position={position} rotation={rotation} />;
  }

  try {
    const gltf = useGLTF('/models/drone-medic.glb');
    const cloned = useMemo(() => gltf.scene.clone(), [gltf.scene]);

    return (
      <group position={position} rotation={rotation}>
        <primitive object={cloned} scale={0.5} />
        <pointLight position={[0, -0.5, 0]} color="#00daf3" intensity={2} distance={5} />
      </group>
    );
  } catch {
    glbAvailable = false;
    return <FallbackDrone position={position} rotation={rotation} />;
  }
}

// ── Animated Sim Drone (follows path) ──

function SimDrone({ sim, routeWaypoints }: { sim: SimState; routeWaypoints: number[] }) {
  const groupRef = useRef<THREE.Group>(null);
  const targetPos = useRef(new THREE.Vector3(0, 1, 0));
  const targetRot = useRef(new THREE.Euler(0, 0, 0));

  useFrame((_s, delta) => {
    if (!groupRef.current) return;

    // Compute position from waypoint index + progress
    const fromIdx = routeWaypoints[sim.waypointIndex] ?? 0;
    const toIdx = routeWaypoints[Math.min(sim.waypointIndex + 1, routeWaypoints.length - 1)] ?? 0;
    const from = WAYPOINTS[fromIdx];
    const to = WAYPOINTS[toIdx];

    if (from && to) {
      const lat = from.lat + (to.lat - from.lat) * sim.progress;
      const lon = from.lon + (to.lon - from.lon) * sim.progress;
      const alt = sim.phase === 'IDLE' || sim.phase === 'COMPLETE' ? 0 : sim.altitude;
      const [x, y, z] = gpsToLocal(lat, lon, alt);
      targetPos.current.set(x, y, z);

      // Bank angle when turning
      const dx = (to.lon - from.lon);
      const dz = (to.lat - from.lat);
      const heading = Math.atan2(dx, dz);
      targetRot.current.set(
        sim.phase === 'CRUISE' ? -0.1 : 0,
        -heading,
        sim.phase === 'CRUISE' ? Math.sin(Date.now() * 0.001) * 0.05 : 0
      );
    }

    groupRef.current.position.lerp(targetPos.current, Math.min(delta * 4, 1));
    groupRef.current.rotation.x += (targetRot.current.x - groupRef.current.rotation.x) * Math.min(delta * 3, 1);
    groupRef.current.rotation.y += (targetRot.current.y - groupRef.current.rotation.y) * Math.min(delta * 3, 1);
    groupRef.current.rotation.z += (targetRot.current.z - groupRef.current.rotation.z) * Math.min(delta * 3, 1);
  });

  return (
    <group ref={groupRef}>
      <DroneModel position={[0, 0, 0]} rotation={[0, 0, 0]} />
    </group>
  );
}

// ── Camera Follow ──

function CameraFollow({ sim, routeWaypoints }: { sim: SimState; routeWaypoints: number[] }) {
  useFrame(({ camera }) => {
    if (sim.phase === 'IDLE') return;
    const fromIdx = routeWaypoints[sim.waypointIndex] ?? 0;
    const toIdx = routeWaypoints[Math.min(sim.waypointIndex + 1, routeWaypoints.length - 1)] ?? 0;
    const from = WAYPOINTS[fromIdx];
    const to = WAYPOINTS[toIdx];
    if (!from || !to) return;

    const lat = from.lat + (to.lat - from.lat) * sim.progress;
    const lon = from.lon + (to.lon - from.lon) * sim.progress;
    const [x, y, z] = gpsToLocal(lat, lon, sim.altitude);
    const target = new THREE.Vector3(x, y, z);
    const offset = new THREE.Vector3(3, 2.5, 3);
    const desired = target.clone().add(offset);
    camera.position.lerp(desired, 0.02);
    camera.lookAt(target);
  });
  return null;
}

// ── Waypoint Pillars ──

function WaypointMarkers({ routeWaypoints }: { routeWaypoints: number[] }) {
  const uniqueIdxs = [...new Set(routeWaypoints)];
  return (
    <>
      {uniqueIdxs.map(idx => {
        const wp = WAYPOINTS[idx];
        if (!wp) return null;
        const [x, , z] = gpsToLocal(wp.lat, wp.lon, 0);
        const isDepot = wp.name === 'Depot';
        return (
          <group key={wp.name} position={[x, 0, z]}>
            {/* Glowing pillar */}
            <mesh position={[0, 0.5, 0]}>
              <cylinderGeometry args={[0.05, 0.05, 1, 8]} />
              <meshStandardMaterial
                color={isDepot ? '#b3c5ff' : '#00daf3'}
                emissive={isDepot ? '#b3c5ff' : '#00daf3'}
                emissiveIntensity={2}
                transparent
                opacity={0.8}
              />
            </mesh>
            {/* Ground ring */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
              <ringGeometry args={[0.2, 0.35, 24]} />
              <meshStandardMaterial
                color={isDepot ? '#b3c5ff' : '#00daf3'}
                emissive={isDepot ? '#b3c5ff' : '#00daf3'}
                emissiveIntensity={0.8}
                transparent
                opacity={0.4}
              />
            </mesh>
            {/* Point light at top */}
            <pointLight position={[0, 1.1, 0]} color={isDepot ? '#b3c5ff' : '#00daf3'} intensity={1} distance={3} />
          </group>
        );
      })}
    </>
  );
}

// ── Route Tube Lines ──

function RouteTubeLines({ routeWaypoints }: { routeWaypoints: number[] }) {
  const lines = useMemo(() => {
    const result: THREE.Vector3[][] = [];
    for (let i = 0; i < routeWaypoints.length - 1; i++) {
      const from = WAYPOINTS[routeWaypoints[i]];
      const to = WAYPOINTS[routeWaypoints[i + 1]];
      if (!from || !to) continue;
      const [x1, , z1] = gpsToLocal(from.lat, from.lon, 0);
      const [x2, , z2] = gpsToLocal(to.lat, to.lon, 0);
      const a = new THREE.Vector3(x1, 0.05, z1);
      const b = new THREE.Vector3(x2, 0.05, z2);
      const mid = new THREE.Vector3().lerpVectors(a, b, 0.5);
      mid.y += 0.8;
      const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
      result.push(curve.getPoints(32));
    }
    return result;
  }, [routeWaypoints]);

  return (
    <>
      {lines.map((pts, i) => (
        <Line key={i} points={pts} color="#00daf3" lineWidth={2} transparent opacity={0.35} />
      ))}
    </>
  );
}

// ── Ground Grid ──

function SimGround() {
  return (
    <group>
      <gridHelper args={[60, 60, '#1a2030', '#0f1520']} position={[0, 0, 0]} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
        <planeGeometry args={[60, 60]} />
        <meshStandardMaterial color="#080c14" metalness={0.3} roughness={0.9} />
      </mesh>
    </group>
  );
}

// ── 3D Scene ──

function SimScene({ sim, routeWaypoints }: { sim: SimState; routeWaypoints: number[] }) {
  const isFlying = sim.running && sim.phase !== 'IDLE' && sim.phase !== 'COMPLETE';
  return (
    <Canvas camera={{ position: [5, 4, 5], fov: 50 }} style={{ position: 'absolute', inset: 0 }}>
      <color attach="background" args={['#06060f']} />
      <fog attach="fog" args={['#06060f', 20, 55]} />
      <ambientLight intensity={0.35} />
      <pointLight position={[5, 5, 5]} intensity={0.6} color="#ffffff" />
      <pointLight position={[-3, 2, -3]} intensity={0.4} color="#00daf3" />
      <pointLight position={[0, -2, 0]} intensity={0.2} color="#3b3bff" />

      <SimDrone sim={sim} routeWaypoints={routeWaypoints} />
      <SimGround />
      <WaypointMarkers routeWaypoints={routeWaypoints} />
      <RouteTubeLines routeWaypoints={routeWaypoints} />
      <Sparkles count={60} scale={20} size={0.8} speed={0.1} color="#00daf3" opacity={0.15} />

      {isFlying ? (
        <CameraFollow sim={sim} routeWaypoints={routeWaypoints} />
      ) : (
        <OrbitControls enableZoom enablePan autoRotate autoRotateSpeed={0.3} maxPolarAngle={Math.PI / 2.1} minPolarAngle={Math.PI / 8} />
      )}
    </Canvas>
  );
}

// ── Map Panel (Leaflet) ──

function MapPanel({ sim, routeWaypoints, disasters }: { sim: SimState; routeWaypoints: number[]; disasters: DisasterZone[] }) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const droneMarkerRef = useRef<L.CircleMarker | null>(null);
  const [leafletLoaded, setLeafletLoaded] = useState(false);

  // Dynamic import of leaflet
  useEffect(() => {
    import('leaflet').then(L => {
      if (!mapRef.current || mapInstanceRef.current) return;

      // Import leaflet CSS
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);

      const map = L.map(mapRef.current, {
        center: [DEPOT_LAT, DEPOT_LON],
        zoom: 13,
        zoomControl: false,
        attributionControl: false,
      });

      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
      }).addTo(map);

      // Route polyline
      const routeCoords = routeWaypoints.map(idx => {
        const wp = WAYPOINTS[idx];
        return wp ? [wp.lat, wp.lon] as [number, number] : [DEPOT_LAT, DEPOT_LON] as [number, number];
      });
      L.polyline(routeCoords, { color: '#00daf3', weight: 2, opacity: 0.7, dashArray: '8 4' }).addTo(map);

      // Waypoint markers
      const uniqueIdxs = [...new Set(routeWaypoints)];
      uniqueIdxs.forEach(idx => {
        const wp = WAYPOINTS[idx];
        if (!wp) return;
        const isDepot = wp.name === 'Depot';
        L.circleMarker([wp.lat, wp.lon], {
          radius: 6,
          fillColor: isDepot ? '#b3c5ff' : '#00daf3',
          fillOpacity: 0.9,
          color: isDepot ? '#b3c5ff' : '#00daf3',
          weight: 2,
        }).addTo(map).bindTooltip(wp.name, { permanent: false, direction: 'top', className: 'leaflet-tooltip-dark' });
      });

      // Drone marker
      droneMarkerRef.current = L.circleMarker([DEPOT_LAT, DEPOT_LON], {
        radius: 5,
        fillColor: '#ff3333',
        fillOpacity: 1,
        color: '#ff3333',
        weight: 2,
      }).addTo(map);

      mapInstanceRef.current = map;
      setLeafletLoaded(true);

      return () => {
        map.remove();
        mapInstanceRef.current = null;
      };
    });
  }, [routeWaypoints]);

  // Update drone position
  useEffect(() => {
    if (!droneMarkerRef.current) return;
    const fromIdx = routeWaypoints[sim.waypointIndex] ?? 0;
    const toIdx = routeWaypoints[Math.min(sim.waypointIndex + 1, routeWaypoints.length - 1)] ?? 0;
    const from = WAYPOINTS[fromIdx];
    const to = WAYPOINTS[toIdx];
    if (from && to) {
      const lat = from.lat + (to.lat - from.lat) * sim.progress;
      const lon = from.lon + (to.lon - from.lon) * sim.progress;
      droneMarkerRef.current.setLatLng([lat, lon]);
    }
  }, [sim.waypointIndex, sim.progress, routeWaypoints]);

  // Render disaster zones
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const L = (window as unknown as { L: typeof import('leaflet') }).L;
    if (!L) return;
    disasters.forEach(d => {
      L.circle([d.lat, d.lon], {
        radius: d.radius,
        fillColor: d.color,
        fillOpacity: 0.25,
        color: d.color,
        weight: 1,
        dashArray: '4 4',
      }).addTo(mapInstanceRef.current!).bindTooltip(d.label, { direction: 'top' });
    });
  }, [disasters, leafletLoaded]);

  return (
    <div ref={mapRef} style={{ width: '100%', height: '100%', borderRadius: 12, overflow: 'hidden' }} />
  );
}

// ── Decision Log Badge ──

function DecisionBadge({ level }: { level: DecisionLevel }) {
  const colors: Record<DecisionLevel, string> = {
    AUTO: '#00daf3',
    ADVISORY: '#f59e0b',
    INFO: '#22c55e',
    WARN: '#ef4444',
  };
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '1px 6px',
        borderRadius: 4,
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: '0.05em',
        background: `${colors[level]}22`,
        color: colors[level],
        border: `1px solid ${colors[level]}44`,
      }}
    >
      {level}
    </span>
  );
}

// ── Dropdown Component ──

function Dropdown({ value, options, onChange, label }: { value: string; options: { label: string; value: string }[]; onChange: (v: string) => void; label: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#8d90a0' }}>{label}</span>
      <div style={{ position: 'relative' }}>
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          style={{
            width: '100%',
            padding: '6px 28px 6px 10px',
            background: 'rgba(30,35,40,0.9)',
            border: '1px solid rgba(67,70,84,0.3)',
            borderRadius: 6,
            color: '#e0e2ec',
            fontSize: 11,
            outline: 'none',
            cursor: 'pointer',
            appearance: 'none',
          }}
        >
          {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <ChevronDown size={12} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', color: '#8d90a0', pointerEvents: 'none' }} />
      </div>
    </div>
  );
}

// ── Slider Component ──

function SliderControl({ value, min, max, step, onChange, label, unit }: { value: number; min: number; max: number; step: number; onChange: (v: number) => void; label: string; unit?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#8d90a0' }}>{label}</span>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#00daf3' }}>{value}{unit ?? ''}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{ width: '100%', accentColor: '#00daf3' }}
      />
    </div>
  );
}

// ── Main Simulation Page ──

export function Simulation() {
  const [selectedRoute, setSelectedRoute] = useState(0);
  const routeWaypoints = ROUTES[selectedRoute]?.waypoints ?? [0, 1, 0];

  const [sim, setSim] = useState<SimState>({
    running: false,
    phase: 'IDLE',
    timeScale: 1,
    elapsed: 0,
    waypointIndex: 0,
    progress: 0,
    speed: 0,
    power: 0,
    battery: 100,
    windSpeed: 3,
    windDir: 45,
    twr: 1.83,
    altitude: 0,
    range: 22.4,
    environment: 'Urban',
    autonomy: 80,
    payload: 'blood_pack',
  });

  const [decisions, setDecisions] = useState<DecisionEntry[]>([]);
  const [disasters, setDisasters] = useState<DisasterZone[]>([]);
  const decisionIdRef = useRef(0);
  const logEndRef = useRef<HTMLDivElement>(null);

  const addDecision = useCallback((level: DecisionLevel, action: string, reasoning: string) => {
    const now = new Date();
    const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    decisionIdRef.current += 1;
    setDecisions(prev => [...prev.slice(-50), { id: decisionIdRef.current, time, level, action, reasoning }]);
  }, []);

  // Auto-scroll decision log
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [decisions]);

  // Simulation loop
  useEffect(() => {
    if (!sim.running) return;

    const interval = setInterval(() => {
      setSim(prev => {
        const dt = 0.05 * prev.timeScale;
        const newElapsed = prev.elapsed + dt;
        let { waypointIndex, progress, phase, speed, power, battery, altitude, range } = prev;

        if (phase === 'IDLE') {
          phase = 'TAKEOFF';
          altitude = 10;
          speed = 2;
          addDecision('AUTO', 'Mission started', `Payload: ${prev.payload}, Route: ${ROUTES[selectedRoute]?.label ?? 'Unknown'}`);
          addDecision('INFO', 'Pre-flight checks passed', 'Battery 100%, GPS lock, weather nominal');
        }

        if (phase === 'TAKEOFF') {
          altitude = Math.min(altitude + dt * 20, 80);
          speed = Math.min(speed + dt * 5, 8);
          if (altitude >= 80) {
            phase = 'CLIMB';
            addDecision('INFO', 'Altitude reached', 'Transitioning to cruise climb');
          }
        }

        if (phase === 'CLIMB') {
          speed = Math.min(speed + dt * 3, 14.7);
          if (speed >= 14) {
            phase = 'CRUISE';
            addDecision('AUTO', 'Cruise speed achieved', `Ground speed ${speed.toFixed(1)} m/s`);
          }
        }

        if (phase === 'CRUISE' || phase === 'CLIMB') {
          progress += dt * 0.08;
          if (progress >= 1) {
            progress = 0;
            waypointIndex += 1;
            if (waypointIndex >= routeWaypoints.length - 1) {
              phase = 'DESCEND';
              addDecision('AUTO', 'Final approach', 'Beginning descent to destination');
            } else {
              const nextWp = WAYPOINTS[routeWaypoints[waypointIndex + 1]];
              addDecision('INFO', `Waypoint reached`, `Heading to ${nextWp?.name ?? 'next'}`);
            }
          }
        }

        if (phase === 'DESCEND') {
          altitude = Math.max(altitude - dt * 15, 0);
          speed = Math.max(speed - dt * 3, 0);
          if (altitude <= 1) {
            phase = 'LANDING';
            addDecision('AUTO', 'Landing initiated', 'Final touchdown sequence');
          }
        }

        if (phase === 'LANDING') {
          altitude = Math.max(altitude - dt * 5, 0);
          speed = Math.max(speed - dt * 2, 0);
          if (altitude <= 0 && speed <= 0.1) {
            phase = 'COMPLETE';
            speed = 0;
            altitude = 0;
            addDecision('AUTO', 'Mission complete', `Delivered ${prev.payload} successfully`);
          }
        }

        // Physics updates
        power = speed > 0 ? 180 + speed * 12 + (prev.windSpeed * 3) : 0;
        battery = Math.max(battery - dt * 0.15 * (1 + prev.windSpeed * 0.05), 0);
        range = battery * 0.224;
        const twr = speed > 0 ? 1.83 - (prev.windSpeed * 0.03) : 0;

        // Wind-based decisions
        if (prev.windSpeed > 10 && phase === 'CRUISE' && Math.random() < 0.01 * prev.timeScale) {
          addDecision('AUTO', 'Rerouting — high wind detected', `Wind ${prev.windSpeed.toFixed(1)} m/s exceeds threshold`);
        }

        if (battery < 30 && battery > 29.5 && phase === 'CRUISE') {
          addDecision('ADVISORY', 'Battery conservation mode', `Battery at ${battery.toFixed(0)}%, reducing speed`);
        }

        return {
          ...prev,
          elapsed: newElapsed,
          waypointIndex,
          progress,
          phase,
          speed,
          power,
          battery,
          altitude,
          range,
          twr,
        };
      });
    }, 50);

    return () => clearInterval(interval);
  }, [sim.running, sim.timeScale, routeWaypoints, selectedRoute, addDecision]);

  const handleStart = () => {
    if (sim.phase === 'COMPLETE') {
      handleReset();
      setTimeout(() => setSim(prev => ({ ...prev, running: true })), 50);
    } else {
      setSim(prev => ({ ...prev, running: true }));
    }
  };

  const handlePause = () => setSim(prev => ({ ...prev, running: false }));

  const handleReset = () => {
    setSim(prev => ({
      ...prev,
      running: false,
      phase: 'IDLE',
      elapsed: 0,
      waypointIndex: 0,
      progress: 0,
      speed: 0,
      power: 0,
      battery: 100,
      altitude: 0,
      range: 22.4,
      twr: 1.83,
    }));
    setDecisions([]);
  };

  const injectDisaster = (type: string, label: string, lat: number, lon: number, color: string) => {
    const zone: DisasterZone = {
      id: `${type}-${Date.now()}`,
      type,
      label,
      lat,
      lon,
      radius: 500,
      color,
    };
    setDisasters(prev => [...prev, zone]);
    addDecision('WARN', `${label} detected`, `New ${type} zone injected near coordinates (${lat.toFixed(4)}, ${lon.toFixed(4)})`);
    if (sim.running && sim.phase === 'CRUISE') {
      addDecision('AUTO', `Rerouting around ${type} zone`, `Confidence: ${sim.autonomy}% — adjusting flight path`);
    }
  };

  const disasterButtons = [
    { icon: <Flame size={14} />, label: 'Wildfire', type: 'fire', lat: 51.5174, lon: -0.1350, color: '#ef4444' },
    { icon: <Droplets size={14} />, label: 'Flood', type: 'flood', lat: 51.5308, lon: 0.0212, color: '#3b82f6' },
    { icon: <Zap size={14} />, label: 'Storm', type: 'storm', lat: 51.5176, lon: -0.0590, color: '#f59e0b' },
    { icon: <Shield size={14} />, label: 'Military', type: 'military', lat: 51.5100, lon: -0.1240, color: '#8b5cf6' },
    { icon: <Mountain size={14} />, label: 'Volcano', type: 'volcano', lat: 51.4900, lon: -0.1500, color: '#f97316' },
  ];

  const phaseColor = {
    IDLE: '#8d90a0',
    TAKEOFF: '#f59e0b',
    CLIMB: '#f59e0b',
    CRUISE: '#22c55e',
    DESCEND: '#3b82f6',
    LANDING: '#3b82f6',
    COMPLETE: '#00daf3',
  };

  // Physics stats for the right panel
  const statsRows = [
    { label: 'Speed', value: `${sim.speed.toFixed(1)} m/s` },
    { label: 'Power', value: `${sim.power.toFixed(0)} W` },
    { label: 'Battery', value: `${sim.battery.toFixed(0)}%`, color: sim.battery < 30 ? '#ef4444' : sim.battery < 60 ? '#f59e0b' : '#22c55e' },
    { label: 'Wind', value: `${sim.windSpeed.toFixed(1)} m/s` },
    { label: 'TWR', value: sim.twr.toFixed(2) },
    { label: 'Range', value: `${sim.range.toFixed(1)} km` },
    { label: 'Altitude', value: `${sim.altitude.toFixed(0)} m` },
    { label: 'Phase', value: sim.phase, color: phaseColor[sim.phase] },
  ];

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0f1418', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {/* SideNav */}
      <SideNav currentPage={'simulation' as 'dashboard'} />

      {/* Header */}
      <motion.header
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        style={{
          position: 'relative',
          zIndex: 20,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 24px 12px 100px',
          background: 'rgba(15,20,24,0.85)',
          backdropFilter: 'blur(24px)',
          borderBottom: '1px solid rgba(67,70,84,0.15)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Rocket size={20} color="#00daf3" />
          <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#e0e2ec' }}>
            DroneMedic Flight Simulator
          </span>
          <span style={{
            fontSize: 9,
            fontWeight: 700,
            padding: '2px 8px',
            borderRadius: 4,
            background: sim.running ? 'rgba(34,197,94,0.15)' : 'rgba(141,144,160,0.15)',
            color: sim.running ? '#22c55e' : '#8d90a0',
            border: `1px solid ${sim.running ? '#22c55e44' : '#8d90a044'}`,
          }}>
            {sim.running ? 'LIVE' : sim.phase === 'COMPLETE' ? 'DONE' : 'READY'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Dropdown
            label=""
            value={sim.environment}
            options={[
              { label: 'Urban', value: 'Urban' },
              { label: 'Rural', value: 'Rural' },
              { label: 'Disaster', value: 'Disaster' },
            ]}
            onChange={v => setSim(prev => ({ ...prev, environment: v as Environment_t }))}
          />
          <Dropdown
            label=""
            value={String(sim.timeScale)}
            options={[
              { label: '1x', value: '1' },
              { label: '2x', value: '2' },
              { label: '5x', value: '5' },
              { label: '10x', value: '10' },
            ]}
            onChange={v => setSim(prev => ({ ...prev, timeScale: Number(v) }))}
          />
        </div>
      </motion.header>

      {/* Main Content */}
      <div style={{ flex: 1, display: 'flex', position: 'relative', overflow: 'hidden' }}>

        {/* Left: 3D Scene (40%) */}
        <motion.div
          initial={{ opacity: 0, x: -30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.1 }}
          style={{
            width: '40%',
            position: 'relative',
            borderRight: '1px solid rgba(67,70,84,0.15)',
          }}
        >
          <SimScene sim={sim} routeWaypoints={routeWaypoints} />
          {/* 3D label */}
          <div style={{
            position: 'absolute', top: 12, left: 12, zIndex: 10,
            fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
            color: '#8d90a0', background: 'rgba(15,20,24,0.7)', padding: '4px 8px', borderRadius: 4,
            backdropFilter: 'blur(8px)',
          }}>
            3D Flight View
          </div>
        </motion.div>

        {/* Center: Map (35%) + Decision Log below */}
        <div style={{ width: '35%', display: 'flex', flexDirection: 'column', borderRight: '1px solid rgba(67,70,84,0.15)' }}>
          {/* Map */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            style={{ flex: 1, position: 'relative', minHeight: 0 }}
          >
            <MapPanel sim={sim} routeWaypoints={routeWaypoints} disasters={disasters} />
            <div style={{
              position: 'absolute', top: 12, left: 12, zIndex: 10,
              fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
              color: '#8d90a0', background: 'rgba(15,20,24,0.7)', padding: '4px 8px', borderRadius: 4,
              backdropFilter: 'blur(8px)',
            }}>
              Map View
            </div>
          </motion.div>

          {/* Decision Log */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            style={{
              height: 220,
              background: 'rgba(30,35,40,0.85)',
              backdropFilter: 'blur(24px)',
              borderTop: '1px solid rgba(67,70,84,0.15)',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div style={{ padding: '10px 14px 6px', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#8d90a0' }}>
              AI Decision Log
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: '0 14px 10px' }}>
              {decisions.length === 0 && (
                <div style={{ fontSize: 11, color: '#555', padding: '10px 0' }}>
                  Awaiting mission start...
                </div>
              )}
              <AnimatePresence>
                {decisions.map(d => (
                  <motion.div
                    key={d.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    style={{
                      display: 'flex',
                      gap: 8,
                      alignItems: 'flex-start',
                      padding: '4px 0',
                      borderBottom: '1px solid rgba(67,70,84,0.08)',
                    }}
                  >
                    <span style={{ fontSize: 10, color: '#555', fontFamily: 'monospace', flexShrink: 0 }}>{d.time}</span>
                    <DecisionBadge level={d.level} />
                    <span style={{ fontSize: 11, color: '#c3c6d6' }}>{d.action}</span>
                    <span style={{ fontSize: 10, color: '#666', marginLeft: 'auto', flexShrink: 0, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.reasoning}</span>
                  </motion.div>
                ))}
              </AnimatePresence>
              <div ref={logEndRef} />
            </div>

            {/* Disaster Injection Buttons */}
            <div style={{
              display: 'flex',
              gap: 6,
              padding: '8px 14px',
              borderTop: '1px solid rgba(67,70,84,0.15)',
              flexWrap: 'wrap',
            }}>
              {disasterButtons.map(btn => (
                <button
                  key={btn.type}
                  onClick={() => injectDisaster(btn.type, btn.label, btn.lat, btn.lon, btn.color)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '4px 10px',
                    background: 'rgba(30,35,40,0.9)',
                    border: '1px solid rgba(67,70,84,0.3)',
                    borderRadius: 6,
                    color: btn.color,
                    fontSize: 10,
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLButtonElement).style.background = `${btn.color}22`;
                    (e.currentTarget as HTMLButtonElement).style.borderColor = `${btn.color}66`;
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLButtonElement).style.background = 'rgba(30,35,40,0.9)';
                    (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(67,70,84,0.3)';
                  }}
                >
                  {btn.icon}
                  {btn.label}
                </button>
              ))}
            </div>
          </motion.div>
        </div>

        {/* Right: Physics Dashboard + Controls (25%) */}
        <motion.div
          initial={{ opacity: 0, x: 30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.2 }}
          style={{
            width: '25%',
            display: 'flex',
            flexDirection: 'column',
            background: 'rgba(30,35,40,0.85)',
            backdropFilter: 'blur(24px)',
            overflow: 'auto',
          }}
        >
          {/* Physics Dashboard */}
          <div style={{ padding: '14px 16px 8px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#8d90a0', marginBottom: 12 }}>
              Physics Dashboard
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {statsRows.map(row => (
                <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: '#8d90a0', fontWeight: 600 }}>{row.label}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'monospace', color: row.color ?? '#e0e2ec' }}>{row.value}</span>
                </div>
              ))}
            </div>

            {/* Battery bar */}
            <div style={{ marginTop: 12 }}>
              <div style={{ height: 4, background: 'rgba(67,70,84,0.3)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: `${sim.battery}%`,
                  background: sim.battery < 30 ? '#ef4444' : sim.battery < 60 ? '#f59e0b' : '#22c55e',
                  borderRadius: 2,
                  transition: 'width 0.3s',
                }} />
              </div>
            </div>
          </div>

          <div style={{ height: 1, background: 'rgba(67,70,84,0.15)', margin: '4px 16px' }} />

          {/* Controls */}
          <div style={{ padding: '8px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#8d90a0' }}>
              Controls
            </div>

            {/* Start / Pause / Reset */}
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={sim.running ? handlePause : handleStart}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  padding: '8px 0',
                  background: sim.running ? 'rgba(245,158,11,0.15)' : 'rgba(0,218,243,0.15)',
                  border: `1px solid ${sim.running ? '#f59e0b44' : '#00daf344'}`,
                  borderRadius: 8,
                  color: sim.running ? '#f59e0b' : '#00daf3',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                {sim.running ? <Pause size={14} /> : <Play size={14} />}
                {sim.running ? 'Pause' : 'Start'}
              </button>
              <button
                onClick={handleReset}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 4,
                  padding: '8px 14px',
                  background: 'rgba(67,70,84,0.15)',
                  border: '1px solid rgba(67,70,84,0.3)',
                  borderRadius: 8,
                  color: '#8d90a0',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                <RotateCcw size={14} />
                Reset
              </button>
            </div>

            {/* Time Scale */}
            <div style={{ display: 'flex', gap: 4 }}>
              {[1, 2, 5, 10].map(s => (
                <button
                  key={s}
                  onClick={() => setSim(prev => ({ ...prev, timeScale: s }))}
                  style={{
                    flex: 1,
                    padding: '5px 0',
                    background: sim.timeScale === s ? 'rgba(0,218,243,0.2)' : 'rgba(30,35,40,0.6)',
                    border: `1px solid ${sim.timeScale === s ? '#00daf366' : 'rgba(67,70,84,0.2)'}`,
                    borderRadius: 6,
                    color: sim.timeScale === s ? '#00daf3' : '#8d90a0',
                    fontSize: 10,
                    fontWeight: 700,
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                >
                  {s}x
                </button>
              ))}
            </div>

            <div style={{ height: 1, background: 'rgba(67,70,84,0.1)' }} />

            {/* Route selector */}
            <Dropdown
              label="Route"
              value={String(selectedRoute)}
              options={ROUTES.map((r, i) => ({ label: r.label, value: String(i) }))}
              onChange={v => { setSelectedRoute(Number(v)); handleReset(); }}
            />

            {/* Payload selector */}
            <Dropdown
              label="Payload"
              value={sim.payload}
              options={PAYLOADS.map(p => ({ label: p.replace('_', ' '), value: p }))}
              onChange={v => setSim(prev => ({ ...prev, payload: v }))}
            />

            {/* Environment */}
            <Dropdown
              label="Environment"
              value={sim.environment}
              options={[
                { label: 'Urban', value: 'Urban' },
                { label: 'Rural', value: 'Rural' },
                { label: 'Disaster', value: 'Disaster' },
              ]}
              onChange={v => setSim(prev => ({ ...prev, environment: v as Environment_t }))}
            />

            <div style={{ height: 1, background: 'rgba(67,70,84,0.1)' }} />

            {/* Wind speed */}
            <SliderControl
              label="Wind Speed"
              value={sim.windSpeed}
              min={0}
              max={15}
              step={0.5}
              unit=" m/s"
              onChange={v => setSim(prev => ({ ...prev, windSpeed: v }))}
            />

            {/* Wind direction */}
            <SliderControl
              label="Wind Direction"
              value={sim.windDir}
              min={0}
              max={360}
              step={5}
              unit="deg"
              onChange={v => setSim(prev => ({ ...prev, windDir: v }))}
            />

            {/* Autonomy */}
            <SliderControl
              label="Autonomy"
              value={sim.autonomy}
              min={0}
              max={100}
              step={5}
              unit="%"
              onChange={v => setSim(prev => ({ ...prev, autonomy: v }))}
            />
          </div>
        </motion.div>
      </div>
    </div>
  );
}
