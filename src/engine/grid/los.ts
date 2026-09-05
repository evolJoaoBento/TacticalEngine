/**
 * Line of sight, and the cover it produces.
 *
 * SRD 2.0, "LINE OF SIGHT & COVER": a ranged attacker needs line of sight; a
 * *partial* obstruction gives the target cover; a *total* obstruction means there
 * is no line of sight at all. The SRD does not say what makes an obstruction
 * partial rather than total — that is still the table's call — so the engine
 * answers it with the geometry it already traces, and states the answer here:
 *
 * - Sight travels between tile centres, over the tiles the segment actually
 *   passes through (a supercover walk).
 * - Running squarely into a blocking tile is a **total** obstruction: no line of
 *   sight, and the attack cannot be made.
 * - Clipping the corner between two tiles where only *one* of them blocks is a
 *   **partial** obstruction: the shot gets through, and the target has cover.
 * - Terrain flagged `providesCover` — a low wall, rubble, a cart — gives the
 *   creature standing on it cover without blocking sight at all.
 * - A tile blocks sight if its terrain says so, or if it stands higher than both
 *   endpoints: you can see over a low wall from a rampart, not from the floor.
 * - The endpoints themselves never block; a creature is not its own obstruction.
 *
 * The 1.0 rule this replaced graded cover into Light/Full/Total by counting
 * blockers. 2.0 made cover binary, so the count no longer matters — only whether
 * anything got in the way, and whether anything got through.
 */

import { combineCover, type Cover } from '../rules/cover';
import type { TileGrid } from './grid';

export interface LineOfSightRules {
  /**
   * How much higher than both endpoints a tile must stand before it blocks sight.
   * 1 means "any tile above both ends blocks".
   */
  readonly blockingHeightMargin: number;
}

export const DEFAULT_LINE_OF_SIGHT: LineOfSightRules = { blockingHeightMargin: 1 };

export interface LineOfSightResult {
  /** Whether the target can be seen, and so targeted, at all. */
  clear: boolean;
  /**
   * Something stood in the way but the shot still got through — the partial
   * obstruction that 2.0 turns into cover.
   */
  partial: boolean;
  /** The first tile that blocked the line, or -1. */
  firstBlocker: number;
}

/**
 * Walk the tiles a segment between two tile centres passes through, endpoints
 * included, and hand each to `visit`. Returning `false` stops the walk.
 *
 * At an exact corner both tiles the segment touches are visited, and they are
 * reported as a pair so a caller can tell "squeezed past one wall" from "ran into
 * two". `atCorner` is true for the two tiles of such a pair.
 */
export function traceLine(
  grid: TileGrid,
  from: number,
  to: number,
  visit: (tile: number, atCorner: boolean) => boolean | void,
): void {
  if (!grid.isTile(from) || !grid.isTile(to)) return;
  let x = grid.xOf(from);
  let y = grid.yOf(from);
  const x1 = grid.xOf(to);
  const y1 = grid.yOf(to);

  if (x === x1 && y === y1) {
    visit(from, false);
    return;
  }

  const spanX = Math.abs(x1 - x);
  const spanY = Math.abs(y1 - y);
  const stepX = x < x1 ? 1 : -1;
  const stepY = y < y1 ? 1 : -1;

  // Integer grid traversal. `takenX`/`takenY` count the steps made on each axis;
  // the segment's next vertical boundary is nearer than its next horizontal one
  // exactly when (2*takenX + 1) * spanY < (2*takenY + 1) * spanX. Equality means
  // the segment passes through a corner, and both tiles it touches are visited —
  // so a diagonal gap between two walls does not leak sight.
  //
  // All-integer, so the comparison is exact and the walk is symmetric: tracing
  // from B to A visits the same tiles in reverse.
  let takenX = 0;
  let takenY = 0;
  if (visit(grid.indexOf(x, y), false) === false) return;

  while (takenX < spanX || takenY < spanY) {
    const nextX = (2 * takenX + 1) * spanY;
    const nextY = (2 * takenY + 1) * spanX;
    if (takenY >= spanY || (takenX < spanX && nextX < nextY)) {
      x += stepX;
      takenX++;
    } else if (takenX >= spanX || nextY < nextX) {
      y += stepY;
      takenY++;
    } else {
      if (visit(grid.indexOf(x + stepX, y), true) === false) return;
      if (visit(grid.indexOf(x, y + stepY), true) === false) return;
      x += stepX;
      y += stepY;
      takenX++;
      takenY++;
    }
    if (visit(grid.indexOf(x, y), false) === false) return;
  }
}

