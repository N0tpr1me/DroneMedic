// ProceduralFallbackScene — fallback 3D world: ground, ~1000 instanced
// buildings with emissive windows, 5 landmarks, animated Thames, parks,
// billboard trees, depot, lights.
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { enuFromLatLon } from './enuFrame';

// ─ Helpers ────────────────────────────────────────────────────────────

/** Deterministic PRNG so the city layout is stable across reloads. */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    // eslint-disable-next-line no-bitwise
    let t = (state += 0x6d2b79f5);
    // eslint-disable-next-line no-bitwise
    t = Math.imul(t ^ (t >>> 15), t | 1);
    // eslint-disable-next-line no-bitwise
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    // eslint-disable-next-line no-bitwise
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Building {
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  color: string;
}

interface WaypointLocation {
  lat: number;
  lon: number;
  name: string;
}

const BUILDING_PALETTE: readonly string[] = [
  '#3b4358', '#46506a', '#2f3a52', '#52617b', '#384256', '#5e6680',
  '#6b5a4a', '#4a5268', '#736753', '#4e5c78', '#3d4660', '#574f44',
];

/**
 * Waypoint lat/lons lifted from config.py LOCATIONS (depot + 4 clinics +
 * 4 hospitals). Hardcoded here so the fallback scene can render dense
 * scenery at each drone destination without importing Python config.
 */
const WAYPOINT_LOCATIONS: ReadonlyArray<WaypointLocation> = [
  { lat: 51.5074, lon: -0.1278, name: 'Depot' },
  { lat: 51.5124, lon: -0.1200, name: 'Clinic West' },
  { lat: 51.5174, lon: -0.1350, name: 'Clinic North' },
  { lat: 51.5044, lon: -0.1100, name: 'Clinic South' },
  { lat: 51.5000, lon: -0.1400, name: 'Clinic East' },
  { lat: 51.5185, lon: -0.0590, name: 'Hospital Central' },
  { lat: 51.5468, lon: -0.0456, name: 'Hospital North' },
  { lat: 51.5155, lon: 0.0285, name: 'Hospital East' },
  { lat: 51.5690, lon: 0.0066, name: 'Hospital Far East' },
];

/**
 * Pushes `count` buildings into `out` in an annulus around (centerX, centerZ).
 * Mix of low/mid/high rises controlled by `highRiseBias`. Enforces a minimum
 * distance from center so nothing spawns on top of the waypoint marker.
 */
function seedCluster(
  out: Building[],
  rand: () => number,
  centerX: number,
  centerZ: number,
  count: number,
  minRadius: number,
  maxRadius: number,
  highRiseBias: number,
): void {
  for (let i = 0; i < count; i++) {
    const angle = rand() * Math.PI * 2;
    const radius = minRadius + rand() * (maxRadius - minRadius);
    let x = centerX + Math.cos(angle) * radius;
    let z = centerZ + Math.sin(angle) * radius;
    const roll = rand();
    let width: number;
    let depth: number;
    let height: number;
    if (roll < 0.5) {
      // Low-rise: wider footprint, short.
      width = 22 + rand() * 38;
      depth = 22 + rand() * 38;
      height = 10 + rand() * 30;
    } else if (roll < 0.5 + (0.4 - highRiseBias * 0.3)) {
      // Mid-rise.
      width = 16 + rand() * 20;
      depth = 16 + rand() * 20;
      height = 30 + rand() * 50;
    } else {
      // High-rise.
      width = 14 + rand() * 14;
      depth = 14 + rand() * 14;
      height = 80 + rand() * 100;
    }
    // Enforce exclusion radius around the cluster center (waypoint marker).
    const dx = x - centerX;
    const dz = z - centerZ;
    const dist = Math.hypot(dx, dz);
    if (dist < 40) {
      const scale = 40 / Math.max(dist, 0.001);
      x = centerX + dx * scale;
      z = centerZ + dz * scale;
    }
    const color = BUILDING_PALETTE[Math.floor(rand() * BUILDING_PALETTE.length)]!;
    out.push({ x, z, width, depth, height, color });
  }
}

