/**
 * The duality roll (the rules' "Action Rolls", "Reaction Rolls",
 * "Advantage & Disadvantage", "Help an Ally", "Group Action Rolls").
 *
 * Pure and DOM-free: takes an `Rng` and a description of the roll, returns a
 * result record. It never mutates a character and never applies the Light/Shadow it
 * reports — the caller decides when resource deltas land, so a roll can be
 * previewed, logged, replayed or animated before it takes effect.
 *
 * Rule text used here is quoted from SRD 2.0,
 * the SRD 2.0 text (no longer vendored — see `docs/CONTEXT.md`). Action rolls, the five outcomes,
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
   * features, items, conditions, a spent-Light Experience, a Group Action Roll bonus.
   */
  modifier?: number;
  /**
   * The Light Die's faces, for the one card that changes them: "you can roll a
   * d20 as your Light Die". Twelve unless something says otherwise.
   *
   * Only the Light Die moves. The Shadow Die is the GM's half of the pair and no
   * card here touches it, and a critical is still the two showing the same
   * face - which a bigger Light Die makes rarer rather than impossible.
   */
  hopeDieSides?: number;
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
   * A reaction roll: "they don't generate Light or Shadow, don't trigger additional
   * GM moves, and other characters can't aid you with Help an Ally." A critical
   * reaction success clears no Stress and gains no Light.
   */
  reaction?: boolean;
}

export interface DualityRoll {
  /** Face shown by the Light die. */
  hope: number;
  /** Face shown by the Shadow die. */
  fear: number;
  /**
   * The Light Die's faces, present only when they were not the usual twelve —
   * so a roll thrown again knows which die to put back in the cup.
   */
  hopeSides?: number;
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
  /** SRD: "A Critical Success counts as a roll 'with Light.'" */
  withHope: boolean;
  withFear: boolean;
  reaction: boolean;
  /** Light the acting character gains (0 or 1). Always 0 on a reaction roll. */
  hopeGained: number;
  /** Shadow the GM gains (0 or 1). Always 0 on a reaction roll. */
  fearGained: number;
  /** Stress the acting character clears (1 on a non-reaction critical success). */
  stressCleared: number;
  /**
   * The GM should consider making a move. SRD "GM MOVES AND ADVERSARY ACTIONS"
   * lists both triggers this covers: the player "rolls with Shadow on an action roll"
   * or "fails an action roll" — so a success with Shadow hands the spotlight over too,
   * and only a success with Light (a crit included) keeps it with the party.
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
  // A crit counts as a roll with Light even though the dice are equal.
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
 * The same roll with one or both Duality Dice showing something else.
 *
 * "Your ally can reroll their dice", "allow them to reroll either their Light or
 * Shadow Die": the throw has been made and read, and a card puts one of the two
 * back in the cup. Everything that was not the dice stands — the advantage die,
 * the Help dice, the modifier and the Difficulty are all properties of the roll
 * rather than of the faces — and the whole reading is done again from the top,
 * because a new pair can be matched, can cross the Difficulty, and can change
 * which way the Light and Shadow fall.
 *
 * Pure: the faces are drawn by whoever is holding the dice.
 */
export function withFaces(roll: DualityRoll, faces: { hope?: number; fear?: number }): DualityRoll {
  const hope = faces.hope ?? roll.hope;
  const fear = faces.fear ?? roll.fear;
  const total = hope + fear + roll.advantageDie + roll.helpBonus + roll.modifier;
  const { outcome, success, critical, withHope } = classifyRoll(hope, fear, total, roll.difficulty);
  const { reaction } = roll;
  return {
    ...roll,
    hope,
    fear,
    total,
    outcome,
    success,
    critical,
    withHope,
    withFear: !withHope,
    hopeGained: !reaction && withHope ? 1 : 0,
    fearGained: !reaction && !withHope ? 1 : 0,
    stressCleared: !reaction && critical ? 1 : 0,
    spotlightToGm: !reaction && !(success && withHope),
  };
}

/**
 * Roll the Duality Dice.
 *
 * Dice are drawn in a fixed order — Light, Shadow, advantage/disadvantage, then Help
 * dice — so a seed reproduces the exact roll. Only dice that the rules actually
 * call for are drawn; a roll with no advantage does not consume a d6.
 */
export function rollDuality(rng: Rng, options: DualityRollOptions): DualityRoll {
  const { difficulty, modifier = 0, reaction = false } = options;

  const hopeSides = options.hopeDieSides ?? HOPE_DIE_SIDES;
  const hope = rng.die(hopeSides);
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
    ...(hopeSides === HOPE_DIE_SIDES ? {} : { hopeSides }),
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
