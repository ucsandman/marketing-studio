import {describe, expect, it} from 'vitest';
import {brandSchema, getBrand} from '../lib/brand';
import {floatBarGeometry} from './FloatBar';

const NON_NOBAN_BRANDS = [
  'dashclaw',
  'paperroute',
  'magnetic',
  'costclaw',
  'sidetap',
  'tenwords',
  'practicalsystems',
  'postflop',
  'offlocalhost',
  'truckside',
] as const;

describe('FloatBar progress treatment', () => {
  it('keeps every registered non-NoBan brand bar-free', () => {
    for (const id of NON_NOBAN_BRANDS) {
      expect(getBrand(id).progressTreatment).toBe('none');
      expect(floatBarGeometry(0.42, getBrand(id))).toBeNull();
    }
  });

  it('retains NoBan’s four CS2 wear zones and marker', () => {
    expect(getBrand('noban').progressTreatment).toBe('cs2-wear');
    const geometry = floatBarGeometry(0.42, getBrand('noban'));
    expect(geometry?.zones).toHaveLength(4);
    expect(geometry?.marker).toBe(0.42);
  });

  it('defaults an omitted progress treatment to none', () => {
    const raw: Record<string, unknown> = {...getBrand('noban')};
    delete raw.progressTreatment;
    expect(brandSchema.parse(raw).progressTreatment).toBe('none');
  });
});
