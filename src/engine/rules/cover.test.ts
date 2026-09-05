import { describe, it, expect } from 'vitest';
import {
  COVER_LEVELS,
  bestCover,
  canBeTargetedByRanged,
  coverEvasionBonus,
  coverIndex,
} from './cover';

describe('cover', () => {
  it('lists the levels least protective first', () => {
    expect([...COVER_LEVELS]).toEqual(['none', 'light', 'full', 'total']);
    expect(coverIndex('none')).toBeLessThan(coverIndex('light'));
    expect(coverIndex('light')).toBeLessThan(coverIndex('full'));
  });

  it('gives +1 Evasion for Light Cover and +2 for Full Cover', () => {
    expect(coverEvasionBonus('none')).toBe(0);
    expect(coverEvasionBonus('light')).toBe(1);
    expect(coverEvasionBonus('full')).toBe(2);
  });

  it('gives Total Cover no Evasion bonus, because it cannot be targeted at all', () => {
    expect(coverEvasionBonus('total')).toBe(0);
    expect(canBeTargetedByRanged('total')).toBe(false);
    expect(canBeTargetedByRanged('full')).toBe(true);
  });

  it('ignores cover against melee attacks', () => {
    expect(coverEvasionBonus('full', false)).toBe(0);
    expect(coverEvasionBonus('light', false)).toBe(0);
  });

  it('takes the better of two covers rather than stacking them', () => {
    expect(bestCover('light', 'full')).toBe('full');
    expect(bestCover('full', 'light')).toBe('full');
    expect(bestCover('none', 'none')).toBe('none');
    expect(bestCover('total', 'full')).toBe('total');
  });
});
