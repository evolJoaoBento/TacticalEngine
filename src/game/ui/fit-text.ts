/**
 * Words that fit their card, however many there are: the text of a box is set at the largest size,
 * down to a floor, at which all of it shows - no line cut off at the bottom, no word out past the side.
 *
 * New Game's cards are a fixed size and an ancestry's features or a domain card's rules can run long,
 * so the long ones are set small; the inspect view (`NewGame.tsx`) zooms a card up to read it. The
 * search is over sizes a quarter-pixel apart, halving the range each time, since each try is a layout.
 */

import { useLayoutEffect } from 'preact/hooks';

/** The quarter-pixel steps sizes go in. */
const STEP = 0.25;

/**
 * The largest size from `largest` down to `smallest`, in quarter pixels, at which `fits` says the text
 * fits; `smallest` when none does. `fits` is taken to be true for every size below one it is true for.
 */
export function largestFitting(fits: (size: number) => boolean, largest: number, smallest: number): number {
  if (fits(largest)) return largest;
  let best = smallest;
  let low = 0;
  let high = Math.floor((largest - smallest) / STEP) - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const size = smallest + middle * STEP;
    if (fits(size)) {
      best = size;
      low = middle + 1;
    } else high = middle - 1;
  }
  return best;
}

/** Set a box's text at the largest size at which all of it shows inside the box. */
export function fitText(box: HTMLElement, largest: number, smallest = 4): number {
  const fits = (size: number): boolean => {
    box.style.fontSize = `${size}px`;
    return box.scrollHeight <= box.clientHeight + 0.5 && box.scrollWidth <= box.clientWidth + 0.5;
  };
  const size = largestFitting(fits, largest, smallest);
  box.style.fontSize = `${size}px`;
  return size;
}

/**
 * Fit the text of the box `find` picks out of `ref`'s element, when it is drawn and whenever `key`
 * changes - and again once the page's fonts have loaded, since a font arriving changes every measure.
 */
export function useFitText(ref: { readonly current: HTMLElement | null }, find: (root: HTMLElement) => HTMLElement | null, largest: number, key: string): void {
  useLayoutEffect(() => {
    let live = true;
    const run = (): void => {
      const root = ref.current;
      const box = root === null ? null : find(root);
      if (live && box !== null && box.isConnected) fitText(box, largest);
    };
    run();
    void globalThis.document?.fonts?.ready.then(run);
    return () => {
      live = false;
    };
  }, [key]);
}
