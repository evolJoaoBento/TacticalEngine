/**
 * Jumping: asked for by name and aimed, never walked into; the walk that comes first only when
 * the landing is past the jumper's range; and the roll - which lands them whatever it says.
 */

import { afterEach, describe, it, expect } from 'vitest';
import { hollowVaultMap } from './demo-map';
import { hasLineOfSight } from '../engine/grid/los';
import { jumpRulesSchema } from '../engine/rules/jump';
import { buildDemoScene, buildProjectScene, type DemoScene } from './demo-scene';
import { jumpArc, leapTargets, planJump, planRunningJump } from './leap';
import { startEncounter } from '../../tests/fixtures/fight';
import { JUMP_ID, jumpAim, previewWalk } from './movement';
import { setUserSetting } from './user-settings';

/** The floor's top everywhere in the relaid vault: what a pillar is raised from. */
const FLOOR = 0.25;

/**
 * The demo with a pillar raised out in the open field, this many blocks above the floor, and
 * somebody stood two tiles west of it, on level floor. Quim is Strength +2 and Agility 0; Scarlet is Strength -1.
 */
function pillar(blocks: number, who = 'kara'): { demo: DemoScene; id: string; top: number; beside: number } {
  const demo = buildDemoScene(hollowVaultMap(), 'leap');
  const top = demo.grid.indexOf(6, 6);
  demo.grid.lift[top] = FLOOR + blocks;
  demo.party.select(who);
  demo.state.moveEntity(who, demo.grid.indexOf(4, 6));
  return { demo, id: who, top, beside: demo.grid.indexOf(5, 6) };
}

/** Quim out in the open field, with the party cleared away from her. Strength +2: five tiles, three blocks. */
function inTheOpen(seed = 'aim'): { demo: DemoScene; at: number } {
  const demo = buildDemoScene(hollowVaultMap(), seed);
  demo.party.select('kara');
  const at = demo.grid.indexOf(4, 9);
  demo.state.moveEntity('kara', at);
  return { demo, at };
}

afterEach(() => setUserSetting('autoRollJumps', false));

describe('the demo, relaid as tiles', () => {
  it('is pieces on flat ground: a floor under every cell, blocks for the wall, a dais of blocks with its steps', () => {
    const demo = buildDemoScene(hollowVaultMap(), 'tiles');
    const { grid, scene } = demo;
    expect(scene.heights.every((h) => h === 0)).toBe(true);
    expect(scene.terrain.every((t) => t === 'floor')).toBe(true);
    for (let tile = 0; tile < grid.size; tile++) expect(grid.standAt(tile)).toBeGreaterThanOrEqual(FLOOR);
    // The wall is two blocks of height and nothing else: somewhere to stand, for whoever can get up there.
    expect(grid.isPassable(grid.indexOf(12, 3))).toBe(true);
    expect(grid.standAt(grid.indexOf(12, 3))).toBe(FLOOR + 2);
    expect(hasLineOfSight(grid, grid.indexOf(10, 3), grid.indexOf(14, 3))).toBe(false);
    expect(demo.party.reachable('kara', { inCombat: false }).canReach(grid.indexOf(12, 3))).toBe(false);
    expect(grid.isPassable(grid.indexOf(12, 7))).toBe(true); // the doorway
    expect(grid.standAt(grid.indexOf(18, 2))).toBe(FLOOR + 1);
    expect(grid.topAt(grid.indexOf(16, 5)).id).toBe('steps');
    expect(grid.costAt(grid.indexOf(8, 5))).toBe(2); // the road
    expect(grid.providesCover(grid.indexOf(4, 5))).toBe(true);
    // The legacy map's cover is a whole block of stone wall now, drawn along its tile's edge: it bars the tile.
    expect(grid.isPassable(grid.indexOf(4, 5))).toBe(false);
  });

  it('walks onto the dais by its steps, as it always could', () => {
    const demo = buildDemoScene(hollowVaultMap(), 'tiles');
    demo.party.select('kara');
    demo.state.moveEntity('kara', demo.grid.indexOf(15, 6));
    expect(demo.party.reachable('kara', { inCombat: false }).canReach(demo.grid.indexOf(18, 2))).toBe(true);
  });
});

describe('a click on the ground', () => {

  it('draws the walk it would make, and no jump at the end of it', () => {
    const { demo, top } = pillar(1);
    const preview = previewWalk(demo, top, demo.grid.spotOf(top))!;
    expect(preview.route.length).toBeGreaterThanOrEqual(2);
    expect(demo.grid.tileAtSpot(preview.route.at(-1)!.x, preview.route.at(-1)!.y)).not.toBe(top);
    expect(Object.keys(preview).sort()).toEqual(['beyond', 'route', 'run']);
  });
});

