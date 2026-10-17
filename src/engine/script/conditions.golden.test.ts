/**
 * Conditions evaluated as the Rust server must evaluate them (`docs/SERVER.md`, phase 2), with marks,
 * zones and countdowns beside them.
 *
 * `evaluate` walks a condition and asks its context - the world - what it needs to know, and a dice hand
 * for a `chance`. The world is not ported yet, so this records every question the evaluation asks, with
 * the real world's answer, in order: the Rust walks the same condition against that tape and must ask the
 * same questions in the same order, none left unasked, to the same verdict. A hook's own reads are the
 * hook's: what the evaluation gathers for it, and its verdict, are what is taped.
 *
 * The conditions are every one the shipped content and the default project carry, and a set written here
 * so every kind is met with answers both ways, each evaluated in three worlds (a character acting, an
 * adversary acting, nobody) under several bindings, with and without dice. Beside that: mark keys, the
 * zone and countdown snapshot schemas, and countdown boards advanced, reaped and ended off a seeded stream.
 * `UPDATE_GOLDEN=1 npx vitest run src/engine/script/conditions.golden.test.ts` writes
 * `server/fixtures/conditions.json`; `server/engine/tests/golden_conditions.rs` replays it.
 */

import { describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRng, type Rng } from '../core/rng';
import { TileGrid } from '../grid/grid';
import { parseDice, rollDice } from '../rules/dice';
import type { CountdownCue } from '../rules/countdown';
import { SceneState, createAdversaryEntity, createPartyEntity } from '../scene/state';
import { STARTER_ABILITIES, STARTER_CONDITIONS } from '../content/pack/starter';
import { evaluate, evaluateOptional, variablesUsed, type ConditionContext, type DiceHand, type TargetBindings } from './conditions';
import { advanceBoard, endCreatureCountdowns, reapBoard, runningCountdownSchema, type CountdownBoard, type RunningCountdown } from './countdowns';
import { defineHooks } from './hooks';
import { markKey, parseMarkKey } from './marks';
import { conditionSchema, type Condition } from './schema';
import { SceneScriptWorld, createScenarioState } from './world';
import { runningZoneSchema } from './zones';

/** The questions asked during one evaluation, or null while nothing is recorded. */
const rec = vi.hoisted(() => ({ depth: 0, calls: null as unknown[] | null }));
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value ?? null)) as T;

vi.mock('./hooks', async (importOriginal) => {
  const original = await importOriginal<typeof import('./hooks')>();
  const runHook: typeof original.runHook = (fn, context) => {
    if (rec.calls === null || rec.depth > 0) return original.runHook(fn, context);
    rec.depth++;
    try {
      const result = original.runHook(fn, context);
      const reads = context as unknown as { args: unknown; actor: unknown; targets: unknown; hit: unknown; inCombat: unknown };
      rec.calls.push({ call: 'runHook', args: clone(reads.args), actor: reads.actor, targets: clone(reads.targets), hit: clone(reads.hit), inCombat: reads.inCombat, answer: result.ok && result.value === true });
      return result;
    } finally {
      rec.depth--;
    }
  };
  return { ...original, runHook };
});

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), '../../../server/fixtures/conditions.json');

/** What the world answers, taped. `hook` is recorded as whether one is defined. */
const ASKED = [
  'hasFlag', 'hasKey', 'hasItem', 'getVar', 'interactableState', 'encounterState', 'countAlive', 'questStatus', 'objectiveDone',
  'actorId', 'resolveTargets', 'inCombat', 'loadoutDomain', 'hasCondition', 'poolValue', 'bandTo', 'factionOf', 'difficultyOf', 'hook', 'tokensOn',
] as const;

function recorded(world: SceneScriptWorld): ConditionContext {
  return new Proxy(world, {
    get(target, key) {
      const value = Reflect.get(target, key, target) as unknown;
      if (typeof value !== 'function') return value;
      const fn = value.bind(target) as (...args: unknown[]) => unknown;
      if (!(ASKED as readonly string[]).includes(key as string)) return fn;
      return (...args: unknown[]) => {
        if (rec.calls === null || rec.depth > 0) return fn(...args);
        rec.depth++;
        try {
          const answer = fn(...args);
          rec.calls.push({ call: key, args: clone(args), answer: key === 'hook' ? answer !== null : clone(answer) });
          return answer;
        } finally {
          rec.depth--;
        }
      };
    },
  }) as unknown as ConditionContext;
}

