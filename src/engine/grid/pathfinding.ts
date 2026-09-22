/**
 * Movement rules, reachability and pathfinding over a `TileGrid`.
 *
 * The legacy prototype re-sorted an array on every pop (O(n^2 log n)) and rebuilt
 * `Map`s and `Set`s of `"x,y"` strings per query, which was fine for a 48x48 map
 * and is not fine at engine scale. This replaces both: a binary heap, typed-array
 * cost and predecessor buffers reused across calls, and generation stamps so a
 * query never clears a buffer it did not touch.
 *
 * A `Pathfinder` is therefore stateful and single-threaded by design: one instance
 * per grid, and a `ReachableField` is only valid until the next query on the same
 * instance. `ReachableField.clone()` exists for the cases that need to outlive one.
 */

import { NO_TILE, type TileGrid } from './grid';

export interface MovementRules {
  /** Allow the four diagonal steps as well as the four orthogonal ones. */
  readonly diagonals: boolean;
  /**
   * Largest change in standing height a single step may cross, in blocks - one block is one
   * tile up, and a level of ground is `SLAB_BLOCKS` of one. `Infinity` ignores height entirely.
   */
  readonly maxStepHeight: number;
  /**
   * Whether a diagonal step may squeeze past a blocked corner. Off by default:
   * both shared orthogonal neighbours must be enterable.
   */
  readonly allowCornerCutting: boolean;
  /** Multiplier applied to a diagonal step's terrain cost. */
  readonly diagonalCostMultiplier: number;
}

/**
 * The most a step climbs, in blocks: half a block, a third, a quarter, and the two levels of
 * ground that come to a little over two thirds. Past it is a jump - three quarters already,
 * because that is a whole block stood beside a floor tile, which is what "a block up" looks
 * like on a board laid from tiles.
 */
export const WALKABLE_RISE = 0.72;

/**
 * Four-neighbour movement. A step crosses up to two levels of ground - the prototype's limit
 * was one, and the content authored against it still walks.
 */
export const DEFAULT_MOVEMENT: MovementRules = {
  diagonals: false,
  maxStepHeight: WALKABLE_RISE,
  allowCornerCutting: false,
  diagonalCostMultiplier: 1.5,
};

export interface MovementContext {
  rules?: MovementRules;
  /**
   * Tiles this mover cannot enter: other creatures, closed doors, blocking props.
   * Kept out of the grid because it changes every time something moves.
   */
  isBlocked?: (tile: number) => boolean;
  /**
   * Additional cost to enter a tile, on top of its terrain cost.
   * Must not be negative: a negative surcharge would make `findPath`'s heuristic
   * overestimate and quietly return non-optimal routes. Negative values are
   * clamped to zero rather than trusted.
   */
  extraCost?: (tile: number) => number;
  /**
   * How far from the query's start a tile may lie, as the crow flies in tiles
   * measured to the nearest one, beyond which it is not entered. A move "within
   * Close range" is a disc round where the mover stands, not a count of steps;
   * this is the disc. Left out, only the budget bounds the search.
   */
  maxSpan?: number;
}

/**
 * The result of a reachability query: cost to reach every tile within budget, and
 * the predecessor that gets there.
 *
 * Backed by the pathfinder's shared buffers — read it before the next query, or
 * `clone()` it.
 */
export interface ReachableField {
  readonly start: number;
  readonly budget: number;
  /** Movement cost to reach a tile, or `Infinity` when it is out of reach. */
  costTo(tile: number): number;
  /** Whether a tile is reachable within the budget. */
  canReach(tile: number): boolean;
  /** The tile stepped from to reach this one, or `NO_TILE`. */
  cameFrom(tile: number): number;
  /** Every reachable tile, cheapest first. Allocates — for UI, not per frame. */
  tiles(): number[];
  /** A detached copy that survives later queries. */
  clone(): ReachableField;
}

/** A minimum binary heap of tile indices keyed by cost. Grows geometrically. */
class TileHeap {
  private costs: Float64Array;
  private tiles: Int32Array;
  private count = 0;

  constructor(capacity = 64) {
    this.costs = new Float64Array(capacity);
    this.tiles = new Int32Array(capacity);
  }

  get size(): number {
    return this.count;
  }

  clear(): void {
    this.count = 0;
  }

