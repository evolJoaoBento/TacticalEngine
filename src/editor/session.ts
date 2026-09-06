/**
 * The editing session: a project document, plus every change made to it.
 *
 * This is the half of the editor that has nothing to do with a screen. Tools,
 * panels and clicks live in `src/editor/ui/`; what a click *means* — "paint these
 * tiles", "put a crate here", "this trigger now wakes that encounter" — is an
 * `Edit` applied here, and can be tested, replayed and undone without a browser.
 *
 * Undo is command-based rather than snapshot-based. A snapshot of a 512x512 scene
 * is a quarter of a million tile entries per keystroke of a brush; an edit that
 * paints eight tiles stores eight previous values. The trade is that every edit
 * has to know how to reverse itself, which is enforced by the type.
 *
 * The document stays a plain `ProjectDoc` throughout, so at any moment it can be
 * validated with the same schema the loader uses and saved as the same JSON.
 */

import type { Deco, Encounter, Interactable, Point, ProjectDoc, SceneDoc } from '../engine/scene/schema';

/** One reversible change. `undo` must restore exactly what `apply` replaced. */
export interface Edit {
  /** Shown in an undo menu: "Paint terrain", "Place crate". */
  readonly label: string;
  apply(project: ProjectDoc): void;
  undo(project: ProjectDoc): void;
  /**
   * Edits with the same key may be coalesced, so dragging a brush across forty
   * tiles is one undo step rather than forty.
   */
  readonly mergeKey?: string;
  /**
   * Take over another edit's undo record. Called *after* the other edit has been
   * applied, so the values it captured are the real ones — merging before that
   * was a bug: the absorbed tiles had no previous values yet, and undo restored
   * empty strings over them.
   */
  absorb?(other: Edit): boolean;
  /**
   * Whether the edit turned out to change nothing — painting floor onto floor.
   * A no-op is not worth an undo step, and a viewport should not redraw for it.
   */
  isNoop?(): boolean;
}

export interface SessionOptions {
  /** How many edits to keep. Older ones fall off the bottom. */
  historyLimit?: number;
}

export type SessionListener = (session: EditorSession) => void;

/**
 * A project being edited.
 *
 * Mutation goes through `run`, which is what keeps undo honest: nothing else may
 * touch the document.
 */
export class EditorSession {
  readonly project: ProjectDoc;
  private readonly done: Edit[] = [];
  private readonly undone: Edit[] = [];
  private readonly limit: number;
  private readonly listeners = new Set<SessionListener>();
  private savedAt = 0;
  /** Set by `endGroup`, so the next edit starts a fresh undo step. */
  private groupBroken = false;

  constructor(project: ProjectDoc, options: SessionOptions = {}) {
    this.project = project;
    this.limit = Math.max(1, options.historyLimit ?? 200);
  }

