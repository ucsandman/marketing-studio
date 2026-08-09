import React from 'react';
import {AbsoluteFill, useVideoConfig} from 'remotion';
import {z} from 'zod';
import {getBrand} from '../lib/brand';
import {loadBrandFonts} from '../lib/fonts';
import {getMark} from '../brands/marks';
import {FilmGrade} from '../components/FilmGrade';

// Chrome Web Store promo tiles: argument-ground statics matching the
// AnimatedOG look (paper ground, pilcrow mark, serif wordmark) but a
// dedicated template because store tiles carry none of AnimatedOG's
// product-OG chrome (no CTA, no command, no FloatBar, no background loop) —
// tile-small (440x280) is mark+wordmark only per the store's tiny canvas,
// tile-marquee (1400x560) adds the tagline. calculateMetadata reads
// {formatWidth, formatHeight} the same way LaunchVideo/SocialClip do
// (render-matrix.mjs pattern) since this Remotion version has no
// --width/--height CLI flags.
export const storeTileSchema = z.object({
  brandId: z.string(),
  tagline: z.string().nullable().default(null),
  // Extra multiplier on top of the width-proportional scale, for tiles with
  // no tagline competing for room (the small tile) where the mark+wordmark
  // can fill more of the frame without crowding it.
  density: z.number().positive().default(1),
  formatWidth: z.number().int().positive().optional(),
  formatHeight: z.number().int().positive().optional(),
});

type Props = z.infer<typeof storeTileSchema>;

// Reference sizes tuned at the 1400px marquee width; other tile widths
// (the 440px small tile) scale proportionally so the wordmark always fits
// the canvas instead of overflowing it.
const REFERENCE_WIDTH = 1400;

export const StoreTile: React.FC<Props> = ({brandId, tagline, density}) => {
  const {width} = useVideoConfig();
  const scale = (width / REFERENCE_WIDTH) * density;
  const brand = getBrand(brandId);
  const fonts = loadBrandFonts(brand);
  const Mark = getMark(brand.id);
  return (
    <AbsoluteFill style={{backgroundColor: brand.colors.bg}}>
      <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center', gap: 22 * scale}}>
        <div style={{display: 'flex', alignItems: 'center', gap: 22 * scale}}>
          <Mark size={72 * scale} color={brand.colors.brand} />
          <div
            style={{fontFamily: fonts.display, fontWeight: 700, fontSize: 76 * scale, color: brand.colors.ink}}
          >
            {brand.name}
          </div>
        </div>
        {tagline ? (
          <div style={{fontFamily: fonts.body, fontSize: 30 * scale, color: brand.colors.ink2}}>{tagline}</div>
        ) : null}
      </AbsoluteFill>
      <FilmGrade grade={brand.grade} accent={brand.colors.brand} />
    </AbsoluteFill>
  );
};
