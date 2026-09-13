/**
 * Dice expressions: parsing, rolling and inspection.
 *
 * Damage is written as `xdy+z` ("1d8+2"). Adversary content in
 * the community adversary data (no longer vendored) is stringly typed ("1d12+2 phy", "2d6"), so the
 * parser accepts a trailing damage-type word and reports it separately rather
 * than rejecting the string.
 */

import type { Rng } from '../core/rng';

/** Physical or magic — the two damage types the SRD distinguishes. */
export type DamageType = 'physical' | 'magic';

export interface DiceExpression {
  /** Number of dice. Zero is legal: a flat "+3" expression. */
  count: number;
  /** Faces per die. Zero when `count` is zero. */
  sides: number;
  /** Flat modifier added after the dice. */
  modifier: number;
}

export interface ParsedDamage extends DiceExpression {
  /**
   * Damage types the source stated, or `undefined` when it stated none.
   * Adversary content writes dual-typed attacks as "1d8+4 phy/mag", which the
   * SRD treats as damage that is both physical and magic at once.
   */
  types?: readonly DamageType[];
}

// A leading "+" is a no-op sign, so an adversary's attack modifier parses with the
// same grammar whether it reads "+3" or "+2d4".
const DICE_PATTERN = /^\+?(?:(\d+)d(\d+))?(?:([+-])?(\d+))?$/;

const DAMAGE_TYPE_WORDS: Record<string, DamageType> = {
  phy: 'physical',
  phys: 'physical',
  physical: 'physical',
  mag: 'magic',
  magic: 'magic',
  magical: 'magic',
};

/**
 * Parse a damage or dice string.
 *
 * Handles every form the vendored SRD content uses: `"2d8+1"`, `"d6"`, `"+3"`,
 * `"1d12+2 phy"`, the dual-typed `"1d8+4 phy/mag"`, the flat `"3 phy"` that several
 * minion adversaries deal, and the dice-valued attack modifier `"+2d4"` that the
 * Outer Realms Abomination rolls.
 *
 * Returns `null` for anything unparseable so an importer can name the offending
 * content id instead of throwing halfway through a pack.
 */
export function parseDice(input: string): ParsedDamage | null {
  if (typeof input !== 'string') return null;
  let text = input.trim().toLowerCase();
  if (text === '') return null;

  // A trailing word names the damage type ("1d12+2 phy", "1d8+4 phy/mag"); an
  // unknown one is an error rather than something to ignore, so bad content
  // surfaces at import time.
  let types: DamageType[] | undefined;
  const typeMatch = /\s+([a-z/]+)\s*$/.exec(text);
  if (typeMatch !== null) {
    const parsed: DamageType[] = [];
    for (const word of typeMatch[1]!.split('/')) {
      const matched = DAMAGE_TYPE_WORDS[word];
      if (matched === undefined) return null;
      if (!parsed.includes(matched)) parsed.push(matched);
    }
    types = parsed;
    text = text.slice(0, typeMatch.index);
  }
  // Interior spacing is free ("2 d 10 + 3"), and "d6" is shorthand for "1d6".
  text = text.replace(/\s+/g, '').replace(/(^|[+-])d(\d)/g, '$11d$2');

  const m = DICE_PATTERN.exec(text);
  if (m === null) return null;
  const [, countRaw, sidesRaw, sign, modRaw] = m;
  if (countRaw === undefined && modRaw === undefined) return null;

  const count = countRaw === undefined ? 0 : Number(countRaw);
  const sides = sidesRaw === undefined ? 0 : Number(sidesRaw);
  if (countRaw !== undefined && sides <= 0) return null;

  const modifier = modRaw === undefined ? 0 : (sign === '-' ? -1 : 1) * Number(modRaw);
  return types === undefined ? { count, sides, modifier } : { count, sides, modifier, types };
}

/** Canonical text for an expression: `"2d8+1"`, `"1d6"`, `"+3"`, `"0"`. */
export function formatDice(expr: DiceExpression): string {
  const dice = expr.count > 0 ? `${expr.count}d${expr.sides}` : '';
  const mod = expr.modifier === 0 ? '' : expr.modifier > 0 ? `+${expr.modifier}` : `${expr.modifier}`;
  if (dice === '' && mod === '') return '0';
  if (dice === '') return mod.startsWith('+') ? mod : mod;
  return dice + mod;
}

/** Highest total the expression can produce — the SRD's critical-damage bonus. */
export function maxDice(expr: DiceExpression): number {
  return expr.count * expr.sides;
}

export interface DiceRoll {
  /** Every die face, in roll order. */
  rolls: number[];
  /** Sum of the dice, before the modifier. */
  diceTotal: number;
  modifier: number;
  /** diceTotal + modifier. */
  total: number;
}

/** Roll an expression. Dice come off the stream in order, so seeds replay exactly. */
export function rollDice(rng: Rng, expr: DiceExpression): DiceRoll {
  const rolls = expr.count > 0 ? rng.dice(expr.count, expr.sides) : [];
  let diceTotal = 0;
  for (const r of rolls) diceTotal += r;
  return { rolls, diceTotal, modifier: expr.modifier, total: diceTotal + expr.modifier };
}

/**
 * Scale an expression by Proficiency: "your Proficiency multiplies the number of
 * dice you roll, but doesn't affect the modifier."
 */
export function withProficiency(expr: DiceExpression, proficiency: number): DiceExpression {
  const p = Math.max(0, Math.trunc(proficiency));
  return { count: expr.count * p, sides: expr.sides, modifier: expr.modifier };
}
