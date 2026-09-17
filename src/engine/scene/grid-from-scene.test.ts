import { describe, it, expect, afterEach } from 'vitest';
import { TerrainPalette, terrain } from '../grid/terrain';
import { isStructure, setStructures } from './building';
import {
  blankScene,
  gridFromScene,
  paletteForProject,
  pointOf,
  sceneTerrainFromGrid,
  tileOf,
} from './grid-from-scene';
import { sceneSchema, type SceneDoc } from './schema';

function sceneWith(terrainRows: string[][], heightRows: number[][]): SceneDoc {
  const height = terrainRows.length;
  const width = terrainRows[0]!.length;
  return sceneSchema.parse({
    ...blankScene('room', width, height),
    terrain: terrainRows.flat(),
    heights: heightRows.flat(),
  });
}

describe('gridFromScene', () => {
  it('resolves terrain ids into palette indices and copies heights', () => {
    const scene = sceneWith(
      [
        ['floor', 'wall', 'difficult'],
        ['cover', 'floor', 'floor'],
      ],
      [
        [0, 4, 0],
        [1, 0, 2],
      ],
    );
    const { grid, issues } = gridFromScene(scene);
    expect(issues).toEqual([]);
    expect(grid.width).toBe(3);
    expect(grid.terrainAt(grid.indexOf(1, 0)).id).toBe('wall');
    expect(grid.isPassable(grid.indexOf(1, 0))).toBe(false);
    expect(grid.costAt(grid.indexOf(2, 0))).toBe(2);
    expect(grid.terrainAt(grid.indexOf(0, 1)).providesCover).toBe(true);
    expect(grid.heightAt(grid.indexOf(2, 1))).toBe(2);
  });

  it('reports an unknown terrain id once, not once per tile', () => {
    const scene = sceneWith(
      [
        ['lava', 'lava'],
        ['lava', 'floor'],
      ],
      [
        [0, 0],
        [0, 0],
      ],
    );
    const { grid, issues } = gridFromScene(scene);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ field: 'terrain', entry: 'room' });
    expect(issues[0]!.message).toMatch(/unknown terrain id "lava" on 3 tiles/);
    // Unresolved tiles fall back to the palette's first type but keep their height.
    expect(grid.terrainAt(0).id).toBe('floor');
  });

  it('keeps heights on tiles whose terrain failed to resolve', () => {
    const scene = sceneWith([['lava', 'floor']], [[3, 0]]);
    const { grid } = gridFromScene(scene);
    expect(grid.heightAt(0)).toBe(3);
  });

  it('survives a palette being reordered, because ids are what is stored', () => {
    const scene = sceneWith([['difficult', 'wall']], [[0, 4]]);
    const reordered = new TerrainPalette([
      terrain('wall', { passable: false, cost: Infinity, blocksSight: true }),
      terrain('difficult', { cost: 2 }),
      terrain('floor'),
    ]);
    const { grid, issues } = gridFromScene(scene, reordered);
    expect(issues).toEqual([]);
    expect(grid.terrainAt(0).id).toBe('difficult');
    expect(grid.terrainAt(1).id).toBe('wall');
  });
});

describe('sceneTerrainFromGrid', () => {
  it('round-trips a scene through a grid and back', () => {
    const scene = sceneWith(
      [
        ['floor', 'wall', 'difficult'],
        ['cover', 'floor', 'floor'],
      ],
      [
        [0, 4, 1],
        [2, 0, -1],
      ],
    );
    const { grid } = gridFromScene(scene);
    expect(sceneTerrainFromGrid(grid)).toEqual({
      terrain: scene.terrain,
      heights: scene.heights,
    });
  });
});

describe('the building layer resolved onto the grid', () => {
  const room = (buildingTiles: Record<string, unknown>): SceneDoc =>
    sceneSchema.parse({ ...blankScene('room', 4, 3), buildingTiles });
  const piece = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    x: 1, y: 1, level: 0, shape: 'block', material: 'stone', rotation: 0, ...over,
  });

  it('makes a cell what is stacked on it, leaving the ground underneath alone', () => {
    const { grid } = gridFromScene(room({ '1,1,0': piece({ tile: 'wall' }) }));
    const tile = grid.indexOf(1, 1);
    expect(grid.isPassable(tile)).toBe(false);
    expect(grid.blocksSight(tile)).toBe(true);
    // Still floor: the ground is what draws the cell, and a wall on it is a thing on it.
    expect(grid.terrainAt(tile).id).toBe('floor');
  });

  it('leaves a piece that names no kind as scenery', () => {
    // Every piece placed before the two halves were fused looks like this. It draws, and
    // a walk goes straight through it, which is exactly how it always behaved.
    const { grid } = gridFromScene(room({ '1,1,0': piece() }));
    expect(grid.isPassable(grid.indexOf(1, 1))).toBe(true);
  });

  it('takes the topmost piece when several stand on one cell', () => {
    const { grid } = gridFromScene(
      room({
        '1,1,0': piece({ tile: 'wall' }),
        '1,1,1': piece({ level: 1, tile: 'difficult' }),
      }),
    );
    // The last thing you would step onto, not the first: difficult ground over the wall.
    const tile = grid.indexOf(1, 1);
    expect(grid.isPassable(tile)).toBe(true);
    expect(grid.costAt(tile)).toBe(2);
  });

  it('is not displaced by a lower piece written later in the document', () => {
    const { grid } = gridFromScene(
      room({
        '1,1,2': piece({ level: 2, tile: 'difficult' }),
        '1,1,0': piece({ tile: 'wall' }),
      }),
    );
    expect(grid.isPassable(grid.indexOf(1, 1))).toBe(true);
  });

  it('ignores a piece standing outside the room', () => {
    // The building layer reaches to a million on each axis; the grid is the room.
    const { grid } = gridFromScene(room({ '40,40,0': piece({ x: 40, y: 40, tile: 'wall' }) }));
    for (let tile = 0; tile < grid.size; tile++) expect(grid.isPassable(tile)).toBe(true);
  });

  it('leaves a piece naming a kind the palette lost to Check, rather than guessing', () => {
    const { grid, issues } = gridFromScene(room({ '1,1,0': piece({ tile: 'rampart' }) }));
    // Not stacked, and not an issue here either: `gridFromScene` reports unknown *ground*,
    // and Check is what reports a piece whose kind has gone.
    expect(grid.isPassable(grid.indexOf(1, 1))).toBe(true);
    expect(issues).toEqual([]);
  });
});

