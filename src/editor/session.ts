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

import type { CodeDef, Deco, Encounter, Interactable, Point, ProjectDoc, SceneDoc } from '../engine/scene/schema';
import type { Dialogue, DialogueChoice, DialogueNode } from '../engine/dialogue/schema';
import type { QuestDef, QuestObjective } from '../engine/content/quests';
import type { AbilityDef } from '../engine/content/abilities';
import type { ItemDef, LootTable } from '../engine/content/items';
import type { ModelAsset } from '../engine/render/assets';

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
/**
 * Change an object's fields.
 *
 * Successive edits to the *same fields* coalesce, so typing a name is one undo
 * step rather than one per keystroke. The merge key includes which fields are
 * changing, so renaming a thing and then rewriting its locked text stay separate
 * — undoing the second should not silently undo the first.
 */
export function updateInteractable(
  sceneId: string,
  id: string,
  changes: Partial<Interactable>,
): Edit {
  let before: Interactable | null = null;
  // Mutable, so an absorbed edit can extend what a redo replays; the first edit
  // keeps `before`, which is the state that predates all of them.
  const current: Partial<Interactable> = { ...changes };

  const edit: Edit = {
    label: 'Edit object',
    mergeKey: `interactable:${sceneId}:${id}:${Object.keys(changes).sort().join(',')}`,
    apply(project) {
      const list = requireScene(project, sceneId).interactables;
      const index = list.findIndex((i) => i.id === id);
      if (index < 0) return;
      before = { ...list[index]! };
      list[index] = { ...list[index]!, ...current };
    },
    undo(project) {
      if (before === null) return;
      const list = requireScene(project, sceneId).interactables;
      const index = list.findIndex((i) => i.id === (current.id ?? id));
      if (index >= 0) list[index] = before;
    },
    absorb(other) {
      const next = (other as Edit & { __changes?: Partial<Interactable> }).__changes;
      if (next === undefined) return false;
      Object.assign(current, next);
      return true;
    },
  };
  (edit as Edit & { __changes: Partial<Interactable> }).__changes = current;
  return edit;
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

/**
 * Change what one placed creature is: what it is drawn with, what it is called,
 * how much it can take. A `null` clears that override rather than storing it
 * empty, so a creature reverted to its type is the same document as one that
 * never carried an override at all.
 */
export function updateAdversary(
  sceneId: string,
  encounterId: string,
  placementId: string,
  changes: { model?: string | null; name?: string | null; hitPoints?: number | null },
): Edit {
  let before: { model?: string; name?: string; hitPoints?: number } | null = null;
  return {
    label: 'Edit creature',
    apply(project) {
      before = null;
      const encounter = requireEncounter(project, sceneId, encounterId);
      const placement = encounter.adversaries.find((a) => a.id === placementId);
      if (placement === undefined) return;
      before = {
        ...(placement.model === undefined ? {} : { model: placement.model }),
        ...(placement.name === undefined ? {} : { name: placement.name }),
        ...(placement.hitPoints === undefined ? {} : { hitPoints: placement.hitPoints }),
      };
      if ('model' in changes) {
        if (changes.model === null || changes.model === undefined) delete placement.model;
        else placement.model = changes.model;
      }
      if ('name' in changes) {
        if (changes.name === null || changes.name === undefined) delete placement.name;
        else placement.name = changes.name;
      }
      if ('hitPoints' in changes) {
        if (changes.hitPoints === null || changes.hitPoints === undefined) delete placement.hitPoints;
        else placement.hitPoints = changes.hitPoints;
      }
    },
    undo(project) {
      if (before === null) return;
      const encounter = requireEncounter(project, sceneId, encounterId);
      const placement = encounter.adversaries.find((a) => a.id === placementId);
      if (placement === undefined) return;
      delete placement.model;
      delete placement.name;
      delete placement.hitPoints;
      Object.assign(placement, before);
    },
    isNoop() {
      return before === null;
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
// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

function requireDialogue(project: ProjectDoc, dialogueId: string): Dialogue {
  const dialogue = project.dialogues.find((d) => d.id === dialogueId);
  if (dialogue === undefined) throw new Error(`no dialogue "${dialogueId}"`);
  return dialogue;
}

function requireNode(project: ProjectDoc, dialogueId: string, nodeId: string): DialogueNode {
  const node = requireDialogue(project, dialogueId).nodes.find((n) => n.id === nodeId);
  if (node === undefined) throw new Error(`no node "${nodeId}" in dialogue "${dialogueId}"`);
  return node;
}

export function addDialogue(dialogue: Dialogue): Edit {
  return {
    label: `Add conversation ${dialogue.id}`,
    apply(project) {
      project.dialogues.push(dialogue);
    },
    undo(project) {
      const at = project.dialogues.lastIndexOf(dialogue);
      if (at >= 0) project.dialogues.splice(at, 1);
    },
  };
}

/**
 * Delete a conversation.
 *
 * Effects elsewhere may still start it. That is not repaired here — the
 * validator reports a `startDialogue` naming nothing, and an author who deletes
 * a conversation usually means to rewire what opened it.
 */
export function removeDialogue(dialogueId: string): Edit {
  let removed: { index: number; dialogue: Dialogue } | null = null;
  return {
    label: 'Delete conversation',
    apply(project) {
      removed = null;
      const index = project.dialogues.findIndex((d) => d.id === dialogueId);
      if (index < 0) return;
      removed = { index, dialogue: project.dialogues[index]! };
      project.dialogues.splice(index, 1);
    },
    undo(project) {
      if (removed !== null) project.dialogues.splice(removed.index, 0, removed.dialogue);
    },
    isNoop() {
      return removed === null;
    },
  };
}

/** Which node a conversation opens on. */
export function setDialogueStart(dialogueId: string, nodeId: string): Edit {
  let before = '';
  let changed = false;
  return {
    label: 'Set opening node',
    apply(project) {
      const dialogue = requireDialogue(project, dialogueId);
      changed = dialogue.start !== nodeId && dialogue.nodes.some((n) => n.id === nodeId);
      if (!changed) return;
      before = dialogue.start;
      dialogue.start = nodeId;
    },
    undo(project) {
      if (changed) requireDialogue(project, dialogueId).start = before;
    },
    isNoop() {
      return !changed;
    },
  };
}

export function addNode(dialogueId: string, node: DialogueNode): Edit {
  return {
    label: 'Add node',
    apply(project) {
      requireDialogue(project, dialogueId).nodes.push(node);
    },
    undo(project) {
      const nodes = requireDialogue(project, dialogueId).nodes;
      const at = nodes.lastIndexOf(node);
      if (at >= 0) nodes.splice(at, 1);
    },
  };
}

/**
 * Delete a node.
 *
 * Refused for the node the conversation opens on. Replies pointing at the
 * deleted node are deliberately left dangling rather than rewired: `danglingLinks`
 * makes them visible, and an undo then puts everything back with nothing to
 * second-guess.
 */
export function removeNode(dialogueId: string, nodeId: string): Edit {
  let removed: { index: number; node: DialogueNode } | null = null;
  return {
    label: 'Delete node',
    apply(project) {
      removed = null;
      const dialogue = requireDialogue(project, dialogueId);
      if (dialogue.start === nodeId) return;
      const index = dialogue.nodes.findIndex((n) => n.id === nodeId);
      if (index < 0) return;
      removed = { index, node: dialogue.nodes[index]! };
      dialogue.nodes.splice(index, 1);
    },
    undo(project) {
      if (removed !== null) {
        requireDialogue(project, dialogueId).nodes.splice(removed.index, 0, removed.node);
      }
    },
    isNoop() {
      return removed === null;
    },
  };
}

/** Change a node's fields. Successive edits to the same fields coalesce. */
export function updateNode(
  dialogueId: string,
  nodeId: string,
  changes: Partial<DialogueNode>,
): Edit {
  let before: DialogueNode | null = null;
  const current: Partial<DialogueNode> = { ...changes };

  const edit: Edit = {
    label: 'Edit node',
    mergeKey: `node:${dialogueId}:${nodeId}:${Object.keys(changes).sort().join(',')}`,
    apply(project) {
      const dialogue = requireDialogue(project, dialogueId);
      const index = dialogue.nodes.findIndex((n) => n.id === nodeId);
      if (index < 0) return;
      before = { ...dialogue.nodes[index]! };
      dialogue.nodes[index] = { ...dialogue.nodes[index]!, ...current };
    },
    undo(project) {
      if (before === null) return;
      const dialogue = requireDialogue(project, dialogueId);
      const index = dialogue.nodes.findIndex((n) => n.id === nodeId);
      if (index >= 0) dialogue.nodes[index] = before;
    },
    absorb(other) {
      const next = (other as Edit & { __node?: Partial<DialogueNode> }).__node;
      if (next === undefined) return false;
      Object.assign(current, next);
      return true;
    },
  };
  (edit as Edit & { __node: Partial<DialogueNode> }).__node = current;
  return edit;
}

/**
 * Move a node on the canvas.
 *
 * A drag is one undo step, not one per pointer event — the same coalescing the
 * terrain brush uses, closed by `endGroup()` when the pointer comes up.
 */
export function moveNode(
  dialogueId: string,
  nodeId: string,
  position: { x: number; y: number },
): Edit {
  return updateNode(dialogueId, nodeId, { position });
}

export function addChoice(dialogueId: string, nodeId: string, choice: DialogueChoice): Edit {
  return {
    label: 'Add reply',
    apply(project) {
      const node = requireNode(project, dialogueId, nodeId);
      node.choices = [...(node.choices ?? []), choice];
    },
    undo(project) {
      const node = requireNode(project, dialogueId, nodeId);
      node.choices = (node.choices ?? []).slice(0, -1);
    },
  };
}

export function removeChoice(dialogueId: string, nodeId: string, index: number): Edit {
  let removed: DialogueChoice | null = null;
  return {
    label: 'Delete reply',
    apply(project) {
      removed = null;
      const node = requireNode(project, dialogueId, nodeId);
      const choices = node.choices ?? [];
      if (index < 0 || index >= choices.length) return;
      removed = choices[index]!;
      node.choices = choices.filter((_, i) => i !== index);
    },
    undo(project) {
      if (removed === null) return;
      const node = requireNode(project, dialogueId, nodeId);
      const choices = [...(node.choices ?? [])];
      choices.splice(index, 0, removed);
      node.choices = choices;
    },
    isNoop() {
      return removed === null;
    },
  };
}

/** Change one reply. Successive edits to the same fields coalesce. */
export function updateChoice(
  dialogueId: string,
  nodeId: string,
  index: number,
  changes: Partial<DialogueChoice>,
): Edit {
  let before: DialogueChoice | null = null;
  const current: Partial<DialogueChoice> = { ...changes };

  const edit: Edit = {
    label: 'Edit reply',
    mergeKey: `choice:${dialogueId}:${nodeId}:${index}:${Object.keys(changes).sort().join(',')}`,
    apply(project) {
      const node = requireNode(project, dialogueId, nodeId);
      const choices = [...(node.choices ?? [])];
      if (index < 0 || index >= choices.length) return;
      before = { ...choices[index]! };
      choices[index] = { ...choices[index]!, ...current };
      node.choices = choices;
    },
    undo(project) {
      if (before === null) return;
      const node = requireNode(project, dialogueId, nodeId);
      const choices = [...(node.choices ?? [])];
      if (index >= 0 && index < choices.length) choices[index] = before;
      node.choices = choices;
    },
    absorb(other) {
      const next = (other as Edit & { __choice?: Partial<DialogueChoice> }).__choice;
      if (next === undefined) return false;
      Object.assign(current, next);
      return true;
    },
  };
  (edit as Edit & { __choice: Partial<DialogueChoice> }).__choice = current;
  return edit;
}

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

// ---------------------------------------------------------------------------
// Quests
// ---------------------------------------------------------------------------

function requireQuest(project: ProjectDoc, questId: string): QuestDef {
  const quest = project.quests.find((q) => q.id === questId);
  if (quest === undefined) throw new Error(`no quest "${questId}"`);
  return quest;
}

export function addQuest(quest: QuestDef): Edit {
  return {
    label: `Add quest ${quest.id}`,
    apply(project) {
      project.quests.push(quest);
    },
    undo(project) {
      const at = project.quests.lastIndexOf(quest);
      if (at >= 0) project.quests.splice(at, 1);
    },
  };
}

/**
 * Delete a quest. Effects elsewhere may still name it; the validator reports
 * those, the way it does for a deleted conversation.
 */
export function removeQuest(questId: string): Edit {
  let removed: { index: number; quest: QuestDef } | null = null;
  return {
    label: 'Delete quest',
    apply(project) {
      removed = null;
      const index = project.quests.findIndex((q) => q.id === questId);
      if (index < 0) return;
      removed = { index, quest: project.quests[index]! };
      project.quests.splice(index, 1);
    },
    undo(project) {
      if (removed !== null) project.quests.splice(removed.index, 0, removed.quest);
    },
    isNoop() {
      return removed === null;
    },
  };
}

/** Rename or re-summarise a quest. Keystrokes into one field coalesce. */
export function updateQuest(questId: string, changes: Partial<Pick<QuestDef, 'name' | 'summary'>>): Edit {
  let before: QuestDef | null = null;
  const current: Partial<QuestDef> = { ...changes };
  const edit: Edit = {
    label: 'Edit quest',
    mergeKey: `quest:${questId}:${Object.keys(changes).sort().join(',')}`,
    apply(project) {
      const index = project.quests.findIndex((q) => q.id === questId);
      if (index < 0) return;
      before = project.quests[index]!;
      project.quests[index] = { ...before, ...current };
    },
    undo(project) {
      if (before === null) return;
      const index = project.quests.findIndex((q) => q.id === questId);
      if (index >= 0) project.quests[index] = before;
    },
    absorb(other) {
      const next = (other as Edit & { __quest?: Partial<QuestDef> }).__quest;
      if (next === undefined) return false;
      Object.assign(current, next);
      return true;
    },
  };
  (edit as Edit & { __quest: Partial<QuestDef> }).__quest = current;
  return edit;
}

export function addObjective(questId: string, objective: QuestObjective): Edit {
  return {
    label: 'Add objective',
    apply(project) {
      const quest = requireQuest(project, questId);
      quest.objectives = [...quest.objectives, objective];
    },
    undo(project) {
      const quest = requireQuest(project, questId);
      quest.objectives = quest.objectives.slice(0, -1);
    },
  };
}

/** A quest keeps at least one objective; removing the last is a no-op. */
export function removeObjective(questId: string, index: number): Edit {
  let removed: QuestObjective | null = null;
  return {
    label: 'Delete objective',
    apply(project) {
      removed = null;
      const quest = requireQuest(project, questId);
      if (index < 0 || index >= quest.objectives.length || quest.objectives.length <= 1) return;
      removed = quest.objectives[index]!;
      quest.objectives = quest.objectives.filter((_, i) => i !== index);
    },
    undo(project) {
      if (removed === null) return;
      const quest = requireQuest(project, questId);
      const objectives = [...quest.objectives];
      objectives.splice(index, 0, removed);
      quest.objectives = objectives;
    },
    isNoop() {
      return removed === null;
    },
  };
}

export function updateObjective(questId: string, index: number, changes: Partial<QuestObjective>): Edit {
  let before: QuestObjective | null = null;
  const current: Partial<QuestObjective> = { ...changes };
  const edit: Edit = {
    label: 'Edit objective',
    mergeKey: `objective:${questId}:${index}:${Object.keys(changes).sort().join(',')}`,
    apply(project) {
      const quest = requireQuest(project, questId);
      const objective = quest.objectives[index];
      if (objective === undefined) return;
      before = objective;
      quest.objectives = quest.objectives.map((o, i) => (i === index ? { ...o, ...current } : o));
    },
    undo(project) {
      if (before === null) return;
      const quest = requireQuest(project, questId);
      quest.objectives = quest.objectives.map((o, i) => (i === index ? before! : o));
    },
    absorb(other) {
      const next = (other as Edit & { __objective?: Partial<QuestObjective> }).__objective;
      if (next === undefined) return false;
      Object.assign(current, next);
      return true;
    },
  };
  (edit as Edit & { __objective: Partial<QuestObjective> }).__objective = current;
  return edit;
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

export function addAsset(asset: ModelAsset): Edit {
  return {
    label: `Add model ${asset.id}`,
    apply(project) {
      project.assets.push(asset);
    },
    undo(project) {
      const at = project.assets.lastIndexOf(asset);
      if (at >= 0) project.assets.splice(at, 1);
    },
  };
}

export function removeAsset(assetId: string): Edit {
  let removed: { index: number; asset: ModelAsset } | null = null;
  return {
    label: 'Delete model',
    apply(project) {
      removed = null;
      const index = project.assets.findIndex((a) => a.id === assetId);
      if (index < 0) return;
      removed = { index, asset: project.assets[index]! };
      project.assets.splice(index, 1);
    },
    undo(project) {
      if (removed !== null) project.assets.splice(removed.index, 0, removed.asset);
    },
    isNoop() {
      return removed === null;
    },
  };
}

/**
 * Change an imported model's settings: how big it is, how it sits on a tile,
 * which way it faces, and which of the file's clips play for each state.
 *
 * The id and the file itself are deliberately not editable here. Swapping the
 * file under a name that content already refers to is a different act with
 * different consequences, and goes through remove and add.
 *
 * `clips: null` drops the mapping rather than leaving empty names behind, so a
 * model put back to "just loop the first clip" is the same document as one that
 * never named a clip at all.
 */
export function updateAsset(
  assetId: string,
  changes: {
    scale?: number;
    groundOffset?: number;
    rotationY?: number;
    clips?: ModelAsset['clips'] | null;
  },
): Edit {
  let before: ModelAsset | null = null;
  return {
    label: `Edit model ${assetId}`,
    apply(project) {
      before = null;
      const asset = project.assets.find((a) => a.id === assetId);
      if (asset === undefined) return;
      // A shallow copy is enough: `clips` is replaced or deleted, never edited
      // in place, so the copy never shares a mutated object with the document.
      before = { ...asset };
      if (changes.scale !== undefined) asset.scale = changes.scale;
      if (changes.groundOffset !== undefined) asset.groundOffset = changes.groundOffset;
      if (changes.rotationY !== undefined) asset.rotationY = changes.rotationY;
      if ('clips' in changes) {
        if (changes.clips === null || changes.clips === undefined) delete asset.clips;
        else asset.clips = changes.clips;
      }
    },
    undo(project) {
      if (before === null) return;
      const index = project.assets.findIndex((a) => a.id === assetId);
      if (index < 0) return;
      project.assets[index] = before;
    },
    isNoop() {
      return before === null;
    },
  };
}

/**
 * What every creature of one type is drawn with, by adversary id. `null` removes
 * the entry rather than writing an empty id, so a type put back to its default
 * leaves nothing behind in the saved project.
 */
export function setAdversaryModel(adversaryId: string, modelId: string | null): Edit {
  let had: string | undefined;
  let existed = false;
  return {
    label: modelId === null ? 'Clear type model' : `Draw ${adversaryId} as ${modelId}`,
    apply(project) {
      existed = adversaryId in project.adversaryModels;
      had = project.adversaryModels[adversaryId];
      if (modelId === null) delete project.adversaryModels[adversaryId];
      else project.adversaryModels[adversaryId] = modelId;
    },
    undo(project) {
      if (existed && had !== undefined) project.adversaryModels[adversaryId] = had;
      else delete project.adversaryModels[adversaryId];
    },
  };
}

// ---------------------------------------------------------------------------
// Items and loot
// ---------------------------------------------------------------------------

/** Add an item. Its id is what a `loot` entry, a door and a script will name. */
export function addItem(item: ItemDef): Edit {
  return {
    label: `Add item ${item.id}`,
    apply(project) {
      project.items.push(item);
    },
    undo(project) {
      const at = project.items.lastIndexOf(item);
      if (at >= 0) project.items.splice(at, 1);
    },
  };
}

/**
 * Delete an item.
 *
 * A loot table or a locked door may still name it. That is left alone, the
 * same way a deleted piece of code is: the validator reports what now names
 * nothing, which is what an author needs to see.
 */
export function removeItem(itemId: string): Edit {
  let removed: { index: number; item: ItemDef } | null = null;
  return {
    label: 'Delete item',
    apply(project) {
      removed = null;
      const index = project.items.findIndex((i) => i.id === itemId);
      if (index < 0) return;
      removed = { index, item: project.items[index]! };
      project.items.splice(index, 1);
    },
    undo(project) {
      if (removed !== null) project.items.splice(removed.index, 0, removed.item);
    },
    isNoop() {
      return removed === null;
    },
  };
}

/** Edit an item. Typing into one field coalesces into one undo step. */
export function updateItem(itemId: string, changes: Partial<ItemDef>): Edit {
  let before: ItemDef | null = null;
  const current: Partial<ItemDef> = { ...changes };
  const edit: Edit = {
    label: 'Edit item',
    mergeKey: `item:${itemId}:${Object.keys(changes).sort().join(',')}`,
    apply(project) {
      const index = project.items.findIndex((i) => i.id === itemId);
      if (index < 0) return;
      before = project.items[index]!;
      project.items[index] = { ...before, ...current };
    },
    undo(project) {
      if (before === null) return;
      const index = project.items.findIndex((i) => i.id === itemId);
      if (index >= 0) project.items[index] = before;
    },
    absorb(other) {
      const next = (other as Edit & { __item?: Partial<ItemDef> }).__item;
      if (next === undefined) return false;
      Object.assign(current, next);
      return true;
    },
  };
  (edit as Edit & { __item: Partial<ItemDef> }).__item = current;
  return edit;
}

/** Add a loot table. A `loot` effect draws from it by id. */
export function addLootTable(table: LootTable): Edit {
  return {
    label: `Add loot table ${table.id}`,
    apply(project) {
      project.lootTables.push(table);
    },
    undo(project) {
      const at = project.lootTables.lastIndexOf(table);
      if (at >= 0) project.lootTables.splice(at, 1);
    },
  };
}

export function removeLootTable(tableId: string): Edit {
  let removed: { index: number; table: LootTable } | null = null;
  return {
    label: 'Delete loot table',
    apply(project) {
      removed = null;
      const index = project.lootTables.findIndex((t) => t.id === tableId);
      if (index < 0) return;
      removed = { index, table: project.lootTables[index]! };
      project.lootTables.splice(index, 1);
    },
    undo(project) {
      if (removed !== null) project.lootTables.splice(removed.index, 0, removed.table);
    },
    isNoop() {
      return removed === null;
    },
  };
}

/** Edit a loot table: how many draws, and the entries drawn from. */
export function updateLootTable(tableId: string, changes: Partial<LootTable>): Edit {
  let before: LootTable | null = null;
  const current: Partial<LootTable> = { ...changes };
  const edit: Edit = {
    label: 'Edit loot table',
    mergeKey: `loot:${tableId}:${Object.keys(changes).sort().join(',')}`,
    apply(project) {
      const index = project.lootTables.findIndex((t) => t.id === tableId);
      if (index < 0) return;
      before = project.lootTables[index]!;
      project.lootTables[index] = { ...before, ...current };
    },
    undo(project) {
      if (before === null) return;
      const index = project.lootTables.findIndex((t) => t.id === tableId);
      if (index >= 0) project.lootTables[index] = before;
    },
    absorb(other) {
      const next = (other as Edit & { __loot?: Partial<LootTable> }).__loot;
      if (next === undefined) return false;
      Object.assign(current, next);
      return true;
    },
  };
  (edit as Edit & { __loot: Partial<LootTable> }).__loot = current;
  return edit;
}

// ---------------------------------------------------------------------------
// The party
// ---------------------------------------------------------------------------

/**
 * A sheet as the project holds it. The interface in `character/sheet.ts` has
 * readonly arrays; what a document carries, and what an edit writes back, is
 * the parsed shape.
 */
export type PartySheet = ProjectDoc['party'][number];

/** Add a character. Their id is what a spawn, a granted card and a save name. */
export function addSheet(sheet: PartySheet): Edit {
  return {
    label: `Add ${sheet.name || sheet.id}`,
    apply(project) {
      project.party.push(sheet);
    },
    undo(project) {
      const at = project.party.lastIndexOf(sheet);
      if (at >= 0) project.party.splice(at, 1);
    },
  };
}

/**
 * Remove a character.
 *
 * The document changes now; the board catches up when Play is pressed
 * (`syncRoster`), and not in the middle of a fight: pulling somebody out from
 * under a spotlight that may be on them is not an edit, it is a crash.
 */
export function removeSheet(characterId: string): Edit {
  let removed: { index: number; sheet: PartySheet } | null = null;
  return {
    label: 'Remove from the party',
    apply(project) {
      removed = null;
      const index = project.party.findIndex((s) => s.id === characterId);
      if (index < 0) return;
      removed = { index, sheet: project.party[index]! };
      project.party.splice(index, 1);
    },
    undo(project) {
      if (removed !== null) project.party.splice(removed.index, 0, removed.sheet);
    },
    isNoop() {
      return removed === null;
    },
  };
}

/**
 * Edit a sheet. Typing into one field coalesces into one undo step.
 *
 * Undo puts back only the fields this edit wrote. The party is the one list
 * the *game* also writes — a level taken at the table, a card recalled — and
 * restoring the whole sheet would quietly undo that too, hours later, from a
 * panel that never knew about it.
 */
export function updateSheet(characterId: string, changes: Partial<PartySheet>): Edit {
  let before: Partial<PartySheet> = {};
  const current: Partial<PartySheet> = { ...changes };
  const edit: Edit = {
    label: 'Edit a character',
    mergeKey: `sheet:${characterId}:${Object.keys(changes).sort().join(',')}`,
    apply(project) {
      const index = project.party.findIndex((s) => s.id === characterId);
      if (index < 0) return;
      const sheet = project.party[index]!;
      before = Object.fromEntries(Object.keys(current).map((key) => [key, sheet[key as keyof PartySheet]]));
      project.party[index] = { ...sheet, ...current };
    },
    undo(project) {
      const index = project.party.findIndex((s) => s.id === characterId);
      if (index >= 0) project.party[index] = { ...project.party[index]!, ...before };
    },
    absorb(other) {
      const next = (other as Edit & { __sheet?: Partial<PartySheet> }).__sheet;
      if (next === undefined) return false;
      Object.assign(current, next);
      return true;
    },
  };
  (edit as Edit & { __sheet: Partial<PartySheet> }).__sheet = current;
  return edit;
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

/** Add a card. Its id is what a sheet's loadout and a token effect will name. */
export function addAbility(ability: AbilityDef): Edit {
  return {
    label: `Add card ${ability.id}`,
    apply(project) {
      project.abilities.push(ability);
    },
    undo(project) {
      const at = project.abilities.lastIndexOf(ability);
      if (at >= 0) project.abilities.splice(at, 1);
    },
  };
}

/**
 * Delete a card.
 *
 * A character sheet may still hold it. That is left alone here, the same way a
 * deleted piece of code is: the validator reports what now names nothing, which
 * is what an author needs to see.
 */
export function removeAbility(abilityId: string): Edit {
  let removed: { index: number; ability: AbilityDef } | null = null;
  return {
    label: 'Delete card',
    apply(project) {
      removed = null;
      const index = project.abilities.findIndex((a) => a.id === abilityId);
      if (index < 0) return;
      removed = { index, ability: project.abilities[index]! };
      project.abilities.splice(index, 1);
    },
    undo(project) {
      if (removed !== null) project.abilities.splice(removed.index, 0, removed.ability);
    },
    isNoop() {
      return removed === null;
    },
  };
}

/**
 * Edit a card. Typing into one field coalesces into one undo step, as the
 * other text editors do; changing a different field starts a new one.
 */
export function updateAbility(abilityId: string, changes: Partial<AbilityDef>): Edit {
  let before: AbilityDef | null = null;
  const current: Partial<AbilityDef> = { ...changes };
  const edit: Edit = {
    label: 'Edit card',
    mergeKey: `ability:${abilityId}:${Object.keys(changes).sort().join(',')}`,
    apply(project) {
      const index = project.abilities.findIndex((a) => a.id === abilityId);
      if (index < 0) return;
      before = project.abilities[index]!;
      project.abilities[index] = { ...before, ...current };
    },
    undo(project) {
      if (before === null) return;
      const index = project.abilities.findIndex((a) => a.id === abilityId);
      if (index >= 0) project.abilities[index] = before;
    },
    absorb(other) {
      const next = (other as Edit & { __ability?: Partial<AbilityDef> }).__ability;
      if (next === undefined) return false;
      Object.assign(current, next);
      return true;
    },
  };
  (edit as Edit & { __ability: Partial<AbilityDef> }).__ability = current;
  return edit;
}

// ---------------------------------------------------------------------------
// Logic in code
// ---------------------------------------------------------------------------

/** Add a piece of project code. Its id is what a `run` effect will name. */
export function addCode(code: CodeDef): Edit {
  return {
    label: `Add code ${code.id}`,
    apply(project) {
      project.code.push(code);
    },
    undo(project) {
      const at = project.code.lastIndexOf(code);
      if (at >= 0) project.code.splice(at, 1);
    },
  };
}

/**
 * Delete a piece of code.
 *
 * A card may still run it. That is not repaired here — the validator reports a
 * `run` naming nothing, which is what an author needs to see.
 */
export function removeCode(codeId: string): Edit {
  let removed: { index: number; code: CodeDef } | null = null;
  return {
    label: 'Delete code',
    apply(project) {
      removed = null;
      const index = project.code.findIndex((c) => c.id === codeId);
      if (index < 0) return;
      removed = { index, code: project.code[index]! };
      project.code.splice(index, 1);
    },
    undo(project) {
      if (removed !== null) project.code.splice(removed.index, 0, removed.code);
    },
    isNoop() {
      return removed === null;
    },
  };
}

/** Edit a piece of code. Typing into one field coalesces into one undo step. */
export function updateCode(codeId: string, changes: Partial<Pick<CodeDef, 'name' | 'notes' | 'source'>>): Edit {
  let before: CodeDef | null = null;
  const current: Partial<CodeDef> = { ...changes };
  const edit: Edit = {
    label: 'Edit code',
    mergeKey: `code:${codeId}:${Object.keys(changes).sort().join(',')}`,
    apply(project) {
      const index = project.code.findIndex((c) => c.id === codeId);
      if (index < 0) return;
      before = project.code[index]!;
      project.code[index] = { ...before, ...current };
    },
    undo(project) {
      if (before === null) return;
      const index = project.code.findIndex((c) => c.id === codeId);
      if (index >= 0) project.code[index] = before;
    },
    absorb(other) {
      const next = (other as Edit & { __code?: Partial<CodeDef> }).__code;
      if (next === undefined) return false;
      Object.assign(current, next);
      return true;
    },
  };
  (edit as Edit & { __code: Partial<CodeDef> }).__code = current;
  return edit;
}
