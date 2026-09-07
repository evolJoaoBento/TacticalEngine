/**
 * The defender's side of a hit: Armor Slots and the reactions that answer
 * incoming damage.
 *
 * The SRD makes this the defender's choice, made after the damage is known:
 * mark an Armor Slot to step the severity down, mark a Stress to Get Back Up,
 * spend a Hope on a Rune Ward. A CRPG can ask each time or decide; this
 * decides, under a policy — mark the one Armor Slot, use a reaction — and
 * only ever when doing so lowers the Hit Points marked, so nothing is spent
 * for nothing. Every decision is reported, so the log can say what was paid.
 *
 * Pure: it rolls a reaction's dice off the `Rng` it is handed and returns
 * what to mark; the caller marks it.
 */

import { isAutomatic, type AbilityDef } from '../content/abilities';
import type { Rng } from '../core/rng';
import {
  hpForSeverity,
  reduceSeverity,
  resolveDamage,
  type DamageDefenses,
  type DamageThresholds,
  type IncomingDamage,
  type ResolvedDamage,
} from '../rules/damage';
import { parseDice, rollDice } from '../rules/dice';
import { canAfford, canMarkStress, unmarked, type Currency, type MarkPool } from '../rules/resources';

export interface Defender {
  thresholds: DamageThresholds;
  /** Damage types this creature halves or ignores. */
  defenses?: DamageDefenses;
  armorSlots: MarkPool;
  stress: MarkPool;
  hope?: Currency;
  /** Reactions to incoming damage the defender holds, in the order to try them. */
  reactions: readonly AbilityDef[];
}

export interface DefensePolicy {
  /**
   * `auto` marks one Armor Slot against a hit it would lessen; `never` marks
   * none; `ask` also marks none here, because the choice is being put to the
   * player instead (`resolveDefensePlan` applies what they choose).
   */
  armor: 'auto' | 'never' | 'ask';
  /** Use reactions marked `auto`. */
  reactions: boolean;
}

/** A defence the defender chose, rather than one the policy decided. */
export interface DefensePlan {
  /** Armor Slots to mark, before any a reaction adds. */
  armorSlots: number;
  /** Reactions to use, in the order they are written. */
  reactions: readonly AbilityDef[];
}

export const DEFAULT_DEFENSE: DefensePolicy = { armor: 'auto', reactions: true };

/** One reaction that fired, and what it cost. */
export interface ReactionUsed {
  ability: AbilityDef;
  hopeSpent: number;
  stressMarked: number;
  /** The dice a `reduceDamage` reaction rolled, if any. */
  rolled?: number;
}

export interface Defense {
  resolved: ResolvedDamage;
  /** Armor Slots to mark, the one plus any a reaction added. */
  armorSlotsMarked: number;
  reactions: ReactionUsed[];
  hopeSpent: number;
  stressMarked: number;
}

/**
 * Decide the defence against one damage event.
 *
 * Order follows the SRD's arithmetic: dice off the damage first (they change
 * the number compared to the thresholds), then Armor Slots and any extra ones
 * (they step the band down), then the reactions that step the band down
 * again. A reaction is only used when the Hit Points marked would fall.
 */
