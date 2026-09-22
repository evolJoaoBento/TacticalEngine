/**
 * The curtain over the table while it is being laid.
 *
 * Play starts the moment the page does, and models are fetched the first time something draws them
 * -- so the first seconds used to show the room assembling itself: magenta stand-ins, then bodies
 * popping in one by one, sheets appearing without their photographs. The curtain is a plain cover
 * in `index.html`, there from the first paint and before any of this module has even been fetched,
 * and all this does is decide when to take it away.
 *
 * Once, at the start. A husk that first appears two rooms in loads lazily as well, and dropping a
 * curtain in the middle of a fight to hide one body arriving would be far worse than the body
 * arriving.
 */

/** What is known each time the curtain asks whether it may go. */
export interface CurtainReading {
  /** Model files still on their way. */
  loading: number;
  /** Frames the board has drawn so far. */
  frames: number;
  /** Whether the letters have arrived. */
  fonts: boolean;
  /** Milliseconds since the page started. */
  elapsed: number;
}

/** The frame count at which everything was first seen to be here, or null while it is not. */
export type CurtainState = { settledAt: number | null };

/**
 * A file arriving is not the same as it being on screen: the view rebuilds what it drew with the
 * stand-in, and the first frame with a new body in it uploads its textures. A few frames after the
 * last file is what it takes for the board under the curtain to be the finished one.
 */
export const SETTLE_FRAMES = 4;
/** A fetch that never answers must not leave somebody looking at a curtain for ever. */
export const GIVE_UP_MS = 45_000;

/**
 * Whether the curtain may lift, and what to remember for next time.
 *
 * Pure, so it can be tested without a page: the part that touches the document is below and does
 * nothing but read these four numbers and act on the answer.
 */
export function curtainStep(state: CurtainState, now: CurtainReading): { state: CurtainState; lift: boolean } {
  if (now.elapsed >= GIVE_UP_MS) return { state, lift: true };
  // Another file set off while the last ones were settling: start the count again.
  if (now.loading > 0 || !now.fonts) return { state: { settledAt: null }, lift: false };
  if (state.settledAt === null) return { state: { settledAt: now.frames }, lift: false };
  return { state, lift: now.frames - state.settledAt >= SETTLE_FRAMES };
}

/** "Laying the table · 3 of 7", or without the count before anything has been asked for. */
export function curtainLine(progress: { loading: number; settled: number }): string {
  const total = progress.loading + progress.settled;
  return total === 0 ? 'Laying the table' : `Laying the table · ${progress.settled} of ${total}`;
}

/**
 * Watch the loading and take the curtain away when the board is ready to be looked at.
 *
 * Does nothing where there is no curtain: a test page, or a browser being driven by a script, where
 * `index.html` takes it out before it is ever painted (see there for why).
 */
export function liftCurtainWhenReady(
  assets: { progress(): { loading: number; settled: number } },
  frames: () => number,
): void {
  const curtain = document.getElementById('curtain');
  if (curtain === null || getComputedStyle(curtain).display === 'none') return;
  const line = curtain.querySelector<HTMLElement>('[data-curtain-line]');
  const bar = curtain.querySelector<HTMLElement>('[data-curtain-bar]');
  const started = performance.now();
  let fonts = false;
  // `fonts.ready` settles at once if nothing has asked for a face yet, so it is read a beat after
  // the play overlay has drawn and its stylesheets have named the faces they want.
  setTimeout(() => void document.fonts.ready.then(() => { fonts = true; }), 250);

  let state: CurtainState = { settledAt: null };
  const look = (): void => {
    const progress = assets.progress();
    if (line !== null) line.textContent = curtainLine(progress);
    const total = progress.loading + progress.settled;
    if (bar !== null) bar.style.transform = `scaleX(${total === 0 ? 0 : progress.settled / total})`;
    const step = curtainStep(state, { loading: progress.loading, frames: frames(), fonts, elapsed: performance.now() - started });
    state = step.state;
    if (!step.lift) { requestAnimationFrame(look); return; }
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (still) { curtain.remove(); return; }
    curtain.classList.add('is-lifting');
    // Not `transitionend` alone: a tab in the background never fires it, and the curtain would
    // stay, invisible and swallowing every click.
    setTimeout(() => curtain.remove(), 700);
  };
  requestAnimationFrame(look);
}
