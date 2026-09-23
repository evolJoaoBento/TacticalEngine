/**
 * Movement is a distance, not a count of squares: it is spent along the line a body actually
 * walks, a walk it does not cover stops on that line where it runs out - to a fraction of a
 * tile - and the ground lit for it is what that line reaches.
 */

import { describe, expect, it } from 'vitest';
import { TileGrid } from '../grid/grid';
import { DEFAULT_MOVEMENT, Pathfinder } from '../grid/pathfinding';
import { distanceWithin, lineCost, lineLength, splitLine } from '../grid/walk';
import { Party } from './party';
import { SceneState, createAdversaryEntity, createPartyEntity } from './state';

const EIGHT_WAY = { ...DEFAULT_MOVEMENT, diagonals: true, diagonalCostMultiplier: Math.SQRT2 };

/** An open field with Quim at (1, 4) and four tiles of movement in a fight. */
function field(width = 14, height = 9): { grid: TileGrid; state: SceneState; party: Party } {
  const grid = new TileGrid({ width, height });
  const state = new SceneState({ id: 'field' }, grid);
  state.addEntity(createPartyEntity('kara', 'sentinel', grid.indexOf(1, 4)));
  return { grid, state, party: new Party(state, new Pathfinder(grid), { combatReach: 4, rules: EIGHT_WAY }) };
}

describe('what a line costs to walk', () => {
  it('is its length over ordinary ground, and more through what costs more', () => {
    const { grid } = field();
    const line = [{ x: 1, y: 4 }, { x: 4, y: 8 }];
    expect(lineCost(grid, line)).toBeCloseTo(5, 6);
    for (let x = 0; x < grid.width; x++) grid.setTerrainById(grid.indexOf(x, 2), 'difficult');
    // Straight down through one row of difficult ground: that tile of the way counts twice.
    expect(lineCost(grid, [{ x: 3, y: 0 }, { x: 3, y: 4 }])).toBeCloseTo(5, 6);
    expect(lineLength([{ x: 3, y: 0 }, { x: 3, y: 4 }])).toBe(4);
  });

  it('runs out part of the way along, and the line is cut there', () => {
    const { grid } = field();
    const line = [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 5 }];
    expect(distanceWithin(grid, line, 4.5)).toBeCloseTo(4.5, 6);
    expect(distanceWithin(grid, line, 40)).toBeCloseTo(8, 6);
    const { within, beyond } = splitLine(line, 4.5);
    expect(within).toEqual([{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 1.5 }]);
    expect(beyond).toEqual([{ x: 3, y: 1.5 }, { x: 3, y: 5 }]);
    expect(splitLine(line, 99).beyond).toEqual([]);
    // Slower ground uses the allowance up sooner.
    for (let y = 0; y < grid.height; y++) grid.setTerrainById(grid.indexOf(2, y), 'difficult');
    expect(distanceWithin(grid, [{ x: 0, y: 0 }, { x: 6, y: 0 }], 4)).toBeCloseTo(3, 6);
  });
});