describe('paletteForProject', () => {
  it('uses the engine default when a project declares none', () => {
    expect(paletteForProject({}).has('floor')).toBe(true);
  });

  it('builds a project-declared palette', () => {
    const palette = paletteForProject({
      terrainPalette: [
        { id: 'sand', name: 'Sand', passable: true, cost: 2, providesCover: false, blocksSight: false },
        { id: 'hedge', name: '', passable: false, cost: 1, providesCover: true, blocksSight: true },
      ],
    });
    expect(palette.size).toBe(2);
    expect(palette.at(palette.require('sand')).cost).toBe(2);
    const hedge = palette.at(palette.require('hedge'));
    expect(hedge.passable).toBe(false);
    expect(hedge.blocksSight).toBe(true);
    expect(hedge.name).toBe('hedge'); // an empty name falls back to the id
  });
});

describe('the structures a project declares', () => {
  afterEach(() => {
    // Module state, like the palette is not: a test declaring its own must not leak.
    setStructures();
  });

  it('reach the registry through the palette, which is where a project is read', () => {
    // Nothing called `setStructures` in the running app before the two halves were fused -
    // the registry existed and only its own tests ever filled it. This is the wiring.
    expect(isStructure('doorway')).toBe(false);
    paletteForProject({
      structureTypes: [{ id: 'doorway', name: 'Doorway', atoms: [{ shape: 'wall' }] }],
    });
    expect(isStructure('doorway')).toBe(true);
    // The engine's four survive a project that declares its own, or every piece already
    // placed would stop resolving.
    expect(isStructure('block')).toBe(true);
  });

  it('are let go of by a project that declares none, rather than lingering', () => {
    paletteForProject({ structureTypes: [{ id: 'doorway', name: 'Doorway', atoms: [{ shape: 'wall' }] }] });
    // Loading a second project must not leave the first one's structures behind: the
    // registry is rebuilt from what this project says, not added to.
    paletteForProject({});
    expect(isStructure('doorway')).toBe(false);
    expect(isStructure('block')).toBe(true);
  });

  it('carries what a kind of tile is onto the palette it builds', () => {
    const palette = paletteForProject({
      terrainPalette: [
        { id: 'rampart', name: 'Rampart', passable: false, cost: 1, providesCover: true, blocksSight: true, structure: 'wall', model: 'stone-wall', scale: 1 },
      ],
    });
    const rampart = palette.at(palette.require('rampart'));
    // The three fields the fusion added, all the way from a document to the grid.
    expect(rampart.structure).toBe('wall');
    expect(rampart.model).toBe('stone-wall');
    expect(rampart.scale).toBe(1);
  });

  it('leaves a kind of tile that is ground alone', () => {
    const palette = paletteForProject({
      terrainPalette: [{ id: 'sand', name: 'Sand', passable: true, cost: 2, providesCover: false, blocksSight: false }],
    });
    // Absent, not empty: ground is what every kind of tile was before there were both.
    expect(palette.at(palette.require('sand')).structure).toBeUndefined();
  });
});

describe('coordinate helpers', () => {
  it('convert between scene points and tile indices', () => {
    const { grid } = gridFromScene(sceneSchema.parse(blankScene('room', 4, 3)));
    expect(tileOf(grid, { x: 2, y: 1 })).toBe(6);
    expect(pointOf(grid, 6)).toEqual({ x: 2, y: 1 });
  });
});

describe('blankScene', () => {
  it('is a valid scene of open floor', () => {
    const parsed = sceneSchema.safeParse(blankScene('room', 8, 6));
    expect(parsed.success).toBe(true);
    expect(parsed.data!.terrain.every((id) => id === 'floor')).toBe(true);
    expect(parsed.data!.heights.every((h) => h === 0)).toBe(true);
  });
});
