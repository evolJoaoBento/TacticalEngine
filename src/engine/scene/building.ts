/** Sparse construction cells. Empty space never allocates a tile. */
import { z } from 'zod';

/**
 * How far construction reaches on every axis.
 *
 * Integer coordinates stay precise in documents at this range; rendering uses
 * chunk-local vertices so float32 does not lose the far corners.
 */
export const BUILD_LIMIT = 1_000_000;

/** The pieces a build tool can stamp, in the order the strip lists them. */
export const BUILD_SHAPES = ['block', 'floor', 'wall', 'stairs'] as const;

/** What a piece can be made of, in the order the panel offers them. */
export const BUILD_MATERIAL_IDS = ['stone', 'wood', 'grass'] as const;

/** The colour the renderer tints each material's instances, and the panel its swatch. */
export const BUILD_MATERIALS: Readonly<Record<(typeof BUILD_MATERIAL_IDS)[number], string>> = {
  stone: '#8a8994',
  wood: '#966844',
  grass: '#618950',
};

/**
 * Whether a number may be a piece's X or Y.
 *
 * The editor validates coordinates in three places - a typed field, a click on
 * the board, a stroke's interpolated samples - and all three mean this.
 */
export function isBuildCoordinate(n: number): boolean {
  return Number.isInteger(n) && Math.abs(n) <= BUILD_LIMIT;
}

/** Whether a number may be a piece's Z: quarter tiles, within the same reach. */
export function isBuildZ(n: number): boolean {
  return Number.isInteger(n * 4) && Math.abs(n) <= BUILD_LIMIT;
}

const coordinate = z.number().int().min(-BUILD_LIMIT).max(BUILD_LIMIT);

/** One piece: where it stands, what it is, and which way it faces. */
export const buildingTileSchema = z.object({
  x: coordinate,
  y: coordinate,
  /** Vertical Z, retained as `level` for compatibility with earlier projects. */
  level: z.number().min(-BUILD_LIMIT).max(BUILD_LIMIT).multipleOf(0.25),
  height: z.number().min(0.25).max(16).multipleOf(0.25).optional(),
  /**
    * Any structure the registry knows, not one of a fixed four: a project declares its
    * own, so the list cannot live in the schema. `buildingTilesSchema` checks it against
    * `isStructure`, which is where that question moved.
    */
  shape: z.string().min(1),
  /** Still an enum: there is no materials registry, and an unknown one would tint black. */
  material: z.enum(BUILD_MATERIAL_IDS),
  rotation: z.number().int().min(0).max(3),
});
/** One piece of construction, as a document holds it. */
export type BuildingTile = z.infer<typeof buildingTileSchema>;

/**
 * The record key a piece lives under.
 *
 * Keying by position is what makes the layer sparse, and it is why several
 * pieces at one position - four walls around a floor - need the `#n` suffix
 * `buildingTilesSchema` allows.
 */
export function buildingKey(p: Pick<BuildingTile, 'x' | 'y' | 'level'>): string {
  return `${p.x},${p.y},${p.level}`;
}

/** Every piece in a scene, keyed by `buildingKey` with an optional `#n` for overlaps. */
export const buildingTilesSchema = z
  .record(z.string(), buildingTileSchema)
  .superRefine((tiles, ctx) => {
    for (const [key, tile] of Object.entries(tiles)) {
      if (!isStructure(tile.shape)) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `No structure called ${JSON.stringify(tile.shape)}`,
        });
      }
      const [cell, instance, ...extra] = key.split('#');
      const numbered = instance === undefined || /^[1-9][0-9]*$/.test(instance);
      if (cell === buildingKey(tile) && extra.length === 0 && numbered) continue;
      ctx.addIssue({
        code: 'custom',
        path: [key],
        message: 'Tile key must match its coordinates and optional instance number',
      });
    }
  });

/** One box of a piece: `x, y, z` of its centre, then `sx, sy, sz` of its size. */
export type BuildingPart = readonly [number, number, number, number, number, number];

