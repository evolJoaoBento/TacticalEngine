import { describe, it, expect } from 'vitest';
import { createRng } from '../core/rng';
import { formatDice, maxDice, parseDice, rollDice, withProficiency } from './dice';

describe('parseDice', () => {
  it('parses the standard xdy+z form', () => {
    expect(parseDice('2d8+1')).toEqual({ count: 2, sides: 8, modifier: 1 });
    expect(parseDice('1d12')).toEqual({ count: 1, sides: 12, modifier: 0 });
    expect(parseDice('3d6-2')).toEqual({ count: 3, sides: 6, modifier: -2 });
  });

  it('accepts shorthand, whitespace and case', () => {
    expect(parseDice('d6')).toEqual({ count: 1, sides: 6, modifier: 0 });
    expect(parseDice('  2 D 10 + 3 ')).toEqual({ count: 2, sides: 10, modifier: 3 });
    expect(parseDice('+4')).toEqual({ count: 0, sides: 0, modifier: 4 });
  });

  it('reads the damage types used by the vendored adversary data', () => {
    expect(parseDice('1d12+2 phy')).toEqual({
      count: 1,
      sides: 12,
      modifier: 2,
      types: ['physical'],
    });
    expect(parseDice('2d6 mag')).toEqual({ count: 2, sides: 6, modifier: 0, types: ['magic'] });
    expect(parseDice('1d8+1 magic')).toEqual({
      count: 1,
      sides: 8,
      modifier: 1,
      types: ['magic'],
    });
  });

  it('reads a dual-typed attack as both types', () => {
    expect(parseDice('1d8+4 phy/mag')).toEqual({
      count: 1,
      sides: 8,
      modifier: 4,
      types: ['physical', 'magic'],
    });
    expect(parseDice('1d6 phy/phys')?.types).toEqual(['physical']);
  });

  it('reads flat damage with no dice ("3 phy")', () => {
    expect(parseDice('3 phy')).toEqual({ count: 0, sides: 0, modifier: 3, types: ['physical'] });
    expect(parseDice('12 phy')).toEqual({ count: 0, sides: 0, modifier: 12, types: ['physical'] });
  });

  it('returns null for input it cannot read, instead of throwing', () => {
    for (const bad of ['', '   ', 'sword', '2d', 'd', '2d0', '1d6 fire', 'xdy', '1d6 phy/fire']) {
      expect(parseDice(bad)).toBeNull();
    }
  });

  it('round-trips through formatDice', () => {
    for (const text of ['2d8+1', '1d12', '3d6-2', '1d6']) {
      expect(formatDice(parseDice(text)!)).toBe(text);
    }
    expect(formatDice({ count: 0, sides: 0, modifier: 0 })).toBe('0');
    expect(formatDice({ count: 0, sides: 0, modifier: 3 })).toBe('+3');
  });

  it('keeps the modifier sign', () => {
    expect(parseDice('2d6-3')?.modifier).toBe(-3);
    expect(parseDice('-3')?.modifier).toBe(-3);
  });
});

describe('maxDice', () => {
  it('is the highest the dice alone can roll, excluding the modifier', () => {
    expect(maxDice({ count: 2, sides: 8, modifier: 1 })).toBe(16);
    expect(maxDice({ count: 0, sides: 0, modifier: 5 })).toBe(0);
  });
});

describe('withProficiency', () => {
  it('multiplies the dice count but not the modifier', () => {
    expect(withProficiency({ count: 1, sides: 8, modifier: 2 }, 2)).toEqual({
      count: 2,
      sides: 8,
      modifier: 2,
    });
  });

  it('clamps a non-positive Proficiency to zero dice', () => {
    expect(withProficiency({ count: 1, sides: 8, modifier: 2 }, 0).count).toBe(0);
    expect(withProficiency({ count: 1, sides: 8, modifier: 2 }, -3).count).toBe(0);
  });
});

describe('rollDice', () => {
  it('rolls the right number of dice and totals them with the modifier', () => {
    const r = rollDice(createRng('dmg'), { count: 3, sides: 6, modifier: 2 });
    expect(r.rolls).toHaveLength(3);
    for (const v of r.rolls) expect(v).toBeGreaterThanOrEqual(1);
    expect(r.diceTotal).toBe(r.rolls.reduce((a, b) => a + b, 0));
    expect(r.total).toBe(r.diceTotal + 2);
  });

  it('rolls nothing for a flat expression', () => {
    const r = rollDice(createRng(1), { count: 0, sides: 0, modifier: 5 });
    expect(r.rolls).toEqual([]);
    expect(r.total).toBe(5);
  });

  it('is reproducible from a seed', () => {
    const expr = { count: 4, sides: 10, modifier: -1 };
    expect(rollDice(createRng('same'), expr)).toEqual(rollDice(createRng('same'), expr));
  });
});
