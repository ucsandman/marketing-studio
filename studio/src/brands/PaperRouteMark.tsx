import React from 'react';

/**
 * PaperRoute has no drawn logo in the product (the web mark is the lowercase
 * wordmark with an accent underscore cursor). This glyph derives from the
 * landing hero's own motif: a desktop frame, the dash-measured sponsor slot
 * in the corner nobody was using, and the earning underscore beneath.
 */
export const PaperRouteMark: React.FC<{size: number; color: string}> = ({size, color}) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" style={{color}}>
    <rect
      x="2.5"
      y="3.5"
      width="19"
      height="13.5"
      rx="1.8"
      stroke="currentColor"
      strokeWidth="1.1"
    />
    <rect
      x="12.6"
      y="9.2"
      width="6.4"
      height="5.1"
      rx="0.9"
      stroke="currentColor"
      strokeWidth="0.85"
      strokeDasharray="1.6 1.15"
    />
    <rect x="14" y="10.5" width="3.6" height="2.5" rx="0.5" fill="currentColor" />
    <path d="M8.5 20.8h7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);
