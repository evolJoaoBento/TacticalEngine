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

export const targetSelectorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('actor') }),
  z.object({ kind: z.literal('party') }),
  z.object({ kind: z.literal('entity'), id: z.string().min(1) }),
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
export const checkRequestSchema = z.object({
  trait: traitSchema,
  difficulty: z.number().int().positive(),
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
  z.object({
    kind: z.literal('damage'),
    amount: z.number().int().positive(),
    target: targetSelectorSchema.optional(),
    source: z.string().optional(),
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
]);

export type Condition = z.infer<typeof conditionSchema>;
export type Effect = z.infer<typeof effectSchema>;
export type CheckRequest = z.infer<typeof checkRequestSchema>;
export type ChoiceOption = z.infer<typeof choiceOptionSchema>;
export type TargetSelector = z.infer<typeof targetSelectorSchema>;
export type ScriptValue = z.infer<typeof scriptValueSchema>;
export type CompareOp = z.infer<typeof compareOpSchema>;
export type LogTone = z.infer<typeof logToneSchema>;

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
