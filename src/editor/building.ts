/**
 * Placing and removing construction, reversibly.
 *
 * The document's building layer is a record rather than an array, so an edit
 * cannot be described as an index and a value: it is a set of keys, each with
 * what stood there before and what stands there now. That shape is also what
 * makes a stroke one undo step - a second stamp only adds keys to the same two
 * maps.
 */

import { buildingKey, buildingTileSchema, type BuildingTile } from '../engine/scene/building';
import type { ProjectDoc } from '../engine/scene/schema';
import type { Edit } from './session';

/** Each stamp owns independent instances. A stroke merges only its undo records. */
export class BuildingEdit implements Edit {
  readonly label: string;
  readonly mergeKey: string;
  private readonly before = new Map<string, BuildingTile | undefined>();
  private readonly after = new Map<string, BuildingTile | undefined>();
  private wasAbsent = false;
  private initialized = false;
  private readonly tiles: BuildingTile[];

  constructor(
    private readonly sceneId: string,
    tiles: readonly BuildingTile[],
    private readonly erase = false,
  ) {
    this.label = erase ? 'Erase building tiles' : 'Place building tiles';
    this.mergeKey = `${sceneId}:${this.label}`;
    this.tiles = tiles.map((tile) => buildingTileSchema.parse(tile));
  }

  apply(project: ProjectDoc): void {
    const scene = project.scenes.find((s) => s.id === this.sceneId);
    if (!scene) throw new Error(`Unknown scene ${this.sceneId}`);
    // Which keys this edit touches is decided once, against the document as it
    // first found it, so applying it again after an undo writes the same cells.
    if (!this.initialized) this.plan(scene.buildingTiles ?? {}, scene.buildingTiles === undefined);
    for (const [key, tile] of this.after) {
      if (tile === undefined) delete scene.buildingTiles?.[key];
      else (scene.buildingTiles ??= {})[key] = tile;
    }
  }

  /** Work out the key for every stamp, once, and what it displaces. */
  private plan(tiles: Readonly<Record<string, BuildingTile>>, wasAbsent: boolean): void {
    this.wasAbsent = wasAbsent;
    this.initialized = true;
    if (this.tiles.length === 0) return;
    const occupied = new Set(Object.keys(tiles));
    const stacked = this.erase ? stacksByCell(tiles) : new Map<string, string[]>();
    for (const tile of this.tiles) {
      const cell = buildingKey(tile);
      if (this.erase) {
        // The newest piece at that cell, peeled off so a brush that covers it
        // twice takes two.
        const key = stacked.get(cell)?.pop();
        if (key === undefined) continue;
        this.before.set(key, tiles[key]);
        this.after.set(key, undefined);
        continue;
      }
      let key = cell;
      let n = 1;
      while (occupied.has(key)) key = `${cell}#${n++}`;
      occupied.add(key);
      this.before.set(key, undefined);
      this.after.set(key, tile);
    }
  }

  undo(project: ProjectDoc): void {
    const scene = project.scenes.find((s) => s.id === this.sceneId)!;
    for (const [key, previous] of this.before) {
      if (previous === undefined) delete scene.buildingTiles?.[key];
      else (scene.buildingTiles ??= {})[key] = previous;
    }
    // A scene that had no building layer before this edit gets none back, so an
    // undone first stamp leaves the document byte for byte as it was.
    if (this.wasAbsent && Object.keys(scene.buildingTiles ?? {}).length === 0) delete scene.buildingTiles;
  }

  isNoop(): boolean {
    return this.after.size === 0;
  }

  absorb(other: Edit): boolean {
    if (!(other instanceof BuildingEdit) || other.mergeKey !== this.mergeKey) return false;
    for (const [key, previous] of other.before) {
      if (!this.before.has(key)) this.before.set(key, previous);
      this.after.set(key, other.after.get(key));
    }
    return true;
  }
}

/**
 * The keys standing at each position, oldest first.
 *
 * Read once per edit rather than once per tile: a 5x5 erase would otherwise
 * walk the whole document twenty-five times.
 */
function stacksByCell(tiles: Readonly<Record<string, BuildingTile>>): Map<string, string[]> {
  const stacked = new Map<string, string[]>();
  for (const [key, tile] of Object.entries(tiles)) {
    const cell = buildingKey(tile);
    const at = stacked.get(cell);
    if (at === undefined) stacked.set(cell, [key]);
    else at.push(key);
  }
  return stacked;
}
