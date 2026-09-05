/**
 * Terrain types and the palette a grid indexes into.
 *
 * The legacy prototype encoded terrain as two booleans on a tile
 * (`prop: 'difficult' | 'cover' | null`) and inferred impassability from height
 * arithmetic — a tile at height 4 was a wall only because nothing could step up
 * to it. That is replaced here by an explicit, data-driven terrain table: a
 * project declares its own terrain types, and the engine reads `passable`, `cost`,
 * `cover` and `blocksSight` off them rather than deducing anything.
 *
 * A grid stores one byte per tile, so a palette holds at most 256 types.
 */

import type { CoverLevel } from '../rules/cover';

export interface TerrainType {
  /** Stable id used by content and save files. Never rely on palette order. */
  readonly id: string;
  /** Display name for the editor and the inspector. */
  readonly name: string;
  /** Whether a creature can stand here at all. */
  readonly passable: boolean;
  /** Movement points to enter this tile. Ignored when impassable. */
  readonly cost: number;
  /** Cover a creature standing here benefits from. */
  readonly cover: CoverLevel;
  /** Whether the tile blocks line of sight through it. */
  readonly blocksSight: boolean;
}

export const MAX_TERRAIN_TYPES = 256;

/** Convenience for declaring a type without repeating the common defaults. */
export function terrain(
  id: string,
  overrides: Partial<Omit<TerrainType, 'id'>> = {},
): TerrainType {
  return {
    id,
    name: overrides.name ?? id,
    passable: overrides.passable ?? true,
    cost: overrides.cost ?? 1,
    cover: overrides.cover ?? 'none',
    blocksSight: overrides.blocksSight ?? false,
  };
}

/**
 * The terrain the legacy prototype had, generalized. Index 0 is always the
 * default terrain, so a zeroed tile array is a valid open floor.
 */
export const DEFAULT_TERRAIN_TYPES: readonly TerrainType[] = [
  terrain('floor', { name: 'Floor' }),
  terrain('difficult', { name: 'Difficult Terrain', cost: 2 }),
  terrain('cover', { name: 'Cover', cover: 'light' }),
  terrain('wall', { name: 'Wall', passable: false, cost: Infinity, blocksSight: true }),
];

/**
 * An ordered set of terrain types. The index is what a grid stores; the id is
 * what content and save files use, so a palette can be reordered without
 * invalidating authored data as long as ids are stable.
 */
export class TerrainPalette {
  readonly types: readonly TerrainType[];
  private readonly indexById: ReadonlyMap<string, number>;

  constructor(types: readonly TerrainType[] = DEFAULT_TERRAIN_TYPES) {
    if (types.length === 0) throw new RangeError('a terrain palette needs at least one type');
    if (types.length > MAX_TERRAIN_TYPES) {
      throw new RangeError(`a terrain palette holds at most ${MAX_TERRAIN_TYPES} types`);
    }
    const byId = new Map<string, number>();
    types.forEach((type, i) => {
      if (byId.has(type.id)) throw new RangeError(`duplicate terrain id "${type.id}"`);
      byId.set(type.id, i);
    });
    this.types = types;
    this.indexById = byId;
  }

  get size(): number {
    return this.types.length;
  }

  /** Index for an id, or -1 when the palette has no such type. */
  indexOf(id: string): number {
    return this.indexById.get(id) ?? -1;
  }

  /** Index for an id; throws when unknown, for content that must resolve. */
  require(id: string): number {
    const i = this.indexOf(id);
    if (i < 0) throw new RangeError(`unknown terrain id "${id}"`);
    return i;
  }

  /** The type at an index. Out-of-range indices resolve to index 0. */
  at(index: number): TerrainType {
    return this.types[index] ?? this.types[0]!;
  }

  has(id: string): boolean {
    return this.indexById.has(id);
  }
}
