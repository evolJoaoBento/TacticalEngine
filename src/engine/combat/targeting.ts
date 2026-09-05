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

  const distance = grid.euclideanDistance(attackerTile, targetTile);
  const band = bandForDistance(Math.ceil(distance), options.bandTiles);
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
    case 'outOfRange':
      return 'The target is out of range.';
    case 'noLineOfSight':
      return 'Something blocks the line of sight.';
    case 'totalCover':
      return 'The target is behind total cover.';
  }
}
