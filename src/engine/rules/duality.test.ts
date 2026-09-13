import { describe, it, expect } from 'vitest';
import { createRng, type Rng } from '../core/rng';
import {
  classifyRoll,
  groupActionModifier,
  netAdvantage,
  rollDuality,
  withFaces,
  type DualityRoll,
  type RollOutcome,
} from './duality';

/** An Rng that returns a scripted sequence of die faces, for pinning rule branches. */
function scriptedRng(faces: number[]): Rng {
  let i = 0;
  const take = () => {
    if (i >= faces.length) throw new Error('scriptedRng exhausted');
    return faces[i++]!;
  };
  const rng: Rng = {
    next: () => take() / 100,
    nextInt: () => take(),
    die: () => take(),
    dice: (count) => Array.from({ length: count }, take),
    pick: (items) => items[0]!,
    shuffle: (items) => items,
    fork: () => rng,
    save: () => i,
    restore: (s) => {
      i = s;
    },
  };
  return rng;
}

describe('netAdvantage', () => {
  it('cancels one-for-one and never yields more than one die', () => {
    expect(netAdvantage(0, 0)).toBe(0);
    expect(netAdvantage(2, 2)).toBe(0);
    expect(netAdvantage(3, 1)).toBe(1);
    expect(netAdvantage(1, 3)).toBe(-1);
    expect(netAdvantage(5, 0)).toBe(1);
  });
});

describe('classifyRoll', () => {
  const cases: [number, number, number, number, RollOutcome][] = [
    [7, 7, 14, 20, 'criticalSuccess'], // matching dice succeed even under the Difficulty
    [10, 3, 15, 12, 'successWithGood'],
    [3, 10, 15, 12, 'successWithBad'],
    [10, 3, 13, 20, 'failureWithGood'],
    [3, 10, 13, 20, 'failureWithBad'],
  ];
  it.each(cases)('good %i / bad %i / total %i vs %i -> %s', (good, bad, total, dc, expected) => {
    expect(classifyRoll(good, bad, total, dc).outcome).toBe(expected);
  });

  it('treats a critical success as a roll with Light', () => {
    const r = classifyRoll(5, 5, 10, 20);
    expect(r).toMatchObject({ critical: true, success: true, withGood: true });
  });
});

describe('groupActionModifier', () => {
  it('is +1 per succeeding helper and -1 per failing helper', () => {
    expect(groupActionModifier([])).toBe(0);
    expect(
      groupActionModifier([{ success: true }, { success: true }, { success: false }]),
    ).toBe(1);
    expect(groupActionModifier([{ success: false }, { success: false }])).toBe(-2);
  });
});

describe('rollDuality', () => {
  it('sums the duality dice and the modifier', () => {
    const r = rollDuality(scriptedRng([8, 5]), { difficulty: 14, modifier: 2 });
    expect(r).toMatchObject({ good: 8, bad: 5, total: 15, success: true, outcome: 'successWithGood' });
    expect(r.advantageDie).toBe(0);
    expect(r.helpDice).toEqual([]);
  });

  it('adds an advantage d6 and subtracts a disadvantage d6', () => {
    const adv = rollDuality(scriptedRng([4, 3, 6]), { difficulty: 10, advantage: 1 });
    expect(adv.advantageDie).toBe(6);
    expect(adv.total).toBe(13);

    const dis = rollDuality(scriptedRng([4, 3, 6]), { difficulty: 10, disadvantage: 1 });
    expect(dis.advantageDie).toBe(-6);
    expect(dis.total).toBe(1);
  });

  it('does not draw a d6 when advantage and disadvantage cancel', () => {
    // Only two faces are scripted: drawing a third would throw.
    const r = rollDuality(scriptedRng([9, 2]), { difficulty: 10, advantage: 2, disadvantage: 2 });
    expect(r.advantageDie).toBe(0);
    expect(r.total).toBe(11);
  });

  it('adds only the highest Help an Ally die', () => {
    const r = rollDuality(scriptedRng([4, 4 + 1, 2, 5, 3]), { difficulty: 10, helpDice: 3 });
    expect(r.helpDice).toEqual([2, 5, 3]);
    expect(r.helpBonus).toBe(5);
    expect(r.total).toBe(4 + 5 + 5);
  });

  it('grants Light on a roll with Light and Shadow on a roll with Shadow, never both', () => {
    const rng = createRng('duality-resources');
    for (let i = 0; i < 500; i++) {
      const r = rollDuality(rng, { difficulty: 12, modifier: 1 });
      expect(r.goodGained + r.badGained).toBe(1);
      expect(r.goodGained).toBe(r.withGood ? 1 : 0);
      expect(r.badGained).toBe(r.withBad ? 1 : 0);
    }
  });

  it('clears a Stress and gains a Light on a critical success', () => {
    const r = rollDuality(scriptedRng([6, 6]), { difficulty: 30 });
    expect(r).toMatchObject({
      critical: true,
      success: true,
      goodGained: 1,
      badGained: 0,
      stressCleared: 1,
      spotlightToGm: false,
    });
  });

  describe('reaction rolls', () => {
    it('generate no Light or Shadow and never hand the spotlight over', () => {
      const rng = createRng('reactions');
      for (let i = 0; i < 200; i++) {
        const r = rollDuality(rng, { difficulty: 13, modifier: 2, reaction: true });
        expect(r.goodGained).toBe(0);
        expect(r.badGained).toBe(0);
        expect(r.stressCleared).toBe(0);
        expect(r.spotlightToGm).toBe(false);
      }
    });

    it('clear no Stress on a critical success but still succeed', () => {
      const r = rollDuality(scriptedRng([11, 11]), { difficulty: 25, reaction: true });
      expect(r).toMatchObject({ critical: true, success: true, stressCleared: 0, goodGained: 0 });
    });

    it('cannot be aided by Help an Ally', () => {
      // A third scripted face would be consumed only if a help die were rolled.
      const r = rollDuality(scriptedRng([7, 2]), { difficulty: 10, helpDice: 3, reaction: true });
      expect(r.helpDice).toEqual([]);
      expect(r.helpBonus).toBe(0);
    });
  });

  it('passes the spotlight on any failure and on a success with Shadow', () => {
    expect(rollDuality(scriptedRng([9, 2]), { difficulty: 5 }).spotlightToGm).toBe(false);
    expect(rollDuality(scriptedRng([2, 9]), { difficulty: 5 }).spotlightToGm).toBe(true);
    expect(rollDuality(scriptedRng([3, 2]), { difficulty: 20 }).spotlightToGm).toBe(true);
    expect(rollDuality(scriptedRng([2, 3]), { difficulty: 20 }).spotlightToGm).toBe(true);
  });

  it('is reproducible from a seed', () => {
    const opts = { difficulty: 14, modifier: 3, advantage: 1, helpDice: 2 };
    const a = Array.from({ length: 20 }, () => rollDuality(createRng('seeded'), opts));
    const b = Array.from({ length: 20 }, () => rollDuality(createRng('seeded'), opts));
    expect(a).toEqual(b);

    const stream = createRng('stream');
    const first = rollDuality(stream, opts);
    const second = rollDuality(stream, opts);
    expect(first).not.toEqual(second); // the stream advances between rolls
  });

  it('crits at roughly 1 in 12 over many rolls', () => {
    const rng = createRng('crit-rate');
    let crits = 0;
    const n = 60_000;
    for (let i = 0; i < n; i++) if (rollDuality(rng, { difficulty: 12 }).critical) crits++;
    expect(Math.abs(crits / n - 1 / 12)).toBeLessThan(0.005);
  });
});


