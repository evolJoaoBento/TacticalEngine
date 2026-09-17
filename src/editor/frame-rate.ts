/**
 * Frames per second, from the times the frames happened.
 *
 * Apart from the component that draws it because that component cannot be tested: the
 * editor's UI runs in a browser and `vitest.config.ts` runs in node, so anything with a
 * decision in it lives here where a test can reach it, and what is left up there is a
 * `requestAnimationFrame` loop with no arithmetic in it.
 *
 * Counted over a window rather than from the gap between the last two frames. One frame's
 * gap is the number a reader cannot use: it swings between 8 and 30 milliseconds while
 * nothing on screen changes, and a readout that never settles is one nobody trusts. A
 * second's worth of frames divided by how long that second actually took is steady enough
 * to read and still moves the moment the board gets heavier.
 */

/** How long a reading covers. Long enough to be steady, short enough to answer a click. */
export const FRAME_WINDOW_MS = 500;

/**
 * The rate the timestamps in `window` imply, or null when there are not enough of them.
 *
 * Takes the whole window and measures the span it covers, rather than assuming the samples
 * are `FRAME_WINDOW_MS` apart - a tab that was in the background, or a first reading taken
 * before the window filled, would otherwise report a rate that never happened.
 *
 * Null rather than 0 for "not yet", because 0 is a real answer meaning the page has
 * stopped drawing, and a readout that says 0 while it is still measuring is a bug report
 * waiting to be filed.
 */
export function frameRate(times: readonly number[]): number | null {
  if (times.length < 2) return null;
  const span = times[times.length - 1]! - times[0]!;
  if (span <= 0) return null;
  // One fewer interval than there are stamps: five marks make four gaps.
  return ((times.length - 1) * 1000) / span;
}

/**
 * Add a frame's timestamp, dropping the ones that have aged out of the window.
 *
 * Returns a new array rather than splicing in place, so a caller holding the previous one
 * for a render is not rewritten under it - the same reason every edit in this project
 * builds its own state rather than mutating what somebody else may be reading.
 */
export function sample(times: readonly number[], now: number, window = FRAME_WINDOW_MS): number[] {
  const kept = times.filter((t) => now - t <= window);
  kept.push(now);
  return kept;
}

/** How a rate is written: whole frames, because a tenth of a frame tells a reader nothing. */
export function formatRate(rate: number | null): string {
  return rate === null ? '—' : String(Math.round(rate));
}
