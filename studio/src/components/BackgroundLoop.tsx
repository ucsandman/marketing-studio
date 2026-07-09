import React from 'react';
import {AbsoluteFill} from 'remotion';
import {getBrand} from '../lib/brand';
import {PngSequence} from './PngSequence';

export const BackgroundLoop: React.FC<{
  dir: string | null;
  frameCount: number;
  opacity?: number;
}> = ({dir, frameCount, opacity = 1}) => {
  const brand = getBrand('noban');
  if (!dir) return <AbsoluteFill style={{backgroundColor: brand.colors.bg}} />;
  return (
    <AbsoluteFill style={{opacity}}>
      <PngSequence dir={dir} frameCount={frameCount} mode="loop" style={{width: '100%', height: '100%'}} />
    </AbsoluteFill>
  );
};
