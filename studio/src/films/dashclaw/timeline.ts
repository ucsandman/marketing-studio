// The one place the DashClaw film's cut lives. Film.tsx, Root.tsx,
// scripts/build-dashclaw-film-audio.mjs and every shot read these numbers;
// nothing re-derives a frame count locally.
//
// UNLIKE postflop's timeline, `from` is the shot's ABSOLUTE start from
// out/dashclaw/marketing/film-spec.md, untouched — the spec names film frames
// (the hold at 390, the click at 600, the release at 675, the lockup settled at
// 1140) and every one of them has to stay a plain `from + local` offset. The
// 8-frame handover is bought at the OTHER end instead: each shot but the last
// runs OVERLAP frames LONGER than its spec length, and the incoming shot starts
// on its own spec frame, on top of the outgoing shot's tail. Film.tsx fades the
// incoming shot in across those 8 frames, so the incoming ground is the wipe.
//
// The release plate mapping is the independent check on this: reach's frozen
// frame for 8 handover frames + the 150-frame release plate = 158 = 150 + OVERLAP.

export type Shot = {id: string; from: number; len: number};

/** Frames two consecutive shots share; the incoming shot owns the handover. */
export const OVERLAP = 8;

/** Composition length in frames (40.0s @ 30fps). */
export const TOTAL = 1200;

/** Film frame the world freezes on (HOLD 1); the hall timestamp stops here. */
export const HOLD_FRAME = 390;

/** Film frame the world starts moving again (shot 5, after its handover). */
export const RELEASE_FRAME = 668;

export const SHOTS: Shot[] = [
  {id: 'hall', from: 0, len: 158},
  {id: 'agent', from: 150, len: 188},
  {id: 'reach', from: 330, len: 128},
  {id: 'intercept', from: 450, len: 218},
  {id: 'release', from: 660, len: 158},
  {id: 'ledger', from: 810, len: 158},
  {id: 'wide', from: 960, len: 240},
];