/**
 * A roll read again around dice that were thrown a second time: everything
 * that was not the Duality Dice stands, and everything they decide is decided
 * from the top.
 */
describe('withFaces', () => {
  const base = (over: Partial<DualityRoll> = {}): DualityRoll => ({
    ...rollDuality(scriptedRng([5, 3]), { difficulty: 12, modifier: 2 }),
    ...over,
  });

  it('reads the whole roll again from the new pair', () => {
    // 5 + 3 + 2 = 10 against 12: a failure, with Light, and the spotlight goes.
    const first = base();
    expect(first).toMatchObject({ total: 10, outcome: 'failureWithGood', success: false, spotlightToGm: true });

    // The Shadow Die alone comes up 9: 5 + 9 + 2 = 16, a success with Shadow.
    const again = withFaces(first, { bad: 9 });
    expect(again).toMatchObject({
      good: 5,
      bad: 9,
      total: 16,
      outcome: 'successWithBad',
      success: true,
      withGood: false,
      withBad: true,
      goodGained: 0,
      badGained: 1,
      spotlightToGm: true,
    });
  });

  it('finds a critical in a pair that was not one', () => {
    const again = withFaces(base(), { bad: 5 });
    expect(again).toMatchObject({ critical: true, success: true, outcome: 'criticalSuccess', stressCleared: 1 });
    // A critical succeeds however the total falls: 5 + 5 + 2 is 12 here, but
    // matched dice would beat any Difficulty.
    expect(withFaces({ ...base(), difficulty: 40 }, { bad: 5 }).success).toBe(true);
  });

  it('keeps everything that was not the Duality Dice', () => {
    const advantaged = { ...base(), advantageDie: 4, helpBonus: 3, helpDice: [3] };
    const again = withFaces(advantaged, { good: 1, bad: 2 });
    // 1 + 2 + 4 (advantage) + 3 (help) + 2 (modifier) = 12.
    expect(again).toMatchObject({ advantageDie: 4, helpBonus: 3, modifier: 2, difficulty: 12, total: 12, success: true });
  });

  it('leaves a die alone when it is not named, and a reaction roll gains nothing', () => {
    const first = base();
    expect(withFaces(first, {})).toEqual(first);
    expect(withFaces(first, { good: 11 })).toMatchObject({ good: 11, bad: 3 });
    // "A critical success on an adversary's reaction roll confers no
    // additional benefit": no Light, no Shadow, no Stress cleared.
    const reaction = { ...base(), reaction: true };
    expect(withFaces(reaction, { bad: 5 })).toMatchObject({
      critical: true,
      goodGained: 0,
      badGained: 0,
      stressCleared: 0,
      spotlightToGm: false,
    });
  });
});
