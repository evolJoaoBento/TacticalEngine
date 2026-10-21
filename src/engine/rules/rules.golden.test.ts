/**
 * The rules as the Rust server must apply them (`docs/SERVER.md`, phase 2): this drives every function in
 * `src/engine/rules` - dice, the Duality Dice, the GM's Die, ranges, countdowns, damage, the pools, jumps -
 * over inputs chosen for their edges, and writes what they answer to `server/fixtures/rules.json`, which
 * `server/engine/tests/golden_rules.rs` replays. Every roll records where the dice stream stood after it,
 * so the Rust draws the same dice in the same order, not only the same totals. Infinity is `null`.
 * `UPDATE_GOLDEN=1 npx vitest run src/engine/rules/rules.golden.test.ts` writes it afresh.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRng } from '../core/rng';
import { COUNTDOWN_ADVANCES, advanceCountdown, dynamicSteps, stepsFor, type CountdownClock, type CountdownCue } from './countdown';
import { combineCover, coverApplies, coverDisadvantage } from './cover';
import {
  SEVERITY_ORDER, applyDefenses, armorScore, flatReduction, hpForSeverity, isSevere, parseThresholds, pcThresholds, reduceSeverity, reductionRolls, resolveDamage,
  rollDamage, rollReduction, severityFor, type DamageDefenses, type IncomingDamage, type ResolveDamageOptions,
} from './damage';
import { formatDice, maxDice, parseDice, rollDice, withProficiency, type DiceExpression } from './dice';
import { classifyRoll, groupActionModifier, netAdvantage, rollDuality, withFaces, type DualityRollOptions, type RollOutcome } from './duality';
import { rollGmDie, type GmRollOptions } from './gm-die';
import { DEFAULT_JUMP_RULES, arcHeight, arcLift, jumpRange, jumpReach, jumpRulesSchema, leapTerms, safeDrop } from './jump';
import {
  RANGE_BANDS, bandBetweenStanding, bandForDistance, bandForSpan, bandLabel, maxSpanForBand, maxTilesForBand, nearerBand, nextBand, parseRangeBand, reaches, type BandTiles,
} from './range';
import {
  canAfford, canMarkStress, clear, clearAll, createBad, createGood, createMarkPool, gain, isFull, mark, markHitPoints, markStress, resize, scar, spend, unmarked,
} from './resources';

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), '../../../server/fixtures/rules.json');

/** Numbers as JSON keeps them: Infinity as null, recursively through whatever a function answered. */
function plain(value: unknown): unknown {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map(plain);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain(v)]));
  return value;
}

/** A function's answer, or the error it threw - the Rust must refuse the same inputs. */
function attempt<T>(run: () => T): { ok: T } | { error: string } {
  try {
    return { ok: run() };
  } catch (error) {
    return { error: (error as Error).name };
  }
}

const SEEDS = ['a', 'duality', 'the vault', 'dé 🎲', 7, 123456789];

function dice() {
  const texts = [
    '2d8+1', 'd6', '+3', '1d12+2 phy', '1d8+4 phy/mag', '3 phy', '+2d4', '2 d 10 + 3', 'D6', '1D6 PHY', '1d6 physical', '1d6 magical', '1d6 mag/phy/mag', '1d6 phy/',
    '1d6 fire', '1d6 phy mag', '1d6\tphy', '1d6\u00a0phy', '1d6\ufeffphy', '1d6\u0085phy', '  1d6  ', '1d0', '0d6', '1d', 'd', '+', '', '   ', '-3', '++3', '+-3', '1d6-2',
    '1d6+2+3', '12', '1d62', '99999999999999999999d6', '1d6+99999999999999999999', 'd6+d8', '-d6', '2d6 phys', '1d6 PHYSICAL', 'İ', '1d6 phyİ', '1.5d6', '1d6+0', '1d6-0', 'x',
  ];
  const parsed = texts.map((text) => ({ text, parsed: parseDice(text) }));
  const expressions: DiceExpression[] = [
    { count: 2, sides: 8, modifier: 1 }, { count: 1, sides: 6, modifier: 0 }, { count: 0, sides: 0, modifier: 3 }, { count: 0, sides: 0, modifier: -2 }, { count: 0, sides: 0, modifier: 0 },
    { count: 3, sides: 10, modifier: -4 }, { count: 1e21, sides: 6, modifier: 0 }, { count: 4, sides: 20, modifier: 12 },
  ];
  const formatted = expressions.map((e) => [e, formatDice(e), maxDice(e)]);
  const proficiency = [0, 1, 2, 3, 2.9, -1].flatMap((p) => expressions.slice(0, 6).map((e) => [e, p, withProficiency(e, p)]));
  const rolls = SEEDS.flatMap((seed) =>
    [...expressions.slice(0, 6), { count: 2.5, sides: 6, modifier: 0 }, { count: 2, sides: 1.5, modifier: 0 }, { count: 1, sides: 0, modifier: 0 }, { count: -1, sides: 6, modifier: 0 }].map((e) => {
      const rng = createRng(seed);
      const rolled = attempt(() => rollDice(rng, e));
      return { seed, expression: e, rolled, after: rng.save() };
    }),
  );
  return { parsed, formatted, proficiency, rolls };
}

