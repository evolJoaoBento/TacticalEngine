/**
 * The tile grid: elevation and terrain stored as typed arrays.
 *
 * Tiles are addressed by a single integer index (`y * width + x`) throughout the
 * engine. Indices, not `{x, y}` objects, are what pathfinding, line of sight and
 * occupancy pass around — they compare and hash for free, and nothing allocates
 * per tile visited. `xOf`/`yOf` convert when a caller genuinely needs coordinates.
 *
 * DOM- and WebGL-free: the renderer builds its meshes from a grid, never the
 * other way round.
 */

import { TerrainPalette, type TerrainType } from './terrain';

/** Not a tile. Returned by lookups that fall outside the grid. */
export const NO_TILE = -1;

export interface GridOptions {
  width: number;
  height: number;
  palette?: TerrainPalette;
  /** Initial terrain index for every tile. Defaults to 0, the palette's first type. */
  fillTerrain?: number;
  /** Initial elevation for every tile. Defaults to 0. */
  fillHeight?: number;
}

export class TileGrid {
  readonly width: number;
  readonly height: number;
  readonly palette: TerrainPalette;
  /** Elevation level per tile, row-major. */
  readonly heights: Int16Array;
  /** Terrain palette index per tile, row-major. */
  readonly terrain: Uint8Array;

  constructor(options: GridOptions) {
    const { width, height } = options;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      throw new RangeError(`grid needs positive integer dimensions, got ${width}x${height}`);
    }
    this.width = width;
    this.height = height;
    this.palette = options.palette ?? new TerrainPalette();

    const count = width * height;
    this.heights = new Int16Array(count);
    this.terrain = new Uint8Array(count);
    if (options.fillHeight !== undefined && options.fillHeight !== 0) {
      this.heights.fill(options.fillHeight);
    }
    if (options.fillTerrain !== undefined && options.fillTerrain !== 0) {
      this.terrain.fill(options.fillTerrain);
    }
  }

  /** Number of tiles. */
  get size(): number {
    return this.width * this.height;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  /** Tile index for a coordinate, or `NO_TILE` when out of bounds. */
  indexOf(x: number, y: number): number {
    return this.inBounds(x, y) ? y * this.width + x : NO_TILE;
  }

  xOf(index: number): number {
    return index % this.width;
  }

  yOf(index: number): number {
    return (index / this.width) | 0;
  }

  isTile(index: number): boolean {
    return index >= 0 && index < this.size;
  }

  heightAt(index: number): number {
    return this.heights[index] ?? 0;
  }

  terrainAt(index: number): TerrainType {
    return this.palette.at(this.terrain[index] ?? 0);
  }

  /** Movement points to enter a tile. `Infinity` for impassable terrain. */
  costAt(index: number): number {
    const type = this.terrainAt(index);
    return type.passable ? type.cost : Infinity;
  }

  isPassable(index: number): boolean {
    return this.isTile(index) && this.terrainAt(index).passable;
  }

  blocksSight(index: number): boolean {
    return !this.isTile(index) || this.terrainAt(index).blocksSight;
  }

  setTerrain(index: number, terrainIndex: number): void {
    if (this.isTile(index)) this.terrain[index] = terrainIndex;
  }

  setTerrainById(index: number, id: string): void {
    this.setTerrain(index, this.palette.require(id));
  }

  setHeight(index: number, level: number): void {
    if (this.isTile(index)) this.heights[index] = level;
  }

  /** Manhattan distance in tiles — the legacy prototype's measure, 4-neighbour. */
  manhattanDistance(a: number, b: number): number {
    return Math.abs(this.xOf(a) - this.xOf(b)) + Math.abs(this.yOf(a) - this.yOf(b));
  }

  /** Chebyshev distance in tiles — the 8-neighbour measure. */
  chebyshevDistance(a: number, b: number): number {
    return Math.max(Math.abs(this.xOf(a) - this.xOf(b)), Math.abs(this.yOf(a) - this.yOf(b)));
  }

  /** Straight-line distance in tiles, for range bands and effect radii. */
  euclideanDistance(a: number, b: number): number {
    return Math.hypot(this.xOf(a) - this.xOf(b), this.yOf(a) - this.yOf(b));
  }

  /**
   * Visit the four orthogonal neighbours of a tile, then — when `diagonals` is on —
   * the four diagonal ones. Allocation-free: the callback receives indices.
   *
   * The visit order is fixed (west, east, north, south, then the diagonals
   * clockwise from north-west), which is what makes tie-breaking in pathfinding
   * deterministic.
   */
  forEachNeighbor(index: number, diagonals: boolean, visit: (neighbor: number) => void): void {
    if (!this.isTile(index)) return;
    const x = this.xOf(index);
    const y = this.yOf(index);

    if (x > 0) visit(index - 1);
    if (x < this.width - 1) visit(index + 1);
    if (y > 0) visit(index - this.width);
    if (y < this.height - 1) visit(index + this.width);
    if (!diagonals) return;

    const west = x > 0;
    const east = x < this.width - 1;
    const north = y > 0;
    const south = y < this.height - 1;
    if (north && west) visit(index - this.width - 1);
    if (north && east) visit(index - this.width + 1);
    if (south && west) visit(index + this.width - 1);
    if (south && east) visit(index + this.width + 1);
  }

  /** Whether two tiles touch diagonally rather than orthogonally. */
  isDiagonalStep(from: number, to: number): boolean {
    return this.xOf(from) !== this.xOf(to) && this.yOf(from) !== this.yOf(to);
  }
}
