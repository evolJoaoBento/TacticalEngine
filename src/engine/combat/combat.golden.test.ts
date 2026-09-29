/**
 * Combat as the Rust server must fight it (`docs/SERVER.md`, phase 2): who can be targeted and why not,
 * what an area catches and what a move under pressure costs, what a stat block's features add up to, an
 * attack rolled from the same point in the dice stream to the same outcome and applied to the same pools,
 * a defence chosen by policy or by plan with the same reactions paid for, and an encounter's turns taken
 * the same way to the same end.
 *
 * Everything is drawn off seeded streams: the cases off one, each attack's and defence's dice off their
 * own, whose position after is recorded. Grids are two of the grid fixture's (a walled room with cover,
 * heights and stacked pieces; an open floor) described cell by cell; entities as the scene keeps them.
 * `UPDATE_GOLDEN=1 npx vitest run src/engine/combat/combat.golden.test.ts` writes
 * `server/fixtures/combat.json` afresh; `server/engine/tests/golden_combat.rs` replays it.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRng, type Rng } from '../core/rng';
import { TileGrid, type Spot } from '../grid/grid';
import { abilitySchema, type AbilityDef } from '../content/abilities';
import type { AdversaryFeature } from '../content/types';
import { STARTER_PACK } from '../content/pack/starter';
import { parseDice } from '../rules/dice';
import { rollDuality } from '../rules/duality';
import { RANGE_BANDS, type RangeBand } from '../rules/range';
import { createMarkPool } from '../rules/resources';
import { SceneState, createAdversaryEntity, createPartyEntity, type EntityState } from '../scene/state';
import { adversaryTraits, attackDamageOf, isFeatureImplemented } from './adversary-features';
import { isInArea, isLegalOrigin, moveUnderPressure, tilesInArea } from './area';
import { applyAttack, applyRoll, resolveAttack, type AttackOptions, type AttackProfile, type DefenderProfile } from './attack';
import { canPayFor, previewPlan, resolveDefense, resolveDefensePlan, type Defender, type DefensePolicy } from './defense';
import { EncounterRunner, type TurnPolicy } from './encounter';
import { evaluateTarget, refusalMessage } from './targeting';

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), '../../../server/fixtures/combat.json');
const num = (value: number): number | null => (Number.isFinite(value) ? value : null);

// --- Grids, as the grid fixture builds them -----------------------------------------------------------

function room(): TileGrid {
  const grid = new TileGrid({ width: 10, height: 8 });
  const p = grid.palette;
  const at = (x: number, y: number): number => grid.indexOf(x, y);
  for (let y = 1; y < 7; y++) grid.setTerrain(at(4, y), p.require('wall'));
  grid.setTerrain(at(4, 4), p.require('floor'));
  for (const [x, y] of [[1, 1], [2, 1], [1, 2], [7, 5], [8, 5]] as const) grid.setTerrain(at(x, y), p.require('difficult'));
  for (const [x, y] of [[6, 2], [2, 5]] as const) grid.setTerrain(at(x, y), p.require('cover'));
  grid.setTerrain(at(9, 0), p.require('void'));
  for (const [x, y, h] of [[7, 1, 1], [8, 1, 2], [9, 1, 3], [8, 2, 2], [9, 2, 2], [0, 6, -1], [1, 6, -2], [5, 7, 4]] as const) grid.setHeight(at(x, y), h);
  grid.setOverlay(at(6, 6), p.require('block'));
  grid.lift[at(6, 6)] = 1;
  grid.setOverlay(at(7, 3), p.require('barrier'));
  grid.lift[at(7, 3)] = 0.3;
  grid.barred[at(6, 4)] = 1;
  return grid;
}

function specOf(grid: TileGrid) {
  return {
    width: grid.width,
    height: grid.height,
    palette: grid.palette.types.map((t) => ({ id: t.id, passable: t.passable, cost: num(t.cost), providesCover: t.providesCover, blocksSight: t.blocksSight })),
    heights: [...grid.heights],
    terrain: [...grid.terrain],
    overlay: [...grid.overlay],
    lift: [...grid.lift],
    barred: [...grid.barred],
  };
}

const GRIDS: Record<string, TileGrid> = { room: room(), open: new TileGrid({ width: 6, height: 5 }) };

/** An entity as the scene keeps it, in JSON: its sets and maps as lists and objects, an unplaced spot as nulls. */
function entityJson(e: EntityState) {
  return { ...e, at: { x: num(e.at.x), y: num(e.at.y) }, conditions: [...e.conditions], conditionDurations: Object.fromEntries(e.conditionDurations) };
}

