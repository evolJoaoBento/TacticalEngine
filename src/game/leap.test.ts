/**
 * Jumping: asked for by name and aimed, never walked into; the walk that comes first only when
 * the landing is past the jumper's range; and the roll - which lands them whatever it says.
 */

import { afterEach, describe, it, expect } from 'vitest';
import { hollowVaultMap } from './demo-map';
import { conditionModifiers } from '../engine/combat/attack';
import { hasLineOfSight } from '../engine/grid/los';
import type { Rng } from '../engine/core/rng';
import { jumpRulesSchema } from '../engine/rules/jump';
import { answerPending, attackWithSelected, buildDemoScene, buildProjectScene, moveSelectedTo, type DemoScene } from './demo-scene';
import { DEMO_MOVE_DIFFICULTY } from './demo-rules';
import { PIT_SCENE_ID } from './demo-scenes';
import { jumpArc, leapTargets, planJump, planRunningJump } from './leap';
import { JUMP_ID, jumpAim, jumpOffered, jumpReaches, jumpTo, previewWalk, startEncounter } from './movement';
import { travelTo } from './room';
import { setUserSetting } from './user-settings';

/** Dice that come up as told, and ones after. */
const dice = (...faces: number[]): Rng => {
  const rng: Rng = {
    next: () => 0,
    nextInt: () => 0,
    die: () => faces.shift() ?? 1,
    dice: (count: number) => Array.from({ length: count }, () => faces.shift() ?? 1),
    pick: <T,>(items: readonly T[]) => items[0]!,
    shuffle: <T,>(items: T[]) => items,
    fork: () => rng,
    save: () => 0,
    restore: () => {},
  };
  return rng;
};

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
    expect(grid.isPassable(grid.indexOf(4, 5))).toBe(true); // half a block of wall: stepped over
  });

  it('walks onto the dais by its steps, as it always could', () => {
    const demo = buildDemoScene(hollowVaultMap(), 'tiles');
    demo.party.select('kara');
    demo.state.moveEntity('kara', demo.grid.indexOf(15, 6));
    expect(demo.party.reachable('kara', { inCombat: false }).canReach(demo.grid.indexOf(18, 2))).toBe(true);
  });

  it('still has its wall after the party has been away: a room is stood up with the kinds of tile its project declares', () => {
    const demo = buildDemoScene(hollowVaultMap(), 'travel');
    const vault = demo.scene.id;
    expect(travelTo(demo, PIT_SCENE_ID)).toBe(true);
    expect(travelTo(demo, vault)).toBe(true);
    expect(demo.grid.standAt(demo.grid.indexOf(12, 3))).toBe(FLOOR + 2);
    expect(demo.party.reachable('kara', { inCombat: false }).canReach(demo.grid.indexOf(13, 3))).toBe(false);
    expect(demo.grid.standAt(demo.grid.indexOf(18, 2))).toBe(FLOOR + 1);
    expect(demo.grid.costAt(demo.grid.indexOf(8, 5))).toBe(2);
  });
});

