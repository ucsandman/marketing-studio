import React from 'react';

// Off Localhost mark: a shell prompt caret with the cursor already blinking after
// it. The whole product is two commands typed into Claude Code, so the mark is the
// moment before you type. Strokes are currentColor so it recolors from brand
// tokens; the dot is filled because the cursor is the only solid thing here.
export const OffLocalhostMark: React.FC<{size: number; color: string}> = ({size, color}) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" style={{color}}>
    {/* prompt caret ">" */}
    <path
      d="M4.6 6.4 L11.2 12 L4.6 17.6"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    {/* cursor */}
    <circle cx="16.6" cy="12" r="2.6" fill="currentColor" />
  </svg>
);
