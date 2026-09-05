/**
 * The Daggerheart duality roll (SRD "Action Rolls", "Reaction Rolls",
 * "Advantage & Disadvantage", "Help an Ally", "Group Action Rolls").
 *
 * Pure and DOM-free: takes an `Rng` and a description of the roll, returns a
 * result record. It never mutates a character and never applies the Hope/Fear it
 * reports — the caller decides when resource deltas land, so a roll can be
 * previewed, logged, replayed or animated before it takes effect.
 *
 * Rule text used here is quoted from SRD 2.0,
 * `tools/srd-sources/official-2.0/srd-2.0.txt`. Action rolls, the five outcomes,
 * Help an Ally and reaction rolls are unchanged from SRD 1.0; 2.0 adds an explicit
 * statement that a player never rolls more than one advantage or disadvantage die.
 */

import type { Rng } from '../core/rng';

export const HOPE_DIE_SIDES = 12;
export const FEAR_DIE_SIDES = 12;
export const ADVANTAGE_DIE_SIDES = 6;

export type RollOutcome =
  | 'criticalSuccess'
  | 'successWithHope'
  | 'successWithFear'
  | 'failureWithHope'
  | 'failureWithFear';

export interface DualityRollOptions {
  /** Difficulty to beat. `total >= difficulty` succeeds. */
  difficulty: number;
  /**
   * Flat modifier: the acting trait plus anything else that adds a number —
   * features, items, conditions, a spent-Hope Experience, a Group Action Roll bonus.
   */
  modifier?: number;
  /** Number of sources granting advantage (e.g. a Vulnerable target). */
  advantage?: number;
  /** Number of sources imposing disadvantage. */
  disadvantage?: number;
  /**
   * d6s rolled by allies using Help an Ally. "That player only adds the highest
   * result to their final total." Ignored on reaction rolls — allies can't help.
   */
  helpDice?: number;
  /**
   * A reaction roll: "they don't generate Hope or Fear, don't trigger additional
   * GM moves, and other characters can't aid you with Help an Ally." A critical
   * reaction success clears no Stress and gains no Hope.
   */
  reaction?: boolean;
}

export interface DualityRoll {
  /** Face shown by the Hope die. */
  hope: number;
  /** Face shown by the Fear die. */
  fear: number;
  /** Signed advantage/disadvantage contribution: +d6, -d6, or 0 when they cancel. */
  advantageDie: number;
  /** Every Help an Ally d6 rolled, in roll order (empty on a reaction roll). */
  helpDice: number[];
  /** The single highest Help an Ally die actually added, or 0. */
  helpBonus: number;
  /** The flat modifier that was applied. */
  modifier: number;
  /** hope + fear + advantageDie + helpBonus + modifier. */
  total: number;
  difficulty: number;
  outcome: RollOutcome;
  success: boolean;
  /** Duality dice matched. */
  critical: boolean;
  /** SRD: "A Critical Success counts as a roll 'with Hope.'" */
  withHope: boolean;
  withFear: boolean;
  reaction: boolean;
  /** Hope the acting character gains (0 or 1). Always 0 on a reaction roll. */
  hopeGained: number;
  /** Fear the GM gains (0 or 1). Always 0 on a reaction roll. */
  fearGained: number;
  /** Stress the acting character clears (1 on a non-reaction critical success). */
  stressCleared: number;
  /**
   * The GM should consider making a move. SRD "GM MOVES AND ADVERSARY ACTIONS"
   * lists both triggers this covers: the player "rolls with Fear on an action roll"
   * or "fails an action roll" — so a success with Fear hands the spotlight over too,
   * and only a success with Hope (a crit included) keeps it with the party.
   * The turn policy decides what to do with that; the roll only reports it.
   */
  spotlightToGm: boolean;
}

/**
 * Advantage and disadvantage dice "cancel each other, one-for-one, so you never
 * roll both at the same time", and a surviving imbalance is still a single d6 —
 * the SRD grants "a d6 advantage die", not one per source.
 */
export function netAdvantage(advantage = 0, disadvantage = 0): -1 | 0 | 1 {
  const net = advantage - disadvantage;
  return net > 0 ? 1 : net < 0 ? -1 : 0;
}

/**
 * Group Action Roll: the leader "gains a +1 bonus to their lead action roll for
 * each of these reaction rolls that succeeded and a -1 penalty for each that failed."
 */
export function groupActionModifier(helperReactions: readonly { success: boolean }[]): number {
  let mod = 0;
  for (const r of helperReactions) mod += r.success ? 1 : -1;
  return mod;
}

/** Classify a resolved duality roll. Exported so replays can re-derive an outcome. */
export function classifyRoll(
  hope: number,
  fear: number,
  total: number,
  difficulty: number,
): { outcome: RollOutcome; success: boolean; critical: boolean; withHope: boolean } {
  const critical = hope === fear;
  const success = critical || total >= difficulty;
  // A crit counts as a roll with Hope even though the dice are equal.
  const withHope = critical || hope > fear;
  const outcome: RollOutcome = critical
    ? 'criticalSuccess'
    : success
      ? withHope
        ? 'successWithHope'
        : 'successWithFear'
      : withHope
        ? 'failureWithHope'
        : 'failureWithFear';
  return { outcome, success, critical, withHope };
}

/**
 * Roll the Duality Dice.
 *
 * Dice are drawn in a fixed order — Hope, Fear, advantage/disadvantage, then Help
 * dice — so a seed reproduces the exact roll. Only dice that the rules actually
 * call for are drawn; a roll with no advantage does not consume a d6.
 */
export function rollDuality(rng: Rng, options: DualityRollOptions): DualityRoll {
  const { difficulty, modifier = 0, reaction = false } = options;

  const hope = rng.die(HOPE_DIE_SIDES);
  const fear = rng.die(FEAR_DIE_SIDES);

  const direction = netAdvantage(options.advantage, options.disadvantage);
  const advantageDie = direction === 0 ? 0 : direction * rng.die(ADVANTAGE_DIE_SIDES);

  const helpCount = reaction ? 0 : Math.max(0, Math.trunc(options.helpDice ?? 0));
  const helpDice = rng.dice(helpCount, ADVANTAGE_DIE_SIDES);
  const helpBonus = helpDice.length > 0 ? Math.max(...helpDice) : 0;

  const total = hope + fear + advantageDie + helpBonus + modifier;
  const { outcome, success, critical, withHope } = classifyRoll(hope, fear, total, difficulty);

  return {
    hope,
    fear,
    advantageDie,
    helpDice,
    helpBonus,
    modifier,
    total,
    difficulty,
    outcome,
    success,
    critical,
    withHope,
    withFear: !withHope,
    reaction,
    hopeGained: !reaction && withHope ? 1 : 0,
    fearGained: !reaction && !withHope ? 1 : 0,
    stressCleared: !reaction && critical ? 1 : 0,
    spotlightToGm: !reaction && !(success && withHope),
  };
}
