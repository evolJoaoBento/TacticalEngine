import { describe, it, expect } from 'vitest';
import { TileGrid } from './grid';
import { Pathfinder, tracePath, DEFAULT_MOVEMENT } from './pathfinding';
import { canStandAt, lineLength, nearestOnLine, segmentClear, settleEnd, smoothPath } from './walk';

function makeGrid(rows: string[]): TileGrid {
  const grid = new TileGrid({ width: rows[0]!.length, height: rows.length });
  rows.forEach((row, y) => {
    [...row].forEach((char, x) => {
      const tile = grid.indexOf(x, y);
      if (char === '#') grid.setTerrainById(tile, 'wall');
      else if (char >= '1' && char <= '9') grid.setHeight(tile, Number(char));
    });
  });
  return grid;
}

const rules = { diagonals: true, maxStepHeight: 1, allowCornerCutting: false, diagonalCostMultiplier: 1.5 };

function pathAcross(grid: TileGrid, from: number, to: number): number[] {
  const field = new Pathfinder(grid).reachable(from, Infinity, { rules: { ...DEFAULT_MOVEMENT, ...rules } });
  return tracePath(field, to)!;
}

describe('standing', () => {
  it('stands anywhere on open floor, and not with its body over a wall or off the map', () => {
    const grid = makeGrid(['.....', '..#..', '.....']);
    expect(canStandAt(grid, { x: 1, y: 0 })).toBe(true);
    expect(canStandAt(grid, { x: 1.2, y: 0.2 })).toBe(true);
    // Centre on the floor beside the wall, rim over it - or over its corner.
    expect(canStandAt(grid, { x: 1.3, y: 1 })).toBe(false);
    expect(canStandAt(grid, { x: 1.4, y: 0.4 })).toBe(false);
    // Rim off the map's edge.
    expect(canStandAt(grid, { x: -0.3, y: 0 })).toBe(false);
    expect(canStandAt(grid, { x: 0, y: 0 })).toBe(true);
    expect(canStandAt(grid, { x: 2, y: 1 })).toBe(false);
  });

  it('does not stand where something else already does, nor hang over a ledge', () => {
    const grid = makeGrid(['..3..']);
    expect(canStandAt(grid, { x: 1, y: 0 }, (tile) => tile === 1)).toBe(false);
    expect(canStandAt(grid, { x: 1.7, y: 0 })).toBe(false);
    expect(canStandAt(grid, { x: 2.7, y: 0 })).toBe(false);
    // Its body kept inside its own tile, a creature may stand near the edge.
    expect(canStandAt(grid, { x: 3.2, y: 0 })).toBe(true);
    expect(canStandAt(grid, { x: 2, y: 0 })).toBe(true);
  });
});

describe('a straight segment', () => {
  it('is clear across open floor and not through a wall', () => {
    const grid = makeGrid(['.....', '..#..', '.....']);
    expect(segmentClear(grid, { x: 0, y: 0 }, { x: 4, y: 0 })).toBe(true);
    expect(segmentClear(grid, { x: 0, y: 1 }, { x: 4, y: 1 })).toBe(false);
    // A diagonal that passes the wall's corner too closely is not clear either.
    expect(segmentClear(grid, { x: 1, y: 0 }, { x: 3, y: 2 })).toBe(false);
    expect(segmentClear(grid, { x: 0, y: 0 }, { x: 4, y: 2 })).toBe(false);
  });

  it('climbs a step but not a cliff', () => {
    expect(segmentClear(makeGrid(['..1..']), { x: 0, y: 0 }, { x: 4, y: 0 })).toBe(true);
    expect(segmentClear(makeGrid(['..3..']), { x: 0, y: 0 }, { x: 4, y: 0 })).toBe(false);
  });
});