function generateCity(): Building[] {
  const rand = mulberry32(1337);
  const buildings: Building[] = [];
  // Base city: ~500 buildings in 50–2500m annulus around depot (origin).
  for (let i = 0; i < 500; i++) {
    const angle = rand() * Math.PI * 2;
    const radius = 50 + rand() * 2450;
    let x = Math.cos(angle) * radius;
    let z = Math.sin(angle) * radius;
    const roll = rand();
    let width: number;
    let depth: number;
    let height: number;
    if (roll < 0.6) {
      // Low-rise: wider footprint, short.
      width = 22 + rand() * 38;
      depth = 22 + rand() * 38;
      height = 10 + rand() * 30;
    } else if (roll < 0.9) {
      // Mid-rise.
      width = 16 + rand() * 20;
      depth = 16 + rand() * 20;
      height = 30 + rand() * 50;
    } else {
      // High-rise clustered southeast (+x, -z) — "Canary Wharf".
      width = 14 + rand() * 14;
      depth = 14 + rand() * 14;
      height = 80 + rand() * 100;
      const bias = 500 + rand() * 900;
      x = bias + (rand() - 0.5) * 500;
      z = -bias + (rand() - 0.5) * 500;
    }
    const dist = Math.hypot(x, z);
    if (dist < 45) {
      const scale = 45 / Math.max(dist, 0.001);
      x *= scale;
      z *= scale;
    }
    const color = BUILDING_PALETTE[Math.floor(rand() * BUILDING_PALETTE.length)]!;
    buildings.push({ x, z, width, depth, height, color });
  }
  // Dense clusters at every non-depot waypoint (~60 buildings each, 30–500m).
  // Each cluster uses its own seeded PRNG so layouts are stable but distinct.
  for (let i = 1; i < WAYPOINT_LOCATIONS.length; i++) {
    const wp = WAYPOINT_LOCATIONS[i];
    if (!wp) continue;
    const { east, north } = enuFromLatLon(wp.lat, wp.lon);
    const centerX = east;
    const centerZ = -north; // three.js: +x east, -z north.
    const clusterRand = mulberry32(1337 + i * 9973);
    seedCluster(buildings, clusterRand, centerX, centerZ, 60, 30, 500, 0.1);
  }
  return buildings;
}

// ─ Shared procedural textures ────────────────────────────────────────

type DrawFn = (ctx: CanvasRenderingContext2D, size: number) => void;

function makeTexture(size: number, draw: DrawFn): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) draw(ctx, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function createWindowTexture(): THREE.CanvasTexture {
  const tex = makeTexture(256, (ctx, size) => {
    // Solid dark background — the additive blending on the material is
    // what lets lit cells glow without the black ever darkening the parent.
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, size, size);
    const cells = 12;
    const step = size / cells;
    for (let y = 0; y < cells; y++) {
      for (let x = 0; x < cells; x++) {
        // Sparser lighting pattern: only ~30% of cells get lit.
        const seed = (x * 113 + y * 197) % 29;
        if (seed <= 20) continue;
        // Muted warm hue — because the material blends ADDITIVELY, keep the
        // pixel intensity low so it tints instead of saturating.
        const b = 90 + ((seed * 7) % 55);
        const r = Math.floor(b * 1.0);
        const g = Math.floor(b * 0.78);
        const bl = Math.floor(b * 0.48);
        // Draw a small centred square with soft edges (two nested rects).
        const pad = step * 0.34;
        ctx.fillStyle = `rgb(${r},${g},${bl})`;
        ctx.fillRect(x * step + pad, y * step + pad, step - pad * 2, step - pad * 2);
        ctx.fillStyle = `rgba(${r},${g},${bl},0.35)`;
        const pad2 = step * 0.22;
        ctx.fillRect(x * step + pad2, y * step + pad2, step - pad2 * 2, step - pad2 * 2);
      }
    }
  });
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipMapLinearFilter;
  tex.anisotropy = 4;
  return tex;
}

