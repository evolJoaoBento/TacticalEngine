/**
 * The ground as models rather than as coloured quads, drawn one mesh per kind of tile.
 *
 * A tile type can name a model — `terrain('floor', { model: 'grass-ground', scale: 1 })` —
 * and every tile of that type stands one. Every tile of that type is the point: a room is
 * hundreds of cells, so a group per cell is hundreds of draw calls, which measured at 35
 * frames a second falling to 1. They are instanced instead: one `InstancedMesh` per kind,
 * a matrix per cell, which is how the construction layer has always drawn its boxes.
 *
 * Grouped by kind of tile rather than by model, because the kind is what carries the size.
 * Two types naming the same file at different scales have to be two meshes — an instanced
 * mesh is one geometry at one size, and a floor piece filling its cell and the same file
 * shrunk to a pebble are not one draw call however much they share a URL.
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

import { Group, InstancedMesh, Matrix4, Mesh, Object3D, Quaternion, Vector3 } from 'three';
import type { PlacedPiece, TileGrid } from '../grid/grid';
import { placementCentre, type TileLayout } from './layout';
import type { BuiltModel } from './procedural/build';

/**
 * How a tile model is made: the view's own `build`, which resolves imports and library
 * alike. `scale` is how big the kind of tile says its model stands, in tiles, and is
 * passed through rather than applied here — the view sizes a model before seating it, so
 * the feet land on the tile at any size and a nudge across the cell stays the distance it
 * was authored as.
 */
export type BuildModel = (modelId: string, scale?: number) => BuiltModel;

/** Scratch, so a room of a thousand tiles allocates nothing per cell. */
const matrix = new Matrix4();
const position = new Vector3();
/** Whatever transform the file itself carries, which every instance inherits. */
const offset = new Vector3();
const rotation = new Quaternion();
const scaling = new Vector3();
/** A piece's own quarter turn, and the file's transform carried through it. */
const turn = new Quaternion();
const spun = new Quaternion();
const turned = new Vector3();
const UP = new Vector3(0, 1, 0);

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

/** A kind of tile that draws itself with a model, and every cell standing on it. */
interface TileKind {
  readonly model: string;
  /** In tiles, or absent for the model's own size. */
  readonly scale: number | undefined;
  readonly tiles: number[];
}

/** Which cells carry each kind, so one mesh can be built per kind rather than per cell. */
function tilesByKind(grid: TileGrid): Map<string, TileKind> {
  const byKind = new Map<string, TileKind>();
  for (let tile = 0; tile < grid.size; tile++) {
    const type = grid.terrainAt(tile);
    if (type.model === undefined) continue;
    const found = byKind.get(type.id);
    if (found !== undefined) {
      found.tiles.push(tile);
      continue;
    }
    byKind.set(type.id, { model: type.model, scale: type.scale, tiles: [tile] });
  }
  return byKind;
}

/**
 * One instanced mesh per kind of tile the ground draws with a model, each carrying every
 * cell that stands on it.
 *
 * Returns groups, for a caller that owns them. Nothing here is cached: a rebuild follows a
 * change to the grid or to what an id resolves to, and both make the old answer wrong.
 */
