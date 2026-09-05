/**
 * Region triggers: stepping somewhere makes something happen.
 *
 * The legacy maps already carry them — a trigger is a list of cells and the
 * encounter group they wake — and the importer already brings them across as
 * `Encounter.triggerCells`. This is the lookup that makes them do anything.
 *
 * Kept as an index rather than a scan because it is consulted on every step of
 * every move: building it once costs one pass over the scene, and asking costs a
 * map lookup.
 */

import { NO_TILE, type TileGrid } from '../grid/grid';
import type { SceneDoc } from './schema';
import type { SceneState } from './state';

export interface TriggerHit {
  encounter: string;
  tile: number;
}

/** Which encounter, if any, each trigger cell belongs to. */
export class TriggerIndex {
  private readonly byTile = new Map<number, string>();

  constructor(scene: SceneDoc, grid: TileGrid) {
    for (const encounter of scene.encounters) {
      if (!encounter.startsOnTrigger) continue;
      for (const cell of encounter.triggerCells) {
        const tile = grid.indexOf(cell.x, cell.y);
        // The first encounter to claim a cell keeps it; overlapping triggers are
        // an authoring mistake, and picking deterministically beats picking last.
        if (tile !== NO_TILE && !this.byTile.has(tile)) this.byTile.set(tile, encounter.id);
      }
    }
  }

  get size(): number {
    return this.byTile.size;
  }

  /** The encounter a tile would start, ignoring whether it already has. */
  at(tile: number): string | null {
    return this.byTile.get(tile) ?? null;
  }

  /**
   * The first encounter a path would trigger, and where.
   *
   * Walking *through* a trigger fires it, which is what stops a party from
   * sprinting past an ambush — and it reports the tile so the mover can be
   * stopped there rather than at the end of the path.
   */
  firstAlong(path: readonly number[], state: SceneState): TriggerHit | null {
    for (const tile of path) {
      const encounter = this.at(tile);
      if (encounter === null) continue;
      const status = state.encounter(encounter);
      if (status.triggered || status.started || status.ended) continue;
      return { encounter, tile };
    }
    return null;
  }
}
