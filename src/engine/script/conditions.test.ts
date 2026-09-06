import { describe, it, expect } from 'vitest';
import {
  all,
  always,
  any,
  evaluate,
  evaluateOptional,
  flag,
  hasKey,
  never,
  not,
  variable,
  variablesUsed,
  type Condition,
  type ConditionContext,
} from './conditions';

function context(overrides: Partial<ConditionContext> = {}): ConditionContext {
  const flags = new Set<string>();
  const keys = new Set<string>();
  return {
    hasFlag: (f) => flags.has(f),
    hasKey: (k) => keys.has(k),
    hasItem: (k) => keys.has(k),
    getVar: () => null,
    interactableState: () => ({ used: false, open: false, removed: false }),
    encounterState: () => ({ started: false, ended: false, triggered: false }),
    countAlive: () => 0,
    difficultyOf: () => null,
    hook: () => null,
    questStatus: () => 'inactive',
    objectiveDone: () => false,
    actorId: () => null,
    resolveTargets: () => [],
    inCombat: () => false,
    hasCondition: () => false,
    poolValue: () => null,
    bandTo: () => null,
    ...overrides,
  };
}

describe('boolean structure', () => {
  it('handles the constants and negation', () => {
    const ctx = context();
    expect(evaluate(always, ctx)).toBe(true);
    expect(evaluate(never, ctx)).toBe(false);
    expect(evaluate(not(always), ctx)).toBe(false);
    expect(evaluate(not(never), ctx)).toBe(true);
  });

  it('requires all and accepts any', () => {
    const ctx = context();
    expect(evaluate(all(always, always), ctx)).toBe(true);
    expect(evaluate(all(always, never), ctx)).toBe(false);
    expect(evaluate(any(never, always), ctx)).toBe(true);
    expect(evaluate(any(never, never), ctx)).toBe(false);
  });

  it('treats an empty all as true and an empty any as false', () => {
    const ctx = context();
    expect(evaluate(all(), ctx)).toBe(true);
    expect(evaluate(any(), ctx)).toBe(false);
  });

  it('treats an omitted condition as yes', () => {
    expect(evaluateOptional(undefined, context())).toBe(true);
    expect(evaluateOptional(never, context())).toBe(false);
  });
});

describe('world predicates', () => {
  it('reads flags and keys', () => {
    const ctx = context({ hasFlag: (f) => f === 'met-hag', hasKey: (k) => k === 'brass' });
    expect(evaluate(flag('met-hag'), ctx)).toBe(true);
    expect(evaluate(flag('other'), ctx)).toBe(false);
    expect(evaluate(hasKey('brass'), ctx)).toBe(true);
    expect(evaluate(hasKey('iron'), ctx)).toBe(false);
  });

  it('reads interactable and encounter state', () => {
    const ctx = context({
      interactableState: () => ({ used: true, open: false, removed: false }),
      encounterState: () => ({ started: true, ended: false, triggered: true }),
    });
    expect(evaluate({ kind: 'interactable', id: 'chest', state: 'used' }, ctx)).toBe(true);
    expect(evaluate({ kind: 'interactable', id: 'chest', state: 'open' }, ctx)).toBe(false);
    expect(evaluate({ kind: 'encounter', id: 'group-1', state: 'started' }, ctx)).toBe(true);
    expect(evaluate({ kind: 'encounter', id: 'group-1', state: 'ended' }, ctx)).toBe(false);
  });

  it('counts the living on each side', () => {
    const ctx = context({ countAlive: (faction) => (faction === 'party' ? 3 : 0) });
    expect(evaluate({ kind: 'partyAlive', op: '>', value: 0 }, ctx)).toBe(true);
    expect(evaluate({ kind: 'partyAlive', op: '>=', value: 4 }, ctx)).toBe(false);
    expect(evaluate({ kind: 'adversariesAlive', op: '==', value: 0 }, ctx)).toBe(true);
  });
});

describe('variables', () => {
  const ctx = context({
    getVar: (name) => ({ mood: 'vengeful', cranks: 2, done: true }[name] ?? null),
  });

  it('compares strings and booleans for equality only', () => {
    expect(evaluate(variable('mood', '==', 'vengeful'), ctx)).toBe(true);
    expect(evaluate(variable('mood', '!=', 'entertained'), ctx)).toBe(true);
    expect(evaluate(variable('done', '==', true), ctx)).toBe(true);
  });

  it('orders numbers', () => {
    expect(evaluate(variable('cranks', '>=', 2), ctx)).toBe(true);
    expect(evaluate(variable('cranks', '>', 2), ctx)).toBe(false);
    expect(evaluate(variable('cranks', '<', 4), ctx)).toBe(true);
  });

  it('reads an unset variable as null rather than throwing', () => {
    expect(evaluate(variable('nothing', '==', null), ctx)).toBe(true);
    expect(evaluate(variable('nothing', '==', 'something'), ctx)).toBe(false);
  });

  it('refuses to order non-numbers instead of coercing them', () => {
    // "vengeful" > 1 is a content mistake, and false is safer than a surprise.
    expect(evaluate(variable('mood', '>', 1), ctx)).toBe(false);
    expect(evaluate(variable('nothing', '<', 5), ctx)).toBe(false);
  });
});

describe('variablesUsed', () => {
  it('finds every variable a nested condition reads', () => {
    const condition: Condition = all(
      variable('mood', '==', 'vengeful'),
      not(variable('cranks', '<', 4)),
      any(flag('lit'), variable('phase', '==', 3)),
    );
    expect([...variablesUsed(condition)].sort()).toEqual(['cranks', 'mood', 'phase']);
  });

  it('is empty for a condition that reads none', () => {
    expect(variablesUsed(all(flag('a'), hasKey('b'))).size).toBe(0);
  });
});
