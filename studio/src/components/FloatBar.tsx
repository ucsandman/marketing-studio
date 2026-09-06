import React from 'react';
import type {Brand} from '../lib/brand';

// CS2 wear zones: FN 0-0.07, MW 0.07-0.15, FT 0.15-0.38, WW 0.38-0.45, BS 0.45-1.0
const ZONES = [0.07, 0.15, 0.38, 0.45];

export const floatBarGeometry = (progress: number, brand: Brand) => {
  if (brand.progressTreatment !== 'cs2-wear') return null;
  const marker = Math.max(0, Math.min(1, progress));
  return {marker, zones: ZONES};
};

export const FloatBar: React.FC<{
  progress: number; // 0..1
  brand: Brand;
  width: number;
  height?: number;
}> = ({progress, brand, width, height = 8}) => {
  const geometry = floatBarGeometry(progress, brand);
  if (!geometry) return null;

  const {marker, zones} = geometry;
  const {line, ink} = brand.colors;
  const fillFrom = brand.colors[brand.progressFill.from];
  const fillTo = brand.colors[brand.progressFill.to];
  return (
    <div style={{position: 'relative', width, height}}>
      {/* track */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: height / 2,
          background: `linear-gradient(to right, ${fillFrom}, ${fillTo})`,
          opacity: 0.25,
        }}
      />
      {/* fill (revealed portion at full opacity) */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          width: `${marker * 100}%`,
          overflow: 'hidden',
          borderRadius: height / 2,
        }}
      >
        <div
          style={{
            width,
            height,
            background: `linear-gradient(to right, ${fillFrom}, ${fillTo})`,
          }}
        />
      </div>
      {/* zone ticks */}
      {zones.map((z) => (
        <div
          key={z}
          style={{
            position: 'absolute',
            left: `${z * 100}%`,
            top: -2,
            width: 1.5,
            height: height + 4,
            background: line,
          }}
        />
      ))}
      {/* marker */}
      <div
        style={{
          position: 'absolute',
          left: `${marker * 100}%`,
          top: -6,
          transform: 'translateX(-50%)',
          width: 0,
          height: 0,
          borderLeft: '5px solid transparent',
          borderRight: '5px solid transparent',
          borderTop: `7px solid ${ink}`,
        }}
      />
    </div>
  );
};
