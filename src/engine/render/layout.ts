/**
 * How grid coordinates become world coordinates.
 *
 * The one place that knows a tile is a unit square and an elevation level is a
 * fixed slab thickness. Everything else in the render layer asks this, so the
 * scale can change without hunting through mesh builders — and so the engine core,
 * which knows nothing about world units, never has to.
 *
 * DOM- and three-free on purpose: it is arithmetic, and the tests for it run
 * anywhere.
 */

import type { Spot, TileGrid } from '../grid/grid';

export interface TileLayout {
  /** Width and depth of one tile in world units. */
  readonly tileSize: number;
  /** Thickness of the slab under a tile at elevation 0. */
  readonly baseHeight: number;
  /** Extra thickness per elevation level. */
  readonly levelHeight: number;
}

/**
 * The legacy prototype's proportions (TILE 1, BASE_H 0.25, LEVEL_H 0.35), so a
 * ported map reads at the scale it was authored at.
 */
export const DEFAULT_LAYOUT: TileLayout = {
  tileSize: 1,
  baseHeight: 0.25,
  levelHeight: 0.35,
};

/** World height of the top surface of a tile at a given elevation level. */
export function surfaceHeight(level: number, layout: TileLayout = DEFAULT_LAYOUT): number {
  return layout.baseHeight + level * layout.levelHeight;
}

/**
 * World height of where a creature on a tile stands: the top of the pieces stacked there, or
 * the ground when that is higher. A piece counts a whole tile per level from the base, which
 * is why this is not `surfaceHeight` of anything.
 */
export function standHeight(grid: TileGrid, tile: number, layout: TileLayout = DEFAULT_LAYOUT): number {
  return Math.max(surfaceHeight(grid.heightAt(tile), layout), layout.baseHeight + (grid.lift[tile] ?? 0) * layout.tileSize);
}

export interface WorldPoint {
  x: number;
  y: number;
  z: number;
}

/**
 * Centre of a tile's top surface, in world space.
 *
 * The grid is laid out on the XZ plane with +Y up, centred on the origin so a
 * camera framing the map does not need to know its size.
 */
export function tileCenter(
  grid: TileGrid,
  tile: number,
  layout: TileLayout = DEFAULT_LAYOUT,
): WorldPoint {
  const { tileSize } = layout;
  const x = (grid.xOf(tile) - (grid.width - 1) / 2) * tileSize;
  const z = (grid.yOf(tile) - (grid.height - 1) / 2) * tileSize;
  return { x, y: standHeight(grid, tile, layout), z };
}

/**
 * How far the ground moved when a room grew, in world units: the map is drawn centred, so a
 * room that grows on one side slides across the world, and a camera that slides with it is
 * looking at the same flagstone afterwards.
 */
export function groundSlide(was: TileGrid, now: TileGrid, layout: TileLayout = DEFAULT_LAYOUT): { x: number; z: number } {
  return {
    x: (now.origin.x - was.origin.x - (now.width - was.width) / 2) * layout.tileSize,
    z: (now.origin.y - was.origin.y - (now.height - was.height) / 2) * layout.tileSize,
  };
}

/**
 * The tile a world position sits over, or `-1` when it is off the map.
 * The inverse of `tileCenter`, for turning a raycast hit back into a tile.
 */
export function tileAtWorld(
  grid: TileGrid,
  x: number,
  z: number,
  layout: TileLayout = DEFAULT_LAYOUT,
): number {
  const spot = worldToSpot(grid, x, z, layout);
  return grid.tileAtSpot(spot.x, spot.y);
}

/** A world position as a spot in tile units - where a click landed, for a creature to walk to. */
export function worldToSpot(grid: TileGrid, x: number, z: number, layout: TileLayout = DEFAULT_LAYOUT): Spot {
  return { x: x / layout.tileSize + (grid.width - 1) / 2, y: z / layout.tileSize + (grid.height - 1) / 2 };
}

/**
 * A spot in world space, standing on the ground under it: the surface of the
 * tile the spot lies in, or the ground plane off the map.
 */
export function spotToWorld(grid: TileGrid, spot: Spot, layout: TileLayout = DEFAULT_LAYOUT): WorldPoint {
  const { tileSize } = layout;
  const tile = grid.tileAtSpot(spot.x, spot.y);
  return {
    x: (spot.x - (grid.width - 1) / 2) * tileSize,
    y: tile === -1 ? 0 : standHeight(grid, tile, layout),
    z: (spot.y - (grid.height - 1) / 2) * tileSize,
  };
}

/** World-space extent of the whole map, for framing a camera on it. */
export function mapExtent(
  grid: TileGrid,
  layout: TileLayout = DEFAULT_LAYOUT,
): { width: number; depth: number; radius: number } {
  const width = grid.width * layout.tileSize;
  const depth = grid.height * layout.tileSize;
  return { width, depth, radius: Math.hypot(width, depth) / 2 };
}

/**
 * The middle of a placement's tile in world units, at the height it stands.
 *
 * A placement carries its own height when it has one — a creature on a ledge, a
 * prop on a table — and otherwise sits on whatever the ground does there. Off
 * the grid entirely, it sits at the base height, because the editor lets a thing
 * be placed outside the room it is being written into.
 */
export function placementCentre(
  grid: TileGrid,
  layout: TileLayout,
  position: { x: number; y: number; z?: number },
): { x: number; y: number; z: number } {
  const tile = grid.indexOf(position.x, position.y);
  return {
    x: (position.x - (grid.width - 1) / 2) * layout.tileSize,
    z: (position.y - (grid.height - 1) / 2) * layout.tileSize,
    y:
      position.z === undefined
        ? tile < 0
          ? layout.baseHeight
          : standHeight(grid, tile, layout)
        : layout.baseHeight + position.z * layout.tileSize,
  };
}
