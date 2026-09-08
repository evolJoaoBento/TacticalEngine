/**
 * Damage: thresholds, severity, Armor Slots, resistance/immunity, damage rolls.
 *
 * SRD 2.0 reference: `tools/srd-sources/official-2.0/srd-2.0.txt`, sections
 * "HIT POINTS & DAMAGE THRESHOLDS", "ATTACKING", "REDUCING INCOMING DAMAGE" and
 * "ADDITIONAL RULES / ROUNDING UP". All four are unchanged from SRD 1.0.
 */

import type { Rng } from '../core/rng';
import {
  maxDice,
  parseDice,
  rollDice,
  withProficiency,
  type DamageType,
  type DiceExpression,
  type DiceRoll,
} from './dice';

/** Severity bands, ordered from harmless to worst. */
export const SEVERITY_ORDER = ['none', 'minor', 'major', 'severe', 'massive'] as const;

export type DamageSeverity = (typeof SEVERITY_ORDER)[number];

/**
 * Whether a blow lands as Severe or worse.
 *
 * "When the Burrower takes Severe damage" is a floor, not a bracket: a blow
 * past twice the Severe threshold is worse than Severe, and everything written
 * about Severe damage still answers it.
 */
export function isSevere(severity: DamageSeverity): boolean {
  return SEVERITY_ORDER.indexOf(severity) >= SEVERITY_ORDER.indexOf('severe');
}

/** Hit Points marked per severity band. */
export const HP_BY_SEVERITY: Readonly<Record<DamageSeverity, number>> = {
  none: 0,
  minor: 1,
  major: 2,
  severe: 3,
  massive: 4,
};

/**
 * A creature's Major and Severe damage thresholds.
 *
 * `Infinity` means the creature has no such threshold, which the vendored
 * adversary data expresses as "None": every Minion has no thresholds at all
 * (all damage is Minor, and their single Hit Point means one hit kills), and the
 * Tiny Oozes have a Major threshold but no Severe one ("4/None").
 */
export interface DamageThresholds {
  major: number;
  severe: number;
}

/** No thresholds — all incoming damage lands in the Minor band. */
export const NO_THRESHOLDS: DamageThresholds = { major: Infinity, severe: Infinity };

/**
 * Parse an adversary stat block's threshold string: `"8/15"`, `"4/None"`, `"None"`.
 * Returns `null` when the string is not one of those shapes, so an importer can
 * name the offending stat block.
 */
export function parseThresholds(input: string): DamageThresholds | null {
  if (typeof input !== 'string') return null;
  const text = input.trim().toLowerCase();
  if (text === '') return null;
  if (text === 'none') return { ...NO_THRESHOLDS };

  const m = /^(\d+|none)\s*\/\s*(\d+|none)$/.exec(text);
  if (m === null) return null;
  const major = m[1] === 'none' ? Infinity : Number(m[1]);
  const severe = m[2] === 'none' ? Infinity : Number(m[2]);
  if (severe < major) return null;
  return { major, severe };
}

/**
 * The optional Massive Damage rule: "If a character ever takes damage equal to
 * twice their Severe threshold, they mark 4 HP instead of 3." Off by default,
 * because the SRD prints it as optional.
 */
export interface SeverityOptions {
  massiveDamage?: boolean;
}

/**
 * Which band incoming damage lands in. `amount` is damage after resistance and
 * before Armor Slots — the SRD calls that "incoming damage".
 */
export function severityFor(
  amount: number,
  thresholds: DamageThresholds,
  options: SeverityOptions = {},
): DamageSeverity {
  if (amount <= 0) return 'none';
  if (options.massiveDamage === true && amount >= thresholds.severe * 2) return 'massive';
  if (amount >= thresholds.severe) return 'severe';
  if (amount >= thresholds.major) return 'major';
  return 'minor';
}

/** Hit Points marked for a severity band. */
export function hpForSeverity(severity: DamageSeverity): number {
  return HP_BY_SEVERITY[severity];
}

/**
 * Step a severity down: "mark one Armor Slot to reduce the severity of the damage
 * by one threshold (Severe to Major, Major to Minor, Minor to Nothing)".
 * Massive steps down to Severe, keeping the ladder consistent.
 */
export function reduceSeverity(severity: DamageSeverity, steps = 1): DamageSeverity {
  const i = SEVERITY_ORDER.indexOf(severity);
  return SEVERITY_ORDER[Math.max(0, i - Math.max(0, Math.trunc(steps)))]!;
}

/**
 * A PC's thresholds: the armor's base thresholds plus the character's level.
 * Unarmored, "their Major threshold is equal to their level, and their Severe
 * threshold is equal to twice their level".
 */
