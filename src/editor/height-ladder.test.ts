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
    expect(rungSize(0).height).toBeCloseTo(RUNG_HEIGHT.near);
  });

  it('shrinks in both height and width as it leaves the current level', () => {
    const near = rungSize(1);
    const far = rungSize(16);
    expect(far.height).toBeLessThan(near.height);
    expect(far.width).toBeLessThan(near.width);
    expect(far.opacity).toBeLessThan(near.opacity);
  });

  it('never collapses below the floor that keeps a far rung visible', () => {
    expect(rungSize(500).height).toBeGreaterThanOrEqual(RUNG_HEIGHT.far);
  });
});

describe('drag to a level', () => {
  it('stays put until the pointer moves', () => {
    expect(levelFromDrag(1.5, 0)).toBe(1.5);
  });

  it('raises when dragged up and lowers when dragged down', () => {
    expect(levelFromDrag(1, -RUNG_HEIGHT.near)).toBeGreaterThan(1);
    expect(levelFromDrag(1, RUNG_HEIGHT.near)).toBeLessThan(1);
  });

  it('spends a whole rung on the first quarter tile', () => {
    expect(levelFromDrag(0, -rungSize(1).height)).toBe(Z_STEP);
  });

  it('covers more ground the further the drag runs — the point of the fisheye', () => {
    // Four rungs' worth of travel buys more than four quarter tiles, because
    // every rung past the first is shorter than the one before it. Stated
    // against the curve rather than pixel counts, so tuning the rung sizes
    // cannot quietly turn this into a test of nothing.
    const rung = rungSize(1).height;
    expect(levelFromDrag(0, -rung * 4)).toBeGreaterThan(levelFromDrag(0, -rung) * 4);
  });

  it('always lands on the quarter-tile grid the document stores', () => {
    for (const dy of [-7, -31, -118, 5, 63, 260]) {
      expect(Number.isInteger(levelFromDrag(0.25, dy) / Z_STEP)).toBe(true);
    }
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
