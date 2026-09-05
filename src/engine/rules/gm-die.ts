/**
 * The GM's Die.
 *
 * SRD reference: `tools/srd-sources/seansbox/README.md`, "CORE GM MECHANICS":
 * "The GM has no Duality Dice; instead, they roll a single d20 called the GM's
 * Die." Adversary attacks therefore resolve differently from PC attacks — no
 * Hope, no Fear, no matched-dice critical — which the legacy prototype missed by
 * rolling a d12 for adversaries.
 *
 * Pure, like the duality roll: it reports what happened and never applies it.
 */

import type { Rng } from '../core/rng';
import { ADVANTAGE_DIE_SIDES, netAdvantage } from './duality';

export const GM_DIE_SIDES = 20;

export interface GmRollOptions {
  /** The target's Evasion for an attack, or whatever Difficulty the move sets. */
  difficulty: number;
  /** The adversary's attack bonus, plus anything else that adds a flat number. */
  modifier?: number;
  /** Sources granting an advantage die — a Vulnerable target, for instance. */
  advantage?: number;
  /** Sources imposing a disadvantage die — a Hidden target, for instance. */
  disadvantage?: number;
  /**
   * A reaction roll. "A critical success on an adversary's reaction roll
   * automatically succeeds, but confers no additional benefit" — so a natural 20
   * still succeeds, but grants no critical damage.
   */
  reaction?: boolean;
}

export interface GmRoll {
  /** The face on the d20. */
  die: number;
  /** Signed advantage/disadvantage contribution: +d6, -d6, or 0. */
  advantageDie: number;
  modifier: number;
  /** die + advantageDie + modifier. */
  total: number;
  difficulty: number;
  success: boolean;
  /**
   * A natural 20: "your roll automatically succeeds and you deal extra damage."
   * False on a reaction roll, which gains nothing from a critical.
   */
  critical: boolean;
  reaction: boolean;
}

/**
 * Roll the GM's Die against a Difficulty.
 *
 * Dice come off the stream in a fixed order — the d20, then any advantage or
 * disadvantage die — so a seed reproduces the roll exactly.
 */
export function rollGmDie(rng: Rng, options: GmRollOptions): GmRoll {
  const { difficulty, modifier = 0, reaction = false } = options;

  const die = rng.die(GM_DIE_SIDES);
  const direction = netAdvantage(options.advantage, options.disadvantage);
  const advantageDie = direction === 0 ? 0 : direction * rng.die(ADVANTAGE_DIE_SIDES);

  const total = die + advantageDie + modifier;
  const natural20 = die === GM_DIE_SIDES;

  return {
    die,
    advantageDie,
    modifier,
    total,
    difficulty,
    // A natural 20 succeeds however the modifiers land.
    success: natural20 || total >= difficulty,
    critical: natural20 && !reaction,
    reaction,
  };
}
