/**
 * The walk line, cut into range bands and coloured a band at a time.
 *
 * A line drawn in one colour says where a character would go and nothing about how far that is.
 * The rules already have the answer — Melee, Very Close, Close, Far — so the line is painted in
 * those steps, and the colour changes exactly where the band does. Reading the line then tells a
 * player the same thing a ruler would, without a ruler.
 *
 * Distance is measured along the line walked rather than as the crow flies, because that is what
 * movement is spent on (`party.planWalk`): a path round a corner is longer than the gap it closes,
 * and the colour has to break where the movement actually runs out, not where the destination sits.
 *
 * No scene and no canvas: this turns a route into points and colours, and the caller writes them
 * into whatever buffer it keeps, which is what makes it testable without a renderer. It does reach
 * for three's `Color`, and only for that - three manages colour, and a band has to be converted
 * the way three would convert it or it draws as the wrong colour.
 */

import { Color } from 'three';
import type { Spot } from '../grid/grid';
import { DEFAULT_BAND_TILES, RANGE_BANDS, type BandTiles, type RangeBand } from '../rules/range';

/** A point of the drawn line: where it is, and the colour it is drawn in there. */
export interface PathPoint {
  spot: Spot;
  r: number;
  g: number;
  b: number;
}

/** How finely the line is cut, in tiles. Fine enough to follow ground that rises and turns. */
const PIECE = 0.5;

/**
 * The colour each band is drawn in: a step of hue a band, not a shade of one colour.
 *
 * The first pass ran cool to warm through neighbouring hues and the steps were invisible on the
 * board - Very Close and Close were both blue, and a line four tiles long looked like one colour
 * with a tint at the end. A step has to be a step.
 *
 * Deliberately not a smooth ramp. The request was a colour per distance, and a ramp hides the very
 * thing the steps exist to show: with one you can see which band a point is in, with the other you
 * can only see that it is further away than the last point, which the line already said.
 */
export const BAND_COLOURS: Readonly<Record<RangeBand, string>> = {
  melee: '#7cf0a8',
  veryClose: '#3fcfff',
  close: '#8b7cff',
  far: '#e879f9',
  veryFar: '#f5f3ff',
  outOfRange: '#ff6a5c',
};

/** Where the colour changes, in tiles walked: the far edge of every band but the last. */
export function bandEdges(table: BandTiles = DEFAULT_BAND_TILES): number[] {
  return RANGE_BANDS.filter((band) => band !== 'outOfRange').map((band) => table[band]);
}

/** The band a distance along the line falls in. Past Very Far there is no band left to be in. */
export function bandAt(tiles: number, table: BandTiles = DEFAULT_BAND_TILES): RangeBand {
  for (const band of RANGE_BANDS) {
    if (band === 'outOfRange') break;
    if (tiles <= table[band] + 1e-9) return band;
  }
  return 'outOfRange';
}

/**
 * A colour as three numbers in 0..1, which is how a vertex buffer wants it.
 *
 * Through three's own `Color` rather than by reading the hex apart, because three manages colour:
 * it takes a hex as sRGB and keeps it linear, and a buffer filled with the sRGB numbers instead
 * would draw every band washed out. What goes in the buffer has to be what the renderer expects.
 */
export function rgbOf(hex: string): { r: number; g: number; b: number } {
  const colour = new Color(hex);
  return { r: colour.r, g: colour.g, b: colour.b };
}

const RGB = new Map<string, { r: number; g: number; b: number }>();
function cached(hex: string): { r: number; g: number; b: number } {
  let rgb = RGB.get(hex);
  if (rgb === undefined) {
    rgb = rgbOf(hex);
    RGB.set(hex, rgb);
  }
  return rgb;
}

/**
 * Cut a line into drawable points, colouring each by how far along the walk it is.
 *
 * `from` is the distance already walked when this line begins, so a second line — the part past
 * what one move covers — carries on counting from where the first stopped rather than starting the
 * bands again. `colour`, when given, overrides the bands entirely: the ground past a character's
 * reach is amber or red because of what it means, not because of how far away it is.
 */
export function bandedLine(
  line: readonly Spot[],
  options: { from?: number; colour?: string; skipFirst?: boolean; table?: BandTiles } = {},
): { points: PathPoint[]; walked: number } {
  const table = options.table ?? DEFAULT_BAND_TILES;
  const points: PathPoint[] = [];
  let walked = options.from ?? 0;
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i]!;
    const b = line[i + 1]!;
    const leg = Math.hypot(b.x - a.x, b.y - a.y);
    const pieces = Math.max(1, Math.ceil(leg / PIECE));
    for (let k = i === 0 && options.skipFirst !== true ? 0 : 1; k <= pieces; k++) {
      const t = k / pieces;
      const at = walked + leg * t;
      const rgb = cached(options.colour ?? BAND_COLOURS[bandAt(at, table)]);
      points.push({ spot: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, ...rgb });
    }
    walked += leg;
  }
  return { points, walked };
}
