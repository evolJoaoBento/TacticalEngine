/**
 * Conditions, as data.
 *
 * Content constantly needs to ask "is this allowed / has this happened yet" — a
 * dialogue choice that only appears once you know about the cranks, a door that
 * needs a key, an encounter that fires the first time and never again. The legacy
 * prototype answered those with JavaScript closures, which meant its campaign
 * could not be saved, edited in a tool, or authored by anyone who was not editing
 * the engine.
 *
 * This is deliberately *not* a general expression language. It is the smallest set
 * of predicates the ported one-shot actually needs
 * (docs/research/legacy-campaign.md §6), which keeps it serialisable, safe to run
 * on untrusted content, and previewable in an editor.
 */

/**
 * The shapes themselves live in `schema.ts`, because content has to be able to
 * *hold* a condition as well as evaluate one. These are re-exported so the many
 * modules that import a `Condition` from here keep working.
 */
export type { Condition, CompareOp, ScriptValue } from './schema';
export { conditionSchema } from './schema';

import type { Condition, CompareOp, CountName, HookArgs, PoolName, ScriptValue, TargetSelector } from './schema';
import type { QuestQuery } from '../content/quests';
import type { HookFn, HookReads } from './hooks';
import { runHook } from './hooks';
import { reaches, type RangeBand } from '../rules/range';
import type { RollOutcome } from '../rules/duality';

/**
 * What `target` and `hit` mean right now: the creatures an ability was used
 * on, and the ones its last roll beat. A chest's script has neither.
 */
export interface TargetBindings {
  targets: readonly string[];
  hit: readonly string[];
  /**
   * Numbers the thing that started this script left behind: how much of a blow
   * landed, how much its answer has marked. Left out by everything that is not
   * answering a blow, and a count nobody wrote reads as zero.
   */
  counts?: Partial<Record<CountName, number>>;
  /**
   * The roll that raised this, for a feature that answers one: "when a PC
   * rolls a failure with Fear while within Close range of the Demon".
   */
  roll?: { total: number; outcome: RollOutcome };
  /**
   * A tile the script is aimed at: "run a straight path to a point within Far
   * range", "choose a point within Far range". Bound the same way a target is,
   * because it is the same kind of thing - what the one acting picked - and a
   * selector that reads it says so.
   *
   * `NO_TILE` or absent is nobody having picked, which every shape reads as
   * catching nothing rather than as an error.
   */
  point?: number;
}

export const NO_BINDINGS: TargetBindings = { targets: [], hit: [] };

/** A count as a number: the one the bindings carry, or nothing at all. */
export function countOf(bindings: TargetBindings, name: CountName): number {
  return bindings.counts?.[name] ?? 0;
}

/** What a condition is evaluated against. Read-only: conditions never mutate. */
export interface ConditionContext {
  hasFlag(flag: string): boolean;
  hasKey(key: string): boolean;
  hasItem(item: string, quantity?: number): boolean;
  getVar(name: string): ScriptValue;
  interactableState(id: string): { used: boolean; open: boolean; removed: boolean };
  encounterState(id: string): { started: boolean; ended: boolean; triggered: boolean };
  countAlive(faction: 'party' | 'adversary'): number;
  /** Where a quest stands; `inactive` when nothing has started it. */
  questStatus(quest: string): QuestQuery;
  objectiveDone(quest: string, objective: string): boolean;
  /** The acting creature, if there is one. */
  actorId(): string | null;
  /** The living creatures a selector names, in a stable order. */
  resolveTargets(selector: TargetSelector, bindings: TargetBindings): string[];
  inCombat(): boolean;
  /** How many of a domain's cards sit in a character's loadout. */
  loadoutDomain(id: string, domain: string): number | null;
  hasCondition(id: string, condition: string): boolean;
  /** A pool on a creature, or null for a creature that is not there. */
  poolValue(id: string, pool: PoolName, measure: 'available' | 'marked' | 'max'): number | null;
  /** The range band between two creatures, or null when either is off the map. */
  bandTo(from: string, to: string): RangeBand | null;
  /** Which side a creature is on, or null for one that is not in the scene. */
  factionOf(id: string): 'party' | 'adversary' | null;
  /** What a roll against this creature must beat: Evasion, or a Difficulty. */
  difficultyOf(id: string): number | null;
  /** A hook by id — native or project code — or null when nothing defines it. */
  hook(id: string): HookFn | null;
  /** Tokens sitting on a card a creature holds. */
  tokensOn(id: string, ability: string): number;
}

