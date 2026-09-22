/**
 * Placed tiles as ground: how high a creature stands on them, and what that does to a walk,
 * a line of sight, a token and a click. One file because it is one rule read in five places.
 */

import { describe, it, expect } from 'vitest';
import { Raycaster, Vector3 } from 'three';
import { SLAB_BLOCKS } from '../grid/grid';
import { hasLineOfSight } from '../grid/los';
import { Pathfinder, WALKABLE_RISE } from '../grid/pathfinding';
import { canStandAt } from '../grid/walk';
import { DEFAULT_LAYOUT, spotToWorld, standHeight, tileCenter } from '../render/layout';
import { buildTerrainMesh } from '../render/terrain-mesh';
import { buildingKey, pieceProfile, type BuildingTile } from './building';
import { blankScene, gridFromScene } from './grid-from-scene';
import { sceneSchema, type SceneDoc } from './schema';

type Placed = Partial<BuildingTile> & Pick<BuildingTile, 'x' | 'y' | 'tile'>;

/** A flat room five wide and three deep, with pieces stood on it. */
function room(pieces: Placed[], width = 5, height = 3): SceneDoc {
  const shapes: Record<string, string> = { platform: 'floor', steps: 'stairs', block: 'block', barrier: 'wall' };
  const tiles: Record<string, BuildingTile> = {};
  for (const piece of pieces) {
    const full: BuildingTile = { level: 0, shape: shapes[piece.tile!]!, material: 'stone', rotation: 0, ...piece };
    tiles[buildingKey(full)] = full;
  }
  return sceneSchema.parse({ ...blankScene('room', width, height), buildingTiles: tiles });
}

describe('how high a piece stands', () => {
  it('is a block for a block, a quarter for a floor, the middle of the flight for stairs', () => {
    expect(pieceProfile('block')).toEqual({ stand: 1, bars: false });
    expect(pieceProfile('floor')).toEqual({ stand: 0.25, bars: false });
    expect(pieceProfile('stairs').stand).toBeCloseTo(0.625, 6);
    expect(pieceProfile('stairs').bars).toBe(false);
  });

  it('is nothing for a wall, which bars its tile at a block and is stepped over below one', () => {
    expect(pieceProfile('wall')).toEqual({ stand: 0, bars: true });
    expect(pieceProfile('wall', 0.75)).toEqual({ stand: 0, bars: false });
    expect(pieceProfile('wall', 0.5)).toEqual({ stand: 0, bars: false });
  });

  it('is nothing for a structure nobody declared', () => {
    expect(pieceProfile('gazebo')).toEqual({ stand: 0, bars: false });
  });
});

describe('a grid built from placed tiles', () => {
  it('stands a creature on top of the stack, from the level each piece was placed at', () => {
    const { grid } = gridFromScene(room([
      { x: 1, y: 1, tile: 'platform' },
      { x: 2, y: 1, tile: 'platform' },
      { x: 2, y: 1, tile: 'block', level: 0.25 },
      { x: 3, y: 1, tile: 'block', level: 0 },
      { x: 3, y: 1, tile: 'block', level: 1 },
    ]));
    expect(grid.standAt(grid.indexOf(0, 1))).toBe(0);
    expect(grid.standAt(grid.indexOf(1, 1))).toBe(0.25);
    expect(grid.standAt(grid.indexOf(2, 1))).toBe(1.25);
    expect(grid.standAt(grid.indexOf(3, 1))).toBe(2);
  });

  it('leaves the painted ground alone, so a save reads back the heights it was given', () => {
    const { grid } = gridFromScene(room([{ x: 1, y: 1, tile: 'block' }]));
    expect(grid.heightAt(grid.indexOf(1, 1))).toBe(0);
  });

  it('takes the ground when the ground is higher than what stands on it', () => {
    const scene = room([{ x: 1, y: 1, tile: 'platform' }]);
    scene.heights[1 * 5 + 1] = 2;
    const { grid } = gridFromScene(scene);
    expect(grid.standAt(grid.indexOf(1, 1))).toBeCloseTo(2 * SLAB_BLOCKS, 6);
  });

  it('can be stood on wherever a block is, and not where a wall a block high runs', () => {
    const { grid } = gridFromScene(room([
      { x: 1, y: 1, tile: 'block' },
      { x: 2, y: 1, tile: 'barrier' },
      { x: 3, y: 1, tile: 'barrier', height: 0.5 },
    ]));
    expect(grid.isPassable(grid.indexOf(1, 1))).toBe(true);
    expect(grid.isPassable(grid.indexOf(2, 1))).toBe(false);
    expect(grid.blocksSight(grid.indexOf(2, 1))).toBe(true);
    // Half a wall is stepped over and seen over, and whoever stands by it has cover.
    expect(grid.isPassable(grid.indexOf(3, 1))).toBe(true);
    expect(grid.blocksSight(grid.indexOf(3, 1))).toBe(false);
    expect(grid.providesCover(grid.indexOf(3, 1))).toBe(true);
    expect(grid.standAt(grid.indexOf(3, 1))).toBe(0);
  });

  it('carries all of it across when the editor rebuilds the ground under a live grid', () => {
    const live = gridFromScene(room([])).grid;
    live.adopt(gridFromScene(room([{ x: 1, y: 1, tile: 'block' }, { x: 2, y: 1, tile: 'barrier' }])).grid);
    expect(live.standAt(live.indexOf(1, 1))).toBe(1);
    expect(live.isPassable(live.indexOf(2, 1))).toBe(false);
    live.adopt(gridFromScene(room([])).grid);
    expect(live.standAt(live.indexOf(1, 1))).toBe(0);
    expect(live.isPassable(live.indexOf(2, 1))).toBe(true);
  });
});

