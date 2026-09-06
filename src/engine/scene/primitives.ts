/**
 * The small schemas everything else is built from.
 *
 * This module exists to break an import cycle rather than to group things by
 * taste. `script/schema.ts` needs content ids and traits to describe an effect;
 * `scene/schema.ts` needs effects to describe an interactable. Both need these,
 * and a module that imports neither can be imported by both — a cycle between
 * two zod modules is not a type error, it is an `undefined` at module-init time
 * on whichever side loses the race, which surfaces as a baffling schema failure
 * far from its cause.
 *
 * `scene/schema.ts` re-exports all of these, so callers that already import from
 * there keep working.
 */

import { z } from 'zod';

/** Kebab-case, stable across saves. */
export const contentIdSchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/, 'ids are lowercase kebab- or snake-case');

export const traitSchema = z.enum([
  'agility',
  'strength',
  'finesse',
  'instinct',
  'presence',
  'knowledge',
]);
export type Trait = z.infer<typeof traitSchema>;

export const rollOutcomeSchema = z.enum([
  'criticalSuccess',
  'successWithHope',
  'successWithFear',
  'failureWithHope',
  'failureWithFear',
]);

export const pointSchema = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
});
export type Point = z.infer<typeof pointSchema>;