  /** Subscribe to changes. Returns an unsubscribe. */
  subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener(this);
  }

  /**
   * Apply an edit, coalescing it into the last one when both agree to.
   * Returns whether anything actually changed, so a caller knows whether to
   * redraw — an edit that turned out to be a no-op reports false.
   */
  run(edit: Edit): boolean {
    // Apply first: an edit only knows what it replaced once it has run, and the
    // previous edit needs exactly that to extend its own undo record.
    edit.apply(this.project);

    // An edit that changed nothing is not worth remembering, and nothing has to
    // be redrawn for it.
    if (edit.isNoop?.() === true) return false;

    const last = this.done[this.done.length - 1];
    const mergeable =
      !this.groupBroken &&
      last !== undefined &&
      this.undone.length === 0 &&
      // A save is a boundary: coalescing into an already-saved edit would leave
      // the document changed and the session claiming to be clean.
      this.done.length > this.savedAt &&
      last.mergeKey !== undefined &&
      last.mergeKey === edit.mergeKey;
    if (mergeable && last!.absorb?.(edit) === true) {
      this.notify();
      return true;
    }

    this.groupBroken = false;
    this.done.push(edit);
    if (this.done.length > this.limit) {
      this.done.shift();
      // Everything before the window is now unreachable, including the save mark.
      this.savedAt = Math.max(0, this.savedAt - 1);
    }
    // A new edit discards the redo branch, as every editor does.
    this.undone.length = 0;
    this.notify();
    return true;
  }

  /**
   * End the current undo group.
   *
   * A drag is one undo step, but two drags are two — releasing the pointer is the
   * boundary, and without this a second stroke of the same brush would silently
   * join the first.
   */
  endGroup(): void {
    this.groupBroken = true;
  }

  get canUndo(): boolean {
    return this.done.length > 0;
  }

  get canRedo(): boolean {
    return this.undone.length > 0;
  }

  /** The label of the edit undo would reverse, for a menu item. */
  get undoLabel(): string | null {
    return this.done[this.done.length - 1]?.label ?? null;
  }

  get redoLabel(): string | null {
    return this.undone[this.undone.length - 1]?.label ?? null;
  }

  undo(): boolean {
    this.groupBroken = true;
    const edit = this.done.pop();
    if (edit === undefined) return false;
    edit.undo(this.project);
    this.undone.push(edit);
    this.notify();
    return true;
  }

  redo(): boolean {
    const edit = this.undone.pop();
    if (edit === undefined) return false;
    edit.apply(this.project);
    this.done.push(edit);
    this.notify();
    return true;
  }

  /** Whether anything has changed since the last `markSaved`. */
  get dirty(): boolean {
    return this.done.length !== this.savedAt;
  }

  markSaved(): void {
    this.savedAt = this.done.length;
    this.notify();
  }

  /** A scene by id. */
  scene(id: string): SceneDoc | undefined {
    return this.project.scenes.find((s) => s.id === id);
  }

  /** A scene by id, or a throw — for callers that already checked. */
  requireScene(id: string): SceneDoc {
    const scene = this.scene(id);
    if (scene === undefined) throw new Error(`no scene "${id}" in this project`);
    return scene;
  }
}

// ---------------------------------------------------------------------------
// Edits
// ---------------------------------------------------------------------------

const tileIndex = (scene: SceneDoc, point: Point): number => point.y * scene.width + point.x;

const inBounds = (scene: SceneDoc, point: Point): boolean =>
  point.x >= 0 && point.y >= 0 && point.x < scene.width && point.y < scene.height;

/**
 * A second, parallel per-tile array an edit blanks as it writes.
 *
 * `SceneDoc.tints` is a per-tile colour override, and `buildTerrainMesh` lets it
 * win over the terrain type's own colour. The legacy importer writes a tint for
 * every tile, so without this a terrain brush changed what the pathfinder saw and
 * nothing of what the author saw - the paint was invisible on exactly the maps
 * people start from.
 */
interface TileClear {
  /** The array to blank, or undefined when the scene carries none. */
  read: (scene: SceneDoc) => (string | undefined)[] | undefined;
  /** The value meaning "nothing authored here". */
  empty: string;
}

/**
 * An edit that writes one value across a set of tiles in an array on the scene,
 * remembering what each held.
 *
 * Terrain and elevation are the same operation over different arrays, and both
 * want the same brush-drag coalescing, so they share this.
 */
