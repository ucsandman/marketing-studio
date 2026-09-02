import {describe, expect, it} from 'vitest';
import {getMark} from '../brands/marks';
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

  it('loads the offlocalhost brand with validated tokens', () => {
    const b = getBrand('offlocalhost');
    expect(b.name).toBe('Off Localhost');
    // Green is the only accent: brand, profit and safe are the same hex because
    // the voice gives green exactly one meaning (live/done). Orange is the hoop.
    expect(b.colors.brand).toBe('#0b7a4b');
    expect(b.colors.safe).toBe('#0b7a4b');
    expect(b.colors.loss).toBe('#c2410c');
    expect(b.fonts.display).toBe('IBM Plex Sans');
    expect(b.fonts.mono).toBe('IBM Plex Mono');
    // No purple anywhere, including the slot the schema only needs filled.
    expect(b.colors.rare).toBe('#5aa88a');
    // Paper-white ground with no bloom: the voice forbids a hero wash.
    expect(b.effects).toEqual({wash: 0, glow: 0});
    expect(b.grade.bloom).toBe(0);
    // A brand is only usable once BOTH registries know it: getBrand parses the
    // tokens, getMark resolves the glyph. The second half was untested.
    expect(typeof getMark('offlocalhost')).toBe('function');
  });

  it('rejects hex colors that are not #rrggbb', () => {
    // schema-level guarantee: every color token matches /^#[0-9a-f]{6}$/i
    const b = getBrand('noban');
    for (const v of Object.values(b.colors)) {
      expect(v).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('preserves speechHint, the field judge-audio primes the transcriber with', () => {
    // Before this was declared, zod's key stripping dropped it from getBrand()
    // entirely — judge-audio only saw it because it re-reads the raw JSON. A
    // brand could set it and any schema-based consumer would never know.
    expect(getBrand('sidetap').speechHint).toBe('SideTap');
    // Brands whose name transcribes fine omit it; judge-audio falls back to name.
    expect(getBrand('noban').speechHint).toBeUndefined();
  });

  it('rejects an empty speechHint rather than priming with a blank word', () => {
    const base = {...(getBrand('noban') as unknown as Record<string, unknown>), speechHint: ''};
    expect(() => brandSchema.parse(base)).toThrow();
  });

  it('throws a loud error for unknown brand ids', () => {
    expect(() => getBrand('nope')).toThrowError(/Unknown brand "nope"/);
  });

  it('applies restrained FilmGrade grade defaults when a brand omits the block', () => {
    // Asserted against the SCHEMA, not against whichever brand happens to omit
    // the block today: every brand currently sets one, so pinning this to a brand
    // id made the test a hostage to a config choice rather than a check on the
    // default.
    const noGrade: Record<string, unknown> = {...getBrand('noban')};
    delete noGrade.grade;
    expect(brandSchema.parse(noGrade).grade).toEqual({
      grain: 0.12,
      grainSize: 0.8,
      halation: 0,
      vignette: 0.18,
      bloom: 0.1,
      aberration: 0,
      letterbox: 0,
    });
  });

  it('defaults grainSize to the value grain was hardcoded to, and halation off', () => {
    // grainSize 0.8 is the exact feTurbulence baseFrequency FilmGrade used before
    // the token existed, so every brand omitting it renders byte-identically at
    // 1080p. halation defaults OFF because it is opt-in production value, not a
    // change every existing asset should silently acquire.
    for (const id of ['dashclaw', 'paperroute', 'magnetic', 'costclaw', 'sidetap', 'tenwords']) {
      expect(getBrand(id).grade.grainSize).toBe(0.8);
      expect(getBrand(id).grade.halation).toBe(0);
    }
  });

  it('keeps noban’s opted-in halation inside the judged ceiling', () => {
    // noban is the one brand that turns halation on. 0.22 was chosen against a
    // rendered frame: 0.55 grew a neon halo on the wordmark, which its voice
    // ("instrument-grade ... Not esports-neon") forbids. judge-motion warns above
    // 0.35, so this asserts the shipped value stays on the right side of the gate.
    expect(getBrand('noban').grade.halation).toBe(0.22);
    expect(getBrand('noban').grade.halation).toBeLessThanOrEqual(0.35);
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
      // Halation blooms whatever is bright in the frame, which for these two
      // brands is their accent by construction — paperroute's One Green Rule
      // forbids a green hero wash and dashclaw's orange is signal, never
      // decoration. Neither may ever turn halation on.
      expect(g.halation).toBe(0);
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
