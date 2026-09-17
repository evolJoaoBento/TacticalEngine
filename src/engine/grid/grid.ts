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

/** Nothing stacked on a tile: the ground is what a walk meets there. */
export const NOTHING_STACKED = -1;

/**
 * A place on the board in tile units, continuous: (0, 0) is the centre of
 * the first tile, (0.5, 0) its east edge. Where a creature actually stands;
 * the tile it counts as standing on is the one this rounds to.
 */
export interface Spot {
  readonly x: number;
  readonly y: number;
}

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
  /** Replaceable: an editor can change what a terrain type is, and `adopt` brings the change in. */
  palette: TerrainPalette;
  /** Elevation level per tile, row-major. */
  readonly heights: Int16Array;
  /** Terrain palette index per tile, row-major. */
  readonly terrain: Uint8Array;
  /**
   * What is stacked on each tile, as a palette index, or -1 for nothing. Row-major.
   *
   * The ground is one kind of tile per cell and always there; a structure is a piece
   * stamped on top of it, and a cell can carry several at different heights. This is the
   * topmost of them - what a walk actually meets - resolved once when the grid is built
   * rather than searched for on every query.
   *
   * Deliberately separate from `terrain` rather than replacing it, because the two are
   * asked different questions. `terrainAt` is "what is the ground here", which is what the
   * ground mesh is coloured by and what the tile models are drawn from; the movement
   * methods ask "what is on top here", and get this when there is anything.
   */
  readonly overlay: Int16Array;

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
    this.overlay = new Int16Array(count).fill(NOTHING_STACKED);
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

  /** The tile a spot lies in: the nearest centre. `NO_TILE` off the map. */
  tileAtSpot(x: number, y: number): number {
    return this.indexOf(Math.round(x), Math.round(y));
  }

  /** The centre of a tile as a spot; off the map for a non-tile. */
  spotOf(index: number): Spot {
    return this.isTile(index) ? { x: this.xOf(index), y: this.yOf(index) } : { x: -1, y: -1 };
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

  /**
   * Take on another grid's ground: its palette, its terrain and its heights.
   *
   * The editor rebuilds a grid from the document whenever the ground changes, but the old
   * object is the one the camera, the party and the view all hold - so the new ground moves
   * into it rather than the reference being swapped. The palette comes with it, or a terrain
   * type the document just gave a model would go on being drawn the way it was.
   */
  adopt(other: TileGrid): void {
    this.palette = other.palette;
    this.terrain.set(other.terrain);
    this.heights.set(other.heights);
    this.overlay.set(other.overlay);
  }

  /**
   * The ground at a tile: what it is made of, whatever has been stacked on it.
   *
   * Deliberately not overlay-aware. This is what the ground mesh is coloured by and what
   * `tile-models` draws a floor from, and a wall stamped on a cell does not turn the earth
   * under it into wall. What a walk meets is `topAt`, and every movement method uses that.
   */
  terrainAt(index: number): TerrainType {
    return this.palette.at(this.terrain[index] ?? 0);
  }

  /**
   * What a creature standing on a tile actually meets: the topmost piece stacked there,
   * or the ground when nothing is.
   *
   * This is the whole of the fusion as far as the rules are concerned. Cost, passability,
   * cover and sight all read it, so a wall placed as a kind of tile stops a walk for the
   * same reason a wall painted as ground always did - one question, asked in one place.
   */
  topAt(index: number): TerrainType {
    const stacked = this.overlay[index] ?? NOTHING_STACKED;
    return stacked === NOTHING_STACKED ? this.terrainAt(index) : this.palette.at(stacked);
  }

  /** Movement points to enter a tile. `Infinity` for impassable terrain. */
  costAt(index: number): number {
    const type = this.topAt(index);
    return type.passable ? type.cost : Infinity;
  }

  isPassable(index: number): boolean {
    return this.isTile(index) && this.topAt(index).passable;
  }

  blocksSight(index: number): boolean {
    return !this.isTile(index) || this.topAt(index).blocksSight;
  }

  /**
   * Whether a creature standing here has cover.
   *
   * A method rather than something a caller reads off `terrainAt`, which is how `los.ts`
   * used to ask: reaching through the ground meant a low wall stacked on a cell gave no
   * cover to whoever sheltered behind it, while the same wall painted as ground did.
   */
  providesCover(index: number): boolean {
    return this.isTile(index) && this.topAt(index).providesCover;
  }

  /** Stack a kind of tile on a cell, or `NOTHING_STACKED` to leave the ground bare. */
  setOverlay(index: number, terrainIndex: number): void {
    if (this.isTile(index)) this.overlay[index] = terrainIndex;
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
   * The visit order is fixed — west, east, north, south, then north-west,
   * north-east, south-west, south-east — which is what makes tie-breaking in
   * pathfinding deterministic.
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
