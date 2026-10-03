/**
 * Hooks as the Rust server must run them (`docs/SERVER.md`, phase 2).
 *
 * A hook is JavaScript: the server runs it in QuickJS (`server/hooks`), the browser with `new Function`.
 * This runs every hook the default project and the SRD pack carry, and a set written here for the rest of
 * what a hook can reach - every read, every die, the last roll, the queue, what it may not touch, what it
 * throws, and the language itself - through the engine's own `compileHooks`, `hookReads` and `runHook`,
 * in the demo's world. Each read that reaches the world is taped with its answer; the outcome, what was
 * queued and where the dice stream stood after are kept, and whose words an error is in: the hook's, the
 * engine's own shims' (the dice, `Math.random`) - both of which must match word for word - or the
 * JavaScript engine's, which V8 and QuickJS word differently, so only its kind is held to.
 * `UPDATE_GOLDEN=1 npx vitest run src/engine/script/hooks.golden.test.ts` writes
 * `server/fixtures/hooks.json`; `server/hooks/tests/golden_hooks.rs` replays it.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRng } from '../core/rng';
import { buildDemoScene } from '../../game/demo-scene';
import { hollowVaultMap } from '../../game/demo-map';
import { startEncounter } from '../../game/movement';
import { hookReads, type TargetBindings } from './conditions';
import { compileHooks, runHook, unfamiliarCode, type CodeSource, type HookContext, type HookFn } from './hooks';
import type { SceneScriptWorld } from './world';

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), '../../../server/fixtures/hooks.json');
const here = dirname(fileURLToPath(import.meta.url));
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value ?? null)) as T;

/** The world's reads a hook reaches, by the name the Rust reader answers them under. */
const READS: Record<string, string> = {
  poolValue: 'pool', hasCondition: 'hasCondition', bandTo: 'bandTo', difficultyOf: 'difficultyOf', resolveTargets: 'select',
  hasFlag: 'flag', getVar: 'variable', countAlive: 'countAlive', factionOf: 'factionOf', tokensOn: 'tokens',
};
const KINDS = ['actor', 'party', 'entity', 'entities', 'target', 'hit', 'allies', 'inPath', 'adversaries'];

/**
 * Whether a read gets as far as the world, and what it is asked with. A creature named by anything but a
 * string is nobody - a `Map` keyed by strings finds nothing - so the answer is the world's without the
 * world; what the TypeScript builds a key from, or indexes an object with, it reads as text.
 */
function reaching(read: string, args: unknown[]): unknown[] | null {
  const text = (v: unknown): string => String(v);
  const named = (v: unknown): boolean => typeof v === 'string';
  switch (read) {
    case 'pool':
      return named(args[0]) ? [args[0], text(args[1]), text(args[2])] : null;
    case 'hasCondition':
      return named(args[0]) ? [args[0], text(args[1])] : null;
    case 'bandTo':
      return named(args[0]) && named(args[1]) ? args : null;
    case 'select': {
      const selector = args[0] as { kind?: unknown } | null;
      return typeof selector === 'object' && selector !== null && KINDS.includes(String(selector.kind)) ? [selector] : null;
    }
    case 'variable':
      return [text(args[0])];
    case 'tokens':
      return [text(args[0]), text(args[1])];
    default:
      return named(args[0]) ? args.slice(0, 1) : null;
  }
}

/** The world with its reads taped while `live` says a hook is running. */
function taping(world: SceneScriptWorld, tape: { live: boolean; asked: unknown[] }): SceneScriptWorld {
  return new Proxy(world, {
    get(target, key) {
      const value = (target as unknown as Record<string | symbol, unknown>)[key];
      if (typeof value !== 'function') return value;
      const fn = (value as (...a: unknown[]) => unknown).bind(target);
      const read = READS[key as string];
      if (read === undefined) return fn;
      return (...args: unknown[]) => {
        const asked = tape.live ? reaching(read, read === 'select' ? args.slice(0, 1) : args) : null;
        let answer: unknown;
        try {
          answer = fn(...args);
        } catch (error) {
          // A read the world could not make - a pool no creature has - throws where the hook made it.
          if (asked !== null) tape.asked.push({ call: read, args: clone(asked), threw: error instanceof Error ? error.name : String(error) });
          throw error;
        }
        if (asked !== null) tape.asked.push({ call: read, args: clone(asked), answer: clone(answer) });
        return answer;
      };
    },
  });
}

type Thrower = 'hook' | 'shim' | 'engine';

