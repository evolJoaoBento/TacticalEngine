/**
 * Whether one tile can attack another, and what protection the target gets.
 *
 * This is the geometry half of an attack, kept separate from the dice half so a
 * UI can show range, cover and line of sight on hover without rolling anything.
 *
 * The legacy prototype checked Manhattan distance against a weapon's tile range
 * and had no line of sight at all, so a hero could shoot through a wall. Here the
 * distance becomes an SRD range band, the line is actually traced, and cover is
 * derived from what it passes through.
 */

import { TileGrid } from '../grid/grid';
import { coverBetween, lineOfSight, type LineOfSightRules } from '../grid/los';
import { canBeTargetedByRanged, type CoverLevel } from '../rules/cover';
import {
  bandForDistance,
  bandLabel,
  reaches,
  type BandTiles,
  type RangeBand,
} from '../rules/range';

/** Why an attack cannot be made. `null` in a report means it can. */
export type TargetingRefusal =
  | 'noAttacker'
  | 'noTarget'
  | 'selfTarget'
  | 'outOfRange'
  | 'noLineOfSight'
  | 'totalCover';

export interface TargetingOptions {
  /** Tile distances that define each band. Defaults to the engine's table. */
  bandTiles?: BandTiles;
  losRules?: LineOfSightRules;
  /**
   * Whether the attack is ranged. Melee attacks ignore cover, and are not stopped
   * by Total Cover, since the attacker is already in the target's face.
   * Defaults to "anything beyond Melee band is ranged".
   */
  ranged?: boolean;
  /**
   * Whether a diagonal neighbour counts as adjacent — that is, as Melee range.
   *
   * This has to follow the project's movement rules or the two disagree in a way
   * players notice: straight-line distance to a diagonal neighbour is 1.41, which
   * rounds into Very Close, so a fighter standing corner-to-corner with a target
   * could not reach it with a Melee weapon. Defaults to `false`, matching
   * `DEFAULT_MOVEMENT`; a project that turns diagonal movement on must turn this
   * on with it.
   *
   * It only affects adjacency. Everything past a neighbouring tile is measured in
   * a straight line, because that is what a range band describes.
   */
  diagonalAdjacency?: boolean;
}

export interface TargetingReport {
  /** Straight-line distance in tiles. */
  distance: number;
  band: RangeBand;
  /** Human-readable band, for logs and the inspector. */
  bandLabel: string;
  hasLineOfSight: boolean;
  /** Tiles between the two that block sight. */
  blockers: number;
  /** Cover the target benefits from. Always `none` against a melee attack. */
  cover: CoverLevel;
  /** Evasion or Difficulty bonus the cover grants. */
  coverBonus: number;
  ranged: boolean;
  /** `null` when the attack is legal. */
  refusal: TargetingRefusal | null;
}

const COVER_BONUS: Readonly<Record<CoverLevel, number>> = {
  none: 0,
  light: 1,
  full: 2,
  total: 0,
};

/**
 * Evaluate an attack from one tile to another against a maximum range.
 *
 * Distance is straight-line, which is what a range band describes; movement uses
 * its own metric and the two are deliberately not the same thing.
 */
export function evaluateTarget(
  grid: TileGrid,
  attackerTile: number,
  targetTile: number,
  maxRange: RangeBand,
  options: TargetingOptions = {},
): TargetingReport {
  const empty: TargetingReport = {
    distance: Infinity,
    band: 'outOfRange',
    bandLabel: bandLabel('outOfRange'),
    hasLineOfSight: false,
    blockers: 0,
    cover: 'none',
    coverBonus: 0,
    ranged: true,
    refusal: 'noTarget',
  };
  if (!grid.isTile(attackerTile)) return { ...empty, refusal: 'noAttacker' };
  if (!grid.isTile(targetTile)) return empty;
  // Attacking your own tile is a caller mistake, not a zero-range attack.
  if (attackerTile === targetTile) {
    return {
      ...empty,
      distance: 0,
      band: 'melee',
      bandLabel: bandLabel('melee'),
      hasLineOfSight: true,
      ranged: false,
      refusal: 'selfTarget',
    };
  }

  const distance = grid.euclideanDistance(attackerTile, targetTile);
  // A neighbour under the movement rules is in Melee range, whichever direction it
  // lies in; anything further is measured in a straight line.
  const adjacent =
    options.diagonalAdjacency === true
      ? grid.chebyshevDistance(attackerTile, targetTile) <= 1
      : grid.manhattanDistance(attackerTile, targetTile) <= 1;
  const band = adjacent ? 'melee' : bandForDistance(Math.ceil(distance), options.bandTiles);
  const ranged = options.ranged ?? band !== 'melee';

  const sight = lineOfSight(grid, attackerTile, targetTile, options.losRules);
  const cover = ranged ? coverBetween(grid, attackerTile, targetTile, options.losRules) : 'none';

  const refusal: TargetingRefusal | null = !reaches(band, maxRange)
    ? 'outOfRange'
    : !sight.clear
      ? 'noLineOfSight'
      : ranged && !canBeTargetedByRanged(cover)
        ? 'totalCover'
        : null;

  return {
    distance,
    band,
    bandLabel: bandLabel(band),
    hasLineOfSight: sight.clear,
    blockers: sight.blockers,
    cover,
    coverBonus: COVER_BONUS[cover],
    ranged,
    refusal,
  };
}

/** Whether an attack from one tile to another is legal at all. */
export function canTarget(
  grid: TileGrid,
  attackerTile: number,
  targetTile: number,
  maxRange: RangeBand,
  options: TargetingOptions = {},
): boolean {
  return evaluateTarget(grid, attackerTile, targetTile, maxRange, options).refusal === null;
}

/** A short reason a UI can show when an attack is refused. */
export function refusalMessage(refusal: TargetingRefusal): string {
  switch (refusal) {
    case 'noAttacker':
      return 'The attacker is not on the map.';
    case 'noTarget':
      return 'The target is not on the map.';
    case 'selfTarget':
      return 'A creature cannot attack its own tile.';
    case 'outOfRange':
      return 'The target is out of range.';
    case 'noLineOfSight':
      return 'Something blocks the line of sight.';
    case 'totalCover':
      return 'The target is behind total cover.';
  }
}
