import React from 'react';
import {getBrand} from '../lib/brand';

// practicalsystems mark: the hub-and-satellites logo. A central hexagon with two
// "eyes" (the watching hub) connected to six satellite hexagons (the agent
// fleet). Satellites and connectors take the caller's `color`; connectors run at
// reduced opacity to read as secondary, like the slate lines in the product logo.
//
// THE HUB IS DELIBERATELY NOT `color`. The shared mark contract is {size, color},
// so every template (AnimatedOG passes brand.colors.brand) renders a mark
// monochrome — which for this brand collapses its whole story. The identity is
// "one clear hub, many working agents", and an all-teal glyph has no hub at all:
// caught on the 2026-08-17 run by a compliance sweep and confirmed by an 8x pixel
// crop of the shipped og.png, the image every share of the site displays. The hub
// therefore reads the brand's own ink token, which is sanctioned (values come from
// brands/practicalsystems.json, never a literal hex) and leaves every other
// brand's mark untouched. Safe because this brand is dark-mode only.
const hexPath = (cx: number, cy: number, r: number): string => {
  // pointy-top hexagon: vertices at 90/150/210/270/330/30 degrees
  const pts = [90, 150, 210, 270, 330, 30].map((deg) => {
    const rad = (deg * Math.PI) / 180;
    return `${(cx + r * Math.cos(rad)).toFixed(3)} ${(cy - r * Math.sin(rad)).toFixed(3)}`;
  });
  return `M${pts.join(' L')} Z`;
};

const SATELLITE_ANGLES = [90, 30, 330, 270, 210, 150];
const SAT_DIST = 8.6;
const SAT_R = 2.0;
const HUB_R = 4.4;

export const PracticalSystemsMark: React.FC<{size: number; color: string}> = ({size, color}) => {
  const hub = getBrand('practicalsystems').colors.ink;
  return (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" style={{color}}>
    {/* connectors: hub edge to satellite edge */}
    {SATELLITE_ANGLES.map((deg) => {
      const rad = (deg * Math.PI) / 180;
      const x1 = 12 + (HUB_R + 0.7) * Math.cos(rad);
      const y1 = 12 - (HUB_R + 0.7) * Math.sin(rad);
      const x2 = 12 + (SAT_DIST - SAT_R - 0.4) * Math.cos(rad);
      const y2 = 12 - (SAT_DIST - SAT_R - 0.4) * Math.sin(rad);
      return (
        <path
          key={`c${deg}`}
          d={`M${x1.toFixed(3)} ${y1.toFixed(3)} L${x2.toFixed(3)} ${y2.toFixed(3)}`}
          stroke="currentColor"
          strokeWidth="1.1"
          strokeLinecap="round"
          opacity={0.5}
        />
      );
    })}
    {/* satellite hexagons */}
    {SATELLITE_ANGLES.map((deg) => {
      const rad = (deg * Math.PI) / 180;
      const cx = 12 + SAT_DIST * Math.cos(rad);
      const cy = 12 - SAT_DIST * Math.sin(rad);
      return <path key={`s${deg}`} d={hexPath(cx, cy, SAT_R)} fill="currentColor" />;
    })}
    {/* hub hexagon: brand ink, not currentColor — see the note above */}
    <path d={hexPath(12, 12, HUB_R)} stroke={hub} strokeWidth="1.4" strokeLinejoin="round" />
    {/* the hub's eyes */}
    <circle cx="10.7" cy="12" r="0.75" fill={hub} />
    <circle cx="13.3" cy="12" r="0.75" fill={hub} />
  </svg>
  );
};
