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

/** A value a variable can hold. Scenario state has to be JSON, so this is it. */
export type ScriptValue = string | number | boolean | null;

export type CompareOp = '==' | '!=' | '<' | '<=' | '>' | '>=';

export type Condition =
  /** Always true — the default when content omits a condition. */
  | { kind: 'always' }
  | { kind: 'never' }
  | { kind: 'not'; of: Condition }
  | { kind: 'all'; of: readonly Condition[] }
  | { kind: 'any'; of: readonly Condition[] }
  /** A story flag has been set. */
  | { kind: 'flag'; flag: string }
  /** The party holds a key. */
  | { kind: 'hasKey'; key: string }
  /** A scenario variable compared against a literal. */
  | { kind: 'var'; name: string; op: CompareOp; value: ScriptValue }
  /** An interactable's runtime state. */
  | { kind: 'interactable'; id: string; state: 'used' | 'open' | 'removed' }
  /** An encounter's runtime state. */
  | { kind: 'encounter'; id: string; state: 'started' | 'ended' | 'triggered' }
  /** How many of the party are still standing. */
  | { kind: 'partyAlive'; op: CompareOp; value: number }
  /** Whether any adversary is still standing. */
  | { kind: 'adversariesAlive'; op: CompareOp; value: number };

/** What a condition is evaluated against. Read-only: conditions never mutate. */
export interface ConditionContext {
  hasFlag(flag: string): boolean;
  hasKey(key: string): boolean;
  getVar(name: string): ScriptValue;
  interactableState(id: string): { used: boolean; open: boolean; removed: boolean };
  encounterState(id: string): { started: boolean; ended: boolean; triggered: boolean };
  countAlive(faction: 'party' | 'adversary'): number;
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
export function evaluate(condition: Condition, context: ConditionContext): boolean {
  switch (condition.kind) {
    case 'always':
      return true;
    case 'never':
      return false;
    case 'not':
      return !evaluate(condition.of, context);
    case 'all':
      return condition.of.every((c) => evaluate(c, context));
    case 'any':
      return condition.of.some((c) => evaluate(c, context));
    case 'flag':
      return context.hasFlag(condition.flag);
    case 'hasKey':
      return context.hasKey(condition.key);
    case 'var':
      return compare(context.getVar(condition.name), condition.op, condition.value);
    case 'interactable':
      return context.interactableState(condition.id)[condition.state];
    case 'encounter':
      return context.encounterState(condition.id)[condition.state];
    case 'partyAlive':
      return compare(context.countAlive('party'), condition.op, condition.value);
    case 'adversariesAlive':
      return compare(context.countAlive('adversary'), condition.op, condition.value);
  }
}

/** An omitted condition means "yes". */
export function evaluateOptional(
  condition: Condition | undefined,
  context: ConditionContext,
): boolean {
  return condition === undefined || evaluate(condition, context);
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