// --- Targeting and area ------------------------------------------------------------------------------

const TABLE = { melee: 1.5, veryClose: 3, close: 5, far: 9, veryFar: 14 };

function targeting(gen: Rng) {
  return Object.entries(GRIDS).flatMap(([name, grid]) =>
    Array.from({ length: 400 }, () => {
      const tile = (): number => (gen.nextInt(20) === 0 ? gen.pick([-1, grid.size, -7]) : gen.nextInt(grid.size));
      const from = tile();
      const to = gen.nextInt(12) === 0 ? from : tile();
      const range = gen.pick(RANGE_BANDS) as RangeBand;
      const options = {
        ...(gen.nextInt(3) === 0 ? { ranged: gen.nextInt(2) === 0 } : {}),
        ...(gen.nextInt(4) === 0 ? { bandTiles: TABLE } : {}),
        ...(gen.nextInt(4) === 0 ? { losRules: { blockingHeightMargin: gen.pick([0, 2, 0.5]) } } : {}),
        ...(gen.nextInt(3) === 0 ? { at: { attacker: { x: gen.next() * grid.width, y: gen.next() * grid.height }, target: { x: gen.next() * grid.width, y: gen.next() * grid.height } } } : {}),
      };
      return { grid: name, from, to, range, options, report: evaluateTarget(grid, from, to, range, options) };
    }),
  );
}

function areas(gen: Rng) {
  return Object.entries(GRIDS).flatMap(([name, grid]) =>
    Array.from({ length: 120 }, () => {
      const a = gen.nextInt(grid.size);
      const b = gen.nextInt(8) === 0 ? a : gen.nextInt(9) === 0 ? -1 : gen.nextInt(grid.size);
      const options = {
        ...(gen.nextInt(2) === 0 ? { radius: gen.pick(['melee', 'veryClose', 'close', 'far'] as const) } : {}),
        ...(gen.nextInt(3) === 0 ? { bandTiles: TABLE } : {}),
        ...(gen.nextInt(2) === 0 ? { requireLineOfSight: gen.nextInt(2) === 0 } : {}),
        ...(gen.nextInt(4) === 0 ? { losRules: { blockingHeightMargin: 0 } } : {}),
      };
      const effectRange = gen.pick(RANGE_BANDS) as RangeBand;
      const mover = gen.pick(['pc', 'adversary'] as const);
      const moveOptions = { ...(gen.nextInt(2) === 0 ? { withAction: gen.nextInt(2) === 0 } : {}), ...(gen.nextInt(3) === 0 ? { bandTiles: TABLE } : {}) };
      return {
        grid: name, a, b, options, effectRange, mover, moveOptions,
        legalOrigin: isLegalOrigin(grid, a, b, effectRange, options),
        inArea: isInArea(grid, a, b, options),
        tiles: tilesInArea(grid, a, options),
        move: moveUnderPressure(grid, mover, a, b, moveOptions),
      };
    }),
  );
}

// --- Stat blocks --------------------------------------------------------------------------------------

