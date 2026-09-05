/**
 * Area of effect, and movement under pressure.
 *
 * Both are SRD 2.0 sections with no counterpart in 1.0, which is why the engine
 * had neither until the 2.0 diff pass.
 *
 * AREA OF EFFECT:
 * > Unless stated otherwise, all the targets of a group effect must be within
 * > Very Close range of a single origin point within your effect's range.
 *
 * MOVEMENT UNDER PRESSURE:
 * > When you're under pressure or in danger and make an action roll, you can move
 * > to a location within Close range as part of that action. If you're not already
 * > making an action roll, or if you want to move farther than your Close range,
 * > you need to succeed on an Agility Roll to safely reposition yourself. An
 * > adversary can move within Close range for free as part of an action, or within
 * > Very Far range as a separate action.
 *
 * Pure and grid-only: these answer "which tiles" and "is this move free", never
 * "what happened".
 */

import type { TileGrid } from '../grid/grid';
import { hasLineOfSight, type LineOfSightRules } from '../grid/los';
import {
  bandForDistance,
  reaches,
  type BandTiles,
  type RangeBand,
  type TargetableRangeBand,
} from '../rules/range';

/** The band a group effect spreads over from its origin, unless it says otherwise. */
export const AREA_OF_EFFECT_BAND: TargetableRangeBand = 'veryClose';

export interface AreaOptions {
  bandTiles?: BandTiles;
  /** How far the effect spreads from its origin. Defaults to Very Close. */
  radius?: TargetableRangeBand;
  /**
   * Whether a target needs line of sight from the origin point. Off by default:
   * the SRD states the range constraint and leaves the rest to the effect's text.
   */
  requireLineOfSight?: boolean;
  losRules?: LineOfSightRules;
}

/**
 * Whether an origin point is a legal one for an effect with the given range —
 * "a single origin point within your effect's range".
 */
export function isLegalOrigin(
  grid: TileGrid,
  caster: number,
  origin: number,
  effectRange: RangeBand,
  options: AreaOptions = {},
): boolean {
  if (!grid.isTile(caster) || !grid.isTile(origin)) return false;
  if (caster === origin) return true;
  const distance = Math.ceil(grid.euclideanDistance(caster, origin));
  return reaches(bandForDistance(distance, options.bandTiles), effectRange);
}

/** Whether a tile falls inside the area an effect covers from its origin. */
export function isInArea(
  grid: TileGrid,
  origin: number,
  tile: number,
  options: AreaOptions = {},
): boolean {
  if (!grid.isTile(origin) || !grid.isTile(tile)) return false;
  if (origin === tile) return true;
  const radius = options.radius ?? AREA_OF_EFFECT_BAND;
  const distance = Math.ceil(grid.euclideanDistance(origin, tile));
  if (!reaches(bandForDistance(distance, options.bandTiles), radius)) return false;
  if (options.requireLineOfSight !== true) return true;
  return hasLineOfSight(grid, origin, tile, options.losRules);
}

/**
 * Every tile an effect covers, cheapest way for a UI to paint the template.
 * Allocates, so call it on hover or on cast, not per frame.
 */
export function tilesInArea(
  grid: TileGrid,
  origin: number,
  options: AreaOptions = {},
): number[] {
  const out: number[] = [];
  if (!grid.isTile(origin)) return out;
  const radius = options.radius ?? AREA_OF_EFFECT_BAND;
  const table = options.bandTiles;
  // Bound the scan by the radius in tiles rather than sweeping the whole grid.
  const reach = maxTiles(radius, table);
  const ox = grid.xOf(origin);
  const oy = grid.yOf(origin);
  for (let y = Math.max(0, oy - reach); y <= Math.min(grid.height - 1, oy + reach); y++) {
    for (let x = Math.max(0, ox - reach); x <= Math.min(grid.width - 1, ox + reach); x++) {
      const tile = grid.indexOf(x, y);
      if (isInArea(grid, origin, tile, options)) out.push(tile);
    }
  }
  return out;
}

function maxTiles(band: TargetableRangeBand, table?: BandTiles): number {
  const tiles = table === undefined ? undefined : table[band];
  if (tiles !== undefined) return tiles;
  // Mirror DEFAULT_BAND_TILES without importing it, to keep this bound loose.
  return { melee: 1, veryClose: 2, close: 6, far: 20, veryFar: 60 }[band];
}

/** Who is moving: the rules differ for a PC and an adversary. */
export type Mover = 'pc' | 'adversary';

export type MoveCost =
  /** Comes free with the action being taken. */
  | 'free'
  /** Needs a successful Agility Roll to reposition safely. */
  | 'agilityRoll'
  /** Takes the whole action, with no roll. */
  | 'action'
  /** Beyond what a single move can cover. */
  | 'outOfReach';

export interface MoveUnderPressureOptions {
  bandTiles?: BandTiles;
  /**
   * Whether the mover is already making an action roll. A PC only gets the free
   * Close-range reposition as part of one.
   */
  withAction?: boolean;
}

/**
 * What a move costs while under pressure — the SRD's answer to "can I just walk
 * there mid-fight?".
 *
 * The engine keeps its own movement budgets for tactical play; this is the SRD
 * ruling a project can use instead of, or alongside, a budget.
 */
export function moveUnderPressure(
  grid: TileGrid,
  mover: Mover,
  from: number,
  to: number,
  options: MoveUnderPressureOptions = {},
): MoveCost {
  if (!grid.isTile(from) || !grid.isTile(to)) return 'outOfReach';
  if (from === to) return 'free';

  const band = bandForDistance(Math.ceil(grid.euclideanDistance(from, to)), options.bandTiles);

  if (mover === 'adversary') {
    // "within Close range for free as part of an action, or within Very Far
    // range as a separate action."
    if (reaches(band, 'close')) return 'free';
    if (reaches(band, 'veryFar')) return 'action';
    return 'outOfReach';
  }

  if (reaches(band, 'close')) {
    return options.withAction === true ? 'free' : 'agilityRoll';
  }
  // Farther than Close always needs the roll, however the move started.
  return reaches(band, 'veryFar') ? 'agilityRoll' : 'outOfReach';
}
