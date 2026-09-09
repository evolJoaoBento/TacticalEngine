/**
 * Conditions, effects and checks as zod schemas — the authored form of
 * everything `script/` can run.
 *
 * There used to be two effect vocabularies: a nine-variant one in
 * `scene/schema.ts` that documents could hold, and the full union in
 * `effects.ts` that the runner could execute. Nothing converted between them, so
 * an interactable's authored check was imported, validated, saved — and never
 * run. Rather than add a converter (a second vocabulary to keep in step, and the
 * obvious place for the two to drift), this is the single schema, and
 * `effects.ts` takes its types from here.
 *
 * Every old document variant is a subset of its counterpart here, so files
 * written against the narrow vocabulary still parse.
 *
 * Recursion (`branch`, `all`/`any`, a choice's effects) uses zod 4's getter form,
 * which infers the recursive type without a hand-written annotation.
 */

import { z } from 'zod';
import { contentIdSchema, traitSchema } from '../scene/primitives';
import { questQuerySchema } from '../content/quests';
import { RANGE_BANDS } from '../rules/range';
import { COUNTDOWN_ADVANCES, COUNTDOWN_LOOPS } from '../rules/countdown';

/** A range band as content writes it: "within Close range". */
export const rangeBandSchema = z.enum(RANGE_BANDS);

/**
 * How long a condition a script applies lasts. `temporary` is the SRD's word —
 * an adversary can spend its spotlight to clear it, a PC can roll to; `scene`
 * ends with the encounter; `rest` with the next rest; `permanent` never.
 */
export const conditionDurationSchema = z.enum(['temporary', 'scene', 'rest', 'permanent']);

/** Which pool a condition or an effect reads. */
export const poolNameSchema = z.enum(['hitPoints', 'stress', 'armorSlots', 'hope']);

/**
 * What an effect or a condition hands a hook. Deliberately flat: a hook's
 * arguments are content, so they must survive a JSON round trip and be
 * editable in a form.
 */
export const hookArgsSchema = z.record(z.string().min(1), z.union([z.string(), z.number(), z.boolean()]));

/** A value a scenario variable can hold. */
export const scriptValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

/**
 * Numbers a script can read instead of a written one.
 *
 * A feature that answers a blow is told about the blow: how much of it landed
 * ("cause the attacker to mark the same number of HP"), and what its own swing
 * has marked so far ("clear a number of Stress equal to the HP marked by the
 * target from this attack"). `targetsHit` is how many creatures the last roll
 * beat - "you gain a Fear for each target that marks HP".
 *
 * They are counts, never damage: a count marks Hit Points or Stress outright.
 * Damage carried over from a blow is `dice: 'same'`, which keeps its dice and
 * its type and goes through thresholds the way the original did.
 */
export const COUNT_NAMES = ['hitPointsTaken', 'hitPointsDealt', 'targetsHit'] as const;
export type CountName = (typeof COUNT_NAMES)[number];
/**
 * `spent` is not one of them. It is a word only `howMany` understands: the
 * number the player chose, written into a copy of the effects before they run,
 * so nothing ever tracks a count by that name. The validator warns when it is
 * written anywhere else, because there it reads as a quiet zero.
 */
const countNameSchema = z.enum([...COUNT_NAMES, 'spent']);

/** A written number, or one the script reads off what has just happened. */
/**
 * A number read off somebody's pool: "a bonus equal to the Demon's current
 * number of marked HP", "mark Hit Points equal to the number you have marked".
 *
 * The same three words the `pool` condition asks with, so an amount and a gate
 * on the same number read the same. `of` is the actor when left out, and
 * `measure` is what is marked - which is what every one of these means. Hope
 * is the exception worth knowing: marked Hope is Hope *spent*, so a feature
 * about the Hope somebody still holds says `measure: 'available'`.
 *
 * `of` names one creature: the first the selector resolves to is the one read,
 * and a selector that names a crowd has no order worth relying on. The
 * validator says so.
 */
export const amountReadSchema = z.union([
  z.object({
    pool: poolNameSchema,
    get of() {
      return targetSelectorSchema.optional();
    },
    measure: z.enum(['available', 'marked', 'max']).optional(),
  }),
  /**
   * Or how many creatures a selector names: "an additional Hope for each
   * creature", "a bonus equal to the number of allies within Close range".
   *
   * The same question the `nearby` condition asks as a gate, asked here as a
   * number. Nobody named is nothing, which is the honest answer.
   */
  z.object({
    get count() {
      return targetSelectorSchema;
    },
  }),
  /** Or the tokens sitting on a card somebody holds. */
  z.object({
    tokens: contentIdSchema,
    get of() {
      return targetSelectorSchema.optional();
    },
  }),
  /**
   * Or a trait off their sheet: "a bonus to your damage roll equal to twice
   * your Strength", "tokens equal to your Spellcast trait". `times` is the
   * multiplier the card prints, and a creature with no sheet - a stat block -
   * reads as nothing rather than refusing.
   */
  z.object({
    trait: z.union([traitSchema, z.literal('spellcast'), z.literal('proficiency')]),
    get of() {
      return targetSelectorSchema.optional();
    },
    times: z.number().int().positive().optional(),
  }),
]);

const amountSchema = z.union([z.number().int().positive(), countNameSchema, amountReadSchema]);

export type Amount = z.infer<typeof amountSchema>;

export const compareOpSchema = z.enum(['==', '!=', '<', '<=', '>', '>=']);

/** Log styling the narrative pane understands. */
export const logToneSchema = z.enum([
  'narration',
  'system',
  'hope',
  'fear',
  'combat',
  'success',
]);

/**
 * Who an effect lands on.
 *
 * `actor`, `party` and `entity` are what a chest or a trap needs. The rest are
 * what an ability needs: `target` is whoever the player chose when they used
 * it, `hit` is whichever of those the last roll beat, and the range selectors
 * are "all adversaries within Very Close range" measured from the actor or,
 * with `around: 'target'`, from the chosen target — the SRD's group.
 */
