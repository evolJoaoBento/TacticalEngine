/**
 * The party, as the Rust server must move it (`docs/SERVER.md`, phase 2).
 *
 * Sessions of orders given to a party - select, Tab, arrange, link and unlink, hold and let go, the
 * ground it can reach and the ground it covers (in a fight, out of one, inside a circle), a walk
 * planned and made (aimed at a spot, begun mid-walk, cut short), followers walking down the trail,
 * a walk stopped where the figure got to, a member falling, the rules changed - each order's answer,
 * and where everybody stands after it, with the party's selection, order, groups, held members and
 * trails. The rooms are the demo's vault with the demo's own party, and rooms written from a seed: walls
 * and marsh and cover, raised ground and steps, pieces built on it, solid props, doors, creatures in the
 * way. `UPDATE_GOLDEN=1 npx vitest run src/engine/scene/party.golden.test.ts` writes
 * `server/fixtures/party.json`; `server/engine/tests/golden_party.rs` replays it.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRng, type Rng } from '../core/rng';
import { NO_TILE, type Spot, type TileGrid } from '../grid/grid';
import { Pathfinder, type MovementRules, type ReachableField } from '../grid/pathfinding';
import type { WalkRules } from '../grid/walk';
import { buildDemoScene } from '../../game/demo-scene';
import { hollowVaultMap } from '../../game/demo-map';
import { DEMO_ADVERSARIES } from '../../game/demo-rules';
import { gridFromScene, paletteForProject } from './grid-from-scene';
import { Party, type PartyOptions, type Walk, type WalkOptions } from './party';
import { sceneSchema, type ProjectDoc, type SceneDoc } from './schema';
import { createPartyEntity, sceneStateFromScene, type SceneState } from './state';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(here, '../../../server/fixtures/party.json');
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value ?? null)) as T;
const num = (value: number): number | null => (Number.isFinite(value) ? value : null);

type Project = Pick<ProjectDoc, 'terrainPalette' | 'structureTypes'>;
type Stats = [string, { hitPoints: number; stress: number }][];
interface Member {
  id: string;
  definition: string;
}

/** A room as `room.json` writes one: enough for the Rust side to stand the same room up. */
interface Room {
  project: Project;
  scene: SceneDoc;
  stats: Stats;
  party: Member[];
}

function standUp(room: Room): SceneState {
  const { grid } = gridFromScene(room.scene, paletteForProject(room.project));
  return sceneStateFromScene(room.scene, grid, {
    adversaries: new Map(room.stats.map(([id, s]) => [id, { id, ...s }])),
    party: room.party.map((m) => createPartyEntity(m.id, m.definition, NO_TILE, { hitPoints: 6, stress: 6, armorSlots: 2 })),
  }).state;
}

// --- What an answer is written as -------------------------------------------------------------------------

const rulesJson = (r: MovementRules) => ({ diagonals: r.diagonals, maxStepHeight: num(r.maxStepHeight), allowCornerCutting: r.allowCornerCutting, diagonalCostMultiplier: r.diagonalCostMultiplier });
const walkRulesJson = (w: WalkRules) => ({ radius: w.radius, maxStepHeight: num(w.maxStepHeight) });

function optionsJson(o: Required<PartyOptions>) {
  return { combatReach: num(o.combatReach), moveBudget: num(o.moveBudget), followerBudget: num(o.followerBudget), followDistance: o.followDistance, trailLength: o.trailLength, rules: rulesJson(o.rules), walk: walkRulesJson(o.walk) };
}

function fieldJson(field: ReachableField, grid: TileGrid) {
  const tiles = field.tiles();
  let reach = '';
  for (let tile = 0; tile < grid.size; tile++) reach += field.canReach(tile) ? '1' : '0';
  return { start: field.start, budget: num(field.budget), tiles, cost: tiles.map((t) => num(field.costTo(t))), came: tiles.map((t) => field.cameFrom(t)), reach };
}

const walkJson = (walk: Walk | null) => (walk === null ? null : clone(walk));

