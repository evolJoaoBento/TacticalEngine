/**
 * Conditions as content: what a name on a creature *does*.
 *
 * The scripts apply and clear conditions by name -- "temporarily Vulnerable",
 * "Restrained", a card's own marker. The attack rules read two of them
 * directly (Vulnerable gives advantage against you, Hidden disadvantage);
 * everything else a condition changes is written on its definition, as
 * modifiers in the same shape a passive card uses, or as the defenses, blocks
 * and scripts below.
 *
 * The engine ships only the three its own rules name. Every other condition
 * belongs to whatever applies it: a project's `conditionDefs`, or the pack
 * that carries the card or stat block -- the starter pack's in
 * `pack/starter-conditions.ts`, an imported catalogue's in its own file.
 */

import { z } from 'zod';
import { contentIdSchema } from '../scene/primitives';
import { conditionSchema, effectSchema } from '../script/schema';
import { abilityModifierSchema, damageDefensesSchema } from './abilities';

/** What a condition can stop its bearer from doing. */
export const conditionBlockSchema = z.enum(['act', 'move', 'reactions', 'armor']);
export type ConditionBlock = z.infer<typeof conditionBlockSchema>;

export const conditionDefSchema = z.object({
  id: contentIdSchema,
  name: z.string().min(1),
  text: z.string().default(''),
  /**
   * What the ground looks like where a zone puts this on whoever stands there:
   * a colour, for the board to paint the zone's tiles in. Only a condition a
   * zone applies needs one; a board given none picks a hue from the id, so a
   * zone written tomorrow is never invisible.
   */
  color: z
    .string()
    .regex(/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i, 'a hex colour')
    .optional(),
  /** What it does to whoever bears it. */
  modifiers: z.array(abilityModifierSchema).default([]),
  /** What carrying it does to damage coming in — a shroud's resistance. */
  defenses: damageDefensesSchema.optional(),
  /**
   * What the bearer's Light Die is while this lasts: "you can roll a d20 as your
   * Light Die".
   *
   * A property of bearing it rather than a bonus, which is why it sits beside
   * `defenses` and not in `modifiers` - a modifier adds a number to a roll, and
   * this changes what is thrown. Only the Light Die: the Shadow Die belongs to the
   * GM and nothing on a card reaches it.
   */
  goodDie: z.object({ sides: z.number().int().min(2) }).optional(),
  /**
   * What the bearer cannot do while it lasts. An adversary that cannot `act`
   * spends its spotlight shaking the condition off (or the GM spends a Shadow
   * to clear one that only ends on damage); one that cannot `move` tears
   * free instead of closing in; `reactions` silences its damage reactions;
   * `armor` leaves them nothing to mark, which is what a rage costs.
   */
  blocks: z.array(conditionBlockSchema).default([]),
  /**
   * Ends on its own when this happens to the bearer: an attack succeeds
   * against them, they make an attack, or damage marks something of theirs.
   */
  endsWhen: z.enum(['hit', 'attacks', 'damaged', 'rolls']).optional(),
  /**
   * What marking an Armor Slot is worth while this is on - Shield Aura's
   * "when the target marks an Armor Slot, they reduce the severity of the
   * attack by an additional threshold".
   *
   * Read only when a slot was actually marked: an aura over somebody with
   * nothing left to mark does nothing, which is what the spell says.
   */
  /**
   * What the bearer owes whoever does this to them, and to whom.
   *
   * Lead by Example marks an adversary and pays the *next* PC to swing at
   * them - somebody the card that marked them has never heard of. A condition
   * can carry the debt instead: it sits on the one who was marked, and the
   * script runs with whoever attacked them acting and the bearer bound as the
   * target. It is paid once and the condition goes with it, unless `keeps`
   * says the condition *is* the standing effect rather than a debt.
   */
  payout: z
    .object({
      /** `attacked`: somebody swung at the bearer, hit or miss. */
      on: z.literal('attacked'),
      /**
       * And only when this holds - read with whoever swung acting, the bearer
       * bound as the target and the roll they made bound too, so "when you
       * succeed with Light against an adversary in this shadow" is a pair of
       * `rolled` gates and nothing else.
       */
      when: conditionSchema.optional(),
      /**
       * Whether it simply happens. A debt somebody may decline is offered;
       * "the target must mark a Stress" is not a decision anybody makes.
       */
      auto: z.boolean().optional(),
      /**
       * Whether paying it leaves the condition standing. A debt is spent by
       * the one who collects it, which is the default; a spell like
       * Overwhelming Aura is not a debt at all but a standing price on
       * swinging at its bearer - "an adversary must mark a Stress when they
       * target you with an attack", every time, until it ends on its own.
       */
      keeps: z.boolean().optional(),
      get effects() {
        return z.array(effectSchema).default([]);
      },
    })
    .optional(),
  /**
   * What happens to somebody the moment they come to bear this - "all
   * adversaries within Melee range, *or who enter Melee range*, take 2d12+4
   * magic damage and are knocked back".
   *
   * The other half of `payout`, and written the same way: a condition carrying
   * a script the game layer runs, rather than a zone inventing a vocabulary of
   * its own. A zone stays what it was - geography, plus the name of a condition
   * - and this is where the biting is written.
   *
   * Run once, on the crossing. Standing still in a circle does not set it off
   * again, because the condition is only applied to somebody who did not have
   * it; and recasting a zone under the same id leaves everybody already inside
   * bearing it, so they are not hit twice by the same spell moved a few feet.
   *
   * The zone's owner is the one acting, it being their spell, and whoever
   * walked in is bound as the target. A zone nobody owns runs it with the one
   * who walked in on both sides of the question.
   */
  onEnter: z
    .object({
      get effects() {
        return z.array(effectSchema).default([]);
      },
    })
    .optional(),
  /**
   * "When this ally would make a death move, they clear a Hit Point instead":
   * a sigil that answers a fall, spending itself to do it.
   *
   * Read where the death move is put, before the question is asked, so nobody
   * is offered a choice they are not going to be making.
   */
  insteadOfDeath: z
    .object({
      /** Hit Points cleared in place of the move. */
      clears: z.number().int().positive(),
      /** What the log says when it goes off. */
      says: z.string().min(1),
    })
    .optional(),
  armor: z
    .object({
      /** Bands off the severity, over and above the one the slot itself took. */
      steps: z.number().int().positive(),
      /**
       * "If this spell causes a creature who would be damaged to instead mark
       * no Hit Points, the effect ends": spent by the blow it carried all the
       * way down to nothing, and by no other.
       */
      endsWhenItSaves: z.boolean().optional(),
    })
    .optional(),
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
  // Not one of the rules' three: what a bad landing leaves somebody, and the engine's own
  // because a jump is. It is Vulnerable by another name, and getting up is the next move made.
  { id: 'prone', name: 'Prone', text: 'All rolls targeting you have advantage. It ends when you next move: you get up.' },
];

/** The conditions the engine's own rules read: Vulnerable, Hidden and Restrained, and Prone for a fall. */
export const SRD_CONDITIONS: readonly ConditionDef[] = RAW.map((c) => conditionDefSchema.parse(c));