function duality() {
  const options: DualityRollOptions[] = [
    { difficulty: 10 }, { difficulty: 15, modifier: 2 }, { difficulty: 12, advantage: 1 }, { difficulty: 12, disadvantage: 2 }, { difficulty: 12, advantage: 2, disadvantage: 2 },
    { difficulty: 12, advantage: 3, disadvantage: 1 }, { difficulty: 8, helpDice: 2 }, { difficulty: 8, helpDice: 2.7 }, { difficulty: 8, helpDice: -1 }, { difficulty: 8, helpDice: 3, reaction: true },
    { difficulty: 20, goodDieSides: 20 }, { difficulty: 12, goodDieSides: 12, modifier: -3 }, { difficulty: 30, reaction: true, advantage: 1 }, { difficulty: 1, modifier: 0.5 },
    // Advantage and Help together: the only rolls where the order the dice are drawn in shows.
    { difficulty: 12, advantage: 1, helpDice: 2 }, { difficulty: 12, disadvantage: 1, helpDice: 3, modifier: 1 }, { difficulty: 20, goodDieSides: 20, advantage: 2, helpDice: 1 },
  ];
  const rolls = SEEDS.flatMap((seed) =>
    options.map((o) => {
      const rng = createRng(seed);
      const roll = rollDuality(rng, o);
      return { seed, options: o, roll, after: rng.save(), refaced: [withFaces(roll, { good: 5, bad: 5 }), withFaces(roll, { good: 12 }), withFaces(roll, { bad: 1 }), withFaces(roll, {})] };
    }),
  );
  // Every pair of faces across a spread of totals and difficulties.
  const classified: unknown[] = [];
  for (const good of [1, 6, 12]) for (const bad of [1, 6, 12]) for (const total of [5, 12, 13]) for (const difficulty of [12, 13]) classified.push([good, bad, total, difficulty, classifyRoll(good, bad, total, difficulty)]);
  const net = [[0, 0], [1, 0], [0, 1], [2, 1], [1, 3], [2.5, 2.5], [undefined, 1], [1, undefined]].map(([a, d]) => [a ?? null, d ?? null, netAdvantage(a, d)]);
  const groups = [[], [true], [false], [true, true, false], [false, false, false]].map((successes) => [successes, groupActionModifier(successes.map((success) => ({ success })))]);
  return { rolls, classified, net, groups };
}

function gm() {
  const options: GmRollOptions[] = [
    { difficulty: 10 }, { difficulty: 15, modifier: 3 }, { difficulty: 25, modifier: -2 }, { difficulty: 12, advantage: 1 }, { difficulty: 12, disadvantage: 1 },
    { difficulty: 12, advantage: 1, disadvantage: 1 }, { difficulty: 99, reaction: true }, { difficulty: 99 },
  ];
  return SEEDS.flatMap((seed) => options.map((o) => {
    const rng = createRng(seed);
    return { seed, options: o, roll: rollGmDie(rng, o), after: rng.save() };
  }));
}

