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

import { Box3, Group, InstancedMesh, Matrix4, Mesh, Object3D, Quaternion, Vector3 } from 'three';
import type { PlacedPiece, TileGrid } from '../grid/grid';
import { buildingParts } from '../scene/building';
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
/** A piece's own quarter turn, and the file's transform fitted to the box its structure is. */
const turn = new Quaternion();
const fitted = new Matrix4();
const bounds = new Box3();
const extent = new Vector3();
const ONE = new Vector3(1, 1, 1);
const stretch = new Matrix4();
const UP = new Vector3(0, 1, 0);
const toEdge = new Matrix4();

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
  /** The structure a piece of this kind is: the box its model is fitted to. */
  readonly structure?: string | undefined;
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
      const centre = placementCentre(grid, layout, onTheGround(grid, layout, tile));
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
      kind: { model: type.model, scale: type.scale, structure: type.structure, tiles: [] },
      pieces: [piece],
    });
  }
  return byKind;
}

/**
 * One instanced mesh per kind of piece, each carrying every piece of that kind.
 *
 * A piece stands at its own level rather than on the ground under it, and turns by the
 * quarter it was stamped at, and stretches to the piece's own `height` as a box does - half a
 * wall is drawn half as tall, because half as tall is how it is walked.
 *
 * A file is fitted to its structure in height: as tall as the rules say a creature stands on
 * it. The rules read the structure and never the file, so a block whose file came out of its
 * maker a tenth too tall is a block feet sink into, under a cursor lying inside it. Fitted,
 * what is drawn is what is walked on. A kind that declares no size is left as its file is.
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
        const edge = edgeOf(extra, kind, layout, build(kind.model, kind.scale).spec.pivot === 'file');
        const angle = piece.rotation * Math.PI / 2;
        // The edge offset turns with the piece, as it does for the instanced ones below.
        extra.position.set(centre.x + edge.x * Math.cos(angle) + edge.z * Math.sin(angle), centre.y + lift, centre.z - edge.x * Math.sin(angle) + edge.z * Math.cos(angle));
        extra.rotation.y += angle;
        group.add(extra);
      }
      made.push(group);
      continue;
    }

    built.group.updateWorldMatrix(true, true);
    fitted.copy(fitOf(built.group, kind)).multiply(mesh.matrixWorld);
    // Where in its cell the model stands: the middle, for a structure that fills the cell, and
    // flush against the edge for one that stands on it. Turned with the piece, so a wall goes
    // round the four edges as its box does.
    const edge = edgeOf(built.group, kind, layout, built.spec.pivot === 'file');
    toEdge.makeTranslation(edge.x, 0, edge.z);

    const instances = new InstancedMesh(mesh.geometry, mesh.material, pieces.length);
    instances.name = `pieces:${typeId}:instances`;
    // Unlike the ground, a piece stands up off it: it casts as well as receives, which is
    // what makes a wall read as a wall rather than a painted strip. A floor is the ground
    // again, and a room laid from floor tiles would put every one of them through the depth
    // pass to shade nothing.
    instances.castShadow = kind.structure !== 'floor';
    instances.receiveShadow = true;
    pieces.forEach((piece, i) => {
      // `placementCentre` with a `z` is the building layer's own vertical unit - one whole
      // tile per level - and not the ground's slabs of `levelHeight`. The two counts are
      // deliberately different, so this is the one that makes a piece agree with the box
      // the building view would have drawn in its place.
      const centre = placementCentre(grid, layout, { x: piece.x, y: piece.y, z: piece.level });
      turn.setFromAxisAngle(UP, piece.rotation * Math.PI / 2);
      // The file's own transform goes through the turn whole, so a model that stands off its
      // centre turns about the cell rather than swinging out of it.
      position.set(centre.x, centre.y + lift, centre.z);
      matrix.compose(position, turn, ONE).multiply(toEdge).multiply(stretch.makeScale(1, piece.height ?? 1, 1)).multiply(fitted);
      instances.setMatrixAt(i, matrix);
    });
    instances.instanceMatrix.needsUpdate = true;
    instances.computeBoundingSphere();
    group.add(instances);
    made.push(group);
  }
  return made;
}

/**
 * Where a model stands in its cell, before the piece turns it: the structure's own boxes say.
 *
 * Every model is seated centred over its footprint (`seatOnTile`), which is right for a block or
 * a floor, which fill the cell, and wrong for a wall, whose box is a thin slab along one edge -
 * seated, a wall was drawn through the middle of its tile while it barred the edge. So along each
 * axis where the structure's boxes do not reach across the cell, the model is moved to the side
 * they stand on, with its outer face on the cell's edge: inside its own square, flush with the
 * square it faces. A structure that fills the cell, or declares no boxes, stays in the middle, and
 * so does a model that keeps its file's own pivot: its maker has already said where it stands.
 */
