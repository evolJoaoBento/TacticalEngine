/**
 * Resolving one attack, end to end: geometry, the roll, damage, thresholds.
 *
 * The two halves of the SRD's attack rules are genuinely different, and this is
 * where that shows. A PC "rolls the Duality Dice and applies the weapon's attack
 * modifier" against the target's Difficulty; the GM "has no Duality Dice; instead,
 * they roll a single d20" against the target's Evasion, criting on a natural 20.
 * The legacy prototype rolled a d12 for adversaries and subtracted flat damage
 * from a hit-point number, which is neither.
 *
 * `resolveAttack` is pure — it rolls and reports, changing nothing. `applyAttack`
 * is the only function here that mutates, so an attack can be previewed, logged,
 * replayed from a seed, or animated before it lands.
 */

import type { Rng } from '../core/rng';
import type { Trait } from '../scene/primitives';
import { TileGrid } from '../grid/grid';
import { rollDuality, type DualityRoll } from '../rules/duality';
import { rollGmDie, type GmRoll } from '../rules/gm-die';
import { rollDice, type DiceExpression, type ParsedDamage } from '../rules/dice';
import {
  resolveDamage,
  rollDamage,
  rollReduction,
  type DamageDefenses,
  type DamageRollOptions,
  type DamageRollResult,
  type DamageThresholds,
  type ResolvedDamage,
} from '../rules/damage';
import type { RangeBand } from '../rules/range';
import { mark, markHitPoints, unmarked, type MarkPool } from '../rules/resources';
import type { EntityState, SceneState } from '../scene/state';
import { evaluateTarget, type TargetingOptions, type TargetingReport } from './targeting';

/** How the attacker rolls: a PC uses Duality Dice, an adversary the GM's Die. */
export type AttackerKind = 'pc' | 'adversary';

export interface AttackProfile {
  kind: AttackerKind;
  name: string;
  /**
   * The attack modifier. Flat for almost everything, but one SRD stat block
   * rolls it ("+2d4"), so it is a dice expression rather than a number.
   */
  modifier: DiceExpression;
  /** Maximum range. Anything closer can be attacked too. */
  range: RangeBand;
  damage: ParsedDamage;
  /**
   * PCs multiply their damage dice by Proficiency; adversaries roll their listed
   * damage as printed. Ignored for an adversary attack.
   */
  proficiency?: number;
  /** Damage that cannot be reduced by marking Armor Slots. */
  direct?: boolean;
  /**
   * The trait the swing rolls with - the weapon's, for a PC - so a card that
   * asks "when you make a Presence Roll" can hear a swing as well as a check.
   * A stat block rolls its printed modifier and names none.
   */
  trait?: Trait;
  /**
   * Twice what the dice said — "the Demon deals double damage to PCs with 0
   * Light". Doubled once the dice are in, so the thresholds read the number
   * that actually landed.
   */
  double?: boolean;
}

export interface DefenderProfile {
  /**
   * The Difficulty of the attack roll. For a PC target that is their Evasion;
   * for an adversary target it is the stat block's Difficulty score.
   */
  difficulty: number;
  thresholds: DamageThresholds;
  defenses?: DamageDefenses;
}

/**
 * Cover needs no house rule under SRD 2.0.
 *
 * 1.0 added cover to the target's *Evasion*, which is a PC stat — adversaries
 * have a Difficulty score instead, so applying it to both sides took an engine
 * decision. 2.0 instead makes the attacker "roll with disadvantage", which is a
 * property of the roll and applies identically whoever is making it.
 */

export interface AttackOptions extends TargetingOptions {
  /** Extra advantage sources on top of those the conditions imply. */
  advantage?: number;
  disadvantage?: number;
  /** Help an Ally dice. PC attacks only — the GM cannot be helped. */
  helpDice?: number;
  /** The attacker's Light Die, when a card has made it something other than a d12. */
  goodDieSides?: number;
  /** Flat modifier on top of the profile's: an Experience, a feature, terrain. */
  bonus?: number;
  /**
   * Armor Slots the defender chooses to mark against this hit. What they can
   * actually spend comes from the target entity's own pool, never from a
   * separate number — two sources of truth there would silently under-damage a
   * target that marked armor it did not have.
   */
  armorSlotsMarked?: number;
  /** Extra flat damage from features or items. */
  damageBonus?: number;
  criticalRule?: DamageRollOptions['criticalRule'];
  /** The optional Massive Damage rule. */
  massiveDamage?: boolean;
  /**
   * A swing that is not rolled at all: Blaze of Glory's "take one final
   * action. It automatically critically succeeds (with GM approval)". The
   * targeting is still read - a final action still has to reach somebody - and
   * the damage is counted as a critical's, but there is no duality roll, so
   * there is no Light, no Shadow and no move handed to the GM off the back of it.
   */
  automatic?: 'criticalSuccess';
  /**
   * A swing whose Duality Dice have already been thrown: a card put one of
   * them back in the cup, and the blow is being resolved again around the new
   * pair. No dice are drawn for the attack roll, so the stream goes straight
   * to the damage — which is rolled fresh, because a roll that has become a
   * critical needs a critical's dice and the old throw never had them.
   *
   * The advantage and disadvantage counts are still worked out and reported,
   * but nothing is drawn for them: the roll handed in already carries the
   * advantage die it was thrown with, and drawing a second would be the same
   * die counted twice. So a condition that has not been spent yet - Inevitable,
   * in the moment between the throw and the end of it - does not pay twice
   * here, and the numbers on the outcome are a report rather than a re-roll.
   *
   * PC attacks only; the GM's Die has no such card behind it.
   */
  roll?: DualityRoll;
}

