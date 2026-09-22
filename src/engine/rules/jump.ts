/**
 * Jumping, as a rule a project writes down rather than one the engine insists on.
 *
 * Every number here is a house rule: how much of a block a step takes, which trait carries a
 * jump and how far, what the roll is made with and against, how far down is only a drop, what
 * a fall costs and what a bad landing leaves. The defaults are the demo's. A project that says
 * nothing gets them; one that says `enabled: false` has no jumps at all, and height is a wall.
 *
 * DOM-free arithmetic. Finding where a jump is made from is the game's, in `game/leap.ts`.
 */

import { z } from 'zod';
import { WALKABLE_RISE } from '../grid/pathfinding';
import { traitSchema, type Trait } from '../scene/primitives';

export const jumpRulesSchema = z.object({
  /** Whether anybody jumps. Off, ground out of reach for its height is simply out of reach. */
  enabled: z.boolean().default(true),
  /**
   * The most a step climbs or drops, in blocks; past it is a jump. The default takes half a
   * block and two levels of painted ground, and not three quarters - a block beside a floor tile.
   */
  stepHeight: z.number().min(0).max(16).default(WALKABLE_RISE),
  /** The trait a jump up is carried by, how many blocks anybody makes, and how many more a point of it adds. */
  reachTrait: traitSchema.default('strength'),
  reachBase: z.number().min(0).max(64).default(1),
  reachPerPoint: z.number().min(0).max(16).default(1),
  /**
   * How far a jump carries across the ground, in tiles, on the same trait: what anybody makes,
   * and how many more a point adds. A jump is aimed from where they stand to anywhere inside
   * this, flat ground included.
   */
  rangeBase: z.number().min(0).max(64).default(3),
  rangePerPoint: z.number().min(0).max(16).default(1),
  /** Whether a jump across level ground asks for the roll too. Off, only a climb or a fall does. */
  flatRoll: z.boolean().default(false),
  /** The roll a jump asks for: the trait it is made with, and the Difficulty it is made against. */
  rollTrait: traitSchema.default('agility'),
  difficulty: z.number().int().min(1).max(40).default(12),
  /** The trait a drop is taken on, how many blocks down are only a drop, and how many more a point adds. */
  dropTrait: traitSchema.default('agility'),
  dropBase: z.number().min(0).max(64).default(1),
  dropPerPoint: z.number().min(0).max(16).default(1),
  /** Past a safe drop the roll is one harder for every this many blocks; 0 for never harder. */
  harderEvery: z.number().min(0).max(64).default(2),
  /** The die rolled for each block fallen past safe; 0 for a fall that does not hurt. */
  fallDie: z.number().int().min(0).max(100).default(6),
  /** Whether a success halves the fall. */
  halfOnSuccess: z.boolean().default(true),
  /** The condition a failed roll lands them with; empty for none. */
  failCondition: z.string().default('prone'),
});

export type JumpRules = z.infer<typeof jumpRulesSchema>;

/** The rules as a project that says nothing has them. */
export const DEFAULT_JUMP_RULES: JumpRules = jumpRulesSchema.parse({});

/** What a jump asks of whoever makes it. */
export interface LeapTerms {
  /** The roll's Difficulty, or null for a drop the legs simply take. */
  difficulty: number | null;
  /** Dice of falling damage waiting at the bottom: one for each block past a safe drop. */
  fallDice: number;
}

type Traits = Readonly<Record<Trait, number>>;

/** How many blocks up a jump carries: the base at a trait of 0 or less, and more for each point above. */
export function jumpReach(rules: JumpRules, traits: Traits): number {
  return rules.reachBase + Math.max(0, traits[rules.reachTrait]) * rules.reachPerPoint;
}

/** How many tiles across the ground a jump carries. */
export function jumpRange(rules: JumpRules, traits: Traits): number {
  return rules.rangeBase + Math.max(0, traits[rules.reachTrait]) * rules.rangePerPoint;
}

/**
 * How high a jump arcs over the straight line between its ends, in blocks: a hop clears
 * three quarters of a block, a long jump climbs a third of a block for every tile it crosses,
 * and a jump between heights goes up half as much again as the difference - which is what
 * carries it over the lip of the ledge it is leaving or landing on, rather than into it. One
 * number for the rule and the picture, so what the aim draws is what is checked and what the
 * token then flies.
 */
export function arcLift(tiles: number, rise = 0): number {
  return Math.max(0.75, 0.35 * tiles) + 0.5 * Math.abs(rise);
}

/** How high the arc stands `t` of the way along, from a height of `from` to one of `to`. */
export function arcHeight(from: number, to: number, lift: number, t: number): number {
  return from + (to - from) * t + 4 * lift * t * (1 - t);
}

/** How many blocks down is only a drop. */
export function safeDrop(rules: JumpRules, traits: Traits): number {
  return rules.dropBase + Math.max(0, traits[rules.dropTrait]) * rules.dropPerPoint;
}

/**
 * What a jump of this many blocks asks - up positive, down negative - or null when it cannot
 * be made at all.
 *
 * Across level ground it asks for nothing, unless the project says a flat jump is rolled for.
 * Up is the roll, and is refused past what the reach trait carries. Down is never refused.
 * Within a safe drop it asks for nothing; past it the fall is rolled for, harder the further
 * past safe it goes, and there is a die of damage waiting for each block past safe.
 */
export function leapTerms(rules: JumpRules, rise: number, traits: Traits): LeapTerms | null {
  if (!rules.enabled) return null;
  // Level, or near enough to step: a jump across the ground, which asks only what the project says it does.
  if (Math.abs(rise) <= rules.stepHeight) return { difficulty: rules.flatRoll ? rules.difficulty : null, fallDice: 0 };
  if (rise > 0) return rise > jumpReach(rules, traits) + 1e-6 ? null : { difficulty: rules.difficulty, fallDice: 0 };
  const past = -rise - safeDrop(rules, traits);
  if (past <= 1e-6) return { difficulty: null, fallDice: 0 };
  const harder = rules.harderEvery <= 0 ? 0 : Math.floor(past / rules.harderEvery + 1e-6);
  return { difficulty: rules.difficulty + harder, fallDice: rules.fallDie === 0 ? 0 : Math.ceil(past - 1e-6) };
}