function features() {
  const f = (name: string, parameter?: string): AdversaryFeature => ({ name, kind: 'passive', text: '', costsGmResource: false, ...(parameter === undefined ? {} : { parameter }) }) as AdversaryFeature;
  const sets: AdversaryFeature[][] = [
    [f('Relentless (3)'), f('Momentum')],
    [f('Relentless'), f('Terrifying')],
    [f('Relentless', '0')], [f('Relentless', '-2')], [f('Relentless', '2.7')], [f('Relentless', ' 4 ')], [f('Relentless', '0x3')], [f('Relentless', 'x')],
    [f('relentless (two)')], [f('  RELENTLESS  (5)')], [f('Relentless () (6)')],
    [f('Horde (2d6+3 phy)')], [f('Horde (1d8 Magic)')], [f('Horde', '1d4+1 mag')], [f('Horde')], [f('Horde (junk)')], [f('Horde', 'phy 2d4')], [f('Horde', '2d4 mag+1')], [f('Horde', '1d6  PHYSICAL_x +2')], [f('Horde (\u00a0 3d6 physical)')],
    [f('Minion (5)')], [f('Minion')], [f('Minion', '')], [f('Minion', '1e1')], [f('Minion', '-1')],
    [f('Momentum'), f('Horde (1d10)'), f('Minion (3)'), f('Unknown thing')],
    [],
  ];
  const adversaries = [...STARTER_PACK.adversaries];
  return {
    traits: [...sets.map((features) => ({ features })), ...adversaries.map((a) => ({ features: a.features }))].map(({ features }) => ({
      features,
      traits: adversaryTraits({ features }),
      implemented: features.map((feature) => isFeatureImplemented(feature)),
    })),
    damage: [...sets, ...adversaries.map((a) => a.features)].flatMap((features, i) =>
      [[0, 6], [2, 6], [3, 6], [5, 6], [0, 0], [1, 1]].map(([marked, max]) => {
        const attackDamage = parseDice(i % 2 === 0 ? '1d6+1 phy' : '2d8 mag')!;
        return { features, attackDamage, hitPoints: { marked, max }, damage: attackDamageOf({ features, attackDamage }, { marked: marked!, max: max! }) };
      }),
    ),
  };
}

// --- Attacks ------------------------------------------------------------------------------------------

const DAMAGE = ['1d8+2 phy', '2d6 mag', '1d10', '3 phy', '1d12+4 phy/mag', 'd6', '2d4+1'];
const CONDITIONS = ['vulnerable', 'prone', 'hidden', 'restrained'];

function standing(gen: Rng, grid: TileGrid, e: EntityState): EntityState {
  const spot = grid.spotOf(e.tile);
  const at: Spot = [spot, spot, { x: spot.x + 0.3, y: spot.y - 0.2 }, { x: Number.NaN, y: Number.NaN }, { x: 0, y: 0 }][gen.nextInt(5)]!;
  return { ...e, at };
}

