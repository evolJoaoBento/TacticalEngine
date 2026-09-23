/**
 * What a prop does when it is used: its function, as the document stores it.
 *
 * A prop without one is scenery. A prop with one is a thing in the room that can be used - what
 * used to be a separate kind of object is now a prop with a function. What is stored is the
 * function that was *chosen* and its settings, not the effects it turns into: the editor shows
 * exactly what the author picked, a Trapped prop's success and failure are functions of their own
 * that can be opened up and changed, and `scene/prop-functions.ts` turns the choice into play.
 *
 * A leaf of its own, so the document schema and the registry can both use it without either
 * importing the other.
 *
 * Adding a function is two things: its settings here, and a row in the registry built out of the
 * parts in `scene/prop-functions.ts` and the effects in `script/schema.ts`.
 */

import { z } from 'zod';
import { contentIdSchema } from './primitives';
import { checkRequestSchema, checkTraitSchema, effectSchema } from '../script/schema';

/** One thing in a container, and how many of it. */
export const containerItemSchema = z.object({
  item: contentIdSchema,
  count: z.number().int().min(1).default(1),
});
export type ContainerItem = z.infer<typeof containerItemSchema>;

/** The kinds of thing objects were, which a migrated one still says it is. */
export const objectKindSchema = z.enum(['chest', 'door', 'pillar', 'portal', 'scripted']);

const containerFunction = z.object({
  kind: z.literal('container'),
  /** What is inside, added one at a time in the prop's settings. Taken out one at a time in play. */
  items: z.array(containerItemSchema).default([]),
});

/** A door: in the way while it is shut, out of the way while it is open, and used to swap the two. */
const doorFunction = z.object({ kind: z.literal('door') });

/**
 * One of a pair: using it sends you to the other prop with the same `pair`, wherever that is.
 * Empty while it is being set up, and an empty pair is nobody's partner.
 */
const portalFunction = z.object({ kind: z.literal('portal'), pair: z.string().trim().default('') });

/**
 * A check before anything happens: roll the trait against the difficulty, then run one function on
 * a success and another on a failure. Neither has to be anything.
 */
const trappedFunction = z.object({
  kind: z.literal('trapped'),
  trait: checkTraitSchema,
  difficulty: z.number().int().min(1).max(40).default(12),
  /** Rolled again each time it is used, rather than dealt with once. */
  repeatable: z.boolean().default(false),
  get success() {
    return propFunctionSchema.optional();
  },
  get failure() {
    return propFunctionSchema.optional();
  },
});

/**
 * Anything the engine can do, written out: the effects to run, a check with effects per outcome,
 * a key it needs. This is what every object became when objects became props, which is why it
 * keeps everything an object could say - and what an author reaches for when none of the others
 * fits.
 */
const scriptFunction = z.object({
  kind: z.literal('script'),
  /** What sort of thing it was as an object. Decides nothing any more except how it reads. */
  object: objectKindSchema.default('scripted'),
  name: z.string().default(''),
  flavor: z.string().default(''),
  blocksMovement: z.boolean().default(true),
  effects: z.array(effectSchema).default([]),
  check: checkRequestSchema.optional(),
  repeatable: z.boolean().default(false),
  requiresKey: z.string().optional(),
  lockedText: z.string().default(''),
  goto: contentIdSchema.optional(),
  tags: z.array(z.string()).default([]),
  data: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
});

export const propFunctionSchema = z.discriminatedUnion('kind', [
  containerFunction,
  doorFunction,
  portalFunction,
  trappedFunction,
  scriptFunction,
]);

export type PropFunction = z.infer<typeof propFunctionSchema>;
export type PropFunctionKind = PropFunction['kind'];