function createGroundTexture(): THREE.CanvasTexture {
  const tex = makeTexture(512, (ctx, size) => {
    // Base: dark charcoal.
    ctx.fillStyle = 'rgb(24,28,34)';
    ctx.fillRect(0, 0, size, size);

    // Subtle per-pixel variance (~5% lightness jitter).
    const img = ctx.getImageData(0, 0, size, size);
    const { data } = img;
    for (let i = 0; i < data.length; i += 4) {
      const px = (i / 4) | 0;
      const h = Math.sin(px * 12.9898) * 43758.5453;
      const jitter = ((h - Math.floor(h)) - 0.5) * 10;
      data[i] = Math.max(0, Math.min(255, (data[i] ?? 0) + jitter));
      data[i + 1] = Math.max(0, Math.min(255, (data[i + 1] ?? 0) + jitter));
      data[i + 2] = Math.max(0, Math.min(255, (data[i + 2] ?? 0) + jitter));
    }
    ctx.putImageData(img, 0, 0);

    // Road grid — solid dark gray road surface bands
    const drawRoad = (x0: number, y0: number, x1: number, y1: number, w: number): void => {
      ctx.strokeStyle = 'rgba(38,42,52,0.7)';
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    };
    // Horizontal roads
    drawRoad(0, size * 0.25, size, size * 0.25, 16);
    drawRoad(0, size * 0.55, size, size * 0.55, 14);
    drawRoad(0, size * 0.85, size, size * 0.85, 12);
    // Vertical roads
    drawRoad(size * 0.22, 0, size * 0.22, size, 14);
    drawRoad(size * 0.68, 0, size * 0.68, size, 16);

    // White dashed center lines on roads
    ctx.setLineDash([6, 8]);
    ctx.strokeStyle = 'rgba(180,180,180,0.3)';
    ctx.lineWidth = 1;
    const centerLines = [size * 0.25, size * 0.55, size * 0.85];
    for (const y of centerLines) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size, y);
      ctx.stroke();
    }
    const vertCenterLines = [size * 0.22, size * 0.68];
    for (const x of vertCenterLines) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, size);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Solid edge lines on roads
    ctx.strokeStyle = 'rgba(140,140,140,0.15)';
    ctx.lineWidth = 1;
    for (const y of centerLines) {
      ctx.beginPath(); ctx.moveTo(0, y - 7); ctx.lineTo(size, y - 7); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, y + 7); ctx.lineTo(size, y + 7); ctx.stroke();
    }

    // Crosswalk patterns at intersections
    ctx.fillStyle = 'rgba(200,200,200,0.12)';
    const intersections = [
      [size * 0.22, size * 0.25], [size * 0.22, size * 0.55],
      [size * 0.68, size * 0.25], [size * 0.68, size * 0.55],
    ] as const;
    for (const [ix, iy] of intersections) {
      for (let s = -3; s <= 3; s++) {
        ctx.fillRect(ix - 8, iy + s * 4 - 1, 16, 2);
      }
    }
  });
  tex.repeat.set(40, 40);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipMapLinearFilter;
  tex.anisotropy = 4;
  return tex;
}


function createHelipadTexture(): THREE.CanvasTexture {
  const tex = makeTexture(512, (ctx, size) => {
    // Charcoal background pad.
    ctx.fillStyle = '#0a141c';
    ctx.fillRect(0, 0, size, size);

    // Subtle inner yellow border ring inscribed in the circle.
    ctx.strokeStyle = 'rgba(220,190,90,0.85)';
    ctx.lineWidth = 8;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 28, 0, Math.PI * 2);
    ctx.stroke();

    // Anti-aliased "H" — font-based fill for smooth edges at 512².
    ctx.fillStyle = '#00daf3';
    ctx.font = 'bold 320px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('H', size / 2, size / 2 + 14);
  });
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

// ─ Ground ─────────────────────────────────────────────────────────────

function Ground({ texture }: { texture: THREE.Texture }) {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[30000, 30000]} />
        <meshStandardMaterial map={texture} color="#121a28" metalness={0.15} roughness={0.88} emissive="#030611" emissiveIntensity={0.35} />
      </mesh>
    </group>
  );
}

// ─ Instanced buildings & windows ─────────────────────────────────────

interface BuildingsProps { buildings: Building[]; windowTexture: THREE.Texture }

function buildingVariantHash(b: Building, index: number): number {
  const seed = Math.abs(b.x * 73.13 + b.z * 19.37 + index * 101.7);
  const h = Math.sin(seed) * 43758.5453;
  return h - Math.floor(h);
}

/** Bucket key for instancing: "color|finish". */
function bucketKey(color: string, glossy: boolean): string {
  return `${color}|${glossy ? 'glossy' : 'matte'}`;
}

interface BucketEntry { matrix: THREE.Matrix4; width: number; height: number; depth: number }

