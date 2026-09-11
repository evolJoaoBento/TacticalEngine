/** Sparse construction cells. Empty space never allocates a tile. */
import { z } from 'zod';

// Integer coordinates stay precise in documents; rendering uses chunk-local vertices.
export const BUILD_LIMIT = 1_000_000;
export const BUILD_SHAPES = ['block', 'floor', 'wall', 'stairs'] as const;
export const BUILD_MATERIALS = { stone: '#8a8994', wood: '#966844', grass: '#618950' } as const;
const coordinate = z.number().int().min(-BUILD_LIMIT).max(BUILD_LIMIT);
export const buildingTileSchema = z.object({
  x: coordinate,
  y: coordinate,
  /** Vertical Z, retained as `level` for compatibility with earlier projects. */
  level: z.number().min(-BUILD_LIMIT).max(BUILD_LIMIT).multipleOf(0.25),
  height: z.number().min(0.25).max(16).multipleOf(0.25).optional(),
  shape: z.enum(BUILD_SHAPES),
  material: z.enum(['stone', 'wood', 'grass']),
  rotation: z.number().int().min(0).max(3),
});
export type BuildingTile = z.infer<typeof buildingTileSchema>;
export function buildingKey(p: Pick<BuildingTile, 'x' | 'y' | 'level'>): string {
  return `${p.x},${p.y},${p.level}`;
}
export const buildingTilesSchema = z.record(z.string(), buildingTileSchema).superRefine((tiles, ctx) => {
  for (const [key, tile] of Object.entries(tiles)) {
    const [cell, instance, ...extra] = key.split('#');
    if (cell !== buildingKey(tile) || extra.length > 0 || (instance !== undefined && !/^[1-9][0-9]*$/.test(instance))) {
      ctx.addIssue({ code: 'custom', path: [key], message: 'Tile key must match its coordinates and optional instance number' });
    }
  }
});

/** Each part is a box in a one-tile footprint. Rotation is applied by the renderer. */
export function buildingParts(shape: BuildingTile['shape'], simplified = false): readonly number[][] {
  switch (shape) {
    case 'floor': return [[0, 0.125, 0, 1, 0.25, 1]];
    // Rotation moves this wall around all four edges, meeting at the tile corners.
    case 'wall': return [[0, 0.5, -0.4, 1, 1, 0.2]];
    case 'stairs': return simplified ? [[0, 0.5, 0, 1, 1, 1]] : [
      [0, 0.125, -0.375, 1, 0.25, 0.25], [0, 0.25, -0.125, 1, 0.5, 0.25],
      [0, 0.375, 0.125, 1, 0.75, 0.25], [0, 0.5, 0.375, 1, 1, 0.25],
    ];
    case 'block': return [[0, 0.5, 0, 1, 1, 1]];
  }
}
