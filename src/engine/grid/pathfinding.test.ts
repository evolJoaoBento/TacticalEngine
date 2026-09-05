import { describe, it, expect } from 'vitest';
import { NO_TILE, TileGrid } from './grid';
import { DEFAULT_MOVEMENT, Pathfinder, tracePath, type MovementRules } from './pathfinding';

/**
 * Build a grid from ASCII art, one character per tile:
 *   `.` floor   `#` wall   `~` difficult terrain   digits 1-9 elevation
 */
function makeGrid(rows: string[]): TileGrid {
  const height = rows.length;
  const width = rows[0]!.length;
  const grid = new TileGrid({ width, height });
  rows.forEach((row, y) => {
    expect(row).toHaveLength(width);
    [...row].forEach((char, x) => {
      const tile = grid.indexOf(x, y);
      if (char === '#') grid.setTerrainById(tile, 'wall');
      else if (char === '~') grid.setTerrainById(tile, 'difficult');
      else if (char >= '1' && char <= '9') grid.setHeight(tile, Number(char));
    });
  });
  return grid;
}

const diagonal: MovementRules = { ...DEFAULT_MOVEMENT, diagonals: true };
/** Diagonals priced below an orthogonal step — the case that breaks a naive heuristic. */
const cheapDiagonal: MovementRules = { ...diagonal, diagonalCostMultiplier: 0.75 };

