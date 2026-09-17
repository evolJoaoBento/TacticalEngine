import { describe, it, expect } from 'vitest';
import { NOTHING_STACKED, NO_TILE, TileGrid } from './grid';
import { DEFAULT_TERRAIN_TYPES, TerrainPalette, terrain } from './terrain';
import { paletteForProject } from '../scene/grid-from-scene';

const grid = (width = 5, height = 4) => new TileGrid({ width, height });

describe('TerrainPalette', () => {
  it('resolves ids to indices and back', () => {
    const palette = new TerrainPalette();
    expect(palette.size).toBe(DEFAULT_TERRAIN_TYPES.length);
    expect(palette.indexOf('floor')).toBe(0);
    expect(palette.at(palette.require('wall')).passable).toBe(false);
    expect(palette.has('difficult')).toBe(true);
  });

  it('reports an unknown id rather than guessing', () => {
    const palette = new TerrainPalette();
    expect(palette.indexOf('lava')).toBe(-1);
    expect(() => palette.require('lava')).toThrow(/unknown terrain/);
  });

  it('falls back to the first type for an out-of-range index', () => {
    const palette = new TerrainPalette();
    expect(palette.at(200).id).toBe('floor');
  });

  it('rejects an empty palette and duplicate ids', () => {
    expect(() => new TerrainPalette([])).toThrow(RangeError);
    expect(() => new TerrainPalette([terrain('a'), terrain('a')])).toThrow(/duplicate/);
  });

  it('gives the default types the legacy prototype semantics', () => {
    const palette = new TerrainPalette();
    expect(palette.at(palette.require('difficult')).cost).toBe(2);
    expect(palette.at(palette.require('cover')).providesCover).toBe(true);
    expect(palette.at(palette.require('wall')).blocksSight).toBe(true);
  });
});

describe('TileGrid', () => {
  it('rejects non-positive or fractional dimensions', () => {
    expect(() => new TileGrid({ width: 0, height: 4 })).toThrow(RangeError);
    expect(() => new TileGrid({ width: 4, height: -1 })).toThrow(RangeError);
    expect(() => new TileGrid({ width: 2.5, height: 4 })).toThrow(RangeError);
  });

  it('converts between coordinates and indices', () => {
    const g = grid();
    expect(g.size).toBe(20);
    expect(g.indexOf(0, 0)).toBe(0);
    expect(g.indexOf(4, 3)).toBe(19);
    expect(g.xOf(7)).toBe(2);
    expect(g.yOf(7)).toBe(1);
    for (let i = 0; i < g.size; i++) expect(g.indexOf(g.xOf(i), g.yOf(i))).toBe(i);
  });

  it('reports out-of-bounds coordinates as NO_TILE', () => {
    const g = grid();
    expect(g.indexOf(-1, 0)).toBe(NO_TILE);
    expect(g.indexOf(5, 0)).toBe(NO_TILE);
    expect(g.indexOf(0, 4)).toBe(NO_TILE);
    expect(g.isTile(NO_TILE)).toBe(false);
    expect(g.isTile(20)).toBe(false);
  });

  it('starts as passable floor at height 0', () => {
    const g = grid();
    for (let i = 0; i < g.size; i++) {
      expect(g.heightAt(i)).toBe(0);
      expect(g.terrainAt(i).id).toBe('floor');
      expect(g.isPassable(i)).toBe(true);
      expect(g.costAt(i)).toBe(1);
    }
  });

  it('honours the fill options', () => {
    const g = new TileGrid({ width: 2, height: 2, fillHeight: 3, fillTerrain: 1 });
    expect(g.heightAt(0)).toBe(3);
    expect(g.terrainAt(0).id).toBe('difficult');
    expect(g.costAt(0)).toBe(2);
  });

  it('charges Infinity to enter impassable terrain', () => {
    const g = grid();
    g.setTerrainById(6, 'wall');
    expect(g.isPassable(6)).toBe(false);
    expect(g.costAt(6)).toBe(Infinity);
    expect(g.blocksSight(6)).toBe(true);
  });

  it('treats anything off the grid as impassable and sight-blocking', () => {
    const g = grid();
    expect(g.isPassable(NO_TILE)).toBe(false);
    expect(g.blocksSight(999)).toBe(true);
  });

  it('ignores writes to tiles that do not exist', () => {
    const g = grid();
    expect(() => g.setHeight(999, 4)).not.toThrow();
    expect(() => g.setTerrain(-3, 1)).not.toThrow();
  });

  it('measures distance three ways', () => {
    const g = grid(8, 8);
    const a = g.indexOf(1, 1);
    const b = g.indexOf(4, 5);
    expect(g.manhattanDistance(a, b)).toBe(7);
    expect(g.chebyshevDistance(a, b)).toBe(4);
    expect(g.euclideanDistance(a, b)).toBe(5);
  });

  describe('forEachNeighbor', () => {
    const collect = (g: TileGrid, tile: number, diagonals: boolean): number[] => {
      const out: number[] = [];
      g.forEachNeighbor(tile, diagonals, (n) => out.push(n));
      return out;
    };

    it('visits four orthogonal neighbours', () => {
      const g = grid();
      const centre = g.indexOf(2, 1);
      expect(collect(g, centre, false)).toEqual([
        g.indexOf(1, 1),
        g.indexOf(3, 1),
        g.indexOf(2, 0),
        g.indexOf(2, 2),
      ]);
    });

    it('adds the four diagonals when asked', () => {
      const g = grid();
      const centre = g.indexOf(2, 1);
      const neighbours = collect(g, centre, true);
      expect(neighbours).toHaveLength(8);
      expect(neighbours.slice(4)).toEqual([
        g.indexOf(1, 0),
        g.indexOf(3, 0),
        g.indexOf(1, 2),
        g.indexOf(3, 2),
      ]);
    });

    it('clips at the edges and corners', () => {
      const g = grid();
      expect(collect(g, g.indexOf(0, 0), false)).toEqual([g.indexOf(1, 0), g.indexOf(0, 1)]);
      expect(collect(g, g.indexOf(0, 0), true)).toHaveLength(3);
      expect(collect(g, g.indexOf(4, 3), true)).toHaveLength(3);
    });

    it('visits nothing for a tile that does not exist', () => {
      expect(collect(grid(), 999, true)).toEqual([]);
    });
  });

  it('recognises a diagonal step', () => {
    const g = grid();
    const centre = g.indexOf(2, 1);
    expect(g.isDiagonalStep(centre, g.indexOf(3, 2))).toBe(true);
    expect(g.isDiagonalStep(centre, g.indexOf(3, 1))).toBe(false);
    expect(g.isDiagonalStep(centre, g.indexOf(2, 2))).toBe(false);
  });
});

