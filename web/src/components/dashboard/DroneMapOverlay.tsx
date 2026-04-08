import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// ── Types ──

interface DroneData {
  id: string;
  lat: number;
  lng: number;
  altitude: number;
  heading: number;
  color: string;
  status: string;
}

interface RouteData {
  droneId: string;
  waypoints: Array<{ lat: number; lng: number }>;
  color: string;
  progress: number;
}

interface DepotData {
  lat: number;
  lng: number;
  name: string;
  rangeKm: number;
}

interface DroneMapOverlayProps {
  map: google.maps.Map | null;
  drones: DroneData[];
  routes?: RouteData[];
  depots?: DepotData[];
}

// ── Helpers ──

function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      sinLng * sinLng;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function colorNameToHex(name: string): string {
  const map: Record<string, string> = {
    cyan: '#00daf3',
    amber: '#ffb020',
    red: '#ff4444',
    green: '#4ade80',
    blue: '#3b82f6',
    purple: '#8b5cf6',
  };
  return map[name.toLowerCase()] ?? name;
}

function positionFromMatrix(m: Float64Array): THREE.Vector3 {
  return new THREE.Vector3(m[12], m[13], m[14]);
}

// ── Component ──

export function DroneMapOverlay({
  map,
  drones,
  routes = [],
  depots = [],
}: DroneMapOverlayProps) {
  const dronesRef = useRef<DroneData[]>(drones);
  const routesRef = useRef<RouteData[]>(routes);
  const depotsRef = useRef<DepotData[]>(depots);
  const overlayRef = useRef<google.maps.WebGLOverlayView | null>(null);
  const clockRef = useRef(0);

  // Keep refs in sync with props
  dronesRef.current = drones;
  routesRef.current = routes;
  depotsRef.current = depots;

  useEffect(() => {
    if (!map) return;

    const overlay = new google.maps.WebGLOverlayView();
    overlayRef.current = overlay;

    let scene: THREE.Scene;
    let camera: THREE.PerspectiveCamera;
    let renderer: THREE.WebGLRenderer;
    let droneTemplate: THREE.Group | null = null;
    const droneModels = new Map<string, THREE.Group>();
    const arcMeshes: THREE.Mesh[] = [];

    overlay.onAdd = () => {
      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera();

      const ambientLight = new THREE.AmbientLight(0xffffff, 0.75);
      const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
      directionalLight.position.set(0, 10, 50);
      scene.add(ambientLight, directionalLight);
    };

    overlay.onContextRestored = ({ gl }: { gl: WebGLRenderingContext }) => {
      renderer = new THREE.WebGLRenderer({
        canvas: gl.canvas,
        context: gl,
        ...gl.getContextAttributes(),
      });
      renderer.autoClear = false;

      const loader = new GLTFLoader();
      loader.load(
        '/models/drone-medic.glb',
        (gltf) => {
          droneTemplate = gltf.scene;
          droneTemplate.scale.set(0.5, 0.5, 0.5);
        },
        undefined,
        () => {
          // GLB failed to load -- build a procedural fallback drone
          droneTemplate = buildFallbackDrone();
        },
      );
    };

    overlay.onDraw = ({
      gl,
      transformer,
    }: {
      gl: WebGLRenderingContext;
      transformer: google.maps.CoordinateTransformer;
    }) => {
      clockRef.current += 0.016; // ~60 fps tick

      const currentDrones = dronesRef.current;
      const currentRoutes = routesRef.current;
      const currentDepots = depotsRef.current;

      // ── Ensure drone models exist for each drone ──
      if (droneTemplate) {
        for (const drone of currentDrones) {
          if (!droneModels.has(drone.id)) {
            const clone = droneTemplate.clone();
            // Tint the clone based on drone color
            clone.traverse((child) => {
              if (child instanceof THREE.Mesh && child.material) {
                const mat = (child.material as THREE.MeshStandardMaterial).clone();
                if (mat.emissive) {
                  mat.emissive.set(colorNameToHex(drone.color));
                  mat.emissiveIntensity = 0.4;
                }
                child.material = mat;
              }
            });
            scene.add(clone);
            droneModels.set(drone.id, clone);
          }
        }

        // Remove models for drones that no longer exist
        const currentIds = new Set(currentDrones.map((d) => d.id));
        for (const [id, model] of droneModels.entries()) {
          if (!currentIds.has(id)) {
            scene.remove(model);
            droneModels.delete(id);
          }
        }
      }

      // ── Position each drone ──
      for (const drone of currentDrones) {
        const model = droneModels.get(drone.id);
        if (!model) continue;

        const matrix = transformer.fromLatLngAltitude({
          lat: drone.lat,
          lng: drone.lng,
          altitude: drone.altitude,
        });

        if (matrix) {
          model.matrix.fromArray(matrix);
          model.matrixAutoUpdate = false;

          // Animate propellers / rotors
          if (drone.status === 'flying') {
            model.traverse((child) => {
              const n = child.name.toLowerCase();
              if (n.includes('prop') || n.includes('rotor')) {
                child.rotation.y += drone.status === 'flying' ? 0.3 : 0;
              }
            });
          }

          // Status-based emissive color
          const emissiveColor =
            drone.status === 'flying' ? new THREE.Color('#00daf3') :
            drone.status === 'battery_low' ? new THREE.Color('#ffb020').multiplyScalar(0.5 + 0.5 * Math.sin(clockRef.current * 4)) :
            drone.status === 'offline' ? new THREE.Color('#ff4444') :
            null;
          if (emissiveColor) {
            model.traverse((child) => {
              if (child instanceof THREE.Mesh && child.material && (child.material as THREE.MeshStandardMaterial).emissive) {
                (child.material as THREE.MeshStandardMaterial).emissive.copy(emissiveColor);
              }
            });
          }
        }
      }

      // ── Flight arc paths ──
      // Clear old arcs
      for (const mesh of arcMeshes) {
        scene.remove(mesh);
        mesh.geometry.dispose();
        if (mesh.material instanceof THREE.Material) mesh.material.dispose();
      }
      arcMeshes.length = 0;

      for (const route of currentRoutes) {
        const { waypoints, color, progress } = route;
        for (let i = 0; i < waypoints.length - 1; i++) {
          const start = waypoints[i];
          const end = waypoints[i + 1];
          const arcMesh = createArcMesh(start, end, colorNameToHex(color), progress, transformer, clockRef.current);
          if (arcMesh) {
            scene.add(arcMesh);
            arcMeshes.push(arcMesh);
          }
        }
      }

      // ── Camera + render ──
      const refDrone = currentDrones[0];
      const refLat = refDrone?.lat ?? 51.5074;
      const refLng = refDrone?.lng ?? -0.1278;

      const camMatrix = transformer.fromLatLngAltitude({
        lat: refLat,
        lng: refLng,
        altitude: 0,
      });

      if (camMatrix) {
        camera.projectionMatrix.fromArray(camMatrix);
      }

      renderer.render(scene, camera);
      renderer.resetState();
      overlay.requestRedraw();
    };

    overlay.setMap(map);

    return () => {
      overlay.setMap(null);
      overlayRef.current = null;

      // Dispose all drone models
      for (const [, model] of droneModels) {
        model.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry?.dispose();
            if (child.material instanceof THREE.Material) {
              child.material.dispose();
            }
          }
        });
      }
      droneModels.clear();

      // Dispose arc meshes
      for (const mesh of arcMeshes) {
        mesh.geometry.dispose();
        if (mesh.material instanceof THREE.Material) mesh.material.dispose();
      }
      arcMeshes.length = 0;

    };
  }, [map]);

  return null;
}

