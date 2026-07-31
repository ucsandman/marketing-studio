import React from 'react';

// CostClaw mark: three claw strokes catching a dollar coin, monochrome version of
// the product favicon (apps/site/public/favicon.svg). Claws are filled, the coin
// and its dollar sign are stroked, all in currentColor.
export const CostClawMark: React.FC<{size: number; color: string}> = ({size, color}) => (
  <svg viewBox="0 0 28 28" width={size} height={size} fill="none" style={{color}}>
    {/* The coin is stroked, not filled (single-color mark), so the claw tips that
        the filled favicon coin hides must be masked out behind the coin disc. */}
    <mask id="costclaw-coin-knockout">
      <rect x="-2" y="-2" width="32" height="32" fill="white" />
      <circle cx="14" cy="17.8" r="6.7" fill="black" />
    </mask>
    <circle cx="14" cy="17.8" r="6" stroke="currentColor" strokeWidth="1.5" />
    <path
      d="M14 15.2 L14 21.8"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
    />
    <path
      d="M15.9 16.6 C15.4 16 14.8 15.8 14 15.8 C13 15.8 12.25 16.35 12.25 17.15 C12.25 17.95 13.1 18.25 14 18.45 C14.9 18.65 15.75 18.95 15.75 19.8 C15.75 20.6 15 21.1 14 21.1 C13.15 21.1 12.5 20.85 12.05 20.3"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
    />
    <g mask="url(#costclaw-coin-knockout)">
      <path
        d="M4.4 3.4 C4.4 11 6.8 15.4 10.9 17.1 C8.2 14.4 6.8 10.4 6.8 3.4 A1.2 1.2 0 0 0 4.4 3.4 Z"
        fill="currentColor"
      />
      <path
        d="M12.9 2.6 C12.9 8.3 13.3 11.8 14 14.2 C14.7 11.8 15.1 8.3 15.1 2.6 A1.1 1.1 0 0 0 12.9 2.6 Z"
        fill="currentColor"
      />
      <path
        d="M23.6 3.4 C23.6 11 21.2 15.4 17.1 17.1 C19.8 14.4 21.2 10.4 21.2 3.4 A1.2 1.2 0 0 1 23.6 3.4 Z"
        fill="currentColor"
      />
    </g>
  </svg>
);
