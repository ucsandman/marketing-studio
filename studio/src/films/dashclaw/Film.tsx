import React from 'react';
import {AbsoluteFill, Easing, Sequence, interpolate, useCurrentFrame} from 'remotion';
import {z} from 'zod';
import type {Brand} from '../../lib/brand';
import {getBrand} from '../../lib/brand';
import {FilmGrade} from '../../components/FilmGrade';
import {OVERLAP, SHOTS} from './timeline';
import {Shot01Hall} from './shots/Shot01Hall';
import {Shot02Agent} from './shots/Shot02Agent';
import {Shot03Reach} from './shots/Shot03Reach';
import {Shot04Intercept} from './shots/Shot04Intercept';
import {Shot05Release} from './shots/Shot05Release';
import {Shot06Ledger} from './shots/Shot06Ledger';
import {Shot07Wide} from './shots/Shot07Wide';

// The bespoke DashClaw film, NIGHT SHIFT. Not a template: no kicker, no caption
// strip, no FloatBar, no progress bar. Two grounds — the Unreal data hall (PNG
// plates) for the argument and rebuilt DashClaw UI for the evidence — and the
// freeze between them IS the transition.
//
// Film.tsx owns exactly three things: the ground, the cut, and the grade.
// Each shot is mounted in a <Sequence>, so its useCurrentFrame() is shot-local
// (0..len-1) and every frame the spec names is a plain `from + local` offset.
// Consecutive shots overlap by OVERLAP frames and the INCOMING shot owns the
// handover — it is later in the array, so it paints on top, and this file fades
// it in. Shots must therefore NOT fade themselves in and must NOT fade out; they
// hold their settled picture under the next arrival.
//
// `platesAvailable` is false by default so the composition renders on a clean
// clone with no Unreal output staged (see ui/Plate.tsx). The render command flips
// it: `--props='{"platesAvailable":true}'`.

export const dashclawFilmSchema = z.object({
  brandId: z.string().default('dashclaw'),
  /** True once studio/public/dashclaw/hall/ holds the staged PNG sequences. */
  platesAvailable: z.boolean().default(false),
  formatWidth: z.number().int().positive().optional(),
  formatHeight: z.number().int().positive().optional(),
});

type Props = z.infer<typeof dashclawFilmSchema>;

type ShotComponent = React.FC<{brand: Brand; len: number; plates: boolean}>;

const SHOT_COMPONENTS: Record<string, ShotComponent> = {
  hall: Shot01Hall,
  agent: Shot02Agent,
  reach: Shot03Reach,
  intercept: Shot04Intercept,
  release: Shot05Release,
  ledger: Shot06Ledger,
  wide: Shot07Wide,
};

const Handover: React.FC<{enter: boolean; children: React.ReactNode}> = ({enter, children}) => {
  const frame = useCurrentFrame();
  // A PURE dissolve — no slide. postflop's handover translates the incoming shot
  // 24px because its shots are paper compositions and a sheet arriving reads
  // right. Here the incoming ground is either a photographed 3D plate or a
  // full-bleed dark interface, and sliding either one reads as a deck
  // transition; the direction's whole claim is that the freeze is the
  // transition, so the cut has to be the picture changing and nothing else.
  //
  // inOut, NOT out: the incoming ground is OPAQUE, so its opacity ramp is also
  // the wipe that erases the outgoing shot. Easing.out is 58% done two frames
  // in, which blanks the settled outgoing picture before the incoming has drawn
  // anything. inOut holds the outgoing above 90% for the first two frames and
  // spends the wipe in the back half, by which time the incoming shot's own
  // beats are underway and something is always on screen.
  const p = enter
    ? interpolate(frame, [0, OVERLAP], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
        easing: Easing.inOut(Easing.cubic),
      })
    : 1;
  return <AbsoluteFill style={{opacity: p}}>{children}</AbsoluteFill>;
};

export const DashClawFilm: React.FC<Props> = ({brandId, platesAvailable}) => {
  const brand = getBrand(brandId);
  return (
    <AbsoluteFill style={{backgroundColor: brand.colors.bg}}>
      {SHOTS.map((shot, i) => {
        const Shot = SHOT_COMPONENTS[shot.id];
        if (!Shot) {
          throw new Error(`No shot component registered for "${shot.id}" (films/dashclaw/Film.tsx).`);
        }
        return (
          <Sequence key={shot.id} name={shot.id} from={shot.from} durationInFrames={shot.len}>
            <Handover enter={i > 0}>
              <Shot brand={brand} len={shot.len} plates={platesAvailable} />
            </Handover>
          </Sequence>
        );
      })}
      <FilmGrade grade={brand.grade} accent={brand.colors.brand} />
    </AbsoluteFill>
  );
};