// ── Fallback procedural drone (when GLB is unavailable) ──

function buildFallbackDrone(): THREE.Group {
  const group = new THREE.Group();

  // Body
  const bodyGeo = new THREE.BoxGeometry(1.2, 0.25, 1.2);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0x0d1020,
    metalness: 0.8,
    roughness: 0.2,
  });
  group.add(new THREE.Mesh(bodyGeo, bodyMat));

  // Dome
  const domeGeo = new THREE.SphereGeometry(0.3, 16, 16, 0, Math.PI * 2, 0, Math.PI / 2);
  const domeMat = new THREE.MeshStandardMaterial({
    color: 0x00daf3,
    metalness: 0.6,
    roughness: 0.3,
    transparent: true,
    opacity: 0.6,
  });
  const dome = new THREE.Mesh(domeGeo, domeMat);
  dome.position.set(0, 0.2, 0);
  group.add(dome);

  // Arms + propellers
  const armPositions: [number, number, number][] = [
    [0.8, 0, 0.8],
    [-0.8, 0, 0.8],
    [0.8, 0, -0.8],
    [-0.8, 0, -0.8],
  ];

  for (const pos of armPositions) {
    // Arm
    const armGeo = new THREE.BoxGeometry(0.12, 0.08, 1);
    const armMat = new THREE.MeshStandardMaterial({
      color: 0x1a1a30,
      metalness: 0.7,
      roughness: 0.3,
    });
    const arm = new THREE.Mesh(armGeo, armMat);
    arm.position.set(pos[0] * 0.5, 0.05, pos[2] * 0.5);
    arm.rotation.y = Math.atan2(pos[0], pos[2]);
    group.add(arm);

    // Motor
    const motorGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.15, 8);
    const motorMat = new THREE.MeshStandardMaterial({
      color: 0x222222,
      metalness: 0.9,
      roughness: 0.1,
    });
    const motor = new THREE.Mesh(motorGeo, motorMat);
    motor.position.set(pos[0], 0.1, pos[2]);
    group.add(motor);

    // Propeller disc
    const propGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.02, 16);
    const propMat = new THREE.MeshStandardMaterial({
      color: 0x00daf3,
      transparent: true,
      opacity: 0.12,
    });
    const prop = new THREE.Mesh(propGeo, propMat);
    prop.name = 'propeller';
    prop.position.set(pos[0], 0.2, pos[2]);
    group.add(prop);
  }

  group.scale.set(0.5, 0.5, 0.5);
  return group;
}

