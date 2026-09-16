/**
 * The ground as models rather than as coloured quads.
 *
 * A terrain type can name a model the way an adversary does — `terrain('floor', { model:
 * 'plank' })` — and every tile of that type stands one there. The model is whatever the
 * library or the project's imports can supply, so a `.glb` dropped into the Models panel
 * customises the floor the same way it customises a creature.
 *
 * The ground mesh is still built underneath. A tile model is a look and nothing else: the
 * grid is what a raycast hits, what a walk costs and how high a tile stands, and none of
 * that may depend on whether a model happened to load.
 *
 * This lives apart from `SceneView` because that file is at its readable limit, not
 * because the two are separable — the view owns the groups and decides when to rebuild.
 */

import type { Group, Object3D } from 'three';
import type { TileGrid } from '../grid/grid';
import { placementCentre, type TileLayout } from './layout';
import type { BuiltModel } from './procedural/build';

/** How a tile model is made: the view's own `build`, which resolves imports and library alike. */
export type BuildModel = (modelId: string) => BuiltModel;

/**
 * One model per tile whose terrain names one, placed at the tile's own height.
 *
 * Returns the groups, for a caller that owns them. Tiles are walked in index order so a
 * rebuild draws the same room twice; nothing here is cached, because a rebuild follows a
 * change to the grid or to what an id resolves to, and both make the old answer wrong.
 */
export function buildTileModels(grid: TileGrid, layout: TileLayout, build: BuildModel): Group[] {
  const made: Group[] = [];
  for (let tile = 0; tile < grid.size; tile++) {
    const model = grid.terrainAt(tile).model;
    if (model === undefined) continue;
    const built = build(model);
    const centre = placementCentre(grid, layout, { x: tile % grid.width, y: Math.floor(tile / grid.width) });
    built.group.position.set(centre.x, centre.y + (built.spec.groundOffset ?? 0), centre.z);
    built.group.name = `tile:${tile}`;
    made.push(built.group);
  }
  return made;
}

/**
 * Take down the ground's models and put them up again, in one pass.
 *
 * The caller hands over what it drew last time and gets back what is drawn now, so it
 * holds the groups and nothing here remembers a scene. `forget` is how the view drops
 * whatever it keyed on a group it is losing - its clips - without this reaching into it.
 */
export function redrawTileModels(
  root: Object3D,
  previous: readonly Group[],
  grid: TileGrid,
  layout: TileLayout,
  build: BuildModel,
  forget: (group: Group) => void,
): Group[] {
  for (const group of previous) {
    root.remove(group);
    forget(group);
  }
  const made = buildTileModels(grid, layout, build);
  for (const group of made) root.add(group);
  return made;
}

/** Whether a grid draws any tile with this model id, so a late-arriving asset knows to redraw. */
export function drawsTileModel(grid: TileGrid, modelId: string): boolean {
  return grid.palette.types.some((type) => type.model === modelId);
}
