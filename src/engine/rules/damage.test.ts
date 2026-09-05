import { describe, it, expect } from 'vitest';
import { createRng } from '../core/rng';
import {
  NO_THRESHOLDS,
  applyDefenses,
  armorScore,
  hpForSeverity,
  parseThresholds,
  pcThresholds,
  reduceSeverity,
  resolveDamage,
  rollDamage,
  severityFor,
  type DamageSeverity,
} from './damage';

const thresholds = { major: 8, severe: 15 };

describe('severityFor', () => {
  const cases: [number, DamageSeverity][] = [
    [0, 'none'],
    [-3, 'none'],
    [1, 'minor'],
    [7, 'minor'],
    [8, 'major'],
    [14, 'major'],
    [15, 'severe'],
    [40, 'severe'],
  ];
  it.each(cases)('%i damage is %s', (amount, expected) => {
    expect(severityFor(amount, thresholds)).toBe(expected);
  });

  it('marks Massive Damage only when the optional rule is on', () => {
    expect(severityFor(30, thresholds)).toBe('severe');
    expect(severityFor(30, thresholds, { massiveDamage: true })).toBe('massive');
    expect(severityFor(29, thresholds, { massiveDamage: true })).toBe('severe');
  });
});

describe('parseThresholds', () => {
  it('reads the usual Major/Severe pair', () => {
    expect(parseThresholds('8/15')).toEqual({ major: 8, severe: 15 });
    expect(parseThresholds(' 11 / 20 ')).toEqual({ major: 11, severe: 20 });
  });

  it('reads a Minion stat block with no thresholds at all', () => {
    expect(parseThresholds('None')).toEqual(NO_THRESHOLDS);
  });

  it('reads a Major threshold with no Severe one', () => {
    expect(parseThresholds('4/None')).toEqual({ major: 4, severe: Infinity });
  });

  it('returns null for shapes it does not recognise', () => {
    for (const bad of ['', '  ', '8', '8/', 'a/b', '15/8']) expect(parseThresholds(bad)).toBeNull();
  });
});

describe('thresholds that are absent', () => {
  it('makes every hit Minor for a Minion', () => {
    expect(severityFor(1, NO_THRESHOLDS)).toBe('minor');
    expect(severityFor(50, NO_THRESHOLDS)).toBe('minor');
    // A Minion has 1 HP, so one Minor hit still finishes it.
    expect(resolveDamage({ amount: 50 }, NO_THRESHOLDS).hpMarked).toBe(1);
  });

  it('caps an ooze at Major with no Severe threshold', () => {
    const ooze = { major: 4, severe: Infinity };
    expect(severityFor(3, ooze)).toBe('minor');
    expect(severityFor(40, ooze)).toBe('major');
    expect(severityFor(40, ooze, { massiveDamage: true })).toBe('major');
  });
});

describe('hpForSeverity', () => {
  it('marks 1/2/3 HP per band, 4 for Massive, 0 for none', () => {
    expect(hpForSeverity('none')).toBe(0);
    expect(hpForSeverity('minor')).toBe(1);
    expect(hpForSeverity('major')).toBe(2);
    expect(hpForSeverity('severe')).toBe(3);
    expect(hpForSeverity('massive')).toBe(4);
  });
});

describe('reduceSeverity', () => {
  it('steps Severe to Major to Minor to Nothing', () => {
    expect(reduceSeverity('severe')).toBe('major');
    expect(reduceSeverity('major')).toBe('minor');
    expect(reduceSeverity('minor')).toBe('none');
    expect(reduceSeverity('none')).toBe('none');
    expect(reduceSeverity('massive')).toBe('severe');
  });

  it('applies multiple steps and floors at none', () => {
    expect(reduceSeverity('severe', 2)).toBe('minor');
    expect(reduceSeverity('severe', 9)).toBe('none');
    expect(reduceSeverity('severe', 0)).toBe('severe');
  });
});

describe('pcThresholds', () => {
  it('adds the character level to the armor thresholds', () => {
    // Gambeson Armor from tools/srd-sources/daggersearch/core/armors.json.
    expect(pcThresholds(3, { major: 5, severe: 11 })).toEqual({ major: 8, severe: 14 });
  });

  it('gives an unarmored character level / twice level', () => {
    expect(pcThresholds(4)).toEqual({ major: 4, severe: 8 });
    expect(pcThresholds(1, null)).toEqual({ major: 1, severe: 2 });
  });
});

describe('armorScore', () => {
  it('caps at 12 and floors at 0', () => {
    expect(armorScore(3)).toBe(3);
    expect(armorScore(3, 2)).toBe(5);
    expect(armorScore(11, 5)).toBe(12);
    expect(armorScore(1, -4)).toBe(0);
  });
});

describe('applyDefenses', () => {
  it('halves resisted damage, rounding up', () => {
    expect(applyDefenses(10, ['physical'], { resistances: ['physical'] })).toBe(5);
    expect(applyDefenses(9, ['physical'], { resistances: ['physical'] })).toBe(5);
  });

  it('does not stack multiple resistances to the same type', () => {
    expect(applyDefenses(12, ['magic'], { resistances: ['magic', 'magic'] })).toBe(6);
  });

  it('zeroes immune damage', () => {
    expect(applyDefenses(20, ['magic'], { immunities: ['magic'] })).toBe(0);
  });

  it('needs the defense against both types for dual-typed damage', () => {
    const both = ['physical', 'magic'] as const;
    expect(applyDefenses(10, both, { resistances: ['physical'] })).toBe(10);
    expect(applyDefenses(10, both, { resistances: ['physical', 'magic'] })).toBe(5);
    expect(applyDefenses(10, both, { immunities: ['physical', 'magic'] })).toBe(0);
    expect(applyDefenses(10, both, { immunities: ['physical'], resistances: ['magic'] })).toBe(5);
  });

  it('leaves untyped and undefended damage alone', () => {
    expect(applyDefenses(7, [])).toBe(7);
    expect(applyDefenses(7, ['physical'])).toBe(7);
    expect(applyDefenses(-2, ['physical'])).toBe(0);
  });
});