export const targetSelectorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('actor') }),
  z.object({ kind: z.literal('party') }),
  z.object({ kind: z.literal('entity'), id: z.string().min(1) }),
  /** Named creatures, in the order given: what a hook builds when it picks them itself. */
  z.object({ kind: z.literal('entities'), ids: z.array(z.string().min(1)) }),
  z.object({ kind: z.literal('target') }),
  /**
   * The creatures the last roll beat; `having` keeps only those with a
   * condition, and `nearest` only the closest few - "choose one of these
   * targets", which the engine chooses the way every other automatic pick is
   * made rather than asking.
   */
  z.object({
    kind: z.literal('hit'),
    having: z.string().min(1).optional(),
    nearest: z.number().int().positive().optional(),
  }),
  z.object({
    kind: z.literal('allies'),
    /** Living party members within this band of the actor. Everywhere when left out. */
    range: rangeBandSchema.optional(),
    /** Measured from the actor, or from the tile that was picked. */
    around: z.enum(['actor', 'point']).optional(),
    includeSelf: z.boolean().optional(),
    /** Leave the chosen target out: "all *other* PCs within Close range". */
    except: z.enum(['target']).optional(),
    /**
     * Only the closest few - "deal 2d10+6 direct magic damage to a target
     * within Close range". A stat block that names one target rather than the
     * band means the one it is standing over, and the GM's turn already picks
     * that way when it chooses whom to swing at.
     */
    nearest: z.number().int().positive().optional(),
  }),
  /**
   * Everything the straight line from the actor to the picked point runs
   * through: "run a straight path through the battlefield to a point within
   * Far range, making an attack against all adversaries within your weapon's
   * range along that path", the Warden's gallop, the Kraken's line of boiling
   * water.
   *
   * The one acting is never caught by their own charge, and neither is
   * anything standing beside the tile they left: the run leaves that tile, so
   * it is not on the path. Whoever else is standing within `range` of any tile
   * the line passes through is caught, the far endpoint included - somebody
   * standing on the spot being run to is in the path.
   *
   * With no point bound it catches nobody, which is a charge with nowhere to
   * go rather than a mistake.
   */
  z.object({
    kind: z.literal('inPath'),
    /**
     * How far off the line a creature can stand and still be caught. Melee by
     * default, which is the tiles the line crosses and the ring around them.
     */
    range: rangeBandSchema.optional(),
    /** Or the actor's own weapon reach, whatever they are holding. */
    reach: z.literal('weapon').optional(),
    /**
     * Which side is caught. Everybody but the one charging when left out,
     * which is what "all targets in their path" means.
     */
    side: z.enum(['adversaries', 'allies']).optional(),
  }),
  z.object({
    kind: z.literal('adversaries'),
    range: rangeBandSchema,
    /** Measured from the actor, the chosen target, or the tile that was picked. */
    /**
     * "All adversaries within your weapon's range": the reach of what the
     * actor is holding, whatever that is, with `range` standing in for anyone
     * holding nothing the engine can read - a stat block, an empty hand.
     */
    reach: z.literal('weapon').optional(),
    around: z.enum(['actor', 'target', 'point']).optional(),
    /**
     * Leave somebody out: the chosen target ("all other targets within
     * range"), or the one acting - which a selector otherwise counts, because
     * a creature is within Melee of itself. "Move into Melee range of an ally"
     * means one of the others.
     */
    except: z.enum(['target', 'actor']).optional(),
    /** Only the closest few, measured from whoever the band is read around. */
    nearest: z.number().int().positive().optional(),
    /**
     * Only creatures off the same stat block as the one acting: "all Giant
     * Rats within Close range", said by a Giant Rat. Read against the actor,
     * so it says nothing on a card and everything on a block.
     */
    sameKind: z.boolean().optional(),
  }),
]);

export const conditionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('always') }),
  z.object({ kind: z.literal('never') }),
  z.object({
    kind: z.literal('not'),
    get of() {
      return conditionSchema;
    },
  }),
  z.object({
    kind: z.literal('all'),
    get of() {
      return z.array(conditionSchema);
    },
  }),
  z.object({
    kind: z.literal('any'),
    get of() {
      return z.array(conditionSchema);
    },
  }),
  /**
   * A number the blow that started this script left behind - "when the Brawler
   * marks 2 or more HP from an attack". The counts are read from the bindings,
   * so a feature's `available` gate and its effects see the same numbers.
   */
  z.object({
    kind: z.literal('count'),
    of: countNameSchema,
    op: compareOpSchema,
    value: z.number().int(),
  }),
  z.object({ kind: z.literal('flag'), flag: z.string().min(1) }),
  z.object({ kind: z.literal('hasKey'), key: z.string().min(1) }),
  z.object({
    kind: z.literal('hasItem'),
    item: contentIdSchema,
    /** How many are needed. One when left out. */
    quantity: z.number().int().positive().optional(),
  }),
  z.object({
    kind: z.literal('var'),
    name: z.string().min(1),
    op: compareOpSchema,
    value: scriptValueSchema,
  }),
  z.object({
    kind: z.literal('interactable'),
    id: z.string().min(1),
    state: z.enum(['used', 'open', 'removed']),
  }),
  z.object({
    kind: z.literal('encounter'),
    id: z.string().min(1),
    state: z.enum(['started', 'ended', 'triggered']),
  }),
  /** Where a quest stands; `inactive` is a quest nothing has started yet. */
  z.object({ kind: z.literal('quest'), quest: contentIdSchema, status: questQuerySchema }),
  z.object({ kind: z.literal('objectiveDone'), quest: contentIdSchema, objective: contentIdSchema }),
  z.object({ kind: z.literal('partyAlive'), op: compareOpSchema, value: z.number().int() }),
  z.object({
    kind: z.literal('adversariesAlive'),
    op: compareOpSchema,
    value: z.number().int(),
  }),
  /**
   * A pool on someone — the actor unless `of` says otherwise. `available` is
   * what can still be marked (or, for Hope, spent), which is the question a
   * card asks: "mark a Stress to…" needs a slot to mark.
   */
  z.object({
    kind: z.literal('pool'),
    pool: poolNameSchema,
    of: targetSelectorSchema.optional(),
    measure: z.enum(['available', 'marked', 'max']).optional(),
    op: compareOpSchema,
    value: z.number().int(),
  }),
  /**
   * What the roll that raised this was: "when a PC rolls a failure with Fear",
   * "when a PC rolls with Fear". The five readings a stat block asks for, and
   * they compose - a failure *with Fear* is an `all` of two of them.
   *
   * A script nobody handed a roll reads false for every one of them, which is
   * what a feature run out of nowhere should see.
   */
  z.object({
    kind: z.literal('rolled'),
    is: z.enum(['failure', 'success', 'withFear', 'withHope', 'critical']),
  }),
  z.object({ kind: z.literal('inCombat') }),
  /**
   * How many of a domain's cards a character has in their loadout — the nine
   * "-Touched" cards' "when 4 or more of the domain cards in your loadout are
   * from the Blade domain". Read against the actor unless `of` says otherwise.
   */
  z.object({
    kind: z.literal('loadout'),
    domain: contentIdSchema,
    of: targetSelectorSchema.optional(),
    op: compareOpSchema,
    value: z.number().int(),
  }),
  /**
   * How many creatures a selector names: "another Dire Wolf is within Melee
   * range of the target", "three or more Minions within Close range".
   *
   * The selectors already say which creatures and where - around the actor or
   * around the target, off the same stat block, everyone but the one asking.
   * This is the question nothing could put to them: how many.
   */
  z.object({
    kind: z.literal('nearby'),
    of: targetSelectorSchema,
    op: compareOpSchema,
    /**
     * A written number, or a pool read off somebody - "as many Hope as there
     * are creatures standing with you", which is a price asked as a gate. Only
     * a pool: it is the one read a condition can make on its own.
     */
    value: z.union([
      z.number().int(),
      z.object({
        pool: poolNameSchema,
        get of() {
          return targetSelectorSchema.optional();
        },
        measure: z.enum(['available', 'marked', 'max']).optional(),
      }),
    ]),
  }),
  /** How many tokens sit on a card the actor holds. */
  z.object({
    kind: z.literal('tokens'),
    ability: contentIdSchema,
    of: targetSelectorSchema.optional(),
    op: compareOpSchema,
    value: z.number().int(),
  }),
  z.object({
    kind: z.literal('hasCondition'),
    condition: z.string().min(1),
    of: targetSelectorSchema.optional(),
  }),
  /**
   * Whether the creature bound is the one asking: "when *you* fail an action
   * roll", said by a card that hears about everybody's.
   *
   * Every creature `of` names has to be the actor, and naming nobody is not a
   * yes - the same reading `side` gives.
   */
  z.object({
    kind: z.literal('self'),
    of: targetSelectorSchema.optional(),
  }),
  /**
   * Which side of the fight somebody is on, read from the actor's chair: "when
   * an ally within Close range deals damage to an adversary" is two of these
   * and a range.
   *
   * `ally` is the actor's own faction and `adversary` the other one, so the
   * same card reads correctly whichever end of the table is holding it. Every
   * creature `of` names has to be on that side; naming nobody is not a yes.
   */
  z.object({
    kind: z.literal('side'),
    of: targetSelectorSchema.optional(),
    is: z.enum(['ally', 'adversary']),
  }),
  /** Whether any of `of` (the chosen target unless said) stands within this band of the actor. */
  z.object({
    kind: z.literal('withinRange'),
    range: rangeBandSchema,
    of: targetSelectorSchema.optional(),
  }),
  /**
   * Whatever a piece of code says. `hook` names a native hook or a
   * `project.code[]` entry; its return value is read as a boolean. A
   * predicate hook reads the world and nothing else: no dice, no writes.
   */
  z.object({
    kind: z.literal('hook'),
    hook: contentIdSchema,
    args: hookArgsSchema.optional(),
  }),
]);