function attacks(gen: Rng) {
  const cases = [];
  for (let i = 0; i < 700; i++) {
    const gridName = gen.pick(Object.keys(GRIDS));
    const grid = GRIDS[gridName]!;
    const tile = (): number => (gen.nextInt(25) === 0 ? -1 : gen.nextInt(grid.size));
    const pc = gen.nextInt(2) === 0;
    const attackerTile = tile();
    const attacker = standing(gen, grid, pc ? createPartyEntity('a', 'hero', attackerTile) : createAdversaryEntity('a', 'brute', attackerTile, { hitPoints: 5, stress: 3 }));
    const targetTile = gen.nextInt(15) === 0 ? attackerTile : tile();
    const target = standing(gen, grid, pc ? createAdversaryEntity('t', 'brute', targetTile, { hitPoints: gen.pick([1, 4, 8]), stress: 2 }) : createPartyEntity('t', 'hero', targetTile, { hitPoints: 6, stress: 6, armorSlots: 3 }));
    for (const c of CONDITIONS) if (gen.nextInt(5) === 0) target.conditions.add(c);
    target.armorSlots = createMarkPool(gen.pick([0, 1, 3]), gen.nextInt(3));
    target.hitPoints = createMarkPool(target.hitPoints.max, gen.nextInt(target.hitPoints.max));
    const profile: AttackProfile = {
      kind: pc ? 'pc' : 'adversary',
      name: 'Swing',
      modifier: gen.pick([{ count: 0, sides: 0, modifier: 2 }, { count: 1, sides: 4, modifier: 1 }, { count: 0, sides: 0, modifier: -1 }, { count: 0, sides: 0, modifier: 0 }]),
      range: gen.pick([...RANGE_BANDS, 'far', 'veryFar', 'veryFar', 'veryFar']) as RangeBand,
      damage: parseDice(gen.pick(DAMAGE))!,
      ...(gen.nextInt(2) === 0 ? { proficiency: gen.pick([1, 2, 3]) } : {}),
      ...(gen.nextInt(6) === 0 ? { direct: true } : {}),
      ...(gen.nextInt(7) === 0 ? { double: true } : {}),
      ...(gen.nextInt(3) === 0 ? { trait: 'agility' as const } : {}),
    };
    const defender: DefenderProfile = {
      difficulty: gen.pick([8, 10, 12, 14, 16]),
      thresholds: gen.pick([{ major: 5, severe: 10 }, { major: 8, severe: 15 }, { major: 3, severe: 6 }]),
      ...(gen.nextInt(3) === 0
        ? { defenses: gen.pick([{ resistances: ['physical' as const] }, { immunities: ['magic' as const] }, { reduce: [{ dice: '1d4' }, { dice: '2', only: 'physical' as const }] }, { resistances: ['magic' as const], reduce: [{ dice: '3' }] }]) }
        : {}),
    };
    const options: AttackOptions = {
      ...(gen.nextInt(3) === 0 ? { advantage: gen.nextInt(3) } : {}),
      ...(gen.nextInt(3) === 0 ? { disadvantage: gen.nextInt(3) } : {}),
      ...(gen.nextInt(4) === 0 ? { helpDice: gen.nextInt(3) } : {}),
      ...(gen.nextInt(8) === 0 ? { goodDieSides: 20 } : {}),
      ...(gen.nextInt(3) === 0 ? { bonus: gen.pick([1, 2, -1]) } : {}),
      ...(gen.nextInt(3) === 0 ? { armorSlotsMarked: gen.nextInt(3) } : {}),
      ...(gen.nextInt(4) === 0 ? { damageBonus: gen.pick([1, 3]) } : {}),
      ...(gen.nextInt(6) === 0 ? { criticalRule: gen.pick(['maxDicePlusRoll', 'doubleDice'] as const) } : {}),
      ...(gen.nextInt(5) === 0 ? { massiveDamage: true } : {}),
      ...(gen.nextInt(15) === 0 ? { automatic: 'criticalSuccess' as const } : {}),
      ...(pc && gen.nextInt(8) === 0 ? { roll: rollDuality(createRng(`pre:${i}`), { difficulty: defender.difficulty, modifier: 1 }) } : {}),
      ...(gen.nextInt(6) === 0 ? { ranged: gen.nextInt(2) === 0 } : {}),
      ...(gen.nextInt(8) === 0 ? { bandTiles: TABLE } : {}),
      ...(gen.nextInt(10) === 0 ? { at: { attacker: { x: 1, y: 1 }, target: { x: 4.5, y: 1 } } } : {}),
    };
    const dice = createRng(`attack:${i}`);
    const outcome = resolveAttack(dice, { grid, attacker, target, profile, defender, options });
    const after = dice.save();

    const state = new SceneState({ id: 'fight' }, grid, { value: gen.nextInt(4), max: gen.pick([12, 3]) });
    const a = structuredClone(attacker);
    const t = structuredClone(target);
    if (a.good !== undefined && gen.nextInt(3) === 0) a.good = { value: gen.pick([5, 6]), max: 6 };
    a.stress = createMarkPool(a.stress.max, gen.nextInt(3));
    const before = { attacker: entityJson(a), target: entityJson(t), bad: { ...state.bad } };
    state.addEntity(a);
    state.addEntity(t);
    const rollFirst = gen.nextInt(4) === 0;
    const rolled = rollFirst ? applyRoll(state, outcome) : null;
    const applied = applyAttack(state, outcome, rollFirst ? { roll: false } : {});
    cases.push({
      grid: gridName,
      attacker: entityJson(attacker),
      target: entityJson(target),
      before,
      stateAttacker: entityJson(state.entity('a')!),
      stateTarget: entityJson(state.entity('t')!),
      profile, defender, options, outcome, after,
      rollFirst, rolled, applied,
      bad: state.bad,
    });
  }
  return cases;
}

// --- Defence ------------------------------------------------------------------------------------------