describe('a click on the ground', () => {
  it('never jumps: on top of a block it walks up to the foot of it, and asks for nothing', () => {
    const { demo, id, top } = pillar(1);
    const result = moveSelectedTo(demo, top, demo.grid.spotOf(top));
    expect(result.pending).toBeUndefined();
    expect(demo.pending).toBeNull();
    expect(result.moved).toBe(true);
    const stood = demo.state.entity(id)!.tile;
    expect(stood).not.toBe(top);
    expect(demo.grid.standAt(stood)).toBeLessThan(FLOOR + 1);
    expect(demo.grid.chebyshevDistance(stood, top)).toBe(1);
    expect(demo.motions.some((motion) => motion.leap !== undefined)).toBe(false);
  });

  it('draws the walk it would make, and no jump at the end of it', () => {
    const { demo, top } = pillar(1);
    const preview = previewWalk(demo, top, demo.grid.spotOf(top))!;
    expect(preview.route.length).toBeGreaterThanOrEqual(2);
    expect(demo.grid.tileAtSpot(preview.route.at(-1)!.x, preview.route.at(-1)!.y)).not.toBe(top);
    expect(Object.keys(preview).sort()).toEqual(['beyond', 'route', 'run']);
  });

  it('steps off a block the same way: down is not walked either', () => {
    const { demo, id, top, beside } = pillar(1);
    demo.state.moveEntity(id, top);
    expect(moveSelectedTo(demo, beside)).toEqual({ moved: false, path: [] });
    expect(demo.state.entity(id)!.tile).toBe(top);
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

  it('crosses level ground with no roll at all, in one arc, from where they stood', () => {
    const { demo, at } = inTheOpen();
    const to = demo.grid.indexOf(8, 9);
    expect(planJump(demo, 'kara', to)).toMatchObject({ from: at, to, rise: 0, difficulty: null, fallDice: 0, lift: 1.4 });
    expect(jumpTo(demo, 'kara', to)).toMatchObject({ moved: true });
    expect(demo.pending).toBeNull();
    expect(demo.state.entity('kara')!.tile).toBe(to);
    const own = demo.motions.filter((motion) => motion.id === 'kara');
    expect(own).toHaveLength(1);
    expect(own[0]).toMatchObject({ leap: 1.4, path: [at, to] });
    // Nothing was rolled, so there is nothing to wait for.
    expect(own[0]!.wait).toBeUndefined();
    expect(own[0]!.route).toHaveLength(2);
    expect(demo.log.at(-1)!.text).toBe('Quim jumps 4 tiles.');
  });

  it('is rolled for across level ground when the project says so', () => {
    const { demo } = inTheOpen();
    demo.project.jump = jumpRulesSchema.parse({ flatRoll: true });
    expect(jumpTo(demo, 'kara', demo.grid.indexOf(8, 9))).toMatchObject({ pending: true });
  });

  it('goes up onto a block with the roll in front of it, and does nothing at all when the roll is called off', () => {
    const { demo, id, top } = pillar(1);
    const start = demo.state.entity(id)!.tile;
    expect(planJump(demo, id, top)).toMatchObject({ from: start, rise: 1, difficulty: DEMO_MOVE_DIFFICULTY, fallDice: 0 });
    expect(jumpTo(demo, id, top)).toMatchObject({ moved: false, pending: true });
    expect(demo.pending?.kind).toBe('script');
    answerPending(demo, { kind: 'cancel' });
    expect(demo.pending).toBeNull();
    expect(demo.state.entity(id)!.tile).toBe(start);
  });

  it('lands on a success, on their feet', () => {
    const { demo, id, top } = pillar(1);
    demo.rng = dice(12, 11);
    jumpTo(demo, id, top);
    answerPending(demo, { kind: 'roll' });
    expect(demo.state.entity(id)!.tile).toBe(top);
    expect(demo.state.entity(id)!.conditions.has('prone')).toBe(false);
    expect(demo.log.some((line) => line.text.includes('jumps up 1 block'))).toBe(true);
    // Rolled for by hand: the board draws it once the roll has been read, not before.
    expect(demo.motions.find((motion) => motion.id === id)).toMatchObject({ wait: true });
  });

  it('lands on a failure too, and lands Prone - which is Vulnerable until they next move', () => {
    const { demo, id, top, beside } = pillar(1);
    demo.rng = dice(1, 2);
    jumpTo(demo, id, top);
    answerPending(demo, { kind: 'roll' });
    const kara = demo.state.entity(id)!;
    expect(kara.tile).toBe(top);
    expect(kara.conditions.has('prone')).toBe(true);
    expect(conditionModifiers(kara).advantage).toBe(1);
    // Down again is a drop of one block: no roll, and getting up is the first of the move.
    expect(jumpTo(demo, id, beside).pending).toBeUndefined();
    expect(kara.tile).toBe(beside);
    expect(kara.conditions.has('prone')).toBe(false);
    expect(demo.log.some((line) => line.text.includes('gets up'))).toBe(true);
  });

  it('is three blocks for Quim and one for Scarlet, and past that the aim says no', () => {
    expect(planJump(pillar(3).demo, 'kara', pillar(3).top)).toMatchObject({ rise: 3 });
    const weak = pillar(2, 'mira');
    expect(planRunningJump(weak.demo, 'mira', weak.top)).toBeNull();
    expect(jumpArc(weak.demo, 'mira', weak.top)).toMatchObject({ ok: false, walk: [] });
    expect(jumpTo(weak.demo, 'mira', weak.top)).toEqual({ moved: false, path: [] });
    const low = pillar(1, 'mira');
    expect(planJump(low.demo, 'mira', low.top)).toMatchObject({ rise: 1 });
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
    // Half a block of wall is under the arc: the cover at (4, 11) does not stop a jump over it.
    demo.state.moveEntity('kara', demo.grid.indexOf(4, 10));
    expect(planJump(demo, 'kara', demo.grid.indexOf(4, 12))).not.toBeNull();
  });

  it('does not clear the vault wall in one jump, or a shut door at all - but the strong jump onto the wall, and down the far side', () => {
    const demo = buildDemoScene(hollowVaultMap(), 'wall');
    demo.party.select('kara');
    demo.state.moveEntity('kara', demo.grid.indexOf(11, 3));
    const onTheWall = demo.grid.indexOf(12, 3);
    const inside = demo.grid.indexOf(13, 3);
    // Two blocks of wall stand higher than a two-tile hop arcs, from here or from anywhere she can walk to.
    expect(planRunningJump(demo, 'kara', inside)).toBeNull();
    // Quim, Strength +2, makes two blocks: up onto it, with the roll.
    expect(planJump(demo, 'kara', onTheWall)).toMatchObject({ rise: 2, difficulty: DEMO_MOVE_DIFFICULTY });
    demo.rng = dice(12, 11);
    jumpTo(demo, 'kara', onTheWall);
    answerPending(demo, { kind: 'roll' });
    expect(demo.state.entity('kara')!.tile).toBe(onTheWall);
    // And down into the vault: two blocks is past a safe drop at Agility 0, so it is rolled for and it hurts.
    expect(planJump(demo, 'kara', inside)).toMatchObject({ rise: -2, difficulty: DEMO_MOVE_DIFFICULTY, fallDice: 1 });
    // Scarlet, Strength -1, makes one block, and the wall is not for her.
    demo.party.select('mira');
    demo.state.moveEntity('mira', demo.grid.indexOf(11, 5));
    expect(planRunningJump(demo, 'mira', demo.grid.indexOf(12, 5))).toBeNull();

    // The doorway is floor, and the door in it is shut: no arc goes through a shut door.
    const door = buildDemoScene(hollowVaultMap(), 'door');
    door.party.select('kara');
    door.state.moveEntity('kara', door.grid.indexOf(11, 7));
    expect(planRunningJump(door, 'kara', door.grid.indexOf(13, 7))).toBeNull();
  });

  it('wakes what a walk would have woken, when the landing is a trigger', () => {
    const demo = buildDemoScene(hollowVaultMap(), 'over');
    demo.party.select('kara');
    const armed = [...Array(demo.grid.size).keys()].filter((tile) => demo.triggers.at(tile) !== null);
    expect(armed.length).toBeGreaterThan(0);
    // Beside a trigger, inside the vault, on ground that is not one: a level hop onto it.
    const pair = armed
      .flatMap((trigger) => [trigger - 1, trigger + 1, trigger - 22, trigger + 22].map((beside) => ({ trigger, beside })))
      .find(({ trigger, beside }) => demo.triggers.at(beside) === null && demo.state.bodyFree(beside, 'kara') && demo.state.bodyFree(trigger, 'kara') && demo.grid.standAt(beside) === demo.grid.standAt(trigger))!;
    expect(pair).toBeDefined();
    demo.state.moveEntity('kara', pair.beside);
    jumpTo(demo, 'kara', pair.trigger);
    expect(demo.state.entity('kara')!.tile).toBe(pair.trigger);
    expect(demo.encounter !== null || demo.ambush !== null).toBe(true);
  });

  it('is the action in a fight, and is not offered where a project has no jumping or the turn is not theirs', () => {
    const { demo } = inTheOpen('turn');
    expect(jumpOffered(demo)).toBe(true);
    startEncounter(demo, demo.scene.encounters.find((e) => e.adversaries.length > 0)!.id);
    expect(jumpOffered(demo)).toBe(demo.encounter!.canAct('kara'));
    const acted = (): number => demo.encounter!.log.filter((event) => event.kind === 'acted' && event.id === 'kara').length;
    const before = acted();
    jumpTo(demo, 'kara', demo.grid.indexOf(7, 9));
    expect(demo.state.entity('kara')!.tile).toBe(demo.grid.indexOf(7, 9));
    expect(acted()).toBe(before + 1);

    const off = inTheOpen('off').demo;
    off.project.jump = jumpRulesSchema.parse({ enabled: false });
    expect(jumpOffered(off)).toBe(false);
    expect(jumpAim(off)).toBeNull();
    expect(leapTargets(off, 'kara')).toEqual([]);
  });
});

describe('a jump aimed past their range', () => {
  it('is walked towards first, to the nearest spot it can be made from - and only then', () => {
    const { demo, at } = inTheOpen();
    const near = demo.grid.indexOf(8, 9);
    const far = demo.grid.indexOf(11, 14); // nine tiles off: past the disc the button lights
    expect(planRunningJump(demo, 'kara', near)).toMatchObject({ from: at }); // in range: nothing walked
    expect(jumpArc(demo, 'kara', near)).toMatchObject({ ok: true, walk: [] });
    expect(leapTargets(demo, 'kara')).not.toContain(far);

    // Ten tiles east along the row: past her five, so she walks to where five reaches it.
    const beyond = demo.grid.indexOf(11, 9);
    expect(planJump(demo, 'kara', beyond)).toBeNull();
    const running = planRunningJump(demo, 'kara', beyond)!;
    expect(running.from).not.toBe(at);
    // From the first point along the run-up her five reaches it, to a tenth of a tile: not a tile's centre.
    expect(running.across).toBeLessThanOrEqual(5 + 1e-9);
    expect(running.across).toBeGreaterThan(4.85);
    expect(running.fromAt.x).toBeCloseTo(6, 6);
    expect(running.walk!.at(-1)).toEqual(running.fromAt);
    expect(jumpReaches(demo, 'kara', beyond)).toBe(true);
    const drawn = jumpArc(demo, 'kara', beyond)!;
    expect(drawn.ok).toBe(true);
    expect(drawn.walk.length).toBeGreaterThanOrEqual(2);
    expect(drawn.walk.at(-1)).toEqual(drawn.from);

    expect(jumpTo(demo, 'kara', beyond)).toMatchObject({ moved: true });
    expect(demo.state.entity('kara')!.tile).toBe(beyond);
    // One line for the board: the walk, and the jump at the end of it.
    const own = demo.motions.filter((motion) => motion.id === 'kara');
    expect(own).toHaveLength(1);
    expect(own[0]!.route!.length).toBeGreaterThanOrEqual(3);
    expect(own[0]!.leap).toBeGreaterThan(0);
  });

  it('walks only as far as the move goes in a fight, and says no past that', () => {
    const { demo } = inTheOpen('press');
    startEncounter(demo, demo.scene.encounters.find((e) => e.adversaries.length > 0)!.id);
    demo.party.select('kara');
    demo.state.moveEntity('kara', demo.grid.indexOf(0, 15));
    const reach = new Set(demo.party.reachable('kara', { inCombat: true }).clone().tiles());
    const within = planRunningJump(demo, 'kara', demo.grid.indexOf(8, 15));
    if (within !== null) expect(reach.has(within.from)).toBe(true);
    // The far side of the field is past any walk this move and any jump from the end of it.
    expect(planRunningJump(demo, 'kara', demo.grid.indexOf(11, 0))).toBeNull();
    expect(jumpArc(demo, 'kara', demo.grid.indexOf(11, 0))).toMatchObject({ ok: false });
  });
});

describe('a drop', () => {
  /** Quim on top of a pillar this high, about to jump off it. */
  function perched(blocks: number): { demo: DemoScene; id: string; down: number } {
    const { demo, id, top, beside } = pillar(blocks);
    demo.state.moveEntity(id, top);
    return { demo, id, down: beside };
  }

  it('of a block is only a drop: no roll, no damage', () => {
    const { demo, id, down } = perched(1);
    const marked = demo.state.entity(id)!.hitPoints.marked;
    expect(jumpTo(demo, id, down)).toMatchObject({ moved: true });
    expect(demo.pending).toBeNull();
    expect(demo.state.entity(id)!.tile).toBe(down);
    expect(demo.state.entity(id)!.hitPoints.marked).toBe(marked);
    expect(demo.log.some((line) => line.text.includes('drops 1 block'))).toBe(true);
  });

  it('past a safe one is rolled for, and hurts either way: all of it on a failure, and Prone', () => {
    const { demo, id, down } = perched(4);
    expect(planJump(demo, id, down)).toMatchObject({ rise: -4, difficulty: DEMO_MOVE_DIFFICULTY + 1, fallDice: 3 });
    const marked = demo.state.entity(id)!.hitPoints.marked;
    demo.rng = dice(1, 2, 6, 6, 6);
    jumpTo(demo, id, down);
    answerPending(demo, { kind: 'roll' });
    const kara = demo.state.entity(id)!;
    expect(kara.tile).toBe(down);
    expect(kara.conditions.has('prone')).toBe(true);
    expect(kara.hitPoints.marked).toBeGreaterThan(marked);
  });

  it('is halved by a success, and they keep their feet', () => {
    const hurt = (faces: number[]): { marked: number; prone: boolean } => {
      const { demo, id, down } = perched(4);
      const before = demo.state.entity(id)!.hitPoints.marked;
      demo.rng = dice(...faces);
      jumpTo(demo, id, down);
      answerPending(demo, { kind: 'roll' });
      const kara = demo.state.entity(id)!;
      return { marked: kara.hitPoints.marked - before, prone: kara.conditions.has('prone') };
    };
    const failed = hurt([1, 2, 6, 6, 6]);
    const made = hurt([12, 11, 6, 6, 6]);
    expect(made.prone).toBe(false);
    expect(made.marked).toBeLessThanOrEqual(failed.marked);
    expect(made.marked).toBeGreaterThan(0);
  });
});

describe('rolling jumps automatically', () => {
  it('throws the dice at once, with no prompt left standing, and lands them', () => {
    const { demo, id, top } = pillar(1);
    setUserSetting('autoRollJumps', true);
    demo.rng = dice(12, 11);
    expect(jumpTo(demo, id, top)).toMatchObject({ moved: true });
    expect(demo.pending).toBeNull();
    expect(demo.state.entity(id)!.tile).toBe(top);
    // Thrown for them: no card to accept, so the board draws it at once.
    expect(demo.motions.find((motion) => motion.id === id)!.wait).toBeUndefined();
    // The roll was made and shown, not skipped.
    expect(demo.log.some((line) => /Success|success/.test(line.text))).toBe(true);
    expect(demo.rolls.length).toBeGreaterThan(0);
  });

  it('lands a failure Prone just the same', () => {
    const { demo, id, top } = pillar(1);
    setUserSetting('autoRollJumps', true);
    demo.rng = dice(1, 2);
    jumpTo(demo, id, top);
    expect(demo.pending).toBeNull();
    expect(demo.state.entity(id)!.tile).toBe(top);
    expect(demo.state.entity(id)!.conditions.has('prone')).toBe(true);
  });

  it('is off until the player turns it on: the prompt stands', () => {
    const { demo, id, top } = pillar(1);
    expect(jumpTo(demo, id, top)).toMatchObject({ pending: true });
    expect(demo.pending).not.toBeNull();
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

  it('asks for the roll the project names, against the Difficulty it names', () => {
    const { demo, top } = pillar(1);
    demo.project.jump = jumpRulesSchema.parse({ rollTrait: 'finesse', difficulty: 17 });
    expect(planJump(demo, 'kara', top)).toMatchObject({ difficulty: 17 });
    jumpTo(demo, 'kara', top);
    expect(demo.pending).toMatchObject({ kind: 'script', prompt: { kind: 'check', trait: 'finesse', difficulty: 17 } });
  });

  it('lands a failure with the condition the project names, or with none', () => {
    const landed = (failCondition: string): string[] => {
      const { demo, id, top } = pillar(1);
      demo.project.jump = jumpRulesSchema.parse({ failCondition });
      demo.rng = dice(1, 2);
      jumpTo(demo, id, top);
      answerPending(demo, { kind: 'roll' });
      expect(demo.state.entity(id)!.tile).toBe(top);
      return [...demo.state.entity(id)!.conditions.keys()];
    };
    expect(landed('restrained')).toEqual(['restrained']);
    expect(landed('')).toEqual([]);
  });

  it('makes a fall hurt as the project says: another die, the whole of it, or not at all', () => {
    const fallen = (rules: Record<string, unknown>, faces: number[]): number => {
      const { demo, id, top, beside } = pillar(4);
      demo.state.moveEntity(id, top);
      demo.project.jump = jumpRulesSchema.parse(rules);
      const before = demo.state.entity(id)!.hitPoints.marked;
      demo.rng = dice(...faces);
      jumpTo(demo, id, beside);
      if (demo.pending !== null) answerPending(demo, { kind: 'roll' });
      expect(demo.state.entity(id)!.tile).toBe(beside);
      return demo.state.entity(id)!.hitPoints.marked - before;
    };
    expect(fallen({ fallDie: 0 }, [12, 11])).toBe(0);
    expect(fallen({ dropBase: 9 }, [])).toBe(0);
    expect(fallen({ fallDie: 12, halfOnSuccess: false }, [12, 11, 12, 12, 12])).toBeGreaterThan(0);
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

describe('Prone', () => {
  it('ends with the walk up to a swing as it does with any other: they get up to go', () => {
    const demo = buildDemoScene(hollowVaultMap(), 'up');
    demo.party.select('kara');
    demo.state.moveEntity('kara', demo.grid.indexOf(14, 12));
    demo.world.applyCondition('kara', 'prone', 'scene');
    const husk = demo.state.entitiesOf('adversary')[0]!;
    const start = demo.state.entity('kara')!.tile;
    attackWithSelected(demo, husk.id);
    expect(demo.state.entity('kara')!.tile).not.toBe(start);
    expect(demo.state.entity('kara')!.conditions.has('prone')).toBe(false);
    expect(demo.log.some((line) => line.text.includes('Quim gets up'))).toBe(true);
  });
});
