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
 *
 * Follows SRD 2.0: a ranged attacker needs line of sight, a partial obstruction
 * gives cover, and a total obstruction means no line of sight at all. Melee
 * attacks are unaffected by both — the attacker is already past the obstruction.
 */

import { TileGrid, type Spot } from '../grid/grid';
import { coverBetween, lineOfSight, type LineOfSightRules } from '../grid/los';
import { coverDisadvantage, type Cover } from '../rules/cover';
import {
  bandForSpan,
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
  | 'noLineOfSight';

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
   * Where the two of them actually stand, in tile units. The span is measured between
   * these when they are given, and between the tiles' centres when not: a creature is
   * not at the centre of its square, and half a step can be what puts it in reach. Sight
   * and cover are still asked of the tiles, which is what walls are made of.
   */
  at?: { attacker: Spot; target: Spot };
}

export interface TargetingReport {
  /** Straight-line distance in tiles. */
  distance: number;
  band: RangeBand;
  /** Human-readable band, for logs and the inspector. */
  bandLabel: string;
  hasLineOfSight: boolean;
  /** Whether something got in the way without stopping the shot. */
  partialObstruction: boolean;
  /** Cover the target benefits from. Always `none` against a melee attack. */
  cover: Cover;
  /**
   * Disadvantage dice the cover imposes on the attack roll — 1 through cover,
   * 0 otherwise. SRD 2.0: "Attacks made through cover are rolled with disadvantage."
   */
  coverDisadvantage: number;
  ranged: boolean;
  /** `null` when the attack is legal. */
  refusal: TargetingRefusal | null;
}

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
    partialObstruction: false,
    cover: 'none',
    coverDisadvantage: 0,
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

  // As the crow flies, from where one stands to where the other does: every neighbour is
  // Melee, whichever way it lies, and nothing past one depends on the shape of the map.
  const distance =
    options.at === undefined
      ? grid.euclideanDistance(attackerTile, targetTile)
      : Math.hypot(options.at.attacker.x - options.at.target.x, options.at.attacker.y - options.at.target.y);
  const band = bandForSpan(distance, options.bandTiles);
  const ranged = options.ranged ?? band !== 'melee';

  const sight = lineOfSight(grid, attackerTile, targetTile, options.losRules);
  const cover = ranged ? coverBetween(grid, attackerTile, targetTile, options.losRules) : 'none';

  // SRD 2.0 folds "cannot be targeted" into line of sight: a total obstruction
  // means there is no line, rather than a third grade of cover.
  const refusal: TargetingRefusal | null = !reaches(band, maxRange)
    ? 'outOfRange'
    : ranged && !sight.clear
      ? 'noLineOfSight'
      : null;

  return {
    distance,
    band,
    bandLabel: bandLabel(band),
    hasLineOfSight: sight.clear,
    partialObstruction: sight.partial,
    cover,
    coverDisadvantage: coverDisadvantage(cover, ranged),
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
  }
}
