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

  /** Apply an edit, coalescing it into the last one when both agree to. */
  run(edit: Edit): void {
    // Apply first: an edit only knows what it replaced once it has run, and the
    // previous edit needs exactly that to extend its own undo record.
    edit.apply(this.project);

    const last = this.done[this.done.length - 1];
    const mergeable =
      last !== undefined &&
      this.undone.length === 0 &&
      // A save is a boundary: coalescing into an already-saved edit would leave
      // the document changed and the session claiming to be clean.
      this.done.length > this.savedAt &&
      last.mergeKey !== undefined &&
      last.mergeKey === edit.mergeKey;
    if (mergeable && last!.absorb?.(edit) === true) {
      this.notify();
      return;
    }

    this.done.push(edit);
    if (this.done.length > this.limit) {
      this.done.shift();
      // Everything before the window is now unreachable, including the save mark.
      this.savedAt = Math.max(0, this.savedAt - 1);
    }
    // A new edit discards the redo branch, as every editor does.
    this.undone.length = 0;
    this.notify();
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
): Edit {
  // Every tile this edit is responsible for. It grows as drags are absorbed, and
  // it — not the original argument — is what a redo replays, or a merged drag
  // would come back only in part.
  const targets: number[] = [...tiles];
  // Parallel arrays rather than a Map: a brush drag appends thousands of times.
  const changed: number[] = [];
  const previous: T[] = [];

  const edit: Edit = {
    label,
    mergeKey,
    apply(project) {
      const array = read(requireScene(project, sceneId));
      changed.length = 0;
      previous.length = 0;
      for (const tile of targets) {
        const current = array[tile];
        // Skip tiles already holding the value, so re-dragging over painted
        // ground does not fill the history with no-ops.
        if (current === undefined || current === value) continue;
        changed.push(tile);
        previous.push(current);
        array[tile] = value;
      }
    },
    undo(project) {
      const array = read(requireScene(project, sceneId));
      changed.forEach((tile, i) => {
        array[tile] = previous[i]!;
      });
    },
    absorb(other) {
      const record = (other as Edit & { __tiles?: { changed: number[]; previous: T[]; targets: number[] } })
        .__tiles;
      if (record === undefined) return false;
      record.changed.forEach((tile, i) => {
        // A tile this edit already touched keeps its *original* value, which is
        // the one undo has to restore.
        if (changed.includes(tile)) return;
        changed.push(tile);
        previous.push(record.previous[i]!);
      });
      for (const tile of record.targets) {
        if (!targets.includes(tile)) targets.push(tile);
      }
      return true;
    },
  };
  (edit as Edit & { __tiles: unknown }).__tiles = { changed, previous, targets };
  return edit;
}

/**
 * Paint terrain onto tiles. Dragging a brush is one undo step.
 */
export function paintTerrain(sceneId: string, tiles: readonly number[], terrainId: string): Edit {
  return tileValueEdit(
    sceneId,
    tiles,
    terrainId,
    `Paint ${terrainId}`,
    `paint:${sceneId}:${terrainId}`,
    (scene) => scene.terrain,
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