export function buildTileModels(grid: TileGrid, layout: TileLayout, build: BuildModel): Group[] {
  const made: Group[] = [];
  for (const [typeId, kind] of tilesByKind(grid)) {
    const built = build(kind.model, kind.scale);
    const mesh = loneMesh(built.group);
    // A model that deliberately sinks or floats. `instantiate` hands this back in the spec
    // for the caller to add rather than applying it, which is what every other placement
    // in the view does - and what the instanced path stopped doing when the seating
    // measurement it was tangled up with was removed.
    const lift = built.spec.groundOffset ?? 0;
    const group = new Group();
    group.name = `tiles:${typeId}`;
    if (mesh === null) {
      // Not instanceable - a procedural build of many parts, or a placeholder standing in
      // while the file is still on its way. One per tile, as it was, and the redraw when
      // the asset lands swaps it for the instanced kind.
      group.add(built.group);
      for (const tile of kind.tiles.slice(1)) {
        const extra = build(kind.model, kind.scale).group;
        place(extra, grid, layout, tile, lift);
        group.add(extra);
      }
      place(built.group, grid, layout, kind.tiles[0]!, lift);
      made.push(group);
      continue;
    }

    // Decomposed from what `build` made, not from the file it was made from. The built
    // clone already carries everything the project and the kind of tile say about the
    // model - how big it stands, which way it faces, how far across its cell - and has
    // been seated, feet on the tile. Reading the template instead dropped all of it: a
    // shipped model declares a scale of 0.5 and drew at 1.
    built.group.updateWorldMatrix(true, true);
    mesh.matrixWorld.decompose(offset, rotation, scaling);

    const instances = new InstancedMesh(mesh.geometry, mesh.material, kind.tiles.length);
    instances.name = `tiles:${typeId}:instances`;
    // A floor receives shadow and does not cast it. Casting would put every one of these
    // through the depth pass as well - a room of them is millions of triangles rendered
    // twice - to gain a tile's shadow on the tile beside it. `building-view` draws its own
    // geometry the same way: it casts from the nearest detail only.
    instances.castShadow = false;
    instances.receiveShadow = true;
    kind.tiles.forEach((tile, i) => {
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
  // The ground and the things standing on it, from one call: both are kinds of tile drawn
  // with a file, and a caller asking what this grid draws wants all of it.
  made.push(...buildPieceModels(grid, layout, build));
  return made;
}

/**
 * The pieces standing on the board, grouped by the kind of tile they are.
 *
 * Only the kinds drawn with a model: the rest are the building layer's, which draws them
 * as shaded boxes from their shape, and a piece drawn both ways is a grey box inside a
 * crate. `BuildingView.sync` skips exactly this set, from the same palette.
 */
function piecesByKind(grid: TileGrid): Map<string, { kind: TileKind; pieces: PlacedPiece[] }> {
  const byKind = new Map<string, { kind: TileKind; pieces: PlacedPiece[] }>();
  for (const piece of grid.pieces) {
    const type = grid.palette.at(piece.index);
    if (type.model === undefined) continue;
    const found = byKind.get(type.id);
    if (found !== undefined) {
      found.pieces.push(piece);
      continue;
    }
    byKind.set(type.id, {
      kind: { model: type.model, scale: type.scale, tiles: [] },
      pieces: [piece],
    });
  }
  return byKind;
}

/**
 * One instanced mesh per kind of piece, each carrying every piece of that kind.
 *
 * A piece stands at its own level rather than on the ground under it, and turns by the
 * quarter it was stamped at. Two things a box does that a file must not: it stretches to
 * `height`, and it is drawn wherever the shape says - a model is the thing itself, at the
 * size its kind declares, so neither applies.
 */
function buildPieceModels(grid: TileGrid, layout: TileLayout, build: BuildModel): Group[] {
  const made: Group[] = [];
  for (const [typeId, { kind, pieces }] of piecesByKind(grid)) {
    const built = build(kind.model, kind.scale);
    const mesh = loneMesh(built.group);
    const lift = built.spec.groundOffset ?? 0;
    const group = new Group();
    group.name = `pieces:${typeId}`;
    if (mesh === null) {
      // Still on its way, or a build of many parts: one per piece, as the ground does.
      for (const piece of pieces) {
        const extra = build(kind.model, kind.scale).group;
        const centre = placementCentre(grid, layout, { x: piece.x, y: piece.y, z: piece.level });
        extra.position.set(centre.x, centre.y + lift, centre.z);
        extra.rotation.y += piece.rotation * Math.PI / 2;
        group.add(extra);
      }
      made.push(group);
      continue;
    }

    built.group.updateWorldMatrix(true, true);
    mesh.matrixWorld.decompose(offset, rotation, scaling);

    const instances = new InstancedMesh(mesh.geometry, mesh.material, pieces.length);
    instances.name = `pieces:${typeId}:instances`;
    // Unlike the ground, a piece stands up off it: it casts as well as receives, which is
    // what makes a wall read as a wall rather than a painted strip.
    instances.castShadow = true;
    instances.receiveShadow = true;
    pieces.forEach((piece, i) => {
      // `placementCentre` with a `z` is the building layer's own vertical unit - one whole
      // tile per level - and not the ground's slabs of `levelHeight`. The two counts are
      // deliberately different, so this is the one that makes a piece agree with the box
      // the building view would have drawn in its place.
      const centre = placementCentre(grid, layout, { x: piece.x, y: piece.y, z: piece.level });
      turn.setFromAxisAngle(UP, piece.rotation * Math.PI / 2);
      spun.copy(turn).multiply(rotation);
      // The file's own offset turns with the piece, or a model that stands off its centre
      // would swing out of its cell as it was rotated.
      turned.copy(offset).applyQuaternion(turn);
      position.set(centre.x + turned.x, centre.y + lift + turned.y, centre.z + turned.z);
      matrix.compose(position, spun, scaling);
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
