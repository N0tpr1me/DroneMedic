import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Sparkles, Line } from '@react-three/drei';
import { useRef, useMemo, useState } from 'react';
import * as THREE from 'three';
import type { Location, NoFlyZone, Weather } from '../../lib/api';

// ── Utilities ──

const GLOBE_RADIUS = 2;

function latLonToVec3(lat: number, lon: number, radius: number = GLOBE_RADIUS): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -(radius * Math.sin(phi) * Math.cos(theta)),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  );
}

function createArcPoints(start: THREE.Vector3, end: THREE.Vector3, segments: number = 64): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const point = new THREE.Vector3().lerpVectors(start, end, t);
    // Elevate the arc above the globe surface
    const elevation = 1 + Math.sin(t * Math.PI) * 0.15;
    point.normalize().multiplyScalar(GLOBE_RADIUS * elevation);
    points.push(point);
  }
  return points;
}

// ── Globe Sphere ──

function Globe() {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.rotation.y = state.clock.elapsedTime * 0.05;
    }
  });

  return (
    <group>
      {/* Main globe */}
      <mesh ref={meshRef}>
        <sphereGeometry args={[GLOBE_RADIUS, 64, 64]} />
        <meshStandardMaterial
          color="#0d1b2a"
          metalness={0.3}
          roughness={0.7}
          transparent
          opacity={0.9}
        />
      </mesh>

      {/* Wireframe overlay */}
      <mesh>
        <sphereGeometry args={[GLOBE_RADIUS * 1.001, 32, 32]} />
        <meshBasicMaterial color="#00e5ff" wireframe transparent opacity={0.08} />
      </mesh>

      {/* Atmosphere glow */}
      <mesh>
        <sphereGeometry args={[GLOBE_RADIUS * 1.15, 32, 32]} />
        <meshBasicMaterial color="#00e5ff" transparent opacity={0.03} side={THREE.BackSide} />
      </mesh>
    </group>
  );
}

// ── Location Markers ──

interface MarkerProps {
  position: THREE.Vector3;
  color: string;
  label: string;
  isHighPriority?: boolean;
  weather?: Weather;
}

function LocationMarker({ position, color, isHighPriority }: MarkerProps) {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    if (meshRef.current) {
      const scale = isHighPriority
        ? 1 + Math.sin(state.clock.elapsedTime * 3) * 0.3
        : 1;
      meshRef.current.scale.setScalar(scale);
    }
  });

  return (
    <group position={position}>
      {/* Marker dot */}
      <mesh ref={meshRef}>
        <sphereGeometry args={[0.04, 16, 16]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={2} />
      </mesh>
      {/* Glow ring */}
      <mesh>
        <ringGeometry args={[0.05, 0.08, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.4} side={THREE.DoubleSide} />
      </mesh>
      {/* Pulse ring */}
      <PulseRing color={color} />
    </group>
  );
}

function PulseRing({ color }: { color: string }) {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    if (meshRef.current) {
      const t = (state.clock.elapsedTime % 2) / 2;
      const scale = 1 + t * 3;
      meshRef.current.scale.setScalar(scale);
      (meshRef.current.material as THREE.MeshBasicMaterial).opacity = 0.3 * (1 - t);
    }
  });

  return (
    <mesh ref={meshRef}>
      <ringGeometry args={[0.03, 0.04, 32]} />
      <meshBasicMaterial color={color} transparent side={THREE.DoubleSide} />
    </mesh>
  );
}

// ── Animated Route Lines ──

interface RouteLineProps {
  points: THREE.Vector3[];
  color: string;
  dashed?: boolean;
}

function RouteLine({ points, color, dashed }: RouteLineProps) {
  return (
    <Line
      points={points}
      color={color}
      lineWidth={2}
      transparent
      opacity={dashed ? 0.3 : 0.8}
      dashed={dashed}
      dashSize={0.05}
      gapSize={0.05}
    />
  );
}

// ── Animated Drone on Path ──

interface FlyingDroneProps {
  path: THREE.Vector3[];
  color: string;
  speed?: number;
  progress?: number;
}

function FlyingDrone({ path, color, speed = 0.1, progress: externalProgress }: FlyingDroneProps) {
  const groupRef = useRef<THREE.Group>(null);
  const [internalProgress, setInternalProgress] = useState(0);

  const curve = useMemo(() => new THREE.CatmullRomCurve3(path), [path]);

  useFrame((_, delta) => {
    const prog = externalProgress ?? internalProgress;

    if (externalProgress === undefined) {
      setInternalProgress((p) => (p + delta * speed) % 1);
    }

    if (groupRef.current) {
      const point = curve.getPointAt(prog % 1);
      groupRef.current.position.copy(point);

      // Look forward along path
      const lookAtPoint = curve.getPointAt(Math.min((prog + 0.01) % 1, 0.999));
      groupRef.current.lookAt(lookAtPoint);
    }
  });

  return (
    <group ref={groupRef}>
      {/* Drone icon */}
      <mesh>
        <octahedronGeometry args={[0.03]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={3} />
      </mesh>
      {/* Trail glow */}
      <pointLight color={color} intensity={0.5} distance={0.3} />
    </group>
  );
}

// ── No-Fly Zone Domes ──

interface NoFlyDomeProps {
  zone: NoFlyZone;
}

function NoFlyDome({ zone }: NoFlyDomeProps) {
  const center = useMemo(() => {
    const lats = zone.lat_lon.map((ll) => ll[0]);
    const lons = zone.lat_lon.map((ll) => ll[1]);
    const avgLat = lats.reduce((a, b) => a + b, 0) / lats.length;
    const avgLon = lons.reduce((a, b) => a + b, 0) / lons.length;
    return latLonToVec3(avgLat, avgLon, GLOBE_RADIUS * 1.005);
  }, [zone]);

  const meshRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    if (meshRef.current) {
      (meshRef.current.material as THREE.MeshBasicMaterial).opacity =
        0.08 + Math.sin(state.clock.elapsedTime * 2) * 0.04;
    }
  });

  return (
    <mesh ref={meshRef} position={center}>
      <sphereGeometry args={[0.08, 16, 16]} />
      <meshBasicMaterial color="#ef4444" transparent opacity={0.1} />
    </mesh>
  );
}