function tileValueEdit<T>(
  sceneId: string,
  tiles: readonly number[],
  value: T,
  label: string,
  mergeKey: string,
  read: (scene: SceneDoc) => (T | undefined)[],
  alsoClear?: TileClear,
): Edit {
  // Every tile this edit is responsible for. It grows as drags are absorbed, and
  // it — not the original argument — is what a redo replays, or a merged drag
  // would come back only in part.
  const targets: number[] = [...tiles];
  // Parallel arrays rather than a Map: a brush drag appends thousands of times.
  const changed: number[] = [];
  const previous: T[] = [];
  // What the cleared array held per changed tile, so undo restores the colour as
  // well as the terrain. `undefined` means the scene had no such array.
  const previousCleared: (string | undefined)[] = [];

  const edit: Edit = {
    label,
    mergeKey,
    apply(project) {
      const scene = requireScene(project, sceneId);
      const array = read(scene);
      const clearing = alsoClear?.read(scene);
      changed.length = 0;
      previous.length = 0;
      previousCleared.length = 0;
      for (const tile of targets) {
        const current = array[tile];
        if (current === undefined) continue;
        const cleared = clearing?.[tile];
        const needsClear = cleared !== undefined && cleared !== alsoClear!.empty;
        // Skip tiles already holding the value, so re-dragging over painted
        // ground does not fill the history with no-ops. A tile that still
        // carries a colour override is not "already painted", however the
        // document reads.
        if (current === value && !needsClear) continue;
        changed.push(tile);
        previous.push(current);
        previousCleared.push(cleared);
        array[tile] = value;
        if (needsClear) clearing![tile] = alsoClear!.empty;
      }
    },
    undo(project) {
      const scene = requireScene(project, sceneId);
      const array = read(scene);
      const clearing = alsoClear?.read(scene);
      changed.forEach((tile, i) => {
        array[tile] = previous[i]!;
        const cleared = previousCleared[i];
        if (clearing !== undefined && cleared !== undefined) clearing[tile] = cleared;
      });
    },
    isNoop() {
      return changed.length === 0;
    },
    absorb(other) {
      const record = (
        other as Edit & {
          __tiles?: {
            changed: number[];
            previous: T[];
            previousCleared: (string | undefined)[];
            targets: number[];
          };
        }
      ).__tiles;
      if (record === undefined) return false;
      record.changed.forEach((tile, i) => {
        // A tile this edit already touched keeps its *original* value, which is
        // the one undo has to restore.
        if (changed.includes(tile)) return;
        changed.push(tile);
        previous.push(record.previous[i]!);
        previousCleared.push(record.previousCleared[i]);
      });
      for (const tile of record.targets) {
        if (!targets.includes(tile)) targets.push(tile);
      }
      return true;
    },
  };
  (edit as Edit & { __tiles: unknown }).__tiles = { changed, previous, previousCleared, targets };
  return edit;
}

/**
 * Paint terrain onto tiles. Dragging a brush is one undo step.
 *
 * Painting also drops the tile's colour override, so the new terrain is the
 * colour the palette says it is. Elevation deliberately does not change: a wall
 * painted at ground level is one the party cannot cross but can see over, and
 * Raise is a separate tool.
 */
export function paintTerrain(sceneId: string, tiles: readonly number[], terrainId: string): Edit {
  return tileValueEdit(
    sceneId,
    tiles,
    terrainId,
    `Paint ${terrainId}`,
    `paint:${sceneId}:${terrainId}`,
    (scene) => scene.terrain,
    { read: (scene) => scene.tints, empty: '' },
  );
}

/** Set tiles to an exact elevation. */
export function setHeight(sceneId: string, tiles: readonly number[], level: number): Edit {
  return tileValueEdit(
    sceneId,
    tiles,
    level,
    `Set height ${level}`,
    `height:${sceneId}:${level}`,
    (scene) => scene.heights,
  );
}

/** Raise or lower tiles by a number of levels, relative to what they hold. */
export function adjustHeight(sceneId: string, tiles: readonly number[], delta: number): Edit {
  const applied: number[] = [];
  return {
    label: delta >= 0 ? 'Raise terrain' : 'Lower terrain',
    apply(project) {
      const scene = requireScene(project, sceneId);
      applied.length = 0;
      for (const tile of tiles) {
        if (scene.heights[tile] === undefined) continue;
        scene.heights[tile] += delta;
        applied.push(tile);
      }
    },
    undo(project) {
      const scene = requireScene(project, sceneId);
      for (const tile of applied) scene.heights[tile] -= delta;
    },
  };
}

export function addDeco(sceneId: string, deco: Deco): Edit {
  return {
    label: `Place ${deco.model}`,
    apply(project) {
      requireScene(project, sceneId).decos.push(deco);
    },
    undo(project) {
      const decos = requireScene(project, sceneId).decos;
      const at = decos.lastIndexOf(deco);
      if (at >= 0) decos.splice(at, 1);
    },
  };
}

