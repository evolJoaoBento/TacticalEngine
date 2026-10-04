/**
 * A jump is aimed at a spot, as a walk is: its range is from where the jumper stands to where
 * they were aimed, they land there rather than in the middle of the square, and a step to one
 * side is a walk like any other.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { hollowVaultMap } from './demo-map';
import { buildDemoScene, type DemoScene } from './demo-scene';
import { planJump, planRunningJump } from './leap';
import { setUserSetting } from './user-settings';

/** Quim alone in the open field at (4, 9): Strength +2, so a jump of five tiles. */
function inTheOpen(seed = 'spot'): DemoScene {
  const demo = buildDemoScene(hollowVaultMap(), seed);
  demo.party.select('kara');
  demo.state.moveEntity('kara', demo.grid.indexOf(4, 9));
  return demo;
}

afterEach(() => setUserSetting('autoRollJumps', false));

describe('a jump aimed at a spot', () => {

  it('is in range by where they stand and where they are aimed, to a fraction of a tile', () => {
    const demo = inTheOpen();
    const to = demo.grid.indexOf(9, 9);
    // Five tiles is her jump. The far side of that square is past it and the near side is not.
    expect(planJump(demo, 'kara', to)).not.toBeNull();
    expect(planJump(demo, 'kara', to, { x: 9.2, y: 9 })).toBeNull();
    expect(planJump(demo, 'kara', to, { x: 8.8, y: 9 })).not.toBeNull();
    // A step forward first, and the far side is hers too.
    demo.state.placeEntity('kara', 4.3, 9);
    expect(planJump(demo, 'kara', to, { x: 9.2, y: 9 })).not.toBeNull();
    // With no spot said, it is the middle of the square, as it always was.
    expect(planJump(demo, 'kara', to)!.at).toEqual({ x: 9, y: 9 });
  });

  it('comes down clear of whoever is standing by', () => {
    const demo = inTheOpen();
    demo.state.placeEntity('finn', 7.45, 9);
    const leap = planJump(demo, 'kara', demo.grid.indexOf(7, 9), { x: 7.3, y: 9 });
    // Violet's body is over that square: nobody lands in it.
    expect(leap).toBeNull();
    demo.state.placeEntity('finn', 8, 9);
    const beside = planJump(demo, 'kara', demo.grid.indexOf(7, 9), { x: 7.45, y: 9 })!;
    expect(Math.hypot(beside.at.x - 8, beside.at.y - 9)).toBeGreaterThanOrEqual(0.7 - 1e-9);
  });
});

describe('the run-up before a jump', () => {
  it('runs straight at the landing, not at whichever square is cheapest to reach', () => {
    const demo = inTheOpen('straight');
    // Off the axis, past her five: the run-up heads for the landing itself and stops on the way.
    const aim = { x: 9.7, y: 12.4 };
    const leap = planRunningJump(demo, 'kara', demo.grid.indexOf(10, 12), aim)!;
    const start = leap.walk![0]!;
    const went = { x: leap.fromAt.x - start.x, y: leap.fromAt.y - start.y };
    const there = { x: aim.x - start.x, y: aim.y - start.y };
    const cos = (went.x * there.x + went.y * there.y) / (Math.hypot(went.x, went.y) * Math.hypot(there.x, there.y));
    expect(cos).toBeGreaterThan(Math.cos((8 * Math.PI) / 180));
    expect(leap.across).toBeLessThanOrEqual(5 + 1e-9);
    expect(leap.across).toBeGreaterThan(4.85);
  });
});
