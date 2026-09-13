import { describe, it, expect } from 'vitest';
import {
  MAX_FEAR,
  MAX_HOPE,
  STARTING_HOPE,
  STARTING_STRESS_SLOTS,
  canAfford,
  canMarkStress,
  clear,
  clearAll,
  createFear,
  createHope,
  createMarkPool,
  gain,
  isFull,
  mark,
  markHitPoints,
  markStress,
  resize,
  scar,
  spend,
  unmarked,
} from './resources';

describe('mark pools', () => {
  it('starts empty and clamps a bad initial value', () => {
    expect(createMarkPool(6)).toEqual({ max: 6, marked: 0 });
    expect(createMarkPool(6, 9)).toEqual({ max: 6, marked: 6 });
    expect(createMarkPool(-2)).toEqual({ max: 0, marked: 0 });
  });

  it('marks slots and reports overflow instead of dropping it', () => {
    const pool = createMarkPool(3, 1);
    const r = mark(pool, 4);
    expect(r.pool).toEqual({ max: 3, marked: 3 });
    expect(r.applied).toBe(2);
    expect(r.overflow).toBe(2);
    expect(r.filled).toBe(true);
    expect(pool.marked).toBe(1); // input untouched
  });

  it('clears only what is marked', () => {
    const r = clear(createMarkPool(6, 2), 5);
    expect(r.applied).toBe(2);
    expect(r.pool.marked).toBe(0);
  });

  it('clears everything on a long rest', () => {
    const r = clearAll(createMarkPool(6, 5));
    expect(r).toEqual({ pool: { max: 6, marked: 0 }, applied: 5 });
  });

  it('reports unmarked slots and fullness', () => {
    expect(unmarked(createMarkPool(6, 2))).toBe(4);
    expect(isFull(createMarkPool(6, 6))).toBe(true);
    expect(isFull(createMarkPool(6, 5))).toBe(false);
    expect(isFull(createMarkPool(0))).toBe(false);
  });

  it('resizes on level up, keeping marks and capping at 12', () => {
    expect(resize(createMarkPool(6, 4), 8)).toEqual({ max: 8, marked: 4 });
    expect(resize(createMarkPool(6, 5), 3)).toEqual({ max: 3, marked: 3 });
    expect(resize(createMarkPool(6), 20).max).toBe(12);
  });
});

describe('markStress', () => {
  it('marks Stress normally', () => {
    const r = markStress(createMarkPool(STARTING_STRESS_SLOTS), createMarkPool(6), 2);
    expect(r.stressMarked).toBe(2);
    expect(r.hpMarked).toBe(0);
    expect(r.becameVulnerable).toBe(false);
  });

  it('flags Vulnerable when the last Stress slot is marked', () => {
    const r = markStress(createMarkPool(6, 5), createMarkPool(6));
    expect(r.becameVulnerable).toBe(true);
    expect(r.stress.marked).toBe(6);
  });

  it('does not re-flag Vulnerable when Stress was already full', () => {
    const r = markStress(createMarkPool(6, 6), createMarkPool(6), 1);
    expect(r.becameVulnerable).toBe(false);
  });

  it('marks a flat 1 HP when Stress cannot be marked, however much overflowed', () => {
    const partial = markStress(createMarkPool(6, 5), createMarkPool(6), 3);
    expect(partial.stressMarked).toBe(1);
    expect(partial.hpMarked).toBe(1);

    const none = markStress(createMarkPool(6, 6), createMarkPool(6), 4);
    expect(none.stressMarked).toBe(0);
    expect(none.hpMarked).toBe(1);
  });

  it('marks no HP when all the Stress fits', () => {
    expect(markStress(createMarkPool(6, 4), createMarkPool(6), 2).hpMarked).toBe(0);
  });

  it('flags a fall when the overflow marks the last Hit Point', () => {
    const r = markStress(createMarkPool(6, 6), createMarkPool(6, 5), 1);
    expect(r.hpMarked).toBe(1);
    expect(r.fell).toBe(true);
  });

  it('gates moves that require marking Stress', () => {
    expect(canMarkStress(createMarkPool(6, 5))).toBe(true);
    expect(canMarkStress(createMarkPool(6, 6))).toBe(false);
    expect(canMarkStress(createMarkPool(6, 5), 2)).toBe(false);
  });
});

describe('markHitPoints', () => {
  it('flags a fall on the last Hit Point', () => {
    const r = markHitPoints(createMarkPool(6, 4), 2);
    expect(r).toMatchObject({ hpMarked: 2, fell: true });
  });

  it('does not flag a fall for someone already down', () => {
    expect(markHitPoints(createMarkPool(6, 6), 1).fell).toBe(false);
  });

  it('marks nothing for zero damage', () => {
    const r = markHitPoints(createMarkPool(6, 2), 0);
    expect(r).toMatchObject({ hpMarked: 0, fell: false });
  });
});

describe('Light and Shadow', () => {
  it('starts a PC at 2 Light with a maximum of 6', () => {
    expect(createHope()).toEqual({ value: STARTING_HOPE, max: MAX_HOPE });
    expect(createHope(99).value).toBe(MAX_HOPE);
    expect(createFear()).toEqual({ value: 0, max: MAX_FEAR });
  });

  it('reports Light lost to the cap rather than exceeding it', () => {
    const r = gain(createHope(5), 3);
    expect(r.currency.value).toBe(6);
    expect(r.applied).toBe(1);
    expect(r.wasted).toBe(2);
  });

  it('caps the GM at 12 Shadow', () => {
    expect(gain(createFear(11), 5).currency.value).toBe(MAX_FEAR);
  });

  it('spends all-or-nothing', () => {
    const rich = spend(createHope(4), 3);
    expect(rich).toMatchObject({ ok: true, spent: 3 });
    expect(rich.currency.value).toBe(1);

    const poor = spend(createHope(2), 3);
    expect(poor).toMatchObject({ ok: false, spent: 0 });
    expect(poor.currency.value).toBe(2);
  });

  it('answers affordability without spending', () => {
    expect(canAfford(createHope(3), 3)).toBe(true);
    expect(canAfford(createHope(2), 3)).toBe(false);
  });
});

describe('scar', () => {
  it('permanently removes a Light slot and trims the current value', () => {
    const r = scar({ value: 6, max: 6 });
    expect(r.hope).toEqual({ value: 5, max: 5 });
    expect(r.journeyEnds).toBe(false);
  });

  it('ends the journey when the last Light slot is crossed out', () => {
    expect(scar({ value: 0, max: 1 }).journeyEnds).toBe(true);
  });
});
