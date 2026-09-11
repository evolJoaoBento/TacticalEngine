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
  shape: z.enum(BUILD_SHAPES),
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

/** Each part is a box in a one-tile footprint. Rotation is applied by the renderer. */
export function buildingParts(shape: BuildingTile['shape'], simplified = false): readonly BuildingPart[] {
  switch (shape) {
    case 'floor':
      return [[0, 0.125, 0, 1, 0.25, 1]];
    // Rotation moves this wall around all four edges, meeting at the tile corners.
    case 'wall':
      return [[0, 0.5, -0.4, 1, 1, 0.2]];
    case 'stairs':
      return simplified ? STAIR_SOLID : STAIR_STEPS;
    case 'block':
      return [[0, 0.5, 0, 1, 1, 1]];
  }
}
