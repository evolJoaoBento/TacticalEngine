/**
 * Logic in code, for the things data cannot say.
 *
 * The effect vocabulary covers what the SRD's cards do, and deliberately stops
 * there: it is serialisable, editable in a tool, and safe to replay. Some
 * things a designer wants are still code — "roll a d6 for every Hope you care
 * to spend", "offer one option per adversary in reach", a house rule nobody
 * anticipated. A hook is that code, reached from the one vocabulary by
 * `{ kind: 'run', hook: 'id' }` and `{ kind: 'hook', hook: 'id' }`.
 *
 * There are two doors and one lookup:
 *
 * - **Native hooks**, TypeScript registered at build time (`defineHooks`).
 *   The engine's own live in `content/srd/hooks.ts`.
 * - **Project code**, JavaScript text the project carries (`project.code[]`)
 *   and the editor writes. Compiled here with `new Function`.
 *
 * Two rules keep hooks from being a hole in everything else:
 *
 * 1. **A hook cannot write directly.** It reads the world and *queues effects*
 *    (`ctx.queue`), which the runner then runs like any other. So every change
 *    is journalled, shown in the log, and undoable by the same code paths — a
 *    hook can never quietly move a Hit Point.
 * 2. **A hook cannot roll its own dice.** `Math.random` throws inside a hook;
 *    `ctx.rng` is the scenario's seeded stream. A replay stays in step.
 *
 * Project code is *trusted*, exactly as the rest of a project file is: the
 * shadowing below stops honest mistakes (a stray `Date.now()` that would
 * desync a replay, a `fetch` in a card), not an attacker who wrote your
 * campaign. Do not load a project you would not run.
 */

import type { Rng } from '../core/rng';
import type { RangeBand } from '../rules/range';
import type { CheckOutcome } from './effects';
import type { Effect, LogTone, PoolName, ScriptValue, TargetSelector } from './schema';

/** Arguments an effect passes to a hook, as content can write them. */
export type HookArgs = Readonly<Record<string, string | number | boolean>>;

/** What every hook may read. A `hook` condition gets exactly this and no more. */
export interface HookReads {
  /** The `args` the effect or condition was written with. */
  readonly args: HookArgs;
  /** Whoever is acting, or null outside an ability (a chest's script). */
  readonly actor: string | null;
  /** The creatures the ability was aimed at. */
  readonly targets: readonly string[];
  /** The ones the last roll beat. */
  readonly hit: readonly string[];
  readonly inCombat: boolean;
  /** A pool on a creature: `available` by default, or `marked` / `max`. */
  pool(id: string, pool: PoolName, measure?: 'available' | 'marked' | 'max'): number | null;
  hasCondition(id: string, condition: string): boolean;
  /** The band between two creatures, or null when either is off the map. */
  bandTo(from: string, to: string): RangeBand | null;
  /** What a roll against this creature must beat. */
  difficultyOf(id: string): number | null;
  /** The creatures a selector names — the same selectors content writes. */
  select(selector: TargetSelector): string[];
  flag(name: string): boolean;
  variable(name: string): ScriptValue;
  countAlive(faction: 'party' | 'adversary'): number;
  /** Tokens sitting on a card a creature holds. */
  tokens(id: string, ability: string): number;
}

/** What a `run` hook gets: the reads, the dice, and the way to make something happen. */
export interface HookContext extends HookReads {
  /** The scenario's seeded stream. The only randomness a hook may use. */
  readonly rng: Rng;
  /** The last action roll made in this script, for a hook that follows one. */
  readonly lastRoll: { total: number; critical: boolean; outcome: CheckOutcome } | null;
  /** Effects to run here, in order, before the rest of the list this hook sits in. */
  queue(effects: readonly Effect[]): void;
  /** Sugar for queueing one `log`. */
  log(text: string, tone?: LogTone): void;
}

/**
 * A hook. The return value matters only for a `hook` condition, where it is
 * read as a boolean.
 */
export type HookFn = (context: HookContext) => unknown;

/** A hook used as a predicate never rolls and never writes. */
export type PredicateContext = HookReads;

/** Hooks by id: native ones and compiled project code, looked up the same way. */
export type HookMap = ReadonlyMap<string, HookFn>;

/** Register native hooks. A plain helper, so a game module reads as a list. */
export function defineHooks(hooks: Readonly<Record<string, HookFn>>): HookMap {
  return new Map(Object.entries(hooks));
}

/** Later maps win, so a project may override a native hook by id. */
export function mergeHooks(...maps: readonly (HookMap | undefined)[]): HookMap {
  const out = new Map<string, HookFn>();
  for (const map of maps) {
    if (map === undefined) continue;
    for (const [id, fn] of map) out.set(id, fn);
  }
  return out;
}

/** One project-code entry, as `project.code[]` holds it. */
export interface CodeSource {
  id: string;
  name: string;
  source: string;
}

/** A piece of project code that would not compile. */
export interface HookIssue {
  id: string;
  message: string;
}

export interface CompiledHooks {
  hooks: HookMap;
  issues: readonly HookIssue[];
}

/**
 * Names a hook body must not reach. They are declared as parameters and passed
 * `undefined`, so `Date.now()` inside a hook is a TypeError the author sees at
 * once rather than a replay that quietly diverges.
 *
 * `eval` cannot be shadowed in strict mode, and `import()` is syntax; project
 * code is trusted, so this is a guard rail, not a sandbox.
 */
export const SHADOWED = [
  'globalThis',
  'window',
  'self',
  'document',
  'navigator',
  'location',
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'setTimeout',
  'setInterval',
  'requestAnimationFrame',
  'Date',
  'console',
  'process',
  'require',
  'module',
  'exports',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'crypto',
  'performance',
  'Function',
] as const;

/** `Math` with the one non-deterministic member replaced by an explanation. */
export const SAFE_MATH: typeof Math = (() => {
  const copy: Record<string, unknown> = {};
  for (const key of Object.getOwnPropertyNames(Math)) {
    copy[key] = (Math as unknown as Record<string, unknown>)[key];
  }
  copy['random'] = (): never => {
    throw new Error('Math.random is not available in a hook: roll off ctx.rng so replays stay in step');
  };
  return Object.freeze(copy) as unknown as typeof Math;
})();

/**
 * Compile project code into hooks. A body that will not parse becomes an
 * issue and no hook, so the rest of the project still loads.
 */
export function compileHooks(code: readonly CodeSource[]): CompiledHooks {
  const hooks = new Map<string, HookFn>();
  const issues: HookIssue[] = [];
  for (const entry of code) {
    try {
      // The body sees its parameters and nothing else it could reach by name.
      const compiled = new Function(...SHADOWED, 'ctx', 'Math', `'use strict';\n${entry.source}`) as (
        ...args: unknown[]
      ) => unknown;
      hooks.set(entry.id, (context: HookContext) => {
        const shadows = SHADOWED.map(() => undefined);
        return compiled(...shadows, context, SAFE_MATH);
      });
    } catch (error) {
      issues.push({ id: entry.id, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return { hooks, issues };
}

/** What a hook did: a value, or the message of whatever it threw. */
export type HookResult = { ok: true; value: unknown } | { ok: false; message: string };

/** Call a hook, turning a throw into something the journal can say. */
export function runHook(fn: HookFn, context: HookContext): HookResult {
  try {
    return { ok: true, value: fn(context) };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}
