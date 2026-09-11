/**
 * The maths behind the placement height ladder.
 *
 * The ladder draws one rung per quarter tile — the step the document actually
 * stores — around whatever level is being placed at. Rungs near that level are
 * large and rungs further out shrink away, so the level the author is aiming
 * for is also the easiest one to hit, while a long tail of context still fits
 * in a strip beside the board.
 *
 * The selector stays put and the ladder slides past it, so a drag moves the
 * rungs with the pointer: pull down and the levels above come down to meet the
 * selector, which raises the level. Whole tiles are detents — cheap to fall
 * into, dearer to climb out of — because a round number is what an author
 * usually wants and a quarter is the exception.
 *
 * Kept DOM-free and separately tested, like `placement-rotation.ts`.
 */

/** Quarter of a tile: the step every Z control moves in. */
export const Z_STEP = 0.25;

/** How many rungs are drawn each side of the current level. CSS clips the rest. */
export const LADDER_REACH = 22;

/** Row spacing of a rung, in pixels, at the current level and far from it. */
export const RUNG_HEIGHT = { near: 26, far: 2 } as const;

/** Bar width of a rung, in pixels, at the current level and far from it. */
export const RUNG_WIDTH = { near: 30, far: 3 } as const;

/** What a whole tile gets on top of its neighbours, so it reads as a landmark. */
export const WHOLE_TILE_BONUS = { height: 7, width: 8 } as const;

/**
 * How sharply a rung shrinks as it leaves the current level. Hyperbolic rather
 * than linear: the handful of rungs around the cursor stay large while the tail
 * compresses instead of running off the end of the strip.
 */
const FALLOFF = 0.35;

/** Arriving at a whole tile costs less than a quarter would — the drag falls in. */
const DETENT_ARRIVE = 0.5;

/** Leaving a whole tile costs more — the drag has to be meant. */
const DETENT_LEAVE = 1.7;

/** A rung's prominence, 1 at the current level and falling towards 0 away from it. */
export function rungFalloff(stepsFromCurrent: number): number {
  return 1 / (1 + FALLOFF * Math.abs(stepsFromCurrent));
}

/** Snap to the quarter-tile grid the document stores. */
export function roundToStep(level: number): number {
  return Math.round(level / Z_STEP) * Z_STEP;
}

/** Row spacing before a whole tile's bonus: the plain fisheye curve. */
function baseHeight(stepsFromCurrent: number): number {
  const weight = rungFalloff(stepsFromCurrent);
  return RUNG_HEIGHT.far + (RUNG_HEIGHT.near - RUNG_HEIGHT.far) * weight;
}

/** How a rung that many quarter-steps from the current level is drawn. */
export function rungSize(stepsFromCurrent: number, level: number): {
  height: number;
  width: number;
  opacity: number;
} {
  const weight = rungFalloff(stepsFromCurrent);
  const whole = Number.isInteger(level);
  return {
    height: baseHeight(stepsFromCurrent) + (whole ? WHOLE_TILE_BONUS.height : 0),
    width:
      RUNG_WIDTH.far
      + (RUNG_WIDTH.near - RUNG_WIDTH.far) * weight
      + (whole ? WHOLE_TILE_BONUS.width : 0),
    opacity: 0.35 + 0.65 * weight,
  };
}

/**
 * The pixels a drag spends stepping from one level to the next. The fisheye
 * curve sets the price and the detents bend it: arriving at a whole tile is
 * cheap, leaving one is dear, so the level reads as a round number over a wider
 * stretch of the drag than it does over any quarter beside it.
 *
 * A rung's drawn height is deliberately not its price — a whole tile is drawn
 * larger to be seen and clicked, which would otherwise make it harder to reach.
 */
function rungCost(stepsFromCurrent: number, fromLevel: number, toLevel: number): number {
  let cost = baseHeight(stepsFromCurrent);
  if (Number.isInteger(toLevel)) cost *= DETENT_ARRIVE;
  if (Number.isInteger(fromLevel)) cost *= DETENT_LEAVE;
  return cost;
}

/**
 * The level a drag lands on, given where it started and how far the pointer has
 * moved since. The ladder follows the pointer, so dragging down raises.
 *
 * The loop always terminates: every rung costs at least
 * `RUNG_HEIGHT.far * DETENT_ARRIVE`.
 */
export function levelFromDrag(startLevel: number, dyPixels: number): number {
  const direction = dyPixels < 0 ? -1 : 1;
  let remaining = Math.abs(dyPixels);
  let steps = 0;
  for (;;) {
    const from = roundToStep(startLevel + direction * steps * Z_STEP);
    const to = roundToStep(startLevel + direction * (steps + 1) * Z_STEP);
    const cost = rungCost(steps + 1, from, to);
    if (remaining < cost) break;
    remaining -= cost;
    steps += 1;
  }
  return roundToStep(startLevel + direction * steps * Z_STEP);
}

/**
 * Whether a rung shows its number. The closer it is, the finer the values that
 * earn one: every quarter tile beside the cursor, then halves, then only whole
 * tiles once the rungs are too tight to read a column of numbers against.
 */
export function rungLabelled(level: number, stepsFromCurrent: number): boolean {
  if (stepsFromCurrent === 0) return true;
  const { height } = rungSize(stepsFromCurrent, level);
  if (height >= 16) return true;
  if (height >= 10) return Number.isInteger(level * 2);
  return Number.isInteger(level);
}