function range() {
  const table: BandTiles = { melee: 1, veryClose: 3, close: 5, far: 9, veryFar: 15 };
  const distances = [0, 0.4, 0.5, 1, 1.4, 1.5, 1.6, 2, 2.49, 2.5, 6, 6.5, 7, 20, 20.5, 60, 60.49, 60.5, 61, 1000, -1, Infinity];
  const texts = ['Very Close', 'very close', 'veryClose', 'VERYCLOSE', 'very_close', 'very-close', ' melee ', 'Far', 'Out of Range', 'out_of-range', 'close range', '', 'Very\u00a0Far', 'Very\ufeffFar', 'Very\u0085Far'];
  return {
    bands: RANGE_BANDS,
    reaches: RANGE_BANDS.flatMap((a) => RANGE_BANDS.map((b) => [a, b, reaches(a, b), nearerBand(a, b)])),
    byDistance: distances.map((d) => [plain(d), bandForDistance(d), bandForDistance(d, table), bandForSpan(d), bandForSpan(d, table)]),
    spans: RANGE_BANDS.map((b) => [b, plain(maxSpanForBand(b)), plain(maxSpanForBand(b, table)), plain(maxTilesForBand(b)), plain(maxTilesForBand(b, table)), nextBand(b), bandLabel(b)]),
    standing: [
      [{ tile: 0, at: { x: 0, y: 0 } }, { tile: 1, at: { x: 1, y: 1 } }], [{ tile: 0, at: { x: 0.2, y: 0.3 } }, { tile: 5, at: { x: 6.7, y: 0.1 } }],
      [{ tile: -1, at: { x: 0, y: 0 } }, { tile: 1, at: { x: 1, y: 0 } }], [{ tile: 3, at: { x: 3, y: 0 } }, null], [{ tile: 2, at: { x: 0, y: 0 } }, { tile: 9, at: { x: 42.1, y: 40.3 } }],
    ].map(([a, b]) => [a, b, bandBetweenStanding(a ?? undefined, b ?? undefined), bandBetweenStanding(a ?? undefined, b ?? undefined, table)]),
    parsed: texts.map((t) => [t, parseRangeBand(t)]),
    table,
  };
}

function countdowns() {
  const outcomes: RollOutcome[] = ['criticalSuccess', 'successWithGood', 'successWithBad', 'failureWithGood', 'failureWithBad'];
  const cues: CountdownCue[] = [
    ...outcomes.flatMap((outcome) => [true, false].map((attack) => ({ kind: 'actionRoll' as const, attack, outcome }))),
    { kind: 'hpMarked', id: 'a', marked: 2 }, { kind: 'hpMarked', id: 'a', marked: 0 }, { kind: 'hpMarked', id: 'a', marked: -1 },
  ];
  const clocks: CountdownClock[] = [{ value: 3, start: 3 }, { value: 1, start: 4 }, { value: 1, start: 4, loop: 'reset' }, { value: 1, start: 4, loop: 'increasing' }, { value: 1, start: 1, loop: 'decreasing' }, { value: 1, start: 3, loop: 'decreasing' }, { value: 0, start: 2, loop: 'reset' }];
  return {
    dynamic: (['progress', 'consequence'] as const).flatMap((kind) => outcomes.map((o) => [kind, o, dynamicSteps(kind, o)])),
    steps: COUNTDOWN_ADVANCES.flatMap((advance) => cues.map((cue) => [advance, cue, stepsFor(advance, cue)])),
    ticks: clocks.flatMap((clock) => [1, 2, 3, 0, -1, 2.7].map((steps) => [clock, steps, advanceCountdown(clock, steps)])),
  };
}

