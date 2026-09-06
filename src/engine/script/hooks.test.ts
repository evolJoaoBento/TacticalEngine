import { describe, it, expect } from 'vitest';
import { compileHooks, defineHooks, mergeHooks, runHook, SAFE_MATH, type HookContext } from './hooks';
import { evaluate, hookReads, NO_BINDINGS, type ConditionContext } from './conditions';
import type { Effect } from './schema';

/**
 * Logic in code: the door the effect vocabulary leaves open.
 *
 * Two rules are the whole design, and both are tested here: a hook writes
 * only by queueing effects, so nothing escapes the journal, and a hook rolls
 * only off the seeded stream, so a replay stays in step.
 */

const reads = (overrides: Partial<ConditionContext> = {}): ConditionContext => ({
  hasFlag: () => false,
  hasKey: () => false,
  hasItem: () => false,
  getVar: () => null,
  interactableState: () => ({ used: false, open: false, removed: false }),
  encounterState: () => ({ started: false, ended: false, triggered: false }),
  countAlive: () => 2,
  questStatus: () => 'inactive',
  objectiveDone: () => false,
  actorId: () => 'kara',
  resolveTargets: () => ['husk-1'],
  inCombat: () => true,
  loadoutDomain: () => null,
  hasCondition: () => false,
  poolValue: () => 3,
  bandTo: () => 'close',
  difficultyOf: () => 11,
  hook: () => null,
  tokensOn: () => 0,
  ...overrides,
});

const context = (source: string, overrides: Partial<ConditionContext> = {}): { ctx: HookContext; queued: Effect[] } => {
  const queued: Effect[] = [];
  const ctx: HookContext = {
    ...hookReads(reads(overrides), { targets: ['husk-1'], hit: [] }, { amount: 2 }),
    rng: { die: () => 4 } as unknown as HookContext['rng'],
    lastRoll: { total: 15, critical: false, outcome: 'successWithHope' },
    queue: (effects) => {
      queued.push(...effects);
    },
    log: (text, tone) => {
      queued.push({ kind: 'log', text, ...(tone === undefined ? {} : { tone }) });
    },
  };
  void source;
  return { ctx, queued };
};

describe('project code', () => {
  it('compiles a body, reads the world, and queues effects rather than writing', () => {
    const { hooks, issues } = compileHooks([
      {
        id: 'test-hook',
        name: 'Test',
        source: `ctx.queue([{ kind: 'damage', amount: ctx.args.amount, target: { kind: 'entity', id: ctx.targets[0] } }]);
return ctx.pool(ctx.actor, 'hope') > 2;`,
      },
    ]);
    expect(issues).toEqual([]);
    const { ctx, queued } = context('');
    const result = runHook(hooks.get('test-hook')!, ctx);
    expect(result).toEqual({ ok: true, value: true });
    expect(queued).toEqual([{ kind: 'damage', amount: 2, target: { kind: 'entity', id: 'husk-1' } }]);
  });

  it('reports a body that will not parse, and still compiles the rest', () => {
    const { hooks, issues } = compileHooks([
      { id: 'broken', name: '', source: 'return (;' },
      { id: 'fine', name: '', source: 'return 1;' },
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.id).toBe('broken');
    expect(hooks.has('broken')).toBe(false);
    expect(hooks.has('fine')).toBe(true);
  });

  it('turns a throw into a message instead of taking the game down', () => {
    const { hooks } = compileHooks([{ id: 'angry', name: '', source: 'throw new Error("nope");' }]);
    const { ctx } = context('');
    expect(runHook(hooks.get('angry')!, ctx)).toEqual({ ok: false, message: 'nope' });
  });

  it('cannot reach the page, the clock, or the network', () => {
    const { hooks } = compileHooks([
      { id: 'nosy', name: '', source: 'return [typeof document, typeof window, typeof Date, typeof fetch, typeof globalThis].join(",");' },
    ]);
    const { ctx } = context('');
    expect(runHook(hooks.get('nosy')!, ctx)).toEqual({ ok: true, value: 'undefined,undefined,undefined,undefined,undefined' });
  });

  it('refuses Math.random, so a seeded replay cannot drift', () => {
    const { hooks } = compileHooks([{ id: 'cheat', name: '', source: 'return Math.random();' }]);
    const { ctx } = context('');
    const result = runHook(hooks.get('cheat')!, ctx);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain('ctx.rng');
    // The rest of Math is there.
    expect(SAFE_MATH.max(1, 2)).toBe(2);
    expect(SAFE_MATH.floor(1.9)).toBe(1);
  });

  it('rolls off the context stream when it rolls', () => {
    const { hooks } = compileHooks([{ id: 'roller', name: '', source: 'return ctx.rng.die(6) + ctx.rng.die(6);' }]);
    const { ctx } = context('');
    expect(runHook(hooks.get('roller')!, ctx)).toEqual({ ok: true, value: 8 });
  });
});

describe('the lookup', () => {
  it('lets a project override a native hook by id, and keeps the rest', () => {
    const native = defineHooks({ a: () => 'native-a', b: () => 'native-b' });
    const project = defineHooks({ b: () => 'project-b' });
    const merged = mergeHooks(native, project, undefined);
    const { ctx } = context('');
    expect(runHook(merged.get('a')!, ctx)).toEqual({ ok: true, value: 'native-a' });
    expect(runHook(merged.get('b')!, ctx)).toEqual({ ok: true, value: 'project-b' });
  });
});

describe('a hook as a condition', () => {
  it('is true only when the code returns true, and false when nothing defines it', () => {
    const { hooks } = compileHooks([
      { id: 'rich', name: '', source: "return ctx.pool(ctx.actor, 'hope') >= 3;" },
      { id: 'vague', name: '', source: 'return 1;' },
    ]);
    const world = reads({ hook: (id) => hooks.get(id) ?? null });
    expect(evaluate({ kind: 'hook', hook: 'rich' }, world, NO_BINDINGS)).toBe(true);
    // Truthy is not true: a predicate must say so.
    expect(evaluate({ kind: 'hook', hook: 'vague' }, world, NO_BINDINGS)).toBe(false);
    expect(evaluate({ kind: 'hook', hook: 'missing' }, world, NO_BINDINGS)).toBe(false);
    const poor = reads({ hook: (id) => hooks.get(id) ?? null, poolValue: () => 1 });
    expect(evaluate({ kind: 'hook', hook: 'rich' }, poor, NO_BINDINGS)).toBe(false);
  });

  it('has no dice and no way to write', () => {
    const { hooks } = compileHooks([{ id: 'sneaky', name: '', source: 'return typeof ctx.queue === "undefined" && typeof ctx.rng === "undefined";' }]);
    const world = reads({ hook: (id) => hooks.get(id) ?? null });
    expect(evaluate({ kind: 'hook', hook: 'sneaky' }, world, NO_BINDINGS)).toBe(true);
  });
});