describe('Pathfinder.reachable', () => {
  it('costs one movement point per orthogonal step', () => {
    const grid = makeGrid(['.....', '.....', '.....']);
    const field = new Pathfinder(grid).reachable(grid.indexOf(0, 0), 3);
    expect(field.costTo(grid.indexOf(0, 0))).toBe(0);
    expect(field.costTo(grid.indexOf(2, 0))).toBe(2);
    expect(field.costTo(grid.indexOf(1, 1))).toBe(2);
    expect(field.costTo(grid.indexOf(3, 0))).toBe(3);
  });

  it('stops at the budget', () => {
    const grid = makeGrid(['.....', '.....', '.....']);
    const field = new Pathfinder(grid).reachable(grid.indexOf(0, 0), 2);
    expect(field.canReach(grid.indexOf(2, 0))).toBe(true);
    expect(field.canReach(grid.indexOf(3, 0))).toBe(false);
    expect(field.costTo(grid.indexOf(3, 0))).toBe(Infinity);
  });

  it('charges 2 for difficult terrain', () => {
    const grid = makeGrid(['.~..']);
    const field = new Pathfinder(grid).reachable(grid.indexOf(0, 0), 10);
    expect(field.costTo(grid.indexOf(1, 0))).toBe(2);
    expect(field.costTo(grid.indexOf(2, 0))).toBe(3);
  });

  it('routes around walls', () => {
    const grid = makeGrid(['..#..', '..#..', '.....']);
    const pathfinder = new Pathfinder(grid);
    const field = pathfinder.reachable(grid.indexOf(0, 0), 20);
    expect(field.canReach(grid.indexOf(2, 0))).toBe(false);
    // Down two, across four, back up two.
    expect(field.costTo(grid.indexOf(4, 0))).toBe(8);
  });

  it('refuses a step that climbs more than one level', () => {
    const grid = makeGrid(['.1..', '.2..', '.3..']);
    const field = new Pathfinder(grid).reachable(grid.indexOf(0, 0), 20);
    expect(field.canReach(grid.indexOf(1, 0))).toBe(true); // 0 -> 1
    expect(field.canReach(grid.indexOf(1, 1))).toBe(true); // reached from (1,0), 1 -> 2
    expect(field.canReach(grid.indexOf(1, 2))).toBe(true); // 2 -> 3
    // A wall of height 3 next to height 0 is not climbable directly.
    const steep = makeGrid(['.3', '..']);
    const steepField = new Pathfinder(steep).reachable(steep.indexOf(0, 0), 20);
    expect(steepField.canReach(steep.indexOf(1, 0))).toBe(false);
  });

  it('ignores elevation when the rules say to', () => {
    const grid = makeGrid(['.9']);
    const field = new Pathfinder(grid).reachable(grid.indexOf(0, 0), 10, {
      rules: { ...DEFAULT_MOVEMENT, maxStepHeight: Infinity },
    });
    expect(field.canReach(grid.indexOf(1, 0))).toBe(true);
  });

  it('treats blocked tiles as impassable without changing the grid', () => {
    const grid = makeGrid(['...', '...', '...']);
    const occupied = new Set([grid.indexOf(1, 0), grid.indexOf(1, 1), grid.indexOf(1, 2)]);
    const field = new Pathfinder(grid).reachable(grid.indexOf(0, 1), 20, {
      isBlocked: (tile) => occupied.has(tile),
    });
    expect(field.canReach(grid.indexOf(2, 1))).toBe(false);
    expect(grid.isPassable(grid.indexOf(1, 1))).toBe(true); // grid untouched
  });

  it('adds extraCost on top of the terrain cost', () => {
    const grid = makeGrid(['...']);
    const field = new Pathfinder(grid).reachable(grid.indexOf(0, 0), 20, {
      extraCost: (tile) => (tile === grid.indexOf(1, 0) ? 4 : 0),
    });
    expect(field.costTo(grid.indexOf(1, 0))).toBe(5);
    expect(field.costTo(grid.indexOf(2, 0))).toBe(6);
  });

  it('never reports an unreached tile as reachable, even with an unbounded budget', () => {
    const grid = makeGrid(['.#.']);
    const field = new Pathfinder(grid).reachable(grid.indexOf(0, 0), Infinity);
    expect(field.canReach(grid.indexOf(2, 0))).toBe(false);
    expect(field.canReach(grid.indexOf(0, 0))).toBe(true);
  });

  it('returns an empty field for a start tile that does not exist', () => {
    const grid = makeGrid(['...']);
    const field = new Pathfinder(grid).reachable(999, 5);
    expect(field.tiles()).toEqual([]);
  });

  it('lists reachable tiles cheapest first', () => {
    const grid = makeGrid(['...', '...']);
    const field = new Pathfinder(grid).reachable(grid.indexOf(0, 0), 2);
    const tiles = field.tiles();
    expect(tiles[0]).toBe(grid.indexOf(0, 0));
    const costs = tiles.map((t) => field.costTo(t));
    expect([...costs].sort((a, b) => a - b)).toEqual(costs);
  });

  describe('diagonal movement', () => {
    it('costs 1.5x for a diagonal step', () => {
      const grid = makeGrid(['..', '..']);
      const field = new Pathfinder(grid).reachable(grid.indexOf(0, 0), 10, { rules: diagonal });
      expect(field.costTo(grid.indexOf(1, 1))).toBe(1.5);
    });

    it('refuses to cut a blocked corner by default', () => {
      const grid = makeGrid(['.#', '#.']);
      const field = new Pathfinder(grid).reachable(grid.indexOf(0, 0), 10, { rules: diagonal });
      expect(field.canReach(grid.indexOf(1, 1))).toBe(false);
    });

    it('cuts corners when the rules allow it', () => {
      const grid = makeGrid(['.#', '#.']);
      const field = new Pathfinder(grid).reachable(grid.indexOf(0, 0), 10, {
        rules: { ...diagonal, allowCornerCutting: true },
      });
      expect(field.canReach(grid.indexOf(1, 1))).toBe(true);
    });

    it('treats a corner blocked by a creature the same as a wall', () => {
      const grid = makeGrid(['..', '..']);
      const blocked = new Set([grid.indexOf(1, 0), grid.indexOf(0, 1)]);
      const field = new Pathfinder(grid).reachable(grid.indexOf(0, 0), 10, {
        rules: diagonal,
        isBlocked: (tile) => blocked.has(tile),
      });
      expect(field.canReach(grid.indexOf(1, 1))).toBe(false);
    });
  });
});

describe('tracePath', () => {
  it('walks back from a destination to the start', () => {
    const grid = makeGrid(['....']);
    const field = new Pathfinder(grid).reachable(grid.indexOf(0, 0), 10);
    expect(tracePath(field, grid.indexOf(3, 0))).toEqual([0, 1, 2, 3]);
  });

  it('is just the start tile when the destination is the start', () => {
    const grid = makeGrid(['....']);
    const field = new Pathfinder(grid).reachable(grid.indexOf(1, 0), 10);
    expect(tracePath(field, grid.indexOf(1, 0))).toEqual([grid.indexOf(1, 0)]);
  });

  it('is null for an unreachable destination', () => {
    const grid = makeGrid(['.#.']);
    const field = new Pathfinder(grid).reachable(grid.indexOf(0, 0), 10);
    expect(tracePath(field, grid.indexOf(2, 0))).toBeNull();
  });

  it('produces a path whose steps are all adjacent', () => {
    const grid = makeGrid(['.....', '.###.', '.....']);
    const field = new Pathfinder(grid).reachable(grid.indexOf(0, 0), 30);
    const path = tracePath(field, grid.indexOf(4, 2))!;
    expect(path[0]).toBe(grid.indexOf(0, 0));
    expect(path[path.length - 1]).toBe(grid.indexOf(4, 2));
    for (let i = 1; i < path.length; i++) {
      expect(grid.manhattanDistance(path[i - 1]!, path[i]!)).toBe(1);
    }
  });
});