export function removeDecoAt(sceneId: string, point: Point): Edit {
  let removed: { deco: Deco; index: number } | null = null;
  return {
    label: 'Erase prop',
    apply(project) {
      const decos = requireScene(project, sceneId).decos;
      // Topmost first: the last placed is the one a click means.
      for (let i = decos.length - 1; i >= 0; i--) {
        const deco = decos[i]!;
        if (deco.position.x === point.x && deco.position.y === point.y) {
          removed = { deco, index: i };
          decos.splice(i, 1);
          return;
        }
      }
      removed = null;
    },
    undo(project) {
      if (removed === null) return;
      requireScene(project, sceneId).decos.splice(removed.index, 0, removed.deco);
    },
  };
}

/** Turn a prop in place — the legacy editor's "click again to rotate". */
export function rotateDeco(sceneId: string, point: Point, byRadians: number): Edit {
  let target: Deco | null = null;
  return {
    label: 'Rotate prop',
    apply(project) {
      const decos = requireScene(project, sceneId).decos;
      target =
        [...decos].reverse().find((d) => d.position.x === point.x && d.position.y === point.y) ?? null;
      if (target !== null) target.rotation += byRadians;
    },
    undo() {
      if (target !== null) target.rotation -= byRadians;
    },
  };
}

export function addInteractable(sceneId: string, interactable: Interactable): Edit {
  return {
    label: `Place ${interactable.kind}`,
    apply(project) {
      requireScene(project, sceneId).interactables.push(interactable);
    },
    undo(project) {
      const list = requireScene(project, sceneId).interactables;
      const at = list.lastIndexOf(interactable);
      if (at >= 0) list.splice(at, 1);
    },
  };
}

export function removeInteractable(sceneId: string, id: string): Edit {
  let removed: { item: Interactable; index: number } | null = null;
  return {
    label: 'Delete interactable',
    apply(project) {
      const list = requireScene(project, sceneId).interactables;
      const index = list.findIndex((i) => i.id === id);
      removed = index < 0 ? null : { item: list[index]!, index };
      if (index >= 0) list.splice(index, 1);
    },
    undo(project) {
      if (removed === null) return;
      requireScene(project, sceneId).interactables.splice(removed.index, 0, removed.item);
    },
  };
}

/** Replace an interactable's fields — what a properties panel commits. */
export function updateInteractable(
  sceneId: string,
  id: string,
  changes: Partial<Interactable>,
): Edit {
  let before: Interactable | null = null;
  return {
    label: 'Edit interactable',
    apply(project) {
      const list = requireScene(project, sceneId).interactables;
      const index = list.findIndex((i) => i.id === id);
      if (index < 0) return;
      before = { ...list[index]! };
      list[index] = { ...list[index]!, ...changes };
    },
    undo(project) {
      if (before === null) return;
      const list = requireScene(project, sceneId).interactables;
      const index = list.findIndex((i) => i.id === (changes.id ?? id));
      if (index >= 0) list[index] = before;
    },
  };
}

export function addEncounter(sceneId: string, encounter: Encounter): Edit {
  return {
    label: 'Add encounter',
    apply(project) {
      requireScene(project, sceneId).encounters.push(encounter);
    },
    undo(project) {
      const list = requireScene(project, sceneId).encounters;
      const at = list.lastIndexOf(encounter);
      if (at >= 0) list.splice(at, 1);
    },
  };
}

export function addAdversary(
  sceneId: string,
  encounterId: string,
  placement: Encounter['adversaries'][number],
): Edit {
  return {
    label: `Place ${placement.adversary}`,
    apply(project) {
      const encounter = requireEncounter(project, sceneId, encounterId);
      encounter.adversaries.push(placement);
    },
    undo(project) {
      const encounter = requireEncounter(project, sceneId, encounterId);
      const at = encounter.adversaries.lastIndexOf(placement);
      if (at >= 0) encounter.adversaries.splice(at, 1);
    },
  };
}