export function resolveDefense(
  rng: Rng,
  damage: IncomingDamage,
  defender: Defender,
  policy: DefensePolicy = DEFAULT_DEFENSE,
): Defense {
  let hope = defender.hope;
  let stressRoom = unmarked(defender.stress);
  const used: ReactionUsed[] = [];
  let hopeSpent = 0;
  let stressMarked = 0;

  const affordable = (ability: AbilityDef): boolean => {
    const cost = ability.cost;
    if ((cost.hope ?? 0) > 0 && (hope === undefined || !canAfford(hope, cost.hope))) return false;
    if ((cost.stress ?? 0) > 0 && !canMarkStress({ max: stressRoom, marked: 0 }, cost.stress)) return false;
    return true;
  };
  const pay = (ability: AbilityDef, rolled?: number): void => {
    const cost = ability.cost;
    const record: ReactionUsed = { ability, hopeSpent: cost.hope ?? 0, stressMarked: cost.stress ?? 0 };
    if (rolled !== undefined) record.rolled = rolled;
    if ((cost.hope ?? 0) > 0 && hope !== undefined) {
      hope = { max: hope.max, value: hope.value - cost.hope! };
      hopeSpent += cost.hope!;
    }
    if ((cost.stress ?? 0) > 0) {
      stressRoom -= cost.stress!;
      stressMarked += cost.stress!;
    }
    used.push(record);
  };
  const reactions = policy.reactions
    ? defender.reactions.filter((a) => a.kind === 'reaction' && a.trigger === 'incomingDamage' && isAutomatic(a))
    : [];
  const hpFor = (amount: number, armor: number): number =>
    resolveDamage({ ...damage, amount }, defender.thresholds, {
      armorSlotsMarked: armor,
      armorSlotsAvailable: unmarked(defender.armorSlots),
      ...(defender.defenses === undefined ? {} : { defenses: defender.defenses }),
    }).hpMarked;

  // ---- dice off the damage --------------------------------------------------
  let amount = damage.amount;
  for (const ability of reactions) {
    const reaction = ability.reaction!;
    if (reaction.kind !== 'reduceDamage' || !affordable(ability)) continue;
    const expression = parseDice(reaction.dice);
    if (expression === null) continue;
    // Worth it only if the ward could change the band at all.
    if (hpFor(amount, 0) === 0) break;
    const roll = rollDice(rng, expression);
    const after = Math.max(0, amount - roll.total);
    if (hpFor(after, 0) < hpFor(amount, 0) || after === 0) {
      amount = after;
      pay(ability, roll.total);
    } else {
      // Rolled and it did not help: the dice are spent, the resource is not.
    }
  }

  // ---- Armor Slots ------------------------------------------------------------
  let armor = 0;
  if (policy.armor === 'auto' && damage.direct !== true && unmarked(defender.armorSlots) > 0 && hpFor(amount, 1) < hpFor(amount, 0)) {
    armor = 1;
  }
  for (const ability of reactions) {
    const reaction = ability.reaction!;
    if (reaction.kind !== 'extraArmor' || armor === 0 || !affordable(ability)) continue;
    if (reaction.only !== undefined && !(damage.types ?? []).includes(reaction.only)) continue;
    const more = Math.min(reaction.slots, unmarked(defender.armorSlots) - armor);
    if (more <= 0 || hpFor(amount, armor + more) >= hpFor(amount, armor)) continue;
    armor += more;
    pay(ability);
  }

  let resolved = resolveDamage({ ...damage, amount }, defender.thresholds, {
    armorSlotsMarked: armor,
    armorSlotsAvailable: unmarked(defender.armorSlots),
    ...(defender.defenses === undefined ? {} : { defenses: defender.defenses }),
  });

  // ---- the band, stepped down ---------------------------------------------------
  for (const ability of reactions) {
    const reaction = ability.reaction!;
    if (reaction.kind !== 'reduceSeverity' || resolved.hpMarked === 0 || !affordable(ability)) continue;
    // "When you take Severe damage" is about the damage taken, before the slot.
    if (reaction.only !== undefined && resolved.severity !== reaction.only) continue;
    const finalSeverity = reduceSeverity(resolved.finalSeverity, reaction.steps);
    resolved = { ...resolved, finalSeverity, hpMarked: hpForSeverity(finalSeverity) };
    pay(ability);
  }

  return { resolved, armorSlotsMarked: resolved.armorSlotsSpent, reactions: used, hopeSpent, stressMarked };
}

/**
 * Apply a defence the defender chose.
 *
 * `resolveDefense` decides; this obeys. The arithmetic is the same and in the
 * same order — dice off the damage, then Armor Slots, then the severity — but
 * nothing is weighed up: a Rune Ward the player asked for is rolled and paid
 * for even if the die comes up short, which is what happens at a table.
 *
 * Costs are paid for every reaction in the plan. A plan that asks for armor
 * the defender does not have marks what they have.
 */