/** A dice hand that answers off a stream and tapes what it was asked. */
function dice(rng: Rng): DiceHand {
  return {
    roll(expression) {
      const parsed = parseDice(expression);
      const answer = parsed === null ? 0 : rollDice(rng, parsed).total;
      rec.calls?.push({ call: 'roll', dice: expression, answer });
      return answer;
    },
    amount(amount) {
      const answer = typeof amount === 'number' ? amount : typeof amount === 'string' ? 2 : 'dice' in amount ? 3 : 1;
      rec.calls?.push({ call: 'amount', amount: clone(amount), answer });
      return answer;
    },
  };
}

function worldFor(actor: string | null): SceneScriptWorld {
  const grid = new TileGrid({ width: 8, height: 6 });
  const state = new SceneState({ id: 'yard' }, grid);
  state.addEntity(createPartyEntity('kara', 'sentinel', 0, { hitPoints: 6, stress: 6, armorSlots: 2 }));
  state.addEntity(createPartyEntity('mira', 'emberwright', 2));
  state.addEntity(createAdversaryEntity('a1', 'rat', 3, { hitPoints: 3, stress: 1 }));
  state.addEntity(createAdversaryEntity('a2', 'rat', 20, { hitPoints: 3, stress: 1 }));
  state.addEntity(createAdversaryEntity('n1', 'crow', 44, { hitPoints: 1, stress: 0, faction: 'neutral' }));
  state.entity('a1')!.conditions.add('hidden');
  state.entity('kara')!.conditions.add('vulnerable');
  state.entity('mira')!.stress = { max: 6, marked: 4 };
  state.entity('a2')!.alive = false;
  state.bad = { max: 12, value: 3 };
  state.interactable('door').open = true;
  state.encounter('ambush').started = true;
  const world = new SceneScriptWorld(state, createScenarioState({}, actor ?? 'kara'), {
    traits: { presence: 2, instinct: 1 },
    hooks: defineHooks({
      yes: () => true,
      no: () => false,
      one: () => 1,
      fighting: (ctx) => ctx.inCombat,
      throws: () => {
        throw new Error('no');
      },
      reads: (ctx) => ctx.pool('kara', 'stress') === 6 && ctx.args['n'] === 2,
    }),
  });
  world.scenario.actorId = actor;
  world.setFlag('met');
  world.giveKey('brass');
  world.addItem('rope', 2);
  world.setVar('count', 3);
  world.setVar('name', 'Quim');
  world.setVar(markKey('spot', 'kara'), 5);
  return world;
}

