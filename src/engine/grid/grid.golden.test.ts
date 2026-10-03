/**
 * The grid as the Rust server must run it (`docs/SERVER.md`, phase 2): this builds grids through the real
 * API - the default palette with stacked pieces, lifts, a barred edge and nothing at all; a palette of its
 * own with fractional costs and sight-blocking smoke; a flat room, where every search is a tie to break;
 * a corridor - and records what `grid.ts`, `los.ts`, `pathfinding.ts` and `walk.ts` answer, into
 * `server/fixtures/grid.json`, which `server/engine/tests/golden_grid.rs` replays. Infinity is written as
 * `null`. `UPDATE_GOLDEN=1 npx vitest run src/engine/grid/grid.golden.test.ts` writes it afresh.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRng } from '../core/rng';
import { NOTHING_STACKED, TileGrid, type Spot } from './grid';
import { coverBetween, lineOfSight, traceLine, type LineOfSightRules } from './los';
import { DEFAULT_MOVEMENT, Pathfinder, tracePath, type MovementContext, type MovementRules } from './pathfinding';
import { DEFAULT_TERRAIN_TYPES, TerrainPalette, terrain } from './terrain';
import {
  DEFAULT_WALK, canStandAt, distanceInside, distanceWithin, insideCircle, lineCost, lineLength, nearestOnLine, pointAlong, segmentClear, settleEnd,
  smoothPath, splitLine, type WalkRules,
} from './walk';

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), '../../../server/fixtures/grid.json');

/** A number as the fixture keeps it: Infinity as null. */
const num = (value: number): number | null => (Number.isFinite(value) ? value : null);

// --- The grids -------------------------------------------------------------------------------------

function room(): TileGrid {
  // The default palette: floor, difficult, cover, wall, platform, steps, block, barrier, and void appended.
  const grid = new TileGrid({ width: 10, height: 8 });
  const p = grid.palette;
  const at = (x: number, y: number): number => grid.indexOf(x, y);
  for (let y = 1; y < 7; y++) grid.setTerrain(at(4, y), p.require('wall'));
  grid.setTerrain(at(4, 4), p.require('floor')); // a door in the wall
  for (const [x, y] of [[1, 1], [2, 1], [1, 2], [7, 5], [8, 5]] as const) grid.setTerrain(at(x, y), p.require('difficult'));
  for (const [x, y] of [[6, 2], [2, 5]] as const) grid.setTerrain(at(x, y), p.require('cover'));
  grid.setTerrain(at(9, 0), p.require('void'));
  // Ground levels: a rise in the east, a pit in the west.
  for (const [x, y, h] of [[7, 1, 1], [8, 1, 2], [9, 1, 3], [8, 2, 2], [9, 2, 2], [0, 6, -1], [1, 6, -2], [5, 7, 4]] as const) grid.setHeight(at(x, y), h);
  // Stacked pieces: a block a whole tile up, stairs half way, a low barrier giving cover, a platform.
  grid.setOverlay(at(6, 6), p.require('block'));
  grid.lift[at(6, 6)] = 1;
  grid.setOverlay(at(5, 6), p.require('steps'));
  grid.lift[at(5, 6)] = 0.5;
  grid.setOverlay(at(7, 3), p.require('barrier'));
  grid.lift[at(7, 3)] = 0.3;
  grid.setOverlay(at(2, 3), p.require('platform'));
  grid.lift[at(2, 3)] = 0.35;
  grid.lift[at(3, 7)] = 0.7; // a lift with nothing stacked: the ground itself raised
  // A wall along one edge, too thin to stand on and too tall to step over.
  grid.barred[at(6, 4)] = 1;
  return grid;
}

