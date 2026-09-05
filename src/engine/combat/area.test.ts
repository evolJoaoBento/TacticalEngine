import { describe, it, expect } from 'vitest';
import { TileGrid } from '../grid/grid';
import {
  AREA_OF_EFFECT_BAND,
  isInArea,
  isLegalOrigin,
  moveUnderPressure,
  tilesInArea,
} from './area';

function makeGrid(rows: string[]): TileGrid {
  const grid = new TileGrid({ width: rows[0]!.length, height: rows.length });
  rows.forEach((row, y) => {
    [...row].forEach((char, x) => {
      if (char === '#') grid.setTerrainById(grid.indexOf(x, y), 'wall');
    });
  });
  return grid;
}

const bandTiles = { melee: 1, veryClose: 2, close: 4, far: 8, veryFar: 12 };

describe('area of effect', () => {
  it('spreads Very Close from the origin by default', () => {
    expect(AREA_OF_EFFECT_BAND).toBe('veryClose');
  });

  it('covers tiles within the radius and no further', () => {
    const grid = makeGrid(['.........', '.........', '.........']);
    const origin = grid.indexOf(4, 1);
    expect(isInArea(grid, origin, origin, { bandTiles })).toBe(true);
    expect(isInArea(grid, origin, grid.indexOf(6, 1), { bandTiles })).toBe(true); // 2 tiles
    expect(isInArea(grid, origin, grid.indexOf(7, 1), { bandTiles })).toBe(false); // 3 tiles
  });

  it('accepts a wider radius when an effect states one', () => {
    const grid = makeGrid(['.........']);
    const origin = grid.indexOf(0, 0);
    expect(isInArea(grid, origin, grid.indexOf(4, 0), { bandTiles })).toBe(false);
    expect(isInArea(grid, origin, grid.indexOf(4, 0), { bandTiles, radius: 'close' })).toBe(true);
  });

  it('lists every covered tile, bounded by the grid edges', () => {
    const grid = makeGrid(['.....', '.....', '.....']);
    const tiles = tilesInArea(grid, grid.indexOf(0, 0), { bandTiles });
    expect(tiles).toContain(grid.indexOf(0, 0));
    expect(tiles).toContain(grid.indexOf(2, 0));
    expect(tiles).not.toContain(grid.indexOf(3, 0));
    for (const tile of tiles) expect(grid.isTile(tile)).toBe(true);
  });

  it('ignores line of sight unless an effect asks for it', () => {
    const grid = makeGrid(['...', '.#.', '...']);
    const origin = grid.indexOf(0, 1);
    const behindWall = grid.indexOf(2, 1);
    expect(isInArea(grid, origin, behindWall, { bandTiles })).toBe(true);
    expect(
      isInArea(grid, origin, behindWall, { bandTiles, requireLineOfSight: true }),
    ).toBe(false);
  });

  it('requires the origin to sit within the effect range', () => {
    const grid = makeGrid(['.........']);
    const caster = grid.indexOf(0, 0);
    expect(isLegalOrigin(grid, caster, caster, 'melee', { bandTiles })).toBe(true);
    expect(isLegalOrigin(grid, caster, grid.indexOf(4, 0), 'close', { bandTiles })).toBe(true);
    expect(isLegalOrigin(grid, caster, grid.indexOf(6, 0), 'close', { bandTiles })).toBe(false);
    expect(isLegalOrigin(grid, caster, grid.indexOf(6, 0), 'far', { bandTiles })).toBe(true);
  });

  it('refuses tiles that are not on the map', () => {
    const grid = makeGrid(['...']);
    expect(isInArea(grid, 0, 999, { bandTiles })).toBe(false);
    expect(isInArea(grid, 999, 0, { bandTiles })).toBe(false);
    expect(isLegalOrigin(grid, 0, 999, 'far', { bandTiles })).toBe(false);
    expect(tilesInArea(grid, 999, { bandTiles })).toEqual([]);
  });
});

describe('movement under pressure', () => {
  const grid = makeGrid(['..................']);
  const from = grid.indexOf(0, 0);

  it('lets a PC reposition within Close range free as part of an action roll', () => {
    expect(
      moveUnderPressure(grid, 'pc', from, grid.indexOf(4, 0), { bandTiles, withAction: true }),
    ).toBe('free');
  });

  it('makes a PC roll Agility to move without an action roll', () => {
    expect(moveUnderPressure(grid, 'pc', from, grid.indexOf(4, 0), { bandTiles })).toBe(
      'agilityRoll',
    );
  });

  it('makes a PC roll Agility to move farther than Close, action or not', () => {
    const far = grid.indexOf(8, 0);
    expect(moveUnderPressure(grid, 'pc', from, far, { bandTiles, withAction: true })).toBe(
      'agilityRoll',
    );
    expect(moveUnderPressure(grid, 'pc', from, far, { bandTiles })).toBe('agilityRoll');
  });

  it('lets an adversary move within Close free and Very Far as an action', () => {
    expect(moveUnderPressure(grid, 'adversary', from, grid.indexOf(4, 0), { bandTiles })).toBe(
      'free',
    );
    expect(moveUnderPressure(grid, 'adversary', from, grid.indexOf(10, 0), { bandTiles })).toBe(
      'action',
    );
  });

  it('is free to stay put', () => {
    expect(moveUnderPressure(grid, 'pc', from, from, { bandTiles })).toBe('free');
    expect(moveUnderPressure(grid, 'adversary', from, from, { bandTiles })).toBe('free');
  });

  it('is out of reach beyond Very Far', () => {
    const wide = makeGrid([new Array(40).fill('.').join('')]);
    const start = wide.indexOf(0, 0);
    expect(moveUnderPressure(wide, 'pc', start, wide.indexOf(30, 0), { bandTiles })).toBe(
      'outOfReach',
    );
    expect(moveUnderPressure(wide, 'adversary', start, wide.indexOf(30, 0), { bandTiles })).toBe(
      'outOfReach',
    );
  });

  it('is out of reach when a tile does not exist', () => {
    expect(moveUnderPressure(grid, 'pc', from, 999, { bandTiles })).toBe('outOfReach');
  });
});
