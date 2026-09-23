/**
 * How much ground a prop covers.
 *
 * Most props stand on one tile. A boulder, a great tree, a statue or a fallen pillar wants more,
 * and the honest way to give it more is not a bigger model file but the same model drawn at the
 * size of the block it covers - so one crate covers a tile, and the same crate at 3 covers nine.
 *
 * The block is square and anchored at its **north-west** tile: a prop at (4, 4) with a span of 3
 * covers (4,4) to (6,6), and its middle falls at (5, 5). Anchoring there rather than centring on
 * the click is what lets an even span exist at all - a 2x2 has no middle tile to be centred on -
 * and it means the tile you clicked is always inside what you placed. Do not "fix" it to centred.
 *
 * Square, too, and that is load-bearing: a prop carries a rotation, and rotating a square block
 * leaves the same tiles covered, so the footprint never has to turn with the model. A span of
 * 2x3 would break that and is deliberately not offered.
 *
 * Nothing here reads the grid or the renderer, so a footprint means the same thing to the editor,
 * to the drawing of it, and to a test.
 */

import type { Deco } from './schema';

/** The largest block a prop may cover. Six was asked for; a few more cost nothing to allow. */
export const DECO_SPAN_MAX = 16;

/** A point on the board, in whole tiles. */
export interface SpanPoint {
  x: number;
  y: number;
}

/** How many tiles across a prop is drawn. Absent means one, which is what almost every prop is. */
export function spanOf(deco: Pick<Deco, 'span'>): number {
  const span = deco.span ?? 1;
  return Number.isFinite(span) ? Math.min(DECO_SPAN_MAX, Math.max(1, Math.floor(span))) : 1;
}

/** Whether a prop covers a tile: its anchor, and everything south and east of it within the span. */
export function decoCovers(deco: Pick<Deco, 'span' | 'position'>, point: SpanPoint): boolean {
  const span = spanOf(deco);
  const { x, y } = deco.position;
  return point.x >= x && point.x < x + span && point.y >= y && point.y < y + span;
}

/**
 * The middle of the block a prop covers, in tiles, which is where the model is drawn.
 *
 * Fractional for an even span - a 2x2 is centred on the corner where its four tiles meet - so
 * this is a place in the room rather than a tile in it, and a caller wanting a tile should use
 * the anchor in `position`.
 */
export function decoCentre(deco: Pick<Deco, 'span' | 'position'>): { x: number; y: number } {
  const off = (spanOf(deco) - 1) / 2;
  return { x: deco.position.x + off, y: deco.position.y + off };
}

/** Every tile a prop covers, north-west first, for anything that has to walk the block. */
export function decoFootprint(deco: Pick<Deco, 'span' | 'position'>): SpanPoint[] {
  const span = spanOf(deco);
  const tiles: SpanPoint[] = [];
  for (let y = 0; y < span; y++) {
    for (let x = 0; x < span; x++) tiles.push({ x: deco.position.x + x, y: deco.position.y + y });
  }
  return tiles;
}
