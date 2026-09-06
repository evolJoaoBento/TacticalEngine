/**
 * Conditions as content: what a name on a creature *does*.
 *
 * The scripts apply and clear conditions by name — "temporarily Vulnerable",
 * "Restrained", a card's own "dodging". The attack rules read two of them
 * directly (Vulnerable gives advantage against you, Hidden disadvantage);
 * everything else a condition changes is written here as modifiers, the same
 * shape a passive card uses, so Tava's Armor is "+1 Armor Score while you
 * bear the tavas-armor condition" and Rogue's Dodge is "+2 Evasion while
 * dodging, which ends the next time an attack succeeds against you".
 *
 * A project may add its own; the engine ships the SRD's and the ones its
 * scripted cards need.
 */

import { z } from 'zod';
import { contentIdSchema } from '../scene/primitives';
import { abilityModifierSchema } from './abilities';

/** What a condition can stop its bearer from doing. */
export const conditionBlockSchema = z.enum(['act', 'move', 'reactions']);
export type ConditionBlock = z.infer<typeof conditionBlockSchema>;

export const conditionDefSchema = z.object({
  id: contentIdSchema,
  name: z.string().min(1),
  text: z.string().default(''),
  /** What it does to whoever bears it. */
  modifiers: z.array(abilityModifierSchema).default([]),
  /**
   * What the bearer cannot do while it lasts. An adversary that cannot `act`
   * spends its spotlight shaking the condition off (or the GM spends a Fear
   * to clear one that only ends on damage); one that cannot `move` tears
   * free instead of closing in; `reactions` silences its damage reactions.
   */
  blocks: z.array(conditionBlockSchema).default([]),
  /**
   * Ends on its own when this happens to the bearer: an attack succeeds
   * against them, they make an attack, or damage marks something of theirs.
   */
  endsWhen: z.enum(['hit', 'attacks', 'damaged']).optional(),
});

export type ConditionDef = z.infer<typeof conditionDefSchema>;

type ConditionInput = z.input<typeof conditionDefSchema>;

const RAW: ConditionInput[] = [
  { id: 'vulnerable', name: 'Vulnerable', text: 'All rolls targeting you have advantage.' },
  { id: 'hidden', name: 'Hidden', text: 'Any rolls against you have disadvantage.', endsWhen: 'attacks' },
  {
    id: 'restrained',
    name: 'Restrained',
    text: "You can't move until this condition is cleared, but you can still take actions from your current position.",
    blocks: ['move'],
  },
  {
    id: 'stunned',
    name: 'Stunned',
    text: "You can't use reactions and can't take any other actions until you clear this condition.",
    blocks: ['act', 'reactions'],
  },
  // Slumber's condition: not one of the SRD's named conditions, but what the
  // card says — nothing until damage or a Fear clears it.
  {
    id: 'asleep',
    name: 'Asleep',
    text: 'Asleep until you take damage or the GM spends a Fear to clear it.',
    blocks: ['act', 'move'],
    endsWhen: 'damaged',
  },
  // Cinder Grasp's flames. The extra damage a creature takes for acting while
  // alight is the condition's text, not a rule the engine applies: nothing
  // reads "at the end of their action" yet.
  {
    id: 'on-fire',
    name: 'On Fire',
    text: 'When you act while On Fire, you take an extra 2d6 magic damage if you are still On Fire at the end of your action.',
  },
  { id: 'tavas-armor', name: "Tava's Armor", text: '+1 to your Armor Score until your next rest.', modifiers: [{ stat: 'armorScore', bonus: 1 }] },
  {
    id: 'dodging',
    name: "Rogue's Dodge",
    text: '+2 to your Evasion until the next time an attack succeeds against you.',
    modifiers: [{ stat: 'evasion', bonus: 2 }],
    endsWhen: 'hit',
  },
];

/** The conditions the engine knows. */
export const SRD_CONDITIONS: readonly ConditionDef[] = RAW.map((c) => conditionDefSchema.parse(c));
