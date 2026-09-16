import { describe, it, expect } from 'vitest';
import { BoxGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, Object3D, Vector3 } from 'three';
import { TileGrid } from '../grid/grid';
import { TerrainPalette, terrain } from '../grid/terrain';
import { DEFAULT_LAYOUT, placementCentre } from './layout';
import { buildTileModels, drawsTileModel, redrawTileModels } from './tile-models';
import type { BuiltModel } from './procedural/build';

/**
 * The ground drawn as models, one mesh per kind.
 *
 * A room is hundreds of cells, so what matters is that a kind of tile costs one draw call
 * however many cells carry it - a group per cell measured at 35 frames a second falling
 * to 1. Beyond that: only the tiles whose type names a model get one, each instance sits
 * where its tile is and at the height that tile stands, and a redraw lets go of what it
 * replaces without freeing geometry the asset library still owns.
 */

/** A build that hands back one real mesh, which is what an imported tile is. */
function recorder(): { build: (id: string) => BuiltModel; asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    build: (id: string): BuiltModel => {
      asked.push(id);
      const group = new Group();
      // A unit box sitting on its own middle, like the example tiles: half below y=0.
      group.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial()));
      return {
        group,
        spec: { id, groundOffset: 0 } as BuiltModel['spec'],
        named: new Map(),
        hooks: new Map(),
      };
    },
  };
}

/** Two types, one of which is drawn with a model. */
const palette = (): TerrainPalette =>
  new TerrainPalette([terrain('floor', { name: 'Floor' }), terrain('planks', { name: 'Planks', model: 'plank' })]);

/** The instanced mesh inside a returned group. */
const instancesIn = (group: Group): InstancedMesh =>
  group.children.find((c) => c instanceof InstancedMesh) as InstancedMesh;

describe('the ground drawn as models', () => {
  it('is one mesh for a kind however many tiles carry it, not one per tile', () => {
    const grid = new TileGrid({ width: 8, height: 8, palette: palette() });
    for (let tile = 0; tile < grid.size; tile++) grid.setTerrainById(tile, 'planks');

    const { build, asked } = recorder();
    const made = buildTileModels(grid, DEFAULT_LAYOUT, build);

    // Sixty-four tiles, one mesh, one build. This is the whole point of the change.
    expect(made).toHaveLength(1);
    expect(asked).toEqual(['plank']);
    expect(instancesIn(made[0]!).count).toBe(64);
  });

  it('gives each kind its own mesh', () => {
    const grid = new TileGrid({
      width: 4,
      height: 1,
      palette: new TerrainPalette([
        terrain('floor'),
        terrain('planks', { model: 'plank' }),
        terrain('bog', { model: 'mire' }),
      ]),
    });
    grid.setTerrainById(0, 'planks');
    grid.setTerrainById(1, 'planks');
    grid.setTerrainById(2, 'bog');

    const made = buildTileModels(grid, DEFAULT_LAYOUT, recorder().build);
    expect(made.map((g) => g.name).sort()).toEqual(['tiles:mire', 'tiles:plank']);
    const counts = made.map((g) => instancesIn(g).count).sort();
    expect(counts).toEqual([1, 2]);
  });

  it('puts each instance where its tile is, at the height that tile stands', () => {
    const grid = new TileGrid({ width: 3, height: 3, palette: palette() });
    const tile = grid.indexOf(2, 1);
    grid.setTerrainById(tile, 'planks');
    grid.setHeight(tile, 2);

    const [group] = buildTileModels(grid, DEFAULT_LAYOUT, recorder().build);
    const mesh = instancesIn(group!);
    const at = new Matrix4();
    mesh.getMatrixAt(0, at);
    const where = new Vector3().setFromMatrixPosition(at);

    // Six places, not ten: an instance matrix is a `Float32Array`, so a position read
    // back out of one is good to about 1e-7. The old test compared a `Group.position`,
    // which is a plain number and never went through a buffer.
    const centre = placementCentre(grid, DEFAULT_LAYOUT, { x: 2, y: 1 });
    expect(where.x).toBeCloseTo(centre.x, 6);
    expect(where.z).toBeCloseTo(centre.z, 6);
    // Lifted by half the box, so a model built around its own middle sits on the tile
    // rather than half-buried in it - and the raised tile carries it up.
    expect(where.y).toBeCloseTo(centre.y + 0.5, 6);
    expect(where.y).toBeGreaterThan(0.5);
  });

  it('draws nothing at all when no type names a model', () => {
    const grid = new TileGrid({ width: 4, height: 4 });
    const { build, asked } = recorder();
    expect(buildTileModels(grid, DEFAULT_LAYOUT, build)).toEqual([]);
    expect(asked).toEqual([]);
  });

  it('lets go of what it replaces, without freeing geometry the library still owns', () => {
    const grid = new TileGrid({ width: 2, height: 2, palette: palette() });
    grid.setTerrainById(grid.indexOf(0, 0), 'planks');
    const root: Object3D = new Object3D();
    const forgotten: Group[] = [];

    const first = redrawTileModels(root, [], grid, DEFAULT_LAYOUT, recorder().build, (g) => forgotten.push(g));
    const geometry = instancesIn(first[0]!).geometry;
    expect(root.children).toHaveLength(1);

    const second = redrawTileModels(root, first, grid, DEFAULT_LAYOUT, recorder().build, (g) => forgotten.push(g));
    // One group in the room, not two, and the one that left was handed back to be forgotten.
    expect(root.children).toHaveLength(1);
    expect(root.children[0]).toBe(second[0]);
    expect(forgotten).toEqual(first);
    // The mesh was disposed; its geometry was not, because the asset library owns it and
    // hands the same one to the thumbnails and to every token drawn from that model.
    expect(geometry.attributes['position']).toBeDefined();
  });

  it('knows whether a late asset is one the ground is waiting for', () => {
    const grid = new TileGrid({ width: 2, height: 2, palette: palette() });
    expect(drawsTileModel(grid, 'plank')).toBe(true);
    // Asked about by id, not by what happens to be on the map: a type that names it
    // counts even where no tile has been painted with that type yet.
    expect(drawsTileModel(grid, 'duck')).toBe(false);
  });
});
