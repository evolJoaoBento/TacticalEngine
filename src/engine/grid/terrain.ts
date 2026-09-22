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



export interface TerrainType {
  /** Stable id used by content and save files. Never rely on palette order. */
  readonly id: string;
  /** Display name for the editor and the inspector. */
  readonly name: string;
  /** Whether a creature can stand here at all. */
  readonly passable: boolean;
  /** Movement points to enter this tile. Ignored when impassable. */
  readonly cost: number;
  /**
   * Whether a creature standing here has cover — a low wall, rubble, a cart.
   * SRD 2.0 made cover binary; the graded Light/Full levels are gone.
   */
  readonly providesCover: boolean;
  /** Whether the tile blocks line of sight through it. */
  readonly blocksSight: boolean;
  /**
   * The colour the ground is drawn in where this type lies, unless a tile carries a tint
   * of its own. On the type rather than in a table beside it, so a project can declare a
   * kind of ground and say what it looks like in the same breath.
   */
  readonly color?: string;
  /**
   * A model every tile of this type is drawn with, if it should be drawn as something
   * rather than coloured. Any id the library or the project's imports can supply, so a
   * `.glb` customises the ground the way it customises a creature. The ground mesh is
   * still built underneath: this is a look, and the grid is what a walk reads.
   */
  readonly model?: string;
  /**
   * How big the model stands, in tiles: `1` fills the cell, `0.5` covers a quarter of it.
   *
   * On the kind of tile rather than on the model, because the same file is a different
   * size depending on what it is being used for — a creature is shrunk to stand in one
   * cell, a floor piece is authored to fill it, and both are scaled from the same export.
   * Absolute, not a multiplier: this replaces what the model declares for itself rather
   * than compounding with it, so the number here is the size you get.
   *
   * Absent means the model's own scale, which is what every tile drew at before there was
   * a field to say otherwise.
   */
  readonly scale?: number;
  /**
   * The structure a tile of this kind is: a block, a floor, a wall, a staircase, or
   * anything else the project has declared.
   *
   * This is what fuses the two halves of the editor. A kind of tile used to be ground and
   * nothing else - a colour, a cost, a thing you painted - while structures were a
   * separate tab stamping separate pieces. Naming a structure here makes the two one
   * thing: the placer stamps a piece of this kind, stackable, and what a walk over that
   * cell costs is read off the kind of tile on top.
   *
   * Absent means ground, which is what every kind of tile was before. A project that
   * never names a structure behaves exactly as it did.
   */
  readonly structure?: string;
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
    providesCover: overrides.providesCover ?? false,
    blocksSight: overrides.blocksSight ?? false,
    // Spread rather than assigned: an explicit undefined is not the same as absent.
    ...(overrides.color === undefined ? {} : { color: overrides.color }),
    ...(overrides.model === undefined ? {} : { model: overrides.model }),
    ...(overrides.scale === undefined ? {} : { scale: overrides.scale }),
    ...(overrides.structure === undefined ? {} : { structure: overrides.structure }),
  };
}

/**
 * The terrain the legacy prototype had, generalized. Index 0 is always the
 * default terrain, so a zeroed tile array is a valid open floor.
 */
export const DEFAULT_TERRAIN_TYPES: readonly TerrainType[] = [
  terrain('floor', { name: 'Floor', color: '#5d8a4a' }),
  terrain('difficult', { name: 'Difficult Terrain', cost: 2, color: '#6b6350' }),
  terrain('cover', { name: 'Cover', providesCover: true, color: '#7d7a6d' }),
  terrain('wall', { name: 'Wall', passable: false, cost: Infinity, blocksSight: true, color: '#3b3f4a' }),
  // The stackable four, one per atom the engine builds from. They are appended rather than
  // folded into the flat four above, and that is the whole compatibility story: `wall`
  // stays ground, so every cell painted with it before the two halves were fused is still
  // exactly what it was, and `floor` stays index 0 so a zeroed tile array is open floor.
  //
  // Nothing costs less than 1 to enter. Pathfinding takes its A* heuristic from the
  // cheapest passable cost in the palette, so a kind cheaper than the ground would quietly
  // change how every search in the game explores.
  // Each drawn with the file that is that thing, at one tile across. The colour stays as
  // what the strip shows on its card and as what stands in while the file is still on its
  // way - a kind of tile is never nothing on screen just because a load is slow.
  terrain('platform', { name: 'Platform', structure: 'floor', model: 'grass-ground', scale: 1, color: '#618950' }),
  terrain('steps', { name: 'Steps', structure: 'stairs', model: 'stone-stairs', scale: 1, color: '#9a958c' }),
  // A block and a barrier are not impassable kinds: how high a piece stands is what stops a
  // walk or a line of sight, so a block is somewhere to climb to and a low wall is stepped over.
  terrain('block', { name: 'Block', structure: 'block', model: 'stone-block', scale: 1, color: '#8a8994' }),
  terrain('barrier', { name: 'Barrier', structure: 'wall', model: 'stone-wall', scale: 1, providesCover: true, color: '#6f6a63' }),
];

/**
 * Nothing at all: the cells a room takes in when it grows to reach tiles laid outside it.
 *
 * A room is a rectangle and what is built in it need not be, so a rectangle that has grown
 * round a platform standing off to one side is mostly this - not drawn, not walked on, and no
 * bar to a line of sight or a jump, which is what makes a gap a gap. A piece stacked on such
 * a cell is ground like any other: what a walk meets is the piece.
 *
 * Every palette knows it, whether the project wrote it down or not, so a document that names
 * it always resolves; a project that declares a kind with this id has said what its own is.
 */
export const VOID_TERRAIN_ID = 'void';
export const VOID_TERRAIN: TerrainType = terrain(VOID_TERRAIN_ID, { name: 'Nothing', passable: false, cost: Infinity });

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
    // Last, so every index a grid already stores means what it meant.
    if (types.length < MAX_TERRAIN_TYPES && !types.some((type) => type.id === VOID_TERRAIN_ID)) types = [...types, VOID_TERRAIN];
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