export const choiceOptionSchema = z.object({
  label: z.string().min(1),
  detail: z.string().optional(),
  available: conditionSchema.optional(),
  get effects() {
    return z.array(effectSchema).default([]);
  },
});

/**
 * A roll, and what each outcome does.
 *
 * Outcomes fall back as `outcomeEffects` describes, so content that writes only
 * a success and a failure list behaves sensibly for all five.
 */
export const checkTraitSchema = z.union([traitSchema, z.literal('spellcast'), z.literal('weapon')]);

export const checkRequestSchema = z.object({
  /** A trait, the actor's Spellcast trait, or the trait of their weapon. */
  trait: checkTraitSchema,
  /**
   * A fixed number — "Spellcast Roll (13)" — or `target`: each target's own
   * Difficulty (an adversary's, or a PC's Evasion). One roll is made either
   * way; against targets, it succeeds against each one it meets or exceeds.
   */
  difficulty: z.union([z.number().int().positive(), z.literal('target')]),
  /**
   * `last`: reuse the last action roll made in this script instead of rolling
   * again — Whirlwind's "the same attack roll against all other targets". No
   * dice, no prompt, no Hope or Fear, no spotlight; the roll's total stands
   * against each target's Difficulty as it is now.
   */
  roll: z.literal('last').optional(),
  /** Who the roll is against. The chosen target when left out. */
  targets: targetSelectorSchema.optional(),
  /** Words for what the roll is: "lock", "deceive". Features key off these. */
  tags: z.array(z.string().min(1)).optional(),
  prompt: z.string().optional(),
  get onCriticalSuccess() {
    return z.array(effectSchema).optional();
  },
  get onSuccessWithHope() {
    return z.array(effectSchema).optional();
  },
  get onSuccessWithFear() {
    return z.array(effectSchema).optional();
  },
  get onFailureWithHope() {
    return z.array(effectSchema).optional();
  },
  get onFailureWithFear() {
    return z.array(effectSchema).optional();
  },
  get always() {
    return z.array(effectSchema).optional();
  },
});