function custom(): TileGrid {
  const palette = new TerrainPalette([
    terrain('road', { cost: 1 }),
    terrain('mud', { cost: 3 }),
    terrain('ice', { cost: 1.5 }),
    terrain('glass', { passable: false, cost: Infinity }),
    terrain('smoke', { blocksSight: true, cost: 1.25 }),
    terrain('rubble', { providesCover: true, cost: 2 }),
    terrain('void', { passable: false, cost: Infinity }),
  ]);
  const grid = new TileGrid({ width: 7, height: 6, palette, fillTerrain: 0 });
  const rng = createRng('the custom grid');
  for (let i = 0; i < grid.size; i++) {
    grid.setTerrain(i, rng.pick([0, 0, 0, 1, 2, 3, 4, 5, 0, 1]));
    grid.setHeight(i, rng.pick([0, 0, 0, 1, 2, -1, 0, 3]));
    if (rng.nextInt(9) === 0) {
      grid.setOverlay(i, rng.pick([1, 2, 5]));
      grid.lift[i] = rng.pick([0.25, 0.5, 0.75, 1.1, 0.72]);
    }
  }
  grid.setTerrain(0, 0);
  grid.setHeight(0, 0);
  grid.setOverlay(0, NOTHING_STACKED);
  return grid;
}

function open(): TileGrid {
  return new TileGrid({ width: 6, height: 5 });
}

