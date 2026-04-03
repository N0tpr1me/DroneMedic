import { useState, useEffect, useMemo, useCallback } from 'react';
import { APIProvider, Map } from '@vis.gl/react-google-maps';
import { GoogleMapsOverlay } from '@deck.gl/google-maps';
import { HeatmapLayer } from '@deck.gl/aggregation-layers';
import { Flame, Eye, EyeOff } from 'lucide-react';
import { GlassPanel } from '../ui/GlassPanel';

// ── Types ──

interface DemandPoint {
  lat: number;
  lon: number;
  weight: number;
}

interface DemandHeatmapProps {
  /** Optional data override; falls back to mock predictions */
  data?: DemandPoint[];
  /** Map center latitude */
  centerLat?: number;
  /** Map center longitude */
  centerLon?: number;
}

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';

// Mock prediction data around London for demo
const MOCK_DEMAND: DemandPoint[] = [
  { lat: 51.512, lon: -0.130, weight: 0.9 },
  { lat: 51.508, lon: -0.076, weight: 0.7 },
  { lat: 51.519, lon: -0.141, weight: 0.5 },
  { lat: 51.503, lon: -0.119, weight: 0.85 },
  { lat: 51.515, lon: -0.092, weight: 0.6 },
  { lat: 51.525, lon: -0.105, weight: 0.4 },
  { lat: 51.498, lon: -0.148, weight: 0.75 },
  { lat: 51.530, lon: -0.124, weight: 0.55 },
  { lat: 51.492, lon: -0.065, weight: 0.8 },
  { lat: 51.517, lon: -0.175, weight: 0.35 },
  { lat: 51.505, lon: -0.157, weight: 0.65 },
  { lat: 51.522, lon: -0.088, weight: 0.45 },
];

// ── Overlay Hook ──

function useDeckOverlay(layers: unknown[]) {
  const [overlay] = useState(() => new GoogleMapsOverlay({ interleaved: true }));

  useEffect(() => {
    overlay.setProps({ layers });
  }, [overlay, layers]);

  const onMapLoad = useCallback(
    (map: google.maps.Map) => {
      overlay.setMap(map);
    },
    [overlay],
  );

  useEffect(() => {
    return () => {
      overlay.setMap(null);
    };
  }, [overlay]);

  return { onMapLoad };
}

// ── Main Component ──

export function DemandHeatmap({
  data,
  centerLat = 51.5074,
  centerLon = -0.1278,
}: DemandHeatmapProps) {
  const [visible, setVisible] = useState(true);
  const demandData = data ?? MOCK_DEMAND;

  const layers = useMemo(() => {
    if (!visible) return [];

    return [
      new HeatmapLayer({
        id: 'demand-heatmap',
        data: demandData,
        getPosition: (d: DemandPoint) => [d.lon, d.lat],
        getWeight: (d: DemandPoint) => d.weight,
        radiusPixels: 60,
        intensity: 1.5,
        threshold: 0.05,
        colorRange: [
          [0, 80, 200, 25],    // blue (low)
          [0, 150, 255, 80],   // light blue
          [0, 220, 180, 140],  // teal
          [255, 220, 0, 180],  // yellow
          [255, 140, 0, 210],  // orange
          [255, 50, 50, 240],  // red (high)
        ],
      }),
    ];
  }, [demandData, visible]);

  const { onMapLoad } = useDeckOverlay(layers);

  if (!GOOGLE_MAPS_API_KEY) {
    return (
      <GlassPanel className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-amber-400">
          <Flame className="w-4 h-4" />
          <span className="text-sm font-medium">Demand Heatmap</span>
        </div>
        <p className="text-xs text-on-surface-variant/60">
          Google Maps API key required for heatmap view.
        </p>
      </GlassPanel>
    );
  }

  return (
    <GlassPanel className="flex flex-col gap-3">
      {/* Header with toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-amber-400">
          <Flame className="w-4 h-4" />
          <span className="text-sm font-medium">Demand Prediction</span>
        </div>
        <button
          type="button"
          onClick={() => setVisible(!visible)}
          className="
            flex items-center gap-1 px-2 py-1 rounded-lg text-xs
            bg-amber-500/10 text-amber-400 border border-amber-500/20
            hover:bg-amber-500/20 transition-colors cursor-pointer
          "
        >
          {visible ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
          {visible ? 'Hide' : 'Show'}
        </button>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-2 text-[10px] text-on-surface-variant/60">
        <span>Low</span>
        <div
          className="flex-1 h-1.5 rounded-full"
          style={{
            background: 'linear-gradient(to right, #0050C8, #00DCFF, #00DCB4, #FFDC00, #FF8C00, #FF3232)',
          }}
        />
        <span>High</span>
      </div>

      {/* Map */}
      <div className="rounded-xl overflow-hidden border border-outline-variant/10" style={{ height: 200 }}>
        <APIProvider apiKey={GOOGLE_MAPS_API_KEY}>
          <Map
            defaultCenter={{ lat: centerLat, lng: centerLon }}
            defaultZoom={13}
            mapId="dronemedic-heatmap"
            gestureHandling="greedy"
            disableDefaultUI
            colorScheme="DARK"
            onTilesLoaded={(ev) => {
              const map = (ev as unknown as { map: google.maps.Map }).map;
              if (map) onMapLoad(map);
            }}
            style={{ width: '100%', height: '100%' }}
          />
        </APIProvider>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-black/20 px-2 py-1.5">
          <div className="text-[10px] text-on-surface-variant/50">Hotspots</div>
          <div className="text-sm font-semibold text-amber-400">
            {demandData.filter((d) => d.weight > 0.7).length}
          </div>
        </div>
        <div className="rounded-lg bg-black/20 px-2 py-1.5">
          <div className="text-[10px] text-on-surface-variant/50">Avg Demand</div>
          <div className="text-sm font-semibold text-on-surface-variant">
            {(demandData.reduce((s, d) => s + d.weight, 0) / demandData.length).toFixed(2)}
          </div>
        </div>
        <div className="rounded-lg bg-black/20 px-2 py-1.5">
          <div className="text-[10px] text-on-surface-variant/50">Coverage</div>
          <div className="text-sm font-semibold text-accent-green">
            {demandData.length} pts
          </div>
        </div>
      </div>
    </GlassPanel>
  );
}