export const effectSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('log'), text: z.string(), tone: logToneSchema.optional() }),
  z.object({
    kind: z.literal('story'),
    title: z.string(),
    paragraphs: z.array(z.string()),
    button: z.string().optional(),
  }),
  z.object({ kind: z.literal('setFlag'), flag: z.string().min(1) }),
  z.object({ kind: z.literal('clearFlag'), flag: z.string().min(1) }),
  z.object({ kind: z.literal('giveKey'), key: z.string().min(1) }),
  z.object({
    kind: z.literal('addItem'),
    item: contentIdSchema,
    quantity: z.number().int().positive().optional(),
  }),
  z.object({
    kind: z.literal('removeItem'),
    item: contentIdSchema,
    quantity: z.number().int().positive().optional(),
  }),
  z.object({ kind: z.literal('setVar'), name: z.string().min(1), value: scriptValueSchema }),
  z.object({ kind: z.literal('addVar'), name: z.string().min(1), by: z.number() }),
  z.object({ kind: z.literal('open'), interactable: z.string().min(1).optional() }),
  z.object({ kind: z.literal('remove'), interactable: z.string().min(1).optional() }),
  z.object({ kind: z.literal('markUsed'), interactable: z.string().min(1).optional() }),
  z.object({ kind: z.literal('loot'), table: contentIdSchema.optional() }),
  /**
   * Damage, one of two ways. `amount` marks that many Hit Points outright — a
   * trap, a hidden thorn — and is what content always meant by this. `dice`
   * rolls damage ("d8+2", "2d6") and takes it through thresholds, resistances
   * and Armor Slots the way an attack does; rolled once and applied to every
   * target, with the maximum dice added when the roll that bound the targets
   * was a critical.
   */
  z
    .object({
      kind: z.literal('damage'),
      amount: amountSchema.optional(),
      /**
       * "d8+2", "2d6"; `weapon` for the actor's own weapon; `theirs` for the
       * weapon of whoever is bound as the target - "redirect the attack to
       * damage an adversary instead", where the attack is theirs and not the
       * holder's; or `same` to reuse the damage already rolled in this script
       * rather than rolling again.
       */
      dice: z.string().min(1).optional(),
      type: z.enum(['physical', 'magic']).optional(),
      /**
       * Multiply the dice by the actor's Proficiency, by half of it - Glancing
       * Blow's "weapon damage using half your Proficiency", rounded up as the
       * SRD rounds everything, and never less than one die - or by their
       * Spellcast trait.
       */
      using: z.enum(['proficiency', 'halfProficiency', 'spellcast']).optional(),
      /** Cannot be reduced by Armor Slots. */
      direct: z.boolean().optional(),
      /** Half damage, rounded up — "targets who succeed take half damage". */
      half: z.boolean().optional(),
      target: targetSelectorSchema.optional(),
      source: z.string().optional(),
    })
    .refine((d) => (d.amount === undefined) !== (d.dice === undefined), {
      message: 'damage needs exactly one of amount or dice',
    }),
  z
    .object({
      kind: z.literal('heal'),
      /** Hit Points cleared outright. */
      amount: amountSchema.optional(),
      /** Or rolled for — "clear 1d4 Hit Points". Rolled once for everyone. */
      dice: z.string().min(1).optional(),
      /**
       * "Divided among them however you'd like": the number is shared out
       * rather than given to each of them whole. A Hit Point at a time, round
       * by round, to whoever still has one marked - which is what dividing it
       * evenly comes to, and nobody is handed healing they cannot use.
       */
      spread: z.boolean().optional(),
      target: targetSelectorSchema.optional(),
    })
    .refine((d) => (d.amount === undefined) !== (d.dice === undefined), {
      message: 'heal needs exactly one of amount or dice',
    }),
  z.object({
    kind: z.literal('startEncounter'),
    encounter: contentIdSchema,
    intro: z.string().optional(),
  }),
  z.object({ kind: z.literal('endEncounter'), encounter: contentIdSchema }),
  z.object({ kind: z.literal('goto'), scene: contentIdSchema }),
  z.object({ kind: z.literal('startDialogue'), dialogue: contentIdSchema }),
  z.object({ kind: z.literal('startQuest'), quest: contentIdSchema }),
  /** Ticks one step off. Starts the quest if nothing has yet. */
  z.object({
    kind: z.literal('completeObjective'),
    quest: contentIdSchema,
    objective: contentIdSchema,
  }),
  z.object({ kind: z.literal('completeQuest'), quest: contentIdSchema }),
  /** Bring a hidden objective into the journal. Starts the quest if nothing has. */
  z.object({ kind: z.literal('revealObjective'), quest: contentIdSchema, objective: contentIdSchema }),
  z.object({ kind: z.literal('failQuest'), quest: contentIdSchema }),
  /**
   * The party levels up. Daggerheart has no experience points — the GM says
   * when — so this is a milestone a designer places. `level` names the level
   * reached; left out, it is one more than the party's current level.
   */
  z.object({ kind: z.literal('levelUp'), level: z.number().int().min(2).max(10).optional() }),
  z.object({
    kind: z.literal('branch'),
    when: conditionSchema,
    get then() {
      return z.array(effectSchema);
    },
    get otherwise() {
      return z.array(effectSchema).optional();
    },
  }),
  z.object({
    kind: z.literal('choice'),
    title: z.string().optional(),
    body: z.string().optional(),
    get options() {
      return z.array(choiceOptionSchema);
    },
  }),
  z.object({
    kind: z.literal('check'),
    get check() {
      return checkRequestSchema;
    },
  }),
  // ---- what an ability can do to a creature ---------------------------------
  z.object({ kind: z.literal('markStress'), amount: amountSchema.optional(), target: targetSelectorSchema.optional() }),
  z.object({ kind: z.literal('clearStress'), amount: amountSchema.optional(), target: targetSelectorSchema.optional() }),
  z.object({ kind: z.literal('clearArmor'), amount: z.number().int().positive().optional(), target: targetSelectorSchema.optional() }),
  /**
   * Mark Armor Slots without their benefit — the SRD's "must mark an Armor
   * Slot without receiving its benefits". Marks what there is; a script that
   * cares whether there was room asks with a `pool` condition first.
   */
  z.object({ kind: z.literal('markArmor'), amount: z.number().int().positive().optional(), target: targetSelectorSchema.optional() }),
  /** The GM gains Fear. */
  z.object({ kind: z.literal('gainFear'), amount: amountSchema.optional() }),
  /**
   * "Steal a number of Fear from the GM equal to the number of targets that
   * are Horrified (up to the number of Fear in the GM's pool)": the pool comes
   * down, and an empty one is simply nothing taken.
   */
  z.object({ kind: z.literal('loseFear'), amount: amountSchema.optional() }),
  z.object({ kind: z.literal('gainHope'), amount: amountSchema.optional(), target: targetSelectorSchema.optional() }),
  /** The actor spends Hope. Refused, and journalled as such, when they cannot. */
  z.object({ kind: z.literal('spendHope'), amount: amountSchema.optional() }),
  /**
   * "They lose a Hope" — what a stat block takes rather than what a card
   * spends: nothing is refused, a creature with none simply loses none. The
   * SRD's "if they can't lose a Hope they mark 2 Stress instead" is a branch
   * on how much was taken, which is the GM's to read.
   */
  z.object({ kind: z.literal('loseHope'), amount: amountSchema.optional(), target: targetSelectorSchema.optional() }),
  z.object({
    kind: z.literal('applyCondition'),
    condition: z.string().min(1),
    duration: conditionDurationSchema.optional(),
    target: targetSelectorSchema.optional(),
  }),
  z.object({ kind: z.literal('clearCondition'), condition: z.string().min(1), target: targetSelectorSchema.optional() }),
  /**
   * A weapon attack as an effect — "make an attack with your primary weapon".
   * A full action roll: Hope or Fear, the spotlight, a critical's extra dice.
   */
  z.object({
    kind: z.literal('attack'),
    weapon: z.enum(['primary', 'secondary']).optional(),
    /**
     * Whose swing it is. The one acting, unless `target` - the creature bound
     * as the target makes it instead, which is what Words of Discord turns an
     * adversary's own attack into. Whom they swing at is `target` on the
     * effect, read from the actor's chair as everything else is: the one who
     * spoke names the neighbour, and the charmed creature does the rest.
     */
    by: z.literal('target').optional(),
    /**
     * Who is swung at. More than one is swung at in turn — an adversary's
     * "make an attack against all targets in front of it" — each with its own
     * roll, and `onHit` runs once with everyone it beat bound to `hit`.
     */
    target: targetSelectorSchema.optional(),
    advantage: z.number().int().optional(),
    damageBonus: z.number().int().optional(),
    /**
     * "Add a d10 to the damage roll": dice behind the swing rather than a flat
     * number. Rolled once, before the first target, because a blow rolled once
     * lands the same total on everyone it beats.
     *
     * `weaponDie` is one die of whatever the actor swings - the SRD's "roll an
     * additional damage die", which it says two dozen times - and `weapon` is
     * the whole of their printed damage.
     */
    damageDice: z.string().min(1).optional(),
    /** Damage dice instead of the attacker's own — a feature's "2d6". */
    damage: z.string().min(1).optional(),
    /**
     * Reach instead of the attacker's own. A stat block prints one range for
     * its claws and its features reach further ("all targets within Close
     * range" from a creature that swings at Very Close), so a feature says how
     * far it goes rather than borrowing the block's teeth.
     */
    range: rangeBandSchema.optional(),
    /** Damage no Armor Slot reduces — "deal 2d10+6 direct magic damage". */
    direct: z.boolean().optional(),
    /**
     * "Those Minions move into Melee range of the target and make one shared
     * attack roll. On a success, they deal 2 physical damage each. Combine
     * this damage." Everyone this names walks in and swings with the one
     * making the attack: one roll, and the damage multiplied by how many are
     * standing beside the target when it lands. Whoever cannot get there does
     * not join, and does not count.
     */
    joinedBy: targetSelectorSchema.optional(),
    get onHit() {
      return z.array(effectSchema).optional();
    },
    get onMiss() {
      return z.array(effectSchema).optional();
    },
  }),
  /**
   * Put tokens on a card the actor holds, or take them off. The amount may be
   * a count - "place a number of tokens equal to the number of Hit Points you
   * marked" - and `all` takes every token off at once, which is what a card
   * that spends its pile in one go asks for. Otherwise `amount` defaults
   * to the card's own count for `addToken` and to one for `spendToken`;
   * spending more than are there is refused and journalled as such.
   */
  z.object({
    kind: z.literal('addToken'),
    ability: contentIdSchema,
    amount: amountSchema.optional(),
    target: targetSelectorSchema.optional(),
  }),
  z.object({
    kind: z.literal('spendToken'),
    ability: contentIdSchema,
    amount: amountSchema.optional(),
    /** Every token on the card - "then clear all tokens". */
    all: z.boolean().optional(),
    target: targetSelectorSchema.optional(),
  }),
  /** Knock the targets back, away from the actor, to this band. */
  z.object({ kind: z.literal('push'), to: rangeBandSchema, target: targetSelectorSchema.optional() }),
  /**
   * "Summon three Jagged Knife Lackeys, who appear at Far range."
   *
   * Puts creatures off a stat block onto the map, in the band named, around
   * whoever is acting. They join the fight the moment they stand up — the
   * encounter reads the map rather than a roster — so nothing else has to be
   * told about them.
   */
  z.object({
    kind: z.literal('summon'),
    /** The stat block they come off. */
    adversary: contentIdSchema,
    /** How many, as dice: "3", "1d4", "1d4+1". One when left out. */
    count: z.string().min(1).optional(),
    /** Multiply the count by the number of party members still standing. */
    perPc: z.boolean().optional(),
    /** The band they appear in, measured from the one summoning. Close by default. */
    range: rangeBandSchema.optional(),
    /** "…and is immediately spotlighted": they act now rather than next turn. */
    spotlight: z.boolean().optional(),
  }),
  /**
   * "When the Realm-Breaker marks their last HP, replace them with the
   * Undefeated Champion and immediately spotlight them", "split them into two
   * Tiny Green Oozes (with no marked HP or Stress)".
   *
   * The creature acting is taken off the map and what the feature names stands
   * where it stood, fresh off its own stat block. Put it last in a feature:
   * everything after it is read with an actor that is no longer there.
   */
  z.object({
    kind: z.literal('replace'),
    /** The stat block that stands up in its place. */
    adversary: contentIdSchema,
    /** How many of them, as dice. One when left out; a Split says two. */
    count: z.string().min(1).optional(),
    /** "…and immediately spotlight them": they act now, on the same coin. */
    spotlight: z.boolean().optional(),
  }),
  /**
   * The creature acting walks: "move into Melee range of the target", "move up
   * to Far range and make a standard attack", "teleport up to Far range".
   *
   * A walk rather than a step through walls - the pathfinder decides what it
   * can reach - and the ground it covers is `budget`, Close by default, which
   * is what a creature gets on its turn. `toward` stops as soon as `range` is
   * close enough; `away` puts as much ground between them as it can.
   *
   * Somebody else being moved is `push`: this is only ever the one acting.
   */
  z.object({
    kind: z.literal('move'),
    /**
     * Who moves. The one acting when left out, which is what every walk in the
     * SRD means; a selector is for a spell that takes somebody with it.
     */
    who: targetSelectorSchema.optional(),
    /**
     * Put them there rather than walk them: no path, no ground crossed, only
     * the band between where they stand and where they are going. A tile
     * somebody is already on is not one to arrive on, so the nearest free one
     * is taken instead - which is what a crowded landing looks like.
     */
    teleport: z.boolean().optional(),
    /** Closing or breaking away. Closing by default. */
    how: z.enum(['toward', 'away']).optional(),
    /** Who the walk is measured against. The chosen target by default. */
    of: targetSelectorSchema.optional(),
    /**
     * Or the tile the script was aimed at, for a run across the map rather
     * than at somebody: "run a straight path to a point within Far range".
     * With nothing aimed, nobody moves.
     */
    to: z.literal('point').optional(),
    /** For `toward`: the band to end up within. Melee by default. */
    range: rangeBandSchema.optional(),
    /** How far it may walk. Close by default. */
    budget: rangeBandSchema.optional(),
  }),
  /**
   * "Spend 2 Fear to spotlight the Head Guard and up to 2d4 allies within Far
   * range": the GM's turn handed to its own side.
   *
   * The spotlights are already paid for - the feature's cost bought them - so
   * the creatures named act this turn without the GM being billed again. The
   * one acting is never one of them: it is already in the spotlight, which is
   * how it came to be using this.
   */
  z.object({
    kind: z.literal('spotlight'),
    /** Who to hand it to. Adversaries within Far of the actor by default. */
    targets: targetSelectorSchema.optional(),
    /** How many of them, as dice: "2", "1d4+1", "2d4". All of them when left out. */
    count: z.string().min(1).optional(),
    /**
     * "Attacks they make while spotlighted in this way deal half damage."
     * Reads on the standard attack the creature swings on the turn it was
     * given, and comes off the moment it acts.
     */
    halfDamage: z.boolean().optional(),
  }),
  /**
   * "Before rolling damage for the Construct's attack, mark a Stress to gain a
   * +10 bonus to the damage roll": what a creature adds to a blow that has
   * already landed but has not yet been counted.
   *
   * The blow may be its own or somebody else's - the Turret adds its cannon to
   * an ally's hit - so nothing here says whose it is. Like `endSpotlight`, this
   * journals rather than writes: the swing is the game layer's to finish, and
   * it adds up every boost the moment reported before the defence begins.
   */
  z.object({
    kind: z.literal('boostDamage'),
    /**
     * Dice to roll and add ("d6", "2d4"), or `weapon` for the actor's own
     * printed attack damage - "add the Turret's standard attack damage" - the
     * same word the `damage` effect uses for it.
     */
    dice: z.string().min(1).optional(),
    /** Or a flat number: "a +10 bonus to the damage roll". */
    amount: amountSchema.optional(),
    /**
     * How many times to roll `dice`, when the count is something the fight
     * decided: "roll the dice on this card", where what is on the card is a d8
     * for every blow the marked adversary landed. A count of nothing adds
     * nothing, which is a card with an empty pile rather than a mistake.
     */
    times: amountSchema.optional(),
    /**
     * "Double the result of your damage roll." The blow's own total, twice,
     * before anything this effect adds - the same order `standardAttack.double`
     * reads in, so a doubled swing with a card behind it doubles the swing and
     * not the card.
     */
    double: z.boolean().optional(),
    /**
     * "This attack deals magic damage regardless of the weapon's damage type":
     * what the blow counts as from here, for the resistances that answer it.
     */
    type: z.enum(['physical', 'magic']).optional(),
  }),
  /**
   * "When you roll your damage dice, you can reroll any 1s or 2s": the faces
   * the blow came up on, thrown again.
   *
   * Journalled rather than written, like everything else that answers a blow
   * being held: only the game layer knows what the dice actually showed, and
   * the new faces stand however they fall - a reroll is a reroll, not a pick
   * of the better one.
   */
  z.object({
    kind: z.literal('rerollDamage'),
    /** Faces under this are thrown again. "Any 1s or 2s" is three. */
    below: z.number().int().positive(),
  }),
  /**
   * "Your ally can reroll their dice", "allow them to reroll either their Hope
   * or Fear Die": the Duality Dice of a roll that has been made and read, put
   * back in the cup before anything comes of it.
   *
   * Journalled like the damage rerolls above, and for the same reason: the
   * faces belong to the swing, and the swing belongs to whoever stopped it
   * here. What the game layer does with it is throw the named dice again and
   * resolve the whole blow around the new pair - a reroll can turn a miss into
   * a hit, a hit into a miss, and either into a critical.
   *
   * Only a swing somebody is being asked about hears it. A check made through
   * the runner - a chest, a spell - is not held anywhere it could be rerolled,
   * which is the same limit `payout` has.
   */
  z.object({
    kind: z.literal('rerollDuality'),
    /** Which of the two goes back in the cup. Both when left out. */
    which: z.enum(['hope', 'fear', 'both']).default('both'),
  }),
  /**
   * "Spend any number of tokens to roll that number of d6s and reduce the
   * incoming damage by that amount": what a card takes off a blow that is
   * arriving, rolled by the card rather than named by the defence step.
   *
   * The mirror of `boostDamage`, and read the same way: journalled rather than
   * written, and the game layer takes it off the blow before the thresholds
   * are read. Only a blow somebody is being asked about hears it - the defence
   * the engine decides on its own uses the shapes on the card, not its script.
   *
   * What it rolled becomes the script's last damage, so "deal that amount back
   * to them" is a plain `damage` with `dice: 'same'`.
   */
  z.object({
    kind: z.literal('softenBlow'),
    /** Dice to roll and take off ("2d6"), or a flat number. */
    dice: z.string().min(1).optional(),
    amount: amountSchema.optional(),
  }),
  /**
   * "You can avoid the attack": the blow arrives and does nothing at all.
   *
   * Not a miss and not a reduction - the attack roll succeeded, and then it
   * found nobody. Whatever the swing would have done afterwards it does not
   * do: no Hit Points, no rider on the hit, nothing for the block to be proud
   * of.
   */
  z.object({ kind: z.literal('avoidBlow') }),
  /**
   * "Reduce the severity of the damage by one threshold": the blow is counted
   * as it was, armor and all, and then steps down a band.
   *
   * Not the same as taking a number off it - a step is a step whatever the
   * dice said - and read after the armor rather than instead of it, because
   * the cards that say it are paying for something the armor did not do.
   */
  z.object({
    kind: z.literal('stepSeverity'),
    steps: z.number().int().positive().optional(),
  }),
  /**
   * "Roll a d4 and gain a bonus to your Evasion equal to the result against
   * the attack": a blow that has already been rolled, measured again against
   * a Difficulty that just went up.
   *
   * The swing is the GM's, so what is compared is the d20 it was made with. A
   * natural 20 is past arguing with - "your roll automatically succeeds" - and
   * a bonus that is not enough changes nothing at all.
   */
  z.object({
    kind: z.literal('dodgeBy'),
    dice: z.string().min(1).optional(),
    amount: amountSchema.optional(),
  }),
  /**
   * "Roll a number of d6s equal to your Proficiency. If any roll a 6...": a
   * handful of dice, and what happens if one of them comes up.
   *
   * Three cards ask this and no two of them ask it the same way - one rolls
   * per Hope spent, one per point of Proficiency, one per token - so `times`
   * is an amount like any other. No dice at all is no roll: `otherwise` runs
   * and nothing is journalled, because a card whose holder spent nothing has
   * not rolled and failed, it has not rolled.
   */
  z.object({
    kind: z.literal('diceCheck'),
    /** The die to roll, once per `times`: "1d6". */
    dice: z.string().min(1),
    times: amountSchema.optional(),
    /** A die showing this or better is one that came up. */
    atLeast: z.number().int().positive(),
    /** How many have to come up. One - "if any roll a 6" - unless said. */
    needed: z.number().int().positive().optional(),
    get then() {
      return z.array(effectSchema);
    },
    get otherwise() {
      return z.array(effectSchema).optional();
    },
  }),
  /**
   * "Force the target to mark a number of Hit Points equal to the number of
   * Hit Points you currently have marked instead of rolling for damage": the
   * blow arrives as a flat number of Hit Points, past thresholds, resistance
   * and Armor Slots.
   *
   * The moment is the same one `boostDamage` answers - a hit that has not been
   * counted - and like it this journals rather than writes. It wins over
   * anything added to the roll, because a blow that is not being rolled for
   * cannot be added to. Only the party's own swing obeys it today; on a stat
   * block's blow it is a silent no-op.
   */
  z.object({
    kind: z.literal('forceHitPoints'),
    amount: amountSchema,
  }),
  /**
   * "Spend a Fear to deal Severe damage instead of their standard damage": the
   * blow lands in the band it names, whatever the dice said.
   *
   * The sibling of `forceHitPoints`, and the softer of the two: a band is not
   * a number of Hit Points, so the defender's Armor Slots still step it down
   * the way they step down a Severe hit that was rolled for. What they cannot
   * do is take damage off a total, because there is no total any more - a die
   * spent to soften the blow has nothing to soften.
   *
   * Read at the same moment `boostDamage` is, and it wins there: a blow that
   * is not being rolled for cannot be added to.
   */
  z.object({
    kind: z.literal('forceSeverity'),
    severity: z.enum(['minor', 'major', 'severe', 'massive']),
    /**
     * A floor rather than a replacement: "you never deal damage beneath a
     * target's Major damage threshold". The blow is counted as it was rolled,
     * armor and all, and only then lifted if it came out under the band.
     */
    least: z.boolean().optional(),
  }),
  /**
   * "Spend any number of Hope to roll that many d6s", "mark any number of
   * Stress to make that many additional layers": the player is asked for a
   * number, and what they answer decides what runs.
   *
   * It asks; it does not pay. What the number costs is written in `each`, the
   * same way the card's own words do it - "spend any number of tokens *to*
   * add a d6 for each" is a `spendToken` and a `boostDamage`, and both of them
   * read the answer.
   *
   * The answer reaches them by substitution rather than by binding: for each
   * number the player could give, a copy of `each` is made with the number
   * written into it. `{n}` is replaced in *every* string - dice, a label, a
   * line of log - and `'spent'` only where an amount is written, so a nested
   * question asking for `most: 'spent'` gets the word rather than the number
   * and reads as nothing. So the choice is an ordinary choice, drawn by anything that
   * can draw one, and nothing downstream has to know where the number came
   * from.
   */
  z.object({
    kind: z.literal('howMany'),
    /** The most that can be asked for: a number, a pool, or tokens on a card. */
    most: amountSchema,
    /** The least. Zero lets the player decline; one by default. */
    least: z.number().int().min(0).optional(),
    title: z.string().optional(),
    body: z.string().optional(),
    /** What one of them does, with `'spent'` and `{n}` reading the answer. */
    get each() {
      return z.array(effectSchema);
    },
  }),
  /**
   * "When you spotlight the Ooze and they don't have a token on their stat
   * block, they can't act yet": the spotlight ends without the creature acting.
   *
   * This does not stop the script - the effects after it still run, and it is
   * the *turn* that reads it once the script is done. So it can sit anywhere in
   * a list, and a `spotlighted` reaction that journals it costs the creature
   * everything the turn would have done: no feature, no swing, no shaking a
   * condition off. Anywhere but a `spotlighted` reaction on an adversary it is
   * a silent no-op, because nothing else has a spotlight to end.
   */
  z.object({ kind: z.literal('endSpotlight') }),
  /**
   * "The Construct can then take the spotlight again": the creature acting
   * goes back to the head of the GM's queue, with the turn it is about to take
   * already paid for by whatever said so.
   *
   * The mirror of `endSpotlight`, and read the same way - by the turn, once
   * the script is done. Outside a GM turn there is no queue to stand at the
   * head of and nothing happens, which is what a card doing this would come
   * to.
   */
  z.object({ kind: z.literal('spotlightAgain') }),
  /**
   * "Then place this card in your vault."
   *
   * Six of the SRD's cards spend themselves this way, and for three of them -
   * Unbreakable among them - the vaulting is the whole limit on the card: it
   * costs nothing and does something enormous, once, and then it is out of the
   * loadout until somebody pays the Recall Cost to bring it back.
   *
   * The card that vaults is the one whose script this is, so nothing names it:
   * the caller that ran it knows which one it was. On a stat block, which has
   * no loadout, this does nothing.
   */
  z.object({ kind: z.literal('vaultCard') }),
  /**
   * "Use the maximum result of one of your damage dice instead of rolling it."
   *
   * A mid-swing effect, like `boostDamage` and `forceHitPoints`: it says
   * nothing on its own and is read by whoever is holding the blow, because the
   * faces the dice came up are not something a script can see. What it is
   * worth is the difference between one die and what that die could have been.
   */
  z.object({ kind: z.literal('maxOneDie') }),
  /**
   * "Activate the countdown. It ticks down when a PC makes an attack roll.
   * When it triggers, ...": a clock the fight carries between turns.
   *
   * Starting one that is already running restarts it rather than running two,
   * so a feature that arms on its holder's first spotlight is written with
   * `uses` and one that arms again is saying "start over".
   *
   * What it does when it triggers is `effects`, run with the creature that
   * started it acting, however many turns later that is. Those effects travel
   * with the countdown into a save: a clock is no use if loading a game loses
   * what it was counting towards.
   */
  /**
   * "Create a visible zone of protection there for all allies within Very
   * Close range of that point": a patch of ground that means something.
   *
   * A zone names a condition and an area, and everybody standing in that area
   * bears it - walk in and you have it, walk out and you do not. What the
   * condition *does* is written where every other condition is written, so a
   * zone invents no vocabulary of its own: it is geography, and the condition
   * is the rules. Armed again under the same id it moves rather than doubling.
   */
  z.object({
    kind: z.literal('zone'),
    zone: contentIdSchema,
    name: z.string().min(1),
    /** What everybody standing in it bears. */
    condition: z.string().min(1),
    /** Where it stands: the tile that was aimed at, or the actor's own. */
    at: z.enum(['point', 'actor']).optional(),
    band: rangeBandSchema,
    /** Which side it touches, read from the actor's chair. Everybody by default. */
    side: z.enum(['allies', 'adversaries']).optional(),
    /** What the one who cast it falling does to it. It stands by default. */
    onDeath: z.enum(['end', 'keep']).optional(),
    /** A number it holds, which comes off any damage taken inside it. */
    value: z.number().int().min(0).optional(),
    /** And what that number does each time it answers a blow. */
    grows: z.object({ by: z.number().int().positive(), until: z.number().int().positive() }).optional(),
  }),
  /** "The spell ends": that patch of ground stops meaning anything. */
  z.object({ kind: z.literal('endZone'), zone: contentIdSchema }),
  z.object({
    kind: z.literal('countdown'),
    /** Stable id for this clock, so restarting it is telling one from another. */
    countdown: contentIdSchema,
    /** What the table calls it: the feature's name, near enough always. */
    name: z.string().min(1),
    /** Starting value, as dice: "5", "1d6", "2d6". */
    start: z.string().min(1),
    /** What advances it. Standard - every action roll a player makes - by default. */
    advance: z.enum(COUNTDOWN_ADVANCES).optional(),
    /** Loop, increasing or decreasing. Left out, it is spent when it triggers. */
    loop: z.enum(COUNTDOWN_LOOPS).optional(),
    /**
     * What the owner falling does to it. A countdown ends with the creature
     * counting it ("if the Gorgon is defeated, all petrification countdowns
     * end"); `trigger` is the Ashen Tyrant's death throes, which go off.
     */
    onDeath: z.enum(['end', 'trigger']).optional(),
    get effects() {
      return z.array(effectSchema).default([]);
    },
  }),
  /**
   * The targets roll to avoid something: adversaries a d20, party members
   * their Duality Dice with `trait`. `onFail` runs with the ones who failed
   * bound to `hit`, then `onSuccess` with the ones who passed. `difficulty:
   * 'roll'` is the result of the actor's last roll, as Chain Lightning asks.
   */
  /**
   * Run a hook: TypeScript registered with the engine, or a `project.code[]`
   * entry the editor wrote. It reads the world and queues effects, which run
   * here, before whatever follows this one. See `script/hooks.ts`.
   */
  z.object({
    kind: z.literal('run'),
    hook: contentIdSchema,
    args: hookArgsSchema.optional(),
  }),
  z.object({
    kind: z.literal('reactionRoll'),
    difficulty: z.union([z.number().int().positive(), z.literal('roll')]),
    trait: traitSchema.optional(),
    targets: targetSelectorSchema.optional(),
    /**
     * Damage rolled once, before anyone rolls to avoid it — the shape almost
     * every adversary's area attack is written in: "targets who fail take
     * 4d6+5 physical damage; targets who succeed take half damage". Both
     * branches then spend it with `{ kind: 'damage', dice: 'same' }`, the
     * successes adding `half`, so the halves match the number that was rolled
     * and nobody failing still leaves the successes something to halve.
     */
    damage: z.object({ dice: z.string().min(1), type: z.enum(['physical', 'magic']).optional() }).optional(),
    get onFail() {
      return z.array(effectSchema).optional();
    },
    get onSuccess() {
      return z.array(effectSchema).optional();
    },
  }),
]);

