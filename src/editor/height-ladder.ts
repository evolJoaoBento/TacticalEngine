/**
 * The maths behind the placement height ladder.
 *
 * The ladder draws one rung per quarter tile — the step the document actually
 * stores — around whatever level is being placed at. Rungs near that level are
 * large and rungs further out shrink away, so the level the author is aiming
 * for is also the easiest one to hit, while a long tail of context still fits
 * in a strip beside the board. The same curve drives the drag, so a small
 * movement near the cursor moves one quarter tile and the same movement far
 * out covers several.
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

/**
 * How sharply a rung shrinks as it leaves the current level. Hyperbolic rather
 * than linear: the handful of rungs around the cursor stay large while the tail
 * compresses instead of running off the end of the strip.
 */
const FALLOFF = 0.35;

/** A rung's prominence, 1 at the current level and falling towards 0 away from it. */
export function rungFalloff(stepsFromCurrent: number): number {
  return 1 / (1 + FALLOFF * Math.abs(stepsFromCurrent));
}

/** Snap to the quarter-tile grid the document stores. */
export function roundToStep(level: number): number {
  return Math.round(level / Z_STEP) * Z_STEP;
}

/** How a rung that many quarter-steps from the current level is drawn. */
export function rungSize(stepsFromCurrent: number): {
  height: number;
  width: number;
  opacity: number;
} {
  const weight = rungFalloff(stepsFromCurrent);
  return {
    height: RUNG_HEIGHT.far + (RUNG_HEIGHT.near - RUNG_HEIGHT.far) * weight,
    width: RUNG_WIDTH.far + (RUNG_WIDTH.near - RUNG_WIDTH.far) * weight,
    opacity: 0.35 + 0.65 * weight,
  };
}

/**
 * The level a drag lands on, given where it started and how far the pointer has
 * moved since. Pixels are spent against the same shrinking rungs the ladder
 * draws, so the first quarter tile costs a full rung and later ones cost less
 * and less. Dragging up raises, matching the ladder's own order.
 *
 * The loop always terminates: every rung costs at least `RUNG_HEIGHT.far`.
 */
export function levelFromDrag(startLevel: number, dyPixels: number): number {
  const direction = dyPixels < 0 ? 1 : -1;
  let remaining = Math.abs(dyPixels);
  let steps = 0;
  while (remaining >= rungSize(steps + 1).height) {
    remaining -= rungSize(steps + 1).height;
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
  const { height } = rungSize(stepsFromCurrent);
  if (height >= 16) return true;
  if (height >= 10) return Number.isInteger(level * 2);
  return Number.isInteger(level);
}