function InstancedBuildings({ buildings, windowTexture }: BuildingsProps) {
  const { buildingBuckets, windowBuckets, rooftopTanks, rooftopBoxes } = useMemo(() => {
    const bBuckets = new Map<string, { mat: THREE.MeshStandardMaterial; entries: BucketEntry[] }>();
    const wBuckets = new Map<string, { mat: THREE.MeshBasicMaterial; entries: THREE.Matrix4[] }>();
    const tanks: THREE.Matrix4[] = [];
    const boxes: THREE.Matrix4[] = [];
    const tmpM = new THREE.Matrix4();
    const tmpPos = new THREE.Vector3();
    const tmpQuat = new THREE.Quaternion();
    const tmpScale = new THREE.Vector3();

    // Pre-create materials per bucket
    for (const color of BUILDING_PALETTE) {
      for (const glossy of [true, false]) {
        const key = bucketKey(color, glossy);
        bBuckets.set(key, {
          mat: new THREE.MeshStandardMaterial({
            color,
            metalness: glossy ? 0.8 : 0.35,
            roughness: glossy ? 0.2 : 0.72,
            envMapIntensity: glossy ? 1.2 : 1.0,
            emissive: '#0a0f1c',
            emissiveIntensity: 0.15,
          }),
          entries: [],
        });
      }
    }

    // Single window material (shared texture, additive blend)
    const winMat = new THREE.MeshBasicMaterial({
      map: windowTexture,
      color: '#d89160',
      transparent: true,
      opacity: 0.28,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });

    // Rooftop materials
    const _tankMat = new THREE.MeshStandardMaterial({ color: '#3a4050', metalness: 0.6, roughness: 0.4 });
    const _boxMat = new THREE.MeshStandardMaterial({ color: '#4a4a4a', metalness: 0.3, roughness: 0.7 });

    for (let i = 0; i < buildings.length; i++) {
      const b = buildings[i]!;
      const variant = buildingVariantHash(b, i);
      const isGlossy = variant < 0.2;
      const key = bucketKey(b.color, isGlossy);

      // Building body matrix
      tmpPos.set(b.x, b.height / 2, b.z);
      tmpScale.set(b.width, b.height, b.depth);
      tmpQuat.identity();
      tmpM.compose(tmpPos, tmpQuat, tmpScale);
      const bucket = bBuckets.get(key);
      if (bucket) bucket.entries.push({ matrix: tmpM.clone(), width: b.width, height: b.height, depth: b.depth });

      // Window overlay for tall buildings
      if (b.height >= 40) {
        const wKey = `win_${isGlossy ? 'g' : 'm'}`;
        if (!wBuckets.has(wKey)) {
          wBuckets.set(wKey, { mat: winMat, entries: [] });
        }
        tmpPos.set(b.x, b.height / 2, b.z);
        tmpScale.set(b.width * 1.004, b.height * 0.96, b.depth * 1.004);
        tmpM.compose(tmpPos, tmpQuat, tmpScale);
        wBuckets.get(wKey)!.entries.push(tmpM.clone());
      }

      // Rooftop detail for tall buildings
      if (b.height > 60) {
        const roofRand = buildingVariantHash(b, i + 7777);
        if (roofRand < 0.5) {
          // Water tank (cylinder approximated as scaled box)
          tmpPos.set(b.x + b.width * 0.2, b.height + 2, b.z + b.depth * 0.15);
          tmpScale.set(3, 4, 3);
          tmpM.compose(tmpPos, tmpQuat, tmpScale);
          tanks.push(tmpM.clone());
        } else {
          // AC unit box
          tmpPos.set(b.x - b.width * 0.15, b.height + 1.5, b.z - b.depth * 0.2);
          tmpScale.set(5, 3, 4);
          tmpM.compose(tmpPos, tmpQuat, tmpScale);
          boxes.push(tmpM.clone());
        }
      }
    }

    return {
      buildingBuckets: Array.from(bBuckets.values()).filter(b => b.entries.length > 0),
      windowBuckets: Array.from(wBuckets.values()).filter(b => b.entries.length > 0),
      rooftopTanks: { entries: tanks, mat: _tankMat },
      rooftopBoxes: { entries: boxes, mat: _boxMat },
    };
  }, [buildings, windowTexture]);

  const unitBox = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);

  return (
    <group>
      {/* Building bodies — one InstancedMesh per material bucket */}
      {buildingBuckets.map((bucket, bi) => (
        <instancedMesh
          key={`b-${bi}`}
          args={[unitBox, bucket.mat, bucket.entries.length]}
          castShadow
          receiveShadow
          ref={(mesh: THREE.InstancedMesh | null) => {
            if (!mesh) return;
            bucket.entries.forEach((e, j) => mesh.setMatrixAt(j, e.matrix));
            mesh.instanceMatrix.needsUpdate = true;
          }}
        />
      ))}
      {/* Window overlays — additive glow */}
      {windowBuckets.map((bucket, wi) => (
        <instancedMesh
          key={`w-${wi}`}
          args={[unitBox, bucket.mat, bucket.entries.length]}
          ref={(mesh: THREE.InstancedMesh | null) => {
            if (!mesh) return;
            bucket.entries.forEach((m, j) => mesh.setMatrixAt(j, m));
            mesh.instanceMatrix.needsUpdate = true;
          }}
        />
      ))}
      {/* Rooftop water tanks */}
      {rooftopTanks.entries.length > 0 && (
        <instancedMesh
          args={[unitBox, rooftopTanks.mat, rooftopTanks.entries.length]}
          ref={(mesh: THREE.InstancedMesh | null) => {
            if (!mesh) return;
            rooftopTanks.entries.forEach((m, j) => mesh.setMatrixAt(j, m));
            mesh.instanceMatrix.needsUpdate = true;
          }}
        />
      )}
      {/* Rooftop AC units */}
      {rooftopBoxes.entries.length > 0 && (
        <instancedMesh
          args={[unitBox, rooftopBoxes.mat, rooftopBoxes.entries.length]}
          ref={(mesh: THREE.InstancedMesh | null) => {
            if (!mesh) return;
            rooftopBoxes.entries.forEach((m, j) => mesh.setMatrixAt(j, m));
            mesh.instanceMatrix.needsUpdate = true;
          }}
        />
      )}
    </group>
  );
}