/** The four boxes a staircase is built from, ascending along +Z at rotation 0. */
const STAIR_STEPS: readonly BuildingPart[] = [
  [0, 0.125, -0.375, 1, 0.25, 0.25],
  [0, 0.25, -0.125, 1, 0.5, 0.25],
  [0, 0.375, 0.125, 1, 0.75, 0.25],
  [0, 0.5, 0.375, 1, 1, 0.25],
];

/** A stair too far away to read as steps: one box with the same silhouette. */
const STAIR_SOLID: readonly BuildingPart[] = [[0, 0.5, 0, 1, 1, 1]];

/**
 * The shapes everything else is built from, each a box or boxes in a one-tile footprint.
 *
 * These four are the atoms: a structure a project declares is some of these put together,
 * and there is nothing below them. `far` is the same shape read from a distance, where it
 * has one - stairs are four steps close up and one ramp-shaped box far off, which is what
 * keeps a city of them affordable.
 */
export const BUILD_ATOMS: Readonly<Record<string, { near: readonly BuildingPart[]; far?: readonly BuildingPart[] }>> = {
  block: { near: [[0, 0.5, 0, 1, 1, 1]] },
  floor: { near: [[0, 0.125, 0, 1, 0.25, 1]] },
  // Rotation moves this wall around all four edges, meeting at the tile corners.
  wall: { near: [[0, 0.5, -0.4, 1, 1, 0.2]] },
  stairs: { near: STAIR_STEPS, far: STAIR_SOLID },
};

/** One atom placed in a structure: which of the four, and where it sits within the tile. */
export interface StructureAtom {
  readonly shape: string;
  /** Offset from the tile's centre, in tiles. Absent means centred, which is most of them. */
  readonly at?: readonly [number, number, number];
}

/** A kind of structure: a name, and the atoms it is made of. */
export interface StructureType {
  readonly id: string;
  readonly name: string;
  readonly atoms: readonly StructureAtom[];
}

/** The four the engine ships, each a single atom, in the order the strip lists them. */
export const DEFAULT_STRUCTURES: readonly StructureType[] = BUILD_SHAPES.map((shape) => ({
  id: shape,
  name: shape[0]!.toUpperCase() + shape.slice(1),
  atoms: [{ shape }],
}));

/** Every structure the app knows, by id. Replaced when a project declares its own. */
let structures: ReadonlyMap<string, StructureType> = new Map(DEFAULT_STRUCTURES.map((s) => [s.id, s]));

/**
 * Take on a project's structures, the engine's four first.
 *
 * The four are always present and always first: a document names them, and a project that
 * declared only its own would leave every piece already placed unable to resolve.
 */
export function setStructures(declared: readonly StructureType[] = []): void {
  const byId = new Map(DEFAULT_STRUCTURES.map((s) => [s.id, s]));
  for (const type of declared) byId.set(type.id, type);
  structures = byId;
}

/** Every kind of structure there is, the engine's four first. */
export function structureTypes(): readonly StructureType[] {
  return [...structures.values()];
}

/** Whether anything can be built from this id - what the schema's enum used to answer. */
export function isStructure(id: string): boolean {
  return structures.has(id);
}

/**
 * Each part is a box in a one-tile footprint. Rotation is applied by the renderer.
 *
 * Deterministic per `(shape, simplified)`: the renderer counts the boxes before it fills
 * them, so an answer that changed between the two calls would overflow the mesh. An id
 * nothing declares draws nothing rather than throwing - a document naming a structure a
 * project has since dropped still opens, and Check is where that is reported.
 */
export function buildingParts(shape: string, simplified = false): readonly BuildingPart[] {
  const type = structures.get(shape);
  if (type === undefined) return [];
  const boxes: BuildingPart[] = [];
  for (const atom of type.atoms) {
    const source = BUILD_ATOMS[atom.shape];
    if (source === undefined) continue;
    const parts = simplified ? (source.far ?? source.near) : source.near;
    if (atom.at === undefined) {
      boxes.push(...parts);
      continue;
    }
    const [dx, dy, dz] = atom.at;
    for (const [x, y, z, sx, sy, sz] of parts) boxes.push([x + dx, y + dy, z + dz, sx, sy, sz]);
  }
  return boxes;
}
