// useLidarReasoning — browser-side hook that converts LiDAR obstacle clusters
// from the shared lidar bus into `ReasoningItem` records for the cockpit
// reasoning ticker.
//
// Debounces per angular bucket so a single building staying in view for
// several seconds produces one ticker card, not 30. Returns a readonly
// slice of the most recent items for merging into the wider reasoning list.

import { useEffect, useRef, useState } from 'react';
import { subscribeLidarFrame, type LidarFrame, type LidarObstacle } from './lidarBus';
import type { ReasoningItem } from './SimCockpitContext';

const MAX_ITEMS = 10;
const DEBOUNCE_MS = 2500;

function severityFromObstacle(sev: LidarObstacle['severity']): ReasoningItem['severity'] {
  if (sev === 'critical') return 'critical';
  if (sev === 'warning') return 'warning';
  return 'info';
}

export function useLidarReasoning(): readonly ReasoningItem[] {
  const [items, setItems] = useState<ReasoningItem[]>([]);
  const lastEmitByBucketRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    const handler = (frame: LidarFrame): void => {
      const nowMs = frame.timestamp;
      const emitted: ReasoningItem[] = [];
      frame.obstacles.forEach((obs) => {
        const parts = obs.id.split('-');
        const bucket = parts[1] ?? 'b0';
        const last = lastEmitByBucketRef.current.get(bucket) ?? 0;
        if (nowMs - last < DEBOUNCE_MS) return;
        lastEmitByBucketRef.current.set(bucket, nowMs);
        emitted.push({
          id: obs.id,
          kind: 'lidar',
          text: `🛑 LIDAR · ${obs.label}`,
          timestamp: nowMs,
          severity: severityFromObstacle(obs.severity),
        });
      });
      if (emitted.length === 0) return;
      setItems((prev) => {
        const merged = [...prev, ...emitted];
        return merged.slice(-MAX_ITEMS);
      });
    };
    const unsubscribe = subscribeLidarFrame(handler);
    return unsubscribe;
  }, []);

  return items;
}
