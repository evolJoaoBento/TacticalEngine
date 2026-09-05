/**
 * Line of sight and the cover it produces.
 *
 * The SRD names three cover levels and their effects but leaves the geometry to
 * the GM, and the legacy prototype had no line of sight at all — a tile was
 * "cover" and that was the whole rule. What follows is therefore an explicit,
 * stated house rule rather than a quotation, with every threshold in
 * `LineOfSightRules` so a project can change it without touching the engine:
 *
 * - Sight travels between tile centres, over the tiles the segment actually
 *   passes through (a supercover walk, so a wall on a corner still blocks).
 * - A tile blocks sight if its terrain says so, or if it stands higher than both
 *   endpoints — you can see over a low wall from a rampart, not from the floor.
 * - The endpoints themselves never block; a creature is not its own cover.
 * - Cover comes from what the line passes through: nothing blocking is no cover,
 *   one blocker is Light Cover, two or more is Full Cover. The target's own
 *   terrain cover applies too, and the better of the two wins. Total Cover is
 *   never inferred from geometry — it is authored, because "cannot be targeted at
 *   all" is too strong a consequence to derive from a heuristic.
 */

import { bestCover, type CoverLevel } from '../rules/cover';
import type { TileGrid } from './grid';

export interface LineOfSightRules {
  /**
   * How much higher than both endpoints a tile must stand before it blocks sight.
   * 1 means "any tile above both ends blocks".
   */
  readonly blockingHeightMargin: number;
  /** Blockers needed for Light Cover, then for Full Cover. */
  readonly lightCoverBlockers: number;
  readonly fullCoverBlockers: number;
}

export const DEFAULT_LINE_OF_SIGHT: LineOfSightRules = {
  blockingHeightMargin: 1,
  lightCoverBlockers: 1,
  fullCoverBlockers: 2,
};

export interface LineOfSightResult {
  /** Whether anything can be seen — and so targeted — at all. */
  clear: boolean;
  /** How many tiles between the endpoints block sight. */
  blockers: number;
  /** The first blocking tile, or -1. */
  firstBlocker: number;
}

/**
 * Walk the tiles a segment between two tile centres passes through, endpoints
 * included, and hand each to `visit`. Returning `false` stops the walk.
 *
 * This is a supercover line: when the segment crosses exactly through a corner
 * both adjacent tiles are visited, so a diagonal gap between two walls does not
 * leak sight.
 */
export function traceLine(
  grid: TileGrid,
  from: number,
  to: number,
  visit: (tile: number) => boolean | void,
): void {
  if (!grid.isTile(from) || !grid.isTile(to)) return;
  let x = grid.xOf(from);
  let y = grid.yOf(from);
  const x1 = grid.xOf(to);
  const y1 = grid.yOf(to);

  if (x === x1 && y === y1) {
    visit(from);
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
  if (visit(grid.indexOf(x, y)) === false) return;

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
      if (visit(grid.indexOf(x + stepX, y)) === false) return;
      if (visit(grid.indexOf(x, y + stepY)) === false) return;
      x += stepX;
      y += stepY;
      takenX++;
      takenY++;
    }
    if (visit(grid.indexOf(x, y)) === false) return;
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

/** Trace sight between two tiles and report what stands in the way. */
export function lineOfSight(
  grid: TileGrid,
  from: number,
  to: number,
  rules: LineOfSightRules = DEFAULT_LINE_OF_SIGHT,
): LineOfSightResult {
  if (!grid.isTile(from) || !grid.isTile(to)) {
    return { clear: false, blockers: 0, firstBlocker: -1 };
  }
  if (from === to) return { clear: true, blockers: 0, firstBlocker: -1 };

  const fromHeight = grid.heightAt(from);
  const toHeight = grid.heightAt(to);
  let blockers = 0;
  let firstBlocker = -1;

  traceLine(grid, from, to, (tile) => {
    // A creature is never its own cover, and never blocks the shot it is taking.
    if (tile === from || tile === to) return;
    if (!blocksBetween(grid, tile, fromHeight, toHeight, rules)) return;
    blockers++;
    if (firstBlocker < 0) firstBlocker = tile;
  });

  return { clear: blockers === 0, blockers, firstBlocker };
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
 * A target the line cannot reach at all has Total Cover — "cannot be targeted by
 * ranged attacks until you move or the cover is removed" — which is why this
 * returns a level rather than a boolean.
 */
export function coverBetween(
  grid: TileGrid,
  from: number,
  to: number,
  rules: LineOfSightRules = DEFAULT_LINE_OF_SIGHT,
): CoverLevel {
  const terrainCover = grid.isTile(to) ? grid.terrainAt(to).cover : 'none';
  const sight = lineOfSight(grid, from, to, rules);

  let fromBlockers: CoverLevel = 'none';
  if (sight.blockers >= rules.fullCoverBlockers) fromBlockers = 'full';
  else if (sight.blockers >= rules.lightCoverBlockers) fromBlockers = 'light';

  // Terrain marked as total cover, or a target that cannot be seen from anywhere
  // along the line, cannot be targeted at all.
  if (terrainCover === 'total') return 'total';
  return bestCover(terrainCover, fromBlockers);
}