export interface AttackOutcome {
  attackerId: string;
  targetId: string;
  profile: AttackProfile;
  targeting: TargetingReport;
  /** Set when the attack could not be attempted at all; nothing was rolled. */
  refused: TargetingReport['refusal'];
  /** The rolled attack modifier, after any dice in it. */
  modifier: number;
  /** Advantage and disadvantage sources actually applied. */
  advantage: number;
  disadvantage: number;
  /** Exactly one of these is set on an attack that was rolled. */
  dualityRoll?: DualityRoll;
  gmRoll?: GmRoll;
  hit: boolean;
  critical: boolean;
  /** Set when the attack hit. */
  damageRoll?: DamageRollResult;
  damage?: ResolvedDamage;
  /** Hit Points the target marks. */
  hitPointsMarked: number;
  /** Light the attacker gains and Shadow the GM gains, from a PC's duality roll. */
  goodGained: number;
  badGained: number;
  stressCleared: number;
  /** Whether the spotlight should pass to the GM after this. */
  spotlightToGm: boolean;
}

/**
 * Conditions that change an attack roll, per the SRD's standard conditions:
 * "When a creature is Vulnerable, all rolls targeting them have advantage", and
 * "Any rolls against a Hidden creature have disadvantage".
 */
export function conditionModifiers(target: Pick<EntityState, 'conditions'>): {
  advantage: number;
  disadvantage: number;
} {
  return {
    advantage: target.conditions.has('vulnerable') ? 1 : 0,
    disadvantage: target.conditions.has('hidden') ? 1 : 0,
  };
}

export interface AttackRequest {
  grid: TileGrid;
  attacker: EntityState;
  target: EntityState;
  profile: AttackProfile;
  defender: DefenderProfile;
  options?: AttackOptions;
}

/**
 * Roll an attack and work out what it would do. Changes nothing.
 *
 * Dice leave the stream in a fixed order — the attack modifier's dice, the attack
 * roll, then damage — so a seed replays an attack exactly. A refused attack draws
 * nothing at all, which keeps a UI's range preview from shifting the stream.
 */