export function removeAdversary(sceneId: string, encounterId: string, placementId: string): Edit {
  let removed: { placement: Encounter['adversaries'][number]; index: number } | null = null;
  return {
    label: 'Delete adversary',
    apply(project) {
      const encounter = requireEncounter(project, sceneId, encounterId);
      const index = encounter.adversaries.findIndex((a) => a.id === placementId);
      removed = index < 0 ? null : { placement: encounter.adversaries[index]!, index };
      if (index >= 0) encounter.adversaries.splice(index, 1);
    },
    undo(project) {
      if (removed === null) return;
      requireEncounter(project, sceneId, encounterId).adversaries.splice(
        removed.index,
        0,
        removed.placement,
      );
    },
  };
}

/** Add or remove a trigger cell, whichever the tile currently is. */
export function toggleTriggerCell(sceneId: string, encounterId: string, point: Point): Edit {
  let added = false;
  return {
    label: 'Edit trigger',
    apply(project) {
      const encounter = requireEncounter(project, sceneId, encounterId);
      const index = encounter.triggerCells.findIndex((c) => c.x === point.x && c.y === point.y);
      if (index >= 0) {
        encounter.triggerCells.splice(index, 1);
        added = false;
      } else {
        encounter.triggerCells.push({ ...point });
        added = true;
      }
    },
    undo(project) {
      const encounter = requireEncounter(project, sceneId, encounterId);
      if (added) {
        const index = encounter.triggerCells.findIndex((c) => c.x === point.x && c.y === point.y);
        if (index >= 0) encounter.triggerCells.splice(index, 1);
      } else {
        encounter.triggerCells.push({ ...point });
      }
    },
  };
}

export function setSpawns(sceneId: string, spawns: readonly Point[]): Edit {
  let before: Point[] = [];
  return {
    label: 'Set spawn points',
    apply(project) {
      const scene = requireScene(project, sceneId);
      before = scene.spawns.map((p) => ({ ...p }));
      // A scene must always have somewhere to put the party.
      scene.spawns = spawns.length > 0 ? spawns.map((p) => ({ ...p })) : before;
    },
    undo(project) {
      requireScene(project, sceneId).spawns = before;
    },
  };
}

export function addScene(scene: SceneDoc): Edit {
  return {
    label: `Add scene ${scene.name || scene.id}`,
    apply(project) {
      project.scenes.push(scene);
    },
    undo(project) {
      const at = project.scenes.lastIndexOf(scene);
      if (at >= 0) project.scenes.splice(at, 1);
    },
  };
}

/**
 * Delete a scene.
 *
 * Refused for the last scene and for the one the project opens on — a project
 * with nowhere to start is not something the schema will parse, and finding that
 * out at Save time is too late to be useful.
 *
 * Effects elsewhere may still name the deleted scene. That is not repaired here:
 * `validateProject` reports a `goto` pointing at a scene that does not exist, so
 * Check finds it, and an author who deletes a room usually means to rewire what
 * led there rather than have a tool guess.
 */
export function removeScene(sceneId: string): Edit {
  let removed: { index: number; scene: SceneDoc } | null = null;
  return {
    label: 'Delete scene',
    apply(project) {
      removed = null;
      if (project.scenes.length <= 1) return;
      if (project.startScene === sceneId) return;
      const index = project.scenes.findIndex((scene) => scene.id === sceneId);
      if (index < 0) return;
      removed = { index, scene: project.scenes[index]! };
      project.scenes.splice(index, 1);
    },
    undo(project) {
      // Back where it was, so the scene list does not reorder itself on undo.
      if (removed !== null) project.scenes.splice(removed.index, 0, removed.scene);
    },
    isNoop() {
      return removed === null;
    },
  };
}

/** Choose the scene the project opens on. */
export function setStartScene(sceneId: string): Edit {
  let before = '';
  let changed = false;
  return {
    label: 'Set opening scene',
    apply(project) {
      changed = project.startScene !== sceneId && project.scenes.some((s) => s.id === sceneId);
      if (!changed) return;
      before = project.startScene;
      project.startScene = sceneId;
    },
    undo(project) {
      if (changed) project.startScene = before;
    },
    isNoop() {
      return !changed;
    },
  };
}

