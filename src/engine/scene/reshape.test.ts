import { describe, expect, it } from 'vitest';
import { NO_TILE } from '../grid/grid';
import { blankScene, gridFromScene } from './grid-from-scene';
import { MAX_GROWN, growthToReach, grownScene, shiftSnapshot } from './reshape';
import { sceneSchema, type SceneDoc } from './schema';
import { createPartyEntity, sceneStateFromScene } from './state';

/** A 4 by 3 room with one of everything that has a place, and a tint so that array is there too. */
function room(): SceneDoc {
  const scene = blankScene('room', 4, 3);
  scene.terrain[1 * 4 + 2] = 'wall';
  scene.heights[2 * 4 + 3] = 2;
  scene.tints = scene.terrain.map((_, i) => (i === 0 ? '#ff0000' : ''));
  scene.spawns = [{ x: 1, y: 1 }];
  scene.decos = [{ model: 'tree', position: { x: 3, y: 0 }, rotation: 0 }];
  scene.interactables = [sceneSchema.shape.interactables.parse([{ id: 'door', kind: 'door', position: { x: 2, y: 2 } }])[0]!];
  scene.encounters = sceneSchema.shape.encounters.parse([
    { id: 'fight', adversaries: [{ id: 'rat', adversary: 'rat', position: { x: 0, y: 2 } }], triggerCells: [{ x: 3, y: 1 }] },
  ]);
  scene.buildingTiles = {
    '0,0,0': { x: 0, y: 0, level: 0, shape: 'floor', material: 'stone', rotation: 0, tile: 'platform' },
    '0,0,0#1': { x: 0, y: 0, level: 0, shape: 'block', material: 'stone', rotation: 1, tile: 'block' },
    '-2,1,0.25': { x: -2, y: 1, level: 0.25, shape: 'floor', material: 'stone', rotation: 0, tile: 'platform' },
  };
  return scene;
}

describe('what it takes for a room to hold some cells', () => {
  const scene = { width: 4, height: 3 };
  it('is nothing when it holds them already', () => {
    expect(growthToReach(scene, { minX: 0, minY: 0, maxX: 3, maxY: 2 })).toBeNull();
  });
  it('is more cells to the east and south, with nothing moved', () => {
    expect(growthToReach(scene, { minX: 5, minY: 1, maxX: 6, maxY: 4 })).toEqual({ dx: 0, dy: 0, width: 7, height: 5 });
  });
  it('is the corner moved, to the west and north', () => {
    expect(growthToReach(scene, { minX: -2, minY: -1, maxX: 0, maxY: 0 })).toEqual({ dx: 2, dy: 1, width: 6, height: 4 });
  });
  it('is refused past the cap: a piece that far off is scenery', () => {
    expect(growthToReach(scene, { minX: 0, minY: 0, maxX: MAX_GROWN - 1, maxY: 0 })).not.toBeNull();
    expect(growthToReach(scene, { minX: 0, minY: 0, maxX: MAX_GROWN, maxY: 0 })).toBeNull();
    expect(growthToReach(scene, { minX: -900_000, minY: 900_000, maxX: -900_000, maxY: 900_000 })).toBeNull();
    // A room already past it may still grow the other way.
    expect(growthToReach({ width: 200, height: 3 }, { minX: 0, minY: 0, maxX: 0, maxY: 5 })).toEqual({ dx: 0, dy: 0, width: 200, height: 6 });
  });
});