describe('the Jump button: aimed from where they stand', () => {
  it('lights everywhere in range, level ground included, and nowhere a body could not be put down', () => {
    const { demo, at } = inTheOpen();
    const lit = leapTargets(demo, 'kara');
    expect(lit).toContain(demo.grid.indexOf(9, 9)); // five tiles east, flat
    expect(lit).not.toContain(demo.grid.indexOf(10, 9)); // six
    expect(lit).toContain(demo.grid.indexOf(7, 12)); // diagonal, inside five as the crow flies
    expect(lit).not.toContain(demo.grid.indexOf(8, 13)); // and outside it
    expect(lit).not.toContain(at);
    for (const tile of lit) expect(demo.state.bodyFree(tile, 'kara')).toBe(true);
    expect(jumpAim(demo)).toMatchObject({ characterId: 'kara', abilityId: JUMP_ID, name: 'Jump', tiles: lit });
    // Scarlet is Strength -1: three tiles.
    demo.party.select('mira');
    demo.state.moveEntity('mira', demo.grid.indexOf(4, 3));
    expect(leapTargets(demo, 'mira')).toContain(demo.grid.indexOf(7, 3));
    expect(leapTargets(demo, 'mira')).not.toContain(demo.grid.indexOf(8, 3));
  });

  it('goes over people and low walls, and not through what stands higher than the arc', () => {
    const { demo } = inTheOpen();
    const beyond = demo.grid.indexOf(6, 9);
    // Violet in the way: a jump goes over him.
    demo.state.moveEntity('finn', demo.grid.indexOf(5, 9));
    expect(planJump(demo, 'kara', beyond)).not.toBeNull();
    // A pillar two blocks high in the way of a two-tile hop, which arcs three quarters of a block.
    demo.state.moveEntity('finn', demo.grid.indexOf(0, 0));
    demo.grid.lift[demo.grid.indexOf(5, 9)] = FLOOR + 2;
    expect(planJump(demo, 'kara', beyond)).toBeNull();
    // Half a block is under the arc: a low wall on open ground does not stop a jump over it.
    demo.grid.lift[demo.grid.indexOf(5, 9)] = FLOOR + 0.5;
    expect(planJump(demo, 'kara', beyond)).not.toBeNull();
    // A whole block of stone wall is not: the cover at (4, 11) stands higher than the arc.
    demo.state.moveEntity('kara', demo.grid.indexOf(4, 10));
    expect(planJump(demo, 'kara', demo.grid.indexOf(4, 12))).toBeNull();
  });
});

describe('the jump, by the rules a project writes down', () => {
  it('is carried by whatever trait the project says, as far as it says', () => {
    // Scarlet: Strength -1, so a block and no more - until jumping is a matter of her best trait.
    const { demo, top } = pillar(3, 'mira');
    expect(planJump(demo, 'mira', top)).toBeNull();
    const best = Object.entries(demo.characters.get('mira')!.traits).sort((a, b) => b[1] - a[1])[0]!;
    demo.project.jump = jumpRulesSchema.parse({ reachTrait: best[0], reachBase: 3 - best[1], reachPerPoint: 1 });
    expect(planJump(demo, 'mira', top)).toMatchObject({ rise: 3 });
  });

  it('carries further when the project says a jump does, and jumps nothing when jumping is off', () => {
    const { demo } = inTheOpen();
    demo.project.jump = jumpRulesSchema.parse({ rangeBase: 1, rangePerPoint: 0.5 });
    // Quim, Strength +2: two tiles now.
    expect(planJump(demo, 'kara', demo.grid.indexOf(6, 9))).not.toBeNull();
    expect(planJump(demo, 'kara', demo.grid.indexOf(7, 9))).toBeNull();
    demo.project.jump = jumpRulesSchema.parse({ enabled: false });
    expect(planRunningJump(demo, 'kara', demo.grid.indexOf(6, 9))).toBeNull();

    const roomy = buildDemoScene(hollowVaultMap(), 'stride');
    roomy.project.jump = jumpRulesSchema.parse({ stepHeight: 1 });
    // Stood up again with the rule in the document, the way a saved project is.
    const replay = buildProjectScene(roomy.project, 'stride');
    replay.party.select('kara');
    replay.state.moveEntity('kara', replay.grid.indexOf(15, 0));
    // The dais is a block up from the floor: a step now, with no steps needed.
    expect(replay.party.reachable('kara', { inCombat: true, budget: 1.5 }).canReach(replay.grid.indexOf(16, 0))).toBe(true);
  });
});

describe('the arc the Jump button draws', () => {
  it('is from where they stand when the spot is in range, and walked towards first when it is past it', () => {
    const { demo, at } = inTheOpen();
    const near = demo.grid.indexOf(8, 9);
    expect(planRunningJump(demo, 'kara', near)).toMatchObject({ from: at });
    expect(jumpArc(demo, 'kara', near)).toMatchObject({ ok: true, walk: [] });
    // Ten tiles east along the row: past her five, so the arc starts where the run-up ends.
    const beyond = demo.grid.indexOf(11, 9);
    const drawn = jumpArc(demo, 'kara', beyond)!;
    expect(drawn.ok).toBe(true);
    expect(drawn.walk.length).toBeGreaterThanOrEqual(2);
    expect(drawn.walk.at(-1)).toEqual(drawn.from);
    // Nowhere, or the tile they stand on: nothing to draw.
    expect(jumpArc(demo, 'kara', at)).toBeNull();
    expect(jumpArc(demo, 'kara', -1)).toBeNull();
  });

  it('says no past what a fight\'s move and a jump from the end of it reach', () => {
    const { demo } = inTheOpen('press');
    startEncounter(demo, demo.scene.encounters.find((e) => e.adversaries.length > 0)!.id);
    demo.party.select('kara');
    demo.state.moveEntity('kara', demo.grid.indexOf(0, 15));
    expect(jumpArc(demo, 'kara', demo.grid.indexOf(11, 0))).toMatchObject({ ok: false });
  });

  it('says no to a climb too high for them, without a walk', () => {
    const weak = pillar(3, 'mira');
    expect(jumpArc(weak.demo, 'mira', weak.top)).toMatchObject({ ok: false, walk: [] });
  });
});
