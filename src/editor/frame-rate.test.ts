import { describe, it, expect } from 'vitest';
import { FRAME_WINDOW_MS, formatRate, frameRate, sample } from './frame-rate';

describe('reading a frame rate off the frames', () => {
  it('measures the span the samples cover, not the window they were asked for', () => {
    // Eleven stamps 1/60s apart: ten gaps, so sixty a second however long the window is.
    const times = Array.from({ length: 11 }, (_, i) => 1000 + (i * 1000) / 60);
    expect(frameRate(times)).toBeCloseTo(60, 6);
  });

  it('reads a slow board as a small number rather than a stale one', () => {
    // Four frames a second is what a heavy build looks like, and is the whole reason this
    // readout exists - it has to be able to say so.
    const times = [0, 250, 500, 750, 1000];
    expect(frameRate(times)).toBeCloseTo(4, 6);
  });

  it('says nothing until it has two frames to compare', () => {
    // Null, not 0: zero is a real answer meaning the page stopped drawing.
    expect(frameRate([])).toBeNull();
    expect(frameRate([12])).toBeNull();
    expect(formatRate(frameRate([12]))).toBe('—');
  });

  it('refuses a window with no time in it rather than dividing by zero', () => {
    expect(frameRate([5, 5, 5])).toBeNull();
  });

  it('drops the samples that have aged out, and keeps the ones that have not', () => {
    const times = [0, 100, 200, 300];
    // At 600ms only the first has aged past the 500ms window. 100 sits exactly on its edge
    // and stays, which the test below pins on purpose - this one said it went, and the two
    // could not both be right.
    expect(sample(times, 600, FRAME_WINDOW_MS)).toEqual([100, 200, 300, 600]);
  });

  it('keeps a sample exactly on the edge of the window', () => {
    // `<=`, so a frame at exactly the window's age is still inside it. Off by one here
    // shortens every reading by a frame, which is invisible and wrong.
    expect(sample([100], 600, 500)).toEqual([100, 600]);
    expect(sample([99], 600, 500)).toEqual([600]);
  });

  it('does not rewrite the array it was handed', () => {
    // The caller is holding this one for a render.
    const times = [0, 100];
    const next = sample(times, 150);
    expect(times).toEqual([0, 100]);
    expect(next).toEqual([0, 100, 150]);
  });

  it('writes whole frames, because a tenth of one tells a reader nothing', () => {
    expect(formatRate(59.6)).toBe('60');
    expect(formatRate(4.2)).toBe('4');
    expect(formatRate(0)).toBe('0');
  });
});
