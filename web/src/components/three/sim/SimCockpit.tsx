// SimCockpit — the top-level wrapper mounted inside the Dashboard's 3D
// simulation panel. Composes:
//
//   - SimCockpitProvider (context)
//   - GoogleTilesScene (Canvas)
//   - HUD widgets (FlightHUD, PhaseStrip, LiveStatusPill, ReasoningTicker,
//     POVFeed, SelfCritiquePanel, CameraPresetBar, PlaybackControls,
//     DebugOverlay, HelpCard)
//
// A single top-level component lets Dashboard keep its JSX clean: it
// just renders <SimCockpit onClose={...} />.

import { useEffect, useMemo, useState } from 'react';
import {
  SimCockpitProvider,
  useSimCockpit,
  type ConnectionState,
} from './SimCockpitContext';
import { GoogleTilesScene } from './GoogleTilesScene';
import { FlightHUD } from './hud/FlightHUD';
import { PhaseStrip } from './hud/PhaseStrip';
import { LiveStatusPill } from './hud/LiveStatusPill';
import { CameraPresetBar } from './hud/CameraPresetBar';
import { PlaybackControls } from './hud/PlaybackControls';
import { DebugOverlay } from './hud/DebugOverlay';
import { HelpCard } from './hud/HelpCard';
import { ReasoningTicker } from './hud/ReasoningTicker';
import { POVFeed } from './hud/POVFeed';
import { SelfCritiquePanel } from './hud/SelfCritiquePanel';
import { useSimHotkeys } from './useSimHotkeys';
import { usePX4Telemetry } from '../../../hooks/usePX4Telemetry';
import { useMissionGeography } from '../../../hooks/useMissionGeography';
import { getGPUTier } from 'detect-gpu';
import type { TierResult } from 'detect-gpu';

interface SimCockpitProps {
  expanded: boolean;
  onClose?: () => void;
  onToggleFullscreen?: () => void;
}

interface InnerProps {
  onClose?: () => void;
  onToggleFullscreen?: () => void;
  qualityTier: 'high' | 'medium' | 'low';
}

function InnerCockpit({ onClose, onToggleFullscreen, qualityTier }: InnerProps) {
  const { setQualityTier } = useSimCockpit();
  useSimHotkeys({ onClose, onToggleFullscreen });

  useEffect(() => {
    setQualityTier(qualityTier);
  }, [qualityTier, setQualityTier]);

  return (
    <>
      <GoogleTilesScene />
      <LiveStatusPill />
      <FlightHUD />
      <PhaseStrip />
      <CameraPresetBar />
      <PlaybackControls />
      <ReasoningTicker />
      <POVFeed />
      <SelfCritiquePanel />
      <DebugOverlay />
      <HelpCard />
    </>
  );
}

export function SimCockpit({ onClose, onToggleFullscreen }: SimCockpitProps) {
  const { telemetry, connected, source } = usePX4Telemetry();
  const missionGeography = useMissionGeography();
  const [qualityTier, setQualityTier] = useState<'high' | 'medium' | 'low'>('high');

  useEffect(() => {
    let cancelled = false;
    getGPUTier()
      .then((result: TierResult) => {
        if (cancelled) return;
        const tier = result?.tier ?? 2;
        setQualityTier(tier >= 3 ? 'high' : tier === 2 ? 'medium' : 'low');
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const connection: ConnectionState = useMemo(() => {
    if (source === 'physics') return 'physics';
    if (source === 'mock') return 'mock';
    if (source === 'px4' && connected) return 'live-vm';
    if (source === 'px4' && !connected) return 'reconnecting';
    return 'offline';
  }, [source, connected]);

  return (
    <div
      className="absolute inset-0 overflow-hidden"
      style={{ background: '#020308' }}
    >
      <SimCockpitProvider
        telemetry={telemetry}
        missionGeography={missionGeography}
        connection={connection}
      >
        <InnerCockpit
          onClose={onClose}
          onToggleFullscreen={onToggleFullscreen}
          qualityTier={qualityTier}
        />
      </SimCockpitProvider>
    </div>
  );
}
