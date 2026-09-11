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

  constructor(private readonly sceneId: string, tiles: readonly BuildingTile[], private readonly erase = false) {
    this.label = erase ? 'Erase building tiles' : 'Place building tiles';
    this.mergeKey = `${sceneId}:${this.label}`;
    this.tiles = tiles.map((tile) => buildingTileSchema.parse(tile));
  }
  apply(project: ProjectDoc): void {
    const scene = project.scenes.find((s) => s.id === this.sceneId);
    if (!scene) throw new Error(`Unknown scene ${this.sceneId}`);
    if (!this.initialized) {
      this.wasAbsent = scene.buildingTiles === undefined;
      if (this.tiles.length === 0) { this.initialized = true; return; }
      const occupied = new Set(Object.keys(scene.buildingTiles ?? {}));
      for (const tile of this.tiles) {
        const cell = buildingKey(tile);
        if (this.erase) {
          const found = Object.entries(scene.buildingTiles ?? {}).reverse().find(([key, t]) =>
            buildingKey(t) === cell && !this.after.has(key));
          if (found) { this.before.set(found[0], found[1]); this.after.set(found[0], undefined); }
        } else {
          let key = cell, n = 1;
          while (occupied.has(key)) key = `${cell}#${n++}`;
          occupied.add(key);
          this.before.set(key, undefined);
          this.after.set(key, tile);
        }
      }
      this.initialized = true;
    }
    for (const [key, tile] of this.after) {
      if (tile === undefined) delete scene.buildingTiles?.[key];
      else (scene.buildingTiles ??= {})[key] = tile;
    }
  }
  undo(project: ProjectDoc): void {
    const scene = project.scenes.find((s) => s.id === this.sceneId)!;
    for (const [key, previous] of this.before) {
      if (previous === undefined) delete scene.buildingTiles?.[key];
      else (scene.buildingTiles ??= {})[key] = previous;
    }
    if (this.wasAbsent && Object.keys(scene.buildingTiles ?? {}).length === 0) delete scene.buildingTiles;
  }
  isNoop(): boolean { return this.after.size === 0; }
  absorb(other: Edit): boolean {
    if (!(other instanceof BuildingEdit) || other.mergeKey !== this.mergeKey) return false;
    for (const [key, previous] of other.before) {
      if (!this.before.has(key)) this.before.set(key, previous);
      this.after.set(key, other.after.get(key));
    }
    return true;
  }
}