// ── Main Globe Component ──

interface GlobeViewProps {
  locations: Record<string, Location>;
  route?: string[];
  reroute?: string[];
  priorities?: Record<string, string>;
  noFlyZones?: NoFlyZone[];
  weather?: Record<string, Weather>;
  droneProgress?: number;
  isFlying?: boolean;
}

export function GlobeView({
  locations,
  route,
  reroute,
  priorities = {},
  noFlyZones = [],
  weather = {},
  droneProgress,
  isFlying,
}: GlobeViewProps) {
  const routePoints = useMemo(() => {
    if (!route || route.length < 2) return [];
    const segments: THREE.Vector3[][] = [];
    for (let i = 0; i < route.length - 1; i++) {
      const from = locations[route[i]];
      const to = locations[route[i + 1]];
      if (from && to) {
        const start = latLonToVec3(from.lat, from.lon);
        const end = latLonToVec3(to.lat, to.lon);
        segments.push(createArcPoints(start, end));
      }
    }
    return segments;
  }, [route, locations]);

  const reroutePoints = useMemo(() => {
    if (!reroute || reroute.length < 2) return [];
    const segments: THREE.Vector3[][] = [];
    for (let i = 0; i < reroute.length - 1; i++) {
      const from = locations[reroute[i]];
      const to = locations[reroute[i + 1]];
      if (from && to) {
        const start = latLonToVec3(from.lat, from.lon);
        const end = latLonToVec3(to.lat, to.lon);
        segments.push(createArcPoints(start, end));
      }
    }
    return segments;
  }, [reroute, locations]);

  const fullRoutePath = useMemo(() => {
    return routePoints.flat();
  }, [routePoints]);

  return (
    <Canvas camera={{ position: [0, 1.5, 4.5], fov: 45 }} style={{ width: '100%', height: '100%' }}>
      <color attach="background" args={['#0a0a0f']} />
      <fog attach="fog" args={['#0a0a0f', 6, 15]} />

      <ambientLight intensity={0.4} />
      <pointLight position={[5, 3, 5]} intensity={0.6} color="#ffffff" />
      <pointLight position={[-3, -2, -3]} intensity={0.3} color="#00e5ff" />

      <Globe />

      {/* Location markers */}
      {Object.entries(locations).map(([name, loc]) => {
        const pos = latLonToVec3(loc.lat, loc.lon, GLOBE_RADIUS * 1.01);
        const isDepot = name === 'Depot';
        const isHighPriority = priorities[name] === 'high';
        const locWeather = weather[name];
        const isBadWeather = locWeather && !locWeather.flyable;

        let color = isDepot ? '#00e5ff' : '#22c55e';
        if (isHighPriority) color = '#f59e0b';
        if (isBadWeather) color = '#ef4444';

        return (
          <LocationMarker
            key={name}
            position={pos}
            color={color}
            label={name}
            isHighPriority={isHighPriority}
            weather={locWeather}
          />
        );
      })}

      {/* Route lines */}
      {routePoints.map((points, i) => (
        <RouteLine
          key={`route-${i}`}
          points={points}
          color={reroute ? '#f59e0b' : '#00e5ff'}
          dashed={!!reroute}
        />
      ))}

      {/* Reroute lines */}
      {reroutePoints.map((points, i) => (
        <RouteLine key={`reroute-${i}`} points={points} color="#00e5ff" />
      ))}

      {/* Flying drone */}
      {isFlying && fullRoutePath.length > 2 && (
        <FlyingDrone
          path={fullRoutePath}
          color="#00e5ff"
          speed={0.08}
          progress={droneProgress}
        />
      )}

      {/* No-fly zones */}
      {noFlyZones.map((zone) => (
        <NoFlyDome key={zone.name} zone={zone} />
      ))}

      <Sparkles count={300} scale={12} size={1.5} speed={0.15} color="#ffffff" opacity={0.6} />
      <Sparkles count={80} scale={10} size={3} speed={0.1} color="#b3c5ff" opacity={0.4} />

      <OrbitControls
        enableZoom
        enablePan={false}
        minDistance={3}
        maxDistance={8}
        autoRotate={!isFlying}
        autoRotateSpeed={0.3}
        maxPolarAngle={Math.PI * 0.85}
        minPolarAngle={Math.PI * 0.15}
      />
    </Canvas>
  );
}