const t = { kind: 'target' };
const WRITTEN: unknown[] = [
  { kind: 'always' }, { kind: 'never' }, { kind: 'not', of: { kind: 'flag', flag: 'met' } },
  { kind: 'all', of: [{ kind: 'flag', flag: 'met' }, { kind: 'hasKey', key: 'brass' }, { kind: 'never' }, { kind: 'hasKey', key: 'x' }] },
  { kind: 'all', of: [] }, { kind: 'any', of: [] }, { kind: 'any', of: [{ kind: 'flag', flag: 'no' }, { kind: 'always' }, { kind: 'flag', flag: 'met' }] },
  { kind: 'flag', flag: 'met' }, { kind: 'flag', flag: 'other' }, { kind: 'hasKey', key: 'brass' }, { kind: 'hasKey', key: 'iron' },
  { kind: 'hasItem', item: 'rope' }, { kind: 'hasItem', item: 'rope', quantity: 3 }, { kind: 'hasItem', item: 'lamp' },
  ...['==', '!=', '<', '<=', '>', '>='].flatMap((op) => [3, 2.5, '3', null, true].map((value) => ({ kind: 'var', name: 'count', op, value }))),
  { kind: 'var', name: 'name', op: '==', value: 'Quim' }, { kind: 'all', of: [{ kind: 'var', name: 'count', op: '>', value: 1 }, { kind: 'not', of: { kind: 'var', name: 'count', op: '>', value: 9 } }] }, { kind: 'var', name: 'unset', op: '==', value: null }, { kind: 'var', name: 'unset', op: '<', value: 1 },
  { kind: 'interactable', id: 'door', state: 'open' }, { kind: 'interactable', id: 'door', state: 'used' }, { kind: 'interactable', id: 'gate', state: 'removed' },
  { kind: 'encounter', id: 'ambush', state: 'started' }, { kind: 'encounter', id: 'ambush', state: 'ended' },
  { kind: 'quest', quest: 'q', status: 'inactive' }, { kind: 'quest', quest: 'q', status: 'active' }, { kind: 'objectiveDone', quest: 'q', objective: 'o' },
  { kind: 'partyAlive', op: '==', value: 2 }, { kind: 'partyAlive', op: '<', value: 2 }, { kind: 'adversariesAlive', op: '>=', value: 2 }, { kind: 'adversariesAlive', op: '==', value: 1 },
  { kind: 'pool', pool: 'stress', op: '>', value: 1 }, { kind: 'pool', pool: 'stress', of: { kind: 'entity', id: 'mira' }, measure: 'marked', op: '==', value: 4 },
  { kind: 'pool', pool: 'good', of: t, op: '>=', value: 0 }, { kind: 'pool', pool: 'hitPoints', of: { kind: 'entity', id: 'ghost' }, op: '==', value: 0 },
  ...['hitPointsTaken', 'hitPointsDealt', 'targetsHit', 'spent'].map((of) => ({ kind: 'count', of, op: '>=', value: 1 })),
  ...['failure', 'success', 'withBad', 'withGood', 'critical'].map((is) => ({ kind: 'rolled', is })),
  { kind: 'rollTagged', tag: 'lock' }, { kind: 'rollTagged', tag: 'bash' }, { kind: 'rolledWith', trait: 'agility' }, { kind: 'rolledWith', trait: 'weapon' },
  { kind: 'hasMark', mark: 'spot' }, { kind: 'hasMark', mark: 'elsewhere' },
  { kind: 'chance', dice: 'd6', atLeast: 4 }, { kind: 'chance', dice: '2d6', atLeast: 11, times: 3 }, { kind: 'chance', dice: 'd20', atLeast: 2, times: { dice: 'd4' } },
  { kind: 'chance', dice: 'd6', atLeast: 7, times: 'targetsHit' },
  { kind: 'inCombat' }, { kind: 'loadout', domain: 'blade', op: '>=', value: 0 }, { kind: 'loadout', domain: 'blade', of: { kind: 'entity', id: 'a1' }, op: '==', value: 0 },
  { kind: 'nearby', of: { kind: 'allies', range: 'close' }, op: '>=', value: 1 }, { kind: 'nearby', of: { kind: 'adversaries', range: 'far' }, op: '<', value: { pool: 'stress' } },
  { kind: 'nearby', of: { kind: 'party' }, op: '<=', value: { pool: 'hitPoints', of: { kind: 'entity', id: 'kara' }, measure: 'max' } },
  { kind: 'nearby', of: { kind: 'party' }, op: '<=', value: { pool: 'good', of: { kind: 'entity', id: 'ghost' } } },
  { kind: 'tokens', ability: 'ward', op: '==', value: 0 }, { kind: 'tokens', ability: 'ward', of: { kind: 'party' }, op: '>', value: 0 },
  { kind: 'hasCondition', condition: 'hidden' }, { kind: 'hasCondition', condition: 'vulnerable', of: { kind: 'party' } }, { kind: 'hasCondition', condition: 'prone', of: { kind: 'party' } },
  { kind: 'self' }, { kind: 'self', of: { kind: 'actor' } }, { kind: 'self', of: { kind: 'party' } },
  { kind: 'side', is: 'ally' }, { kind: 'side', is: 'adversary' }, { kind: 'side', of: { kind: 'party' }, is: 'ally' }, { kind: 'side', of: { kind: 'entity', id: 'n1' }, is: 'adversary' },
  { kind: 'withinRange', range: 'melee' }, { kind: 'withinRange', range: 'far', of: { kind: 'adversaries', range: 'veryFar' } }, { kind: 'withinRange', range: 'close', of: { kind: 'entity', id: 'ghost' } },
  { kind: 'hook', hook: 'yes' }, { kind: 'hook', hook: 'no' }, { kind: 'hook', hook: 'one' }, { kind: 'hook', hook: 'fighting', args: { a: 1 } },
  { kind: 'hook', hook: 'throws' }, { kind: 'hook', hook: 'missing' }, { kind: 'hook', hook: 'reads', args: { n: 2, s: 'x', b: false } },
  { kind: 'not', of: { kind: 'all', of: [{ kind: 'any', of: [{ kind: 'hasCondition', condition: 'hidden' }, { kind: 'self' }] }, { kind: 'pool', pool: 'stress', op: '<', value: 6 }] } },
];

