import {describe, expect, it} from 'vitest';
import {briefSchema} from './brief';

describe('briefSchema', () => {
  it('parses a full brief with every field populated', () => {
    const b = briefSchema.parse({
      brandId: 'synthacon',
      hook: {headline: 'CS2 skin arbitrage with guardrails', altHeadlines: ['Trade with a net']},
      features: [
        {
          key: 'guardrails',
          heading: 'Guardrails, enforced in the backend',
          benefitLines: ['Hard spend caps on every trade'],
          rationale: 'The differentiator vs unguarded bots',
          sourceRoute: '/governance',
        },
      ],
      positioning: {differentiator: 'Guardrails run server-side, not in the client'},
      cta: 'Join the beta at synthacon.com',
      narration: [{act: 'hook', text: 'synthacon dot com is gear near you'}],
      social: {
        x: {hook: 'Skin arbitrage', headline: 'with guardrails'},
        linkedin: null,
        vertical: null,
      },
    });
    expect(b.brandId).toBe('synthacon');
    expect(b.hook.headline).toBe('CS2 skin arbitrage with guardrails');
    expect(b.features[0].sourceRoute).toBe('/governance');
    expect(b.social?.x?.hook).toBe('Skin arbitrage');
  });

  it('fills sane defaults for a brandId-only brief', () => {
    // schema-level guarantee: a partial brief never breaks a downstream builder
    const b = briefSchema.parse({brandId: 'synthacon'});
    expect(b.hook).toEqual({headline: '', altHeadlines: []});
    expect(b.features).toEqual([]);
    expect(b.positioning).toBeNull();
    expect(b.cta).toBe('');
    expect(b.narration).toEqual([]);
    expect(b.social).toBeNull();
  });

  it('rejects a feature with more than three benefit lines', () => {
    expect(() =>
      briefSchema.parse({
        brandId: 'synthacon',
        features: [
          {
            key: 'k',
            heading: 'h',
            benefitLines: ['a', 'b', 'c', 'd'],
            rationale: 'r',
            sourceRoute: null,
          },
        ],
      }),
    ).toThrowError();
  });

  it('requires a non-empty brandId', () => {
    expect(() => briefSchema.parse({})).toThrowError();
    expect(() => briefSchema.parse({brandId: ''})).toThrowError();
  });
});
