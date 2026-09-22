import { describe, it, expect } from 'vitest';
import { Box3, BoxGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, Object3D, Quaternion, Vector3 } from 'three';
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

/**
 * A build that hands back one real mesh, which is what an imported tile is.
 *
 * `sizes` records what each build was asked for, because how big a kind of tile stands is
 * passed through to the view rather than applied here - the view sizes a model before
 * seating it, so the feet land on the tile at any size.
 */
function recorder(groundOffset = 0): {
  build: (id: string, scale?: number) => BuiltModel;
  asked: string[];
  sizes: (number | undefined)[];
} {
  const asked: string[] = [];
  const sizes: (number | undefined)[] = [];
  return {
    asked,
    sizes,
    build: (id: string, scale?: number): BuiltModel => {
      asked.push(id);
      sizes.push(scale);
      const group = new Group();
      // A unit box sitting on its own middle, like the example tiles: half below y=0.
      group.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial()));
      return {
        group,
        spec: { id, groundOffset } as BuiltModel['spec'],
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
    // Named for the kind of tile, not the file: the kind is what carries the size, so it
    // is what a mesh is built per.
    expect(made.map((g) => g.name).sort()).toEqual(['tiles:bog', 'tiles:planks']);
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
    // The tile's own surface: what `build` hands back is already seated, so the instance
    // adds nothing to it. The raised tile carries it up.
    expect(where.y).toBeCloseTo(centre.y, 6);
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

  it('carries what the project says about the model into every instance', () => {
    const grid = new TileGrid({ width: 2, height: 1, palette: palette() });
    grid.setTerrainById(0, 'planks');
    grid.setTerrainById(1, 'planks');

    // What `build` hands back for a shipped model: scaled by what the project declared.
    const scaled = (): BuiltModel => {
      const group = new Group();
      group.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial()));
      group.scale.setScalar(0.5);
      return { group, spec: { id: 'plank' } as BuiltModel['spec'], named: new Map(), hooks: new Map() };
    };

    const [group] = buildTileModels(grid, DEFAULT_LAYOUT, scaled);
    const mesh = instancesIn(group!);
    const at = new Matrix4();
    mesh.getMatrixAt(0, at);
    const size = new Vector3().setFromMatrixScale(at);

    // Read off the built clone rather than the file: the template's own matrix is identity,
    // so a scale of 0.5 was being dropped and every shipped tile drew at twice its size.
    expect(size.x).toBeCloseTo(0.5, 6);
    expect(size.y).toBeCloseTo(0.5, 6);
    expect(size.z).toBeCloseTo(0.5, 6);
  });

  it('sinks or floats an instance by what the model asks for', () => {
    const grid = new TileGrid({ width: 2, height: 1, palette: palette() });
    grid.setTerrainById(0, 'planks');

    // A model that deliberately stands off the tile. `instantiate` hands this back in the
    // spec for the caller to add rather than applying it to the clone, so an instanced
    // tile that never reads it sits at the wrong height and nothing says so.
    const [group] = buildTileModels(grid, DEFAULT_LAYOUT, recorder(0.25).build);
    const at = new Matrix4();
    instancesIn(group!).getMatrixAt(0, at);
    const centre = placementCentre(grid, DEFAULT_LAYOUT, { x: 0, y: 0 });
    expect(new Vector3().setFromMatrixPosition(at).y).toBeCloseTo(centre.y + 0.25, 6);
  });

  it('asks for the model at the size the kind of tile stands it at', () => {
    const grid = new TileGrid({
      width: 2,
      height: 1,
      palette: new TerrainPalette([terrain('floor'), terrain('planks', { model: 'plank', scale: 1 })]),
    });
    grid.setTerrainById(0, 'planks');

    const { build, sizes } = recorder();
    buildTileModels(grid, DEFAULT_LAYOUT, build);
    // Passed through, not applied here: the view scales the model before seating it, so
    // the feet land on the tile and a nudge across the cell keeps the size it was given.
    expect(sizes).toEqual([1]);
  });

  it('gives two kinds naming one file a mesh each, because the size belongs to the kind', () => {
    const grid = new TileGrid({
      width: 4,
      height: 1,
      palette: new TerrainPalette([
        terrain('floor'),
        terrain('paving', { model: 'stone', scale: 1 }),
        terrain('pebbles', { model: 'stone', scale: 0.25 }),
      ]),
    });
    grid.setTerrainById(0, 'paving');
    grid.setTerrainById(1, 'pebbles');

    const { build, sizes } = recorder();
    const made = buildTileModels(grid, DEFAULT_LAYOUT, build);
    // An instanced mesh is one geometry at one size, so sharing a URL is not enough to
    // share a draw call - a floor piece filling its cell and the same file shrunk to a
    // pebble have to be two.
    expect(made.map((g) => g.name).sort()).toEqual(['tiles:paving', 'tiles:pebbles']);
    expect(sizes.sort()).toEqual([0.25, 1]);
  });

  it('stands a placed piece at its own level, turned the way it was stamped', () => {
    const grid = new TileGrid({ width: 4, height: 4, palette: palette() });
    // Not painted anywhere: a piece is a thing standing on the board, not a kind of ground.
    grid.pieces = [{ x: 1, y: 2, level: 2, rotation: 1, index: grid.palette.require('planks') }];

    const made = buildTileModels(grid, DEFAULT_LAYOUT, recorder().build);
    const group = made.find((g) => g.name === 'pieces:planks');
    expect(group).toBeDefined();
    const mesh = instancesIn(group!);
    expect(mesh.count).toBe(1);

    const at = new Matrix4();
    mesh.getMatrixAt(0, at);
    const where = new Vector3().setFromMatrixPosition(at);
    // A building level is a whole tile up, which is not the ground's own slab thickness -
    // the two counts are deliberately separate, and a piece uses the building one.
    const centre = placementCentre(grid, DEFAULT_LAYOUT, { x: 1, y: 2, z: 2 });
    expect(where.x).toBeCloseTo(centre.x, 6);
    expect(where.y).toBeCloseTo(centre.y, 6);
    expect(where.z).toBeCloseTo(centre.z, 6);

    // A quarter turn, which is how a wall picks the edge it stands on.
    const spun = new Quaternion().setFromRotationMatrix(at);
    expect(spun.angleTo(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2))).toBeCloseTo(0, 6);
  });

  it('fits the file of a structure to how tall the rules say it stands, and leaves it as wide as it came', () => {
    const kinds = new TerrainPalette([
      terrain('floor', { name: 'Floor' }),
      terrain('crate', { name: 'Crate', model: 'crate', scale: 1, structure: 'block' }),
      terrain('mat', { name: 'Mat', model: 'mat', scale: 1, structure: 'floor' }),
      terrain('fence', { name: 'Fence', model: 'fence', scale: 1, structure: 'wall' }),
      terrain('rock', { name: 'Rock', model: 'rock', structure: 'block' }),
    ]);
    const grid = new TileGrid({ width: 4, height: 4, palette: kinds });
    grid.pieces = ['crate', 'mat', 'fence', 'rock'].map((id, x) => ({ x, y: 1, level: 1, rotation: 0, index: kinds.require(id) }));
    // A file a fifth too wide and a tenth too tall, seated the way the view seats one: feet at 0.
    const oversize = (id: string): BuiltModel => {
      const group = new Group();
      const mesh = new Mesh(new BoxGeometry(1.2, 1.1, 1.2), new MeshBasicMaterial());
      mesh.position.y = 0.55;
      group.add(mesh);
      return { group, spec: { id } as BuiltModel['spec'], named: new Map(), hooks: new Map() };
    };
    const made = buildTileModels(grid, DEFAULT_LAYOUT, oversize);
    const boxOf = (id: string): Box3 => {
      const mesh = instancesIn(made.find((g) => g.name === `pieces:${id}`)!);
      const at = new Matrix4();
      mesh.getMatrixAt(0, at);
      mesh.geometry.computeBoundingBox();
      return mesh.geometry.boundingBox!.clone().applyMatrix4(at);
    };
    const foot = placementCentre(grid, DEFAULT_LAYOUT, { x: 0, y: 1, z: 1 }).y;
    const size = (box: Box3): number[] => box.getSize(new Vector3()).toArray().map((n) => Math.round(n * 1000) / 1000);
    expect(size(boxOf('crate'))).toEqual([1.2, 1, 1.2]);
    expect(boxOf('crate').min.y).toBeCloseTo(foot, 6);
    expect(boxOf('crate').max.y).toBeCloseTo(foot + 1, 6);
    expect(size(boxOf('mat'))).toEqual([1.2, 0.25, 1.2]);
    expect(size(boxOf('fence'))).toEqual([1.2, 1, 1.2]);
    // No declared size: the file's own, untouched.
    expect(size(boxOf('rock'))).toEqual([1.2, 1.1, 1.2]);
  });

  it('draws a piece standing outside the room, which the grid has no cell for', () => {
    const grid = new TileGrid({ width: 2, height: 2, palette: palette() });
    grid.pieces = [{ x: 500, y: -400, level: 0, rotation: 0, index: grid.palette.require('planks') }];
    const group = buildTileModels(grid, DEFAULT_LAYOUT, recorder().build).find((g) => g.name === 'pieces:planks');
    expect(instancesIn(group!).count).toBe(1);
  });

  it('leaves a piece whose kind has no model to the layer that draws boxes', () => {
    const grid = new TileGrid({ width: 2, height: 2, palette: palette() });
    // `floor` names no model, so nothing here draws it - `building-view` does, as a box.
    grid.pieces = [{ x: 0, y: 0, level: 0, rotation: 0, index: grid.palette.require('floor') }];
    expect(buildTileModels(grid, DEFAULT_LAYOUT, recorder().build)).toEqual([]);
  });

  it('knows whether a late asset is one the ground is waiting for', () => {
    const grid = new TileGrid({ width: 2, height: 2, palette: palette() });
    expect(drawsTileModel(grid, 'plank')).toBe(true);
    // Asked about by id, not by what happens to be on the map: a type that names it
    // counts even where no tile has been painted with that type yet.
    expect(drawsTileModel(grid, 'duck')).toBe(false);
  });
});
