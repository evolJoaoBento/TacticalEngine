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
  /** The creatures the last roll beat; `having` keeps only those with a condition. */
  z.object({ kind: z.literal('hit'), having: z.string().min(1).optional() }),
  z.object({
    kind: z.literal('allies'),
    /** Living party members within this band of the actor. Everywhere when left out. */
    range: rangeBandSchema.optional(),
    includeSelf: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal('adversaries'),
    range: rangeBandSchema,
    around: z.enum(['actor', 'target']).optional(),
    /** Leave the chosen target out: "all other targets within range". */
    except: z.enum(['target']).optional(),
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
  z.object({ kind: z.literal('inCombat') }),
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
      amount: z.number().int().positive().optional(),
      /**
       * "d8+2", "2d6"; `weapon` for the actor's own weapon; or `same` to reuse
       * the damage already rolled in this script rather than rolling again.
       */
      dice: z.string().min(1).optional(),
      type: z.enum(['physical', 'magic']).optional(),
      /** Multiply the dice by the actor's Proficiency, or by their Spellcast trait. */
      using: z.enum(['proficiency', 'spellcast']).optional(),
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
  z.object({
    kind: z.literal('heal'),
    amount: z.number().int().positive(),
    target: targetSelectorSchema.optional(),
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
  z.object({ kind: z.literal('markStress'), amount: z.number().int().positive().optional(), target: targetSelectorSchema.optional() }),
  z.object({ kind: z.literal('clearStress'), amount: z.number().int().positive().optional(), target: targetSelectorSchema.optional() }),
  z.object({ kind: z.literal('clearArmor'), amount: z.number().int().positive().optional(), target: targetSelectorSchema.optional() }),
  /**
   * Mark Armor Slots without their benefit — the SRD's "must mark an Armor
   * Slot without receiving its benefits". Marks what there is; a script that
   * cares whether there was room asks with a `pool` condition first.
   */
  z.object({ kind: z.literal('markArmor'), amount: z.number().int().positive().optional(), target: targetSelectorSchema.optional() }),
  /** The GM gains Fear. */
  z.object({ kind: z.literal('gainFear'), amount: z.number().int().positive().optional() }),
  z.object({ kind: z.literal('gainHope'), amount: z.number().int().positive().optional(), target: targetSelectorSchema.optional() }),
  /** The actor spends Hope. Refused, and journalled as such, when they cannot. */
  z.object({ kind: z.literal('spendHope'), amount: z.number().int().positive().optional() }),
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
     * Who is swung at. More than one is swung at in turn — an adversary's
     * "make an attack against all targets in front of it" — each with its own
     * roll, and `onHit` runs once with everyone it beat bound to `hit`.
     */
    target: targetSelectorSchema.optional(),
    advantage: z.number().int().optional(),
    damageBonus: z.number().int().optional(),
    /** Damage dice instead of the attacker's own — a feature's "2d6". */
    damage: z.string().min(1).optional(),
    get onHit() {
      return z.array(effectSchema).optional();
    },
    get onMiss() {
      return z.array(effectSchema).optional();
    },
  }),
  /**
   * Put tokens on a card the actor holds, or take them off. `amount` defaults
   * to the card's own count for `addToken` and to one for `spendToken`;
   * spending more than are there is refused and journalled as such.
   */
  z.object({
    kind: z.literal('addToken'),
    ability: contentIdSchema,
    amount: z.number().int().positive().optional(),
    target: targetSelectorSchema.optional(),
  }),
  z.object({
    kind: z.literal('spendToken'),
    ability: contentIdSchema,
    amount: z.number().int().positive().optional(),
    target: targetSelectorSchema.optional(),
  }),
  /** Knock the targets back, away from the actor, to this band. */
  z.object({ kind: z.literal('push'), to: rangeBandSchema, target: targetSelectorSchema.optional() }),
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