const REACTIONS: AbilityDef[] = [
  { id: 'ward', kind: 'reaction', trigger: 'incomingDamage', cost: { stress: 1 }, reaction: { kind: 'reduceDamage', dice: '1d8' } },
  { id: 'ward-big', kind: 'reaction', trigger: 'incomingDamage', cost: { good: 1 }, reaction: { kind: 'reduceDamage', dice: '2d6+1' } },
  { id: 'ward-bad', kind: 'reaction', trigger: 'incomingDamage', reaction: { kind: 'reduceDamage', dice: 'banana' } },
  { id: 'iron', kind: 'reaction', trigger: 'incomingDamage', cost: { stress: 1 }, reaction: { kind: 'extraArmor', slots: 1 } },
  { id: 'iron-phys', kind: 'reaction', trigger: 'incomingDamage', cost: { good: 1 }, reaction: { kind: 'extraArmor', slots: 2, only: 'physical' } },
  { id: 'tough', kind: 'reaction', trigger: 'incomingDamage', cost: { stress: 2 }, reaction: { kind: 'reduceSeverity', steps: 1, only: 'severe' } },
  { id: 'tough-any', kind: 'reaction', trigger: 'incomingDamage', reaction: { kind: 'reduceSeverity', steps: 2 } },
  { id: 'shield', kind: 'reaction', trigger: 'incomingDamage', reaction: { kind: 'redirect' } },
  { id: 'again', kind: 'reaction', trigger: 'incomingDamage', reaction: { kind: 'reroll' } },
  { id: 'manual', kind: 'reaction', trigger: 'incomingDamage', auto: false, reaction: { kind: 'reduceDamage', dice: '1d4' } },
  { id: 'passive', kind: 'passive', trigger: 'incomingDamage', reaction: { kind: 'reduceSeverity' } },
  { id: 'elsewhen', kind: 'reaction', trigger: 'attackHit', reaction: { kind: 'extraArmor' } },
  { id: 'pricey', kind: 'reaction', trigger: 'incomingDamage', cost: { good: 5, stress: 5 }, reaction: { kind: 'reduceSeverity', only: 'major' } },
].map((raw) => abilitySchema.parse({ name: raw.id, source: { card: 'c' }, ...raw }));

function defences(gen: Rng) {
  const subset = (): AbilityDef[] => REACTIONS.filter(() => gen.nextInt(3) === 0);
  return Array.from({ length: 500 }, (_, i) => {
    const damage = {
      amount: gen.pick([0, 2, 4, 6, 9, 12, 17, 25, 40]),
      types: gen.pick([[], ['physical'], ['magic'], ['physical', 'magic']]) as ('physical' | 'magic')[],
      ...(gen.nextInt(6) === 0 ? { direct: true } : {}),
      ...(gen.nextInt(10) === 0 ? { severity: gen.pick(['minor', 'major', 'severe'] as const) } : {}),
    };
    const defender: Defender = {
      thresholds: gen.pick([{ major: 5, severe: 10 }, { major: 8, severe: 15 }, { major: 3, severe: 6 }]),
      ...(gen.nextInt(4) === 0 ? { defenses: gen.pick([{ resistances: ['physical' as const] }, { reduce: [{ dice: '1d4' }] }, { reduce: [{ dice: '2' }], immunities: ['magic' as const] }]) } : {}),
      armorSlots: createMarkPool(gen.pick([0, 1, 2, 4]), gen.nextInt(2)),
      stress: createMarkPool(6, gen.nextInt(7)),
      ...(gen.nextInt(4) === 0 ? {} : { good: { value: gen.nextInt(4), max: 6 } }),
      reactions: subset(),
    };
    const policy: DefensePolicy = { armor: gen.pick(['auto', 'never', 'ask'] as const), reactions: gen.nextInt(4) !== 0 };
    const plan = { armorSlots: gen.nextInt(4), reactions: subset() };
    const byPolicy = createRng(`defence:${i}`);
    const defence = resolveDefense(byPolicy, damage, defender, policy);
    const byPlan = createRng(`plan:${i}`);
    const planned = resolveDefensePlan(byPlan, damage, defender, plan);
    const ids = <T extends { reactions: { ability: AbilityDef }[] }>(d: T) => ({ ...d, reactions: d.reactions.map((r) => ({ ...r, ability: r.ability.id })) });
    return {
      damage,
      defender: { ...defender, reactions: defender.reactions.map((a) => a.id) },
      policy,
      plan: { ...plan, reactions: plan.reactions.map((a) => a.id) },
      defence: ids(defence),
      after: byPolicy.save(),
      planned: ids(planned),
      afterPlan: byPlan.save(),
      preview: previewPlan(damage, defender, plan),
      canPay: REACTIONS.map((a) => canPayFor(defender, a)),
    };
  });
}

