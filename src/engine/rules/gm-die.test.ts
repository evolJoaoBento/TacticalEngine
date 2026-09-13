import { describe, it, expect } from 'vitest';
import { createRng, type Rng } from '../core/rng';
import { GM_DIE_SIDES, rollGmDie } from './gm-die';

/** An Rng returning scripted die faces, for pinning rule branches. */
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

describe('rollGmDie', () => {
  it('rolls a single d20 plus the attack bonus against Evasion', () => {
    const r = rollGmDie(scriptedRng([11]), { difficulty: 13, modifier: 3 });
    expect(r).toMatchObject({ die: 11, modifier: 3, total: 14, success: true, critical: false });
  });

  it('fails when the total falls short', () => {
    expect(rollGmDie(scriptedRng([4]), { difficulty: 13, modifier: 3 }).success).toBe(false);
  });

  it('succeeds on meeting the Difficulty exactly', () => {
    expect(rollGmDie(scriptedRng([10]), { difficulty: 13, modifier: 3 }).success).toBe(true);
  });

  it('crits on a natural 20, which succeeds whatever the modifiers say', () => {
    const r = rollGmDie(scriptedRng([20]), { difficulty: 99, modifier: -10 });
    expect(r).toMatchObject({ die: 20, critical: true, success: true });
  });

  it('does not crit on a total of 20 that is not a natural 20', () => {
    const r = rollGmDie(scriptedRng([15]), { difficulty: 10, modifier: 5 });
    expect(r.total).toBe(20);
    expect(r.critical).toBe(false);
  });

  it('adds an advantage die and subtracts a disadvantage die', () => {
    expect(rollGmDie(scriptedRng([10, 4]), { difficulty: 10, advantage: 1 }).total).toBe(14);
    expect(rollGmDie(scriptedRng([10, 4]), { difficulty: 10, disadvantage: 1 }).total).toBe(6);
  });

  it('draws no advantage die when advantage and disadvantage cancel', () => {
    // Only one face is scripted: a second draw would throw.
    const r = rollGmDie(scriptedRng([9]), { difficulty: 10, advantage: 2, disadvantage: 2 });
    expect(r.advantageDie).toBe(0);
  });

  it('gives a reaction roll no critical benefit, but still succeeds on a 20', () => {
    const r = rollGmDie(scriptedRng([20]), { difficulty: 99, reaction: true });
    expect(r).toMatchObject({ success: true, critical: false, reaction: true });
  });

  it('generates no Light or Shadow — the GM has neither on their own die', () => {
    const r = rollGmDie(scriptedRng([12]), { difficulty: 10 });
    expect(Object.keys(r)).not.toContain('hopeGained');
    expect(Object.keys(r)).not.toContain('fearGained');
  });

  it('stays within the die and is reproducible from a seed', () => {
    const rng = createRng('gm');
    for (let i = 0; i < 2000; i++) {
      const r = rollGmDie(rng, { difficulty: 12, modifier: 2 });
      expect(r.die).toBeGreaterThanOrEqual(1);
      expect(r.die).toBeLessThanOrEqual(GM_DIE_SIDES);
    }
    const opts = { difficulty: 14, modifier: 3, advantage: 1 };
    expect(rollGmDie(createRng('same'), opts)).toEqual(rollGmDie(createRng('same'), opts));
  });

  it('crits at roughly 1 in 20 over many rolls', () => {
    const rng = createRng('crit-rate');
    let crits = 0;
    const n = 60_000;
    for (let i = 0; i < n; i++) if (rollGmDie(rng, { difficulty: 12 }).critical) crits++;
    expect(Math.abs(crits / n - 1 / 20)).toBeLessThan(0.005);
  });
});
