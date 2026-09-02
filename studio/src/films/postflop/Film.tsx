import React from 'react';
import {AbsoluteFill, Easing, Sequence, interpolate, useCurrentFrame} from 'remotion';
import {z} from 'zod';
import type {Brand} from '../../lib/brand';
import {getBrand} from '../../lib/brand';
import {FilmGrade} from '../../components/FilmGrade';
import {OVERLAP, SHOTS} from './timeline';
import {Shot01Claim} from './shots/Shot01Claim';
import {Shot02Mark} from './shots/Shot02Mark';
import {Shot03Composer} from './shots/Shot03Composer';
import {Shot04Workbench} from './shots/Shot04Workbench';
import {Shot05Convergence} from './shots/Shot05Convergence';
import {Shot06Features} from './shots/Shot06Features';
import {Shot07Browser} from './shots/Shot07Browser';
import {Shot08End} from './shots/Shot08End';

// The bespoke postflop film. Not a template: no kicker, no caption strip, no
// progress bar — the reference's density comes from the rebuilt product UI
// inside each shot, and any chrome on top of it reads as a slide deck.
//
// Film.tsx owns exactly three things: the ground, the cut, and the grade.
// Each shot is mounted in a <Sequence>, so its useCurrentFrame() is shot-local
// (0..len-1). Consecutive shots overlap by OVERLAP frames and the INCOMING shot
// owns the handover — it is later in the array, so it paints on top, and this
// file fades and settles it in. Shots must therefore NOT fade themselves in and
// must NOT fade out; they hold their last static frame under the next arrival.

export const postflopFilmSchema = z.object({
  brandId: z.string().default('postflop'),
  formatWidth: z.number().int().positive().optional(),
  formatHeight: z.number().int().positive().optional(),
});

type Props = z.infer<typeof postflopFilmSchema>;

type ShotComponent = React.FC<{brand: Brand; len: number}>;

const SHOT_COMPONENTS: Record<string, ShotComponent> = {
  claim: Shot01Claim,
  mark: Shot02Mark,
  composer: Shot03Composer,
  workbench: Shot04Workbench,
  convergence: Shot05Convergence,
  features: Shot06Features,
  browser: Shot07Browser,
  end: Shot08End,
};

const Handover: React.FC<{enter: boolean; children: React.ReactNode}> = ({enter, children}) => {
  const frame = useCurrentFrame();
  // inOut, NOT out: the incoming shot's ground is OPAQUE, so its opacity ramp is
  // also the wipe that erases the outgoing shot. Easing.out is 58% done two
  // frames in, which blanks the settled outgoing composition before the incoming
  // has drawn anything — the cut reads as a stumble through empty paper. inOut
  // holds the outgoing above 90% for the first two frames and spends the wipe in
  // the back half, by which time the incoming's own beats (local frame >= 2) are
  // underway and something is always on screen.
  const p = enter
    ? interpolate(frame, [0, OVERLAP], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
        easing: Easing.inOut(Easing.cubic),
      })
    : 1;
  return (
    <AbsoluteFill style={{opacity: p, transform: `translateY(${((1 - p) * 24).toFixed(2)}px)`}}>
      {children}
    </AbsoluteFill>
  );
};

export const PostflopFilm: React.FC<Props> = ({brandId}) => {
  const brand = getBrand(brandId);
  return (
    <AbsoluteFill style={{backgroundColor: brand.colors.bg}}>
      {SHOTS.map((shot, i) => {
        const Shot = SHOT_COMPONENTS[shot.id];
        if (!Shot) {
          throw new Error(`No shot component registered for "${shot.id}" (films/postflop/Film.tsx).`);
        }
        return (
          <Sequence key={shot.id} name={shot.id} from={shot.from} durationInFrames={shot.len}>
            <Handover enter={i > 0}>
              <Shot brand={brand} len={shot.len} />
            </Handover>
          </Sequence>
        );
      })}
      <FilmGrade grade={brand.grade} accent={brand.colors.brand} />
    </AbsoluteFill>
  );
};
