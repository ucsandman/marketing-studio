import React from 'react';

/**
 * The Synthacon "S": a single round-capped stroke with a patch-cable terminal
 * at each end, traced from the product's own apps/web/public/synthacon.svg
 * with the background plate dropped. Everything follows `color` (the app
 * icon's two-hue terminal dots are approximated with reduced-opacity inner
 * dots so the mark stays fully recolorable, per the MarkComponent contract).
 */
export const SynthaconMark: React.FC<{size: number; color: string}> = ({size, color}) => (
  <svg viewBox="0 0 400 400" width={size} height={size} fill="none" style={{color}}>
    {/* The inner terminal dots are punched through the artwork so the
        reduced-opacity redraw below tints against the composition's own
        background — two-tone at every color a template passes. */}
    <mask id="synthaconTerminals">
      <rect width="400" height="400" fill="white" />
      <circle cx="300" cy="95" r="20" fill="black" />
      <circle cx="114" cy="322" r="20" fill="black" />
    </mask>
    <g mask="url(#synthaconTerminals)">
      <path
        d="M 300,95 L 168,95 Q 112,95 112,152 Q 112,208 168,208 L 246,208 Q 302,208 302,265 Q 302,322 246,322 L 114,322"
        stroke="currentColor"
        strokeWidth="52"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="300" cy="95" r="37" fill="currentColor" />
      <circle cx="114" cy="322" r="37" fill="currentColor" />
    </g>
    <circle cx="300" cy="95" r="20" fill="currentColor" opacity="0.45" />
    <circle cx="114" cy="322" r="20" fill="currentColor" opacity="0.45" />
  </svg>
);