function view(party: Party, state: SceneState) {
  const inside = party as unknown as { trails: Map<string, Spot[]>; options: Required<PartyOptions> };
  const members = party.members();
  return {
    entities: state.allEntities().map((e) => [e.id, e.tile, e.at.x, e.at.y, e.alive]),
    selected: party.selected,
    members,
    groups: members.map((id) => party.groupOf(id)),
    held: members.filter((id) => party.isHeld(id)),
    // Copied now: the party keeps changing the same array as it walks.
    trails: members.map((id) => clone(inside.trails.get(id) ?? [])),
  };
}

// --- A session ---------------------------------------------------------------------------------------------

const round = (n: number): number => Math.round(n * 20) / 20;

function session(g: Rng, name: string, room: Room, options: PartyOptions, length: number) {
  const state = standUp(room);
  const party = new Party(state, new Pathfinder(state.grid), options);
  const grid = state.grid;
  const resolved = optionsJson((party as unknown as { options: Required<PartyOptions> }).options);
  const ops: unknown[] = [];
  const someone = (): string => {
    const members = party.members();
    const r = g.nextInt(20);
    if (r === 0) return 'nobody';
    if (r === 1 && state.entitiesOf('adversary').length > 0) return g.pick(state.entitiesOf('adversary')).id;
    return members.length === 0 ? 'nobody' : g.pick(members);
  };
  const aTile = (id: string): number => {
    const at = state.entity(id)?.tile ?? NO_TILE;
    if (at !== NO_TILE && g.nextInt(3) > 0) {
      const x = Math.min(grid.width - 1, Math.max(0, grid.xOf(at) + g.nextInt(11) - 5));
      const y = Math.min(grid.height - 1, Math.max(0, grid.yOf(at) + g.nextInt(11) - 5));
      return grid.indexOf(x, y);
    }
    return g.nextInt(8) === 0 ? at : g.nextInt(grid.size);
  };
  const aSpot = (tile: number): Spot => ({ x: round(grid.xOf(tile) + (g.next() - 0.5) * 0.9), y: round(grid.yOf(tile) + (g.next() - 0.5) * 0.9) });
  const walkOptions = (id: string, fighting: boolean): WalkOptions => {
    const at = state.entity(id)?.at;
    const options: WalkOptions = { inCombat: fighting };
    // Half-tile budgets too: a walk cut there ends midway between two tiles.
    if (g.nextInt(3) === 0) options.budget = g.pick([Infinity, 1.5, 2, 2.5, 3.5, 6, 10]);
    if (at !== undefined && fighting && g.nextInt(2) === 0) options.within = { anchor: { ...at }, radius: g.pick([0.4, 1.5, 3, 4.5, 7]) };
    if (at !== undefined && g.nextInt(6) === 0) options.from = { x: round(at.x + (g.next() - 0.5) * 1.6), y: round(at.y + (g.next() - 0.5) * 1.6) };
    if (g.nextInt(2) === 0) options.short = true;
    return options;
  };
  const optionsOut = (o: WalkOptions) => ({ ...o, ...(o.budget === undefined ? {} : { budget: num(o.budget) }) });

  for (let n = 0; n < length; n++) {
    const kind = g.pick(['select', 'selectNext', 'arrange', 'link', 'unlink', 'hold', 'release', 'canCommand', 'reachable', 'covered', 'planWalk', 'walkTo', 'walkTo', 'walkTo', 'walkTo', 'follow', 'followPositions', 'landAt', 'fall', 'setRules', 'shuffle', 'cut'] as const);
    let op: Record<string, unknown>;
    switch (kind) {
      case 'select': {
        const id = someone();
        op = { op: kind, id, result: party.select(id) };
        break;
      }
      case 'selectNext':
        op = { op: kind, result: party.selectNext() };
        break;
      case 'arrange': {
        const id = someone();
        const before = g.nextInt(4) === 0 ? null : someone();
        op = { op: kind, id, before, result: party.arrange(id, before) };
        break;
      }
      case 'link': {
        const [id, withId] = [someone(), someone()];
        op = { op: kind, id, with: withId, result: party.link(id, withId) };
        break;
      }
      case 'unlink': {
        const id = someone();
        op = { op: kind, id, result: party.unlink(id) };
        break;
      }
      case 'hold': {
        const id = someone();
        op = { op: kind, id, result: party.hold(id) };
        break;
      }
      case 'release': {
        const id = someone();
        op = { op: kind, id, result: party.release(id) };
        break;
      }
      case 'canCommand': {
        const id = g.nextInt(4) === 0 ? null : someone();
        op = { op: kind, id, result: id === null ? party.canCommand(null) : party.canCommand(id) };
        break;
      }
      case 'reachable': {
        const id = someone();
        const at = state.entity(id)?.at;
        const asked = { inCombat: g.nextInt(2) === 0, ...(g.nextInt(3) === 0 ? { budget: g.pick([Infinity, 2, 5]) } : {}), ...(at !== undefined && g.nextInt(5) === 0 ? { from: { x: round(at.x + 0.4), y: round(at.y - 0.3) } } : {}) };
        op = { op: kind, id, options: optionsOut(asked), result: fieldJson(party.reachable(id, asked).clone(), grid) };
        break;
      }
      case 'covered': {
        const id = someone();
        const fighting = g.nextInt(3) > 0;
        const at = state.entity(id)?.at;
        const asked = {
          inCombat: fighting,
          ...(g.nextInt(3) === 0 ? { budget: g.pick([Infinity, 2, 3.5]) } : {}),
          ...(at !== undefined && g.nextInt(3) === 0 ? { within: { anchor: { ...at }, radius: g.pick([2, 3.5]) } } : {}),
        };
        op = { op: kind, id, options: optionsOut(asked), result: fieldJson(party.covered(id, asked), grid) };
        break;
      }
      case 'planWalk':
      case 'walkTo': {
        const id = g.nextInt(3) > 0 && party.selected !== null ? party.selected : someone();
        const fighting = g.nextInt(3) === 0;
        const destination = aTile(id);
        const options = walkOptions(id, fighting);
        if (g.nextInt(2) === 0 && destination !== NO_TILE) options.at = aSpot(destination);
        const walk = kind === 'walkTo' ? party.walkTo(id, destination, options) : party.planWalk(id, destination, options);
        op = { op: kind, id, destination, options: optionsOut(options), result: walkJson(walk) };
        // Out of a fight the others come along, as the game has them.
        if (kind === 'walkTo' && walk !== null && !fighting && walk.path.length > 1 && g.nextInt(4) > 0) {
          op['followed'] = [...party.followAlong(id, walk.path, walk.route)].map(([who, w]) => [who, clone(w)]);
        }
        break;
      }
      case 'shuffle': {
        // A step within the tile they stand on, in a fight, inside a circle that may be too small for it.
        const id = party.selected ?? someone();
        const entity = state.entity(id);
        const destination = entity?.tile ?? NO_TILE;
        const options: WalkOptions = { inCombat: true, budget: Infinity, ...(destination === NO_TILE ? {} : { at: entity !== undefined && g.nextInt(4) === 0 ? { ...entity.at } : aSpot(destination) }), ...(entity === undefined || g.nextInt(4) === 0 ? {} : { within: { anchor: { ...entity.at }, radius: g.pick([0.2, 0.4, 1]) } }) };
        op = { op: 'planWalk', id, destination, options: optionsOut(options), result: walkJson(party.planWalk(id, destination, options)) };
        break;
      }
      case 'cut': {
        // Straight along a row or a column, on a budget that runs out halfway between two tiles.
        const id = party.selected ?? someone();
        const tile = state.entity(id)?.tile ?? NO_TILE;
        const [dx, dy] = g.pick([[1, 0], [-1, 0], [0, 1], [0, -1]] as const);
        const destination = tile === NO_TILE ? NO_TILE : grid.indexOf(grid.xOf(tile) + 4 * dx, grid.yOf(tile) + 4 * dy);
        const options: WalkOptions = { inCombat: true, budget: g.pick([1.5, 2.5]), short: true };
        op = { op: 'planWalk', id, destination, options: optionsOut(options), result: walkJson(party.planWalk(id, destination, options)) };
        break;
      }
      case 'follow': {
        const id = someone();
        const tile = state.entity(id)?.tile ?? NO_TILE;
        const path = tile === NO_TILE ? [] : [aTile(id), tile];
        op = { op: kind, id, path, result: [...party.follow(id, path)] };
        break;
      }
      case 'followPositions': {
        const id = someone();
        const tile = state.entity(id)?.tile ?? NO_TILE;
        const path = tile === NO_TILE ? [] : [aTile(id), aTile(id), tile];
        op = { op: kind, id, path, result: [...party.followPositions(id, path)] };
        break;
      }
      case 'landAt': {
        const id = someone();
        const tile = aTile(id);
        const at = tile === NO_TILE ? { x: -3, y: 2 } : aSpot(tile);
        op = { op: kind, id, at, result: party.landAt(id, at) };
        break;
      }
      case 'fall': {
        // Somebody drops, or gets back up: the scene's to say, and the party reads it.
        const id = someone();
        const entity = state.entity(id);
        if (entity !== undefined) entity.alive = !entity.alive;
        op = { op: kind, id };
        break;
      }
      case 'setRules': {
        const rules: MovementRules = { diagonals: g.nextInt(2) === 0, maxStepHeight: g.pick([0.72, 0.35, Infinity, 1.2]), allowCornerCutting: g.nextInt(3) === 0, diagonalCostMultiplier: g.pick([1, 1.5, 2]) };
        party.setRules(rules);
        op = { op: kind, rules: rulesJson(rules) };
        break;
      }
    }
    op['after'] = view(party, state);
    ops.push(op);
  }
  return { name, room: clone(room), options: resolved, start: view(new Party(standUp(room), new Pathfinder(grid), options), standUp(room)), ops };
}

