// MissionOverlays — clinic markers, route curves, and no-fly-zone volumes
// for the 3D simulation view. Pure visual layer that reads from
// useMissionGeography; no side effects.

import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Line, Text, Billboard } from '@react-three/drei';
import { useSimCockpit } from './SimCockpitContext';
import { enuFromLatLon, threePosFromLatLon } from './enuFrame';
import type {
  MissionLocation,
  MissionNoFlyZone,
} from '../../../hooks/useMissionGeography';

const DEPOT_COLOR = '#b3c5ff';
const CLINIC_COLOR = '#00daf3';
const NOFLY_COLOR = '#ff3355';
const ROUTE_COLOR = '#00e6ff';
const NOFLY_CEILING = 120; // meters

function isDepot(loc: MissionLocation): boolean {
  const n = loc.name.toLowerCase();
  return n.includes('depot') || (loc.type ?? '').toLowerCase() === 'depot';
}

// ── Clinic markers ────────────────────────────────────────────────────

function ClinicMarker({ loc }: { loc: MissionLocation }) {
  const pos = useMemo(() => threePosFromLatLon(loc.lat, loc.lon, 0), [loc.lat, loc.lon]);
  const depot = isDepot(loc);
  const color = depot ? DEPOT_COLOR : CLINIC_COLOR;
  const height = depot ? 40 : 30;

  return (
    <group position={pos}>
      {/* vertical beacon column */}
      <mesh position={[0, height / 2, 0]}>
        <cylinderGeometry args={[0.8, 0.8, height, 12]} />
        <meshBasicMaterial color={color} transparent opacity={0.4} />
      </mesh>
      {/* beacon cap */}
      <mesh position={[0, height, 0]}>
        <sphereGeometry args={[2.2, 16, 16]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={2}
          metalness={0.3}
          roughness={0.4}
        />
      </mesh>
      {/* ground ring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.2, 0]}>
        <ringGeometry args={[4, 6, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.55} side={THREE.DoubleSide} />
      </mesh>
      <Billboard position={[0, height + 6, 0]}>
        <Text fontSize={3} color={color} outlineWidth={0.15} outlineColor="#02030a">
          {loc.name}
        </Text>
      </Billboard>
    </group>
  );
}

// ── Route ─────────────────────────────────────────────────────────────

function RouteCurves({ locs }: { locs: MissionLocation[] }) {
  const curves = useMemo(() => {
    const depot = locs.find(isDepot);
    if (!depot || locs.length < 2) return [] as THREE.Vector3[][];
    const others = locs.filter((l) => !isDepot(l));
    const result: THREE.Vector3[][] = [];
    for (const target of others) {
      const from = new THREE.Vector3(...threePosFromLatLon(depot.lat, depot.lon, 25));
      const to = new THREE.Vector3(...threePosFromLatLon(target.lat, target.lon, 25));
      const mid = new THREE.Vector3().lerpVectors(from, to, 0.5);
      mid.y += 60;
      const curve = new THREE.QuadraticBezierCurve3(from, mid, to);
      result.push(curve.getPoints(48));
    }
    return result;
  }, [locs]);

  return (
    <>
      {curves.map((pts, i) => (
        <Line
          key={i}
          points={pts}
          color={ROUTE_COLOR}
          lineWidth={1.6}
          transparent
          opacity={0.55}
        />
      ))}
    </>
  );
}

// ── No-fly zone extruded volumes ──────────────────────────────────────

function PulsingNoFlyMesh({ geom, name }: { geom: THREE.ExtrudeGeometry; name: string }) {
  const matRef = useRef<THREE.MeshStandardMaterial>(null);

  useFrame(({ clock }) => {
    if (matRef.current) {
      // Sine wave oscillation: 0.08 → 0.2, period ~3s
      matRef.current.emissiveIntensity =
        0.14 + 0.06 * Math.sin(clock.getElapsedTime() * ((2 * Math.PI) / 3));
    }
  });

  return (
    <mesh key={name} geometry={geom}>
      <meshStandardMaterial
        ref={matRef}
        color={NOFLY_COLOR}
        transparent
        opacity={0.08}
        emissive={NOFLY_COLOR}
        emissiveIntensity={0.15}
        wireframe
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

function NoFlyVolumes({ zones }: { zones: MissionNoFlyZone[] }) {
  const shapes = useMemo(() => {
    return zones
      .map((zone) => {
        const coords = zone.lat_lon ?? [];
        if (coords.length < 3) return null;
        const shape = new THREE.Shape();
        coords.forEach(([lat, lon], idx) => {
          const { east, north } = enuFromLatLon(lat, lon, 0);
          if (idx === 0) shape.moveTo(east, -north);
          else shape.lineTo(east, -north);
        });
        shape.closePath();
        const extrude = new THREE.ExtrudeGeometry(shape, {
          depth: NOFLY_CEILING,
          bevelEnabled: false,
        });
        // ExtrudeGeometry builds along +z. Rotate so the height goes up.
        extrude.rotateX(-Math.PI / 2);
        return { name: zone.name, geom: extrude };
      })
      .filter(Boolean) as { name: string; geom: THREE.ExtrudeGeometry }[];
  }, [zones]);

  // Build ground-level border points for each zone (closed loop)
  const borderLines = useMemo(() => {
    return zones
      .map((zone) => {
        const coords = zone.lat_lon ?? [];
        if (coords.length < 3) return null;
        const pts = coords.map(([lat, lon]) => {
          const { east, north } = enuFromLatLon(lat, lon, 0);
          return new THREE.Vector3(east, 0.5, -north);
        });
        // Close the loop by repeating the first point
        pts.push(pts[0].clone());
        return { name: zone.name, points: pts };
      })
      .filter(Boolean) as { name: string; points: THREE.Vector3[] }[];
  }, [zones]);

  return (
    <>
      {shapes.map(({ name, geom }) => (
        <PulsingNoFlyMesh key={name} geom={geom} name={name} />
      ))}
      {borderLines.map(({ name, points }) => (
        <Line
          key={`border-${name}`}
          points={points}
          color={NOFLY_COLOR}
          lineWidth={2}
          transparent
          opacity={0.5}
          dashed
          dashSize={15}
          gapSize={10}
        />
      ))}
    </>
  );
}

// ── Main overlay ──────────────────────────────────────────────────────

export function MissionOverlays() {
  const { missionGeography } = useSimCockpit();
  const { locations, noFlyZones } = missionGeography;

  return (
    <group>
      {locations.map((loc) => (
        <ClinicMarker key={loc.name} loc={loc} />
      ))}
      <RouteCurves locs={locations} />
      {/* NoFlyVolumes disabled — wireframe walls too visually dominant */}
    </group>
  );
}
