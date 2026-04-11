// PostFxStack — postprocessing chain for the 3D cockpit. Quality tier is
// driven by detect-gpu once, then stored in the SimCockpitContext so the
// user can override it from the DebugOverlay.
//
// HIGH:   Bloom + SMAA + Vignette + ChromaticAberration + DepthOfField
// MEDIUM: Bloom + SMAA + Vignette
// LOW:    (no postprocessing)

import {
  Bloom,
  ChromaticAberration,
  DepthOfField,
  EffectComposer,
  SMAA,
  Vignette,
} from '@react-three/postprocessing';
import { BlendFunction } from 'postprocessing';
import { Vector2 } from 'three';
import { useMemo } from 'react';
import { useSimCockpit } from '../SimCockpitContext';

export function PostFxStack() {
  const { qualityTier, reducedMotion } = useSimCockpit();
  const chromaticOffset = useMemo(() => new Vector2(0.0006, 0.0006), []);
  if (qualityTier === 'low' || reducedMotion) return <></>;

  return (
    <EffectComposer multisampling={0} enableNormalPass={false}>
      <SMAA />
      <Bloom intensity={0.55} luminanceThreshold={0.62} mipmapBlur radius={0.7} />
      <Vignette
        offset={0.35}
        darkness={0.55}
        eskil={false}
        blendFunction={BlendFunction.NORMAL}
      />
      {qualityTier === 'high' ? (
        <ChromaticAberration
          offset={chromaticOffset}
          radialModulation={false}
          modulationOffset={0}
        />
      ) : (
        <></>
      )}
      {qualityTier === 'high' ? (
        <DepthOfField focusDistance={0.015} focalLength={0.05} bokehScale={1.8} />
      ) : (
        <></>
      )}
    </EffectComposer>
  );
}
