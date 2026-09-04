import React from 'react';

// Truckside mark: a pickup in side view, bed left, cab right, two wheels.
// The product has no logo yet, so this is the mark: the truck is the business and
// the software rides in the passenger seat. All strokes in currentColor so it
// recolors from brand tokens; round joins match the product's soft UI.
export const TrucksideMark: React.FC<{size: number; color: string}> = ({size, color}) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" style={{color}}>
    {/* body: flat bed, cab with sloped windshield, short hood */}
    <path
      d="M2.6 15.4 V8.6 H12 V5.6 H16.2 L19.6 9.4 H21.4 V15.4"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    {/* cab window */}
    <path
      d="M13.6 8.6 V7.2 H15.6 L17.6 9.4"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    {/* chassis line between the wheels */}
    <path d="M9.2 15.4 H15.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    {/* wheels */}
    <circle cx="6.9" cy="16.4" r="2.1" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="17.5" cy="16.4" r="2.1" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);