  push(tile: number, cost: number): void {
    if (this.count === this.tiles.length) this.grow();
    let i = this.count++;
    this.tiles[i] = tile;
    this.costs[i] = cost;
    // Sift up.
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.costs[parent]! <= this.costs[i]!) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  /** Removes and returns the cheapest tile, or `NO_TILE` when empty. */
  pop(): number {
    if (this.count === 0) return NO_TILE;
    const top = this.tiles[0]!;
    this.count--;
    if (this.count > 0) {
      this.tiles[0] = this.tiles[this.count]!;
      this.costs[0] = this.costs[this.count]!;
      // Sift down.
      let i = 0;
      for (;;) {
        const left = i * 2 + 1;
        if (left >= this.count) break;
        const right = left + 1;
        let child = left;
        if (right < this.count && this.costs[right]! < this.costs[left]!) child = right;
        if (this.costs[i]! <= this.costs[child]!) break;
        this.swap(i, child);
        i = child;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    const t = this.tiles[a]!;
    this.tiles[a] = this.tiles[b]!;
    this.tiles[b] = t;
    const c = this.costs[a]!;
    this.costs[a] = this.costs[b]!;
    this.costs[b] = c;
  }

  private grow(): void {
    const capacity = this.tiles.length * 2;
    const tiles = new Int32Array(capacity);
    tiles.set(this.tiles);
    const costs = new Float64Array(capacity);
    costs.set(this.costs);
    this.tiles = tiles;
    this.costs = costs;
  }
}

const NO_COST = Infinity;

export class Pathfinder {
  readonly grid: TileGrid;

  private readonly cost: Float64Array;
  private readonly prev: Int32Array;
  /** Generation each tile's cost/prev entry belongs to; avoids clearing buffers. */
  private readonly stamp: Int32Array;
  /**
   * Generation in which a tile was expanded. A tile relaxed twice leaves a stale
   * heap entry behind; without this the second pop re-expands its whole
   * neighbourhood for nothing.
   */
  private readonly closed: Int32Array;
  private generation = 0;
  private readonly heap = new TileHeap();
  /** Cheapest cost any passable terrain can charge — keeps the A* heuristic admissible. */
  private readonly minStepCost: number;

  // State of the query in flight. Held on the instance so the neighbour visitor
  // can be a single callback bound once in the constructor rather than a closure
  // rebuilt for every tile the search expands.
  private queryRules: MovementRules = DEFAULT_MOVEMENT;
  private queryContext: MovementContext = {};
  private queryGeneration = 0;
  private queryBudget = Infinity;
  private queryFrom = NO_TILE;
  private queryStart = NO_TILE;
  private queryFromCost = 0;
  /** `NO_TILE` for an unguided flood; a goal tile switches the heap key to A*. */
  private queryGoal = NO_TILE;
  private readonly relaxNeighbor: (next: number) => void;

  constructor(grid: TileGrid) {
    this.grid = grid;
    const size = grid.size;
    this.cost = new Float64Array(size);
    this.prev = new Int32Array(size);
    this.stamp = new Int32Array(size);
    this.closed = new Int32Array(size);

    let min = Infinity;
    for (const type of grid.palette.types) {
      if (type.passable) min = Math.min(min, type.cost);
    }
    this.minStepCost = Number.isFinite(min) ? Math.max(0, min) : 0;

    this.relaxNeighbor = (next: number): void => {
      const from = this.queryFrom;
      const rules = this.queryRules;
      const generation = this.queryGeneration;
      if (!this.canStep(from, next, rules, this.queryContext)) return;
      const span = this.queryContext.maxSpan;
      if (span !== undefined && Math.round(this.grid.euclideanDistance(this.queryStart, next)) > span) return;

      const total = this.queryFromCost + this.stepCost(from, next, rules, this.queryContext);
      if (total > this.queryBudget) return;
      if (this.stamp[next] === generation && this.cost[next]! <= total) return;

      this.cost[next] = total;
      this.prev[next] = from;
      this.stamp[next] = generation;
      const goal = this.queryGoal;
      this.heap.push(next, goal === NO_TILE ? total : total + this.heuristic(next, goal, rules));
    };
  }

  /**
   * Dijkstra from `start`, stopping once every frontier tile exceeds `budget`.
   * Pass `Infinity` for an unbounded field.
   */
  reachable(start: number, budget: number, context: MovementContext = {}): ReachableField {
    const rules = context.rules ?? DEFAULT_MOVEMENT;
    const generation = this.beginQuery(rules, context, budget, NO_TILE, start);
    const { cost, prev, stamp, heap, grid } = this;

    if (grid.isTile(start)) {
      cost[start] = 0;
      prev[start] = NO_TILE;
      stamp[start] = generation;
      heap.push(start, 0);
    }

    while (heap.size > 0) {
      const current = heap.pop();
      if (stamp[current] !== generation) continue;
      // A stale heap entry: the tile was already expanded at its final cost.
      if (this.closed[current] === generation) continue;
      this.closed[current] = generation;
      const currentCost = cost[current]!;
      if (currentCost >= budget) continue;

      this.queryFrom = current;
      this.queryFromCost = currentCost;
      grid.forEachNeighbor(current, rules.diagonals, this.relaxNeighbor);
    }

    return this.makeField(start, budget, generation);
  }

  /**
   * A* from `start` to `goal`. Returns the tile indices from `start` to `goal`
   * inclusive, or `null` when no route exists.
   *
   * `goal` must be enterable; to walk up to a creature, use `reachable` and
   * `nearestReachableAdjacentTo` instead.
   */
  findPath(start: number, goal: number, context: MovementContext = {}): number[] | null {
    const rules = context.rules ?? DEFAULT_MOVEMENT;
    const { cost, prev, stamp, heap, grid } = this;
    if (!grid.isTile(start) || !grid.isTile(goal)) return null;
    if (start === goal) return [start];
    if (!grid.isPassable(goal) || context.isBlocked?.(goal) === true) return null;

    const generation = this.beginQuery(rules, context, Infinity, goal, start);
    cost[start] = 0;
    prev[start] = NO_TILE;
    stamp[start] = generation;
    heap.push(start, this.heuristic(start, goal, rules));

    while (heap.size > 0) {
      const current = heap.pop();
      if (stamp[current] !== generation) continue;
      if (this.closed[current] === generation) continue;
      this.closed[current] = generation;
      if (current === goal) return this.tracePath(start, goal, generation);

      this.queryFrom = current;
      this.queryFromCost = cost[current]!;
      grid.forEachNeighbor(current, rules.diagonals, this.relaxNeighbor);
    }
    return null;
  }

  /**
   * The cheapest reachable tile from which `target` is a single step away — where
   * a mover stops when it wants to reach something standing on a blocked tile.
   * Returns `NO_TILE` when nothing adjacent is reachable.
   */
  nearestReachableAdjacentTo(
    field: ReachableField,
    target: number,
    rules: MovementRules = DEFAULT_MOVEMENT,
  ): number {
    let best = NO_TILE;
    let bestCost = NO_COST;
    this.grid.forEachNeighbor(target, rules.diagonals, (neighbor) => {
      const c = field.costTo(neighbor);
      if (c < bestCost) {
        bestCost = c;
        best = neighbor;
      }
    });
    return best;
  }

  private beginQuery(
    rules: MovementRules,
    context: MovementContext,
    budget: number,
    goal: number,
    start: number,
  ): number {
    this.heap.clear();
    this.queryRules = rules;
    this.queryContext = context;
    this.queryBudget = budget;
    this.queryGoal = goal;
    this.queryFrom = NO_TILE;
    this.queryStart = start;
    this.queryFromCost = 0;
    this.generation++;
    if (this.generation === 0x7fff_ffff) {
      // Wrapped: the only moment a full clear is needed.
      this.stamp.fill(0);
      this.closed.fill(0);
      this.generation = 1;
    }
    this.queryGeneration = this.generation;
    return this.generation;
  }

  private canStep(
    from: number,
    to: number,
    rules: MovementRules,
    context: MovementContext,
  ): boolean {
    const grid = this.grid;
    if (!grid.isPassable(to)) return false;
    if (context.isBlocked?.(to) === true) return false;
    if (Math.abs(grid.standAt(to) - grid.standAt(from)) > rules.maxStepHeight) return false;

    if (rules.diagonals && !rules.allowCornerCutting && grid.isDiagonalStep(from, to)) {
      // Both tiles shared by the corner must be enterable. Checked inline rather
      // than through an array, so a diagonal step allocates nothing.
      const sideA = grid.indexOf(grid.xOf(to), grid.yOf(from));
      const sideB = grid.indexOf(grid.xOf(from), grid.yOf(to));
      if (!this.isCornerClear(sideA, from, rules, context)) return false;
      if (!this.isCornerClear(sideB, from, rules, context)) return false;
    }
    return true;
  }

  private isCornerClear(
    side: number,
    from: number,
    rules: MovementRules,
    context: MovementContext,
  ): boolean {
    const grid = this.grid;
    if (!grid.isPassable(side)) return false;
    if (context.isBlocked?.(side) === true) return false;
    return Math.abs(grid.standAt(side) - grid.standAt(from)) <= rules.maxStepHeight;
  }

  private stepCost(
    from: number,
    to: number,
    rules: MovementRules,
    context: MovementContext,
  ): number {
    let cost = this.grid.costAt(to);
    if (rules.diagonals && this.grid.isDiagonalStep(from, to)) {
      cost *= rules.diagonalCostMultiplier;
    }
    return cost + Math.max(0, context.extraCost?.(to) ?? 0);
  }

  /**
   * Never overestimates the remaining cost, which is what keeps A* optimal: the
   * fewest steps the movement rules could need, times the cheapest a step can
   * possibly be.
   *
   * A diagonal multiplier below 1 makes a diagonal step cheaper than an
   * orthogonal one, so it has to be folded in — otherwise a project that prices
   * diagonals cheaply would get non-optimal paths with no error.
   */
  private heuristic(from: number, to: number, rules: MovementRules): number {
    const steps = rules.diagonals
      ? this.grid.chebyshevDistance(from, to)
      : this.grid.manhattanDistance(from, to);
    const cheapestStep = rules.diagonals
      ? this.minStepCost * Math.min(1, rules.diagonalCostMultiplier)
      : this.minStepCost;
    return steps * cheapestStep;
  }

  private tracePath(start: number, goal: number, generation: number): number[] | null {
    const path: number[] = [];
    let tile = goal;
    while (tile !== NO_TILE) {
      if (this.stamp[tile] !== generation) return null;
      path.push(tile);
      if (tile === start) break;
      tile = this.prev[tile]!;
    }
    if (path[path.length - 1] !== start) return null;
    path.reverse();
    return path;
  }

  private makeField(start: number, budget: number, generation: number): ReachableField {
    const { cost, prev, stamp, grid } = this;
    const live = (): boolean => this.generation === generation;
    const assertLive = (): void => {
      if (!live()) {
        throw new Error(
          'this ReachableField was invalidated by a later query on the same Pathfinder; clone() it to keep one',
        );
      }
    };

    const field: ReachableField = {
      start,
      budget,
      costTo(tile) {
        assertLive();
        return grid.isTile(tile) && stamp[tile] === generation ? cost[tile]! : NO_COST;
      },
      canReach(tile) {
        const c = field.costTo(tile);
        // Guarded against an unbounded budget, where Infinity <= Infinity would
        // otherwise call every unreached tile reachable.
        return Number.isFinite(c) && c <= budget;
      },
      cameFrom(tile) {
        assertLive();
        return grid.isTile(tile) && stamp[tile] === generation ? prev[tile]! : NO_TILE;
      },
      tiles() {
        assertLive();
        const out: number[] = [];
        for (let i = 0; i < grid.size; i++) if (stamp[i] === generation) out.push(i);
        out.sort((a, b) => cost[a]! - cost[b]! || a - b);
        return out;
      },
      clone() {
        assertLive();
        const costs = new Map<number, number>();
        const parents = new Map<number, number>();
        for (let i = 0; i < grid.size; i++) {
          if (stamp[i] !== generation) continue;
          costs.set(i, cost[i]!);
          parents.set(i, prev[i]!);
        }
        return frozenField(start, budget, costs, parents);
      },
    };
    return field;
  }
}

/** A detached `ReachableField` that no longer depends on the pathfinder's buffers. */
function frozenField(
  start: number,
  budget: number,
  costs: ReadonlyMap<number, number>,
  parents: ReadonlyMap<number, number>,
): ReachableField {
  const field: ReachableField = {
    start,
    budget,
    costTo: (tile) => costs.get(tile) ?? NO_COST,
    canReach: (tile) => {
      const c = costs.get(tile) ?? NO_COST;
      return Number.isFinite(c) && c <= budget;
    },
    cameFrom: (tile) => parents.get(tile) ?? NO_TILE,
    tiles: () =>
      [...costs.keys()].sort((a, b) => costs.get(a)! - costs.get(b)! || a - b),
    clone: () => field,
  };
  return field;
}

/**
 * Walk a `ReachableField` back from a destination to its start.
 * Returns the tiles from start to destination inclusive, or `null` when the
 * destination was not reached.
 */
export function tracePath(field: ReachableField, destination: number): number[] | null {
  if (!field.canReach(destination)) return null;
  const path: number[] = [];
  let tile = destination;
  while (tile !== NO_TILE) {
    path.push(tile);
    if (tile === field.start) break;
    tile = field.cameFrom(tile);
  }
  if (path[path.length - 1] !== field.start) return null;
  path.reverse();
  return path;
}
