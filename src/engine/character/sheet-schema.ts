/**
 * The zod mirror of `CharacterSheet`, for sheets that arrive from outside the
 * process — a save file, a project's party. `deriveCharacter` checks that the
 * content ids exist; this checks that the shape is a sheet at all, so a
 * corrupted save fails at the door rather than as `tierOf("banana")` three
 * fights in. Typing `parseSheet`'s return as the interface keeps the two from
 * drifting: if they do, this stops compiling.
 */

import { z } from 'zod';

import { traitSchema } from '../scene/primitives';
import type { CharacterSheet } from './sheet';

const traitsSchema = z.object({
  agility: z.number().int(),
  strength: z.number().int(),
  finesse: z.number().int(),
  instinct: z.number().int(),
  presence: z.number().int(),
  knowledge: z.number().int(),
});

const experienceSchema = z.object({ name: z.string(), modifier: z.number().int() });

export const advancementSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('traits'), traits: z.tuple([traitSchema, traitSchema]) }),
  z.object({ kind: z.literal('hitPoint') }),
  z.object({ kind: z.literal('stress') }),
  z.object({ kind: z.literal('experiences'), names: z.tuple([z.string(), z.string()]) }),
  z.object({ kind: z.literal('domainCard'), card: z.string() }),
  z.object({ kind: z.literal('evasion') }),
  z.object({ kind: z.literal('subclass') }),
  z.object({ kind: z.literal('proficiency') }),
  z.object({ kind: z.literal('multiclass'), classId: z.string(), domain: z.string() }),
]);

export const levelRecordSchema = z.object({
  level: z.number().int().min(2).max(10),
  advancements: z.array(advancementSchema),
  domainCard: z.string(),
  experience: experienceSchema.optional(),
});

export const characterSheetSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  level: z.number().int().min(1).max(10),
  classId: z.string().min(1),
  ancestryId: z.string().optional(),
  communityId: z.string().optional(),
  traits: traitsSchema,
  proficiency: z.number().int().min(1),
  primaryWeaponId: z.string().optional(),
  secondaryWeaponId: z.string().optional(),
  armorId: z.string().optional(),
  experiences: z.array(experienceSchema).optional(),
  bonuses: z
    .object({
      evasion: z.number().int().optional(),
      hitPoints: z.number().int().optional(),
      stress: z.number().int().optional(),
      armorScore: z.number().int().optional(),
      majorThreshold: z.number().int().optional(),
      severeThreshold: z.number().int().optional(),
    })
    .optional(),
  subclassId: z.string().optional(),
  domainCards: z.array(z.string()).optional(),
  levels: z.array(levelRecordSchema).optional(),
});

/** Parse an untrusted sheet. The return type is the interface, so the schema cannot drift. */
export function parseSheet(value: unknown): CharacterSheet {
  return characterSheetSchema.parse(value);
}
