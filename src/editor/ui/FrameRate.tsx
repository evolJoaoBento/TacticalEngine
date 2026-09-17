/**
 * The frame rate, under the top bar.
 *
 * Counts its own `requestAnimationFrame` ticks rather than asking the engine. Both loops
 * are driven by the same vsync, so a tick here is a frame drawn there - and the alternative
 * was `window.__engine.frames`, a handle whose own comment says nothing in the engine reads
 * it. A readout in the editor is not a test, so it does not get to be the first.
 *
 * Nothing in here decides anything: the arithmetic is in `editor/frame-rate.ts`, where a
 * node test can reach it, because vitest runs this project in node and a component cannot
 * be rendered there.
 */

import { useEffect, useState } from 'preact/hooks';
import { formatRate, frameRate, sample } from '../frame-rate';

export function FrameRate(): preact.JSX.Element {
  const [rate, setRate] = useState<number | null>(null);

  useEffect(() => {
    let times: number[] = [];
    let handle = 0;
    // What is on screen, so the state is only written when the reading a person can see
    // actually changes. Every frame is still counted - the count has to be exact or the
    // rate is a lie - but a `setRate` per frame is a re-render per frame, sixty times a
    // second and for as long as the editor is open, to paint the same two characters.
    let shown = '';
    const tick = (now: number): void => {
      times = sample(times, now);
      const next = frameRate(times);
      const text = formatRate(next);
      if (text !== shown) {
        shown = text;
        setRate(next);
      }
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, []);

  return (
    <div class="ph-fps" data-testid="frame-rate" aria-label="Frames per second">
      <b>{formatRate(rate)}</b> fps
    </div>
  );
}