export function pcThresholds(level: number, armor?: DamageThresholds | null): DamageThresholds {
  if (armor === undefined || armor === null) return { major: level, severe: level * 2 };
  return { major: armor.major + level, severe: armor.severe + level };
}

/** A PC's Armor Score can't exceed 12. */
export const MAX_ARMOR_SCORE = 12;

/** Armor Slots available: the armor's base score plus bonuses, clamped to [0, 12]. */
export function armorScore(baseScore: number, bonus = 0): number {
  return Math.min(MAX_ARMOR_SCORE, Math.max(0, baseScore + bonus));
}

/**
 * Damage taken off the total before thresholds: "when the Knight takes physical
 * damage, reduce it by 3", "when the Undefeated Champion takes damage, reduce
 * it by 1d10".
 *
 * One string carries both shapes, because the SRD prints them as one sentence
 * with one number: "3" parses as a flat expression and "1d10" as a die. The
 * flat part is arithmetic `resolveDamage` does alone; the dice have to be
 * rolled, which is `rollReduction`, once per damage event.
 */
export interface DamageReduction {
  /** "3", "1d10", "2d10+1". */
  dice: string;
  /**
   * Only against damage of this type; omitted means every kind. Damage that
   * carries the type at all is reduced: the SRD's "only if the target has it
   * for both" is printed for resistance and immunity, and not for this.
   */
  only?: DamageType;
}

export interface DamageDefenses {
  /** Damage types halved before comparing to thresholds. Multiples do not stack. */
  resistances?: readonly DamageType[];
  /** Damage types ignored entirely. */
  immunities?: readonly DamageType[];
  /**
   * Damage taken off before thresholds. Entries stack. The flat half of each
   * is applied by `resolveDamage` itself, so it reaches every path damage
   * takes; the dice half is rolled by `rollReduction` and handed back as
   * `rolledReduction`, so a caller with no `Rng` — a preview — gets a number
   * that can only be too high, never too low.
   */
  reduce?: readonly DamageReduction[];
}

/** Whether a reduction answers damage of these types. */
function reduces(entry: DamageReduction, types: readonly DamageType[]): boolean {
  return entry.only === undefined || types.includes(entry.only);
}

/** The half of a creature's reduction that needs no dice. */
export function flatReduction(types: readonly DamageType[], defenses: DamageDefenses = {}): number {
  let total = 0;
  for (const entry of defenses.reduce ?? []) {
    if (!reduces(entry, types)) continue;
    total += parseDice(entry.dice)?.modifier ?? 0;
  }
  return total;
}

/** Whether any reduction still has dice to roll, which a preview cannot know. */
export function reductionRolls(defenses: DamageDefenses = {}): boolean {
  return (defenses.reduce ?? []).some((entry) => (parseDice(entry.dice)?.count ?? 0) > 0);
}

/**
 * Roll the dice half of a creature's reduction, once per damage event.
 *
 * Nothing comes off the stream when there is nothing to roll, so a seed
 * replays the same way for every creature without one.
 */
export function rollReduction(
  rng: Rng,
  types: readonly DamageType[],
  defenses: DamageDefenses = {},
): number {
  let total = 0;
  for (const entry of defenses.reduce ?? []) {
    if (!reduces(entry, types)) continue;
    const expression = parseDice(entry.dice);
    if (expression === null || expression.count === 0) continue;
    // The modifier is the flat half and is applied elsewhere; only the dice.
    total += rollDice(rng, { count: expression.count, sides: expression.sides, modifier: 0 }).total;
  }
  return total;
}

/**
 * Apply resistance and immunity. Halving rounds up ("this game doesn't use
 * fractions; round up unless otherwise specified"). An attack dealing both
 * physical and magic damage only benefits from resistance or immunity if the
 * target has it for both.
 */
export function applyDefenses(
  amount: number,
  types: readonly DamageType[],
  defenses: DamageDefenses = {},
): number {
  if (amount <= 0) return 0;
  if (types.length === 0) return amount;
  const immunities = defenses.immunities ?? [];
  const resistances = defenses.resistances ?? [];
  if (types.every((t) => immunities.includes(t))) return 0;
  if (types.every((t) => resistances.includes(t) || immunities.includes(t))) {
    return Math.ceil(amount / 2);
  }
  return amount;
}

export interface DamageRollOptions {
  /** Multiplies the number of dice, never the modifier. Defaults to 1. */
  proficiency?: number;
  /** A critical success adds the critical bonus. */
  critical?: boolean;
  /**
   * How a critical success adds damage. The official text — SRD 1.0 and 2.0 alike —
   * says "add the maximum possible result of the damage dice to the final total",
   * which is the default here. The community summary in
   * `tools/srd-sources/daggersearch/core/rules.json` instead says "double the total
   * result of your damage dice"; that contradicts both official versions and is an
   * error in that file, but it is selectable for a table that plays it that way.
   */
  criticalRule?: 'maxDicePlusRoll' | 'doubleDice';
  /** Extra flat damage from features, items or effects, added after the dice. */
  bonus?: number;
}

