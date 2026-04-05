import { lazy, Suspense } from 'react';
import { Skeleton } from '../ui/Skeleton';

// Lazy load Plotly to avoid bundle bloat
const Plot = lazy(() => import('react-plotly.js'));

interface PlotlyTelemetryChartProps {
  data: Array<{ time: number; battery: number; speed: number; altitude: number }>;
  width?: number;
  height?: number;
}

export function PlotlyTelemetryChart({ data, width = 400, height = 200 }: PlotlyTelemetryChartProps) {
  if (!data.length) {
    return <Skeleton variant="chart" height={height} />;
  }

  const times = data.map((d) => new Date(d.time * 1000));

  return (
    <Suspense fallback={<Skeleton variant="chart" height={height} />}>
      <Plot
        data={[
          {
            x: times,
            y: data.map((d) => d.battery),
            type: 'scattergl',
            mode: 'lines',
            name: 'Battery %',
            line: { color: '#00daf3', width: 2 },
          },
          {
            x: times,
            y: data.map((d) => d.speed),
            type: 'scattergl',
            mode: 'lines',
            name: 'Speed m/s',
            line: { color: '#f5a623', width: 1.5 },
            yaxis: 'y2',
          },
        ]}
        layout={{
          width,
          height,
          paper_bgcolor: 'transparent',
          plot_bgcolor: 'transparent',
          margin: { l: 40, r: 40, t: 10, b: 30 },
          font: { color: '#8d90a0', size: 10 },
          xaxis: { gridcolor: 'rgba(67,70,84,0.2)', tickformat: '%H:%M' },
          yaxis: { title: { text: 'Battery %' }, gridcolor: 'rgba(67,70,84,0.2)', range: [0, 100] },
          yaxis2: { title: { text: 'Speed m/s' }, overlaying: 'y', side: 'right', range: [0, 20] },
          legend: { orientation: 'h', y: -0.2, font: { size: 9 } },
        }}
        config={{ displayModeBar: false, responsive: true }}
      />
    </Suspense>
  );
}