describe('a room grown west and north', () => {
  const before = room();
  const kept = JSON.stringify(before);
  const grown = { ...before, ...grownScene(before, { dx: 2, dy: 1, width: 6, height: 4 }) };

  it('is a document still, and the one it was made from is untouched', () => {
    expect(() => sceneSchema.parse(grown)).not.toThrow();
    expect(JSON.stringify(before)).toBe(kept);
  });
  it('moves its cells, and fills what is new with nothing', () => {
    expect(grown.terrain[2 * 6 + 4]).toBe('wall');
    expect(grown.heights[3 * 6 + 5]).toBe(2);
    expect(grown.tints![1 * 6 + 2]).toBe('#ff0000');
    expect(grown.terrain[0]).toBe('void');
    expect(grown.terrain.filter((id) => id === 'void')).toHaveLength(6 * 4 - 4 * 3);
  });
  it('moves everything that has a place', () => {
    expect(grown.spawns).toEqual([{ x: 3, y: 2 }]);
    expect(grown.decos[0]!.position).toEqual({ x: 5, y: 1 });
    expect(grown.interactables[0]!.position).toEqual({ x: 4, y: 3 });
    expect(grown.encounters[0]!.adversaries[0]!.position).toEqual({ x: 2, y: 3 });
    expect(grown.encounters[0]!.triggerCells).toEqual([{ x: 5, y: 2 }]);
    expect(grown.origin).toEqual({ x: 2, y: 1 });
  });
  it('moves the pieces under the keys their new cells give them, overlaps kept', () => {
    expect(Object.keys(grown.buildingTiles!).sort()).toEqual(['0,2,0.25', '2,1,0', '2,1,0#1']);
    expect(grown.buildingTiles!['2,1,0#1']).toMatchObject({ x: 2, y: 1, shape: 'block', rotation: 1 });
    expect(grown.buildingTiles!['0,2,0.25']).toMatchObject({ x: 0, y: 2, level: 0.25 });
  });
  it('makes the piece that was outside somewhere to stand, and the nothing round it not', () => {
    const { grid, issues } = gridFromScene(grown as SceneDoc);
    expect(issues).toEqual([]);
    expect(grid.origin).toEqual({ x: 2, y: 1 });
    expect(grid.isPassable(grid.indexOf(0, 2))).toBe(true);
    expect(grid.isPassable(grid.indexOf(0, 0))).toBe(false);
    expect(grid.blocksSight(grid.indexOf(0, 0))).toBe(false);
  });
  it('adds up: a room grown twice knows how far its first corner has come', () => {
    const again = grownScene(grown as SceneDoc, { dx: 1, dy: 0, width: 7, height: 4 });
    expect(again.origin).toEqual({ x: 3, y: 1 });
  });
});

describe('where everybody was, in the room as it is now', () => {
  const scene = room();
  const { grid } = gridFromScene(scene);
  const { state } = sceneStateFromScene(scene, grid, { adversaries: new Map(), party: [createPartyEntity('kara', 'guardian', grid.indexOf(1, 1))] });
  state.placeEntity('kara', 1.3, 0.8);
  const taken = state.snapshot();

  it('remembers the room it was taken in', () => {
    expect(taken.room).toEqual({ width: 4, x: 0, y: 0 });
  });
  it('moves a creature with the corner', () => {
    const moved = shiftSnapshot(taken, 4, 2, 1, 6, 4);
    expect(moved.entities.kara!.tile).toBe(2 * 6 + 3);
    expect(moved.entities.kara!.at).toEqual({ x: 3.3, y: 1.8 });
  });
  it('stands whoever is left outside on the fallback, and leaves the absent absent', () => {
    expect(shiftSnapshot(taken, 4, -2, 0, 2, 3, 5).entities.kara).toMatchObject({ tile: 5 });
    expect(shiftSnapshot(taken, 4, -2, 0, 2, 3).entities.kara!.tile).toBe(NO_TILE);
  });
  it('is restored into the grown room with everybody where they were', () => {
    const grown = { ...scene, ...grownScene(scene, { dx: 2, dy: 1, width: 6, height: 4 }) } as SceneDoc;
    const built = gridFromScene(grown);
    const next = sceneStateFromScene(grown, built.grid, { adversaries: new Map(), party: [] }).state;
    next.restore(taken);
    expect(next.entity('kara')!.tile).toBe(built.grid.indexOf(3, 2));
    expect(next.entity('kara')!.at).toEqual({ x: 3.3, y: 1.8 });
    // And a snapshot from before rooms could grow says nothing, and is taken at its word.
    const { room: _none, ...old } = taken;
    next.restore(old);
    expect(next.entity('kara')!.tile).toBe(taken.entities.kara!.tile);
  });
});