export function resolveDefensePlan(
  rng: Rng,
  damage: IncomingDamage,
  defender: Defender,
  plan: DefensePlan,
): Defense {
  const used: ReactionUsed[] = [];
  let hopeSpent = 0;
  let stressMarked = 0;
  const pay = (ability: AbilityDef, rolled?: number): void => {
    const record: ReactionUsed = { ability, hopeSpent: ability.cost.hope ?? 0, stressMarked: ability.cost.stress ?? 0 };
    if (rolled !== undefined) record.rolled = rolled;
    hopeSpent += record.hopeSpent;
    stressMarked += record.stressMarked;
    used.push(record);
  };

  let amount = damage.amount;
  for (const ability of plan.reactions) {
    const reaction = ability.reaction;
    if (reaction?.kind !== 'reduceDamage') continue;
    const expression = parseDice(reaction.dice);
    if (expression === null) continue;
    const roll = rollDice(rng, expression);
    amount = Math.max(0, amount - roll.total);
    pay(ability, roll.total);
  }

  const available = unmarked(defender.armorSlots);
  let armor = damage.direct === true ? 0 : Math.min(plan.armorSlots, available);
  for (const ability of plan.reactions) {
    const reaction = ability.reaction;
    if (reaction?.kind !== 'extraArmor') continue;
    armor = Math.min(available, armor + reaction.slots);
    pay(ability);
  }

  let resolved = resolveDamage({ ...damage, amount }, defender.thresholds, {
    armorSlotsMarked: armor,
    armorSlotsAvailable: available,
    ...(defender.defenses === undefined ? {} : { defenses: defender.defenses }),
  });

  for (const ability of plan.reactions) {
    const reaction = ability.reaction;
    if (reaction?.kind !== 'reduceSeverity') continue;
    const finalSeverity = reduceSeverity(resolved.finalSeverity, reaction.steps);
    resolved = { ...resolved, finalSeverity, hpMarked: hpForSeverity(finalSeverity) };
    pay(ability);
  }

  return { resolved, armorSlotsMarked: resolved.armorSlotsSpent, reactions: used, hopeSpent, stressMarked };
}

/**
 * What a plan would cost the defender in Hit Points, without rolling anything.
 *
 * Used to label the options a player is offered. A plan holding a
 * `reduceDamage` reaction has no answer until its dice are rolled, so this
 * returns null and the option is labelled by what it does instead.
 */
export function previewPlan(damage: IncomingDamage, defender: Defender, plan: DefensePlan): number | null {
  if (plan.reactions.some((a) => a.reaction?.kind === 'reduceDamage')) return null;
  const available = unmarked(defender.armorSlots);
  let armor = damage.direct === true ? 0 : Math.min(plan.armorSlots, available);
  for (const ability of plan.reactions) {
    if (ability.reaction?.kind === 'extraArmor') armor = Math.min(available, armor + ability.reaction.slots);
  }
  let resolved = resolveDamage(damage, defender.thresholds, {
    armorSlotsMarked: armor,
    armorSlotsAvailable: available,
    ...(defender.defenses === undefined ? {} : { defenses: defender.defenses }),
  });
  for (const ability of plan.reactions) {
    if (ability.reaction?.kind !== 'reduceSeverity') continue;
    const finalSeverity = reduceSeverity(resolved.finalSeverity, ability.reaction.steps);
    resolved = { ...resolved, finalSeverity, hpMarked: hpForSeverity(finalSeverity) };
  }
  return resolved.hpMarked;
}

/** Whether the defender can pay for this reaction right now. */
export function canPayFor(defender: Pick<Defender, 'hope' | 'stress'>, ability: AbilityDef): boolean {
  const cost = ability.cost;
  if ((cost.hope ?? 0) > 0 && (defender.hope === undefined || !canAfford(defender.hope, cost.hope))) return false;
  if ((cost.stress ?? 0) > 0 && !canMarkStress(defender.stress, cost.stress)) return false;
  return true;
}