// ─ Landmarks (positions in ENU meters, +x East, -z North) ────────────

function Shard() {
  // The Shard — glass pyramid, (+400, -600), 310m.
  const h = 310;
  return (
    <group position={[400, 0, -600]}>
      <mesh position={[0, h / 2, 0]} castShadow>
        <cylinderGeometry args={[2, 28, h, 4]} />
        <meshStandardMaterial color="#4a5e7a" metalness={0.85} roughness={0.18} emissive="#1a2638" emissiveIntensity={0.6} />
      </mesh>
      <mesh position={[0, h + 4, 0]}><sphereGeometry args={[3, 12, 12]} /><meshBasicMaterial color="#ff5060" /></mesh>
      <pointLight position={[0, h + 2, 0]} color="#ff5060" intensity={2.5} distance={200} />
    </group>
  );
}

function Gherkin() {
  // The Gherkin — egg-shaped tower at (+500, -500), 180m.
  const h = 180;
  return (
    <group position={[500, 0, -500]}>
      <mesh position={[0, h * 0.5, 0]} scale={[1, 3.6, 1]} castShadow>
        <sphereGeometry args={[22, 20, 20]} />
        <meshStandardMaterial color="#567560" metalness={0.85} roughness={0.18} emissive="#1d3226" emissiveIntensity={0.6} />
      </mesh>
      <mesh position={[0, h + 2, 0]}><coneGeometry args={[4, 10, 12]} /><meshBasicMaterial color="#a2ffc9" /></mesh>
      <pointLight position={[0, h + 4, 0]} color="#a2ffc9" intensity={1.8} distance={160} />
    </group>
  );
}

function BigBen() {
  // Big Ben — clock tower at (-300, +150), 100m.
  const h = 100;
  return (
    <group position={[-300, 0, 150]}>
      <mesh position={[0, h / 2, 0]} castShadow>
        <boxGeometry args={[16, h, 16]} />
        <meshStandardMaterial color="#8a6f4a" metalness={0.15} roughness={0.85} emissive="#2a1e10" emissiveIntensity={0.35} />
      </mesh>
      <mesh position={[0, h + 8, 0]} castShadow>
        <coneGeometry args={[12, 22, 4]} />
        <meshStandardMaterial color="#4c3a22" metalness={0.3} roughness={0.6} />
      </mesh>
      <mesh position={[0, h - 14, 8.1]}><circleGeometry args={[5, 24]} /><meshBasicMaterial color="#fff2c0" /></mesh>
      <mesh position={[0, h - 14, -8.1]} rotation={[0, Math.PI, 0]}><circleGeometry args={[5, 24]} /><meshBasicMaterial color="#fff2c0" /></mesh>
      <pointLight position={[0, h - 14, 0]} color="#ffd089" intensity={2} distance={90} />
    </group>
  );
}

