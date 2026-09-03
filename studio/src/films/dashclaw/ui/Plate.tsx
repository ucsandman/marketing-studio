import React from 'react';
import {AbsoluteFill, Img, staticFile, useCurrentFrame} from 'remotion';
import type {Brand} from '../../../lib/brand';
import {OVERLAP} from '../timeline';

// The hall ground. Every 3D frame in this film is an Unreal PNG plate staged to
// studio/public/dashclaw/hall/, drawn one <Img> per frame — never a video
// element, so a rendered frame is always the plate frame the timeline asked for
// (PLAYBOOK: "PNG sequences ... Img per frame").
//
// Two things live here rather than in the shots:
//
// 1. THE FREEZE. The film's signature move is the world stopping while the
//    interface decides, and a freeze is the PLATE holding one frame — the UI on
//    top never freezes. `reach` clamps at plate frame 60 (film frame 390, HOLD 1)
//    and `release` opens on that same frozen frame for the 8 handover frames
//    before its own plate starts, so the cut at film 660 lands on the picture
//    shot 3 left frozen and the world resumes from it.
// 2. THE PLACEHOLDER. Every plate is nullable: the sequences are rendered by a
//    separate feeder run and are gitignored build products, so on a clean clone
//    they are simply absent. `available` false draws a brand-surface rectangle
//    carrying the plate it stands in for instead of letting <Img> throw, which
//    is what keeps `node scripts/smoke.mjs` green without the plates.
//
// NOTE ON NUMBERING: this sequence is 0-INDEXED (frame_0000.png is the first
// frame), unlike components/PngSequence.tsx's 1-indexed Blender output. That is
// why the film carries its own plate component instead of mounting PngSequence.

export type PlateShot = 'hall' | 'agent' | 'reach' | 'release' | 'wide';

/** Frames the feeder renders per shot; the plate index never exceeds count - 1. */
export const PLATE_FRAMES: Record<PlateShot, number> = {
  hall: 150,
  agent: 180,
  reach: 120,
  release: 150,
  wide: 240,
};

/** Subdirectory under studio/public/dashclaw/hall/ ("" is the hall itself). */
const PLATE_DIR: Record<PlateShot, string> = {
  hall: '',
  agent: 'agent/',
  reach: 'reach/',
  release: 'release/',
  wide: 'wide/',
};

/** Plate frame the world stops on in shot 3 — film frame 390, HOLD 1. */
export const REACH_FREEZE = 60;

const clamp = (v: number, hi: number): number => Math.min(Math.max(v, 0), hi);

/**
 * Which PNG a shot-local frame draws. Pure so the freeze arithmetic can be read
 * in one place instead of being spread across two shots that must agree.
 */
export const plateSource = (shot: PlateShot, frame: number): {dir: PlateShot; n: number} => {
  if (shot === 'reach') {
    // The world stops at 60 and stays stopped for the rest of the shot: the
    // camera, the fog and the light all hold while the inbox decides.
    return {dir: 'reach', n: clamp(Math.min(frame, REACH_FREEZE), PLATE_FRAMES.reach - 1)};
  }
  if (shot === 'release') {
    // Handover: the first OVERLAP frames re-serve shot 3's frozen frame, so the
    // ledger-side cut at 660 is invisible and the release plate starts from the
    // exact picture the film has been holding since 390.
    return frame < OVERLAP
      ? {dir: 'reach', n: REACH_FREEZE}
      : {dir: 'release', n: clamp(frame - OVERLAP, PLATE_FRAMES.release - 1)};
  }
  return {dir: shot, n: clamp(frame, PLATE_FRAMES[shot] - 1)};
};

export const platePath = (dir: PlateShot, n: number): string =>
  `dashclaw/hall/${PLATE_DIR[dir]}frame_${String(n).padStart(4, '0')}.png`;

export type PlateProps = {
  brand: Brand;
  mono: string;
  shot: PlateShot;
  /** False (the default) draws the placeholder instead of loading a PNG. */
  available?: boolean;
  /** Shot-local frame override; defaults to the mounted sequence's own frame. */
  frame?: number;
  style?: React.CSSProperties;
};

export const Plate: React.FC<PlateProps> = ({brand, mono, shot, available = false, frame, style}) => {
  const local = useCurrentFrame();
  const {dir, n} = plateSource(shot, frame ?? local);
  if (!available) {
    return (
      <AbsoluteFill
        style={{
          backgroundColor: brand.colors.surface,
          alignItems: 'center',
          justifyContent: 'center',
          ...style,
        }}
      >
        <span
          style={{
            fontFamily: mono,
            fontWeight: 500,
            fontSize: 30,
            letterSpacing: 4,
            fontVariantNumeric: 'tabular-nums',
            color: brand.colors.ink3,
          }}
        >
          {/* `dir`, not `shot`: during the release handover the shot is
              `release` but the PNG it stands in for is reach's frozen frame,
              and a placeholder that names the wrong sequence is worse than no
              placeholder — it makes the freeze contract unreadable on a
              contact sheet. */}
          {`plate ${dir} f${n}`}
        </span>
      </AbsoluteFill>
    );
  }
  return (
    <Img
      src={staticFile(platePath(dir, n))}
      style={{position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', ...style}}
    />
  );
};
