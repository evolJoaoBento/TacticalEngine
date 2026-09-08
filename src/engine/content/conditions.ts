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
import { abilityModifierSchema, damageDefensesSchema } from './abilities';

/** What a condition can stop its bearer from doing. */
export const conditionBlockSchema = z.enum(['act', 'move', 'reactions', 'armor']);
export type ConditionBlock = z.infer<typeof conditionBlockSchema>;

export const conditionDefSchema = z.object({
  id: contentIdSchema,
  name: z.string().min(1),
  text: z.string().default(''),
  /** What it does to whoever bears it. */
  modifiers: z.array(abilityModifierSchema).default([]),
  /** What carrying it does to damage coming in — a shroud's resistance. */
  defenses: damageDefensesSchema.optional(),
  /**
   * What the bearer cannot do while it lasts. An adversary that cannot `act`
   * spends its spotlight shaking the condition off (or the GM spends a Fear
   * to clear one that only ends on damage); one that cannot `move` tears
   * free instead of closing in; `reactions` silences its damage reactions;
   * `armor` leaves them nothing to mark, which is what a rage costs.
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
  // The Oak Treant's roots. The SRD's version also Restrains it, and an
  // adversary that cannot move spends its spotlight tearing free — so a
  // creature that roots itself would spend every other turn undoing it. The
  // half the engine keeps is the half that answers a blade.
  {
    id: 'rooted',
    name: 'Rooted',
    text: 'Rooted in place, so that physical damage is halved.',
    defenses: { resistances: ['physical'] },
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
  // The Siren's song. "Until they mark 2 Stress" is a tally the engine does
  // not keep, so it runs to the end of the scene; what it does is let the
  // Siren's teeth find them, which is the Captive Audience passive.
  // What the cards that last leave on their holder. Each is a name and a
  // number or two: a condition is where the engine keeps a bonus that has to
  // outlive the moment it was bought in.
  {
    id: 'frenzied',
    name: 'Frenzied',
    text: 'You cannot use Armor Slots, you deal ten more damage, and you are far harder to put down.',
    modifiers: [
      { stat: 'damageRoll', bonus: 10 },
      { stat: 'severeThreshold', bonus: 8 },
    ],
    blocks: ['armor'],
  },
  {
    id: 'spectral',
    name: 'Spectral',
    text: 'You are barely here: physical damage passes through you.',
    defenses: { immunities: ['physical'] },
    endsWhen: 'attacks',
  },
  {
    id: 'focused',
    name: 'Focused',
    text: 'All of your attention is on one creature, and your weapon knows it.',
    modifiers: [{ stat: 'proficiency', bonus: 1 }],
  },
  {
    id: 'inspired',
    name: 'Inspired',
    text: 'Somebody called out, and you believe them: your attacks have advantage.',
    modifiers: [{ stat: 'advantage', bonus: 1 }],
  },
  {
    id: 'horrified',
    name: 'Horrified',
    text: 'What you are looking at cannot be looked away from. You are Vulnerable.',
    modifiers: [{ stat: 'advantage', bonus: 1, against: true }],
  },
  // The Giant Scorpion's sting. The name is what the engine carries; the d6
  // before every action roll is the block's own words and the table's to play.
  {
    id: 'poisoned',
    name: 'Poisoned',
    text: 'Venom is working through you.',
  },
  // Breaking Blow. A crack in whatever it is wearing, waiting for the next
  // blow to go through it: a name and nothing else, spent by the blow it was
  // left for.
  {
    id: 'broken',
    name: 'Broken',
    text: 'Something in your guard has given way, and the next blow knows where.',
  },
  // Sigil of Retribution. Like a toll, a name and nothing else: the card that
  // set it is the only thing that reads it, and it counts what the marked
  // creature does to the party.
  {
    id: 'sigiled',
    name: 'Sigiled',
    text: 'A sigil of retribution is on you, and it is keeping count.',
  },
  // Twilight Toll. The card holds one creature at a time, and the mark is how
  // the payout knows which: a name on them, doing nothing on its own.
  {
    id: 'tolled',
    name: 'Tolled',
    text: 'A toll hangs over you, and the one who set it is counting.',
  },
  // Enrapture and Mass Enrapture. "Their attention is fixed on you, narrowing
  // their field of view": a creature looking at one person is not looking at
  // anyone else, which is worth a step of Difficulty either way - here, the
  // easier they are to hit. What it does not do is choose their target for
  // them; the GM's turn still aims at the nearest.
  {
    id: 'enraptured',
    name: 'Enraptured',
    text: 'Your attention is fixed on the one who enraptured you, and nothing else reaches you.',
    modifiers: [{ stat: 'evasion', bonus: -2 }],
  },
  // Glyph of Nightfall. "Reducing the target's Difficulty by a value equal to
  // your Knowledge (minimum 1)": a condition carries one number, not the
  // caster's, so the glyph is worth a flat 2 - the Knowledge of somebody who
  // took the card at the level it is printed at.
  {
    id: 'glyphed',
    name: 'Glyphed',
    text: 'A dark glyph on your body exposes your weak points.',
    modifiers: [{ stat: 'evasion', bonus: -2 }],
  },
  {
    id: 'entranced',
    name: 'Entranced',
    text: "You are held by the Siren's song until you mark 2 Stress.",
  },
  // The High Seraph's judgment, which the Hallowed Archer can read as well.
  // "Until the Seraph is defeated" is the scene; "the target doesn't gain Hope
  // on a result with Hope" is a rule about the dice that nothing here reads,
  // and stays at the table.
  {
    id: 'guilty',
    name: 'Guilty',
    text: "You are Guilty in the eyes of the Seraph's god: you gain no Hope on a result with Hope.",
  },
  // The Young Ice Dragon's. The SRD prints it on that one block: it lasts
  // until a rest or until the creature clears a Stress, neither of which the
  // engine can ask for mid-fight, so it runs to the end of the scene.
  {
    id: 'chilled',
    name: 'Chilled',
    text: 'While Chilled, you have disadvantage on attack rolls.',
    modifiers: [{ stat: 'advantage', bonus: -1 }],
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
