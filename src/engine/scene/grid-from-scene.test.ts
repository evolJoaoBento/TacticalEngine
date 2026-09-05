import { describe, it, expect } from 'vitest';
import { TerrainPalette, terrain } from '../grid/terrain';
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
