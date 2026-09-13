import { describe, it, expect } from 'vitest';
import type { Rng } from '../core/rng';
import { abilitySchema, type AbilityDef } from '../content/abilities';
import { previewPlan, resolveDefense, resolveDefensePlan, type Defender } from './defense';

/**
 * The defender's automatic choices: the one Armor Slot, and the reactions a
 * character holds, each used only when it lowers the Hit Points marked and
 * only when its cost can be paid. Numbers are a chainmail guardian's: 8/16.
 */

function scripted(values: number[]): Rng {
  let i = 0;
  const take = (): number => {
    const v = values[i++];
    if (v === undefined) throw new Error('out of dice');
    return v;
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

const getBackUp: AbilityDef = abilitySchema.parse({
  id: 'get-back-up',
  name: 'Get Back Up',
  source: { kind: 'domainCard', card: 'get-back-up' },
  kind: 'reaction',
  trigger: 'incomingDamage',
  cost: { stress: 1 },
  reaction: { kind: 'reduceSeverity', only: 'severe' },
});
const runeWard: AbilityDef = abilitySchema.parse({
  id: 'rune-ward',
  name: 'Rune Ward',
  source: { kind: 'domainCard', card: 'rune-ward' },
  kind: 'reaction',
  trigger: 'incomingDamage',
  cost: { hope: 1 },
  reaction: { kind: 'reduceDamage', dice: '1d8' },
});
const ironWill: AbilityDef = abilitySchema.parse({
  id: 'iron-will',
  name: 'Iron Will',
  source: { kind: 'subclass', subclassId: 'stalwart', stage: 'foundation' },
  kind: 'reaction',
  trigger: 'incomingDamage',
  reaction: { kind: 'extraArmor', only: 'physical' },
});

function guardian(overrides: Partial<Defender> = {}): Defender {
  return {
    thresholds: { major: 8, severe: 16 },
    armorSlots: { max: 4, marked: 0 },
    stress: { max: 6, marked: 0 },
    hope: { max: 6, value: 2 },
    reactions: [],
    ...overrides,
  };
}

const phys = (amount: number) => ({ amount, types: ['physical'] as const });

describe('a defender who takes a number off the damage', () => {
  /** "When the Knight takes physical damage, reduce it by 3." */
  const knight = guardian({ defenses: { reduce: [{ dice: '3', only: 'physical' }] } });
  /** "When the Undefeated Champion takes damage, reduce it by 1d10." */
  const champion = guardian({ defenses: { reduce: [{ dice: '1d10' }] } });

  it('takes the flat number off however the defence is decided', () => {
    // 10 physical is Major on 8/16; 3 off makes it Minor, and the one Armor
    // Slot the policy marks then takes the Knight to nothing at all.
    expect(resolveDefense(scripted([]), phys(10), knight).resolved).toMatchObject({
      incoming: 7,
      reduced: 3,
      severity: 'minor',
      armorSlotsSpent: 1,
      hpMarked: 0,
    });
    expect(resolveDefense(scripted([]), phys(10), guardian()).resolved).toMatchObject({ hpMarked: 1, armorSlotsSpent: 1 });
    // A plan the defender chose is the same arithmetic.
    expect(
      resolveDefensePlan(scripted([]), phys(10), knight, { armorSlots: 0, reactions: [] }).resolved,
    ).toMatchObject({ incoming: 7, hpMarked: 1 });
    // And so is the preview a player is offered, because nothing is rolled.
    expect(previewPlan(phys(10), knight, { armorSlots: 0, reactions: [] })).toBe(1);
  });

  it('rolls the dice kind once for the whole hit', () => {
    // One d10 for the event, not one per sum: the scripted stream holds a
    // single 8, and running out of dice would throw.
    const defense = resolveDefense(scripted([8]), phys(20), champion);
    expect(defense.resolved).toMatchObject({ incoming: 12, reduced: 8, severity: 'major' });
    const chosen = resolveDefensePlan(scripted([8]), phys(20), champion, { armorSlots: 1, reactions: [] });
    expect(chosen.resolved).toMatchObject({ incoming: 12, finalSeverity: 'minor', hpMarked: 1 });
  });

  it('has no number to preview until those dice are rolled', () => {
    // The same answer a Rune Ward gets, for the same reason.
    expect(previewPlan(phys(20), champion, { armorSlots: 0, reactions: [] })).toBeNull();
  });
});

describe('a defender who resists the damage', () => {
  /**
   * Resistance comes off the top: it halves before thresholds, before armour
   * and before any reaction, which is what makes a Skeleton Warrior worth
   * hitting with anything but a sword.
   */
  const bones = guardian({ defenses: { resistances: ['physical'] } });

  it('halves before the thresholds, whichever way the defence is decided', () => {
    // 20 physical is Severe on 8/16; halved to 10 it is Major, and one Armor
    // Slot takes it to Minor.
    expect(resolveDefense(scripted([]), phys(20), bones).resolved).toMatchObject({
      severity: 'major',
      finalSeverity: 'minor',
      hpMarked: 1,
    });
    // The same hit on a defender without it is Severe, one slot short of it.
    expect(resolveDefense(scripted([]), phys(20), guardian()).resolved).toMatchObject({ hpMarked: 2 });
    // Magic is not what it resists.
    expect(resolveDefense(scripted([]), { amount: 20, types: ['magic'] }, bones).resolved).toMatchObject({ hpMarked: 2 });
  });

  it('is in the numbers a player is offered when they are asked how they take it', () => {
    const plan = { armorSlots: 0, reactions: [] };
    expect(previewPlan(phys(20), bones, plan)).toBe(2);
    expect(previewPlan(phys(20), guardian(), plan)).toBe(3);
    // And what they chose resolves to the number they were shown.
    expect(resolveDefensePlan(scripted([]), phys(20), bones, plan).resolved.hpMarked).toBe(2);
  });

  it('ignores damage entirely when it is an immunity, and halves mixed damage only for a creature that resists both', () => {
    const immune = guardian({ defenses: { immunities: ['magic'] } });
    expect(resolveDefense(scripted([]), { amount: 20, types: ['magic'] }, immune).resolved.hpMarked).toBe(0);
    // "Considered both physical and magic": resisting one of the two is no help.
    const both = { amount: 20, types: ['physical', 'magic'] as const };
    expect(resolveDefense(scripted([]), both, bones).resolved.hpMarked).toBe(2);
    const either = guardian({ defenses: { resistances: ['physical', 'magic'] } });
    expect(resolveDefense(scripted([]), both, either).resolved.hpMarked).toBe(1);
  });
});

describe('Armor Slots', () => {
  it('marks the one slot when it lowers the Hit Points, and not otherwise', () => {
    // 20 is Severe: one slot makes it Major.
    const severe = resolveDefense(scripted([]), phys(20), guardian());
    expect(severe.resolved).toMatchObject({ severity: 'severe', finalSeverity: 'major', hpMarked: 2, armorSlotsSpent: 1 });
    // No slots left: nothing to mark.
    const bare = resolveDefense(scripted([]), phys(20), guardian({ armorSlots: { max: 4, marked: 4 } }));
    expect(bare.resolved).toMatchObject({ finalSeverity: 'severe', hpMarked: 3, armorSlotsSpent: 0 });
    // Direct damage cannot be reduced.
    const direct = resolveDefense(scripted([]), { ...phys(20), direct: true }, guardian());
    expect(direct.resolved).toMatchObject({ hpMarked: 3, armorSlotsSpent: 0 });
    // Under a `never` policy the slot stays.
    const never = resolveDefense(scripted([]), phys(20), guardian(), { armor: 'never', reactions: true });
    expect(never.resolved.armorSlotsSpent).toBe(0);
  });
});

describe('reactions', () => {
  it('Get Back Up answers Severe damage with a Stress, and stacks with the slot', () => {
    const defense = resolveDefense(scripted([]), phys(20), guardian({ reactions: [getBackUp] }));
    // Severe: the slot makes it Major, Get Back Up makes it Minor.
    expect(defense.resolved).toMatchObject({ severity: 'severe', finalSeverity: 'minor', hpMarked: 1, armorSlotsSpent: 1 });
    expect(defense.stressMarked).toBe(1);
    expect(defense.reactions.map((r) => r.ability.id)).toEqual(['get-back-up']);
  });

  it('Get Back Up stays in the deck against Major damage, and with no Stress to mark', () => {
    // 10 is Major: the card only answers Severe.
    const major = resolveDefense(scripted([]), phys(10), guardian({ reactions: [getBackUp] }));
    expect(major.reactions).toEqual([]);
    expect(major.resolved.hpMarked).toBe(1);
    const full = resolveDefense(scripted([]), phys(20), guardian({ reactions: [getBackUp], stress: { max: 6, marked: 6 } }));
    expect(full.reactions).toEqual([]);
    expect(full.stressMarked).toBe(0);
  });

  it('a Rune Ward rolls its die off the damage first, for a Light, when the roll helps', () => {
    // 17 is Severe; a 3 makes it 14, Major; the slot then makes it Minor.
    const helped = resolveDefense(scripted([3]), phys(17), guardian({ reactions: [runeWard] }));
    expect(helped.reactions).toEqual([expect.objectContaining({ hopeSpent: 1, rolled: 3 })]);
    expect(helped.hopeSpent).toBe(1);
    expect(helped.resolved).toMatchObject({ incoming: 14, finalSeverity: 'minor', hpMarked: 1 });
    // A 1 off 17 is still Severe: the ward is not spent.
    const wasted = resolveDefense(scripted([1]), phys(17), guardian({ reactions: [runeWard] }));
    expect(wasted.reactions).toEqual([]);
    expect(wasted.hopeSpent).toBe(0);
    expect(wasted.resolved.incoming).toBe(17);
    // No Light: no ward, and no die rolled.
    expect(() => resolveDefense(scripted([]), phys(17), guardian({ reactions: [runeWard], hope: { max: 6, value: 0 } }))).not.toThrow();
  });

  it('Iron Will marks a second slot against physical damage only', () => {
    // 20 Severe: one slot → Major, Iron Will's second → Minor.
    const physical = resolveDefense(scripted([]), phys(20), guardian({ reactions: [ironWill] }));
    expect(physical.resolved).toMatchObject({ armorSlotsSpent: 2, finalSeverity: 'minor', hpMarked: 1 });
    expect(physical.reactions.map((r) => r.ability.id)).toEqual(['iron-will']);
    const magic = resolveDefense(scripted([]), { amount: 20, types: ['magic'] }, guardian({ reactions: [ironWill] }));
    expect(magic.resolved.armorSlotsSpent).toBe(1);
    expect(magic.reactions).toEqual([]);
  });

  it('uses them together, in the order held, and never past nothing', () => {
    // 25 Severe: ward rolls 8 → 17, still Severe, so the ward is kept; slot →
    // Major; Iron Will → Minor; Get Back Up answered Severe → none.
    const all = resolveDefense(scripted([8]), phys(25), guardian({ reactions: [runeWard, ironWill, getBackUp] }));
    expect(all.reactions.map((r) => r.ability.id)).toEqual(['iron-will', 'get-back-up']);
    expect(all.resolved).toMatchObject({ finalSeverity: 'none', hpMarked: 0, armorSlotsSpent: 2 });
    expect(all.hopeSpent).toBe(0);
    expect(all.stressMarked).toBe(1);
  });

  it('honours the policy switch and the card\'s own auto flag', () => {
    const off = resolveDefense(scripted([]), phys(20), guardian({ reactions: [getBackUp] }), { armor: 'auto', reactions: false });
    expect(off.reactions).toEqual([]);
    const manual = { ...getBackUp, auto: false };
    const kept = resolveDefense(scripted([]), phys(20), guardian({ reactions: [manual] }));
    expect(kept.reactions).toEqual([]);
  });
});
