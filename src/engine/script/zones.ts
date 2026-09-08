/**
 * A patch of ground that means something: Zone of Protection's shell, the dark
 * an Eclipse leaves over the room.
 *
 * A zone is a condition applied by geography. It names a condition and an area,
 * and everybody standing in that area bears it - walk in and you have it, walk
 * out and you do not, and the zone ending takes it off everybody at once.
 * Nothing here decides what the condition *does*: that is written where every
 * other condition is written, so a zone reuses the modifiers, defenses and
 * payouts a condition already has and invents no vocabulary of its own.
 *
 * Zones live on the scenario for the same reason countdowns do: one outlives a
 * defence prompt, a GM turn and a reload.
 */

import { z } from 'zod';
import { contentIdSchema } from '../scene/primitives';
import { rangeBandSchema } from './schema';

/** A zone that is standing. */
export interface RunningZone {
  /** The id the spell gave it: casting it again under this id moves it. */
  id: string;
  name: string;
  /** Who cast it, or null for one the scene placed. */
  owner: string | null;
  /** What everybody inside bears while they are inside. */
  condition: string;
  /** The tile it is anchored to. */
  anchor: number;
  /** How far from that tile it reaches. */
  band: RangeBandName;
  /**
   * Which side it touches, read from the owner's chair: `allies` is the
   * owner's own side and `adversaries` the other. Everybody when left out,
   * which is what a patch of dark over the whole room means.
   */
  side?: 'allies' | 'adversaries';
  /** What the owner falling does to it. */
  onDeath: 'end' | 'keep';
  /**
   * A number the zone is holding, which comes off any damage taken inside it:
   * Zone of Protection's "place a d6 on this card with the 1 value facing up.
   * When an ally in this zone takes damage, they reduce it by the die's value."
   */
  value?: number;
  /**
   * And what that number does each time it answers a blow: "you then increase
   * the die's value by one. When the die's value would exceed 6, this effect
   * ends."
   */
  grows?: { by: number; until: number };
}

type RangeBandName = z.infer<typeof rangeBandSchema>;

export const runningZoneSchema = z.object({
  id: contentIdSchema,
  name: z.string().min(1),
  owner: z.string().min(1).nullable(),
  condition: z.string().min(1),
  anchor: z.number().int(),
  band: rangeBandSchema,
  side: z.enum(['allies', 'adversaries']).optional(),
  onDeath: z.enum(['end', 'keep']).default('keep'),
  value: z.number().int().min(0).optional(),
  grows: z.object({ by: z.number().int().positive(), until: z.number().int().positive() }).optional(),
});

/** The zones a scenario is carrying, keyed by zone id. */
export type ZoneBoard = Map<string, RunningZone>;

/** A snapshot of a standing zone, as a save holds it. */
export type ZoneSnapshot = z.infer<typeof runningZoneSchema>;