describe('Pathfinder.findPath', () => {
  it('finds a shortest route and agrees with Dijkstra on its cost', () => {
    const grid = makeGrid(['.....', '.###.', '.....']);
    const pathfinder = new Pathfinder(grid);
    const start = grid.indexOf(0, 0);
    const goal = grid.indexOf(4, 2);

    const path = pathfinder.findPath(start, goal)!;
    expect(path[0]).toBe(start);
    expect(path[path.length - 1]).toBe(goal);

    const field = pathfinder.reachable(start, Infinity);
    expect(path.length - 1).toBe(field.costTo(goal));
  });

  it('prefers a longer route over difficult terrain', () => {
    // Straight across costs 1 + 2 + 2 + 1; around the top costs 6.
    const grid = makeGrid(['.....', '.~~~.', '.....']);
    const pathfinder = new Pathfinder(grid);
    const path = pathfinder.findPath(grid.indexOf(0, 1), grid.indexOf(4, 1))!;
    expect(path.some((tile) => grid.terrainAt(tile).id === 'difficult')).toBe(false);
    expect(path).toHaveLength(7);
  });

  it('is a single tile when start and goal are the same', () => {
    const grid = makeGrid(['...']);
    expect(new Pathfinder(grid).findPath(1, 1)).toEqual([1]);
  });

  it('is null when the goal is walled off, impassable, blocked or off-grid', () => {
    const grid = makeGrid(['.#.']);
    const pathfinder = new Pathfinder(grid);
    expect(pathfinder.findPath(grid.indexOf(0, 0), grid.indexOf(2, 0))).toBeNull();
    expect(pathfinder.findPath(grid.indexOf(0, 0), grid.indexOf(1, 0))).toBeNull();
    expect(pathfinder.findPath(grid.indexOf(0, 0), 999)).toBeNull();

    const open = makeGrid(['...']);
    const blockedGoal = new Pathfinder(open).findPath(0, 2, { isBlocked: (t) => t === 2 });
    expect(blockedGoal).toBeNull();
  });

  it('stays optimal when diagonals are cheaper than orthogonal steps', () => {
    // Found by searching random maps against an unfixed heuristic: with a
    // diagonal multiplier below 1 the fewest-steps estimate can exceed the true
    // remaining cost, and A* then pops the goal before a cheaper route to it is
    // final. On this map it returned 9.75 where 9.5 was available.
    const grid = makeGrid([
      '.~.~#~.',
      '.....#~',
      '.~~~.~.',
      '#..~...',
      '~.#~#~.',
      '.~...~#',
      '~~.#...',
    ]);
    const pathfinder = new Pathfinder(grid);
    const start = grid.indexOf(0, 0);
    const goal = grid.indexOf(6, 6);

    const path = pathfinder.findPath(start, goal, { rules: cheapDiagonal })!;
    let cost = 0;
    for (let i = 1; i < path.length; i++) {
      const step = grid.costAt(path[i]!);
      cost += grid.isDiagonalStep(path[i - 1]!, path[i]!)
        ? step * cheapDiagonal.diagonalCostMultiplier
        : step;
    }
    const field = pathfinder.reachable(start, Infinity, { rules: cheapDiagonal });
    expect(cost).toBeCloseTo(9.5, 10);
    expect(cost).toBeCloseTo(field.costTo(goal), 10);
  });

  it('matches Dijkstra costs over many random maps', () => {
    // A* with an inadmissible heuristic silently returns non-optimal paths, so
    // this compares it against the exhaustive search on generated terrain.
    let seed = 12345;
    const random = (): number => {
      seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };

    for (let trial = 0; trial < 40; trial++) {
      const rows: string[] = [];
      for (let y = 0; y < 9; y++) {
        let row = '';
        for (let x = 0; x < 9; x++) {
          const r = random();
          row += r < 0.2 ? '#' : r < 0.4 ? '~' : '.';
        }
        rows.push(row);
      }
      const grid = makeGrid(rows);
      grid.setTerrainById(grid.indexOf(0, 0), 'floor');
      grid.setTerrainById(grid.indexOf(8, 8), 'floor');

      const pathfinder = new Pathfinder(grid);
      const start = grid.indexOf(0, 0);
      const goal = grid.indexOf(8, 8);
      for (const rules of [DEFAULT_MOVEMENT, diagonal, cheapDiagonal]) {
        const path = pathfinder.findPath(start, goal, { rules });
        const field = pathfinder.reachable(start, Infinity, { rules });
        if (path === null) {
          expect(field.canReach(goal)).toBe(false);
          continue;
        }
        let cost = 0;
        for (let i = 1; i < path.length; i++) {
          const step = grid.costAt(path[i]!);
          cost += grid.isDiagonalStep(path[i - 1]!, path[i]!)
            ? step * rules.diagonalCostMultiplier
            : step;
        }
        expect(cost).toBeCloseTo(field.costTo(goal), 10);
      }
    }
  });
});