export type Condition = z.infer<typeof conditionSchema>;
export type Effect = z.infer<typeof effectSchema>;
export type CheckRequest = z.infer<typeof checkRequestSchema>;
export type CheckTrait = z.infer<typeof checkTraitSchema>;
export type ConditionDuration = z.infer<typeof conditionDurationSchema>;
export type PoolName = z.infer<typeof poolNameSchema>;
export type ChoiceOption = z.infer<typeof choiceOptionSchema>;
export type TargetSelector = z.infer<typeof targetSelectorSchema>;
export type ScriptValue = z.infer<typeof scriptValueSchema>;
export type CompareOp = z.infer<typeof compareOpSchema>;
export type LogTone = z.infer<typeof logToneSchema>;
export type HookArgs = z.infer<typeof hookArgsSchema>;

/**
 * Visit every effect in a tree, including the ones nested inside a branch, a
 * choice's options and a check's outcomes.
 *
 * Validation needs this in several places — which dialogues does this scenario
 * start, which scenes does it travel to — and a walk that forgets to descend
 * into `branch.otherwise` reports a clean bill of health for a broken file.
 */
export function walkEffects(
  effects: readonly Effect[] | undefined,
  visit: (effect: Effect) => void,
): void {
  for (const effect of effects ?? []) {
    visit(effect);
    switch (effect.kind) {
      case 'branch':
        walkEffects(effect.then, visit);
        walkEffects(effect.otherwise, visit);
        break;
      case 'choice':
        for (const option of effect.options) walkEffects(option.effects, visit);
        break;
      case 'check':
        walkCheck(effect.check, visit);
        break;
      case 'attack':
        walkEffects(effect.onHit, visit);
        walkEffects(effect.onMiss, visit);
        break;
      case 'reactionRoll':
        walkEffects(effect.onFail, visit);
        walkEffects(effect.onSuccess, visit);
        break;
      case 'countdown':
        walkEffects(effect.effects, visit);
        break;
      case 'howMany':
        walkEffects(effect.each, visit);
        break;
      case 'diceCheck':
        walkEffects(effect.then, visit);
        if (effect.otherwise !== undefined) walkEffects(effect.otherwise, visit);
        break;
      default:
        break;
    }
  }
}