describe('rollDamage', () => {
  it('scales the dice by Proficiency and keeps the modifier flat', () => {
    const r = rollDamage(createRng('prof'), { count: 1, sides: 8, modifier: 2 }, { proficiency: 2 });
    expect(r.expression).toEqual({ count: 2, sides: 8, modifier: 2 });
    expect(r.rolls).toHaveLength(2);
    expect(r.total).toBe(r.diceTotal + 2);
  });

  it('adds the maximum possible dice result on a critical success', () => {
    // SRD: "2d8+1 ... a critical success would deal 2d8+1+16."
    const expr = { count: 1, sides: 8, modifier: 1 };
    const normal = rollDamage(createRng('crit'), expr, { proficiency: 2 });
    const crit = rollDamage(createRng('crit'), expr, { proficiency: 2, critical: true });
    expect(crit.criticalBonus).toBe(16);
    expect(crit.total).toBe(normal.total + 16);
  });

  it('supports the alternative doubleDice critical rule', () => {
    const expr = { count: 2, sides: 6, modifier: 3 };
    const normal = rollDamage(createRng('alt'), expr);
    const crit = rollDamage(createRng('alt'), expr, {
      critical: true,
      criticalRule: 'doubleDice',
    });
    expect(crit.criticalBonus).toBe(normal.diceTotal);
    expect(crit.total).toBe(normal.diceTotal * 2 + 3);
  });

  it('adds a flat feature bonus after the dice', () => {
    const expr = { count: 1, sides: 6, modifier: 0 };
    const plain = rollDamage(createRng('bonus'), expr);
    const boosted = rollDamage(createRng('bonus'), expr, { bonus: 4 });
    expect(boosted.total).toBe(plain.total + 4);
  });
});

describe('resolveDamage', () => {
  it('marks HP from the threshold band', () => {
    expect(resolveDamage({ amount: 5 }, thresholds).hpMarked).toBe(1);
    expect(resolveDamage({ amount: 10 }, thresholds).hpMarked).toBe(2);
    expect(resolveDamage({ amount: 20 }, thresholds).hpMarked).toBe(3);
    expect(resolveDamage({ amount: 0 }, thresholds).hpMarked).toBe(0);
  });

  it('reduces the severity by one band per Armor Slot marked', () => {
    const r = resolveDamage({ amount: 20 }, thresholds, {
      armorSlotsMarked: 1,
      armorSlotsAvailable: 3,
    });
    expect(r).toMatchObject({
      severity: 'severe',
      finalSeverity: 'major',
      armorSlotsSpent: 1,
      hpMarked: 2,
    });
  });

  it('never spends more Armor Slots than the damage is worth', () => {
    const r = resolveDamage({ amount: 5 }, thresholds, {
      armorSlotsMarked: 3,
      armorSlotsAvailable: 5,
    });
    // Minor damage can only be reduced to nothing: one slot, not three.
    expect(r).toMatchObject({ armorSlotsSpent: 1, finalSeverity: 'none', hpMarked: 0 });
  });

  it('is limited by the slots actually available', () => {
    const r = resolveDamage({ amount: 20 }, thresholds, {
      armorSlotsMarked: 2,
      armorSlotsAvailable: 1,
    });
    expect(r).toMatchObject({ armorSlotsSpent: 1, finalSeverity: 'major' });
  });

  it('ignores Armor Slots against direct damage', () => {
    const r = resolveDamage({ amount: 20, direct: true }, thresholds, {
      armorSlotsMarked: 2,
      armorSlotsAvailable: 5,
    });
    expect(r).toMatchObject({ armorSlotsSpent: 0, finalSeverity: 'severe', hpMarked: 3 });
  });

  it('applies resistance before comparing to thresholds, then Armor Slots', () => {
    const r = resolveDamage({ amount: 20, types: ['magic'] }, thresholds, {
      defenses: { resistances: ['magic'] },
      armorSlotsMarked: 1,
      armorSlotsAvailable: 2,
    });
    expect(r.incoming).toBe(10); // halved
    expect(r.severity).toBe('major');
    expect(r.finalSeverity).toBe('minor');
    expect(r.hpMarked).toBe(1);
  });

  it('marks nothing at all against immunity', () => {
    const r = resolveDamage({ amount: 40, types: ['physical'] }, thresholds, {
      defenses: { immunities: ['physical'] },
    });
    expect(r).toMatchObject({ incoming: 0, severity: 'none', hpMarked: 0, armorSlotsSpent: 0 });
  });

  it('steps Massive Damage down like any other band', () => {
    const r = resolveDamage({ amount: 30 }, thresholds, {
      massiveDamage: true,
      armorSlotsMarked: 1,
      armorSlotsAvailable: 1,
    });
    expect(r).toMatchObject({ severity: 'massive', finalSeverity: 'severe', hpMarked: 3 });
  });
});
