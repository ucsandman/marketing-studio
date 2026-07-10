import React from 'react';
import {Html5Audio, Sequence, staticFile, useVideoConfig} from 'remotion';
import type {AudioManifest} from '../lib/audioMix';
import {duckedVolume, resolveSfxLayers, voWindows} from '../lib/audioMix';
import type {Motion} from '../lib/motion';
import {sfxCues} from '../lib/sfxCues';

export const SoundTrack: React.FC<{
  audio: AudioManifest;
  timing: Parameters<typeof voWindows>[1];
  // For the sound-design cue layer (only used when audio.sfx.enabled). Benefit-line
  // counts per feature drive the tick cues; motion aligns them to FeaturePanel stagger.
  featureLineCounts?: number[];
  motion?: Motion;
}> = ({audio, timing, featureLineCounts = [], motion}) => {
  const {durationInFrames} = useVideoConfig();
  const windows = voWindows(audio.lines, timing);
  // Gate on the manifest flag (set by the builder only when the sfx library is staged);
  // cue frames are derived here from launchTiming, never stored in the manifest.
  const sfxLayers =
    audio.sfx?.enabled && motion
      ? resolveSfxLayers(sfxCues(timing, featureLineCounts, motion), () => true)
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
        <Sequence key={i} from={w.fromFrame}>
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
