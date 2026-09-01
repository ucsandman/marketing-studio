import React from 'react';
import type {Brand} from '../lib/brand';
import {loadBrandFonts} from '../lib/fonts';
import {easeInOutCubic} from '../lib/telemetry';

const IN_MS = 350;

export const Caption: React.FC<{
  label: string;
  brand: Brand;
  enteredMsAgo: number;
}> = ({label, brand, enteredMsAgo}) => {
  const fonts = loadBrandFonts(brand);
  // `ctaStyle: 'block'` brands forbid radius and any accent that is not a filled
  // block with ink text, so their caption chip squares off and its marker goes to
  // ink. Defaults to 'text' -> every other brand's caption is byte-identical.
  const block = brand.ctaStyle === 'block';
  const p = easeInOutCubic(Math.min(Math.max(enteredMsAgo / IN_MS, 0), 1));
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 16,
        padding: '18px 32px',
        borderRadius: block ? 0 : 12,
        background: `${brand.colors.surface}f2`,
        border: `1px solid ${brand.colors.line}`,
        opacity: p,
        transform: `translateY(${(1 - p) * 24}px)`,
      }}
    >
      <div
        style={{
          width: 8,
          height: 8,
          borderRadius: block ? 0 : 4,
          background: block ? brand.colors.ink : brand.colors.brand,
        }}
      />
      <div style={{fontFamily: fonts.body, fontWeight: 600, fontSize: 34, color: brand.colors.ink}}>
        {label}
      </div>
    </div>
  );
};
