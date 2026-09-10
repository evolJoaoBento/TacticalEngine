/**
 * The walk itself: from a path of tiles to the line a creature actually
 * takes across the ground.
 *
 * The pathfinder answers "can it get there, and by which tiles" on the grid
 * underneath. A creature is not a square, though, and Daggerheart is not
 * played on one: it walks straight where nothing is in the way, rounds a
 * corner only as tightly as its body allows, and stops where it was walked
 * to rather than at the centre of whichever square that fell in. This module
 * turns a tile path into that line - a polyline of spots - and decides where
 * a walk that was aimed at a spot actually ends.
 *
 * Deterministic and allocation-light; no randomness anywhere.
 */

import { NO_TILE, type Spot, type TileGrid } from './grid';

export interface WalkRules {
  /** Half the width of a creature, in tiles: how close to a wall or another creature it may stand. */
  readonly radius: number;
  /** Largest change of level a step may cross, as the pathfinder's rule says. */
  readonly maxStepHeight: number;
}

/** Half the width of a creature, in tiles: a body a little over two thirds of a tile wide, which is what the tokens are. */
export const BODY_RADIUS = 0.35;

export const DEFAULT_WALK: WalkRules = { radius: BODY_RADIUS, maxStepHeight: 1 };

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
  const level = grid.heightAt(centre);
  for (const [dx, dy] of RIM) {
    const tile = grid.tileAtSpot(spot.x + dx * rules.radius, spot.y + dy * rules.radius);
    if (tile === centre) continue;
    if (tile === NO_TILE || !grid.isPassable(tile) || blocked(tile)) return false;
    if (Math.abs(grid.heightAt(tile) - level) > rules.maxStepHeight) return false;
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
  let level = grid.heightAt(grid.tileAtSpot(from.x, from.y));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const spot = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
    if (!canStandAt(grid, spot, blocked, rules)) return false;
    const here = grid.heightAt(grid.tileAtSpot(spot.x, spot.y));
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
