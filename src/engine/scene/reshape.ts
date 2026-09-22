/**
 * A room growing to reach what was laid outside it.
 *
 * A scene is a rectangle of cells counted from its north-west corner, and everything in it -
 * a spawn, a door, a trigger, a placed piece, where somebody is standing - is a coordinate
 * from that corner. Growing east or south only adds cells. Growing west or north moves the
 * corner, and so every coordinate in the room has to move with it: that is the whole of this
 * file. `origin` on the document is the running total of those moves, which is how a game
 * already being played in the room can tell how far its own tiles have slid.
 *
 * Pure: a scene goes in and the fields that change come out, new arrays and new objects
 * throughout, so whoever applies it can keep the old ones by reference to put back.
 */

import { NO_TILE } from '../grid/grid';
import { VOID_TERRAIN_ID } from '../grid/terrain';
import { BUILD_LIMIT, buildingKey, type BuildingTile } from './building';
import type { SceneDoc } from './schema';
import type { SceneStateSnapshot } from './state';

/** No room grows past this on a side. The schema allows 512; a ground mesh rebuilt on every stroke does not want it. */
export const MAX_GROWN = 128;

/** How a room changes shape: how far its contents move, and how big it ends up. */
export interface Growth {
  readonly dx: number;
  readonly dy: number;
  readonly width: number;
  readonly height: number;
}

/** A rectangle of cells, both corners included. */
export interface Reach {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/**
 * What it takes for a room to hold these cells: null when it holds them already, or when
 * holding them would take it past `cap` - a piece a million tiles off is scenery, not floor.
 */
export function growthToReach(scene: Pick<SceneDoc, 'width' | 'height'>, reach: Reach, cap = MAX_GROWN): Growth | null {
  const dx = Math.max(0, -reach.minX);
  const dy = Math.max(0, -reach.minY);
  const width = Math.max(scene.width, reach.maxX + 1) + dx;
  const height = Math.max(scene.height, reach.maxY + 1) + dy;
  if (width === scene.width && height === scene.height) return null;
  if (width > Math.max(cap, scene.width) || height > Math.max(cap, scene.height)) return null;
  return { dx, dy, width, height };
}

/** The fields of a scene that say where things are. */
export type SceneShape = Pick<
  SceneDoc,
  'width' | 'height' | 'terrain' | 'heights' | 'tints' | 'spawns' | 'decos' | 'interactables' | 'encounters' | 'buildingTiles' | 'origin'
>;

const within = (n: number): number => Math.max(-BUILD_LIMIT, Math.min(BUILD_LIMIT, n));

/**
 * The scene grown: its cells moved `dx, dy` into a bigger rectangle, everything in it moved
 * with them, and the new cells filled with `fill` - nothing, unless told otherwise, so that
 * what is walkable out there is what was laid there.
 */
export function grownScene(scene: SceneDoc, growth: Growth, fill: string = VOID_TERRAIN_ID): SceneShape {
  const { dx, dy, width, height } = growth;
  const count = width * height;
  const terrain = new Array<string>(count).fill(fill);
  const heights = new Array<number>(count).fill(0);
  const tints = scene.tints === undefined ? undefined : new Array<string>(count).fill('');
  for (let y = 0; y < scene.height; y++) {
    for (let x = 0; x < scene.width; x++) {
      if (x + dx >= width || y + dy >= height) continue;
      const from = y * scene.width + x;
      const to = (y + dy) * width + x + dx;
      terrain[to] = scene.terrain[from]!;
      heights[to] = scene.heights[from]!;
      if (tints !== undefined) tints[to] = scene.tints?.[from] ?? '';
    }
  }

  const moved = <P extends { x: number; y: number }>(p: P): P => ({ ...p, x: within(p.x + dx), y: within(p.y + dy) });
  const origin = { x: (scene.origin?.x ?? 0) + dx, y: (scene.origin?.y ?? 0) + dy };
  return {
    width,
    height,
    terrain,
    heights,
    ...(tints === undefined ? {} : { tints }),
    spawns: scene.spawns.map(moved),
    decos: scene.decos.map((deco) => ({ ...deco, position: moved(deco.position) })),
    interactables: scene.interactables.map((thing) => ({ ...thing, position: moved(thing.position) })),
    encounters: scene.encounters.map((encounter) => ({
      ...encounter,
      adversaries: encounter.adversaries.map((placement) => ({ ...placement, position: moved(placement.position) })),
      triggerCells: encounter.triggerCells.map(moved),
    })),
    ...(scene.buildingTiles === undefined ? {} : { buildingTiles: movedPieces(scene.buildingTiles, moved) }),
    ...(origin.x === 0 && origin.y === 0 ? {} : { origin }),
  };
}

/** Every piece moved, under the key its new cell gives it - the `#n` of an overlap kept. */
function movedPieces(
  pieces: Readonly<Record<string, BuildingTile>>,
  moved: (piece: BuildingTile) => BuildingTile,
): Record<string, BuildingTile> {
  const out: Record<string, BuildingTile> = {};
  for (const [key, piece] of Object.entries(pieces)) {
    const next = moved(piece);
    const cell = buildingKey(next);
    const hash = key.indexOf('#');
    let to = hash < 0 ? cell : `${cell}${key.slice(hash)}`;
    // Only a document whose keys had already drifted from its pieces can collide; it still loses nothing.
    for (let n = 1; to in out; n++) to = `${cell}#${n}`;
    out[to] = next;
  }
  return out;
}

/**
 * Where everybody was, in the room as it is now.
 *
 * A snapshot holds a tile index and a spot per creature, and both are counted from the
 * corner that just moved. `dx, dy` may be negative - a growth undone - and whoever that
 * leaves outside the room is stood on `fallback`.
 */
export function shiftSnapshot(
  snapshot: SceneStateSnapshot,
  oldWidth: number,
  dx: number,
  dy: number,
  width: number,
  height: number,
  fallback: number = NO_TILE,
): SceneStateSnapshot {
  const entities: SceneStateSnapshot['entities'] = {};
  for (const [id, entity] of Object.entries(snapshot.entities)) {
    if (entity.tile === NO_TILE) {
      entities[id] = entity;
      continue;
    }
    const x = (entity.tile % oldWidth) + dx;
    const y = Math.floor(entity.tile / oldWidth) + dy;
    if (x < 0 || y < 0 || x >= width || y >= height) {
      const { at: _lost, ...rest } = entity;
      entities[id] = { ...rest, tile: fallback };
      continue;
    }
    entities[id] = {
      ...entity,
      tile: y * width + x,
      ...(entity.at === undefined ? {} : { at: { x: entity.at.x + dx, y: entity.at.y + dy } }),
    };
  }
  return { ...snapshot, entities };
}
