/**
 * Editing the terrain palette: what a kind of ground is drawn with.
 *
 * Out of `session.ts` because that file is pinned at a size and this is a domain of its
 * own, the way the model edits are. Unlike those, it is imported where it is used rather
 * than re-exported from `session.ts` — two more lines there would put that file over its
 * pin, and a re-export is a convenience, not a contract.
 *
 * A project may declare no palette at all, which means "the engine's four". Naming a
 * model for one of them has to write the whole four down first: there is nowhere to hang
 * `floor`'s model until `floor` is a type the document knows about. Undo puts the
 * document back to having no palette, rather than leaving four types nobody asked for.
 */

import { DEFAULT_TERRAIN_TYPES } from '../engine/grid/terrain';
import type { ProjectDoc } from '../engine/scene/schema';
import type { Edit } from './session';

type DeclaredPalette = NonNullable<ProjectDoc['terrainPalette']>;

/** The four the engine ships, as a document would write them. */
function defaultPalette(): DeclaredPalette {
  return DEFAULT_TERRAIN_TYPES.map((type) => ({
    id: type.id,
    name: type.name,
    passable: type.passable,
    cost: type.cost,
    providesCover: type.providesCover,
    blocksSight: type.blocksSight,
    // Spread rather than assigned, so a type with none stays a type with none: the
    // schema draws the distinction and an explicit undefined is not absence.
    ...(type.color === undefined ? {} : { color: type.color }),
    ...(type.model === undefined ? {} : { model: type.model }),
  }));
}

/**
 * Draw every tile of one kind of ground with a model, or stop.
 *
 * `null` removes the naming rather than writing an empty id, so ground put back to being
 * coloured is the same document as ground that was never given a model — the same rule
 * `setAdversaryModel` follows for creatures.
 */
export function setTerrainModel(terrainId: string, modelId: string | null): Edit {
  let hadNoPalette = false;
  let before: string | undefined;
  let found = false;
  return {
    label: modelId === null ? `Clear ${terrainId} model` : `Draw ${terrainId} as ${modelId}`,
    apply(project) {
      hadNoPalette = project.terrainPalette === undefined;
      if (project.terrainPalette === undefined) project.terrainPalette = defaultPalette();
      const type = project.terrainPalette.find((t) => t.id === terrainId);
      found = type !== undefined;
      if (type === undefined) return;
      before = type.model;
      if (modelId === null) delete type.model;
      else type.model = modelId;
    },
    undo(project) {
      if (hadNoPalette) {
        delete project.terrainPalette;
        return;
      }
      const type = project.terrainPalette?.find((t) => t.id === terrainId);
      if (type === undefined) return;
      if (before === undefined) delete type.model;
      else type.model = before;
    },
    isNoop() {
      // Writing the four down is a change even when the model itself did not take.
      return !found && !hadNoPalette;
    },
  };
}

/** What a kind of tile is, as a document writes it. */
export type TileType = DeclaredPalette[number];

/** Whether an id is free to use: nothing else in the palette has it. */
export function tileIdTaken(project: ProjectDoc, id: string): boolean {
  const declared = project.terrainPalette ?? defaultPalette();
  return declared.some((type) => type.id === id);
}

/** How many cells across the whole project stand on this kind of tile. */
export function tilesStandingOn(project: ProjectDoc, terrainId: string): number {
  let count = 0;
  // A parsed project always has scenes; a raw one handed straight to an edit may not.
  for (const scene of project.scenes ?? []) {
    for (const id of scene.terrain ?? []) if (id === terrainId) count += 1;
  }
  return count;
}

/**
 * Add a kind of tile.
 *
 * The engine's four are written down first when a project has declared none, for the same
 * reason naming a model does: a list with one entry in it would mean the project had one
 * kind of ground, and every scene painted on the other three would fall back to it.
 */
export function addTerrainType(type: TileType): Edit {
  let hadNoPalette = false;
  let added = false;
  return {
    label: `Add tile ${type.id}`,
    apply(project) {
      hadNoPalette = project.terrainPalette === undefined;
      if (project.terrainPalette === undefined) project.terrainPalette = defaultPalette();
      added = !project.terrainPalette.some((t) => t.id === type.id);
      if (added) project.terrainPalette.push(type);
    },
    undo(project) {
      if (hadNoPalette) {
        delete project.terrainPalette;
        return;
      }
      if (!added || project.terrainPalette === undefined) return;
      const at = project.terrainPalette.findIndex((t) => t.id === type.id);
      if (at >= 0) project.terrainPalette.splice(at, 1);
    },
    isNoop() {
      return !added && !hadNoPalette;
    },
  };
}

/**
 * Change what a kind of tile is: its name, its colour, and what a walk over it costs.
 *
 * The id is deliberately not editable. Every scene cell names its type by id, so changing
 * one here would orphan every tile standing on it - that is a rename across the whole
 * project, not a field on a form.
 */
export function updateTerrainType(terrainId: string, changes: Partial<Omit<TileType, 'id'>>): Edit {
  let hadNoPalette = false;
  let before: TileType | null = null;
  return {
    label: `Edit tile ${terrainId}`,
    apply(project) {
      hadNoPalette = project.terrainPalette === undefined;
      if (project.terrainPalette === undefined) project.terrainPalette = defaultPalette();
      const at = project.terrainPalette.findIndex((t) => t.id === terrainId);
      before = at < 0 ? null : { ...project.terrainPalette[at]! };
      if (at < 0) return;
      // Absent means absent: a field cleared is deleted rather than written undefined,
      // which is the distinction `exactOptionalPropertyTypes` draws and the schema keeps.
      const next: TileType = { ...project.terrainPalette[at]!, ...changes };
      for (const key of Object.keys(changes) as (keyof typeof changes)[]) {
        if (changes[key] === undefined) delete next[key];
      }
      project.terrainPalette[at] = next;
    },
    undo(project) {
      if (hadNoPalette) {
        delete project.terrainPalette;
        return;
      }
      if (before === null || project.terrainPalette === undefined) return;
      const at = project.terrainPalette.findIndex((t) => t.id === terrainId);
      if (at >= 0) project.terrainPalette[at] = before;
    },
    isNoop() {
      return before === null && !hadNoPalette;
    },
  };
}

/**
 * Remove a kind of tile.
 *
 * Cells still naming it are left alone rather than rewritten: `gridFromScene` falls back
 * to the palette's first type and reports each unknown id once, so the map stays playable
 * and Check says what happened. Rewriting them would be a second, larger edit hiding
 * inside this one, and undo would have to put every cell back.
 */
export function removeTerrainType(terrainId: string): Edit {
  let removed: { index: number; type: TileType } | null = null;
  return {
    label: `Remove tile ${terrainId}`,
    apply(project) {
      removed = null;
      if (project.terrainPalette === undefined) project.terrainPalette = defaultPalette();
      // A palette of one is the floor every scene falls back to; taking it leaves nothing
      // for `gridFromScene` to resolve against, and `TerrainPalette` refuses an empty list.
      if (project.terrainPalette.length <= 1) return;
      const at = project.terrainPalette.findIndex((t) => t.id === terrainId);
      if (at < 0) return;
      removed = { index: at, type: project.terrainPalette[at]! };
      project.terrainPalette.splice(at, 1);
    },
    undo(project) {
      if (removed !== null) project.terrainPalette?.splice(removed.index, 0, removed.type);
    },
    isNoop() {
      return removed === null;
    },
  };
}
