import { describe, it, expect } from 'vitest';
import { TileGrid } from '../grid/grid';
import { canTarget, evaluateTarget, refusalMessage } from './targeting';

/** `.` floor  `#` wall  `c` light-cover terrain  digits 1-9 elevation. */
function makeGrid(rows: string[]): TileGrid {
  const grid = new TileGrid({ width: rows[0]!.length, height: rows.length });
  rows.forEach((row, y) => {
    [...row].forEach((char, x) => {
      const tile = grid.indexOf(x, y);
      if (char === '#') grid.setTerrainById(tile, 'wall');
      else if (char === 'c') grid.setTerrainById(tile, 'cover');
      else if (char >= '1' && char <= '9') grid.setHeight(tile, Number(char));
    });
  });
  return grid;
}

// A tight band table, so a small test grid still spans several bands.
const bandTiles = { melee: 1, veryClose: 2, close: 4, far: 8, veryFar: 12 };

describe('evaluateTarget', () => {
  it('reports distance, band and a clear line across open ground', () => {
    const grid = makeGrid(['.......']);
    const report = evaluateTarget(grid, grid.indexOf(0, 0), grid.indexOf(3, 0), 'far', {
      bandTiles,
    });
    expect(report).toMatchObject({
      distance: 3,
      band: 'close',
      bandLabel: 'Close',
      hasLineOfSight: true,
      partialObstruction: false,
      cover: 'none',
      coverDisadvantage: 0,
      ranged: true,
      refusal: null,
    });
  });

  it('treats an adjacent target as Melee and not ranged', () => {
    const grid = makeGrid(['..']);
    const report = evaluateTarget(grid, 0, 1, 'melee', { bandTiles });
    expect(report.band).toBe('melee');
    expect(report.ranged).toBe(false);
    expect(report.refusal).toBeNull();
  });

  it('refuses a target beyond the attack range', () => {
    const grid = makeGrid(['.......']);
    const report = evaluateTarget(grid, grid.indexOf(0, 0), grid.indexOf(6, 0), 'close', {
      bandTiles,
    });
    expect(report.band).toBe('far');
    expect(report.refusal).toBe('outOfRange');
  });

  it('lets a longer-ranged attack reach a closer target', () => {
    const grid = makeGrid(['.......']);
    expect(canTarget(makeGrid(['..']), 0, 1, 'far', { bandTiles })).toBe(true);
    expect(canTarget(grid, grid.indexOf(0, 0), grid.indexOf(3, 0), 'veryFar', { bandTiles })).toBe(
      true,
    );
  });

  it('refuses a shot through a wall', () => {
    const grid = makeGrid(['..#..']);
    const report = evaluateTarget(grid, grid.indexOf(0, 0), grid.indexOf(4, 0), 'far', {
      bandTiles,
    });
    expect(report.hasLineOfSight).toBe(false);
    expect(report.refusal).toBe('noLineOfSight');
  });

  it('gives a target standing in cover terrain one disadvantage die', () => {
    const grid = makeGrid(['....c']);
    const report = evaluateTarget(grid, grid.indexOf(0, 0), grid.indexOf(4, 0), 'far', {
      bandTiles,
    });
    expect(report.cover).toBe('cover');
    expect(report.coverDisadvantage).toBe(1);
    expect(report.refusal).toBeNull();
  });

  it('ignores cover against a melee attack', () => {
    const grid = makeGrid(['.c']);
    const report = evaluateTarget(grid, 0, 1, 'melee', { bandTiles });
    expect(report.ranged).toBe(false);
    expect(report.cover).toBe('none');
    expect(report.coverDisadvantage).toBe(0);
  });

  it('honours an explicit ranged flag over the band default', () => {
    const grid = makeGrid(['.c']);
    const thrown = evaluateTarget(grid, 0, 1, 'melee', { bandTiles, ranged: true });
    expect(thrown.cover).toBe('cover');
    expect(thrown.coverDisadvantage).toBe(1);
  });

  it('refuses an attacker or target that is not on the map', () => {
    const grid = makeGrid(['...']);
    expect(evaluateTarget(grid, 999, 1, 'far').refusal).toBe('noAttacker');
    expect(evaluateTarget(grid, 0, 999, 'far').refusal).toBe('noTarget');
  });

  it('measures range in a straight line, not along the movement path', () => {
    // A wall between them does not change the distance, only the line of sight.
    const grid = makeGrid(['...', '.#.', '...']);
    const report = evaluateTarget(grid, grid.indexOf(0, 0), grid.indexOf(2, 2), 'far', {
      bandTiles,
    });
    expect(report.distance).toBeCloseTo(Math.hypot(2, 2), 10);
    expect(report.band).toBe('close');
  });
});

describe('refusalMessage', () => {
  it('has a message for every refusal', () => {
    for (const refusal of [
      'noAttacker',
      'noTarget',
      'selfTarget',
      'outOfRange',
      'noLineOfSight',
    ] as const) {
      expect(refusalMessage(refusal)).toMatch(/\w/);
    }
  });
});