interface Case {
  name: string;
  code: CodeSource[];
  id: string;
  effect: boolean;
  actor?: string | null;
  targets?: string[];
  hit?: string[];
  args?: Record<string, string | number | boolean>;
  lastRoll?: { total: number; critical: boolean; outcome: 'successWithGood' | 'failureWithBad' | 'criticalSuccess' } | null;
  flags?: string[];
  fight?: boolean;
  /** Whose words an error is in, when the hook throws. */
  thrown?: Thrower;
}

const project = JSON.parse(readFileSync(resolve(here, '../../../projects/default.json'), 'utf8')) as { code: CodeSource[] };
const srd = JSON.parse(readFileSync(resolve(here, '../content/pack/shipped/srd-characters.json'), 'utf8')) as { code: CodeSource[] };
const SHIPPED = [...project.code, ...srd.code];

const one = (id: string, source: string): CodeSource[] => [{ id, name: id, source }];

/** Hooks written for what the shipped ones never touch. */
const WRITTEN: Record<string, string> = {
  reads: [
    'var a = ctx.actor, t = ctx.targets[0];',
    'var out = [ctx.pool(a, "hitPoints"), ctx.pool(a, "hitPoints", "marked"), ctx.pool(a, "stress", "max"), ctx.pool(a, "good"), ctx.pool(t, "armorSlots"),',
    '  ctx.hasCondition(a, "hidden"), ctx.bandTo(a, t), ctx.bandTo(a, "nobody"), ctx.difficultyOf(t), ctx.difficultyOf(a),',
    '  ctx.select({ kind: "party" }), ctx.select({ kind: "adversaries", range: "far" }), ctx.select({ kind: "target" }), ctx.select({ kind: "hit" }),',
    '  ctx.flag("seen"), ctx.flag("unseen"), ctx.variable("mood"), ctx.variable("unset"), ctx.countAlive("party"), ctx.countAlive("adversary"),',
    '  ctx.countAlive("neutral"), ctx.factionOf(a), ctx.factionOf(t), ctx.factionOf("nobody"), ctx.tokens(a, "ward")];',
    'out.push(ctx.actor, ctx.targets, ctx.hit, ctx.inCombat);',
    'ctx.log(JSON.stringify(out)); return true;',
  ].join('\n'),
  oddReads: [
    'var out = [ctx.pool(3, "hitPoints"), ctx.hasCondition(null, "hidden"), ctx.bandTo(1, 2), ctx.difficultyOf({}), ctx.flag(7),',
    '  ctx.variable(7), ctx.tokens(3, 5), ctx.countAlive(1), ctx.factionOf(false), typeof ctx.select("party"), typeof ctx.select({ kind: "nope" }),',
    '  ctx.pool(ctx.actor, 7, "marked"), ctx.pool(ctx.actor, "stress", 9)];',
    'ctx.log(JSON.stringify(out));',
  ].join('\n'),
  dice: [
    'var r = ctx.rng, s = r.save();',
    'var out = [r.next(), r.nextInt(7), r.die(20), r.dice(3, 6), r.pick(["a", "b", "c"]), r.shuffle([1, 2, 3, 4, 5])];',
    'var f = r.fork(); out.push(f.next(), f.save());',
    'var back = r.save(); r.next(); r.restore(back); out.push(r.next());',
    'try { r.nextInt(0); } catch (e) { out.push(e.name + ": " + e.message); }',
    'try { r.die(2.5); } catch (e) { out.push(e.message); }',
    'try { r.dice(-1, 6); } catch (e) { out.push(e.message); }',
    'try { r.pick([]); } catch (e) { out.push(e.message); }',
    'out.push(r.nextInt(3000000000), r.nextInt(3000000000), r.nextInt(3000000000), r.nextInt(4294967295));',
    'out.push(s === r.save());',
    'ctx.log(JSON.stringify(out));',
  ].join('\n'),
  diceThrow: 'ctx.rng.next(); ctx.rng.nextInt(-3);',
  lastRoll: 'ctx.log(JSON.stringify(ctx.lastRoll)); ctx.log(typeof ctx.lastRoll);',
  args: 'ctx.log(JSON.stringify(ctx.args) + " " + typeof ctx.args.n + " " + Object.keys(ctx.args).join(","));',
  queue: [
    'ctx.queue([{ kind: "log", text: "a", tone: undefined }, { kind: "setFlag", flag: "q" }]);',
    'ctx.log("plain"); ctx.log("toned", "good"); ctx.log("undefined tone", undefined);',
    'ctx.queue([]); ctx.queue([{ kind: "gainGood", amount: 1, target: { kind: "actor" } }]);',
  ].join('\n'),
  queueThenThrow: 'ctx.log("lost"); throw new Error("after queueing");',
  keys: 'ctx.log(Object.keys(ctx).join(",")); return Object.keys(ctx).length > 0;',
  predicateKeys: 'return Object.keys(ctx).join(",") === "args,actor,targets,hit,inCombat,pool,hasCondition,bandTo,difficultyOf,select,flag,variable,countAlive,factionOf,tokens";',
  yes: 'return true;',
  one: 'return 1;',
  word: 'return "true";',
  nothing: 'return;',
  no: 'return false;',
  throwError: 'throw new Error("the hook says no");',
  throwTypeError: 'throw new TypeError("a hook-made type error");',
  throwText: 'throw "just text";',
  throwObject: 'throw {};',
  throwNull: 'throw null;',
  random: 'return Math.random() > 2;',
  date: 'return Date.now() > 0;',
  fetch: 'fetch("https://example.com");',
  func: 'return Function("return 1")();',
  consoleLog: 'console.log("x");',
  noRng: 'return ctx.rng.next() > 2;',
  undefinedRead: 'var nobody = undefined; return nobody.name;',
  language: [
    'const add = (a, b) => a + b;',
    'let [x, , y = 5] = [1, 2]; const { p, q: { r } = { r: 9 } } = { p: 3 };',
    'class Box { constructor(v) { this.v = v; } get twice() { return this.v * 2; } static of(v) { return new Box(v); } }',
    'function* count() { yield 1; yield 2; }',
    'const m = new Map([["k", 1]]); const s = new Set([3, 3, 4]);',
    'const o = { a: { b: null } };',
    'var out = [add(x, y), p, r, Box.of(4).twice, [...count()], m.get("k"), [...s], o.a?.b?.c, o.a.b ?? "none", `t${1 + 1}`, 2 ** 10, [1, [2, [3]]].flat(2), Object.entries({ z: 1, a: 2 }), "abc".padStart(5, "-"), [3, 1, 2].includes(2)];',
    'for (const [k, v] of m) out.push(k + v);',
    'label: for (var i = 0; i < 3; i++) { for (var j = 0; j < 3; j++) { if (j === 1) continue label; out.push(i * 10 + j); } }',
    'ctx.log(JSON.stringify(out));',
  ].join('\n'),
  numbers: [
    'var n = [0.1 + 0.2, 1e21, -0, 1 / 3, 123456789012345680000, 5e-7, 2 / 3 * 3, 100, 1e-7, 0.000001, 255, -1.5, 1.005];',
    'var out = n.map(String);',
    'out.push((1.005).toFixed(2), (2.5).toFixed(0), (1234.5678).toFixed(1), (255).toString(16), (255).toString(2), (0.5).toString(3));',
    'out.push(JSON.stringify(-0), JSON.stringify([NaN, Infinity]), parseFloat("3.14abc"), Number("0x10"), Number(""), Number(" 12 "), parseInt("08"), parseInt("1e3"));',
    'out.push(Math.round(-0.5), Math.round(2.5), Math.max(), Math.min(), Math.trunc(-4.7), Math.sign(-3), Math.floor(-0.5), Math.abs(-7), Math.sqrt(2), Math.cbrt(27), Math.hypot(3, 4));',
    'out.push(Math.sin(1), Math.cos(1), Math.tan(1), Math.exp(1), Math.log(10), Math.pow(1.1, 10), Math.atan2(1, 2), Math.log2(8), Math.log10(1000), Math.expm1(1e-5), Math.fround(5.5), Math.imul(3, 4), Math.clz32(1));',
    'ctx.log(JSON.stringify(out));',
  ].join('\n'),
  sorting: [
    'var out = [[10, 9, 1, 100, 25].sort(), ["b", "a", "B", "_", "-", "10", "9"].sort(), [10, 9, 1, 100, 25].sort(function (a, b) { return a - b; })];',
    'out.push([{ k: 2, i: 0 }, { k: 1, i: 1 }, { k: 2, i: 2 }, { k: 1, i: 3 }].sort(function (a, b) { return a.k - b.k; }).map(function (e) { return e.i; }));',
    'out.push([3, undefined, 1, null, 2].sort());',
    'out.push("a1b2c3".replace(/[0-9]/g, "#"), "x-y_z".split(/[-_]/), /(a)(b)?/.exec("ac").slice(0), "Hello".toUpperCase(), " t ".trim(), "abc".charCodeAt(1));',
    'ctx.log(JSON.stringify(out));',
  ].join('\n'),
  thisAndShadows: 'ctx.log([typeof this, typeof globalThis, typeof window, typeof Date, typeof Function, typeof console, typeof require, typeof process, typeof Math.random, typeof JSON, typeof Object, typeof eval].join(","));',
};

