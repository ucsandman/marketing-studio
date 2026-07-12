import {describe, expect, it} from 'vitest';
import {brandSchema, getBrand} from './brand';

describe('getBrand', () => {
  it('loads the noban brand with validated tokens', () => {
    const b = getBrand('noban');
    expect(b.name).toBe('noban.gg');
    expect(b.colors.brand).toBe('#8847ff');
    expect(b.colors.profit).toBe('#d6c23c');
    expect(b.fonts.display).toBe('Saira');
  });

  it('loads the dashclaw brand with validated tokens', () => {
    const b = getBrand('dashclaw');
    expect(b.name).toBe('DashClaw');
    expect(b.colors.brand).toBe('#f97316');
    expect(b.fonts.display).toBe('Inter');
    expect(b.fonts.mono).toBe('JetBrains Mono');
  });

  it('loads the synthacon brand with validated tokens', () => {
    const b = getBrand('synthacon');
    expect(b.name).toBe('Synthacon');
    // canonical lockup: synthacon-marketing/content/synthacon-messaging.md
    expect(b.tagline).toBe('Gear near you, from people who play');
    // dark "Synthacon Lexicon" palette: violet primary, rich but never neon
    expect(b.colors.brand).toBe('#a090dc');
    expect(b.colors.bg).toBe('#0c0c0d');
    // green is success/online ONLY, red is error ONLY, gold is the events accent
    expect(b.colors.safe).toBe('#4ade80');
    expect(b.colors.loss).toBe('#f06870');
    expect(b.colors.profit).toBe('#e6b53d');
    expect(b.fonts.display).toBe('Plus Jakarta Sans');
    expect(b.fonts.mono).toBe('JetBrains Mono');
    // hero rule: dark gradient, never the bright violet wash — below engine default
    expect(b.effects.wash).toBeLessThan(0.165);
    // calm, confident motion for a peer-to-peer gear community
    expect(b.motion.exuberance).toBeLessThanOrEqual(0.3);
    expect(b.motion.textReveal).toBe('maskWipe');
  });

  it('rejects hex colors that are not #rrggbb', () => {
    // schema-level guarantee: every color token matches /^#[0-9a-f]{6}$/i
    const b = getBrand('noban');
    for (const v of Object.values(b.colors)) {
      expect(v).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('throws a loud error for unknown brand ids', () => {
    expect(() => getBrand('nope')).toThrowError(/Unknown brand "nope"/);
  });

  it('applies restrained FilmGrade grade defaults when a brand omits the block', () => {
    // noban carries no `grade` block, so it must receive the zod defaults unchanged.
    expect(getBrand('noban').grade).toEqual({
      grain: 0.12,
      vignette: 0.18,
      bloom: 0.1,
      aberration: 0,
      letterbox: 0,
    });
  });

  it('keeps paperroute and dashclaw grade restrained with no accent bloom', () => {
    // One Green Rule / orange-is-signal: neither brand may have an accent-colored
    // bloom wash, and every grade layer stays at or below the defaults.
    for (const id of ['paperroute', 'dashclaw']) {
      const g = getBrand(id).grade;
      expect(g.bloom).toBe(0);
      expect(g.grain).toBeLessThanOrEqual(0.12);
      expect(g.vignette).toBeLessThanOrEqual(0.18);
      expect(g.aberration).toBe(0);
      expect(g.letterbox).toBe(0);
    }
  });

  it('applies neutral motion defaults when a brand omits the block', () => {
    // A brand with no `motion` block must receive the calibrated defaults that
    // reproduce the prior smooth, no-overshoot entrance feel.
    const parsed = brandSchema.parse({
      id: 'x',
      name: 'x',
      tagline: 'x',
      url: 'x',
      colors: getBrand('noban').colors,
      fonts: getBrand('noban').fonts,
      voice: 'x',
    });
    expect(parsed.motion).toEqual({
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
      id: 'x',
      name: 'x',
      tagline: 'x',
      url: 'x',
      colors: getBrand('noban').colors,
      fonts: getBrand('noban').fonts,
      motion: {tempo: 1, exuberance: 0.4, stagger: 0.5, overshoot: 0.2},
      voice: 'x',
    });
    expect(parsed.motion.parallax).toBe(0);
    expect(parsed.motion.settle).toBe(0);
  });

  it('carries each brand a motion personality on-voice with its rules', () => {
    // noban: terse/mechanical -> lowest exuberance, minimal overshoot, brisk tempo.
    const noban = getBrand('noban').motion;
    expect(noban.exuberance).toBeLessThan(0.2);
    expect(noban.overshoot).toBeLessThanOrEqual(0.1);
    expect(noban.tempo).toBeGreaterThan(1);

    // paperroute: springy but a quiet ledger -> most exuberant, slightly slower tempo.
    const paperroute = getBrand('paperroute').motion;
    expect(paperroute.exuberance).toBeGreaterThan(noban.exuberance);
    expect(paperroute.tempo).toBeLessThan(1);

    // dashclaw: confident/snappy -> quick tempo, wider stagger, restrained bounce.
    const dashclaw = getBrand('dashclaw').motion;
    expect(dashclaw.tempo).toBeGreaterThanOrEqual(1.15);
    expect(dashclaw.stagger).toBeGreaterThan(0.5);
    expect(dashclaw.exuberance).toBeLessThan(paperroute.exuberance);
  });
});
