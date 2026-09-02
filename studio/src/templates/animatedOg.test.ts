import {describe, expect, it} from 'vitest';
import {animatedOgSchema, markFor} from './AnimatedOG';

const teaserBrand = {
  id: 'revefi',
  name: 'Revefi',
  tagline: 'AI DBA for your data platform',
  url: 'revefi.com',
  colors: {
    bg: '#0e1014',
    surface: '#16181d',
    surface2: '#1d2026',
    line: '#2a2d34',
    ink: '#fafafa',
    ink2: '#c4c6c9',
    ink3: '#8e9196',
    brand: '#3b82f6',
    profit: '#7aa9f8',
    safe: '#22c55e',
    loss: '#ef4444',
    info: '#3b82f6',
    rare: '#eab308',
  },
  fonts: {display: 'Inter', body: 'Inter', mono: 'JetBrains Mono'},
  effects: {wash: 0.14, glow: 0.3},
  voice: 'Teaser lane.',
};

describe('markFor', () => {
  it('returns a registered mark for a registry brand with no logo', () => {
    expect(markFor('noban', null, null)).toBeTypeOf('function');
  });

  it('skips the registry lookup when a logo image is supplied', () => {
    expect(markFor('noban', 'teasers/noban/logo.svg', null)).toBeNull();
  });

  // getMark THROWS for an unregistered id, so the `Mark ? ... : null` guard in the
  // component was unreachable: the teaser lane crashed at lookup time instead.
  it('skips the registry lookup for a teaser brand that has no registry entry', () => {
    const props = animatedOgSchema.parse({
      brandId: 'revefi',
      tagline: 'AI DBA',
      cta: 'revefi.com',
      heroImage: null,
      loopSequence: null,
      loopFrames: 240,
      brandOverride: teaserBrand,
    });
    // Schema-valid: brandOverride and logoImage are independently nullable.
    expect(props.logoImage).toBeNull();
    expect(() => markFor(props.brandId, props.logoImage, props.brandOverride)).not.toThrow();
    expect(markFor(props.brandId, props.logoImage, props.brandOverride)).toBeNull();
  });
});
