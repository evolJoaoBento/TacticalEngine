/**
 * What the starter pack's own conditions do.
 *
 * A card that draws a patch of ground needs two halves: the ability that puts
 * the ground there, and the condition that says what standing on it means. The
 * ability lives in `starter-abilities.ts`; this is the other half.
 *
 * The engine's own conditions — Vulnerable, Restrained, Hidden — live in
 * `content/conditions.ts` and are merged underneath these, so a pack condition
 * wins on a clash and everything the rules already know still works.
 *
 * **A zone whose condition has no definition is silent.** The zone still paints
 * and still reports its tiles, but `onEnter` is where a ring's bite is written,
 * and a missing definition also makes the log fall back to the condition's *id*
 * — which is the class of bug `tests/e2e/readout.spec.ts` exists to catch. So a
 * card that names a condition here is a card that needs it to ship with it.
 */

import { z } from 'zod';
import { conditionDefSchema, type ConditionDef } from '../conditions';

// `z.input`, as `conditions.ts` does it: the schema's own input type, so a typo
// in the list below is a type error rather than something `parse` finds at boot.
type ConditionInput = z.input<typeof conditionDefSchema>;

const RAW: ConditionInput[] = [
  /**
   * Warding Flame's ring, on whoever is standing in it.
   *
   * Everything it does happens on the crossing, so the condition carries
   * nothing while it is borne: a creature in the fire has already been burned
   * by it, and standing still is not walking in again. Whoever is beside the
   * caster when the ring is drawn counts as a crossing too — they were not in
   * it a moment ago — which is what makes the card worth playing at all rather
   * than a trap laid for a fight that has moved on.
   */
  {
    id: 'warding-flame-ring',
    name: 'Warding Flame',
    text: 'Low fire on the ground: anything that comes through it is struck as it comes.',
    color: '#ff8a3d',
    onEnter: {
      effects: [
        { kind: 'log', text: 'The flame takes them as they come through it.', tone: 'combat' },
        { kind: 'damage', dice: '1d8', type: 'magic', target: { kind: 'target' } },
      ],
    },
  },
  /**
   * Shield Wall, on the ally it was brought across for. Unlike the ring, this
   * one does its work while it is borne rather than on a crossing, so the bonus
   * lives in `modifiers` and nothing happens at the edge.
   */
  {
    id: 'behind-the-shield',
    name: 'Behind the Shield',
    text: 'Somebody is holding a shield between you and the room: +1 to your Evasion.',
    color: '#6fa8d0',
    modifiers: [{ stat: 'evasion', bonus: 1 }],
  },
];

/** The conditions the starter pack's own cards rely on. */
export const STARTER_CONDITIONS: readonly ConditionDef[] = RAW.map((c) => conditionDefSchema.parse(c));
