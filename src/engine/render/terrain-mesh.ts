/**
 * The ground, as ground.
 *
 * The game is not played on a grid, so the board must not look like one.
 * Every tile still has a place in the `TileGrid` underneath - that is the
 * navmesh - but what is drawn is one continuous surface per terrain type:
 * a top face per tile, a wall where the ground drops, and colours blended
 * across corners so an authored tint reads as a patch of ground rather than
 * a square of it. Only a change of height draws an edge, because a step up
 * is a real thing in the world and a tile boundary is not.
 *
 * One `Mesh` per terrain type that appears, so a big room is still a handful
 * of draw calls; a face knows which tile it belongs to, so a raycast can name
 * the tile it struck without reading the hit point back through the layout.
 */

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Mesh,
  MeshStandardMaterial,
  type Material,
} from 'three';
import type { TileGrid } from '../grid/grid';
import { VOID_TERRAIN_ID } from '../grid/terrain';
import { DEFAULT_LAYOUT, standHeight, surfaceHeight, tileCenter, type TileLayout } from './layout';

export interface TerrainMeshOptions {
  layout?: TileLayout;
  /**
   * Per-tile colour, row-major, as authored in `SceneDoc.tints`. Entries that are
   * empty or unparseable fall back to the terrain type's own colour.
   */
  tints?: readonly string[];
  /** Fallback colour per terrain id, for tiles with no tint of their own. */
  palette?: Readonly<Record<string, string>>;
}

export const DEFAULT_TERRAIN_COLORS: Readonly<Record<string, string>> = {
  floor: '#5d8a4a',
  difficult: '#6b6350',
  cover: '#7d7a6d',
  wall: '#3b3f4a',
};

const FALLBACK_COLOR = '#5d8a4a';

export interface TerrainMesh {
  /**
   * One mesh per terrain type that actually appears on the map - and, where anything is
   * stacked, one more that is never drawn: the columns as high as a creature stands, which is
   * what a pointer looking for ground strikes.
   */
  readonly meshes: Mesh[];
  /**
   * Only the ground that is drawn. What hides a thing from a press is what is seen in front
   * of it, and the undrawn columns are in front of half of what stands in a doorway.
   */
  readonly drawn: Mesh[];
  /** The tile a face of a mesh belongs to, for a raycast; `-1` for a face that is not there. */
  tileOf(mesh: Mesh, faceIndex: number): number;
  /** Release the geometry and materials this built. */
  dispose(): void;
}

/**
 * The four corners of a tile's top, as (sign x, sign z) pairs, in the order
 * that faces the top upward: counter-clockwise seen from above, where +x is
 * to the right and +z towards the viewer.
 */
const CORNERS: readonly [number, number][] = [
  [-1, -1],
  [-1, 1],
  [1, 1],
  [1, -1],
];

/**
 * The sides of a tile as the neighbour they face: its offset, the two corners
 * of the top edge along it (in the order that makes the wall face outward),
 * and the wall's normal.
 */
const SIDES: readonly { dx: number; dy: number; a: number; b: number; normal: [number, number, number] }[] = [
  { dx: 0, dy: -1, a: 0, b: 3, normal: [0, 0, -1] },
  { dx: 1, dy: 0, a: 3, b: 2, normal: [1, 0, 0] },
  { dx: 0, dy: 1, a: 2, b: 1, normal: [0, 0, 1] },
  { dx: -1, dy: 0, a: 1, b: 0, normal: [-1, 0, 0] },
];

/** Grows a geometry a quad at a time; one per terrain type. */
class Surface {
  readonly positions: number[] = [];
  readonly normals: number[] = [];
  readonly colors: number[] = [];
  readonly faceTiles: number[] = [];

  /** A quad from four corners in order, lit along one normal, coloured per corner. */
  quad(
    corners: readonly [number, number, number][],
    normal: readonly [number, number, number],
    colors: readonly Color[],
    tile: number,
  ): void {
    const order = [0, 1, 2, 0, 2, 3];
    for (const i of order) {
      const [x, y, z] = corners[i]!;
      const c = colors[i]!;
      this.positions.push(x, y, z);
      this.normals.push(normal[0], normal[1], normal[2]);
      this.colors.push(c.r, c.g, c.b);
    }
    this.faceTiles.push(tile, tile);
  }

  build(): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(this.positions), 3));
    geometry.setAttribute('normal', new BufferAttribute(new Float32Array(this.normals), 3));
    geometry.setAttribute('color', new BufferAttribute(new Float32Array(this.colors), 3));
    geometry.computeBoundingSphere();
    return geometry;
  }
}