function StPauls() {
  // St Paul's — dome cathedral at (-200, -200), ~110m.
  const base = 70;
  return (
    <group position={[-200, 0, -200]}>
      <mesh position={[0, base / 2, 0]} castShadow>
        <boxGeometry args={[46, base, 30]} />
        <meshStandardMaterial color="#c8c0a8" metalness={0.1} roughness={0.9} />
      </mesh>
      <mesh position={[0, base + 10, 0]} castShadow>
        <cylinderGeometry args={[16, 18, 20, 24]} />
        <meshStandardMaterial color="#bfb79f" metalness={0.15} roughness={0.85} />
      </mesh>
      <mesh position={[0, base + 28, 0]} castShadow>
        <sphereGeometry args={[16, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#d8d0b8" metalness={0.3} roughness={0.6} emissive="#2a261a" emissiveIntensity={0.4} />
      </mesh>
      <mesh position={[0, base + 46, 0]}><sphereGeometry args={[3, 12, 12]} /><meshBasicMaterial color="#ffd089" /></mesh>
      <pointLight position={[0, base + 44, 0]} color="#ffd089" intensity={1.6} distance={100} />
    </group>
  );
}

function TowerBridge() {
  // Tower Bridge pylons at (+100, -700), 70m.
  const h = 70;
  const off = 30;
  return (
    <group position={[100, 0, -700]}>
      {[-off, off].map((ox) => (
        <group key={ox} position={[ox, 0, 0]}>
          <mesh position={[0, h / 2, 0]} castShadow>
            <boxGeometry args={[14, h, 14]} />
            <meshStandardMaterial color="#6e4a3e" metalness={0.2} roughness={0.8} emissive="#22100a" emissiveIntensity={0.35} />
          </mesh>
          <mesh position={[0, h + 6, 0]} castShadow>
            <coneGeometry args={[10, 14, 4]} />
            <meshStandardMaterial color="#3e2a20" metalness={0.25} roughness={0.7} />
          </mesh>
          <mesh position={[0, h + 14, 0]}><sphereGeometry args={[1.6, 10, 10]} /><meshBasicMaterial color="#ffd089" /></mesh>
        </group>
      ))}
      <mesh position={[0, h * 0.75, 0]}>
        <boxGeometry args={[off * 2 + 14, 6, 8]} />
        <meshStandardMaterial color="#54382e" metalness={0.25} roughness={0.75} />
      </mesh>
      <pointLight position={[0, h + 10, 0]} color="#ffd089" intensity={1.8} distance={110} />
    </group>
  );
}

// ─ Thames (animated water with physical material) ───────────────────

function Thames() {
  const meshRef = useRef<THREE.Mesh>(null);

  // Build a long rectangular plane shaped to the Thames curve path
  const geometry = useMemo(() => {
    const length = 3500;
    const width = 250;
    const segX = 120;
    const segZ = 20;
    const geo = new THREE.PlaneGeometry(length, width, segX, segZ);
    geo.rotateX(-Math.PI / 2);

    // Bend vertices along the Thames sine curve
    const pos = geo.attributes.position!;
    const curve = (t: number): number => Math.sin(t * Math.PI * 1.4) * 420 + (t - 0.5) * 180;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const t = (x + length / 2) / length;
      pos.setZ(i, z + curve(t));
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    // Store original Y positions for wave animation
    const origY = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) origY[i] = pos.getY(i);
    geo.setAttribute('origY', new THREE.BufferAttribute(origY, 1));
    return geo;
  }, []);

  const material = useMemo(() => new THREE.MeshPhysicalMaterial({
    color: '#0a2a4a',
    metalness: 0.85,
    roughness: 0.1,
    transmission: 0.15,
    ior: 1.33,
    envMapIntensity: 2.0,
    emissive: '#061828',
    emissiveIntensity: 0.3,
    transparent: true,
    opacity: 0.82,
  }), []);

  // Animate wave vertices
  useFrame(({ clock }) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const pos = mesh.geometry.attributes.position!;
    const origY = mesh.geometry.attributes.origY as THREE.BufferAttribute;
    const t = clock.elapsedTime;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      // Large swell + small ripple
      const wave = Math.sin(x * 0.008 + t * 0.8) * 1.2
                 + Math.sin(z * 0.015 + t * 1.3) * 0.5
                 + Math.sin(x * 0.025 + z * 0.02 + t * 2.0) * 0.3;
      pos.setY(i, (origY.array[i] ?? 0) + wave);
    }
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
  });

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      material={material}
      position={[100, 0.5, 320]}
      rotation={[0, 0.42, 0]}
    />
  );
}

// ─ Depot beacon ───────────────────────────────────────────────────────

