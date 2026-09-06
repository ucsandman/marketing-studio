import {describe, expect, it} from 'vitest';
import {formatFor} from './layout';
import {ctaSetting, headlineLayout, headlineLineWidth} from './typography';

describe('headlineLayout', () => {
  it('preserves intentional line breaks', () => {
    const layout = headlineLayout('Govern every action\nBefore it runs', formatFor(1920, 1080));
    expect(layout.lines).toEqual(['Govern every action', 'Before it runs']);
  });

  it('balances portrait copy without a one-word orphan', () => {
    const layout = headlineLayout(
      'Measured controls for every consequential agent action',
      formatFor(1080, 1920),
    );
    expect(layout.lines.length).toBeGreaterThan(1);
    expect(layout.lines[layout.lines.length - 1]?.split(' ').length).toBeGreaterThan(1);
    expect(layout.lines.every((line) => headlineLineWidth(line, layout) <= layout.contentWidth + 1)).toBe(true);
  });

  it('keeps long product copy inside a portrait safe width including its exact word gaps', () => {
    const layout = headlineLayout(
      'Practical Systems turns consequential operating decisions into measured repeatable work',
      formatFor(1080, 1920),
      'precision',
      false,
      undefined,
      true,
    );
    expect(layout.lines.length).toBeLessThanOrEqual(5);
    expect(layout.lines.every((line) => headlineLineWidth(line, layout) <= layout.contentWidth + 1)).toBe(true);
  });

  it('gives each direction a distinct typographic register', () => {
    const format = formatFor(1920, 1080);
    const editorial = headlineLayout('One product, three registers', format, 'editorial');
    const precision = headlineLayout('One product, three registers', format, 'precision');
    const playful = headlineLayout('One product, three registers', format, 'playful');
    expect(new Set([editorial.letterSpacing, precision.letterSpacing, playful.letterSpacing]).size).toBe(3);
    expect(editorial.maskLines).toBe(true);
    expect(precision.textAlign).toBe('left');
  });
});

describe('ctaSetting', () => {
  const fonts = {display: 'DisplayFace', mono: 'MonoFace'};
  const cta = 'Open the demo and watch a missed call become a booked window. No signup, nothing sent.';

  it('sets a sentence-casing CTA in the display face with the props copy untouched', () => {
    const setting = ctaSetting(cta, 'sentence', fonts);
    expect(setting.text).toBe(cta);
    expect(setting.fontFamily).toBe(fonts.display);
    expect(setting.fontWeight).toBe(800);
    expect(setting.letterSpacing).toBe('-0.01em');
  });

  it('keeps the tracked uppercase mono treatment for every other direction', () => {
    const setting = ctaSetting(cta, 'upper', fonts);
    expect(setting.text).toBe(cta.toUpperCase());
    expect(setting.fontFamily).toBe(fonts.mono);
    expect(setting.fontWeight).toBeUndefined();
    expect(setting.letterSpacing).toBe('0.2em');
  });
});
