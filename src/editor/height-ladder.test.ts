import { describe, expect, it } from 'vitest';
import {
  RUNG_HEIGHT,
  Z_STEP,
  levelFromDrag,
  roundToStep,
  rungFalloff,
  rungLabelled,
  rungSize,
} from './height-ladder';

describe('rung falloff', () => {
  it('is strongest at the current level and never reaches zero', () => {
    expect(rungFalloff(0)).toBe(1);
    expect(rungFalloff(40)).toBeGreaterThan(0);
  });

  it('falls away with distance, whichever side of the current level', () => {
    expect(rungFalloff(1)).toBeLessThan(rungFalloff(0));
    expect(rungFalloff(8)).toBeLessThan(rungFalloff(1));
    expect(rungFalloff(-6)).toBeCloseTo(rungFalloff(6));
  });
});

describe('rung size', () => {
  it('draws the current level at full size', () => {
    expect(rungSize(0, 1.25).height).toBeCloseTo(RUNG_HEIGHT.near);
  });

  it('shrinks in both height and width as it leaves the current level', () => {
    const near = rungSize(1, 1.25);
    const far = rungSize(16, 5.25);
    expect(far.height).toBeLessThan(near.height);
    expect(far.width).toBeLessThan(near.width);
    expect(far.opacity).toBeLessThan(near.opacity);
  });

  it('never collapses below the floor that keeps a far rung visible', () => {
    expect(rungSize(500, 0.25).height).toBeGreaterThanOrEqual(RUNG_HEIGHT.far);
  });

  it('draws a whole tile as a landmark, larger than the quarters beside it', () => {
    expect(rungSize(4, 2).height).toBeGreaterThan(rungSize(4, 2.25).height);
    expect(rungSize(4, 2).width).toBeGreaterThan(rungSize(4, 2.25).width);
  });
});

describe('drag to a level', () => {
  it('stays put until the pointer moves', () => {
    expect(levelFromDrag(1.5, 0)).toBe(1.5);
  });

  it('moves the ladder with the pointer, so pulling down raises the level', () => {
    expect(levelFromDrag(1.5, 80)).toBeGreaterThan(1.5);
    expect(levelFromDrag(1.5, -80)).toBeLessThan(1.5);
  });

  it('always lands on the quarter-tile grid the document stores', () => {
    for (const dy of [-7, -31, -118, 5, 63, 260]) {
      expect(Number.isInteger(levelFromDrag(0.25, dy) / Z_STEP)).toBe(true);
    }
  });

  it('covers more ground the further the drag runs — the point of the fisheye', () => {
    // Six rungs' worth of travel buys more than six quarter tiles, because every
    // rung past the first is shorter than the one before it. Stated against the
    // curve rather than pixel counts, so tuning the rung sizes cannot quietly
    // turn this into a test of nothing.
    const rung = rungSize(1, 0.5).height;
    const one = levelFromDrag(0.25, rung) - 0.25;
    const six = levelFromDrag(0.25, rung * 6) - 0.25;
    expect(six).toBeGreaterThan(one * 6);
  });

  it('holds on to a whole tile: one pull leaves a quarter but not an integer', () => {
    const pull = rungSize(1, 0.5).height + 1;
    expect(levelFromDrag(0.25, pull)).toBe(0.5);
    expect(levelFromDrag(1, pull)).toBe(1);
  });

  it('lingers on whole tiles, so an integer is the easiest level to stop on', () => {
    const pixelsReading = (target: number): number => {
      let pixels = 0;
      for (let dy = 0; dy <= 300; dy += 1) {
        if (levelFromDrag(0.25, dy) === target) pixels += 1;
      }
      return pixels;
    };
    expect(pixelsReading(1)).toBeGreaterThan(pixelsReading(0.75));
    expect(pixelsReading(1)).toBeGreaterThan(pixelsReading(1.25));
  });
});

describe('rung labels', () => {
  it('always numbers the current level', () => {
    expect(rungLabelled(3.75, 0)).toBe(true);
  });

  it('numbers every quarter close in, then halves, then whole tiles only', () => {
    expect(rungLabelled(1.25, 1)).toBe(true);
    expect(rungLabelled(1.75, 3)).toBe(false);
    expect(rungLabelled(1.5, 2)).toBe(true);
    expect(rungLabelled(2, 4)).toBe(true);
    expect(rungLabelled(2.5, 10)).toBe(false);
    expect(rungLabelled(3, 8)).toBe(true);
  });
});

describe('snapping', () => {
  it('rounds to the quarter tile', () => {
    expect(roundToStep(1.13)).toBe(1.25);
    expect(roundToStep(-0.4)).toBe(-0.5);
    expect(roundToStep(2)).toBe(2);
  });
});
