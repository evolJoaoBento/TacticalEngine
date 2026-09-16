import { describe, it, expect } from 'vitest';
import { Group, Object3D } from 'three';
import { TileGrid } from '../grid/grid';
import { TerrainPalette, terrain } from '../grid/terrain';
import { DEFAULT_LAYOUT, placementCentre } from './layout';
import { buildTileModels, drawsTileModel, redrawTileModels } from './tile-models';
import type { BuiltModel } from './procedural/build';

/**
 * The ground drawn as models.
 *
 * A terrain type names a model and every tile of that type stands one. What matters is
 * that only those tiles get one, that each stands where the tile is and at the height the
 * tile has, and that redrawing lets go of what it replaces - a room is rebuilt whenever an
 * asset lands, and a view that kept the old groups would stack them.
 */

/** A build that records what it was asked for and hands back a bare group. */
function recorder(): { build: (id: string) => BuiltModel; asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    build: (id: string): BuiltModel => {
      asked.push(id);
      return {
        group: new Group(),
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

describe('the ground drawn as models', () => {
  it('stands one on each tile of the type that names one, and on no other', () => {
    const grid = new TileGrid({ width: 3, height: 2, palette: palette() });
    grid.setTerrainById(grid.indexOf(1, 0), 'planks');
    grid.setTerrainById(grid.indexOf(2, 1), 'planks');

    const { build, asked } = recorder();
    const made = buildTileModels(grid, DEFAULT_LAYOUT, build);

    // Two tiles of six, and the model each asked for is the one its type names.
    expect(made).toHaveLength(2);
    expect(asked).toEqual(['plank', 'plank']);
    expect(made.map((g) => g.name)).toEqual([`tile:${grid.indexOf(1, 0)}`, `tile:${grid.indexOf(2, 1)}`]);
  });

  it('puts each where its tile is, at the height that tile stands', () => {
    const grid = new TileGrid({ width: 3, height: 3, palette: palette() });
    const tile = grid.indexOf(2, 1);
    grid.setTerrainById(tile, 'planks');
    grid.setHeight(tile, 2);

    const [group] = buildTileModels(grid, DEFAULT_LAYOUT, recorder().build);
    const centre = placementCentre(grid, DEFAULT_LAYOUT, { x: 2, y: 1 });
    expect(group!.position.x).toBeCloseTo(centre.x, 10);
    expect(group!.position.z).toBeCloseTo(centre.z, 10);
    // The raised tile lifts its model with it, rather than leaving it in the floor.
    expect(group!.position.y).toBeCloseTo(centre.y, 10);
    expect(group!.position.y).toBeGreaterThan(0);
  });

  it('draws nothing at all when no type names a model', () => {
    const grid = new TileGrid({ width: 4, height: 4 });
    const { build, asked } = recorder();
    expect(buildTileModels(grid, DEFAULT_LAYOUT, build)).toEqual([]);
    expect(asked).toEqual([]);
  });

  it('lets go of what it replaces, so a redraw does not stack rooms', () => {
    const grid = new TileGrid({ width: 2, height: 2, palette: palette() });
    grid.setTerrainById(grid.indexOf(0, 0), 'planks');
    const root: Object3D = new Object3D();
    const forgotten: Group[] = [];

    const first = redrawTileModels(root, [], grid, DEFAULT_LAYOUT, recorder().build, (g) => forgotten.push(g));
    expect(root.children).toHaveLength(1);
    expect(forgotten).toEqual([]);

    const second = redrawTileModels(root, first, grid, DEFAULT_LAYOUT, recorder().build, (g) => forgotten.push(g));
    // One group in the room, not two, and the one that left was handed back to be forgotten.
    expect(root.children).toHaveLength(1);
    expect(root.children[0]).toBe(second[0]);
    expect(forgotten).toEqual(first);
  });

  it('knows whether a late asset is one the ground is waiting for', () => {
    const grid = new TileGrid({ width: 2, height: 2, palette: palette() });
    expect(drawsTileModel(grid, 'plank')).toBe(true);
    // Asked about by id, not by what happens to be on the map: a type that names it
    // counts even where no tile has been painted with that type yet.
    expect(drawsTileModel(grid, 'duck')).toBe(false);
  });
});
