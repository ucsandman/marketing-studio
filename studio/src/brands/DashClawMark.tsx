import React from 'react';

export const DashClawMark: React.FC<{size: number; color: string}> = ({size, color}) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" style={{color}}>
    <path
      d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"
      stroke="currentColor"
      strokeWidth="0.85"
      strokeLinejoin="round"
      strokeLinecap="round"
    />
    <path
      d="M9.75 8.3l0.7 7.8M11.95 8.3l0.7 7.8M14.15 8.3l0.7 7.8"
      stroke="currentColor"
      strokeWidth="0.85"
      strokeLinecap="round"
    />
  </svg>
);