/** Visit a condition and every condition nested inside it. */
export function walkCondition(condition: Condition, visit: (condition: Condition) => void): void {
  visit(condition);
  switch (condition.kind) {
    case 'not':
      walkCondition(condition.of, visit);
      break;
    case 'all':
    case 'any':
      for (const inner of condition.of) walkCondition(inner, visit);
      break;
    default:
      break;
  }
}

/**
 * Every condition an effect tree reads: a branch's `when`, a choice option's
 * `available`. Effects are walked with `walkEffects`; this is the other half a
 * validator needs when a condition names content that has to exist.
 */
export function walkConditionsIn(
  effects: readonly Effect[] | undefined,
  visit: (condition: Condition) => void,
): void {
  walkEffects(effects, (effect) => {
    if (effect.kind === 'branch') walkCondition(effect.when, visit);
    if (effect.kind === 'choice') {
      for (const option of effect.options) {
        if (option.available !== undefined) walkCondition(option.available, visit);
      }
    }
  });
}

/** Every condition read anywhere inside a check's outcomes, each visited once. */
export function walkConditionsInCheck(
  check: CheckRequest,
  visit: (condition: Condition) => void,
): void {
  walkConditionsIn(check.onCriticalSuccess, visit);
  walkConditionsIn(check.onSuccessWithHope, visit);
  walkConditionsIn(check.onSuccessWithFear, visit);
  walkConditionsIn(check.onFailureWithHope, visit);
  walkConditionsIn(check.onFailureWithFear, visit);
  walkConditionsIn(check.always, visit);
}

/** Every effect a check can run, whichever way the roll goes. */
export function walkCheck(check: CheckRequest, visit: (effect: Effect) => void): void {
  walkEffects(check.onCriticalSuccess, visit);
  walkEffects(check.onSuccessWithHope, visit);
  walkEffects(check.onSuccessWithFear, visit);
  walkEffects(check.onFailureWithHope, visit);
  walkEffects(check.onFailureWithFear, visit);
  walkEffects(check.always, visit);
}