const CASES: Case[] = [
  // The shipped hooks, as their cards run them.
  ...SHIPPED.flatMap((code): Case[] => [
    { name: `${code.id} as kara`, code: SHIPPED, id: code.id, effect: true, actor: 'kara', targets: [] },
    { name: `${code.id} as mira at a foe`, code: SHIPPED, id: code.id, effect: true, actor: 'mira', targets: ['group-1-husk-16-8'], fight: true },
    { name: `${code.id} with the page kept`, code: SHIPPED, id: code.id, effect: true, actor: 'finn', targets: ['group-1-husk-16-8'], flags: ['the-page'] },
    { name: `${code.id} by nobody`, code: SHIPPED, id: code.id, effect: true, actor: null, targets: [] },
    { name: `${code.id} asked`, code: SHIPPED, id: code.id, effect: false, actor: 'kara', targets: ['group-1-husk-16-8'], thrown: 'engine' },
  ]),
  // The rest of what a hook can reach.
  { name: 'every read', code: one('reads', WRITTEN['reads']!), id: 'reads', effect: true, actor: 'kara', targets: ['group-1-husk-16-8'], hit: ['group-1-husk-16-8'], flags: ['seen'], fight: true },
  { name: 'every read, asked', code: one('reads', WRITTEN['reads']!), id: 'reads', effect: false, actor: 'mira', targets: ['kara'], hit: [], thrown: 'engine' },
  { name: 'reads of the wrong kind', code: one('oddReads', WRITTEN['oddReads']!), id: 'oddReads', effect: true, actor: 'kara', targets: [], thrown: 'engine' },
  { name: 'every die', code: one('dice', WRITTEN['dice']!), id: 'dice', effect: true, actor: 'kara' },
  { name: 'a die it cannot roll', code: one('diceThrow', WRITTEN['diceThrow']!), id: 'diceThrow', effect: true, actor: 'kara', thrown: 'shim' },
  { name: 'no last roll', code: one('lastRoll', WRITTEN['lastRoll']!), id: 'lastRoll', effect: true, actor: 'kara', lastRoll: null },
  { name: 'a last roll', code: one('lastRoll', WRITTEN['lastRoll']!), id: 'lastRoll', effect: true, actor: 'kara', lastRoll: { total: 17, critical: true, outcome: 'criticalSuccess' } },
  { name: 'arguments', code: one('args', WRITTEN['args']!), id: 'args', effect: true, actor: 'kara', args: { n: 2, word: 'x', yes: true, half: 0.5 } },
  { name: 'no arguments', code: one('args', WRITTEN['args']!), id: 'args', effect: true, actor: null },
  { name: 'the queue', code: one('queue', WRITTEN['queue']!), id: 'queue', effect: true, actor: 'kara' },
  { name: 'queued and then thrown', code: one('queueThenThrow', WRITTEN['queueThenThrow']!), id: 'queueThenThrow', effect: true, actor: 'kara', thrown: 'hook' },
  { name: 'what ctx holds', code: one('keys', WRITTEN['keys']!), id: 'keys', effect: true, actor: 'kara' },
  { name: 'what ctx holds, asked', code: one('predicateKeys', WRITTEN['predicateKeys']!), id: 'predicateKeys', effect: false, actor: 'kara' },
  ...['yes', 'one', 'word', 'nothing', 'no'].map((id): Case => ({ name: `answers ${id}`, code: one(id, WRITTEN[id]!), id, effect: false, actor: 'kara' })),
  ...(
    [
      ['throwError', 'hook'],
      ['throwTypeError', 'hook'],
      ['throwText', 'hook'],
      ['throwObject', 'hook'],
      ['throwNull', 'hook'],
      ['random', 'shim'],
      ['date', 'engine'],
      ['fetch', 'engine'],
      ['func', 'engine'],
      ['consoleLog', 'engine'],
      ['undefinedRead', 'engine'],
    ] as const
  ).flatMap(([id, thrown]): Case[] => [
    { name: `${id} run`, code: one(id, WRITTEN[id]!), id, effect: true, actor: 'kara', thrown },
    { name: `${id} asked`, code: one(id, WRITTEN[id]!), id, effect: false, actor: 'kara', thrown },
  ]),
  { name: 'no dice when asked', code: one('noRng', WRITTEN['noRng']!), id: 'noRng', effect: false, actor: 'kara', thrown: 'engine' },
  { name: 'the language', code: one('language', WRITTEN['language']!), id: 'language', effect: true, actor: 'kara' },
  { name: 'numbers', code: one('numbers', WRITTEN['numbers']!), id: 'numbers', effect: true, actor: 'kara' },
  { name: 'sorting and text', code: one('sorting', WRITTEN['sorting']!), id: 'sorting', effect: true, actor: 'kara' },
  { name: 'this and the shadowed', code: one('thisAndShadows', WRITTEN['thisAndShadows']!), id: 'thisAndShadows', effect: true, actor: 'kara' },
  { name: 'a later entry replaces an earlier', code: [...one('twice', 'return false;'), ...one('twice', 'return true;')], id: 'twice', effect: false, actor: 'kara' },
  { name: 'a later entry that will not compile leaves the earlier', code: [...one('twice', 'return true;'), ...one('twice', 'return (')], id: 'twice', effect: false, actor: 'kara' },
];

