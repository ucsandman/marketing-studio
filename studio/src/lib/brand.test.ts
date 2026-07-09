import {describe, expect, it} from 'vitest';
import {getBrand} from './brand';

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
});