function DepotBeacon({ helipadTexture }: { helipadTexture: THREE.Texture }) {
  const pulseRingRef = useRef<THREE.Mesh>(null);
  const pulseMatRef = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    // Slow pulse: ~2.2s period.
    const pulse = (Math.sin(t * 2.85) + 1) * 0.5; // 0..1
    if (pulseRingRef.current) {
      const scale = 1 + pulse * 0.22;
      pulseRingRef.current.scale.set(scale, scale, 1);
    }
    if (pulseMatRef.current) {
      pulseMatRef.current.opacity = 0.35 + pulse * 0.5;
    }
  });
  const hexShape = useMemo(() => {
    const s = new THREE.Shape();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const x = Math.cos(a) * 10;
      const y = Math.sin(a) * 10;
      if (i === 0) s.moveTo(x, y); else s.lineTo(x, y);
    }
    s.closePath();
    return s;
  }, []);
  return (
    <group position={[0, 0, 0]}>
      {/* H-helipad disc. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.12, 0]}>
        <shapeGeometry args={[hexShape]} />
        <meshBasicMaterial map={helipadTexture} transparent opacity={0.95} side={THREE.DoubleSide} />
      </mesh>
      {/* Single slow-pulsing ground ring. */}
      <mesh ref={pulseRingRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.3, 0]}>
        <ringGeometry args={[10.5, 12, 48]} />
        <meshBasicMaterial
          ref={pulseMatRef}
          color="#00daf3"
          transparent
          opacity={0.6}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      {/* One thin emissive column, ~30 m tall, at pad center. */}
      <mesh position={[0, 15, 0]}>
        <cylinderGeometry args={[0.3, 0.3, 30, 12]} />
        <meshBasicMaterial color="#00daf3" transparent opacity={0.75} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      {/* Cyan overhead anchor light (kept). */}
      <pointLight position={[0, 30, 0]} color="#00daf3" intensity={2.4} distance={140} />
    </group>
  );
}

// ─ Ambient street lights ─────────────────────────────────────────────

function StreetLights() {
  const lights = useMemo<[number, number, number][]>(() => {
    const rand = mulberry32(4242);
    const arr: [number, number, number][] = [];
    for (let i = 0; i < 14; i++) {
      const angle = rand() * Math.PI * 2;
      const radius = 80 + rand() * 500;
      arr.push([Math.cos(angle) * radius, 6 + rand() * 4, Math.sin(angle) * radius]);
    }
    return arr;
  }, []);
  return <group>{lights.map((p, i) => <pointLight key={i} position={p} color="#ffd089" intensity={0.8} distance={40} decay={2} />)}</group>;
}

// ─ Parks ──────────────────────────────────────────────────────────────

/** Green park patches near waypoint clusters. */
function Parks() {
  const parks = useMemo(() => {
    const rand = mulberry32(5555);
    const result: { x: number; z: number; w: number; d: number }[] = [];
    // Place parks near some waypoints
    const parkWaypoints = [1, 2, 4, 6]; // indices into WAYPOINT_LOCATIONS
    for (const idx of parkWaypoints) {
      const wp = WAYPOINT_LOCATIONS[idx];
      if (!wp) continue;
      const { east, north } = enuFromLatLon(wp.lat, wp.lon);
      const cx = east + (rand() - 0.5) * 200;
      const cz = -north + (rand() - 0.5) * 200;
      const w = 40 + rand() * 60;
      const d = 30 + rand() * 50;
      result.push({ x: cx, z: cz, w, d });
    }
    // A couple near the depot too
    result.push({ x: 80 + rand() * 60, z: -120 - rand() * 80, w: 50, d: 40 });
    result.push({ x: -150 + rand() * 40, z: 60 + rand() * 60, w: 60, d: 45 });
    return result;
  }, []);

  return (
    <group>
      {parks.map((p, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[p.x, 0.15, p.z]}>
          <planeGeometry args={[p.w, p.d]} />
          <meshStandardMaterial color="#1a3a1a" roughness={0.95} metalness={0.05} />
        </mesh>
      ))}
    </group>
  );
}

// ─ Billboard trees ───────────────────────────────────────────────────

