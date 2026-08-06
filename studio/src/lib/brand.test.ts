import {describe, expect, it} from 'vitest';
import {brandSchema, getBrand, markColorOf} from './brand';

// A synthetic brand that omits every optional block, used to assert the schema's
// defaults independently of the one real brand in the registry.
const bare = {
  id: 'x',
  name: 'x',
  tagline: 'x',
  url: 'x',
  colors: getBrand('synthacon').colors,
  fonts: getBrand('synthacon').fonts,
  voice: 'x',
};

describe('getBrand', () => {
  it('loads the synthacon brand with validated tokens', () => {
    const b = getBrand('synthacon');
    expect(b.name).toBe('Synthacon');
    // canonical lockup: synthacon-marketing/content/synthacon-messaging.md
    expect(b.tagline).toBe('Gear near you, from people who play');
    // dark "Synthacon Lexicon" palette: violet primary, rich but never neon
    expect(b.colors.brand).toBe('#a090dc');
    expect(b.colors.bg).toBe('#0c0c0d');
    // green is success/online ONLY, red is error ONLY; palette is violet/white/black
    // only — no gold or yellow anywhere (profit is a light-violet CTA accent, not gold)
    expect(b.colors.safe).toBe('#4ade80');
    expect(b.colors.loss).toBe('#f06870');
    expect(b.colors.profit).toBe('#b8a8f0');
    expect(b.fonts.display).toBe('Plus Jakarta Sans');
    expect(b.fonts.mono).toBe('JetBrains Mono');
    // hero rule: dark gradient, never the bright violet wash — below engine default
    expect(b.effects.wash).toBeLessThan(0.165);
    // no glow effect on any asset (the animated S reveal's drop-shadow is
    // brand.effects.glow-driven; 0 means SynthaconReveal renders no filter at all)
    expect(b.effects.glow).toBe(0);
    // the S mark renders in ink (white), never the brand violet
    expect(b.markColor).toBe('ink');
    expect(markColorOf(b)).toBe(b.colors.ink);
    // no bloom accent either — FilmGrade's bloom layer is fully off
    expect(b.grade.bloom).toBe(0);
    // calm, confident motion for a peer-to-peer gear community
    expect(b.motion.exuberance).toBeLessThanOrEqual(0.3);
    expect(b.motion.textReveal).toBe('maskWipe');
    expect(b.light).toEqual({
      bg: '#f8f7f6',
      ink: '#181818',
      brand: '#3d17a0',
      outlineVariant: '#cdc5d5',
    });
  });

  it('leaves the light palette undefined for a brand that omits it', () => {
    expect(brandSchema.parse(bare).light).toBeUndefined();
  });

  it('rejects an incomplete explicit light palette', () => {
    expect(
      brandSchema.safeParse({
        ...bare,
        light: {bg: '#f8f7f6', ink: '#181818', brand: '#3d17a0'},
      }).success,
    ).toBe(false);
  });

  it('resolves markColorOf per brand.markColor (ink for synthacon, brand accent by default)', () => {
    const s = getBrand('synthacon');
    expect(markColorOf(s)).toBe(s.colors.ink);
    const parsed = brandSchema.parse(bare);
    expect(markColorOf(parsed)).toBe(parsed.colors.brand);
  });

  it('defaults markColor to "brand" when a brand omits the field (byte-identical mark color)', () => {
    expect(brandSchema.parse(bare).markColor).toBe('brand');
  });

  it('rejects hex colors that are not #rrggbb', () => {
    // schema-level guarantee: every color token matches /^#[0-9a-f]{6}$/i
    for (const v of Object.values(getBrand('synthacon').colors)) {
      expect(v).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('throws a loud error for unknown brand ids', () => {
    expect(() => getBrand('nope')).toThrow(/Unknown brand "nope"/);
  });

  it('applies restrained FilmGrade grade defaults when a brand omits the block', () => {
    expect(brandSchema.parse(bare).grade).toEqual({
      grain: 0.12,
      vignette: 0.18,
      bloom: 0.1,
      aberration: 0,
      letterbox: 0,
    });
  });

  it('keeps the synthacon grade restrained with no accent bloom', () => {
    // violet/white/black only, no glow, no bloom: every grade layer stays at or
    // below the engine defaults and the accent bloom is fully off.
    const g = getBrand('synthacon').grade;
    expect(g.bloom).toBe(0);
    expect(g.grain).toBeLessThanOrEqual(0.12);
    expect(g.vignette).toBeLessThanOrEqual(0.18);
    expect(g.aberration).toBe(0);
    expect(g.letterbox).toBe(0);
  });

  it('applies neutral motion defaults when a brand omits the block', () => {
    // A brand with no `motion` block must receive the calibrated defaults that
    // reproduce the prior smooth, no-overshoot entrance feel.
    expect(brandSchema.parse(bare).motion).toEqual({
      tempo: 1,
      exuberance: 0.35,
      stagger: 0.5,
      overshoot: 0.25,
      parallax: 0,
      settle: 0,
      textReveal: 'spring',
    });
  });

  it('defaults parallax and settle to 0 when a brand motion block omits them', () => {
    // A brand that provides tempo/exuberance/stagger/overshoot but no depth cues
    // must still get parallax 0 / settle 0 so its output stays a flat, hard cut.
    const parsed = brandSchema.parse({
      ...bare,
      motion: {tempo: 1, exuberance: 0.4, stagger: 0.5, overshoot: 0.2},
    });
    expect(parsed.motion.parallax).toBe(0);
    expect(parsed.motion.settle).toBe(0);
  });

  it('carries synthacon a motion personality on-voice with its rules', () => {
    // Peer-to-peer and unhurried: calmer than the engine default on every axis
    // that can read as hype, with real depth cues so flat comps still breathe.
    const m = getBrand('synthacon').motion;
    expect(m.exuberance).toBeLessThan(0.35);
    expect(m.overshoot).toBeLessThan(0.25);
    expect(m.parallax).toBeGreaterThan(0);
    expect(m.settle).toBeGreaterThan(0);
  });
});
