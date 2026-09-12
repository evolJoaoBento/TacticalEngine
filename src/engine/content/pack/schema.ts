/**
 * What a content pack is, as a document.
 *
 * The engine reads character content through a parameter rather than a fixed
 * catalogue, so a pack is simply data: classes, ancestries, cards and the
 * equipment they use. These schemas are the contract a pack is validated
 * against, whether it ships with the engine, rides inside a project, or is
 * imported from somewhere else entirely.
 */

import { z } from 'zod';
import { contentIdSchema, traitSchema } from '../../scene/primitives';
import { RANGE_BANDS } from '../../rules/range';

/** A named piece of rules text on a class, ancestry, card or weapon. */
export const featureSchema = z.object({
  name: z.string(),
  text: z.string(),
});

export const rangeBandSchema = z.enum(RANGE_BANDS);

export const diceExpressionSchema = z.object({
  /** Zero is legal: a flat "+3" expression. */
  count: z.number().int().min(0),
  /** Zero when `count` is zero. */
  sides: z.number().int().min(0),
  modifier: z.number().int(),
});

export const damageTypeSchema = z.enum(['physical', 'magic']);

export const parsedDamageSchema = diceExpressionSchema.extend({
  /** Types the source stated, or absent when it stated none. */
  types: z.array(damageTypeSchema).optional(),
});

/**
 * Finite and non-negative, deliberately. `NO_THRESHOLDS` uses `Infinity`, which
 * `JSON.stringify` writes as `null` — a pack that wants "nothing reaches this
 * band" writes a large number rather than an unstorable one.
 */
export const damageThresholdsSchema = z.object({
  major: z.number().int().min(0),
  severe: z.number().int().min(0),
});

export const weaponDefSchema = z.object({
  id: contentIdSchema,
  name: z.string().min(1),
  tier: z.number().int().min(1),
  slot: z.enum(['primaryPhysical', 'primaryMagic', 'secondary']),
  trait: traitSchema,
  range: rangeBandSchema,
  /** Damage before Proficiency multiplies the dice. */
  damage: parsedDamageSchema,
  burden: z.enum(['oneHanded', 'twoHanded']),
  features: z.array(featureSchema).default([]),
});

export const armorDefSchema = z.object({
  id: contentIdSchema,
  name: z.string().min(1),
  tier: z.number().int().min(1),
  /** Before the wearer's level is added. */
  baseThresholds: damageThresholdsSchema,
  baseScore: z.number().int().min(0),
  features: z.array(featureSchema).default([]),
});

export const classDefSchema = z.object({
  id: contentIdSchema,
  name: z.string().min(1),
  domains: z.array(z.string().min(1)).default([]),
  startingEvasion: z.number().int().min(0),
  startingHitPoints: z.number().int().min(1),
  /**
   * The feature a class grants for its own resource. Named for what it is
   * rather than for the resource, so renaming the resource never touches a
   * saved pack.
   */
  signatureFeature: featureSchema.optional(),
  features: z.array(featureSchema).default([]),
});

export const ancestryDefSchema = z.object({
  id: contentIdSchema,
  name: z.string().min(1),
  features: z.array(featureSchema).default([]),
});

/** A community is shaped exactly as an ancestry: a name and what it grants. */
export const communityDefSchema = ancestryDefSchema;

export const subclassDefSchema = z.object({
  id: contentIdSchema,
  name: z.string().min(1),
  /** The class this belongs to, as a content id. */
  classId: contentIdSchema,
  domains: z.array(z.string().min(1)).default([]),
  spellcastTrait: traitSchema.optional(),
  foundation: z.array(featureSchema).default([]),
  specialization: z.array(featureSchema).default([]),
  mastery: z.array(featureSchema).default([]),
});

export const domainCardDefSchema = z.object({
  id: contentIdSchema,
  name: z.string().min(1),
  domain: z.string().min(1),
  type: z.enum(['ability', 'spell', 'grimoire']),
  /** Minimum character level to take it. */
  level: z.number().int().min(1),
  recallCost: z.number().int().min(0),
  text: z.string().default(''),
  /** The card's named features: a grimoire's spells. Most cards have one, unnamed. */
  features: z.array(featureSchema).default([]),
});

/**
 * Everything a character can be built from. Every list is defaulted, so a pack
 * may carry only what it has and a project that declares none still parses.
 */
export const contentPackSchema = z.object({
  weapons: z.array(weaponDefSchema).default([]),
  armors: z.array(armorDefSchema).default([]),
  classes: z.array(classDefSchema).default([]),
  ancestries: z.array(ancestryDefSchema).default([]),
  communities: z.array(communityDefSchema).default([]),
  subclasses: z.array(subclassDefSchema).default([]),
  domainCards: z.array(domainCardDefSchema).default([]),
});

export type ContentPackDoc = z.infer<typeof contentPackSchema>;
