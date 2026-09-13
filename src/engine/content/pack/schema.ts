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

/**
 * A class: its numbers, and the domains it opens.
 *
 * What a class *prints* is cards. A card whose `grant` names the class is in play for everybody of
 * that class, and nothing here lists them: the card says where it comes from, so a pack of extra
 * cards for a class somebody else wrote imports without editing the class.
 */
export const classDefSchema = z.object({
  id: contentIdSchema,
  name: z.string().min(1),
  domains: z.array(z.string().min(1)).default([]),
  startingEvasion: z.number().int().min(0),
  startingHitPoints: z.number().int().min(1),
});

/** An ancestry. What it grants is cards, found the same way a class's are. */
export const ancestryDefSchema = z.object({
  id: contentIdSchema,
  name: z.string().min(1),
});

/** A community is shaped exactly as an ancestry: a name, and cards that name it. */
export const communityDefSchema = ancestryDefSchema;

/** A subclass. Its foundation, specialization and mastery are cards granted at that stage. */
export const subclassDefSchema = z.object({
  id: contentIdSchema,
  name: z.string().min(1),
  /** The class this belongs to, as a content id. */
  classId: contentIdSchema,
  domains: z.array(z.string().min(1)).default([]),
  spellcastTrait: traitSchema.optional(),
});

/** How far into a subclass a character has come. */
export const subclassStageSchema = z.enum(['foundation', 'specialization', 'mastery']);

/**
 * How a card came to be in play.
 *
 * The one real difference between a card somebody picked and one they have because of what they
 * are: a chosen card counts against the loadout and can wait in the vault, and a granted one is
 * simply there. Said on the card, rather than inferred from what an ability is attached to.
 */
export const cardGrantSchema = z.discriminatedUnion('kind', [
  /** Picked into a loadout from the domains a class opens. The only kind with a loadout and a vault. */
  z.object({ kind: z.literal('chosen') }),
  /** In play for everybody of the class. */
  z.object({ kind: z.literal('class'), classId: contentIdSchema }),
  /** In play once the character has reached this stage of the subclass. */
  z.object({ kind: z.literal('subclass'), subclassId: contentIdSchema, stage: subclassStageSchema }),
  /** In play for everybody of the ancestry. */
  z.object({ kind: z.literal('ancestry'), ancestryId: contentIdSchema }),
  /** In play for everybody of the community. */
  z.object({ kind: z.literal('community'), communityId: contentIdSchema }),
  /** Handed to named characters: a project giving somebody a card without inventing a class for it. */
  z.object({ kind: z.literal('given'), characters: z.array(contentIdSchema) }),
  /** Printed on stat blocks: a feature of every creature of these blocks, and never a character's. */
  z.object({ kind: z.literal('adversary'), adversaries: z.array(contentIdSchema) }),
]);

/**
 * A card: anything a character has, chosen or granted.
 *
 * Only a chosen card has a domain, a type, a level and a recall cost. Those are loadout mechanics,
 * and a granted card has no loadout, so they are optional here and required of a chosen one. A
 * card left without a grant is a chosen one, which is what every card written before grants
 * existed was.
 */
export const cardDefSchema = z
  .object({
    id: contentIdSchema,
    name: z.string().min(1),
    grant: cardGrantSchema.default({ kind: 'chosen' }),
    domain: z.string().min(1).optional(),
    type: z.enum(['ability', 'spell', 'grimoire']).optional(),
    /** Minimum character level to take it. */
    level: z.number().int().min(1).optional(),
    recallCost: z.number().int().min(0).optional(),
    text: z.string().default(''),
    /** The card's named features: a grimoire's spells. Most cards have one, unnamed. */
    features: z.array(featureSchema).default([]),
  })
  .superRefine((card, ctx) => {
    if (card.grant.kind !== 'chosen') return;
    for (const field of ['domain', 'type', 'level', 'recallCost'] as const) {
      if (card[field] === undefined) {
        ctx.addIssue({ code: 'custom', path: [field], message: `a chosen card needs a ${field}` });
      }
    }
  });

/** An Experience and its modifier: "Tremor Sense +2". */
export const experienceSchema = z.object({
  name: z.string().min(1),
  modifier: z.number().int(),
});

/** What an adversary is for, which is how the GM's side picks one. */
export const adversaryRoleSchema = z.enum([
  'bruiser',
  'horde',
  'leader',
  'minion',
  'ranged',
  'skulk',
  'social',
  'solo',
  'standard',
  'support',
]);

export const adversaryFeatureSchema = z.object({
  name: z.string().min(1),
  kind: z.enum(['passive', 'action', 'reaction']),
  /**
   * The parenthetical in a name like "Relentless (3)", verbatim and unparsed:
   * each feature reads it its own way, so nothing here guesses at it.
   */
  parameter: z.string().optional(),
  /** The countdown printed after the kind, verbatim: "5", "Loop 1d6". */
  countdown: z.string().optional(),
  longTermCountdown: z.boolean().optional(),
  text: z.string().default(''),
  /**
   * Whether using it spends the GM's own currency. Named for what it does
   * rather than for the resource, so renaming that resource never has to reach
   * a stored pack.
   */
  costsGmResource: z.boolean().default(false),
});

export const adversaryDefSchema = z.object({
  id: contentIdSchema,
  name: z.string().min(1),
  tier: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  role: adversaryRoleSchema,
  /** For a horde: how many creatures each marked Hit Point stands for. */
  hordeUnitsPerHp: z.number().int().min(1).optional(),
  description: z.string().default(''),
  motivesAndTactics: z.string().default(''),
  /** Difficulty of rolls made against this adversary. */
  difficulty: z.number().int().min(1),
  thresholds: damageThresholdsSchema,
  hitPoints: z.number().int().min(1),
  stress: z.number().int().min(0),
  attackName: z.string().min(1),
  /** Usually a flat number, but a stat block may roll it, so it is an expression. */
  attackModifier: diceExpressionSchema,
  attackRange: rangeBandSchema,
  attackDamage: parsedDamageSchema,
  experiences: z.array(experienceSchema).default([]),
  features: z.array(adversaryFeatureSchema).default([]),
});

/**
 * Everything a character can be built from, and everything they can be set
 * against. Every list is defaulted, so a pack may carry only what it has and a
 * project that declares none still parses.
 */
export const contentPackSchema = z.object({
  weapons: z.array(weaponDefSchema).default([]),
  armors: z.array(armorDefSchema).default([]),
  classes: z.array(classDefSchema).default([]),
  ancestries: z.array(ancestryDefSchema).default([]),
  communities: z.array(communityDefSchema).default([]),
  subclasses: z.array(subclassDefSchema).default([]),
  cards: z.array(cardDefSchema).default([]),
  adversaries: z.array(adversaryDefSchema).default([]),
});

export type ContentPackDoc = z.infer<typeof contentPackSchema>;