/**
 * Build the ground for a grid: a continuous surface per terrain type, with a
 * wall wherever the ground drops to a lower neighbour or off the edge of the
 * map, so a raised tile reads as a slab and a tall one as a wall.
 */
export function buildTerrainMesh(
  grid: TileGrid,
  options: TerrainMeshOptions = {},
): TerrainMesh {
  const layout = options.layout ?? DEFAULT_LAYOUT;
  const palette = options.palette ?? DEFAULT_TERRAIN_COLORS;
  const tints = options.tints;
  const half = layout.tileSize / 2;

  // Every tile's own colour first, so a corner can be read off its neighbours. The type's
  // own colour comes before the table: a project that declares a kind of ground declares
  // what it looks like, and the table is only what the engine's four were born with.
  const own: Color[] = new Array(grid.size);
  for (let tile = 0; tile < grid.size; tile++) {
    const type = grid.terrainAt(tile);
    const declared = type.color === undefined ? palette : { ...palette, [type.id]: type.color };
    own[tile] = new Color(colorFor(tile, type.id, tints, declared));
  }

  // The colour at a corner of a tile: the mean of every tile sharing that
  // corner at the same height. Blending across the boundary between two
  // patches of ground is what makes them ground; a step up keeps its own
  // colour, so the edge that is real stays sharp.
  const cornerColor = (tile: number, sx: number, sy: number, into: Color): Color => {
    const x = grid.xOf(tile);
    const y = grid.yOf(tile);
    const level = grid.heightAt(tile);
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (const [dx, dy] of [[0, 0], [sx, 0], [0, sy], [sx, sy]] as const) {
      const other = grid.indexOf(x + dx, y + dy);
      if (other < 0 || grid.heightAt(other) !== level) continue;
      // Nothing has no colour to lend: the grass beside a gap is as green as the rest of it.
      if (other !== tile && grid.terrainAt(other).id === VOID_TERRAIN_ID) continue;
      const c = own[other]!;
      r += c.r;
      g += c.g;
      b += c.b;
      n++;
    }
    return into.setRGB(r / n, g / n, b / n);
  };

  const surfaces = new Map<number, Surface>();
  const scratch = [new Color(), new Color(), new Color(), new Color()];
  for (let tile = 0; tile < grid.size; tile++) {
    const key = grid.terrain[tile] ?? 0;
    let surface = surfaces.get(key);
    if (surface === undefined) {
      surface = new Surface();
      surfaces.set(key, surface);
    }
    const centre = tileCenter(grid, tile, layout);
    const top = surfaceHeight(grid.heightAt(tile), layout);
    const corners = CORNERS.map(([sx, sz]): [number, number, number] => [centre.x + sx * half, top, centre.z + sz * half]);
    const colors = CORNERS.map(([sx, sz], i) => cornerColor(tile, sx, sz, scratch[i]!));
    surface.quad(corners, [0, 1, 0], colors, tile);

    // A wall down to whatever is lower beside it: the neighbour's surface, or
    // the ground plane off the edge of the map.
    const x = grid.xOf(tile);
    const y = grid.yOf(tile);
    for (const side of SIDES) {
      const other = grid.indexOf(x + side.dx, y + side.dy);
      // Beside nothing is the edge of the world, as off the map is: the ground shows its side there.
      const edge = other < 0 || grid.terrainAt(other).id === VOID_TERRAIN_ID;
      const floor = edge ? 0 : surfaceHeight(grid.heightAt(other), layout);
      if (floor >= top) continue;
      const a = corners[side.a]!;
      const b = corners[side.b]!;
      const wall: [number, number, number][] = [
        [a[0], top, a[2]],
        [b[0], top, b[2]],
        [b[0], floor, b[2]],
        [a[0], floor, a[2]],
      ];
      const c = own[tile]!;
      surface.quad(wall, side.normal, [c, c, c, c], tile);
    }
  }

  const meshes: Mesh[] = [];
  const materials: Material[] = [];
  const geometries: BufferGeometry[] = [];
  const faceTiles = new Map<Mesh, readonly number[]>();
  for (const [terrainIndex, surface] of [...surfaces].sort(([a], [b]) => a - b)) {
    const type = grid.palette.at(terrainIndex);
    // Nothing is not drawn - and is still struck, so the editor's pointer finds the cell to fill.
    const nothing = type.id === VOID_TERRAIN_ID;
    const material = new MeshStandardMaterial({ vertexColors: true, visible: !nothing });
    materials.push(material);
    const geometry = surface.build();
    geometries.push(geometry);
    const mesh = new Mesh(geometry, material);
    mesh.name = `terrain:${type.id}`;
    // A raised slab or a wall throws its shadow on the floor beside it, which
    // is most of what makes the height read.
    mesh.castShadow = !nothing;
    mesh.receiveShadow = true;
    mesh.frustumCulled = true;
    meshes.push(mesh);
    faceTiles.set(mesh, surface.faceTiles);
  }

  // What is stacked on the ground is drawn by other hands, from files and boxes that know no
  // tile - so a pointer over the top of a block would go through it and strike the floor
  // behind. This is the same columns again, as high as a creature stands on each and never
  // drawn: a ray meets it first, and the face it meets knows its tile.
  const raised = new Surface();
  for (let tile = 0; tile < grid.size; tile++) {
    const top = standHeight(grid, tile, layout);
    if (top <= surfaceHeight(grid.heightAt(tile), layout)) continue;
    const centre = tileCenter(grid, tile, layout);
    const corners = CORNERS.map(([sx, sz]): [number, number, number] => [centre.x + sx * half, top, centre.z + sz * half]);
    const c = own[tile]!;
    raised.quad(corners, [0, 1, 0], [c, c, c, c], tile);
    for (const side of SIDES) {
      const other = grid.indexOf(grid.xOf(tile) + side.dx, grid.yOf(tile) + side.dy);
      const floor = other < 0 ? 0 : standHeight(grid, other, layout);
      if (floor >= top) continue;
      const a = corners[side.a]!;
      const b = corners[side.b]!;
      raised.quad([[a[0], top, a[2]], [b[0], top, b[2]], [b[0], floor, b[2]], [a[0], floor, a[2]]], side.normal, [c, c, c, c], tile);
    }
  }
  if (raised.faceTiles.length > 0) {
    // Not drawn, and still struck: a raycast asks the geometry and never the material.
    const material = new MeshStandardMaterial({ visible: false });
    materials.push(material);
    const geometry = raised.build();
    geometries.push(geometry);
    const mesh = new Mesh(geometry, material);
    mesh.name = 'terrain:standing';
    meshes.push(mesh);
    faceTiles.set(mesh, raised.faceTiles);
  }

  return {
    meshes,
    drawn: meshes.filter((mesh) => mesh.name !== 'terrain:standing' && mesh.name !== `terrain:${VOID_TERRAIN_ID}`),
    tileOf(mesh, faceIndex) {
      return faceTiles.get(mesh)?.[faceIndex] ?? -1;
    },
    dispose() {
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
    },
  };
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function colorFor(
  tile: number,
  terrainId: string,
  tints: readonly string[] | undefined,
  palette: Readonly<Record<string, string>>,
): string {
  const tint = tints?.[tile];
  // Authored tints win, but only when they are actually a colour — the legacy
  // maps leave the field empty on plenty of tiles.
  if (tint !== undefined && HEX.test(tint)) return tint;
  return palette[terrainId] ?? FALLBACK_COLOR;
}

/** How many tiles have a top drawn, across every mesh. */
export function tilesDrawn(terrain: TerrainMesh): number {
  const seen = new Set<number>();
  for (const mesh of terrain.meshes) {
    const faces = (mesh.geometry.getAttribute('position') as BufferAttribute).count / 3;
    for (let face = 0; face < faces; face++) {
      const tile = terrain.tileOf(mesh, face);
      if (tile >= 0) seen.add(tile);
    }
  }
  return seen.size;
}

/**
 * The colour drawn at a tile's top, as the mean of its four corners: what a
 * test reads to see that a tint was honoured.
 */
export function topColorOf(terrain: TerrainMesh, tile: number, into = new Color()): Color | null {
  for (const mesh of terrain.meshes) {
    const colors = mesh.geometry.getAttribute('color') as BufferAttribute;
    const normals = mesh.geometry.getAttribute('normal') as BufferAttribute;
    const faces = colors.count / 3;
    for (let face = 0; face < faces; face++) {
      if (terrain.tileOf(mesh, face) !== tile || normals.getY(face * 3) < 0.5) continue;
      // The first top face of a tile carries corners 0, 1, 2; the second 0, 2, 3.
      const v = face * 3;
      const r = (colors.getX(v) + colors.getX(v + 1) + colors.getX(v + 2) + colors.getX(v + 5)) / 4;
      const g = (colors.getY(v) + colors.getY(v + 1) + colors.getY(v + 2) + colors.getY(v + 5)) / 4;
      const b = (colors.getZ(v) + colors.getZ(v + 1) + colors.getZ(v + 2) + colors.getZ(v + 5)) / 4;
      return into.setRGB(r, g, b);
    }
  }
  return null;
}