describe('walking over placed tiles', () => {
  it('steps up half a block and is stopped by three quarters, which is a block beside a floor tile', () => {
    const { grid } = gridFromScene(room([
      { x: 1, y: 1, tile: 'platform' },
      { x: 1, y: 1, tile: 'platform', level: 0.25 },
      { x: 3, y: 0, tile: 'platform' },
      { x: 3, y: 1, tile: 'platform' },
      { x: 3, y: 2, tile: 'platform' },
      { x: 4, y: 1, tile: 'block' },
    ], 5, 3));
    const field = new Pathfinder(grid).reachable(grid.indexOf(0, 1), 50);
    expect(grid.standAt(grid.indexOf(1, 1))).toBe(0.5);
    expect(field.canReach(grid.indexOf(1, 1))).toBe(true);
    expect(field.canReach(grid.indexOf(3, 1))).toBe(true);
    // From the floor tile's quarter to the block's top is three quarters: a jump, not a step.
    expect(field.canReach(grid.indexOf(4, 1))).toBe(false);
    expect(WALKABLE_RISE).toBeLessThan(0.75);
    expect(WALKABLE_RISE).toBeGreaterThanOrEqual(2 * SLAB_BLOCKS);
  });

  it('finds the way up the moment stairs are placed beside the block: nothing else is told', () => {
    const before = gridFromScene(room([{ x: 3, y: 1, tile: 'block' }])).grid;
    const pathfinder = new Pathfinder(before);
    expect(pathfinder.reachable(before.indexOf(0, 1), 50).canReach(before.indexOf(3, 1))).toBe(false);
    before.adopt(gridFromScene(room([{ x: 3, y: 1, tile: 'block' }, { x: 2, y: 1, tile: 'steps', rotation: 1 }])).grid);
    expect(pathfinder.reachable(before.indexOf(0, 1), 50).canReach(before.indexOf(3, 1))).toBe(true);
  });

  it('keeps a body off the rim of a drop it could not step down', () => {
    const { grid } = gridFromScene(room([{ x: 1, y: 1, tile: 'block' }]));
    expect(canStandAt(grid, { x: 1, y: 1 })).toBe(true);
    expect(canStandAt(grid, { x: 1.4, y: 1 })).toBe(false);
  });
});

describe('seeing over placed tiles', () => {
  it('is stopped by a block between two on the floor, and not between two stood on blocks', () => {
    const low = gridFromScene(room([{ x: 2, y: 1, tile: 'block' }])).grid;
    expect(hasLineOfSight(low, low.indexOf(0, 1), low.indexOf(4, 1))).toBe(false);
    const high = gridFromScene(room([0, 1, 2, 3, 4].map((x) => ({ x, y: 1, tile: 'block' })))).grid;
    expect(hasLineOfSight(high, high.indexOf(0, 1), high.indexOf(4, 1))).toBe(true);
  });

  it('looks down from a block over a floor tile', () => {
    const { grid } = gridFromScene(room([{ x: 0, y: 1, tile: 'block' }, { x: 2, y: 1, tile: 'platform' }]));
    expect(hasLineOfSight(grid, grid.indexOf(0, 1), grid.indexOf(4, 1))).toBe(true);
  });
});

describe('drawing on placed tiles', () => {
  it('stands a token on the top of the stack, a whole tile to the level', () => {
    const { grid } = gridFromScene(room([{ x: 1, y: 1, tile: 'block', level: 1 }]));
    const tile = grid.indexOf(1, 1);
    expect(standHeight(grid, tile)).toBeCloseTo(DEFAULT_LAYOUT.baseHeight + 2, 6);
    expect(tileCenter(grid, tile).y).toBeCloseTo(DEFAULT_LAYOUT.baseHeight + 2, 6);
    expect(spotToWorld(grid, { x: 1, y: 1 }).y).toBeCloseTo(DEFAULT_LAYOUT.baseHeight + 2, 6);
    expect(standHeight(grid, grid.indexOf(0, 0))).toBeCloseTo(DEFAULT_LAYOUT.baseHeight, 6);
  });

  it('answers a pointer on top of a block with the block, not the floor behind it', () => {
    const { grid } = gridFromScene(room([{ x: 2, y: 1, tile: 'block', level: 0 }, { x: 2, y: 1, tile: 'block', level: 1 }]));
    const terrain = buildTerrainMesh(grid);
    const standing = terrain.meshes.find((mesh) => mesh.name === 'terrain:standing')!;
    expect(standing).toBeDefined();
    expect(standing.material).toMatchObject({ visible: false });
    // Looking down and north at the top of the stack: the ray would reach the floor a tile or two behind it.
    const top = tileCenter(grid, grid.indexOf(2, 1));
    const from = new Vector3(top.x, top.y + 4, top.z + 4);
    const ray = new Raycaster(from, new Vector3(top.x, top.y, top.z).sub(from).normalize());
    for (const mesh of terrain.meshes) mesh.updateMatrixWorld();
    const hit = ray.intersectObjects(terrain.meshes, false)[0]!;
    expect(terrain.tileOf(hit.object as never, hit.faceIndex ?? -1)).toBe(grid.indexOf(2, 1));
    terrain.dispose();
  });

  it('adds nothing to a room with nothing stacked in it', () => {
    const terrain = buildTerrainMesh(gridFromScene(room([])).grid);
    expect(terrain.meshes.some((mesh) => mesh.name === 'terrain:standing')).toBe(false);
    terrain.dispose();
  });
});