function damage() {
  const thresholds = [{ major: 5, severe: 10 }, { major: 8, severe: 15 }, { major: Infinity, severe: Infinity }, { major: 4, severe: Infinity }, { major: 0, severe: 0 }];
  const amounts = [-2, 0, 1, 4, 5, 8, 10, 15, 19, 20, 30, 31];
  const defences: DamageDefenses[] = [
    {}, { resistances: ['physical'] }, { immunities: ['magic'] }, { resistances: ['physical'], immunities: ['magic'] }, { resistances: ['physical', 'magic'] },
    { reduce: [{ dice: '3' }] }, { reduce: [{ dice: '1d10' }] }, { reduce: [{ dice: '2d10+1', only: 'physical' }, { dice: '2', only: 'magic' }] }, { reduce: [{ dice: 'nonsense' }] },
  ];
  const typeSets = [[], ['physical'], ['magic'], ['physical', 'magic']] as const;
  const incoming: IncomingDamage[] = [
    { amount: 12 }, { amount: 12, types: ['physical'] }, { amount: 12, types: ['magic'], direct: true }, { amount: 3, severity: 'severe' }, { amount: 0, types: ['physical'] }, { amount: 25, types: ['physical', 'magic'] },
  ];
  const resolveOptions: ResolveDamageOptions[] = [
    {}, { armorSlotsMarked: 1 }, { armorSlotsMarked: 3, armorSlotsAvailable: 1 }, { armorSlotsMarked: 2.9 }, { massiveDamage: true }, { defenses: defences[7]!, rolledReduction: 4.6 },
    { defenses: defences[1]!, armorSlotsMarked: 5 }, { rolledReduction: -3 },
  ];
  const thresholdTexts = ['8/15', '4/None', 'None', 'none', ' 3 / 7 ', '10/5', '', 'x/5', '5/', '8/15/20', '07/08', '4\u00a0/\u00a09', '4\ufeff/9'];
  return {
    severe: SEVERITY_ORDER.map((s) => [s, isSevere(s), hpForSeverity(s), [0, 1, 2, 3, 9, -1, 1.7].map((n) => reduceSeverity(s, n))]),
    thresholds: thresholdTexts.map((t) => [t, plain(parseThresholds(t))]),
    severity: thresholds.flatMap((t) => amounts.map((a) => [plain(t), a, severityFor(a, t), severityFor(a, t, { massiveDamage: true })])),
    pc: [[1, null], [3, null], [2, { major: 6, severe: 13 }], [10, { major: 11, severe: 24 }]].map(([level, armor]) => [level, armor, pcThresholds(level as number, armor as never)]),
    armor: [[3, 0], [5, 4], [10, 5], [0, -2], [12, 1], [4, 2.5]].map(([b, x]) => [b, x, armorScore(b!, x)]),
    defended: defences.flatMap((d) => typeSets.flatMap((types) => [0, 1, 7, 12].map((amount) => [d, types, amount, applyDefenses(amount, types, d), flatReduction(types, d), reductionRolls(d)]))),
    reductions: SEEDS.flatMap((seed) => defences.flatMap((d) => typeSets.map((types) => {
      const rng = createRng(seed);
      return [seed, d, types, rollReduction(rng, types, d), rng.save()];
    }))),
    rolled: SEEDS.flatMap((seed) => [
      [{ count: 1, sides: 8, modifier: 2 }, {}], [{ count: 1, sides: 8, modifier: 2 }, { proficiency: 3 }], [{ count: 2, sides: 6, modifier: 0 }, { critical: true }],
      [{ count: 2, sides: 6, modifier: 1 }, { critical: true, criticalRule: 'doubleDice' as const, bonus: 2 }], [{ count: 0, sides: 0, modifier: 4 }, { critical: true }], [{ count: 1, sides: 10, modifier: 0 }, { proficiency: 0 }],
    ].map(([expr, options]) => {
      const rng = createRng(seed);
      return [seed, expr, options, rollDamage(rng, expr as DiceExpression, options as never), rng.save()];
    })),
    resolved: incoming.flatMap((d) => thresholds.slice(0, 4).flatMap((t) => resolveOptions.map((o) => [d, plain(t), o, resolveDamage(d, t, o)]))),
  };
}

