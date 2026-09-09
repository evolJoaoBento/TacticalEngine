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
import { conditionSchema, effectSchema } from '../script/schema';
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
       * succeed with Hope against an adversary in this shadow" is a pair of
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
   * An ability this puts in the bearer's hands for as long as it lasts.
   *
   * A spell cast *on* somebody - "cast this on yourself or an ally within Close
   * range; the next time the target makes an attack, they can hit an additional
   * target" - leaves the ally answering with a card they do not hold and have
   * never seen. The condition lends it to them: it names an ability in the
   * project's library, and `heldBy` hands it over beside their own.
   *
   * The lent ability is read from the bearer's chair like any other of theirs,
   * so its `available` gate and its cost are theirs too.
   */
  grants: z.object({ ability: contentIdSchema }).optional(),
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
  // Smite's charge, waiting on a swing. Nothing while it sits there: what it
  // does is written on the card that spends it, which is the only thing that
  // reads this.
  {
    id: 'smiting',
    name: 'Smiting',
    text: 'A smite is charged, and the next weapon attack that lands spends it.',
  },
  // Shield Aura, on whoever it was cast on. What it does is read where a blow
  // is counted, because only the blow knows whether a slot was marked for it.
  {
    id: 'shield-aura',
    name: 'Shield Aura',
    text: 'When you mark an Armor Slot, you reduce the severity of the attack by an additional threshold.',
    armor: { steps: 1, endsWhenItSaves: true },
  },
  // Words of Discord, once. "The target realizes what happened. The next time
  // you cast Words of Discord on them, gain a -5 penalty to the Spellcast
  // Roll" - which the card reads as a Difficulty of 18 rather than 13.
  {
    id: 'wise-to-discord',
    name: 'Wise to Discord',
    text: 'They have been whispered to once, and are harder to whisper to again.',
  },
  // Lead by Example, on whoever was encouraged against. What it pays is a
  // choice, and it is put to the one who swung rather than to the one who
  // marked them - which is the whole difficulty of the card.
  {
    id: 'led-by-example',
    name: 'Led by Example',
    text: 'The next PC to attack them can clear a Stress or gain a Hope.',
    payout: {
      on: 'attacked',
      effects: [
        {
          kind: 'choice',
          title: 'They led by example',
          body: 'Take heart from it.',
          options: [
            { label: 'Clear a Stress', effects: [{ kind: 'clearStress', amount: 1, target: { kind: 'actor' } }] },
            { label: 'Gain a Hope', effects: [{ kind: 'gainHope', amount: 1, target: { kind: 'actor' } }] },
          ],
        },
      ],
    },
  },
  // Tempest's third storm, on everything caught in it. "Attacks made from
  // beyond Melee range have disadvantage" is about where the attacker is
  // standing, and a modifier reads from one creature rather than a distance
  // between two - so what the sand does here is make everything aimed at them
  // harder, whoever is aiming and from wherever.
  {
    id: 'sandstormed',
    name: 'Sandstormed',
    text: 'Lost in blowing sand: attacks aimed at you are made with disadvantage.',
    modifiers: [{ stat: 'advantage', bonus: -1, against: true }],
  },
  // Force of Nature, while the shape holds. The +10 is on the damage roll
  // rather than on a successful one: a damage roll only happens after a swing
  // has landed, so the card's "when you succeed" is where it already reads.
  {
    id: 'force-of-nature',
    name: 'Force of Nature',
    text: 'A hulking nature spirit: +10 to damage rolls, and a Hope for every action roll made.',
    modifiers: [{ stat: 'damageRoll', bonus: 10 }],
  },
  // The Book of Grynn's wall, on whoever is standing in it. Like the Korvax
  // circle, the whole of it happens on the crossing: "anything that
  // subsequently passes through the wall takes 4d10+3 magic damage".
  {
    id: 'wall-of-flame',
    name: 'Wall of Flame',
    text: 'A standing sheet of magical fire: anything that passes through it takes 4d10+3 magic damage.',
    onEnter: {
      effects: [
        { kind: 'log', text: 'They come through the flame, and the flame notices.', tone: 'fear' },
        { kind: 'damage', dice: '4d10+3', type: 'magic', target: { kind: 'target' } },
      ],
    },
  },
  // The Book of Yarrow's first spell, on everybody it caught. Nothing but the
  // stillness: what ends it is written on the card that cast it.
  {
    id: 'time-stopped',
    name: 'Stopped in Time',
    text: 'Time is not moving for you. You can do nothing at all until it starts again.',
    blocks: ['act', 'move', 'reactions'],
  },
  // On the one who stopped the room, so the card that restarts it knows there
  // is a room stopped. It does nothing else.
  {
    id: 'time-jamming',
    name: 'Timejammer',
    text: 'Time is held still around you, and your next action roll lets it go.',
  },
  // And its second, which is a defence rather than a spell that does anything.
  {
    id: 'magic-immune',
    name: 'Immune to Magic',
    text: 'Magic damage does nothing to you until your next rest.',
    defenses: { immunities: ['magic'] },
  },
  // The Book of Sitil's second spell, on whoever it was cast on. It carries
  // nothing while it waits: what it does is written on the reaction that
  // spends it, which is the only thing that reads this.
  {
    id: 'sitil-echo',
    name: 'Echoing Strike',
    text: 'The next attack you make also reaches one more target its roll would have beaten.',
    // The one being helped does not hold the Book: the spell lends them its
    // second half for as long as the mark is on them.
    grants: { ability: 'book-of-sitil-echo-strikes' },
  },
  // Hold the Line, on the one holding it. It does nothing by itself: it is the
  // marker that says the stance is still up, so the card that drops it on a
  // failure with Fear knows there is something to drop.
  {
    id: 'holding-the-line',
    name: 'Holding the Line',
    text: 'A stance taken and kept: anything that comes within Very Close is dragged into reach and held there.',
  },
  // And on whoever walked into the ground they are holding. Like the Korvax
  // circle, everything it does happens on the crossing - the pull and the hold
  // - so the condition itself carries nothing.
  {
    id: 'caught-in-the-line',
    name: 'Caught',
    text: 'Dragged into reach of the one holding this ground.',
    onEnter: {
      effects: [
        { kind: 'log', text: 'They come one step too close and are hauled the rest of the way in.', tone: 'combat' },
        { kind: 'move', who: { kind: 'target' }, how: 'toward', of: { kind: 'actor' }, range: 'melee', budget: 'veryClose' },
        { kind: 'applyCondition', condition: 'restrained', duration: 'temporary', target: { kind: 'target' } },
      ],
    },
  },
  // The Book of Korvax's magic circle, on whoever is standing in it. The
  // condition carries nothing while it is borne: the whole of the spell happens
  // on the crossing, which is what the card says - "all adversaries within
  // Melee range, or who enter Melee range, take 2d12+4 magic damage and are
  // knocked back to Very Close range".
  {
    id: 'korvax-circle',
    name: 'Magic Circle',
    text: 'Ground that answers anybody who steps onto it: 2d12+4 magic damage, and knocked back.',
    onEnter: {
      effects: [
        { kind: 'log', text: 'The circle takes them as they cross it.', tone: 'fear' },
        { kind: 'damage', dice: '2d12+4', type: 'magic', target: { kind: 'target' } },
        { kind: 'push', to: 'veryClose', target: { kind: 'target' } },
      ],
    },
  },
  // Full Surge, while the body will take it. "A +2 bonus to all of your
  // character traits" is +2 on every action roll: a trait is the thing you
  // roll, and a roll is where all six of them are read.
  //
  // Simplified: a trait read anywhere that is not a roll does not move - a card
  // that adds your Strength to something, or the party's best hand at a trait.
  {
    id: 'full-surge',
    name: 'Full Surge',
    text: 'Pushed past what the body would usually allow: +2 to every action roll.',
    modifiers: [{ stat: 'actionRoll', bonus: 2 }],
  },
  // Wild Surge, while the form holds. The value of the die is the tokens on
  // the card, so the modifier is worth one apiece and reads whatever the pile
  // says at the moment the roll is made.
  {
    id: 'wild-surging',
    name: 'Wild Surge',
    text: 'The Wild Surge Die is active: its value is added to every action roll you make.',
    modifiers: [{ stat: 'actionRoll', bonus: 1, perToken: 'wild-surge' }],
  },
  // Goad Them On, on the one who was taunted. The disadvantage is on *their*
  // swing rather than on rolls against them, so no `against`: it is the plain
  // modifier every attacker reads off themselves, and `endsWhen: 'attacks'`
  // spends it on the next one they make, hit or miss.
  //
  // "They must target you" is the half nothing here can enforce - whom an
  // adversary swings at is the GM's, the way Enrapture's is.
  {
    id: 'goaded',
    name: 'Goaded',
    text: 'Taunted into a swing they have not thought through: their next attack is made with disadvantage.',
    modifiers: [{ stat: 'advantage', bonus: -1 }],
    endsWhen: 'attacks',
  },
  // Overwhelming Aura, on the one wearing it. Not a debt but a standing price,
  // so `keeps`: every adversary that aims a swing at them marks a Stress, and
  // the aura is still there for the next one.
  //
  // Simplified: "until your next long rest" is `rest`, there being one rest a
  // condition can outlast rather than two.
  {
    id: 'overwhelming-aura',
    name: 'Overwhelming Aura',
    text: 'An adversary must mark a Stress when they target you with an attack.',
    payout: {
      on: 'attacked',
      auto: true,
      keeps: true,
      effects: [{ kind: 'markStress', amount: 1, target: { kind: 'actor' } }],
    },
  },
  // Zone of Protection's shell. It carries nothing itself: the die that comes
  // off a blow lives on the zone, where everybody standing in it reads the
  // same one, which is what one d6 on one card means.
  {
    id: 'zone-of-protection',
    name: 'Zone of Protection',
    text: 'Damage taken here is reduced by the value of the die on the card.',
  },
  // Eclipse, read from either side of it. The dark is one spell and two
  // zones, because what it does to the party and what it does to everything
  // else are two different rules over the same ground.
  {
    id: 'in-shadow',
    name: 'In Shadow',
    text: 'Attack rolls have disadvantage when targeting you.',
    modifiers: [{ stat: 'advantage', bonus: -1, against: true }],
  },
  {
    id: 'shadowed',
    name: 'Shadowed',
    text: 'When somebody succeeds with Hope against you here, you must mark a Stress.',
    payout: {
      on: 'attacked',
      when: {
        kind: 'all',
        of: [
          { kind: 'rolled', is: 'success' },
          { kind: 'rolled', is: 'withHope' },
        ],
      },
      auto: true,
      effects: [
        { kind: 'log', text: 'The dark closes on them.', tone: 'hope' },
        { kind: 'markStress', amount: 1, target: { kind: 'target' } },
      ],
    },
  },
  // Life Ward's sigil. It does nothing at all until the moment it is for.
  {
    id: 'life-ward',
    name: 'Life Ward',
    text: 'When you would make a death move, you clear a Hit Point instead.',
    insteadOfDeath: { clears: 1, says: 'The sigil takes it, and goes out.' },
  },
  // Inevitable's next roll. It ends on whatever they roll next, which is what
  // "your next action roll" means - not the next thing they swing at.
  {
    id: 'inevitable',
    name: 'Inevitable',
    text: 'Your next action roll has advantage.',
    // An action roll of any kind, not the next swing: `anyRoll` is what the
    // check path reads, and without it the die would be spent on a check that
    // never saw it.
    modifiers: [{ stat: 'advantage', bonus: 1, anyRoll: true }],
    endsWhen: 'rolls',
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
    // Deft Maneuvers: "if you end this movement within Melee range of an
    // adversary and immediately make an attack against them, gain a +1 bonus
    // to the attack roll". "Immediately" is the next swing, whoever it is at,
    // which is what `endsWhen: 'attacks'` says.
    id: 'poised',
    name: 'Poised',
    text: 'You arrived exactly where you meant to. Your next attack is surer for it.',
    modifiers: [{ stat: 'attackRoll', bonus: 1 }],
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
    // Vulnerable is "all rolls targeting you", so `anyRoll`: a Spellcast Roll
    // aimed at somebody Horrified takes the die as surely as a swing does.
    // In Shadow says "attack rolls" and stays without it.
    modifiers: [{ stat: 'advantage', bonus: 1, against: true, anyRoll: true }],
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