export interface DamageRollResult extends DiceRoll {
  /** The expression actually rolled, after Proficiency scaling. */
  expression: DiceExpression;
  critical: boolean;
  /** Damage added by the critical rule (0 when not a crit). */
  criticalBonus: number;
  bonus: number;
}

/**
 * Roll damage. `expr` is the weapon or feature's listed damage ("d8+2"); the
 * Proficiency scaling and the critical bonus are applied here so callers never
 * duplicate the arithmetic.
 */
export function rollDamage(
  rng: Rng,
  expr: DiceExpression,
  options: DamageRollOptions = {},
): DamageRollResult {
  const { proficiency = 1, critical = false, criticalRule = 'maxDicePlusRoll', bonus = 0 } = options;
  const expression = withProficiency(expr, proficiency);
  const roll = rollDice(rng, expression);

  const criticalBonus = !critical
    ? 0
    : criticalRule === 'doubleDice'
      ? roll.diceTotal
      : maxDice(expression);

  return {
    ...roll,
    expression,
    critical,
    criticalBonus,
    bonus,
    total: roll.total + criticalBonus + bonus,
  };
}

export interface IncomingDamage {
  /** Damage as rolled, before defenses. */
  amount: number;
  /** Types the damage carries; an empty list means untyped and never reduced. */
  types?: readonly DamageType[];
  /** "Direct damage is damage that can't be reduced by marking Armor Slots." */
  direct?: boolean;
  /**
   * The band, named outright: "they deal Severe damage instead of their
   * standard damage". There is no number to compare, so the thresholds are not
   * read and nothing that takes damage off a total - resistance, a reduction,
   * a die spent to soften it - has anything to work on. Armor Slots still step
   * the band down, which is how a table plays it: the blow is Severe, and the
   * armor is what answers it.
   */
  severity?: DamageSeverity;
}

export interface ResolveDamageOptions extends SeverityOptions {
  /** Armor Slots the defender chooses to mark. Ignored for direct damage. */
  armorSlotsMarked?: number;
  /** Armor Slots the defender actually has left. Defaults to what they chose. */
  armorSlotsAvailable?: number;
  defenses?: DamageDefenses;
  /**
   * The dice half of the defender's reduction, already rolled off an `Rng` by
   * `rollReduction`. Left out, only the flat half applies.
   */
  rolledReduction?: number;
}

export interface ResolvedDamage {
  /** Damage after resistance, immunity and reduction — the value compared to thresholds. */
  incoming: number;
  /** Damage the defender's reduction took off, after any halving. */
  reduced: number;
  /** Band before Armor Slots. */
  severity: DamageSeverity;
  /** Band after Armor Slots. */
  finalSeverity: DamageSeverity;
  /** Armor Slots actually spent, capped by availability and by the band itself. */
  armorSlotsSpent: number;
  /** Hit Points the defender marks. */
  hpMarked: number;
}

/**
 * Resolve one damage event end to end: defenses, thresholds, Armor Slots, HP.
 *
 * Marking more Armor Slots than the severity can absorb changes nothing, so the
 * result reports only the slots that mattered — a UI should offer that maximum
 * rather than letting a player waste armor.
 */
export function resolveDamage(
  damage: IncomingDamage,
  thresholds: DamageThresholds,
  options: ResolveDamageOptions = {},
): ResolvedDamage {
  const types = damage.types ?? [];
  const halved = applyDefenses(damage.amount, types, options.defenses);
  // Resistance halves, and reduction comes off what is left. No stat block in
  // the SRD has both, so the order is ours to pick; this one keeps the halving
  // about the attack and the reduction about the armor answering it.
  const reduction =
    halved <= 0
      ? 0
      : flatReduction(types, options.defenses) + Math.max(0, Math.trunc(options.rolledReduction ?? 0));
  const incoming = Math.max(0, halved - reduction);
  const severity = damage.severity ?? severityFor(incoming, thresholds, options);

  const wanted = damage.direct === true ? 0 : Math.max(0, Math.trunc(options.armorSlotsMarked ?? 0));
  const available = Math.max(0, Math.trunc(options.armorSlotsAvailable ?? wanted));
  const useful = SEVERITY_ORDER.indexOf(severity);
  const armorSlotsSpent = Math.min(wanted, available, useful);

  const finalSeverity = reduceSeverity(severity, armorSlotsSpent);
  return {
    incoming,
    reduced: halved - incoming,
    severity,
    finalSeverity,
    armorSlotsSpent,
    hpMarked: hpForSeverity(finalSeverity),
  };
}