function play(c: Case, index: number) {
  const demo = buildDemoScene(hollowVaultMap(), 'hooks');
  if (c.fight === true && demo.scene.encounters.length > 0) startEncounter(demo, demo.scene.encounters[0]!.id);
  demo.world.scenario.actorId = c.actor ?? null;
  demo.world.setVar('mood', 'grim');
  demo.world.addTokens('kara', 'ward', 2);
  for (const flag of c.flags ?? []) demo.world.setFlag(flag);
  const tape = { live: false, asked: [] as unknown[] };
  const world = taping(demo.world, tape);
  const bindings: TargetBindings = { targets: c.targets ?? [], hit: c.hit ?? [] };
  const args = c.args ?? {};
  const { hooks, issues } = compileHooks(c.code);
  const fn = hooks.get(c.id)!;
  let thrown: unknown = undefined;
  const watched: HookFn = (context) => {
    try {
      return fn(context);
    } catch (error) {
      thrown = error;
      throw error;
    }
  };
  const seed = createRng(`hooks:${index}`).save();
  const rng = createRng(seed);
  const reads = hookReads(world, bindings, args);
  const queued: unknown[] = [];
  const context: HookContext | typeof reads = c.effect
    ? {
        ...reads,
        rng,
        lastRoll: c.lastRoll ?? null,
        queue: (effects) => {
          queued.push(...effects);
        },
        log: (text, tone) => {
          queued.push({ kind: 'log', text, ...(tone === undefined ? {} : { tone }) });
        },
      }
    : reads;
  tape.live = true;
  const result = runHook(watched, context as HookContext);
  tape.live = false;
  const error = thrown instanceof Error ? { name: thrown.name } : {};
  // Whose words a failure is in decides how it is held to, so every case that fails says.
  if (!result.ok && c.thrown === undefined) throw new Error(`${c.name} failed and does not say whose words: ${result.message}`);
  return {
    name: c.name,
    code: c.code,
    issues: issues.map((i) => i.id),
    id: c.id,
    effect: c.effect,
    reads: { args, actor: reads.actor, targets: reads.targets, hit: reads.hit, inCombat: reads.inCombat },
    lastRoll: c.lastRoll ?? null,
    seed,
    asked: tape.asked,
    outcome: result.ok
      ? { ok: true, value: result.value === true, queued: clone(queued) }
      : { ok: false, message: result.message, ...error, thrown: c.thrown, queued: [] },
    after: c.effect ? rng.save() : null,
  };
}

