/**
 * Editing the project's imported materials (`TileSurface`): one imported, with the four kinds of tile drawn in it, as
 * one step undo takes back whole (`importTileSurface`); one tuned (`updateTileSurface`); one removed, its kinds with it
 * (`removeTileSurface`).
 *
 * Out of `session.ts`, as the terrain edits are, and imported where it is used. A project that declares no palette yet
 * has the engine's own written down first, as adding a kind of tile does (`terrain-edits.ts`): there is nowhere to put
 * a fifth kind until the four are kinds the document knows.
 */

import { MAX_TERRAIN_TYPES } from '../engine/grid/terrain';
import type { ProjectDoc, TileSurface } from '../engine/scene/schema';
import type { SurfaceKind } from '../engine/content/tile-surface-kit';
import type { Edit } from './session';
import { defaultPalette } from './terrain-edits';

type TileType = NonNullable<ProjectDoc['terrainPalette']>[number];

/** Why a material and its kinds cannot be added to a project, if they cannot: a palette has room for so many kinds. */
export function roomForSurface(project: ProjectDoc, kinds: number): string | null {
  // One place is the void every palette keeps for itself (`VOID_TERRAIN`).
  const after = (project.terrainPalette ?? defaultPalette()).length + kinds;
  return after > MAX_TERRAIN_TYPES - 1 ? `A project holds at most ${MAX_TERRAIN_TYPES - 1} kinds of tile; this material's ${kinds} would make ${after}.` : null;
}

/** A material imported, and the four kinds of tile drawn in it: one step, undone whole. */
export function importTileSurface(surface: TileSurface, kinds: readonly SurfaceKind[]): Edit {
  let hadNoPalette = false;
  let hadNoSurfaces = false;
  let added = false;
  return {
    label: `Import surface ${surface.id}`,
    apply(project) {
      added = false;
      if ((project.surfaces ?? []).some((s) => s.id === surface.id)) return;
      if (kinds.some((kind) => (project.terrainPalette ?? defaultPalette()).some((t) => t.id === kind.id))) return;
      hadNoPalette = project.terrainPalette === undefined;
      hadNoSurfaces = project.surfaces === undefined;
      if (project.terrainPalette === undefined) project.terrainPalette = defaultPalette();
      project.surfaces = [...(project.surfaces ?? []), surface];
      project.terrainPalette.push(...kinds.map((kind) => ({ ...kind })));
      added = true;
    },
    undo(project) {
      if (!added) return;
      if (hadNoSurfaces) delete project.surfaces;
      else project.surfaces = (project.surfaces ?? []).filter((s) => s.id !== surface.id);
      if (hadNoPalette) delete project.terrainPalette;
      else if (project.terrainPalette !== undefined) project.terrainPalette = project.terrainPalette.filter((t) => !kinds.some((kind) => kind.id === t.id));
    },
    isNoop() {
      return !added;
    },
  };
}

/** What may be tuned of a material once it is imported: its maps are not among them - new maps are a new import. */
export type SurfaceChanges = Partial<Pick<TileSurface, 'name' | 'size' | 'depth' | 'normalScale' | 'roughness' | 'tint'>>;

/**
 * A material tuned: its name, how big a repeat is, how deep it reads, how strong its normal, how rough. A slider
 * dragged is one step: each change of the same fields is absorbed into the first, which keeps what was before them all.
 */
export function updateTileSurface(id: string, changes: SurfaceChanges): Edit & { __changes: SurfaceChanges } {
  let before: TileSurface | null = null;
  const current: SurfaceChanges = { ...changes };
  return {
    label: `Edit surface ${id}`,
    mergeKey: `surface:${id}:${Object.keys(changes).sort().join(',')}`,
    __changes: changes,
    apply(project) {
      const at = (project.surfaces ?? []).findIndex((s) => s.id === id);
      before = at < 0 ? null : project.surfaces![at]!;
      if (before === null) return;
      project.surfaces![at] = { ...before, ...current };
    },
    undo(project) {
      if (before === null) return;
      const at = (project.surfaces ?? []).findIndex((s) => s.id === id);
      if (at >= 0) project.surfaces![at] = before;
    },
    absorb(other) {
      const next = (other as Edit & { __changes?: SurfaceChanges }).__changes;
      if (next === undefined) return false;
      Object.assign(current, next);
      return true;
    },
    isNoop() {
      return before === null;
    },
  };
}

/**
 * A material's maps replaced by the same maps compressed for the GPU (`compressMaps`): the one change to a material's
 * maps that is not a new import, since what they show is what they showed. One step, undone to the maps it had.
 */
export function replaceSurfaceMaps(id: string, maps: TileSurface['maps']): Edit {
  let before: TileSurface | null = null;
  return {
    label: `Compress surface ${id}`,
    apply(project) {
      const at = (project.surfaces ?? []).findIndex((s) => s.id === id);
      before = at < 0 ? null : project.surfaces![at]!;
      if (before === null) return;
      project.surfaces![at] = { ...before, maps };
    },
    undo(project) {
      if (before === null) return;
      const at = (project.surfaces ?? []).findIndex((s) => s.id === id);
      if (at >= 0) project.surfaces![at] = before;
    },
    isNoop() {
      return before === null;
    },
  };
}

/**
 * A material removed, and every kind of tile drawn in it. Pieces already laid of those kinds are left alone, as
 * removing a kind of tile leaves them (`removeTerrainType`): the grid falls back to the palette's first kind for each,
 * and Check says so, rather than this hiding a larger edit inside itself.
 */
export function removeTileSurface(id: string): Edit {
  let removed: { surface: { index: number; value: TileSurface }; kinds: { index: number; value: TileType }[] } | null = null;
  return {
    label: `Remove surface ${id}`,
    apply(project) {
      removed = null;
      const at = (project.surfaces ?? []).findIndex((s) => s.id === id);
      if (at < 0) return;
      const kinds: { index: number; value: TileType }[] = [];
      (project.terrainPalette ?? []).forEach((value, index) => {
        if (value.surface === id) kinds.push({ index, value });
      });
      // A palette must keep one kind at least: the floor every scene falls back to.
      if (kinds.length > 0 && kinds.length >= (project.terrainPalette ?? []).length) return;
      removed = { surface: { index: at, value: project.surfaces![at]! }, kinds };
      project.surfaces!.splice(at, 1);
      if (project.terrainPalette !== undefined) project.terrainPalette = project.terrainPalette.filter((t) => t.surface !== id);
    },
    undo(project) {
      if (removed === null) return;
      (project.surfaces ??= []).splice(removed.surface.index, 0, removed.surface.value);
      for (const kind of removed.kinds) project.terrainPalette?.splice(kind.index, 0, kind.value);
    },
    isNoop() {
      return removed === null;
    },
  };
}
