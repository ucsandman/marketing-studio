import React from 'react';
import {AbsoluteFill} from 'remotion';
import type {Brand} from '../lib/brand';
import {PngSequence} from './PngSequence';

export const BackgroundLoop: React.FC<{
  dir: string | null;
  frameCount: number;
  brand: Brand;
  opacity?: number;
}> = ({dir, frameCount, brand, opacity = 1}) => {
  if (!dir) return <AbsoluteFill style={{backgroundColor: brand.colors.bg}} />;
  return (
    <AbsoluteFill style={{opacity}}>
      <PngSequence dir={dir} frameCount={frameCount} mode="loop" style={{width: '100%', height: '100%'}} />
    </AbsoluteFill>
  );
};
