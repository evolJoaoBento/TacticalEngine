/**
 * The walk itself: from a path of tiles to the line a creature actually
 * takes across the ground.
 *
 * The pathfinder answers "can it get there, and by which tiles" on the grid
 * underneath. A creature is not a square, though, and this is not
 * played on one: it walks straight where nothing is in the way, rounds a
 * corner only as tightly as its body allows, and stops where it was walked
 * to rather than at the centre of whichever square that fell in. This module
 * turns a tile path into that line - a polyline of spots - and decides where
 * a walk that was aimed at a spot actually ends.
 *
 * Deterministic and allocation-light; no randomness anywhere.
 */

import { NO_TILE, type Spot, type TileGrid } from './grid';
import { WALKABLE_RISE } from './pathfinding';

export interface WalkRules {
  /** Half the width of a creature, in tiles: how close to a wall or another creature it may stand. */
  readonly radius: number;
  /** Largest change in standing height a step may cross, in blocks, as the pathfinder's rule says. */
  readonly maxStepHeight: number;
}

/** Half the width of a creature, in tiles: a body a little over two thirds of a tile wide, which is what the tokens are. */
export const BODY_RADIUS = 0.35;

export const DEFAULT_WALK: WalkRules = { radius: BODY_RADIUS, maxStepHeight: WALKABLE_RISE };

/** How finely a segment is checked, in tiles. */
const STRIDE = 0.25;

/** The offsets of a body's rim round its centre, as fractions of its radius. */
const RIM: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [Math.SQRT1_2, Math.SQRT1_2],
  [-Math.SQRT1_2, Math.SQRT1_2],
  [Math.SQRT1_2, -Math.SQRT1_2],
  [-Math.SQRT1_2, -Math.SQRT1_2],
];

/**
 * Whether a creature can stand with its centre at a spot: the tile under it
 * and every tile its rim reaches is floor, is not held by anything, and is
 * within a step of the tile under its centre - so a body never hangs over a
 * wall or off a ledge.
 */
export function canStandAt(
  grid: TileGrid,
  spot: Spot,
  blocked: (tile: number) => boolean = () => false,
  rules: WalkRules = DEFAULT_WALK,
): boolean {
  const centre = grid.tileAtSpot(spot.x, spot.y);
  if (centre === NO_TILE || !grid.isPassable(centre) || blocked(centre)) return false;
  const level = grid.standAt(centre);
  for (const [dx, dy] of RIM) {
    const tile = grid.tileAtSpot(spot.x + dx * rules.radius, spot.y + dy * rules.radius);
    if (tile === centre) continue;
    if (tile === NO_TILE || !grid.isPassable(tile) || blocked(tile)) return false;
    if (Math.abs(grid.standAt(tile) - level) > rules.maxStepHeight) return false;
  }
  return true;
}

/**
 * Whether a creature can walk straight from one spot to another: it can
 * stand everywhere along the way, and no step along it climbs more than a
 * step.
 */
export function segmentClear(
  grid: TileGrid,
  from: Spot,
  to: Spot,
  blocked: (tile: number) => boolean = () => false,
  rules: WalkRules = DEFAULT_WALK,
): boolean {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const steps = Math.max(1, Math.ceil(length / STRIDE));
  let level = grid.standAt(grid.tileAtSpot(from.x, from.y));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const spot = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
    if (!canStandAt(grid, spot, blocked, rules)) return false;
    const here = grid.standAt(grid.tileAtSpot(spot.x, spot.y));
    if (Math.abs(here - level) > rules.maxStepHeight) return false;
    level = here;
  }
  return true;
}

/**
 * Where a walk aimed at a spot ends: the spot itself when a creature can
 * stand there clear of everyone else, otherwise the nearest point back along
 * the line from the last tile's centre where it can. The centre itself at
 * worst - the pathfinder said that tile was free.
 */
