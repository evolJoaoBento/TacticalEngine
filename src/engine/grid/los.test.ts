import { describe, it, expect } from 'vitest';
import { canBeTargetedByRanged } from '../rules/cover';
import { TileGrid } from './grid';
import { TerrainPalette, terrain } from './terrain';
import { DEFAULT_LINE_OF_SIGHT, coverBetween, hasLineOfSight, lineOfSight, traceLine } from './los';

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

const trace = (grid: TileGrid, from: number, to: number): [number, number][] => {
  const out: [number, number][] = [];
  traceLine(grid, from, to, (tile) => {
    out.push([grid.xOf(tile), grid.yOf(tile)]);
  });
  return out;
};

describe('traceLine', () => {
  it('walks a horizontal line, endpoints included', () => {
    const grid = makeGrid(['.....']);
    expect(trace(grid, grid.indexOf(0, 0), grid.indexOf(3, 0))).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
    ]);
  });

  it('walks a vertical line', () => {
    const grid = makeGrid(['.', '.', '.']);
    expect(trace(grid, grid.indexOf(0, 0), grid.indexOf(0, 2))).toEqual([
      [0, 0],
      [0, 1],
      [0, 2],
    ]);
  });

  it('walks backwards as well as forwards', () => {
    const grid = makeGrid(['.....']);
    expect(trace(grid, grid.indexOf(3, 0), grid.indexOf(0, 0))).toEqual([
      [3, 0],
      [2, 0],
      [1, 0],
      [0, 0],
    ]);
  });

  it('visits both tiles at an exact corner, so a diagonal gap does not leak', () => {
    const grid = makeGrid(['..', '..']);
    // The segment crosses the corner between (0,0) and (1,1) exactly.
    expect(trace(grid, grid.indexOf(0, 0), grid.indexOf(1, 1))).toEqual([
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ]);
  });

  it('is a single tile when both ends are the same', () => {
    const grid = makeGrid(['...']);
    expect(trace(grid, 1, 1)).toEqual([[1, 0]]);
  });

  it('stops early when the visitor returns false', () => {
    const grid = makeGrid(['.....']);
    const seen: number[] = [];
    traceLine(grid, grid.indexOf(0, 0), grid.indexOf(4, 0), (tile) => {
      seen.push(tile);
      return seen.length < 3;
    });
    expect(seen).toHaveLength(3);
  });

  it('visits nothing when an endpoint is off the grid', () => {
    const grid = makeGrid(['...']);
    expect(trace(grid, 0, 999)).toEqual([]);
    expect(trace(grid, -1, 0)).toEqual([]);
  });

  it('stays inside the grid for every pair of tiles', () => {
    const grid = makeGrid(['.....', '.....', '.....', '.....']);
    for (let a = 0; a < grid.size; a++) {
      for (let b = 0; b < grid.size; b++) {
        traceLine(grid, a, b, (tile) => {
          expect(grid.isTile(tile)).toBe(true);
        });
      }
    }
  });

  it('starts and ends on the endpoints for every pair of tiles', () => {
    const grid = makeGrid(['.....', '.....', '.....', '.....']);
    for (let a = 0; a < grid.size; a++) {
      for (let b = 0; b < grid.size; b++) {
        const seen = trace(grid, a, b).map(([x, y]) => grid.indexOf(x, y));
        expect(seen[0]).toBe(a);
        expect(seen[seen.length - 1]).toBe(b);
      }
    }
  });
});