/**
 * The read-only half of a hook's context, built from whatever a condition is
 * evaluated against. A predicate hook gets this; a `run` hook gets this plus
 * the dice and `queue` (`runner.ts` adds those).
 */
export function hookReads(context: ConditionContext, bindings: TargetBindings, args: HookArgs = {}): HookReads {
  return {
    args,
    actor: context.actorId(),
    targets: bindings.targets,
    hit: bindings.hit,
    inCombat: context.inCombat(),
    pool: (id, pool, measure = 'available') => context.poolValue(id, pool, measure),
    hasCondition: (id, condition) => context.hasCondition(id, condition),
    bandTo: (from, to) => context.bandTo(from, to),
    difficultyOf: (id) => context.difficultyOf(id),
    select: (selector) => context.resolveTargets(selector, bindings),
    flag: (name) => context.hasFlag(name),
    variable: (name) => context.getVar(name),
    countAlive: (faction) => context.countAlive(faction),
    factionOf: (id) => context.factionOf(id),
    tokens: (id, ability) => context.tokensOn(id, ability),
  };
}

function compare(left: ScriptValue, op: CompareOp, right: ScriptValue): boolean {
  if (op === '==') return left === right;
  if (op === '!=') return left !== right;
  // Ordering only makes sense between numbers; anything else is false rather
  // than a coercion surprise.
  if (typeof left !== 'number' || typeof right !== 'number') return false;
  switch (op) {
    case '<':
      return left < right;
    case '<=':
      return left <= right;
    case '>':
      return left > right;
    case '>=':
      return left >= right;
  }
}