export function settleEnd(
  grid: TileGrid,
  last: number,
  aimed: Spot,
  blocked: (tile: number) => boolean = () => false,
  others: readonly Spot[] = [],
  rules: WalkRules = DEFAULT_WALK,
): Spot {
  const centre = grid.spotOf(last);
  if (grid.tileAtSpot(aimed.x, aimed.y) !== last) return centre;
  const clear = (spot: Spot): boolean =>
    canStandAt(grid, spot, blocked, rules) && others.every((o) => Math.hypot(o.x - spot.x, o.y - spot.y) >= 2 * rules.radius);
  for (let t = 1; t > 0; t -= 0.1) {
    const spot = { x: centre.x + (aimed.x - centre.x) * t, y: centre.y + (aimed.y - centre.y) * t };
    if (clear(spot)) return spot;
  }
  return centre;
}

/**
 * The line a creature walks along a path of tiles: the path's corners pulled
 * straight wherever the way between them is clear, from where it stands to
 * where the walk ends. `start` is where it stands now (the first tile's
 * centre when left out); `end` is where the walk ends (the last tile's centre
 * when left out) - settle it with `settleEnd` first.
 *
 * A step the pathfinder took is always kept when nothing straighter is
 * clear, so the line never fails to arrive.
 */
export function smoothPath(
  grid: TileGrid,
  path: readonly number[],
  blocked: (tile: number) => boolean = () => false,
  rules: WalkRules = DEFAULT_WALK,
  ends: { start?: Spot; end?: Spot } = {},
): Spot[] {
  if (path.length === 0) return [];
  const points: Spot[] = path.map((tile) => grid.spotOf(tile));
  if (ends.start !== undefined) points[0] = ends.start;
  if (ends.end !== undefined) points[points.length - 1] = ends.end;
  const line: Spot[] = [points[0]!];
  let i = 0;
  while (i < points.length - 1) {
    let next = i + 1;
    for (let j = points.length - 1; j > i + 1; j--) {
      if (segmentClear(grid, points[i]!, points[j]!, blocked, rules)) {
        next = j;
        break;
      }
    }
    line.push(points[next]!);
    i = next;
  }
  return line;
}

/**
 * The nearest point on a line to a spot, for a follower taking its place
 * along the leader's walk rather than at the centre of the tile it claimed.
 */
export function nearestOnLine(line: readonly Spot[], spot: Spot): Spot {
  if (line.length === 0) return spot;
  let best = line[0]!;
  let bestDistance = Infinity;
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i]!;
    const b = line[i + 1]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length2 = dx * dx + dy * dy;
    const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((spot.x - a.x) * dx + (spot.y - a.y) * dy) / length2));
    const candidate = { x: a.x + dx * t, y: a.y + dy * t };
    const distance = Math.hypot(candidate.x - spot.x, candidate.y - spot.y);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * The point a distance along a line from its start, in tiles; the start
 * before it, the end past it. Where a follower stands, so many tiles back
 * along the walk.
 */
export function pointAlong(line: readonly Spot[], distance: number): Spot {
  if (line.length === 0) return { x: -1, y: -1 };
  let left = Math.max(0, distance);
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i]!;
    const b = line[i + 1]!;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (left <= length) {
      const t = length === 0 ? 0 : left / length;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    left -= length;
  }
  return { ...line[line.length - 1]! };
}

/** The length of a line, in tiles. */
export function lineLength(line: readonly Spot[]): number {
  let total = 0;
  for (let i = 0; i + 1 < line.length; i++) {
    total += Math.hypot(line[i + 1]!.x - line[i]!.x, line[i + 1]!.y - line[i]!.y);
  }
  return total;
}

/** What one small piece of a line costs to cross: its length, times what the ground under its middle costs to enter. */
function pieceCost(grid: TileGrid, a: Spot, b: Spot): number {
  const cost = grid.costAt(grid.tileAtSpot((a.x + b.x) / 2, (a.y + b.y) / 2));
  return Math.hypot(b.x - a.x, b.y - a.y) * (Number.isFinite(cost) ? cost : 1);
}