function createTreeTexture(): THREE.CanvasTexture {
  const tex = makeTexture(64, (ctx, size) => {
    ctx.clearRect(0, 0, size, size);
    // Trunk
    ctx.fillStyle = '#3d2b1f';
    ctx.fillRect(size * 0.4, size * 0.55, size * 0.2, size * 0.45);
    // Canopy — layered circles for natural look
    const cx = size / 2;
    const cy = size * 0.35;
    const drawBlob = (ox: number, oy: number, r: number, c: string) => {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(cx + ox, cy + oy, r, 0, Math.PI * 2);
      ctx.fill();
    };
    drawBlob(0, 0, size * 0.32, '#1a4a1a');
    drawBlob(-4, -3, size * 0.26, '#226622');
    drawBlob(5, 2, size * 0.24, '#1e5a1e');
    drawBlob(-2, -6, size * 0.18, '#2a7a2a');
  });
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

function BillboardTrees() {
  const treeTex = useMemo(() => createTreeTexture(), []);
  const { trees, mat } = useMemo(() => {
    const rand = mulberry32(7777);
    const treeList: THREE.Matrix4[] = [];
    const tmpM = new THREE.Matrix4();
    const tmpPos = new THREE.Vector3();
    const tmpQuat = new THREE.Quaternion();
    const tmpScale = new THREE.Vector3();

    // Trees near waypoint clusters
    for (let wi = 0; wi < WAYPOINT_LOCATIONS.length; wi++) {
      const wp = WAYPOINT_LOCATIONS[wi]!;
      const { east, north } = enuFromLatLon(wp.lat, wp.lon);
      const cx = east;
      const cz = -north;
      const count = wi === 0 ? 8 : 18; // fewer at depot, more at clinics
      for (let j = 0; j < count; j++) {
        const angle = rand() * Math.PI * 2;
        const radius = 20 + rand() * 200;
        const x = cx + Math.cos(angle) * radius;
        const z = cz + Math.sin(angle) * radius;
        const h = 8 + rand() * 14;
        tmpPos.set(x, h / 2, z);
        tmpQuat.identity();
        tmpScale.set(h * 0.7, h, 1);
        tmpM.compose(tmpPos, tmpQuat, tmpScale);
        treeList.push(tmpM.clone());
      }
    }

    const treeMat = new THREE.MeshBasicMaterial({
      map: treeTex,
      transparent: true,
      alphaTest: 0.1,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    return { trees: treeList, mat: treeMat };
  }, [treeTex]);

  const planeGeo = useMemo(() => new THREE.PlaneGeometry(1, 1), []);

  // Scratch objects for billboard rotation (avoid per-frame allocation)
  const scratch = useMemo(() => ({
    m: new THREE.Matrix4(),
    pos: new THREE.Vector3(),
    scale: new THREE.Vector3(),
    quat: new THREE.Quaternion(),
    up: new THREE.Vector3(0, 1, 0),
  }), []);

  const meshRef = useRef<THREE.InstancedMesh>(null);
  const initRef = useRef(false);

  // Billboard: make trees always face camera each frame
  useFrame(({ camera }) => {
    const mesh = meshRef.current;
    if (!mesh) return;

    // Initialize matrices on first frame
    if (!initRef.current) {
      trees.forEach((m, j) => mesh.setMatrixAt(j, m));
      initRef.current = true;
    }

    const { m: tmpM, pos: tmpPos, scale: tmpScale, quat: lookQuat, up } = scratch;

    for (let i = 0; i < trees.length; i++) {
      mesh.getMatrixAt(i, tmpM);
      tmpPos.setFromMatrixPosition(tmpM);
      tmpScale.setFromMatrixScale(tmpM);
      const dx = camera.position.x - tmpPos.x;
      const dz = camera.position.z - tmpPos.z;
      lookQuat.setFromAxisAngle(up, Math.atan2(dx, dz));
      tmpM.compose(tmpPos, lookQuat, tmpScale);
      mesh.setMatrixAt(i, tmpM);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  if (trees.length === 0) return null;
  return (
    <instancedMesh ref={meshRef} args={[planeGeo, mat, trees.length]} />
  );
}

// ─ Root ───────────────────────────────────────────────────────────────

export function ProceduralFallbackScene() {
  const buildings = useMemo(() => generateCity(), []);
  const windowTexture = useMemo(() => createWindowTexture(), []);
  const groundTexture = useMemo(() => createGroundTexture(), []);
  const helipadTexture = useMemo(() => createHelipadTexture(), []);
  return (
    <group>
      <Ground texture={groundTexture} />
      <InstancedBuildings buildings={buildings} windowTexture={windowTexture} />
      <Thames />
      <Parks />
      <BillboardTrees />
      <Shard /><Gherkin /><BigBen /><StPauls /><TowerBridge />
      <DepotBeacon helipadTexture={helipadTexture} />
      <StreetLights />
    </group>
  );
}
