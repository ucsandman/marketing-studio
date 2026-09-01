import React from 'react';
import {AbsoluteFill} from 'remotion';
import {z} from 'zod';
import {getBrand} from '../lib/brand';
import {loadBrandFonts} from '../lib/fonts';
import {getMark} from '../brands/marks';
import {useFormat} from '../lib/layout';
import {FilmGrade} from '../components/FilmGrade';

// Static stat/quote cards: the one-frame social unit built straight from a
// brief's proof points (scripts/build-cards.mjs). Still-shaped like StoreTile
// (no motion, calculateMetadata reads {formatWidth, formatHeight} since this
// Remotion version has no --width/--height CLI flags) but carrying AnimatedOG's
// product chrome: mark + kicker, hero line in the display face, footer with the
// brand url and the receipt. Every color comes from getBrand — a card that
// invents a color is a card that stops being the brand.
export const cardSchema = z.object({
  brandId: z.string(),
  kind: z.enum(['stat', 'quote']).default('stat'),
  // The hero line. On a stat card it is the figure ("31%", "1.4s"); on a quote
  // card it is the quoted line itself. One hero slot, two voices.
  value: z.string().default(''),
  // One supporting line under the hero.
  label: z.string().default(''),
  // The receipt. Printed verbatim in the footer: an unsourced number is
  // fabrication (brief.ts proofPoints), so the source travels with the card.
  source: z.string().default(''),
  kicker: z.string().default(''),
  // Overrides the footer url; null falls back to brand.url.
  ctaUrl: z.string().nullable().default(null),
  formatWidth: z.number().int().positive().optional(),
  formatHeight: z.number().int().positive().optional(),
});

type Props = z.infer<typeof cardSchema>;

// Type sizes are tuned at the 1080px card width; other widths scale
// proportionally so the hero never overflows the canvas.
const REFERENCE_WIDTH = 1080;

/** Hero type size at the reference width: long copy gets smaller, not clipped. */
export const heroFontSize = (text: string, kind: Props['kind']): number => {
  if (kind === 'stat') return text.length <= 4 ? 300 : text.length <= 8 ? 216 : 148;
  return text.length <= 60 ? 84 : text.length <= 110 ? 64 : 50;
};

export const Card: React.FC<Props> = ({brandId, kind, value, label, source, kicker, ctaUrl}) => {
  const {width, safe} = useFormat();
  const scale = width / REFERENCE_WIDTH;
  const brand = getBrand(brandId);
  const fonts = loadBrandFonts(brand);
  const Mark = getMark(brand.id);
  const hero = kind === 'quote' ? `“${value}”` : value;
  return (
    <AbsoluteFill style={{backgroundColor: brand.colors.bg}}>
      <AbsoluteFill
        style={{
          paddingTop: safe.top,
          paddingRight: safe.right,
          paddingBottom: safe.bottom,
          paddingLeft: safe.left,
          justifyContent: 'space-between',
        }}
      >
        <div style={{display: 'flex', alignItems: 'center', gap: 16 * scale}}>
          <Mark size={44 * scale} color={brand.colors.brand} />
          {kicker ? (
            <div
              style={{
                fontFamily: fonts.mono,
                fontSize: 22 * scale,
                letterSpacing: '0.22em',
                color: brand.colors.ink2,
              }}
            >
              {kicker.toUpperCase()}
            </div>
          ) : null}
        </div>
        <div style={{display: 'flex', flexDirection: 'column', gap: 24 * scale}}>
          <div
            style={{
              fontFamily: fonts.display,
              fontWeight: kind === 'stat' ? 800 : 700,
              fontSize: heroFontSize(value, kind) * scale,
              lineHeight: 1.04,
              color: kind === 'stat' ? brand.colors[brand.textAccent] : brand.colors.ink,
            }}
          >
            {hero}
          </div>
          {label ? (
            <div style={{fontFamily: fonts.body, fontSize: 34 * scale, color: brand.colors.ink2}}>
              {label}
            </div>
          ) : null}
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            gap: 24 * scale,
            borderTop: `1px solid ${brand.colors.line}`,
            paddingTop: 22 * scale,
            fontFamily: fonts.mono,
            fontSize: 20 * scale,
          }}
        >
          <div style={{color: brand.colors.ink2}}>{ctaUrl ?? brand.url}</div>
          {source ? (
            <div style={{color: brand.colors.ink3, textAlign: 'right'}}>{source}</div>
          ) : null}
        </div>
      </AbsoluteFill>
      <FilmGrade grade={brand.grade} accent={brand.colors.brand} />
    </AbsoluteFill>
  );
};
