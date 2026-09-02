// The one place the postflop film's cut lives. Film.tsx, Root.tsx and every shot
// agent read these numbers; nothing re-derives a frame count locally.
//
// `from` values already account for OVERLAP: shot N+1 starts OVERLAP frames
// before shot N ends, so consecutive shots share an 8-frame handover during
// which the incoming shot fades/slides in on top of the outgoing one.

export type Shot = {id: string; from: number; len: number};

/** Frames two consecutive shots share; the incoming shot owns the handover. */
export const OVERLAP = 8;

/** Composition length in frames (28.0s @ 30fps). */
export const TOTAL = 840;

export const SHOTS: Shot[] = [
  {id: 'claim', from: 0, len: 84},
  {id: 'mark', from: 76, len: 84},
  {id: 'composer', from: 152, len: 150},
  {id: 'workbench', from: 294, len: 160},
  {id: 'convergence', from: 446, len: 130},
  {id: 'features', from: 568, len: 96},
  {id: 'browser', from: 656, len: 90},
  {id: 'end', from: 738, len: 102},
];
