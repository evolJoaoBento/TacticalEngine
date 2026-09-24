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
import { GrowScene } from './grow-scene';
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
  /**
   * The room growing round what this stroke laid, once the stroke is over. It moves every key
   * in the layer, so it runs after the stamps and is undone before them - both halves of which
   * are in the coordinates the stamps were made in - and nothing joins the stroke after it.
   */
  private grown: GrowScene | null = null;

  /** What a placing stroke in this scene merges under: the room growing round it has to say the same. */
  static placingKey(sceneId: string): string {
    return `${sceneId}:Place building tiles`;
  }

  constructor(
    private readonly sceneId: string,
    tiles: readonly BuildingTile[],
    private readonly erase = false,
  ) {
    this.label = erase ? 'Erase building tiles' : 'Place building tiles';
    this.mergeKey = erase ? `${sceneId}:${this.label}` : BuildingEdit.placingKey(sceneId);
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
    this.grown?.apply(project);
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
    this.grown?.undo(project);
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
    if (this.grown !== null || other.mergeKey !== this.mergeKey) return false;
    if (other instanceof GrowScene) {
      this.grown = other;
      return true;
    }
    if (!(other instanceof BuildingEdit) || other.grown !== null) return false;
    for (const [key, previous] of other.before) {
      if (!this.before.has(key)) this.before.set(key, previous);
      this.after.set(key, other.after.get(key));
    }
    return true;
  }
}

/**
 * One piece picked up and put down somewhere else - another cell, another level, another
 * facing - as one edit. It moves under the key its new cell gives it, so the layer stays
 * keyed by where things are; the room growing to hold the landing joins it, as it joins a stroke.
 */
export class MovePiece implements Edit {
  readonly label = 'Move building tile';
  readonly mergeKey: string;
  private before: BuildingTile | null = null;
  private toKey: string | null = null;
  private grown: GrowScene | null = null;

  constructor(
    private readonly sceneId: string,
    private readonly fromKey: string,
    private readonly to: { x: number; y: number; level: number },
    private readonly rotation?: number,
  ) {
    this.mergeKey = BuildingEdit.placingKey(sceneId);
  }

  /** The key the piece stands at once applied: its move can change it, a level being part of it. */
  get landedKey(): string | null {
    return this.toKey;
  }

  /** What the piece becomes: where it was carried to, turned if it was turned. */
  private moved(piece: BuildingTile): BuildingTile {
    return { ...piece, x: this.to.x, y: this.to.y, level: this.to.level, rotation: this.rotation ?? piece.rotation };
  }

  apply(project: ProjectDoc): void {
    const scene = project.scenes.find((s) => s.id === this.sceneId);
    const tiles = scene?.buildingTiles;
    const piece = tiles?.[this.fromKey];
    if (tiles === undefined || piece === undefined) return;
    const next = this.moved(piece);
    // Put down where it was picked up, facing the same way: nothing happened, and nothing is remembered.
    if (next.x === piece.x && next.y === piece.y && next.level === piece.level && next.rotation === piece.rotation) return;
    this.before = piece;
    delete tiles[this.fromKey];
    if (this.toKey === null) {
      // The key its cell gives it, or the next free one where something already stands.
      const cell = buildingKey(next);
      let key = cell;
      for (let n = 1; key in tiles; n++) key = `${cell}#${n}`;
      this.toKey = key;
    }
    tiles[this.toKey] = next;
    this.grown?.apply(project);
  }

  undo(project: ProjectDoc): void {
    this.grown?.undo(project);
    const tiles = project.scenes.find((s) => s.id === this.sceneId)?.buildingTiles;
    if (tiles === undefined || this.before === null || this.toKey === null) return;
    delete tiles[this.toKey];
    tiles[this.fromKey] = this.before;
  }

  /** Asked after `apply`: an edit that remembered nothing changed nothing. */
  isNoop(): boolean {
    return this.before === null;
  }

  absorb(other: Edit): boolean {
    if (!(other instanceof GrowScene) || other.mergeKey !== this.mergeKey || this.grown !== null) return false;
    this.grown = other;
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
