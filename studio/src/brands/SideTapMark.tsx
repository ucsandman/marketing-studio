import React from 'react';

// sidetap mark: an iPhone outline with a terminal prompt ">_" on its screen.
// Says "an agent drives this phone" in one glyph. All strokes in currentColor so
// the mark recolors from brand tokens; round caps match the product's soft UI.
export const SideTapMark: React.FC<{size: number; color: string}> = ({size, color}) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" style={{color}}>
    {/* phone body */}
    <rect
      x="6.4"
      y="2.2"
      width="11.2"
      height="19.6"
      rx="2.6"
      stroke="currentColor"
      strokeWidth="1.5"
    />
    {/* speaker slot */}
    <path
      d="M10.6 4.7 L13.4 4.7"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
    />
    {/* terminal caret ">" */}
    <path
      d="M9.4 10.2 L12 12.3 L9.4 14.4"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    {/* cursor underscore "_" */}
    <path
      d="M13.2 14.4 L15.4 14.4"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
    {/* home indicator */}
    <path
      d="M10.4 19.3 L13.6 19.3"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
    />
  </svg>
);