function edgeOf(model: Object3D, kind: TileKind, layout: TileLayout, ownPivot = false): { x: number; z: number } {
  if (kind.structure === undefined || ownPivot) return { x: 0, z: 0 };
  const parts = buildingParts(kind.structure);
  if (parts.length === 0) return { x: 0, z: 0 };
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, , z, sx, , sz] of parts) {
    minX = Math.min(minX, x - sx / 2);
    maxX = Math.max(maxX, x + sx / 2);
    minZ = Math.min(minZ, z - sz / 2);
    maxZ = Math.max(maxZ, z + sz / 2);
  }
  model.updateWorldMatrix(true, true);
  bounds.setFromObject(model, true).getSize(extent);
  const size = layout.tileSize;
  const EDGE = 0.5 - 1e-6;
  const along = (lo: number, hi: number, depth: number): number => {
    const half = Math.min(depth, size) / 2;
    if (lo <= -EDGE && hi < EDGE) return -size / 2 + half;
    if (hi >= EDGE && lo > -EDGE) return size / 2 - half;
    return 0;
  };
  return { x: along(minX, maxX, extent.x), z: along(minZ, maxZ, extent.z) };
}

/**
 * The stretch that makes a seated model as tall as its structure stands, from its foot -
 * which is where a seated model is measured from, so it stays on its level. The identity for a
 * kind with no structure or no declared size, and for a model with nothing in it to measure.
 */
function fitOf(model: Object3D, kind: TileKind): Matrix4 {
  const fit = new Matrix4();
  if (kind.structure === undefined || kind.scale === undefined) return fit;
  const parts = buildingParts(kind.structure);
  // Vertex by vertex: a file whose mesh is turned inside its node has a loose box a good deal
  // bigger than it is, and a tile fitted to that is a tile with a gap all round it.
  bounds.setFromObject(model, true).getSize(extent);
  if (parts.length === 0 || extent.y <= 0) return fit;
  let top = 0;
  for (const [, y, , , sy] of parts) top = Math.max(top, y + sy / 2);
  // Up and down only. Across, a file is as wide as its maker made it, and the shipped ones
  // are a little wider than a tile on purpose: their stones overlap, and a wall of blocks
  // fitted edge to edge is a wall with a dark seam round every one.
  return fit.makeScale(1, (top * kind.scale) / extent.y, 1);
}

/**
 * A tile's own ground as a placement: the height given outright, in the tiles a placement
 * counts in. Left to itself a placement stands on top of whatever is stacked on the cell,
 * which is right for a creature and would float the earth up onto the wall built on it.
 */
function onTheGround(grid: TileGrid, layout: TileLayout, tile: number): { x: number; y: number; z: number } {
  return { x: tile % grid.width, y: Math.floor(tile / grid.width), z: (grid.heightAt(tile) * layout.levelHeight) / layout.tileSize };
}

/** Stand one built model on a tile, for the models that cannot be instanced. */
function place(model: Object3D, grid: TileGrid, layout: TileLayout, tile: number, lift: number): void {
  const centre = placementCentre(grid, layout, onTheGround(grid, layout, tile));
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
