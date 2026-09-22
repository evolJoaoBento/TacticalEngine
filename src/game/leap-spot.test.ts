/**
 * A jump is aimed at a spot, as a walk is: its range is from where the jumper stands to where
 * they were aimed, they land there rather than in the middle of the square, and a step to one
 * side is a walk like any other.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { hollowVaultMap } from './demo-map';
import { buildDemoScene, moveSelectedTo, type DemoScene } from './demo-scene';
import { lineCost, lineLength } from '../engine/grid/walk';
import { DEMO_BAND_TILES } from './demo-rules';
import { jumpArc, planJump, planRunningJump } from './leap';
import { jumpTo, previewWalk, startEncounter } from './movement';
import { setUserSetting } from './user-settings';

/** Kara alone in the open field at (4, 9): Strength +2, so a jump of five tiles. */
function inTheOpen(seed = 'spot'): DemoScene {
  const demo = buildDemoScene(hollowVaultMap(), seed);
  demo.party.select('kara');
  demo.state.moveEntity('kara', demo.grid.indexOf(4, 9));
  return demo;
}

afterEach(() => setUserSetting('autoRollJumps', false));

describe('a jump aimed at a spot', () => {
  it('lands on the spot, not in the middle of the square it is in', () => {
    const demo = inTheOpen();
    setUserSetting('autoRollJumps', true);
    const to = demo.grid.indexOf(7, 9);
    const aim = { x: 7.3, y: 8.8 };
    const leap = planJump(demo, 'kara', to, aim)!;
    expect(leap.at).toEqual(aim);
    expect(leap.fromAt).toEqual({ x: 4, y: 9 });
    expect(leap.across).toBeCloseTo(Math.hypot(3.3, 0.2), 9);
    expect(jumpArc(demo, 'kara', to, aim)).toMatchObject({ to: aim, ok: true });
    expect(jumpTo(demo, 'kara', to, aim).moved).toBe(true);
    expect(demo.state.entity('kara')!.at).toEqual(aim);
    expect(demo.state.entity('kara')!.tile).toBe(to);
    // And the board flies her to where she is: the motion ends on the spot.
    expect(demo.motions.at(-1)!.route!.at(-1)).toEqual(aim);
  });

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
    // Finn's body is over that square: nobody lands in it.
    expect(leap).toBeNull();
    demo.state.placeEntity('finn', 8, 9);
    const beside = planJump(demo, 'kara', demo.grid.indexOf(7, 9), { x: 7.45, y: 9 })!;
    expect(Math.hypot(beside.at.x - 8, beside.at.y - 9)).toBeGreaterThanOrEqual(0.7 - 1e-9);
  });
});

describe('a step to one side', () => {
  it('is a walk within the tile, and the others stay where they are', () => {
    const demo = buildDemoScene(hollowVaultMap(), 'shuffle');
    demo.party.select('kara');
    const kara = demo.state.entity('kara')!;
    const tile = kara.tile;
    const others = demo.party.members().filter((id) => id !== 'kara').map((id) => ({ id, at: { ...demo.state.entity(id)!.at } }));
    const aim = { x: kara.at.x + 0.2, y: kara.at.y - 0.15 };
    expect(previewWalk(demo, tile, aim)!.route).toEqual([{ ...kara.at }, aim]);
    const before = demo.motions.length;
    expect(moveSelectedTo(demo, tile, aim)).toMatchObject({ moved: true, path: [tile] });
    expect(demo.state.entity('kara')!.at).toEqual(aim);
    expect(demo.motions.length).toBe(before + 1);
    for (const other of others) expect(demo.state.entity(other.id)!.at).toEqual(other.at);
    // A click on the very spot she stands on is not a step.
    expect(moveSelectedTo(demo, tile, { x: aim.x + 0.01, y: aim.y }).moved).toBe(false);
  });

  it('is free in a fight, as any move inside the circle is', () => {
    const demo = buildDemoScene(hollowVaultMap(), 'shuffle-fight');
    demo.party.select('kara');
    startEncounter(demo, demo.scene.encounters[0]!.id);
    const kara = demo.state.entity('kara')!;
    const aim = { x: kara.at.x + 0.25, y: kara.at.y };
    const acted = (): number => demo.encounter!.log.filter((event) => event.kind === 'acted' && event.id === 'kara').length;
    expect(acted()).toBe(0);
    const from = kara.at.x;
    expect(moveSelectedTo(demo, kara.tile, aim).moved).toBe(true);
    // Towards the spot, and as near it as her body goes with the others standing where they are in a fight.
    expect(demo.state.entity('kara')!.at.x).toBeGreaterThan(from + 0.05);
    expect(demo.state.entity('kara')!.at.x).toBeLessThanOrEqual(aim.x);
    expect(demo.state.entity('kara')!.tile).toBe(kara.tile);
    expect(acted()).toBe(0);
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

  it('ends where the jump comes into range along the line, and in a fight is cut where the movement runs out', () => {
    const demo = inTheOpen('run-up');
    // Six tiles east: past her five, so she runs first - and stops the moment five reaches it.
    const beyond = demo.grid.indexOf(10, 9);
    const aim = { x: 10.3, y: 9.2 };
    const open = planRunningJump(demo, 'kara', beyond, aim)!;
    expect(open.walk!.length).toBeGreaterThanOrEqual(2);
    expect(open.at).toEqual(aim);
    expect(open.across).toBeLessThanOrEqual(5 + 1e-9);
    expect(open.across).toBeGreaterThan(4.85);
    expect(Number.isInteger(open.fromAt.x) && Number.isInteger(open.fromAt.y)).toBe(false);
    // The run-up is as long as it takes to bring the landing within five, to a tenth of a tile, and no longer.
    expect(lineLength(open.walk!)).toBeGreaterThanOrEqual(Math.hypot(6.3, 0.2) - 5 - 1e-9);
    expect(lineLength(open.walk!)).toBeLessThan(Math.hypot(6.3, 0.2) - 5 + 0.11);

    // In a fight the run-up is one move long at most: four tiles of line, then the jump or nothing.
    startEncounter(demo, demo.scene.encounters.find((e) => e.adversaries.length > 0)!.id);
    demo.party.select('kara');
    const pressed = planRunningJump(demo, 'kara', beyond, aim)!;
    expect(lineCost(demo.grid, pressed.walk!)).toBeLessThanOrEqual(DEMO_BAND_TILES.close + 1e-9);
    // Four of walk and five of jump is nine at the most, and the far corner of the field is further.
    expect(planRunningJump(demo, 'kara', demo.grid.indexOf(11, 1), { x: 11.4, y: 0.6 })).toBeNull();
    expect(jumpTo(demo, 'kara', beyond, aim).moved).toBe(true);
    expect(demo.state.entity('kara')!.at).toEqual(aim);
  });
});