function resources() {
  const pools = [createMarkPool(6), createMarkPool(6, 5), createMarkPool(6, 6), createMarkPool(0), createMarkPool(4.7, 9), createMarkPool(-3, 2), createMarkPool(12, -1)];
  const amounts = [0, 1, 2, 3, 7, -1, 1.9];
  const currencies = [createGood(), createGood(6), createGood(9), createGood(-1), createBad(), createBad(11), createGood(2, 3), createGood(1, 1)];
  return {
    pools: pools.map((p) => [p, unmarked(p), isFull(p), clearAll(p), [0, 3, 6, 12, 13, -2, 7.8].map((max) => resize(p, max)), resize(p, 20, 20)]),
    marks: pools.flatMap((p) => amounts.map((a) => [p, a, mark(p, a), clear(p, a), markHitPoints(p, a)])),
    stress: pools.slice(0, 4).flatMap((s) => pools.slice(0, 3).flatMap((h) => [1, 2, 3, 0].map((a) => [s, h, a, markStress(s, h, a), canMarkStress(s, a)]))),
    currencies: currencies.flatMap((c) => amounts.map((a) => [c, a, gain(c, a), spend(c, a), canAfford(c, a)])),
    scars: currencies.map((c) => [c, scar(c)]),
  };
}

function jumps() {
  const traits = [
    { agility: 0, strength: 0, finesse: 0, instinct: 0, presence: 0, knowledge: 0 },
    { agility: 2, strength: 1, finesse: 0, instinct: 0, presence: 0, knowledge: 0 },
    { agility: -1, strength: 3, finesse: 0, instinct: 0, presence: 0, knowledge: 0 },
    { agility: 1.5, strength: -2, finesse: 0, instinct: 0, presence: 0, knowledge: 0 },
  ];
  const rules = [
    DEFAULT_JUMP_RULES,
    jumpRulesSchema.parse({ enabled: false }),
    jumpRulesSchema.parse({ flatRoll: true, difficulty: 15, harderEvery: 0, fallDie: 0 }),
    jumpRulesSchema.parse({ stepHeight: 0.2, reachTrait: 'agility', reachBase: 0.5, reachPerPoint: 0.5, dropTrait: 'strength', dropBase: 2, dropPerPoint: 0.5, harderEvery: 1.5 }),
  ];
  const rises = [0, 0.5, 0.72, 0.73, 1, 1.5, 2, 2.000001, 3, 4.5, -0.5, -1, -1.5, -2, -3, -4.3, -6, -10];
  return {
    defaults: DEFAULT_JUMP_RULES,
    rules: rules.map((r) => ({
      rules: r,
      byTraits: traits.map((t) => ({ traits: t, reach: jumpReach(r, t), range: jumpRange(r, t), drop: safeDrop(r, t), terms: rises.map((rise) => [rise, leapTerms(r, rise, t)]) })),
    })),
    arcs: [0, 1, 2, 3, 5.5, 10].flatMap((tiles) => [0, 1, -2.5].map((rise) => [tiles, rise, arcLift(tiles, rise)])),
    heights: [[0, 1, 0.75], [2, 0, 1.2], [-1, 3, 2]].flatMap(([from, to, lift]) => [0, 0.1, 0.25, 0.5, 0.9, 1].map((t) => [from, to, lift, t, arcHeight(from!, to!, lift!, t)])),
  };
}

function golden() {
  return plain({
    about: 'src/engine/rules played for the Rust port; written by src/engine/rules/rules.golden.test.ts. Infinity is null.',
    cover: (['none', 'cover'] as const).flatMap((a) => (['none', 'cover'] as const).map((b) => [a, b, combineCover(a, b), coverDisadvantage(a), coverDisadvantage(a, false), coverApplies(a === 'cover')])),
    dice: dice(),
    duality: duality(),
    gm: gm(),
    range: range(),
    countdowns: countdowns(),
    damage: damage(),
    resources: resources(),
    jumps: jumps(),
  });
}

describe('the rules, as the Rust server must apply them', () => {
  it('are what server/fixtures/rules.json holds', () => {
    const now = JSON.parse(JSON.stringify(golden())) as unknown;
    if (process.env['UPDATE_GOLDEN'] === '1' || !existsSync(FIXTURE)) {
      mkdirSync(dirname(FIXTURE), { recursive: true });
      writeFileSync(FIXTURE, `${JSON.stringify(now)}\n`, 'utf8');
    }
    expect(JSON.parse(readFileSync(FIXTURE, 'utf8'))).toEqual(now);
  });
});