/** Evaluate a condition. Total: an unknown variable reads as `null`, never throws. */
export function evaluate(
  condition: Condition,
  context: ConditionContext,
  bindings: TargetBindings = NO_BINDINGS,
): boolean {
  switch (condition.kind) {
    case 'always':
      return true;
    case 'never':
      return false;
    case 'not':
      return !evaluate(condition.of, context, bindings);
    case 'all':
      return condition.of.every((c) => evaluate(c, context, bindings));
    case 'any':
      return condition.of.some((c) => evaluate(c, context, bindings));
    case 'flag':
      return context.hasFlag(condition.flag);
    case 'hasItem':
      return context.hasItem(condition.item, condition.quantity ?? 1);
    case 'hasKey':
      return context.hasKey(condition.key);
    case 'var':
      return compare(context.getVar(condition.name), condition.op, condition.value);
    case 'interactable':
      return context.interactableState(condition.id)[condition.state];
    case 'encounter':
      return context.encounterState(condition.id)[condition.state];
    case 'quest':
      return context.questStatus(condition.quest) === condition.status;
    case 'objectiveDone':
      return context.objectiveDone(condition.quest, condition.objective);
    case 'partyAlive':
      return compare(context.countAlive('party'), condition.op, condition.value);
    case 'adversariesAlive':
      return compare(context.countAlive('adversary'), condition.op, condition.value);
    case 'pool': {
      // The first creature the selector names; "the actor" for a card's own cost.
      const id = context.resolveTargets(condition.of ?? { kind: 'actor' }, bindings)[0];
      if (id === undefined) return false;
      const value = context.poolValue(id, condition.pool, condition.measure ?? 'available');
      return value !== null && compare(value, condition.op, condition.value);
    }
    case 'count':
      // `spent` is written into a copy of the effects before they run, so a
      // gate that asks for it is asking about nothing: a quiet zero.
      return compare(condition.of === 'spent' ? 0 : countOf(bindings, condition.of), condition.op, condition.value);
    case 'rolled': {
      const outcome = bindings.roll?.outcome;
      if (outcome === undefined) return false;
      switch (condition.is) {
        case 'failure':
          return outcome === 'failureWithHope' || outcome === 'failureWithFear';
        case 'success':
          return outcome !== 'failureWithHope' && outcome !== 'failureWithFear';
        case 'withFear':
          return outcome === 'successWithFear' || outcome === 'failureWithFear';
        case 'withHope':
          return outcome === 'successWithHope' || outcome === 'failureWithHope' || outcome === 'criticalSuccess';
        case 'critical':
          return outcome === 'criticalSuccess';
      }
    }
    case 'inCombat':
      return context.inCombat();
    case 'loadout': {
      const who = context.resolveTargets(condition.of ?? { kind: 'actor' }, bindings)[0];
      if (who === undefined) return false;
      const held = context.loadoutDomain(who, condition.domain);
      return held !== null && compare(held, condition.op, condition.value);
    }
    case 'hasCondition':
      return context
        .resolveTargets(condition.of ?? { kind: 'target' }, bindings)
        .some((id) => context.hasCondition(id, condition.condition));
    case 'nearby': {
      const many = context.resolveTargets(condition.of, bindings).length;
      if (typeof condition.value === 'number') return compare(many, condition.op, condition.value);
      // Against a pool of somebody's: the actor's unless the gate says whose.
      const who = context.resolveTargets(condition.value.of ?? { kind: 'actor' }, bindings)[0];
      if (who === undefined) return false;
      const held = context.poolValue(who, condition.value.pool, condition.value.measure ?? 'marked');
      return held !== null && compare(many, condition.op, held);
    }
    case 'tokens': {
      const ids = context.resolveTargets(condition.of ?? { kind: 'actor' }, bindings);
      return ids.some((id) => compare(context.tokensOn(id, condition.ability), condition.op, condition.value));
    }
    case 'hook': {
      // A hook nobody defined is false, not a crash: content outlives the code
      // that backed it, and a missing predicate must not stop a scene.
      const fn = context.hook(condition.hook);
      if (fn === null) return false;
      const result = runHook(fn, hookReads(context, bindings, condition.args ?? {}) as never);
      return result.ok && result.value === true;
    }
    case 'self': {
      const actor = context.actorId();
      if (actor === null) return false;
      const named = context.resolveTargets(condition.of ?? { kind: 'target' }, bindings);
      return named.length > 0 && named.every((id) => id === actor);
    }
    case 'side': {
      const actor = context.actorId();
      const mine = actor === null ? null : context.factionOf(actor);
      if (mine === null) return false;
      const want = condition.is === 'ally' ? mine : mine === 'party' ? 'adversary' : 'party';
      const named = context.resolveTargets(condition.of ?? { kind: 'target' }, bindings);
      return named.length > 0 && named.every((id) => context.factionOf(id) === want);
    }
    case 'withinRange': {
      const actor = context.actorId();
      if (actor === null) return false;
      return context.resolveTargets(condition.of ?? { kind: 'target' }, bindings).some((id) => {
        const band = context.bandTo(actor, id);
        return band !== null && reaches(band, condition.range);
      });
    }
  }
}

/** An omitted condition means "yes". */
export function evaluateOptional(
  condition: Condition | undefined,
  context: ConditionContext,
  bindings: TargetBindings = NO_BINDINGS,
): boolean {
  return condition === undefined || evaluate(condition, context, bindings);
}

// ---------------------------------------------------------------------------
// Constructors — content is usually written in TypeScript before it is authored
// in a tool, and these read better than object literals.
// ---------------------------------------------------------------------------

export const always: Condition = { kind: 'always' };
export const never: Condition = { kind: 'never' };
export const not = (of: Condition): Condition => ({ kind: 'not', of });
export const all = (...of: Condition[]): Condition => ({ kind: 'all', of });
export const any = (...of: Condition[]): Condition => ({ kind: 'any', of });
export const flag = (name: string): Condition => ({ kind: 'flag', flag: name });
export const hasKey = (key: string): Condition => ({ kind: 'hasKey', key });
export const variable = (name: string, op: CompareOp, value: ScriptValue): Condition => ({
  kind: 'var',
  name,
  op,
  value,
});

/** Every variable name a condition reads, for an editor to offer or validate. */
export function variablesUsed(condition: Condition, into = new Set<string>()): Set<string> {
  switch (condition.kind) {
    case 'var':
      into.add(condition.name);
      break;
    case 'not':
      variablesUsed(condition.of, into);
      break;
    case 'all':
    case 'any':
      for (const c of condition.of) variablesUsed(c, into);
      break;
    default:
      break;
  }
  return into;
}
