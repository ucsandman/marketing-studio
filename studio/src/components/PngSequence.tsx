import React from 'react';
import {Img, staticFile, useCurrentFrame} from 'remotion';

export const PngSequence: React.FC<{
  dir: string;
  frameCount: number;
  mode: 'clamp' | 'loop';
  style?: React.CSSProperties;
}> = ({dir, frameCount, mode, style}) => {
  const frame = useCurrentFrame();
  const idx = mode === 'loop' ? (frame % frameCount) + 1 : Math.min(frame + 1, frameCount);
  return <Img src={staticFile(`${dir}/frame_${String(idx).padStart(4, '0')}.png`)} style={style} />;
};