describe('smoothing a path', () => {
  it('pulls a path across open floor into one straight line', () => {
    const grid = makeGrid(['......', '......', '......']);
    const path = pathAcross(grid, grid.indexOf(0, 0), grid.indexOf(5, 2));
    expect(path.length).toBeGreaterThan(2);
    const line = smoothPath(grid, path);
    expect(line).toEqual([
      { x: 0, y: 0 },
      { x: 5, y: 2 },
    ]);
  });

  it('keeps the bend round a wall, and only that bend', () => {
    const grid = makeGrid(['......', '.####.', '......']);
    const path = pathAcross(grid, grid.indexOf(0, 2), grid.indexOf(4, 0));
    const line = smoothPath(grid, path);
    expect(line[0]).toEqual({ x: 0, y: 2 });
    expect(line[line.length - 1]).toEqual({ x: 4, y: 0 });
    expect(line.length).toBeLessThan(path.length);
    expect(line.length).toBeGreaterThanOrEqual(3);
    // Every leg of the line is clear on its own.
    for (let i = 0; i + 1 < line.length; i++) expect(segmentClear(grid, line[i]!, line[i + 1]!)).toBe(true);
  });

  it('starts from where the creature stands and ends where the walk was aimed', () => {
    const grid = makeGrid(['......', '......', '......']);
    const path = pathAcross(grid, grid.indexOf(0, 0), grid.indexOf(5, 1));
    const line = smoothPath(grid, path, undefined, undefined, { start: { x: 0.3, y: 0.2 }, end: { x: 4.6, y: 1.3 } });
    expect(line[0]).toEqual({ x: 0.3, y: 0.2 });
    expect(line[line.length - 1]).toEqual({ x: 4.6, y: 1.3 });
    expect(lineLength(line)).toBeCloseTo(Math.hypot(4.3, 1.1), 10);
  });

  it('is empty for no path and a point for a path of one', () => {
    const grid = makeGrid(['...']);
    expect(smoothPath(grid, [])).toEqual([]);
    expect(smoothPath(grid, [1])).toEqual([{ x: 1, y: 0 }]);
  });
});

describe('where a walk ends', () => {
  it('ends at the spot aimed at when a creature can stand there', () => {
    const grid = makeGrid(['.....', '.....']);
    expect(settleEnd(grid, grid.indexOf(2, 1), { x: 2.3, y: 0.8 })).toEqual({ x: 2.3, y: 0.8 });
  });

  it('pulls back towards the centre from a spot against a wall, another creature, or in the wrong tile', () => {
    const grid = makeGrid(['.....', '..#..', '.....']);
    // Aimed at the floor beside the wall, body over it: back until the body clears.
    const beside = settleEnd(grid, grid.indexOf(2, 0), { x: 2, y: 0.4 });
    expect(beside.y).toBeLessThan(0.4);
    expect(canStandAt(grid, beside)).toBe(true);
    // Somebody standing just past the aim: back until two bodies fit.
    const crowded = settleEnd(grid, grid.indexOf(2, 0), { x: 2.4, y: 0 }, undefined, [{ x: 3, y: 0 }]);
    expect(Math.hypot(crowded.x - 3, crowded.y)).toBeGreaterThanOrEqual(0.7);
    expect(crowded.x).toBeLessThan(2.4);
    // A spot in another tile altogether is the centre.
    expect(settleEnd(grid, grid.indexOf(2, 0), { x: 3.4, y: 0 })).toEqual({ x: 2, y: 0 });
  });
});

describe('the nearest point on a line', () => {
  it('projects onto the leg it is closest to, clamped to its ends', () => {
    const line = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 3 },
    ];
    expect(nearestOnLine(line, { x: 2, y: 1 })).toEqual({ x: 2, y: 0 });
    expect(nearestOnLine(line, { x: 5, y: 2 })).toEqual({ x: 4, y: 2 });
    expect(nearestOnLine(line, { x: -2, y: 1 })).toEqual({ x: 0, y: 0 });
    expect(nearestOnLine([{ x: 1, y: 1 }], { x: 5, y: 5 })).toEqual({ x: 1, y: 1 });
    expect(nearestOnLine([], { x: 5, y: 5 })).toEqual({ x: 5, y: 5 });
  });
});
