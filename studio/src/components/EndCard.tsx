import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import type {Brand} from '../lib/brand';
import {loadBrandFonts} from '../lib/fonts';
import {brandSpring} from '../lib/motion';
import {getMark} from '../brands/marks';
import {ctaSetting} from '../lib/typography';
import type {CtaCasing} from '../lib/typography';

// `command` is the optional runnable one-liner under the CTA. It renders verbatim in
// mono on a hairline chip (never uppercased — a shell command is case sensitive, so
// uppercasing it would print something that does not run). Absent for brands that
// have no command, which keeps their end card byte-identical.
//
// `casing` is the direction's typography casing. It defaults to 'upper', the treatment
// every existing brand renders, so their end cards stay byte-identical; a directed film
// that sets sentence casing gets its CTA back in the words the props hold.
export const EndCard: React.FC<{cta: string; brand: Brand; command?: string | null; casing?: CtaCasing}> = ({cta, brand, command, casing = 'upper'}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const fonts = loadBrandFonts(brand);
  const s = brandSpring(frame, fps, brand.motion);
  const Mark = getMark(brand.id);
  // `ctaStyle: 'block'` is a brand declaring that its accent is only ever a filled
  // block carrying ink text — never accent-coloured type or a coloured glyph. So it
  // governs the mark's colour here as well as the CTA, the way LogoReveal already
  // reads it for its own CTA. Every brand defaults to 'text', so their end cards are
  // byte-identical.
  const block = brand.ctaStyle === 'block';
  const setting = ctaSetting(cta, casing, fonts);
  return (
    <AbsoluteFill
      style={{justifyContent: 'center', alignItems: 'center', gap: 32, opacity: s, transform: `scale(${0.96 + s * 0.04})`}}
    >
      <Mark size={110} color={block ? brand.colors.ink : brand.colors.brand} />
      <div style={{fontFamily: fonts.display, fontWeight: 800, fontSize: 96, color: brand.colors.ink}}>
        {brand.name}
      </div>
      {/* Wide-tracked mono grows fast: without a bound a long CTA bleeds past
          both frame edges instead of wrapping inside the card. The bound holds for
          sentence casing too, which wraps rather than tracks. */}
      <div
        style={{
          fontFamily: setting.fontFamily,
          fontWeight: setting.fontWeight,
          fontSize: 34,
          letterSpacing: setting.letterSpacing,
          ...(block
            ? {backgroundColor: brand.colors.brand, color: brand.colors.ink, padding: '10px 24px'}
            : {color: brand.colors.profit}),
          maxWidth: '84%',
          textAlign: 'center',
        }}
      >
        {setting.text}
      </div>
      {command ? (
        <div
          style={{
            fontFamily: fonts.mono,
            fontSize: 34,
            color: brand.colors.ink2,
            background: brand.colors.surface2,
            border: `1px solid ${brand.colors.line}`,
            borderRadius: block ? 0 : 12,
            padding: '14px 28px',
          }}
        >
          {command}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
