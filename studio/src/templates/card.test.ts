import {describe, expect, it} from 'vitest';
import {cardSchema, heroFontSize} from './Card';

describe('cardSchema', () => {
  it('fills every optional field so a bare {brandId} still renders a card', () => {
    expect(cardSchema.parse({brandId: 'sidetap'})).toEqual({
      brandId: 'sidetap',
      kind: 'stat',
      value: '',
      label: '',
      source: '',
      kicker: '',
      ctaUrl: null,
    });
  });

  it('accepts the builder payload including the matrix format overrides', () => {
    const parsed = cardSchema.parse({
      brandId: 'costclaw',
      kind: 'quote',
      value: 'Know the bill before the bill knows you',
      label: 'One line',
      source: 'README',
      kicker: 'costclaw',
      ctaUrl: null,
      formatWidth: 1080,
      formatHeight: 1350,
    });
    expect(parsed.kind).toBe('quote');
    expect(parsed.formatHeight).toBe(1350);
  });

  it('rejects a kind outside stat|quote', () => {
    expect(() => cardSchema.parse({brandId: 'sidetap', kind: 'chart'})).toThrow();
  });
});

describe('heroFontSize', () => {
  it('shrinks a stat figure as it gets longer, and keeps quotes far smaller', () => {
    expect(heroFontSize('31%', 'stat')).toBeGreaterThan(heroFontSize('1,240 hours', 'stat'));
    expect(heroFontSize('a'.repeat(120), 'quote')).toBeLessThan(heroFontSize('short', 'quote'));
    expect(heroFontSize('short', 'quote')).toBeLessThan(heroFontSize('31%', 'stat'));
  });
});