describe('a walk in a fight', () => {
  it('covers what the straight line reaches, though the squares under it count to more', () => {
    const { grid, party } = field();
    // Four across and one down: 4.41 by squares, 4.12 as the body walks it. With 4.2 to spend it is covered.
    const there = grid.indexOf(5, 5);
    const tight = new Party(party['state'], new Pathfinder(grid), { combatReach: 4.2, rules: EIGHT_WAY });
    expect(tight.reachable('kara', { inCombat: true }).canReach(there)).toBe(false);
    const walk = tight.planWalk('kara', there, { inCombat: true })!;
    expect(walk.beyond).toBeUndefined();
    expect(lineCost(grid, walk.route)).toBeCloseTo(Math.hypot(4, 1), 6);
    expect(tight.covered('kara', { inCombat: true }).canReach(there)).toBe(true);
    expect(tight.covered('kara', { inCombat: true }).tiles()).toContain(there);
    // And nothing the count of squares allowed has been taken away.
    for (const tile of tight.reachable('kara', { inCombat: true }).clone().tiles()) expect(tight.covered('kara', { inCombat: true }).canReach(tile)).toBe(true);
  });

  it('is refused past its movement unless asked to go as far as it can', () => {
    const { grid, party } = field();
    expect(party.planWalk('kara', grid.indexOf(11, 4), { inCombat: true })).toBeNull();
    expect(party.walkTo('kara', grid.indexOf(11, 4), { inCombat: true })).toBeNull();
  });

  it('stops where the movement runs out - on the line, part-way into a tile - and says what was left', () => {
    const { grid, state, party } = field();
    const walk = party.walkTo('kara', grid.indexOf(11, 6), { inCombat: true, short: true, at: { x: 11.2, y: 6.3 } })!;
    const end = walk.route.at(-1)!;
    expect(lineLength(walk.route)).toBeCloseTo(4, 6);
    // Not a tile's centre, and not the last lit square either: four tiles along the line to where she was sent.
    const along = Math.hypot(10.2, 2.3);
    expect(end.x).toBeCloseTo(1 + (10.2 * 4) / along, 6);
    expect(end.y).toBeCloseTo(4 + (2.3 * 4) / along, 6);
    expect(Number.isInteger(end.x)).toBe(false);
    expect(state.entity('kara')!.at).toEqual(end);
    expect(state.entity('kara')!.tile).toBe(grid.tileAtSpot(end.x, end.y));
    expect(walk.path.at(-1)).toBe(state.entity('kara')!.tile);
    expect(walk.beyond![0]).toEqual(end);
    expect(walk.beyond!.at(-1)).toEqual({ x: 11.2, y: 6.3 });
  });

  it('goes less far over ground that costs more', () => {
    const { grid, party } = field();
    for (let y = 0; y < grid.height; y++) for (let x = 3; x < grid.width; x++) grid.setTerrainById(grid.indexOf(x, y), 'difficult');
    const walk = party.planWalk('kara', grid.indexOf(11, 4), { inCombat: true, short: true })!;
    // A tile and a half of plain going, and the other two and a half of movement buy a tile and a quarter of the slow.
    expect(walk.route.at(-1)!.x).toBeCloseTo(1 + 1.5 + 1.25, 6);
  });

  it('backs up from where it ran out to where a body can stand clear of somebody', () => {
    const { grid, state, party } = field();
    state.addEntity(createAdversaryEntity('husk', 'husk', grid.indexOf(5, 4), { hitPoints: 3, stress: 2 }));
    const walk = party.planWalk('kara', grid.indexOf(9, 4), { inCombat: true, short: true })!;
    const end = walk.route.at(-1)!;
    expect(Math.hypot(end.x - 5, end.y - 4)).toBeGreaterThanOrEqual(0.7 - 1e-9);
    expect(lineCost(grid, walk.route)).toBeLessThanOrEqual(4 + 1e-9);
  });

  it('out of a fight nobody counts, and nothing is cut', () => {
    const { grid, party } = field();
    const walk = party.planWalk('kara', grid.indexOf(12, 8), { short: true })!;
    expect(walk.beyond).toBeUndefined();
    expect(walk.route.at(-1)).toEqual({ x: 12, y: 8 });
  });
});

describe('a step within their own tile', () => {
  it('is a walk: straight to the spot, with the same tile under them at the end of it', () => {
    const { grid, state, party } = field();
    const tile = state.entity('kara')!.tile;
    const walk = party.walkTo('kara', tile, { at: { x: 1.3, y: 3.8 } })!;
    expect(walk.path).toEqual([tile]);
    expect(walk.route).toEqual([{ x: 1, y: 4 }, { x: 1.3, y: 3.8 }]);
    expect(state.entity('kara')!.at).toEqual({ x: 1.3, y: 3.8 });
    expect(state.entity('kara')!.tile).toBe(tile);
    // And again from there, a tenth of a tile: there is no least step but the one too small to see.
    expect(party.walkTo('kara', tile, { inCombat: true, short: true, at: { x: 1.4, y: 3.8 } })!.route.at(-1)).toEqual({ x: 1.4, y: 3.8 });
    expect(grid.tileAtSpot(1.4, 3.8)).toBe(tile);
  });

  it('is nothing with no spot aimed at, or one already under their feet', () => {
    const { state, party } = field();
    const tile = state.entity('kara')!.tile;
    expect(party.planWalk('kara', tile)).toBeNull();
    expect(party.planWalk('kara', tile, { at: { x: 1.01, y: 4.02 } })).toBeNull();
  });

  it('stops short of a wall and keeps clear of whoever is beside them', () => {
    const { grid, state, party } = field();
    grid.setTerrainById(grid.indexOf(0, 4), 'wall');
    const tile = state.entity('kara')!.tile;
    // Towards the wall: as far as a body goes, which is not into it.
    const west = party.planWalk('kara', tile, { at: { x: 0.55, y: 4 } })!;
    expect(west.route.at(-1)!.x).toBeGreaterThanOrEqual(0.5 + 0.35 - 1e-9);
    state.addEntity(createAdversaryEntity('husk', 'husk', grid.indexOf(2, 4), { hitPoints: 3, stress: 2 }));
    const east = party.planWalk('kara', tile, { inCombat: true, at: { x: 1.45, y: 4 } })!;
    expect(2 - east.route.at(-1)!.x).toBeGreaterThanOrEqual(0.7 - 1e-9);
  });
});
