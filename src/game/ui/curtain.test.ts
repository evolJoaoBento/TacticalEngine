import { describe, it, expect } from 'vitest';
import { curtainLine, curtainStep, GIVE_UP_MS, SETTLE_FRAMES, type CurtainState } from './curtain';

/**
 * When the curtain may lift. The page half of it only reads four numbers and acts on the answer,
 * so the answer is what is tested: not before the files are here, not on the frame they land, and
 * not never.
 */
const reading = (over: Partial<Parameters<typeof curtainStep>[1]> = {}) => ({ loading: 0, frames: 10, fonts: true, elapsed: 1000, ...over });

describe('the curtain', () => {
  it('stays down while a model is still on its way', () => {
    const step = curtainStep({ settledAt: null }, reading({ loading: 2 }));
    expect(step.lift).toBe(false);
    expect(step.state.settledAt).toBeNull();
  });

  it('stays down until the letters are here, however ready the board is', () => {
    expect(curtainStep({ settledAt: 3 }, reading({ fonts: false, frames: 500 })).lift).toBe(false);
  });

  it('waits a few frames after the last file, for the board to be redrawn with it', () => {
    let state: CurtainState = { settledAt: null };
    const lifted: number[] = [];
    for (let frames = 20; frames <= 20 + SETTLE_FRAMES + 1; frames++) {
      const step = curtainStep(state, reading({ frames }));
      state = step.state;
      if (step.lift) lifted.push(frames);
    }
    expect(lifted[0]).toBe(20 + SETTLE_FRAMES);
  });

  it('starts the wait again when another file sets off while the last ones settle', () => {
    const settling: CurtainState = { settledAt: 20 };
    const again = curtainStep(settling, reading({ loading: 1, frames: 22 }));
    expect(again.state.settledAt).toBeNull();
    const back = curtainStep(again.state, reading({ frames: 30 }));
    expect(back.lift).toBe(false);
    expect(back.state.settledAt).toBe(30);
  });

  it('gives up on a fetch that never answers rather than hiding the game for ever', () => {
    expect(curtainStep({ settledAt: null }, reading({ loading: 1, elapsed: GIVE_UP_MS })).lift).toBe(true);
  });

  it('says how far along it is, and says nothing about a count before there is one', () => {
    expect(curtainLine({ loading: 0, settled: 0 })).toBe('Laying the table');
    expect(curtainLine({ loading: 4, settled: 3 })).toBe('Laying the table · 3 of 7');
  });
});