// --- Rooms written from a seed -----------------------------------------------------------------------------

function written(g: Rng, i: number): Room {
  const width = 6 + g.nextInt(11);
  const height = 5 + g.nextInt(9);
  const count = width * height;
  const terrain = Array.from({ length: count }, () => g.pick(['floor', 'floor', 'floor', 'floor', 'floor', 'floor', 'wall', 'difficult', 'cover']));
  const heights = Array.from({ length: count }, () => 0);
  // A raised block or two: steps a walk can climb, and a ledge it cannot.
  for (let r = g.nextInt(3); r > 0; r--) {
    const [x0, y0] = [g.nextInt(width), g.nextInt(height)];
    const level = g.pick([1, 2, 3]);
    for (let y = y0; y < Math.min(height, y0 + 1 + g.nextInt(4)); y++) for (let x = x0; x < Math.min(width, x0 + 1 + g.nextInt(4)); x++) heights[y * width + x] = level;
  }
  const pieces: Record<string, unknown> = {};
  for (let n = g.nextInt(4) === 0 ? g.nextInt(12) : 0; n > 0; n--) {
    const piece = { x: g.nextInt(width), y: g.nextInt(height), level: g.pick([0, 0.25, 1]), shape: g.pick(['block', 'floor', 'wall', 'stairs']), material: 'stone', rotation: g.nextInt(4), tile: g.pick(['block', 'platform', 'barrier', 'steps']) };
    pieces[`${piece.x},${piece.y},${piece.level}`] = piece;
  }
  const spot = () => ({ x: g.nextInt(width), y: g.nextInt(height) });
  const scene = sceneSchema.parse({
    id: `room-${i}`,
    width,
    height,
    terrain,
    heights,
    spawns: Array.from({ length: 1 + g.nextInt(4) }, spot),
    decos: Array.from({ length: g.nextInt(4) }, (_, d) => ({ model: 'rock', position: spot(), ...(g.nextInt(2) === 0 ? { span: 1 + g.nextInt(2) } : {}), solid: true, ...(d === 0 && g.nextInt(2) === 0 ? { id: `door-${d}`, function: { kind: 'door' } } : {}) })),
    encounters: g.nextInt(2) === 0 ? [] : [{ id: 'foes', adversaries: Array.from({ length: 1 + g.nextInt(3) }, (_, a) => ({ id: `foe-${a}`, adversary: 'rat', position: spot() })) }],
    ...(Object.keys(pieces).length > 0 ? { buildingTiles: pieces } : {}),
  });
  const party = Array.from({ length: 2 + g.nextInt(5) }, (_, m) => ({ id: g.pick(['kara', 'mira', 'quim', 'bo', 'zed', 'ana']) + `-${m}`, definition: 'guardian' }));
  return { project: {}, scene, stats: [['rat', { hitPoints: 3, stress: 1 }]], party };
}

