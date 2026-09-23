/**
 * The border round a set of tiles, as line segments.
 *
 * An edge is drawn only where a tile's neighbour is not in the set, so a patch of lit ground reads
 * as one area with an outline rather than as a pile of squares each with its own box. Written
 * straight into the caller's buffer from `from`, and it stops rather than overruns when the buffer
 * is full: the number it hands back is how many edges the buffer actually holds now.
 *
 * Lifted out of `SceneView`, which is at its readability ceiling. It is arithmetic over a grid and
 * a buffer, with no scene in it, so it belongs outside and can be read on its own.
 */

import type { BufferAttribute, BufferGeometry, Color } from 'three';
import type { TileGrid } from '../grid/grid';
import { standHeight, tileCenter, type TileLayout } from './layout';

/** How far above the ground the border floats, so it is not buried in the surface it borders. */
const ABOVE = 0.03;

export function outlineTiles(
  grid: TileGrid,
  layout: TileLayout,
  held: ReadonlySet<number>,
  color: Color,
  geometry: BufferGeometry,
  from: number,
): number {
    const positions = geometry.getAttribute('position') as BufferAttribute;
    const colors = geometry.getAttribute('color') as BufferAttribute;
    const half = layout.tileSize / 2;
    let edges = from;
    for (const tile of held) {
      const centre = tileCenter(grid, tile, layout);
      const top = standHeight(grid, tile, layout);
      const x = grid.xOf(tile);
      const y = grid.yOf(tile);
      const sides: [number, number, [number, number], [number, number]][] = [
        [x, y - 1, [-half, -half], [half, -half]],
        [x + 1, y, [half, -half], [half, half]],
        [x, y + 1, [half, half], [-half, half]],
        [x - 1, y, [-half, half], [-half, -half]],
      ];
      for (const [nx, ny, a, b] of sides) {
        if (grid.inBounds(nx, ny) && held.has(grid.indexOf(nx, ny))) continue;
        if (edges * 2 + 1 >= positions.count) return edges;
        const v = edges * 2;
        positions.setXYZ(v, centre.x + a[0], top + ABOVE, centre.z + a[1]);
        positions.setXYZ(v + 1, centre.x + b[0], top + ABOVE, centre.z + b[1]);
        colors.setXYZ(v, color.r, color.g, color.b);
        colors.setXYZ(v + 1, color.r, color.g, color.b);
        edges++;
      }
    }
    return edges;
  }