function contentConditions(): unknown[] {
  const found = new Map<string, unknown>();
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (value === null || typeof value !== 'object') return;
    if (typeof (value as { kind?: unknown }).kind === 'string' && conditionSchema.safeParse(value).success) found.set(JSON.stringify(value), value);
    Object.values(value).forEach(walk);
  };
  walk(JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../content/pack/shipped/srd-characters.json'), 'utf8')));
  walk(JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../../projects/default.json'), 'utf8')));
  walk(clone(STARTER_ABILITIES));
  walk(clone(STARTER_CONDITIONS));
  return [...found.values()];
}

const BINDINGS: TargetBindings[] = [
  { targets: [], hit: [] },
  { targets: ['a1'], hit: ['a1'], counts: { hitPointsTaken: 2, targetsHit: 1, spent: 4 } as TargetBindings['counts'], roll: { total: 14, outcome: 'successWithBad', tags: ['lock'], trait: 'agility' }, point: 11 },
  { targets: ['kara', 'mira'], hit: [], counts: { hitPointsDealt: 0 }, roll: { total: 7, outcome: 'criticalSuccess' } },
  { targets: ['n1', 'ghost'], hit: ['n1'], roll: { total: 3, outcome: 'failureWithGood', tags: [], trait: 'weapon' } },
];

function evaluations() {
  const conditions = [...WRITTEN, ...contentConditions()].map((c) => conditionSchema.parse(c));
  const cases = [];
  for (const actor of ['kara', 'a1', null]) {
    const world = worldFor(actor);
    const context = recorded(world);
    const rng = createRng(`chance:${actor}`);
    for (const condition of conditions) {
      for (const [b, bindings] of BINDINGS.entries()) {
        for (const withDice of [false, true]) {
          if (withDice && condition.kind !== 'chance' && b > 0) continue;
          const calls: unknown[] = [];
          rec.calls = calls;
          let verdict: boolean;
          try {
            verdict = evaluate(condition as Condition, context, bindings, withDice ? dice(rng) : undefined);
          } finally {
            rec.calls = null;
          }
          cases.push({ actor, condition, bindings: b, dice: withDice, calls, verdict });
        }
      }
    }
  }
  return cases;
}

function countdownBoards() {
  const rng = createRng('the countdown boards');
  const make = (id: string, over: Partial<RunningCountdown>): RunningCountdown =>
    runningCountdownSchema.parse({ id, name: id, owner: null, dice: '3', value: 3, start: 3, advance: 'standard', onDeath: 'end', effects: [{ kind: 'log', text: id }], ...over }) as RunningCountdown;
  const outcomes = ['criticalSuccess', 'successWithGood', 'successWithBad', 'failureWithGood', 'failureWithBad'] as const;
  const runs = [];
  for (let r = 0; r < 12; r++) {
    const board: CountdownBoard = new Map();
    const add = (c: RunningCountdown): void => void board.set(c.id, c);
    add(make('plain', { value: rng.nextInt(4) + 1 }));
    add(make('attacks', { advance: 'attackRoll', owner: 'a1', onDeath: 'trigger', value: 30, start: 30 }));
    add(make('bad', { advance: 'withBad', loop: 'reset', dice: 'd6', value: 2, start: 4 }));
    add(make('rising', { advance: 'progress', loop: 'increasing', value: 3, start: 3 }));
    add(make('falling', { advance: 'consequence', loop: 'decreasing', owner: 'kara', value: 1, start: 2 }));
    add(make('hurt', { advance: 'hpMarked', owner: 'a1', dice: '1d4+1', loop: 'reset', value: 4, start: 4 }));
    add(make('rolled', { advance: 'standard', loop: 'reset', dice: '2d0', value: 1, start: 1 }));
    add(make('low', { advance: 'standard', loop: 'reset', dice: '1d2-3', value: 1, start: 1 }));
    const initial = clone([...board.entries()]);
    const steps = [];
    for (let s = 0; s < 14; s++) {
      const roll = rng.nextInt(10);
      const cue: CountdownCue = roll < 7
        ? { kind: 'actionRoll', attack: rng.nextInt(2) === 0, outcome: outcomes[rng.nextInt(outcomes.length)]! }
        : { kind: 'hpMarked', id: rng.pick(['a1', 'kara', 'nobody']), marked: rng.pick([0, 1, 2, 3, -1]) };
      // The cues are drawn off the same stream, so where it stood before the advance is recorded too.
      const before = rng.save();
      const moved = advanceBoard(board, cue, rng);
      steps.push({ cue, before, moved: clone(moved), board: clone([...board.entries()]), after: rng.save() });
    }
    // Every pairing of the two owners' fates, a run each.
    const fates = ['alive', 'fallen', 'gone'] as const;
    const status = { a1: fates[r % 3]!, kara: fates[Math.floor(r / 3) % 3]! } as Record<string, 'alive' | 'fallen' | 'gone'>;
    const beforeReap = clone([...board.entries()]);
    const reaped = reapBoard(board, (id) => status[id] ?? 'gone');
    const afterReap = clone([...board.entries()]);
    endCreatureCountdowns(board);
    runs.push({ initial, steps, status, beforeReap, reaped: clone(reaped), afterReap, afterEnd: clone([...board.entries()]) });
  }
  return runs;
}

function snapshots() {
  const zone = { id: 'z', name: 'Z', owner: 'kara', condition: 'burning', anchor: 4, band: 'close' };
  const countdown = { id: 'c', name: 'C', owner: null, dice: 'd6', value: 3, start: 4, advance: 'standard', onDeath: 'end' };
  const cases = [
    ['zone', zone], ['zone', { ...zone, owner: null, side: 'allies', onDeath: 'end', value: 0, grows: { by: 1, until: 3 } }],
    ['zone', { ...zone, owner: '' }], ['zone', { ...zone, owner: 3 }], ['zone', { ...zone, anchor: 1.5, band: 'near' }], ['zone', { id: 'Z' }],
    ['zone', { ...zone, grows: { by: 0 } }], ['zone', { ...zone, onDeath: undefined }],
    ['countdown', countdown], ['countdown', { ...countdown, loop: 'reset', effects: [{ kind: 'log', text: 'x' }], owner: 'a1' }],
    ['countdown', { ...countdown, value: -1, advance: 'sometimes' }], ['countdown', { ...countdown, effects: [{ kind: 'nope' }] }], ['countdown', { ...countdown, owner: undefined }],
  ] as const;
  return cases.map(([kind, value]) => {
    const schema = kind === 'zone' ? runningZoneSchema : runningCountdownSchema;
    const plain = clone(value) as unknown;
    const result = schema.safeParse(plain);
    return { kind, value: plain, ...(result.success ? { ok: result.data } : { issues: result.error.issues.map((i) => ({ path: i.path, message: i.message })) }) };
  });
}

function golden() {
  const conditions = [...WRITTEN, ...contentConditions()].map((c) => conditionSchema.parse(c));
  return {
    about: 'src/engine/script conditions, marks, zones and countdowns for the Rust port; written by src/engine/script/conditions.golden.test.ts',
    bindings: BINDINGS,
    evaluations: evaluations(),
    optional: evaluateOptional(undefined, recorded(worldFor('kara'))),
    variables: conditions.map((c) => [c, [...variablesUsed(c as Condition)]]),
    marks: {
      keys: [['spot', 'kara'], ['a:b', 'c'], ['', '']].map(([m, a]) => [m, a, markKey(m!, a!)]),
      parsed: ['mark:spot:kara', 'mark:a:b:c', 'mark::kara', 'mark:spot:', 'mark:spot', 'spot:kara', 'mark:x:y:', 'mark:\u00e9:\u{1F600}'].map((k) => [k, parseMarkKey(k)]),
    },
    snapshots: snapshots(),
    countdowns: countdownBoards(),
  };
}

describe('conditions, marks, zones and countdowns, as the Rust server must run them', () => {
  it('are what server/fixtures/conditions.json holds', () => {
    const now = JSON.parse(JSON.stringify(golden())) as unknown;
    if (process.env['UPDATE_GOLDEN'] === '1' || !existsSync(FIXTURE)) {
      mkdirSync(dirname(FIXTURE), { recursive: true });
      writeFileSync(FIXTURE, `${JSON.stringify(now)}\n`, 'utf8');
    }
    expect(JSON.parse(readFileSync(FIXTURE, 'utf8'))).toEqual(now);
  });
});
