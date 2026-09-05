import { describe, it, expect } from 'vitest';
import { createRng, type Rng } from '../core/rng';
import {
  classifyRoll,
  groupActionModifier,
  netAdvantage,
  rollDuality,
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
    [10, 3, 15, 12, 'successWithHope'],
    [3, 10, 15, 12, 'successWithFear'],
    [10, 3, 13, 20, 'failureWithHope'],
    [3, 10, 13, 20, 'failureWithFear'],
  ];
  it.each(cases)('hope %i / fear %i / total %i vs %i -> %s', (hope, fear, total, dc, expected) => {
    expect(classifyRoll(hope, fear, total, dc).outcome).toBe(expected);
  });

  it('treats a critical success as a roll with Hope', () => {
    const r = classifyRoll(5, 5, 10, 20);
    expect(r).toMatchObject({ critical: true, success: true, withHope: true });
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
    expect(r).toMatchObject({ hope: 8, fear: 5, total: 15, success: true, outcome: 'successWithHope' });
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

  it('grants Hope on a roll with Hope and Fear on a roll with Fear, never both', () => {
    const rng = createRng('duality-resources');
    for (let i = 0; i < 500; i++) {
      const r = rollDuality(rng, { difficulty: 12, modifier: 1 });
      expect(r.hopeGained + r.fearGained).toBe(1);
      expect(r.hopeGained).toBe(r.withHope ? 1 : 0);
      expect(r.fearGained).toBe(r.withFear ? 1 : 0);
    }
  });

  it('clears a Stress and gains a Hope on a critical success', () => {
    const r = rollDuality(scriptedRng([6, 6]), { difficulty: 30 });
    expect(r).toMatchObject({
      critical: true,
      success: true,
      hopeGained: 1,
      fearGained: 0,
      stressCleared: 1,
      spotlightToGm: false,
    });
  });

  describe('reaction rolls', () => {
    it('generate no Hope or Fear and never hand the spotlight over', () => {
      const rng = createRng('reactions');
      for (let i = 0; i < 200; i++) {
        const r = rollDuality(rng, { difficulty: 13, modifier: 2, reaction: true });
        expect(r.hopeGained).toBe(0);
        expect(r.fearGained).toBe(0);
        expect(r.stressCleared).toBe(0);
        expect(r.spotlightToGm).toBe(false);
      }
    });

    it('clear no Stress on a critical success but still succeed', () => {
      const r = rollDuality(scriptedRng([11, 11]), { difficulty: 25, reaction: true });
      expect(r).toMatchObject({ critical: true, success: true, stressCleared: 0, hopeGained: 0 });
    });

    it('cannot be aided by Help an Ally', () => {
      // A third scripted face would be consumed only if a help die were rolled.
      const r = rollDuality(scriptedRng([7, 2]), { difficulty: 10, helpDice: 3, reaction: true });
      expect(r.helpDice).toEqual([]);
      expect(r.helpBonus).toBe(0);
    });
  });

  it('passes the spotlight on any failure and on a success with Fear', () => {
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