export function resolveAttack(rng: Rng, request: AttackRequest): AttackOutcome {
  const { grid, attacker, target, profile, defender } = request;
  const options = request.options ?? {};

  const targeting = evaluateTarget(grid, attacker.tile, target.tile, profile.range, options);

  const base: AttackOutcome = {
    attackerId: attacker.id,
    targetId: target.id,
    profile,
    targeting,
    refused: targeting.refusal,
    modifier: 0,
    advantage: 0,
    disadvantage: 0,
    hit: false,
    critical: false,
    hitPointsMarked: 0,
    goodGained: 0,
    badGained: 0,
    stressCleared: 0,
    spotlightToGm: false,
  };
  if (targeting.refusal !== null) return base;

  const conditions = conditionModifiers(target);
  const advantage = conditions.advantage + (options.advantage ?? 0);
  const disadvantage =
    conditions.disadvantage + targeting.coverDisadvantage + (options.disadvantage ?? 0);

  const modifier = rollDice(rng, profile.modifier).total + (options.bonus ?? 0);
  // SRD 2.0: cover costs the attacker a disadvantage die; it does not touch the
  // target's Difficulty. Advantage and disadvantage still cancel one for one, so
  // an attacker with advantage can shoot through cover unimpeded.
  const difficulty = defender.difficulty;

  let hit: boolean;
  let critical: boolean;
  let dualityRoll: DualityRoll | undefined;
  let gmRoll: GmRoll | undefined;
  let goodGained = 0;
  let badGained = 0;
  let stressCleared = 0;
  let spotlightToGm = false;

  if (options.automatic === 'criticalSuccess') {
    hit = true;
    critical = true;
  } else if (profile.kind === 'pc') {
    dualityRoll =
      options.roll ??
      rollDuality(rng, {
        difficulty,
        modifier,
        advantage,
        disadvantage,
        helpDice: options.helpDice ?? 0,
        ...(options.goodDieSides === undefined ? {} : { goodDieSides: options.goodDieSides }),
      });
    hit = dualityRoll.success;
    critical = dualityRoll.critical;
    goodGained = dualityRoll.goodGained;
    badGained = dualityRoll.badGained;
    stressCleared = dualityRoll.stressCleared;
    spotlightToGm = dualityRoll.spotlightToGm;
  } else {
    gmRoll = rollGmDie(rng, { difficulty, modifier, advantage, disadvantage });
    hit = gmRoll.success;
    critical = gmRoll.critical;
  }

  const outcome: AttackOutcome = {
    ...base,
    refused: null,
    modifier,
    advantage,
    disadvantage,
    hit,
    critical,
    goodGained,
    badGained,
    stressCleared,
    spotlightToGm,
  };
  if (dualityRoll !== undefined) outcome.dualityRoll = dualityRoll;
  if (gmRoll !== undefined) outcome.gmRoll = gmRoll;
  if (!hit) return outcome;

  const rolled = rollDamage(rng, profile.damage, {
    // Only a PC's weapon damage scales with Proficiency.
    proficiency: profile.kind === 'pc' ? (profile.proficiency ?? 1) : 1,
    critical,
    ...(options.criticalRule === undefined ? {} : { criticalRule: options.criticalRule }),
    bonus: options.damageBonus ?? 0,
  });
  // "Double damage": the total, twice, once the dice have settled - so a
  // bonus doubles with them and the thresholds read what landed.
  const damageRoll = profile.double === true ? { ...rolled, total: rolled.total * 2 } : rolled;

  // A PC's swing at an adversary is resolved here and nowhere else — there is
  // no defence step on that side — so the defender's reduction is rolled here.
  const rolledReduction = rollReduction(rng, profile.damage.types ?? [], defender.defenses ?? {});
  const damage = resolveDamage(
    {
      amount: damageRoll.total,
      types: profile.damage.types ?? [],
      ...(profile.direct === undefined ? {} : { direct: profile.direct }),
    },
    defender.thresholds,
    {
      armorSlotsMarked: options.armorSlotsMarked ?? 0,
      armorSlotsAvailable: unmarked(target.armorSlots),
      ...(rolledReduction === 0 ? {} : { rolledReduction }),
      ...(defender.defenses === undefined ? {} : { defenses: defender.defenses }),
      ...(options.massiveDamage === undefined ? {} : { massiveDamage: options.massiveDamage }),
    },
  );

  return { ...outcome, damageRoll, damage, hitPointsMarked: damage.hpMarked };
}

export interface AppliedAttack {
  /** Hit Points actually marked, after the target's remaining slots. */
  hitPointsMarked: number;
  /** Armor Slots actually spent. */
  armorSlotsSpent: number;
  /** The target marked its last Hit Point and must make a death move. */
  fell: boolean;
  /** Light the attacker actually gained, after the cap. */
  goodGained: number;
  /** Shadow the GM actually gained, after the cap. */
  badGained: number;
  /** Stress the attacker actually cleared. */
  stressCleared: number;
}

/**
 * Apply a resolved attack to the scene: mark the target's Hit Points and Armor
 * Slots, move the attacker's Light, the GM's Shadow and the attacker's Stress.
 *
 * Reports what actually happened rather than what was asked for — Light at its cap
 * does not accrue, and a target with one slot left marks one Hit Point however
 * severe the hit was.
 */
export function applyAttack(state: SceneState, outcome: AttackOutcome): AppliedAttack {
  const applied: AppliedAttack = {
    hitPointsMarked: 0,
    armorSlotsSpent: 0,
    fell: false,
    goodGained: 0,
    badGained: 0,
    stressCleared: 0,
  };

  const attacker = state.entity(outcome.attackerId);
  if (attacker !== undefined) {
    if (outcome.goodGained > 0 && attacker.good !== undefined) {
      const before = attacker.good.value;
      attacker.good = {
        max: attacker.good.max,
        value: Math.min(attacker.good.max, before + outcome.goodGained),
      };
      applied.goodGained = attacker.good.value - before;
    }
    if (outcome.stressCleared > 0) {
      const cleared = Math.min(outcome.stressCleared, attacker.stress.marked);
      attacker.stress = { max: attacker.stress.max, marked: attacker.stress.marked - cleared };
      applied.stressCleared = cleared;
    }
  }

  if (outcome.badGained > 0) {
    const before = state.bad.value;
    state.bad = {
      max: state.bad.max,
      value: Math.min(state.bad.max, before + outcome.badGained),
    };
    applied.badGained = state.bad.value - before;
  }

  const target = state.entity(outcome.targetId);
  if (target === undefined || outcome.damage === undefined) return applied;

  if (outcome.damage.armorSlotsSpent > 0) {
    const spent: { pool: MarkPool; applied: number } = mark(
      target.armorSlots,
      outcome.damage.armorSlotsSpent,
    );
    target.armorSlots = spent.pool;
    applied.armorSlotsSpent = spent.applied;
  }

  const marked = markHitPoints(target.hitPoints, outcome.hitPointsMarked);
  target.hitPoints = marked.hitPoints;
  applied.hitPointsMarked = marked.hpMarked;
  applied.fell = marked.fell;
  if (marked.fell) target.alive = false;

  return applied;
}
