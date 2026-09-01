import React from 'react';

// postflop mark: the spade from the workbench favicon (web/app/icon.svg),
// viewBox-normalized. The product renders it black on a filled yellow block;
// as a mono mark it is the spade alone in currentColor.
export const PostflopMark: React.FC<{size: number; color: string}> = ({size, color}) => (
  <svg viewBox="0 0 32 32" width={size} height={size} fill="none" style={{color}}>
    <path
      d="M16 4.5c-2.6 5-8.5 8.4-8.5 13.5 0 2.9 2.2 4.8 4.8 4.8 1.4 0 2.7-.6 3.7-1.7v3.4h-3.2v1.8h6.4v-1.8H16v-3.4c1 1.1 2.3 1.7 3.7 1.7 2.6 0 4.8-1.9 4.8-4.8 0-5.1-5.9-8.5-8.5-13.5z"
      fill="currentColor"
    />
  </svg>
);