describe('Pathfinder.nearestReachableAdjacentTo', () => {
  it('finds the cheapest tile next to a creature you cannot stand on', () => {
    const grid = makeGrid(['.....']);
    const pathfinder = new Pathfinder(grid);
    const target = grid.indexOf(3, 0);
    const field = pathfinder.reachable(grid.indexOf(0, 0), 10, {
      isBlocked: (tile) => tile === target,
    });
    expect(pathfinder.nearestReachableAdjacentTo(field, target)).toBe(grid.indexOf(2, 0));
  });

  it('is NO_TILE when nothing next to the target can be reached', () => {
    const grid = makeGrid(['.#.', '.#.', '.#.']);
    const pathfinder = new Pathfinder(grid);
    const target = grid.indexOf(2, 1);
    const field = pathfinder.reachable(grid.indexOf(0, 0), 10);
    expect(pathfinder.nearestReachableAdjacentTo(field, target)).toBe(NO_TILE);
  });
});

describe('field lifetime', () => {
  it('throws rather than returning stale data after a later query', () => {
    const grid = makeGrid(['...']);
    const pathfinder = new Pathfinder(grid);
    const first = pathfinder.reachable(0, 5);
    pathfinder.reachable(2, 5);
    expect(() => first.costTo(1)).toThrow(/invalidated/);
  });

  it('clone() survives later queries', () => {
    const grid = makeGrid(['...']);
    const pathfinder = new Pathfinder(grid);
    const snapshot = pathfinder.reachable(0, 5).clone();
    pathfinder.reachable(2, 5);
    expect(snapshot.costTo(1)).toBe(1);
    expect(snapshot.canReach(2)).toBe(true);
    expect(tracePath(snapshot, 2)).toEqual([0, 1, 2]);
    expect(snapshot.clone()).toBe(snapshot);
  });
});

describe('performance characteristics', () => {
  it('floods a 200x200 grid without quadratic blow-up', () => {
    const grid = new TileGrid({ width: 200, height: 200 });
    const pathfinder = new Pathfinder(grid);
    const started = Date.now();
    for (let i = 0; i < 5; i++) {
      const field = pathfinder.reachable(grid.indexOf(100, 100), Infinity);
      expect(field.canReach(grid.indexOf(0, 0))).toBe(true);
    }
    // The legacy re-sort-per-pop approach cannot do this in the time budget; the
    // threshold is loose enough not to be flaky on a slow machine.
    expect(Date.now() - started).toBeLessThan(4000);
  });

  it('reuses its buffers instead of allocating per query', () => {
    const grid = new TileGrid({ width: 40, height: 40 });
    const pathfinder = new Pathfinder(grid);
    const first = pathfinder.reachable(0, Infinity).clone();
    for (let i = 0; i < 500; i++) pathfinder.reachable(i % grid.size, 6);
    const again = pathfinder.reachable(0, Infinity);
    // A generation-stamped buffer must not leak costs between queries.
    expect(again.costTo(grid.indexOf(39, 39))).toBe(first.costTo(grid.indexOf(39, 39)));
  });
});