function anOptions(g: Rng): PartyOptions {
  return {
    ...(g.nextInt(2) === 0 ? { combatReach: g.pick([3, 4, 6]) } : {}),
    ...(g.nextInt(5) === 0 ? { moveBudget: g.pick([8, 14]) } : {}),
    ...(g.nextInt(4) === 0 ? { followerBudget: g.pick([3, 10]) } : {}),
    ...(g.nextInt(3) === 0 ? { followDistance: g.pick([0.5, 1.5, 2]) } : {}),
    ...(g.nextInt(2) === 0 ? { trailLength: g.pick([3, 4, 10]) } : {}),
    ...(g.nextInt(2) === 0 ? { rules: { diagonals: g.nextInt(2) === 0, maxStepHeight: g.pick([0.72, 0.35, Infinity]), allowCornerCutting: g.nextInt(3) === 0, diagonalCostMultiplier: g.pick([1, 1.5]) } } : {}),
    ...(g.nextInt(4) === 0 ? { walk: { radius: g.pick([0.25, 0.35, 0.45]), maxStepHeight: 0.72 } } : {}),
  };
}

function golden() {
  const g = createRng('party');
  const sessions = [];
  // The demo's vault, walked by the demo's party as the game has it walk.
  const demo = buildDemoScene(hollowVaultMap(), 'party');
  const inside = demo.party as unknown as { options: Required<PartyOptions> };
  const ids = new Set(demo.scene.encounters.flatMap((e) => e.adversaries.map((a) => a.adversary)));
  const demoRoom: Room = {
    project: clone({ terrainPalette: demo.project.terrainPalette, ...(demo.project.structureTypes === undefined ? {} : { structureTypes: demo.project.structureTypes }) }),
    scene: demo.scene,
    stats: [...ids].map((id) => [id, { hitPoints: DEMO_ADVERSARIES.get(id)!.hitPoints, stress: DEMO_ADVERSARIES.get(id)!.stress }]),
    party: demo.state.entitiesOf('party').map((e) => ({ id: e.id, definition: e.definition })),
  };
  expect(standUp(demoRoom).allEntities().map((e) => [e.id, e.tile])).toEqual(demo.state.allEntities().map((e) => [e.id, e.tile]));
  for (let s = 0; s < 3; s++) sessions.push(session(g, `the demo ${s}`, demoRoom, { combatReach: inside.options.combatReach, rules: inside.options.rules }, 40));
  for (let i = 0; i < 110; i++) sessions.push(session(g, `written ${i}`, written(g, i), anOptions(g), 30));
  return { about: 'the party moved for the Rust port; written by src/engine/scene/party.golden.test.ts', sessions };
}

describe('the party, as the Rust server must move it', () => {
  it('is what server/fixtures/party.json holds', () => {
    const now = clone(golden());
    if (process.env['UPDATE_GOLDEN'] === '1' || !existsSync(FIXTURE)) {
      mkdirSync(dirname(FIXTURE), { recursive: true });
      writeFileSync(FIXTURE, `${JSON.stringify(now)}\n`, 'utf8');
    }
    expect(JSON.parse(readFileSync(FIXTURE, 'utf8'))).toEqual(now);
  }, 300_000);
});