// --- Encounters ---------------------------------------------------------------------------------------

function encounters(gen: Rng) {
  const setups: { policy: TurnPolicy; tokens?: number }[] = [{ policy: 'spotlight' }, { policy: 'tracker' }, { policy: 'tracker', tokens: 1 }, { policy: 'tracker', tokens: 2 }, { policy: 'tracker', tokens: 0 }, { policy: 'spotlight' }, { policy: 'tracker', tokens: 3 }, { policy: 'spotlight' }];
  const ids = ['p1', 'p2', 'p3', 'a1', 'a2', 'a3', 'n1', 'nobody'];
  return setups.map((setup, s) => {
    const grid = GRIDS['open']!;
    const bad = { value: gen.nextInt(4), max: 12 };
    const state = new SceneState({ id: 'fight' }, grid, { ...bad });
    const entities: EntityState[] = [
      createPartyEntity('p1', 'hero', 0), createAdversaryEntity('a1', 'brute', 5, { hitPoints: 3, stress: 1 }),
      createPartyEntity('p2', 'hero', 7), createAdversaryEntity('a2', 'brute', 11, { hitPoints: 3, stress: 1 }),
      createAdversaryEntity('n1', 'bystander', 14, { hitPoints: 2, stress: 0, faction: 'neutral' }),
      createPartyEntity('p3', 'hero', 20), createAdversaryEntity('a3', 'brute', 29, { hitPoints: 3, stress: 1 }),
    ];
    const setupEntities = entities.map((e) => entityJson(structuredClone(state.addEntity(e))));
    const runner = new EncounterRunner(state, 'the-fight', { policy: setup.policy, ...(setup.tokens === undefined ? {} : { tokensPerCharacter: setup.tokens }) });
    const steps = [];
    let seen = 0;
    const PARTY_ACTS = ['act', 'actToGm', 'canAct', 'circleOf', 'reanchor', 'pushOpens', 'push', 'tokensFor', 'move'];
    const GM_ACTS = ['spotlight', 'grantSpotlight', 'spotlightAgain', 'canSpotlight', 'canSpotlightAgain'];
    for (let step = 0; step < 120; step++) {
      const act = step === 0 && s % 2 === 0 ? 'start' : gen.pick([
        'start', 'act', 'act', 'act', 'actToGm', 'passToGm', 'spotlight', 'spotlight', 'grantSpotlight', 'spotlightAgain', 'endGmTurn', 'endGmTurn',
        'canAct', 'canSpotlight', 'canSpotlightAgain', 'circleOf', 'reanchor', 'pushOpens', 'push', 'tokensFor', 'settleIfDecided',
        'kill', 'revive', 'move', 'addBad', 'end', 'view', 'round',
      ]);
      // Mostly somebody the act is for: a party member to act, an adversary to spotlight; now and then anyone.
      const id = gen.nextInt(5) === 0 ? gen.pick(ids) : PARTY_ACTS.includes(act) ? gen.pick(['p1', 'p2', 'p3']) : GM_ACTS.includes(act) ? gen.pick(['a1', 'a2', 'a3']) : gen.pick(ids);
      let result: unknown = null;
      // What a test-side change did, so a replay can do the same: whether it killed, where it moved, how it ended.
      let param: unknown = null;
      const entity = state.entity(id);
      switch (act) {
        case 'start': result = runner.start(); break;
        case 'act': result = runner.act(id); break;
        case 'actToGm': result = runner.act(id, { spotlightToGm: true }); break;
        case 'passToGm': result = runner.passToGm(); break;
        case 'spotlight': result = runner.spotlight(id); break;
        case 'grantSpotlight': result = runner.grantSpotlight(id); break;
        case 'spotlightAgain': result = runner.spotlightAgain(id); break;
        case 'endGmTurn': result = runner.endGmTurn(); break;
        case 'canAct': result = runner.canAct(id); break;
        case 'canSpotlight': result = runner.canSpotlight(id); break;
        case 'canSpotlightAgain': result = runner.canSpotlightAgain(id); break;
        case 'circleOf': result = runner.circleOf(id); break;
        case 'reanchor': runner.reanchor(id); break;
        case 'pushOpens': result = runner.pushOpens(id); break;
        case 'push': result = runner.push(id); break;
        case 'tokensFor': result = num(runner.tokensFor(id)); break;
        case 'settleIfDecided': result = runner.settleIfDecided(); break;
        case 'kill': param = entity !== undefined && gen.nextInt(4) === 0; if (param === true) entity!.alive = false; break;
        case 'revive': if (entity !== undefined) entity.alive = true; break;
        case 'move': if (entity !== undefined) { entity.at = { x: gen.nextInt(grid.width) + 0.25, y: gen.nextInt(grid.height) }; param = entity.at; } break;
        case 'addBad': state.bad = { max: state.bad.max, value: Math.min(state.bad.max, state.bad.value + 2) }; break;
        case 'end': param = gen.nextInt(6) === 0 ? gen.pick(['victory', 'defeat', 'stopped'] as const) : null; if (param !== null) result = runner.end(param as 'victory'); break;
        case 'view': result = runner.view(); break;
        case 'round': result = runner.round; break;
      }
      // Cloned as it stands: a circle is the runner's own object, and a later push would widen it here too.
      steps.push({ act, id, param, result: result === undefined ? null : structuredClone(result), bad: { ...state.bad }, encounter: { ...state.encounter('the-fight') }, outcome: runner.outcome, events: runner.log.slice(seen) });
      seen = runner.log.length;
    }
    return { setup, bad, entities: setupEntities, steps };
  });
}