// ── Arc mesh between two waypoints ──

function createArcMesh(
  start: { lat: number; lng: number },
  end: { lat: number; lng: number },
  color: string,
  progress: number,
  transformer: google.maps.CoordinateTransformer,
  time: number,
): THREE.Mesh | null {
  const midLat = (start.lat + end.lat) / 2;
  const midLng = (start.lng + end.lng) / 2;
  const dist = haversineKm(start, end);
  const arcHeight = Math.min(dist * 20, 150);

  const startMatrix = transformer.fromLatLngAltitude({
    lat: start.lat,
    lng: start.lng,
    altitude: 20,
  });
  const midMatrix = transformer.fromLatLngAltitude({
    lat: midLat,
    lng: midLng,
    altitude: arcHeight,
  });
  const endMatrix = transformer.fromLatLngAltitude({
    lat: end.lat,
    lng: end.lng,
    altitude: 20,
  });

  if (!startMatrix || !midMatrix || !endMatrix) return null;

  const startPos = positionFromMatrix(startMatrix);
  const midPos = positionFromMatrix(midMatrix);
  const endPos = positionFromMatrix(endMatrix);

  const curve = new THREE.CatmullRomCurve3([startPos, midPos, endPos]);
  const tubeGeo = new THREE.TubeGeometry(curve, 64, 3, 8, false);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      time: { value: time },
      color: { value: new THREE.Color(color) },
      progress: { value: progress },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float time;
      uniform vec3 color;
      uniform float progress;
      varying vec2 vUv;
      void main() {
        float traveled = vUv.x < progress ? 0.9 : 0.0;
        float pulse = 0.5 + 0.5 * sin(time * 3.0 + vUv.x * 30.0);
        float remaining = vUv.x >= progress ? pulse * 0.4 : 0.0;
        float particle = smoothstep(0.98, 1.0, fract(vUv.x * 20.0 - time * 2.0));
        float particleAlpha = vUv.x < progress ? particle * 0.8 : particle * 0.3;
        float alpha = max(traveled, max(remaining, particleAlpha));
        float edge = 1.0 - abs(vUv.y - 0.5) * 2.0;
        alpha *= smoothstep(0.0, 0.3, edge);
        gl_FragColor = vec4(color, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
  });

  return new THREE.Mesh(tubeGeo, material);
}

// ── Depot range ring ──

// Depot range rings removed — caused rendering artifacts at map scale