describe('a grid taking on rebuilt ground', () => {
  it('takes the palette with the tiles, so a retyped terrain is drawn the new way', () => {
    const before = new TerrainPalette([terrain('floor'), terrain('planks')]);
    const live = new TileGrid({ width: 3, height: 2, palette: before });

    // The document is edited: planks are now drawn with a model. That is a new palette.
    const after = new TerrainPalette([terrain('floor'), terrain('planks', { model: 'plank' })]);
    const rebuilt = new TileGrid({ width: 3, height: 2, palette: after });
    rebuilt.setTerrainById(rebuilt.indexOf(1, 1), 'planks');
    rebuilt.setHeight(rebuilt.indexOf(0, 0), 3);

    live.adopt(rebuilt);

    // The same object - everything else in the app is still holding it - with new ground.
    expect(live.palette).toBe(after);
    expect(live.terrainAt(live.indexOf(1, 1)).model).toBe('plank');
    expect(live.heightAt(live.indexOf(0, 0))).toBe(3);
  });

  it('copies the tiles rather than sharing them', () => {
    const live = new TileGrid({ width: 2, height: 2 });
    const rebuilt = new TileGrid({ width: 2, height: 2 });
    rebuilt.setHeight(0, 5);
    live.adopt(rebuilt);

    // Writing to the one it copied from does not reach into the one that adopted.
    rebuilt.setHeight(0, 9);
    expect(live.heightAt(0)).toBe(5);
  });

  it('takes what is stacked as well as the ground, and copies that too', () => {
    const live = new TileGrid({ width: 2, height: 2 });
    const rebuilt = new TileGrid({ width: 2, height: 2 });
    rebuilt.setOverlay(0, rebuilt.palette.require('wall'));
    live.adopt(rebuilt);
    expect(live.isPassable(0)).toBe(false);

    // Shared arrays would let a stamp in a discarded grid reach the live one.
    rebuilt.setOverlay(0, NOTHING_STACKED);
    expect(live.isPassable(0)).toBe(false);
  });
});

describe('a tile with something stacked on it', () => {
  it('is walked on as the thing on top, not the ground under it', () => {
    const g = grid();
    // Open floor, with a wall placed on it as a kind of tile.
    expect(g.isPassable(6)).toBe(true);
    g.setOverlay(6, g.palette.require('wall'));

    expect(g.isPassable(6)).toBe(false);
    expect(g.costAt(6)).toBe(Infinity);
    expect(g.blocksSight(6)).toBe(true);
    expect(g.topAt(6).id).toBe('wall');
  });

  it('is still made of the ground it was, which is what draws it', () => {
    const g = grid();
    g.setOverlay(6, g.palette.require('wall'));
    // The ground mesh is coloured by this and `tile-models` draws a floor from it: a wall
    // standing on a cell does not turn the earth under it into wall.
    expect(g.terrainAt(6).id).toBe('floor');
  });

  it('gives cover when what stands on it does, through the grid rather than the ground', () => {
    const g = grid();
    expect(g.providesCover(6)).toBe(false);
    g.setOverlay(6, g.palette.require('cover'));
    expect(g.providesCover(6)).toBe(true);
    // Off the map is not cover, the way it is not passable.
    expect(g.providesCover(NO_TILE)).toBe(false);
  });

  it('goes back to being ground when what stood on it is taken away', () => {
    const g = grid();
    g.setOverlay(6, g.palette.require('wall'));
    g.setOverlay(6, NOTHING_STACKED);
    expect(g.isPassable(6)).toBe(true);
    expect(g.topAt(6).id).toBe('floor');
  });

  it('starts bare, so a grid nothing was stamped on is the grid it always was', () => {
    const g = grid();
    for (let i = 0; i < g.size; i++) expect(g.topAt(i)).toBe(g.terrainAt(i));
  });
});

describe('a kind of ground that says what it looks like', () => {
  it('carries its colour, and the engine four keep the ones they were drawn in', () => {
    const palette = new TerrainPalette();
    expect(palette.at(palette.require('floor')).color).toBe('#5d8a4a');
    expect(palette.at(palette.require('wall')).color).toBe('#3b3f4a');
    // A type declared without one says nothing rather than guessing a colour.
    expect(terrain('bog').color).toBeUndefined();
    expect(terrain('bog', { color: '#405030' }).color).toBe('#405030');
  });

  it('reaches the palette a project is played on', () => {
    const palette = paletteForProject({
      terrainPalette: [
        { id: 'sand', name: 'Sand', passable: true, cost: 2, providesCover: false, blocksSight: false, color: '#d8c38a' },
      ],
    });
    expect(palette.at(0).color).toBe('#d8c38a');
    expect(palette.at(0).cost).toBe(2);
  });
});
