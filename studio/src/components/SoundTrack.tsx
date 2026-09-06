import React from 'react';
import {Html5Audio, Sequence, staticFile, useVideoConfig} from 'remotion';
import type {AudioManifest} from '../lib/audioMix';
import {duckedVolume, resolveSfxLayers, timingFromShots, voWindows} from '../lib/audioMix';
import type {Motion} from '../lib/motion';
import {pictureEventCues, sfxCues, type AudioShot, type SfxCue} from '../lib/sfxCues';

export const SoundTrack: React.FC<{
  audio: AudioManifest;
  timing: Parameters<typeof voWindows>[1];
  // For the sound-design cue layer (only used when audio.sfx.enabled). Benefit-line
  // counts per feature drive the tick cues; motion aligns them to FeaturePanel stagger.
  featureLineCounts?: number[];
  // Measured act-local benefit reveal frames. When present, SFX ticks share the
  // exact cue table used by FeaturePanel instead of re-running its stagger formula.
  featureCueFrames?: (number | null)[][];
  motion?: Motion;
  // New shot-plan path. Stable ids remap narration after reordering; cues come only
  // from explicit shot audio events, never automatically from every cut.
  shots?: AudioShot[];
  // Quiet-register override: when set, these cues replace sfxCues()'s whoosh/tick/
  // riser table wholesale (still gated on audio.sfx.enabled below). A brand whose
  // direction forbids hard-cut transitions passes its own cues (e.g. foldCues());
  // every brand that doesn't pass this renders through the unchanged default path.
  cueOverride?: SfxCue[];
}> = ({audio, timing, featureLineCounts = [], featureCueFrames, motion, shots, cueOverride}) => {
  const {durationInFrames} = useVideoConfig();
  const resolvedTiming = shots ? timingFromShots(shots, audio.lines.map((line) => line.act)) : timing;
  const windows = voWindows(audio.lines, resolvedTiming);
  // Gate on the manifest flag (set by the builder only when the sfx library is staged);
  // cue frames are derived here from launchTiming, never stored in the manifest.
  const sfxLayers =
    audio.sfx?.enabled && motion
      ? resolveSfxLayers(
          cueOverride ??
            (shots
              ? pictureEventCues(shots)
              : sfxCues(resolvedTiming, featureLineCounts, motion, featureCueFrames)),
          () => true,
        )
      : [];
  return (
    <>
      {audio.music ? (
        <Html5Audio
          src={staticFile(audio.music.src)}
          volume={(f) => duckedVolume(f, windows, durationInFrames)}
        />
      ) : null}
      {windows.map((w, i) => (
        <Sequence key={i} from={w.fromFrame} durationInFrames={w.toFrame - w.fromFrame}>
          <Html5Audio src={staticFile(w.src)} />
        </Sequence>
      ))}
      {sfxLayers.map((layer, i) => (
        <Sequence key={`sfx-${i}`} from={layer.frame}>
          <Html5Audio src={staticFile(layer.src)} volume={() => layer.volume} />
        </Sequence>
      ))}
    </>
  );
};
