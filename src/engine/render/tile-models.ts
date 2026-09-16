/**
 * The ground as models rather than as coloured quads, drawn one mesh per kind.
 *
 * A tile type can name a model — `terrain('floor', { model: 'grass-ground' })` — and every
 * tile of that type stands one. Every tile of that type is the point: a room is hundreds
 * of cells, so a group per cell is hundreds of draw calls, which measured at 35 frames a
 * second falling to 1. They are instanced instead: one `InstancedMesh` per model, a matrix
 * per cell, which is how the construction layer has always drawn its boxes.
 *
 * The geometry and the material belong to the `AssetLibrary`, which hands the same
 * template to the thumbnail strip and to every token drawn from that model. So the meshes
 * here are disposed and their geometry is not — freeing it would pull it out from under
 * whatever else is drawn from the same file.
 *
 * The ground mesh is still built underneath. A tile model is a look and nothing else: the
 * grid is what a raycast hits, what a walk costs and how high a tile stands, and none of
 * that may depend on whether a model happened to load.
 *
 * This lives apart from `SceneView` because that file is at its readable limit, not
 * because the two are separable — the view owns the groups and decides when to rebuild.
 */

import { Box3, Group, InstancedMesh, Matrix4, Mesh, Object3D, Quaternion, Vector3 } from 'three';
import type { TileGrid } from '../grid/grid';
import { placementCentre, type TileLayout } from './layout';
import type { BuiltModel } from './procedural/build';

/** How a tile model is made: the view's own `build`, which resolves imports and library alike. */
export type BuildModel = (modelId: string) => BuiltModel;

/** Scratch, so a room of a thousand tiles allocates nothing per cell. */
const matrix = new Matrix4();
const position = new Vector3();
/** Whatever transform the file itself carries, which every instance inherits. */
const offset = new Vector3();
const rotation = new Quaternion();
const scaling = new Vector3();
const measured = new Box3();

/**
 * The one mesh inside a built model, if it is the kind that can be instanced.
 *
 * An imported tile is one node, one mesh, one primitive - that is what a tile made to
 * tile looks like. A model that turns out to be several meshes, or a procedural build
 * with a whole group of parts, is not instanced; the caller stands it up as it is.
 */
function loneMesh(model: Object3D): Mesh | null {
  const meshes: Mesh[] = [];
  model.traverse((child) => {
    if ((child as Mesh).isMesh) meshes.push(child as Mesh);
  });
  return meshes.length === 1 ? meshes[0]! : null;
}

/**
 * How far to lift a model so it sits on the tile rather than through it.
 *
 * `seatOnTile` does this by moving a clone; an instance cannot be moved, so the same
 * measurement is taken once per kind and folded into every matrix. The example tiles are
 * modelled around their own middle - half of each is below y=0 - so without this a floor
 * lies half-buried.
 */
function seatingLift(mesh: Mesh): number {
  measured.setFromObject(mesh);
  return measured.isEmpty() ? 0 : -measured.min.y;
}

/** Which tiles carry each model, so one mesh can be built per kind rather than per cell. */
function tilesByModel(grid: TileGrid): Map<string, number[]> {
  const byModel = new Map<string, number[]>();
  for (let tile = 0; tile < grid.size; tile++) {
    const model = grid.terrainAt(tile).model;
    if (model === undefined) continue;
    const tiles = byModel.get(model);
    if (tiles === undefined) byModel.set(model, [tile]);
    else tiles.push(tile);
  }
  return byModel;
}

/**
 * One instanced mesh per model the ground names, each carrying every tile that wants it.
 *
 * Returns groups, for a caller that owns them. Nothing here is cached: a rebuild follows a
 * change to the grid or to what an id resolves to, and both make the old answer wrong.
 */
export function buildTileModels(grid: TileGrid, layout: TileLayout, build: BuildModel): Group[] {
  const made: Group[] = [];
  for (const [modelId, tiles] of tilesByModel(grid)) {
    const built = build(modelId);
    const mesh = loneMesh(built.group);
    const group = new Group();
    group.name = `tiles:${modelId}`;
    if (mesh === null) {
      // Not instanceable - a procedural build of many parts, or a placeholder standing in
      // while the file is still on its way. One per tile, as it was, and the redraw when
      // the asset lands swaps it for the instanced kind.
      group.add(built.group);
      for (const tile of tiles.slice(1)) {
        const extra = build(modelId).group;
        place(extra, grid, layout, tile, built.spec.groundOffset ?? 0);
        group.add(extra);
      }
      place(built.group, grid, layout, tiles[0]!, built.spec.groundOffset ?? 0);
      made.push(group);
      continue;
    }

    // Resolved first: `Box3` measures through world matrices, so a lift taken before this
    // would be measured off a stale one. The mesh's own transform is part of how the file
    // was authored, so every instance carries it.
    mesh.updateWorldMatrix(true, false);
    const lift = seatingLift(mesh) + (built.spec.groundOffset ?? 0);
    mesh.matrixWorld.decompose(offset, rotation, scaling);

    const instances = new InstancedMesh(mesh.geometry, mesh.material, tiles.length);
    instances.name = `tiles:${modelId}:instances`;
    instances.castShadow = true;
    instances.receiveShadow = true;
    tiles.forEach((tile, i) => {
      const centre = placementCentre(grid, layout, { x: tile % grid.width, y: Math.floor(tile / grid.width) });
      position.set(centre.x + offset.x, centre.y + lift + offset.y, centre.z + offset.z);
      matrix.compose(position, rotation, scaling);
      instances.setMatrixAt(i, matrix);
    });
    instances.instanceMatrix.needsUpdate = true;
    instances.computeBoundingSphere();
    group.add(instances);
    made.push(group);
  }
  return made;
}

/** Stand one built model on a tile, for the models that cannot be instanced. */
function place(model: Object3D, grid: TileGrid, layout: TileLayout, tile: number, lift: number): void {
  const centre = placementCentre(grid, layout, { x: tile % grid.width, y: Math.floor(tile / grid.width) });
  model.position.set(centre.x, centre.y + lift, centre.z);
}

/**
 * Take down the ground's models and put them up again, in one pass.
 *
 * The caller hands over what it drew last time and gets back what is drawn now, so it
 * holds the groups and nothing here remembers a scene. `forget` is how the view drops
 * whatever it keyed on a group it is losing - its clips - without this reaching into it.
 *
 * An instanced mesh is disposed; its geometry and material are not. Those belong to the
 * asset library, which hands the same template to the thumbnails and to every token drawn
 * from that model, and freeing them here would pull them out from under all of it.
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
    group.traverse((child) => {
      if (child instanceof InstancedMesh) child.dispose();
    });
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
