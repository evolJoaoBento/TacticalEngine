/**
 * Terrain rendering: one `InstancedMesh` per terrain type.
 *
 * The legacy prototype built a mesh per tile — a 26x20 map was 520 draw calls
 * before a single prop, and CONTEXT.md makes instancing a stated requirement.
 * Here the whole map is one draw call per terrain type in use, four for the
 * default palette, regardless of how large it gets.
 *
 * This imports three, so it lives under `render/`. It still runs headless: a
 * `BufferGeometry` and an `InstancedMesh` are plain objects until a renderer
 * compiles them, which is what lets the tests below run in node.
 */

import {
  BoxGeometry,
  Color,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Object3D,
  type Material,
} from 'three';
import type { TileGrid } from '../grid/grid';
import { DEFAULT_LAYOUT, surfaceHeight, tileCenter, type TileLayout } from './layout';

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

/** Colours that read as the legacy map did when a scene carries no tints. */
export const DEFAULT_TERRAIN_COLORS: Readonly<Record<string, string>> = {
  floor: '#5d8a4a',
  difficult: '#6b6350',
  cover: '#7d7a6d',
  wall: '#3b3f4a',
};

const FALLBACK_COLOR = '#5d8a4a';

export interface TerrainMesh {
  /** One instanced mesh per terrain type that actually appears on the map. */
  readonly meshes: InstancedMesh[];
  /** Tile index -> [mesh, instance] so a hit test can name the tile it struck. */
  tileOf(mesh: InstancedMesh, instanceId: number): number;
  /** Release the geometry and materials this built. */
  dispose(): void;
}

/**
 * Build the terrain.
 *
 * Every tile becomes one box instance, scaled so its top sits at the tile's
 * surface height and its bottom reaches the ground plane — so a raised tile reads
 * as a slab rather than a floating tile.
 */
export function buildTerrainMesh(
  grid: TileGrid,
  options: TerrainMeshOptions = {},
): TerrainMesh {
  const layout = options.layout ?? DEFAULT_LAYOUT;
  const palette = options.palette ?? DEFAULT_TERRAIN_COLORS;
  const tints = options.tints;

  // Group tiles by terrain index so each type becomes one instanced mesh.
  const byTerrain = new Map<number, number[]>();
  for (let tile = 0; tile < grid.size; tile++) {
    const key = grid.terrain[tile] ?? 0;
    const bucket = byTerrain.get(key);
    if (bucket === undefined) byTerrain.set(key, [tile]);
    else bucket.push(tile);
  }

  const geometry = new BoxGeometry(layout.tileSize, 1, layout.tileSize);
  // The box is built centred; shifting it up by half puts its base at y = 0, so
  // scaling y alone grows the slab downward-anchored.
  geometry.translate(0, 0.5, 0);

  const meshes: InstancedMesh[] = [];
  const materials: Material[] = [];
  const tileIndex = new Map<InstancedMesh, number[]>();

  const dummy = new Object3D();
  const color = new Color();

  for (const [terrainIndex, tiles] of [...byTerrain].sort(([a], [b]) => a - b)) {
    const type = grid.palette.at(terrainIndex);
    const material = new MeshStandardMaterial({ flatShading: true });
    materials.push(material);

    const mesh = new InstancedMesh(geometry, material, tiles.length);
    mesh.name = `terrain:${type.id}`;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.frustumCulled = true;

    tiles.forEach((tile, i) => {
      const centre = tileCenter(grid, tile, layout);
      const height = surfaceHeight(grid.heightAt(tile), layout);
      dummy.position.set(centre.x, 0, centre.z);
      dummy.scale.set(1, height, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, color.set(colorFor(tile, type.id, tints, palette)));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;

    meshes.push(mesh);
    tileIndex.set(mesh, tiles);
  }

  return {
    meshes,
    tileOf(mesh, instanceId) {
      return tileIndex.get(mesh)?.[instanceId] ?? -1;
    },
    dispose() {
      for (const mesh of meshes) mesh.dispose();
      for (const material of materials) material.dispose();
      geometry.dispose();
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

/** Total instances across every mesh, i.e. tiles drawn. */
export function instanceCount(terrain: TerrainMesh): number {
  let total = 0;
  for (const mesh of terrain.meshes) total += mesh.count;
  return total;
}

/** A world-space matrix per instance is not readable directly; this extracts one. */
export function instanceMatrix(mesh: InstancedMesh, instanceId: number): Matrix4 {
  const matrix = new Matrix4();
  mesh.getMatrixAt(instanceId, matrix);
  return matrix;
}
