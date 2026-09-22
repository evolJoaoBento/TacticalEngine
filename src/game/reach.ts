/**
 * Reach, measured the way a swing measures it: from where one creature stands to where the
 * other does. For whoever has to choose somewhere to strike *from* before anybody has moved -
 * a tile is chosen, and a walk to a tile ends at its centre, so that is where the measure is
 * taken from for any tile but the one they are already in.
 */

import type { Spot } from '../engine/grid/grid';
import { bandForSpan, type RangeBand } from '../engine/rules/range';
import { DEMO_BAND_TILES } from './demo-rules';
import type { DemoScene } from './demo-scene';

type Board = Pick<DemoScene, 'grid' | 'state'>;

/** Where a creature would be measuring from if it were in this tile: where it stands, in its own; the centre, in any other. */
export function standingIn(demo: Board, id: string, tile: number): Spot {
  const entity = demo.state.entity(id);
  return entity !== undefined && entity.tile === tile ? entity.at : demo.grid.spotOf(tile);
}

/** Where whoever is on a tile stands - the first living body there - or its centre with nobody on it. */
export function standingOn(demo: Board, tile: number): Spot {
  for (const id of demo.state.occupantsOf(tile)) {
    const entity = demo.state.entity(id);
    if (entity !== undefined && entity.alive) return entity.at;
  }
  return demo.grid.spotOf(tile);
}

/** The band from a spot to whoever stands on a tile. */
export function bandFromSpot(demo: Board, from: Spot, tile: number): RangeBand {
  const to = standingOn(demo, tile);
  return bandForSpan(Math.hypot(from.x - to.x, from.y - to.y), DEMO_BAND_TILES);
}