/** Whether a tile blocks sight between two endpoints, given their elevations. */
function blocksBetween(
  grid: TileGrid,
  tile: number,
  fromHeight: number,
  toHeight: number,
  rules: LineOfSightRules,
): boolean {
  if (grid.blocksSight(tile)) return true;
  const highestEnd = Math.max(fromHeight, toHeight);
  return grid.heightAt(tile) - highestEnd >= rules.blockingHeightMargin;
}

/**
 * Trace sight between two tiles and report whether the obstruction — if any — is
 * partial or total.
 */
export function lineOfSight(
  grid: TileGrid,
  from: number,
  to: number,
  rules: LineOfSightRules = DEFAULT_LINE_OF_SIGHT,
): LineOfSightResult {
  if (!grid.isTile(from) || !grid.isTile(to)) {
    return { clear: false, partial: false, firstBlocker: -1 };
  }
  if (from === to) return { clear: true, partial: false, firstBlocker: -1 };

  const fromHeight = grid.heightAt(from);
  const toHeight = grid.heightAt(to);

  let blocked = false;
  let partial = false;
  let firstBlocker = -1;
  // A corner pair is two tiles the segment touches at once. It only stops the
  // line when *both* of them block; one blocked tile is squeezing past a corner.
  let cornerBlocked = 0;
  let cornerSeen = 0;
  let cornerFirst = -1;

  traceLine(grid, from, to, (tile, atCorner) => {
    if (tile === from || tile === to) return;
    const blocks = blocksBetween(grid, tile, fromHeight, toHeight, rules);

    if (!atCorner) {
      if (!blocks) return;
      blocked = true;
      if (firstBlocker < 0) firstBlocker = tile;
      return false; // Squarely into an obstruction: nothing further matters.
    }

    if (blocks && cornerFirst < 0) cornerFirst = tile;
    if (blocks) cornerBlocked++;
    cornerSeen++;
    if (cornerSeen === 2) {
      if (cornerBlocked === 2) {
        blocked = true;
        if (firstBlocker < 0) firstBlocker = cornerFirst;
        return false;
      }
      if (cornerBlocked === 1) partial = true;
      cornerBlocked = 0;
      cornerSeen = 0;
      cornerFirst = -1;
    }
    return;
  });

  return { clear: !blocked, partial: !blocked && partial, firstBlocker };
}

/** Whether one tile can see another at all. */
export function hasLineOfSight(
  grid: TileGrid,
  from: number,
  to: number,
  rules: LineOfSightRules = DEFAULT_LINE_OF_SIGHT,
): boolean {
  return lineOfSight(grid, from, to, rules).clear;
}

/**
 * The cover a target at `to` has against an attacker at `from`.
 *
 * Cover comes from a partial obstruction on the line, or from the target standing
 * on terrain that provides cover. A target with no line of sight has no cover
 * either — it simply cannot be attacked, which the caller learns from
 * `lineOfSight`.
 */
export function coverBetween(
  grid: TileGrid,
  from: number,
  to: number,
  rules: LineOfSightRules = DEFAULT_LINE_OF_SIGHT,
): Cover {
  const terrain: Cover =
    grid.isTile(to) && grid.terrainAt(to).providesCover ? 'cover' : 'none';
  const sight = lineOfSight(grid, from, to, rules);
  return combineCover(terrain, sight.partial ? 'cover' : 'none');
}
