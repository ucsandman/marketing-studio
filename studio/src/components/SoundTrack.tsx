import React from 'react';
import {Audio, Sequence, staticFile, useVideoConfig} from 'remotion';
import type {AudioManifest} from '../lib/audioMix';
import {duckedVolume, voWindows} from '../lib/audioMix';

export const SoundTrack: React.FC<{
  audio: AudioManifest;
  timing: Parameters<typeof voWindows>[1];
}> = ({audio, timing}) => {
  const {durationInFrames} = useVideoConfig();
  const windows = voWindows(audio.lines, timing);
  return (
    <>
      {audio.music ? (
        <Audio
          src={staticFile(audio.music.src)}
          volume={(f) => duckedVolume(f, windows, durationInFrames)}
        />
      ) : null}
      {windows.map((w, i) => (
        <Sequence key={i} from={w.fromFrame}>
          <Audio src={staticFile(w.src)} />
        </Sequence>
      ))}
    </>
  );
};