describe('lineOfSight', () => {
  it('is clear across open floor', () => {
    const grid = makeGrid(['.....']);
    const result = lineOfSight(grid, grid.indexOf(0, 0), grid.indexOf(4, 0));
    expect(result).toEqual({ clear: true, blockers: 0, firstBlocker: -1 });
  });

  it('is blocked by a wall in between', () => {
    const grid = makeGrid(['..#..']);
    const result = lineOfSight(grid, grid.indexOf(0, 0), grid.indexOf(4, 0));
    expect(result.clear).toBe(false);
    expect(result.blockers).toBe(1);
    expect(result.firstBlocker).toBe(grid.indexOf(2, 0));
  });

  it('counts every blocker on the line', () => {
    const grid = makeGrid(['.#.#.']);
    expect(lineOfSight(grid, grid.indexOf(0, 0), grid.indexOf(4, 0)).blockers).toBe(2);
  });

  it('never lets the endpoints block their own line', () => {
    const grid = makeGrid(['#...#']);
    // Standing on sight-blocking terrain does not blind you.
    expect(hasLineOfSight(grid, grid.indexOf(0, 0), grid.indexOf(4, 0))).toBe(true);
  });

  it('is clear from a tile to itself', () => {
    const grid = makeGrid(['#']);
    expect(hasLineOfSight(grid, 0, 0)).toBe(true);
  });

  it('is blocked by ground that stands above both ends', () => {
    const grid = makeGrid(['.2.']);
    expect(hasLineOfSight(grid, grid.indexOf(0, 0), grid.indexOf(2, 0))).toBe(false);
  });

  it('is clear when both ends stand as high as the ground between them', () => {
    const grid = makeGrid(['212']);
    expect(hasLineOfSight(grid, grid.indexOf(0, 0), grid.indexOf(2, 0))).toBe(true);
  });

  it('lets high ground see over a rise that blocks the floor', () => {
    const grid = makeGrid(['.1.']);
    const viewer = grid.indexOf(0, 0);
    const target = grid.indexOf(2, 0);
    expect(hasLineOfSight(grid, viewer, target)).toBe(false);

    // Standing the viewer level with the rise clears the shot.
    grid.setHeight(viewer, 1);
    expect(hasLineOfSight(grid, viewer, target)).toBe(true);
  });

  it('is not clear when an endpoint is off the grid', () => {
    const grid = makeGrid(['...']);
    expect(hasLineOfSight(grid, 0, 999)).toBe(false);
  });

  it('is symmetric', () => {
    const grid = makeGrid(['.....', '..#..', '.....', '..2..']);
    for (let a = 0; a < grid.size; a++) {
      for (let b = 0; b < grid.size; b++) {
        expect(hasLineOfSight(grid, a, b)).toBe(hasLineOfSight(grid, b, a));
      }
    }
  });

  it('honours a project-specific blocking margin', () => {
    const grid = makeGrid(['.2.']);
    const lenient = { ...DEFAULT_LINE_OF_SIGHT, blockingHeightMargin: 3 };
    expect(hasLineOfSight(grid, grid.indexOf(0, 0), grid.indexOf(2, 0), lenient)).toBe(true);
  });
});

describe('coverBetween', () => {
  it('is none across open ground', () => {
    const grid = makeGrid(['.....']);
    expect(coverBetween(grid, grid.indexOf(0, 0), grid.indexOf(4, 0))).toBe('none');
  });

  it('is light behind one blocker and full behind two', () => {
    const one = makeGrid(['.#...']);
    expect(coverBetween(one, one.indexOf(0, 0), one.indexOf(4, 0))).toBe('light');
    const two = makeGrid(['.#.#.']);
    expect(coverBetween(two, two.indexOf(0, 0), two.indexOf(4, 0))).toBe('full');
  });

  it('comes from the target standing in cover terrain', () => {
    const grid = makeGrid(['....c']);
    expect(coverBetween(grid, grid.indexOf(0, 0), grid.indexOf(4, 0))).toBe('light');
  });

  it('takes the better of terrain cover and blockers rather than adding them', () => {
    const grid = makeGrid(['.#.#c']);
    // Two blockers give Full; the target's terrain gives Light. Full wins.
    expect(coverBetween(grid, grid.indexOf(0, 0), grid.indexOf(4, 0))).toBe('full');
  });

  it('honours Total Cover authored on the terrain', () => {
    const palette = new TerrainPalette([
      terrain('floor'),
      terrain('hideaway', { cover: 'total' }),
    ]);
    const grid = new TileGrid({ width: 3, height: 1, palette });
    const target = grid.indexOf(2, 0);
    grid.setTerrainById(target, 'hideaway');
    expect(coverBetween(grid, grid.indexOf(0, 0), target)).toBe('total');
    expect(canBeTargetedByRanged(coverBetween(grid, grid.indexOf(0, 0), target))).toBe(false);
  });

  it('never infers Total Cover from geometry alone', () => {
    const grid = makeGrid(['.####']);
    expect(coverBetween(grid, grid.indexOf(0, 0), grid.indexOf(4, 0))).toBe('full');
  });
});
