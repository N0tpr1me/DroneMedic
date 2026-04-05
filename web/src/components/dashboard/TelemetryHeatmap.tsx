import { useMemo, useState } from 'react';
import { HeatmapLayer } from '@deck.gl/aggregation-layers';

interface HeatmapPoint {
  lat: number;
  lon: number;
  weight: number;
}

interface TelemetryHeatmapProps {
  data: HeatmapPoint[];
  visible: boolean;
  intensity?: number;
  radiusPixels?: number;
}

const DEMO_HEATMAP: HeatmapPoint[] = [
  { lat: 51.5185, lon: -0.059, weight: 23 },
  { lat: 51.5468, lon: -0.0456, weight: 18 },
  { lat: 51.5074, lon: -0.1278, weight: 35 },
  { lat: 51.5124, lon: -0.12, weight: 12 },
  { lat: 51.5155, lon: 0.0285, weight: 8 },
];

const COLOR_RANGE: [number, number, number][] = [
  [20, 40, 100],
  [0, 130, 180],
  [0, 218, 243],
  [100, 230, 150],
  [245, 166, 35],
  [220, 50, 50],
];

/**
 * Creates a Deck.gl HeatmapLayer config for telemetry density visualization.
 * The parent component (Dashboard/MapView) should include this layer in its
 * Deck.gl layer array.
 */
export function useHeatmapLayer({
  data,
  visible,
  intensity = 1,
  radiusPixels = 30,
}: TelemetryHeatmapProps) {
  const points = data.length > 0 ? data : DEMO_HEATMAP;

  const layer = useMemo(
    () =>
      new HeatmapLayer({
        id: 'telemetry-heatmap',
        data: points,
        getPosition: (d: HeatmapPoint) => [d.lon, d.lat],
        getWeight: (d: HeatmapPoint) => d.weight,
        radiusPixels,
        intensity,
        threshold: 0.05,
        colorRange: COLOR_RANGE,
        opacity: 0.6,
        visible,
      }),
    [points, visible, intensity, radiusPixels],
  );

  return layer;
}

/**
 * Toggle button for showing/hiding the heatmap overlay.
 */
export function HeatmapToggle({
  active,
  onToggle,
}: {
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      type="button"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 12px',
        borderRadius: 8,
        border: '1px solid',
        borderColor: active ? '#00daf3' : '#30353a',
        background: active ? 'rgba(0,218,243,0.12)' : 'rgba(15,20,24,0.7)',
        color: active ? '#00daf3' : '#9ca3af',
        fontSize: 12,
        fontWeight: 500,
        cursor: 'pointer',
        transition: 'all 0.2s ease',
        backdropFilter: 'blur(8px)',
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
        <circle
          cx="12"
          cy="12"
          r="3"
          fill={active ? '#00daf3' : '#6b7280'}
          opacity="0.9"
        />
        <circle
          cx="12"
          cy="12"
          r="7"
          stroke={active ? '#00daf3' : '#6b7280'}
          strokeWidth="1.5"
          opacity="0.5"
          fill="none"
        />
        <circle
          cx="12"
          cy="12"
          r="11"
          stroke={active ? '#00daf3' : '#6b7280'}
          strokeWidth="1"
          opacity="0.25"
          fill="none"
        />
      </svg>
      Heatmap
    </button>
  );
}

/**
 * Convenience wrapper: combines toggle state + layer creation.
 * Usage:
 *   const { layer, Toggle } = useTelemetryHeatmap({ data, intensity });
 *   // Add `layer` to Deck.gl layers array, render <Toggle /> in controls.
 */
export function useTelemetryHeatmap({
  data = [] as HeatmapPoint[],
  intensity = 1,
  radiusPixels = 30,
}: Partial<TelemetryHeatmapProps> = {}) {
  const [visible, setVisible] = useState(false);

  const layer = useHeatmapLayer({
    data: data ?? [],
    visible,
    intensity,
    radiusPixels,
  });

  function Toggle() {
    return <HeatmapToggle active={visible} onToggle={() => setVisible((v) => !v)} />;
  }

  return { layer, visible, setVisible, Toggle };
}

export { DEMO_HEATMAP };
export type { HeatmapPoint, TelemetryHeatmapProps };