function corridor(): TileGrid {
  const grid = new TileGrid({ width: 1, height: 6 });
  grid.setTerrain(3, grid.palette.require('difficult'));
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

// --- What each module answers -------------------------------------------------------------------------

function basics(grid: TileGrid) {
  const tiles = [...Array(grid.size).keys()];
  const neighbours = (diagonals: boolean) =>
    tiles.map((i) => {
      const out: number[] = [];
      grid.forEachNeighbor(i, diagonals, (n) => out.push(n));
      return out;
    });
  const rng = createRng(`pairs ${grid.width}x${grid.height}`);
  const pairs = Array.from({ length: 40 }, () => [rng.nextInt(grid.size), rng.nextInt(grid.size)] as const);
  const spots: [number, number][] = [];
  for (let y = -1.5; y <= grid.height + 0.5; y += 0.25) for (let x = -1.5; x <= grid.width + 0.5; x += 0.25) spots.push([x, y]);
  return {
    costAt: tiles.map((i) => num(grid.costAt(i))),
    isPassable: tiles.map((i) => grid.isPassable(i)),
    blocksSight: tiles.map((i) => grid.blocksSight(i)),
    providesCover: tiles.map((i) => grid.providesCover(i)),
    standAt: tiles.map((i) => grid.standAt(i)),
    offTheGrid: [-1, grid.size, grid.size + 3].map((i) => ({ i, passable: grid.isPassable(i), sight: grid.blocksSight(i), cover: grid.providesCover(i), spot: grid.spotOf(i) })),
    neighbours: neighbours(false),
    neighboursDiagonal: neighbours(true),
    distances: pairs.map(([a, b]) => ({ a, b, manhattan: grid.manhattanDistance(a, b), chebyshev: grid.chebyshevDistance(a, b), euclidean: grid.euclideanDistance(a, b), diagonal: grid.isDiagonalStep(a, b) })),
    tileAtSpot: spots.map(([x, y]) => [x, y, grid.tileAtSpot(x, y)]),
  };
}

const SIGHT_RULES: LineOfSightRules[] = [{ blockingHeightMargin: 1 }, { blockingHeightMargin: 0.5 }, { blockingHeightMargin: 3 }];

function sight(grid: TileGrid) {
  const results: (number | null)[][] = [];
  for (const rules of SIGHT_RULES) {
    for (let a = 0; a < grid.size; a++) {
      for (let b = 0; b < grid.size; b++) {
        const seen = lineOfSight(grid, a, b, rules);
        // [clear, partial, firstBlocker, cover] as small numbers, one row per pair.
        results.push([seen.clear ? 1 : 0, seen.partial ? 1 : 0, seen.firstBlocker, coverBetween(grid, a, b, rules) === 'cover' ? 1 : 0]);
      }
    }
  }
  const rng = createRng(`traces ${grid.width}x${grid.height}`);
  const traces = Array.from({ length: 60 }, () => {
    const a = rng.nextInt(grid.size);
    const b = rng.nextInt(grid.size);
    const visited: [number, boolean][] = [];
    traceLine(grid, a, b, (tile, atCorner) => {
      visited.push([tile, atCorner]);
    });
    return { a, b, visited };
  });
  return { rules: SIGHT_RULES, results, traces };
}

const MOVE_RULES: MovementRules[] = [
  DEFAULT_MOVEMENT,
  { ...DEFAULT_MOVEMENT, diagonals: true },
  { ...DEFAULT_MOVEMENT, diagonals: true, allowCornerCutting: true, diagonalCostMultiplier: 1 },
  { ...DEFAULT_MOVEMENT, diagonals: true, diagonalCostMultiplier: 0.9, maxStepHeight: Infinity },
  { ...DEFAULT_MOVEMENT, maxStepHeight: 0.3 },
];

/** The contexts a query is made in, as data: tiles held, a surcharge per tile (negative ones are clamped), a disc to stay in. */
function contextsFor(grid: TileGrid) {
  const rng = createRng(`contexts ${grid.width}x${grid.height}`);
  const blocked = [...new Set(Array.from({ length: Math.max(1, Math.floor(grid.size / 8)) }, () => rng.nextInt(grid.size)))].sort((a, b) => a - b);
  const extra: Record<number, number> = {};
  for (let i = 0; i < grid.size; i++) if (rng.nextInt(5) === 0) extra[i] = rng.pick([0.5, 1, 2, -2, 0.25]);
  return [{}, { blocked }, { extra }, { maxSpan: 3 }, { blocked, extra, maxSpan: 4 }];
}

function contextOf(data: { blocked?: number[]; extra?: Record<number, number>; maxSpan?: number }, rules: MovementRules): MovementContext {
  return {
    rules,
    ...(data.blocked === undefined ? {} : { isBlocked: (tile: number) => data.blocked!.includes(tile) }),
    ...(data.extra === undefined ? {} : { extraCost: (tile: number) => data.extra![tile] ?? 0 }),
    ...(data.maxSpan === undefined ? {} : { maxSpan: data.maxSpan }),
  };
}

function paths(grid: TileGrid) {
  const finder = new Pathfinder(grid);
  const contexts = contextsFor(grid);
  const rng = createRng(`starts ${grid.width}x${grid.height}`);
  const starts = [...new Set([0, rng.nextInt(grid.size), rng.nextInt(grid.size), grid.size - 1])];
  const fields = [];
  const routes = [];
  for (const [r, rules] of MOVE_RULES.entries()) {
    for (const [c, data] of contexts.entries()) {
      const context = contextOf(data, rules);
      for (const start of starts) {
        for (const budget of [0, 2, 5.5, Infinity]) {
          const field = finder.reachable(start, budget, context);
          const tiles = [...Array(grid.size).keys()];
          const cost = tiles.map((t) => num(field.costTo(t)));
          const cameFrom = tiles.map((t) => field.cameFrom(t));
          const reach = field.tiles();
          const kept = field.clone();
          const traced = tiles.map((t) => tracePath(kept, t));
          const adjacent = tiles.filter((t) => t % 3 === 0).map((t) => [t, finder.nearestReachableAdjacentTo(kept, t, rules)]);
          fields.push({ rules: r, context: c, start, budget: num(budget), cost, cameFrom, reach, traced, adjacent });
        }
        const goals = [...Array(grid.size).keys()];
        routes.push({ rules: r, context: c, start, paths: goals.map((goal) => finder.findPath(start, goal, context)) });
      }
    }
  }
  return { rules: MOVE_RULES.map((rules) => ({ ...rules, maxStepHeight: num(rules.maxStepHeight) })), contexts, fields, routes };
}

const WALK_RULES: WalkRules[] = [DEFAULT_WALK, { radius: 0.49, maxStepHeight: 0.2 }, { radius: 0.1, maxStepHeight: Infinity }];

function walks(grid: TileGrid) {
  const rng = createRng(`walks ${grid.width}x${grid.height}`);
  const blocked = [...new Set(Array.from({ length: 3 }, () => rng.nextInt(grid.size)))];
  const isBlocked = (tile: number): boolean => blocked.includes(tile);
  const spot = (): Spot => ({ x: rng.nextInt(grid.width * 8 + 8) / 8 - 0.5, y: rng.nextInt(grid.height * 8 + 8) / 8 - 0.5 });
  const lattice: Spot[] = [];
  for (let y = -0.75; y <= grid.height; y += 0.25) for (let x = -0.75; x <= grid.width; x += 0.25) lattice.push({ x, y });

  const stand = WALK_RULES.map((rules) => lattice.map((s) => [canStandAt(grid, s, () => false, rules) ? 1 : 0, canStandAt(grid, s, isBlocked, rules) ? 1 : 0]));
  const segments = Array.from({ length: 120 }, () => {
    const from = spot();
    const to = spot();
    return { from, to, clear: WALK_RULES.map((rules) => [segmentClear(grid, from, to, () => false, rules), segmentClear(grid, from, to, isBlocked, rules)]) };
  });
  const settles = Array.from({ length: 60 }, () => {
    const last = rng.nextInt(grid.size);
    const centre = grid.spotOf(last);
    const aimed = { x: centre.x + (rng.nextInt(9) - 4) / 10, y: centre.y + (rng.nextInt(9) - 4) / 10 };
    const others = rng.nextInt(2) === 0 ? [] : [{ x: centre.x + 0.3, y: centre.y }, spot()];
    return { last, aimed, others, settled: WALK_RULES.map((rules) => settleEnd(grid, last, aimed, isBlocked, others, rules)) };
  });

  const finder = new Pathfinder(grid);
  const smooth = Array.from({ length: 40 }, () => {
    const start = rng.nextInt(grid.size);
    const goal = rng.nextInt(grid.size);
    const path = finder.findPath(start, goal, { rules: rng.nextInt(2) === 0 ? DEFAULT_MOVEMENT : MOVE_RULES[1]! }) ?? [start];
    const ends = rng.nextInt(2) === 0 ? {} : { start: { x: grid.xOf(start) + 0.2, y: grid.yOf(start) - 0.1 }, end: { x: grid.xOf(path[path.length - 1]!) - 0.15, y: grid.yOf(path[path.length - 1]!) + 0.2 } };
    const lines = WALK_RULES.map((rules) => smoothPath(grid, path, isBlocked, rules, ends));
    const line = lines[0]!;
    const probe = spot();
    return {
      path,
      ends,
      lines,
      probe,
      nearest: nearestOnLine(line, probe),
      along: [-1, 0, 0.3, 1, 2.5, 7, 100].map((d) => pointAlong(line, d)),
      length: lineLength(line),
      cost: lineCost(grid, line),
      within: [0, 0.5, 1, 2, 3.75, 10, 1000].map((a) => distanceWithin(grid, line, a)),
      inside: [0.5, 1.5, 3, 10].map((radius) => distanceInside(line, { anchor: line[0]!, radius })),
      insideElsewhere: distanceInside(line, { anchor: { x: line[0]!.x + 1, y: line[0]!.y }, radius: 1.2 }),
      split: [-1, 0, 0.75, 2, 100].map((d) => splitLine(line, d)),
      inCircle: [0.5, 1, 2].map((r) => insideCircle(probe, { anchor: line[0]!, radius: r })),
    };
  });
  return { walkRules: WALK_RULES.map((rules) => ({ ...rules, maxStepHeight: num(rules.maxStepHeight) })), blocked, lattice, stand, segments, settles, smooth };
}

function golden() {
  const grids = { room: room(), custom: custom(), open: open(), corridor: corridor() };
  return {
    about: 'src/engine/grid played for the Rust port; written by src/engine/grid/grid.golden.test.ts. Infinity is null.',
    grids: Object.entries(grids).map(([name, grid]) => ({
      name,
      spec: specOf(grid),
      basics: basics(grid),
      sight: sight(grid),
      paths: paths(grid),
      walks: walks(grid),
    })),
    emptyLines: { nearest: nearestOnLine([], { x: 1, y: 2 }), along: pointAlong([], 3), length: lineLength([]), inside: distanceInside([], { anchor: { x: 0, y: 0 }, radius: 1 }), split: splitLine([], 1) },
    defaultPalette: DEFAULT_TERRAIN_TYPES.map((t) => t.id),
  };
}

describe('the grid, as the Rust server must run it', () => {
  it('is what server/fixtures/grid.json holds', () => {
    const now = JSON.parse(JSON.stringify(golden())) as unknown;
    if (process.env['UPDATE_GOLDEN'] === '1' || !existsSync(FIXTURE)) {
      mkdirSync(dirname(FIXTURE), { recursive: true });
      writeFileSync(FIXTURE, `${JSON.stringify(now)}\n`, 'utf8');
    }
    expect(JSON.parse(readFileSync(FIXTURE, 'utf8'))).toEqual(now);
  });
});