export function renameScene(sceneId: string, name: string): Edit {
  let before = '';
  return {
    label: 'Rename scene',
    apply(project) {
      const scene = requireScene(project, sceneId);
      before = scene.name;
      scene.name = name;
    },
    undo(project) {
      requireScene(project, sceneId).name = before;
    },
  };
}

/**
 * Grow or crop a scene.
 *
 * New tiles are the default terrain at height 0; content that falls outside the
 * new bounds is dropped, which is what the legacy `resizeMap` did — and the undo
 * puts every bit of it back.
 */
export function resizeScene(
  sceneId: string,
  width: number,
  height: number,
  fillTerrain = 'floor',
): Edit {
  let before: Pick<SceneDoc, 'width' | 'height' | 'terrain' | 'heights' | 'tints' | 'spawns' | 'decos' | 'interactables' | 'encounters'> | null =
    null;
  return {
    label: 'Resize scene',
    apply(project) {
      const scene = requireScene(project, sceneId);
      before = {
        width: scene.width,
        height: scene.height,
        terrain: [...scene.terrain],
        heights: [...scene.heights],
        ...(scene.tints === undefined ? {} : { tints: [...scene.tints] }),
        spawns: scene.spawns.map((p) => ({ ...p })),
        decos: [...scene.decos],
        interactables: [...scene.interactables],
        encounters: scene.encounters.map((e) => ({ ...e, adversaries: [...e.adversaries], triggerCells: [...e.triggerCells] })),
      } as typeof before;

      const terrain: string[] = new Array(width * height);
      const heights: number[] = new Array(width * height);
      const tints: string[] | undefined = scene.tints === undefined ? undefined : new Array(width * height);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const to = y * width + x;
          const inside = x < scene.width && y < scene.height;
          const from = y * scene.width + x;
          terrain[to] = inside ? scene.terrain[from]! : fillTerrain;
          heights[to] = inside ? scene.heights[from]! : 0;
          if (tints !== undefined) tints[to] = inside ? (scene.tints?.[from] ?? '') : '';
        }
      }

      scene.width = width;
      scene.height = height;
      scene.terrain = terrain;
      scene.heights = heights;
      if (tints !== undefined) scene.tints = tints;

      const fits = (p: Point): boolean => p.x < width && p.y < height;
      scene.decos = scene.decos.filter((d) => fits(d.position));
      scene.interactables = scene.interactables.filter((i) => fits(i.position));
      for (const encounter of scene.encounters) {
        encounter.adversaries = encounter.adversaries.filter((a) => fits(a.position));
        encounter.triggerCells = encounter.triggerCells.filter(fits);
      }
      const spawns = scene.spawns.filter(fits);
      scene.spawns = spawns.length > 0 ? spawns : [{ x: 0, y: 0 }];
    },
    undo(project) {
      if (before === null) return;
      Object.assign(requireScene(project, sceneId), before);
    },
  };
}

// ---------------------------------------------------------------------------

function requireScene(project: ProjectDoc, id: string): SceneDoc {
  const scene = project.scenes.find((s) => s.id === id);
  if (scene === undefined) throw new Error(`no scene "${id}" in this project`);
  return scene;
}

function requireEncounter(project: ProjectDoc, sceneId: string, encounterId: string): Encounter {
  const encounter = requireScene(project, sceneId).encounters.find((e) => e.id === encounterId);
  if (encounter === undefined) throw new Error(`no encounter "${encounterId}" in scene "${sceneId}"`);
  return encounter;
}

/** Tiles a rectangular brush covers, clipped to the scene. */
export function brushTiles(scene: SceneDoc, centre: Point, size = 1): number[] {
  const radius = Math.max(0, Math.floor((size - 1) / 2));
  const tiles: number[] = [];
  for (let y = centre.y - radius; y <= centre.y + radius; y++) {
    for (let x = centre.x - radius; x <= centre.x + radius; x++) {
      const point = { x, y };
      if (inBounds(scene, point)) tiles.push(tileIndex(scene, point));
    }
  }
  return tiles;
}
