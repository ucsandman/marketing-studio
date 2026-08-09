import React from 'react';

/**
 * TenWords' mark is the pilcrow itself (favicon, extension icon, the ¶
 * prefix on every condensed line). Drawn geometrically: a filled half-disc
 * bowl on the left, two stems, and a top bar that carries past the right
 * stem, so it reads as ¶ at any size without depending on a font.
 */
export const TenwordsMark: React.FC<{size: number; color: string}> = ({size, color}) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" style={{color}}>
    <path d="M12.7 2.85 A5.1 5.1 0 0 0 12.7 13 Z" fill="currentColor" />
    <path
      d="M12 3.6 V20.4 M16.4 3.6 V20.4 M12 3.6 H18.2"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  </svg>
);
