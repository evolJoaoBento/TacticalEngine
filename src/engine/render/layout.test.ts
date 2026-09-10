import { describe, it, expect } from 'vitest';
import { TileGrid } from '../grid/grid';
import {
  DEFAULT_LAYOUT,
  mapExtent,
  surfaceHeight,
  spotToWorld,
  tileAtWorld,
  tileCenter,
  worldToSpot,
} from './layout';

const grid = (w = 5, h = 3) => new TileGrid({ width: w, height: h });

describe('surfaceHeight', () => {
  it('is the base slab at ground level and grows a level at a time', () => {
    expect(surfaceHeight(0)).toBeCloseTo(0.25, 10);
    expect(surfaceHeight(1)).toBeCloseTo(0.6, 10);
    expect(surfaceHeight(4)).toBeCloseTo(0.25 + 4 * 0.35, 10);
  });

  it('follows a project-specific layout', () => {
    expect(surfaceHeight(2, { tileSize: 2, baseHeight: 1, levelHeight: 0.5 })).toBe(2);
  });
});

describe('tileCenter', () => {
  it('centres the map on the origin', () => {
    const g = grid(5, 3);
    const middle = tileCenter(g, g.indexOf(2, 1));
    expect(middle.x).toBeCloseTo(0, 10);
    expect(middle.z).toBeCloseTo(0, 10);
  });

  it('lays the grid out on XZ with +Y up', () => {
    const g = grid(5, 3);
    const east = tileCenter(g, g.indexOf(3, 1));
    const south = tileCenter(g, g.indexOf(2, 2));
    expect(east.x).toBeGreaterThan(0);
    expect(east.z).toBeCloseTo(0, 10);
    expect(south.z).toBeGreaterThan(0);
    expect(south.x).toBeCloseTo(0, 10);
  });

  it('puts the centre at the tile top, so elevation lifts it', () => {
    const g = grid();
    const tile = g.indexOf(1, 1);
    expect(tileCenter(g, tile).y).toBeCloseTo(surfaceHeight(0), 10);
    g.setHeight(tile, 3);
    expect(tileCenter(g, tile).y).toBeCloseTo(surfaceHeight(3), 10);
  });

  it('spaces neighbours exactly one tile apart', () => {
    const g = grid();
    const a = tileCenter(g, g.indexOf(1, 1));
    const b = tileCenter(g, g.indexOf(2, 1));
    expect(b.x - a.x).toBeCloseTo(DEFAULT_LAYOUT.tileSize, 10);
  });
});

describe('spots', () => {
  it('puts a tile\'s centre where tileCenter does, and reads a world point back to the same spot', () => {
    const g = grid();
    for (let tile = 0; tile < g.size; tile++) {
      const centre = tileCenter(g, tile);
      const world = spotToWorld(g, g.spotOf(tile));
      expect(world).toEqual(centre);
      const back = worldToSpot(g, world.x, world.z);
      expect(back.x).toBeCloseTo(g.xOf(tile), 10);
      expect(back.y).toBeCloseTo(g.yOf(tile), 10);
    }
  });

  it('stands a spot on the surface of the tile it lies in', () => {
    const g = grid();
    g.heights[7] = 2;
    const on = spotToWorld(g, { x: 2.3, y: 1.4 });
    expect(on.y).toBeCloseTo(surfaceHeight(2), 10);
    expect(on.x).toBeCloseTo((2.3 - 2) * DEFAULT_LAYOUT.tileSize, 10);
    const beside = spotToWorld(g, { x: 1.4, y: 1.4 });
    expect(beside.y).toBeCloseTo(surfaceHeight(0), 10);
    expect(spotToWorld(g, { x: -4, y: 0 }).y).toBe(0);
  });
});

describe('tileAtWorld', () => {
  it('inverts tileCenter for every tile', () => {
    for (const [w, h] of [
      [5, 3],
      [22, 16],
      [1, 1],
    ] as const) {
      const g = grid(w, h);
      for (let tile = 0; tile < g.size; tile++) {
        const centre = tileCenter(g, tile);
        expect(tileAtWorld(g, centre.x, centre.z)).toBe(tile);
      }
    }
  });

  it('snaps a point anywhere inside a tile to that tile', () => {
    const g = grid();
    const tile = g.indexOf(3, 2);
    const centre = tileCenter(g, tile);
    for (const [dx, dz] of [
      [0.49, 0.49],
      [-0.49, -0.49],
      [0.49, -0.49],
      [0, 0.2],
    ] as const) {
      expect(tileAtWorld(g, centre.x + dx, centre.z + dz)).toBe(tile);
    }
  });

  it('is -1 outside the map', () => {
    const g = grid();
    expect(tileAtWorld(g, 100, 0)).toBe(-1);
    expect(tileAtWorld(g, 0, -100)).toBe(-1);
  });

  it('round-trips under a project-specific tile size', () => {
    const layout = { tileSize: 2.5, baseHeight: 0.1, levelHeight: 0.2 };
    const g = grid(7, 4);
    for (let tile = 0; tile < g.size; tile++) {
      const centre = tileCenter(g, tile, layout);
      expect(tileAtWorld(g, centre.x, centre.z, layout)).toBe(tile);
    }
  });
});

describe('mapExtent', () => {
  it('measures the map in world units', () => {
    const g = grid(22, 16);
    const extent = mapExtent(g);
    expect(extent.width).toBe(22);
    expect(extent.depth).toBe(16);
    expect(extent.radius).toBeCloseTo(Math.hypot(22, 16) / 2, 10);
  });
});