/** A line's segments as pieces no longer than a stride, in order: `visit` returns false to stop. */
function eachPiece(line: readonly Spot[], visit: (a: Spot, b: Spot) => boolean): void {
  for (let i = 0; i + 1 < line.length; i++) {
    const from = line[i]!;
    const to = line[i + 1]!;
    const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / STRIDE));
    for (let k = 0; k < steps; k++) {
      const a = { x: from.x + ((to.x - from.x) * k) / steps, y: from.y + ((to.y - from.y) * k) / steps };
      const b = { x: from.x + ((to.x - from.x) * (k + 1)) / steps, y: from.y + ((to.y - from.y) * (k + 1)) / steps };
      if (!visit(a, b)) return;
    }
  }
}

/**
 * What a line costs to walk, in movement: its length where the going is ordinary, and more
 * through whatever costs more to enter - counted along the line itself rather than by the
 * tiles under it, so a walk is as long as it is and not as long as the squares it crossed.
 */
export function lineCost(grid: TileGrid, line: readonly Spot[]): number {
  let total = 0;
  eachPiece(line, (a, b) => {
    total += pieceCost(grid, a, b);
    return true;
  });
  return total;
}

/** How far along a line an allowance of movement goes, in tiles of the line's own length: all of it, when it covers it. */
export function distanceWithin(grid: TileGrid, line: readonly Spot[], allowance: number): number {
  let spent = 0;
  let gone = 0;
  eachPiece(line, (a, b) => {
    const cost = pieceCost(grid, a, b);
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (spent + cost > allowance) {
      gone += cost <= 0 ? 0 : (length * Math.max(0, allowance - spent)) / cost;
      return false;
    }
    spent += cost;
    gone += length;
    return true;
  });
  return gone;
}

/** A circle on the ground, in tile units. */
export interface Circle {
  readonly anchor: Spot;
  readonly radius: number;
}

/** Whether a spot is inside a circle - on the edge counts. */
export function insideCircle(spot: Spot, circle: Circle): boolean {
  return Math.hypot(spot.x - circle.anchor.x, spot.y - circle.anchor.y) <= circle.radius + 1e-9;
}

/**
 * How far along a line stays inside a circle, in tiles of the line's own length: all of it when it
 * never leaves; else up to the point it crosses the edge, found to the nearest hundredth of a tile.
 * A line that starts outside goes nowhere.
 */
export function distanceInside(line: readonly Spot[], circle: Circle): number {
  if (line.length === 0 || !insideCircle(line[0]!, circle)) return 0;
  const total = lineLength(line);
  if (line.every((spot) => insideCircle(spot, circle))) return total;
  let inside = 0;
  let outside = total;
  // The first crossing: a line may leave and come back, and the walk stops at the first leaving.
  for (let gone = 0.01; gone < total; gone += 0.01) {
    if (!insideCircle(pointAlong(line, gone), circle)) {
      outside = gone;
      break;
    }
    inside = gone;
  }
  return Math.min(inside, outside);
}

/** A line in two at a distance along it: what is walked, and what is left. Both carry the point between them. */
export function splitLine(line: readonly Spot[], distance: number): { within: Spot[]; beyond: Spot[] } {
  const cut = pointAlong(line, distance);
  const within: Spot[] = [];
  let left = Math.max(0, distance);
  let i = 0;
  for (; i + 1 < line.length; i++) {
    within.push({ ...line[i]! });
    const length = Math.hypot(line[i + 1]!.x - line[i]!.x, line[i + 1]!.y - line[i]!.y);
    if (left <= length) break;
    left -= length;
  }
  if (i + 1 >= line.length) return { within: line.map((spot) => ({ ...spot })), beyond: [] };
  within.push(cut);
  return { within, beyond: [cut, ...line.slice(i + 1).map((spot) => ({ ...spot }))] };
}