/** Both sides down at once: defeat is read first. */
function bothFallen() {
  return (['spotlight', 'tracker'] as const).map((policy) => {
    const state = new SceneState({ id: 'fight' }, GRIDS['open']!);
    const p1 = state.addEntity(createPartyEntity('p1', 'hero', 0));
    const a1 = state.addEntity(createAdversaryEntity('a1', 'brute', 5, { hitPoints: 3, stress: 1 }));
    const runner = new EncounterRunner(state, 'both', { policy });
    const started = runner.start();
    p1.alive = false;
    a1.alive = false;
    const settled = runner.settleIfDecided();
    return { policy, started, settled, view: runner.view(), events: runner.log, encounter: { ...state.encounter('both') } };
  });
}

function golden() {
  const gen = createRng('the combat fixture');
  return {
    about: 'src/engine/combat fought for the Rust port; written by src/engine/combat/combat.golden.test.ts',
    grids: Object.fromEntries(Object.entries(GRIDS).map(([name, grid]) => [name, specOf(grid)])),
    table: TABLE,
    targeting: targeting(gen),
    refusals: (['noAttacker', 'noTarget', 'selfTarget', 'outOfRange', 'noLineOfSight'] as const).map((r) => [r, refusalMessage(r)]),
    areas: areas(gen),
    features: features(),
    attacks: attacks(gen),
    reactions: REACTIONS,
    defences: defences(gen),
    encounters: encounters(gen),
    bothFallen: bothFallen(),
  };
}

describe('combat, as the Rust server must fight it', () => {
  it('is what server/fixtures/combat.json holds', () => {
    const now = JSON.parse(JSON.stringify(golden())) as unknown;
    if (process.env['UPDATE_GOLDEN'] === '1' || !existsSync(FIXTURE)) {
      mkdirSync(dirname(FIXTURE), { recursive: true });
      writeFileSync(FIXTURE, `${JSON.stringify(now)}\n`, 'utf8');
    }
    expect(JSON.parse(readFileSync(FIXTURE, 'utf8'))).toEqual(now);
  });
});
