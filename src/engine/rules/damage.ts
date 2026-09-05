/**
 * Damage: thresholds, severity, Armor Slots, resistance/immunity, damage rolls.
 *
 * SRD reference: `tools/srd-sources/seansbox/README.md` sections "HIT POINTS &
 * DAMAGE THRESHOLDS", "ATTACKING", "ARMOR / REDUCING INCOMING DAMAGE", and
 * "ADDITIONAL RULES / ROUNDING UP".
 */

import type { Rng } from '../core/rng';
import {
  maxDice,
  rollDice,
  withProficiency,
  type DamageType,
  type DiceExpression,
  type DiceRoll,
} from './dice';

/** Severity bands, ordered from harmless to worst. */
export const SEVERITY_ORDER = ['none', 'minor', 'major', 'severe', 'massive'] as const;
export type DamageSeverity = (typeof SEVERITY_ORDER)[number];

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

export interface DamageDefenses {
  /** Damage types halved before comparing to thresholds. Multiples do not stack. */
  resistances?: readonly DamageType[];
  /** Damage types ignored entirely. */
  immunities?: readonly DamageType[];
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
   * How a critical success adds damage. The two vendored SRD copies disagree:
   * `tools/srd-sources/seansbox/README.md` (a verbatim SRD 1.0 reproduction) says
   * "add the maximum possible result of the damage dice to the final total", while
   * the terser summary in `tools/srd-sources/daggersearch/core/rules.json` says
   * "double the total result of your damage dice before adding modifiers".
   * The verbatim text is the default; the other is selectable.
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
}

export interface ResolveDamageOptions extends SeverityOptions {
  /** Armor Slots the defender chooses to mark. Ignored for direct damage. */
  armorSlotsMarked?: number;
  /** Armor Slots the defender actually has left. Defaults to what they chose. */
  armorSlotsAvailable?: number;
  defenses?: DamageDefenses;
}

export interface ResolvedDamage {
  /** Damage after resistance and immunity — the value compared to thresholds. */
  incoming: number;
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
  const incoming = applyDefenses(damage.amount, damage.types ?? [], options.defenses);
  const severity = severityFor(incoming, thresholds, options);

  const wanted = damage.direct === true ? 0 : Math.max(0, Math.trunc(options.armorSlotsMarked ?? 0));
  const available = Math.max(0, Math.trunc(options.armorSlotsAvailable ?? wanted));
  const useful = SEVERITY_ORDER.indexOf(severity);
  const armorSlotsSpent = Math.min(wanted, available, useful);

  const finalSeverity = reduceSeverity(severity, armorSlotsSpent);
  return {
    incoming,
    severity,
    finalSeverity,
    armorSlotsSpent,
    hpMarked: hpForSeverity(finalSeverity),
  };
}