function golden() {
  const unfamiliar = [
    { incoming: [...one('a', 'return 1'), ...one('b', 'return 3'), ...one('c', 'return 1')], known: [...one('a', 'return 1'), ...one('b', 'return 2')] },
    { incoming: SHIPPED, known: SHIPPED },
    { incoming: SHIPPED, known: [] },
  ].map(({ incoming, known }) => ({ incoming, known, unfamiliar: unfamiliarCode(incoming, known).map((c) => c.id) }));
  const compiled = [SHIPPED, [...one('bad', 'return ('), ...one('good', 'return 1;'), ...one('worse', 'let let = 1;')]].map((code) => ({ code, issues: compileHooks(code).issues.map((i) => i.id) }));
  return { about: 'src/engine/script/hooks.ts run for the Rust port; written by src/engine/script/hooks.golden.test.ts', cases: CASES.map(play), compiled, unfamiliar };
}

describe('hooks, as the Rust server must run them', () => {
  it('are what server/fixtures/hooks.json holds', () => {
    const now = clone(golden());
    if (process.env['UPDATE_GOLDEN'] === '1' || !existsSync(FIXTURE)) {
      mkdirSync(dirname(FIXTURE), { recursive: true });
      writeFileSync(FIXTURE, `${JSON.stringify(now)}\n`, 'utf8');
    }
    expect(JSON.parse(readFileSync(FIXTURE, 'utf8'))).toEqual(now);
  });
});
