import {describe, expect, it} from 'vitest';
import {briefSchema} from './brief';

describe('briefSchema', () => {
  it('parses a full brief with every field populated', () => {
    const b = briefSchema.parse({
      brandId: 'noban',
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
      audience: {who: 'CS2 skin traders running manual arbitrage', painPoints: ['One bad trade wipes a week of profit']},
      customerLanguage: {use: ['float', 'pattern index'], avoid: ['synergy']},
      objections: [{objection: 'Bots get banned', response: 'Guardrails keep every trade inside marketplace rules'}],
      switchingForces: {
        push: 'Manual price-checking eats hours',
        pull: 'Hard spend caps enforced server-side',
        habit: 'Spreadsheet workflow feels safe',
        anxiety: 'Handing a bot wallet access',
      },
      proofPoints: [{claim: 'Backtested on 90 days of market data', source: 'README quickstart section'}],
      cta: 'Simulate free at noban.gg',
      narration: [{act: 'hook', text: 'noban dot gg gives you guardrails'}],
      social: {
        x: {hook: 'Skin arbitrage', headline: 'with guardrails'},
        linkedin: null,
        vertical: null,
      },
    });
    expect(b.brandId).toBe('noban');
    expect(b.hook.headline).toBe('CS2 skin arbitrage with guardrails');
    expect(b.features[0].sourceRoute).toBe('/governance');
    expect(b.social?.x?.hook).toBe('Skin arbitrage');
    expect(b.audience?.painPoints).toHaveLength(1);
    expect(b.customerLanguage.use).toContain('float');
    expect(b.objections[0].response).toMatch(/marketplace rules/);
    expect(b.switchingForces?.anxiety).toMatch(/wallet access/);
    expect(b.proofPoints[0].source).toBe('README quickstart section');
  });

  it('fills sane defaults for a brandId-only brief', () => {
    // schema-level guarantee: a partial brief never breaks a downstream builder
    const b = briefSchema.parse({brandId: 'noban'});
    expect(b.hook).toEqual({headline: '', altHeadlines: []});
    expect(b.features).toEqual([]);
    expect(b.positioning).toBeNull();
    expect(b.cta).toBe('');
    expect(b.narration).toEqual([]);
    expect(b.social).toBeNull();
    expect(b.audience).toBeNull();
    expect(b.customerLanguage).toEqual({use: [], avoid: []});
    expect(b.objections).toEqual([]);
    expect(b.switchingForces).toBeNull();
    expect(b.proofPoints).toEqual([]);
  });

  it('rejects a proof point with an empty source (unsourced claims are fabrication)', () => {
    expect(() =>
      briefSchema.parse({
        brandId: 'noban',
        proofPoints: [{claim: '10x faster', source: ''}],
      }),
    ).toThrowError();
  });

  it('rejects a feature with more than three benefit lines', () => {
    expect(() =>
      briefSchema.parse({
        brandId: 'noban',
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
