import React from 'react';

/**
 * Magnetic's mark: an M monogram whose two outer strokes bow like magnetic
 * field lines and converge on a downward playhead notch — the letterform and
 * the editor grammar fused. Derives from the product's one idea: clips snap
 * magnetically to the timeline spine. The notch is an open stroked chevron
 * nested above the valley (per the approval redline: one unified stroke
 * system, no fills) — pull-lines pointing at the snap point. Single-accent
 * discipline: the mark renders in whatever `color` the template passes.
 */
export const MagneticMark: React.FC<{size: number; color: string}> = ({size, color}) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" style={{color}}>
    <path
      d="M5 18.8 C4.6 12, 5 7.6, 6.4 6.9 L11.7 12.2"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M19 18.8 C19.4 12, 19 7.6, 17.6 6.9 L12.3 12.2"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M10.2 7.1 L12 8.9 L13.8 7.1"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
