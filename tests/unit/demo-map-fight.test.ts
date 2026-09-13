/**
 * End to end, on real content: legacy document -> SceneDoc -> TileGrid ->
 * SceneState -> move -> attack -> damage -> marked Hit Points -> a creature falls.
 *
 * Everything here is driven from one seed and nothing calls `Math.random`, so the
 * whole fight replays identically — which is the property a save file, a replay
 * and a regression test all depend on.
 *
 * The map is the prototype's own demo vault, and both fighters are fixtures: Kara is
 * written out below, and the thing she swings at comes from `tests/fixtures`. Neither
 * is content the app ships, which is the point -- a test about the engine should not
 * depend on a catalogue for the creature in front of it. The fixture's numbers are the
 * ones these assertions need: 8/15 thresholds, so a d10+3 lands major often enough to
 * finish 8 Hit Points inside forty rounds, and 1d12+2 at +3, so Kara is marked through
 * Evasion 11 and a 5/11 coat.
 */

import { describe, it, expect } from 'vitest';
import { demoMap } from '../../legacy/js/data.js';
import { createRng, type Rng } from '../../src/engine/core/rng';
import { FIXTURE_ADVERSARIES, FIXTURE_DIGGER } from '../fixtures/adversaries';
import { Pathfinder, tracePath } from '../../src/engine/grid/pathfinding';
import { applyAttack, resolveAttack, type AttackProfile } from '../../src/engine/combat/attack';
import { parseDice } from '../../src/engine/rules/dice';
import { pcThresholds } from '../../src/engine/rules/damage';
import { gridFromScene, tileOf } from '../../src/engine/scene/grid-from-scene';
import { importLegacyScene } from '../../src/engine/scene/legacy-import';
import {
  createPartyEntity,
  sceneStateFromScene,
  type SceneState,
} from '../../src/engine/scene/state';

const digger = FIXTURE_ADVERSARIES.find((def) => def.id === FIXTURE_DIGGER)!;

/** A tight band table so the demo vault spans more than one band. */
const bandTiles = { melee: 1, veryClose: 2, close: 4, far: 8, veryFar: 12 };

/** Kara from the legacy party, restated in the engine's terms: level 1, a padded coat. */
const kara = {
  evasion: 11,
  level: 1,
  armor: { major: 5, severe: 11 },
  armorScore: 3,
  hitPoints: 6,
  stress: 6,
  proficiency: 1,
  weapon: {
    kind: 'pc',
    name: 'Greatblade',
    modifier: parseDice('+2')!,
    range: 'melee',
    damage: parseDice('d10+3 phy')!,
    proficiency: 1,
  } satisfies AttackProfile,
};

function buildFight(seed: string): {
  rng: Rng;
  state: SceneState;
  pathfinder: Pathfinder;
  diggerId: string;
} {
  const scene = importLegacyScene(demoMap()).scene!;
  const { grid, issues: gridIssues } = gridFromScene(scene);
  expect(gridIssues).toEqual([]);

  // The demo map's own enemies are the prototype's Hollow Husks, which no content
  // pack defines. Standing a shipped stat block in their place is what makes this a
  // fight the engine runs rather than a legacy one -- and it is the same move any
  // pack would need, which is why the premise survives the catalogue going.
  const { state, issues } = sceneStateFromScene(scene, grid, {
    adversaries: new Map(
      FIXTURE_ADVERSARIES.map((def) => [
        def.id,
        { id: def.id, hitPoints: def.hitPoints, stress: def.stress },
      ]),
    ),
    party: [createPartyEntity('kara', 'sentinel', -1)],
  });
  // Every placement asks for hollow-husk, which the pack does not define.
  expect(issues.every((i) => i.message.includes('hollow-husk'))).toBe(true);

  // Open the vault door, then put the digger just inside it.
  const door = scene.interactables.find((i) => i.kind === 'door')!;
  state.setInteractableBlocking(tileOf(grid, door.position), false);

  // Just inside the door, on open floor — (door.x + 2) is the legacy pillar's
  // tile, which sceneStateFromScene registers as blocking.
  const diggerTile = grid.indexOf(door.position.x + 1, door.position.y);
  expect(state.blockedFor('nobody')(diggerTile)).toBe(false);
  expect(grid.isPassable(diggerTile)).toBe(true);
  const diggerId = 'digger-1';
  state.addEntity({
    id: diggerId,
    faction: 'adversary',
    definition: digger.id,
    tile: diggerTile,
    at: grid.spotOf(diggerTile),
    hitPoints: { max: digger.hitPoints, marked: 0 },
    stress: { max: digger.stress, marked: 0 },
    armorSlots: { max: 0, marked: 0 },
    conditions: new Set(),
    conditionDurations: new Map(),
    alive: true,
  });

  const karaEntity = state.entity('kara')!;
  karaEntity.hitPoints = { max: kara.hitPoints, marked: 0 };
  karaEntity.stress = { max: kara.stress, marked: 0 };
  karaEntity.armorSlots = { max: kara.armorScore, marked: 0 };

  return { rng: createRng(seed), state, pathfinder: new Pathfinder(grid), diggerId };
}

const diggerDefence = () => ({
  difficulty: digger.difficulty,
  thresholds: digger.thresholds,
});

const karaDefence = () => ({
  difficulty: kara.evasion,
  thresholds: pcThresholds(kara.level, kara.armor),
});

const diggerAttack: AttackProfile = {
  kind: 'adversary',
  name: digger.attackName,
  modifier: digger.attackModifier,
  range: digger.attackRange,
  damage: digger.attackDamage,
};

describe('the fixture stat block is the one being fought', () => {
  it('reads the block the fixtures hand it', () => {
    expect(digger).toMatchObject({
      name: 'Digger',
      tier: 1,
      role: 'solo',
      difficulty: 14,
      hitPoints: 8,
      stress: 3,
      attackName: 'Claws',
      attackRange: 'veryClose',
      thresholds: { major: 8, severe: 15 },
    });
    expect(digger.attackModifier).toEqual({ count: 0, sides: 0, modifier: 3 });
    expect(digger.attackDamage).toEqual({
      count: 1,
      sides: 12,
      modifier: 2,
      types: ['physical'],
    });
  });
});

describe('a full melee exchange on the demo map', () => {
  it('walks Kara into Melee range and fights until the digger falls', () => {
    const { rng, state, pathfinder, diggerId } = buildFight('the-vault');
    const grid = state.grid;
    const kara2 = state.entity('kara')!;
    const target = state.entity(diggerId)!;

    // --- move ------------------------------------------------------------
    const field = pathfinder.reachable(kara2.tile, Infinity, {
      isBlocked: state.blockedFor('kara'),
    });
    const approach = pathfinder.nearestReachableAdjacentTo(field, target.tile);
    expect(approach).toBeGreaterThanOrEqual(0);

    const path = tracePath(field, approach)!;
    expect(path[0]).toBe(kara2.tile);
    for (let i = 1; i < path.length; i++) {
      expect(grid.manhattanDistance(path[i - 1]!, path[i]!)).toBe(1);
      state.moveEntity('kara', path[i]!);
    }
    expect(kara2.tile).toBe(approach);
    expect(grid.manhattanDistance(kara2.tile, target.tile)).toBe(1);

    // --- fight -----------------------------------------------------------
    const log: string[] = [];
    let rounds = 0;
    while (target.alive && kara2.alive && rounds < 40) {
      rounds++;

      const swing = resolveAttack(rng, {
        grid,
        attacker: kara2,
        target,
        profile: kara.weapon,
        defender: diggerDefence(),
        options: { bandTiles },
      });
      expect(swing.refused).toBeNull();
      expect(swing.dualityRoll).toBeDefined();
      const hit = applyAttack(state, swing);
      log.push(
        `kara ${swing.dualityRoll!.outcome} total ${swing.dualityRoll!.total} vs ${digger.difficulty}` +
          (swing.hit ? ` -> ${swing.damageRoll!.total} damage, ${hit.hitPointsMarked} HP` : ' -> miss'),
      );
      if (!target.alive) break;

      // The GM answers with the digger's standard attack.
      const claw = resolveAttack(rng, {
        grid,
        attacker: target,
        target: kara2,
        profile: diggerAttack,
        defender: karaDefence(),
        options: { bandTiles, armorSlotsMarked: 0 },
      });
      expect(claw.refused).toBeNull();
      expect(claw.gmRoll).toBeDefined();
      const bite = applyAttack(state, claw);
      log.push(
        `digger d20 ${claw.gmRoll!.die}+${claw.gmRoll!.modifier} vs ${kara.evasion}` +
          (claw.hit ? ` -> ${claw.damageRoll!.total} damage, ${bite.hitPointsMarked} HP` : ' -> miss'),
      );
    }

    // --- what actually happened -------------------------------------------
    expect(rounds).toBeLessThan(40);
    expect(target.alive).toBe(false);
    expect(target.hitPoints.marked).toBe(target.hitPoints.max);
    expect(log.length).toBeGreaterThan(1);
    // A fallen adversary stops holding its tile.
    expect(state.isOccupied(target.tile)).toBe(false);

    // Both sides took the fight seriously: Kara was hit at least once, and the
    // Light/Shadow economy moved.
    expect(kara2.hitPoints.marked).toBeGreaterThan(0);
    expect(kara2.hope!.value + state.fear.value).toBeGreaterThan(2);
  });

  it('replays identically from the same seed, and differently from another', () => {
    const run = (seed: string): string => {
      const { rng, state, diggerId } = buildFight(seed);
      const grid = state.grid;
      const kara2 = state.entity('kara')!;
      const target = state.entity(diggerId)!;
      state.moveEntity('kara', grid.indexOf(grid.xOf(target.tile) - 1, grid.yOf(target.tile)));

      const trace: string[] = [];
      for (let i = 0; i < 12 && target.alive; i++) {
        const swing = resolveAttack(rng, {
          grid,
          attacker: kara2,
          target,
          profile: kara.weapon,
          defender: diggerDefence(),
          options: { bandTiles },
        });
        applyAttack(state, swing);
        trace.push(`${swing.dualityRoll!.hope}/${swing.dualityRoll!.fear}:${swing.hitPointsMarked}`);
      }
      return trace.join(' ');
    };

    expect(run('same-seed')).toBe(run('same-seed'));
    expect(run('same-seed')).not.toBe(run('other-seed'));
  });

  it('refuses the digger a shot at Kara from across the vault', () => {
    const { rng, state, diggerId } = buildFight('range');
    const target = state.entity(diggerId)!;
    const kara2 = state.entity('kara')!;
    // Kara starts at the spawn, on the far side of the wall from the digger.
    const outcome = resolveAttack(rng, {
      grid: state.grid,
      attacker: target,
      target: kara2,
      profile: diggerAttack,
      defender: karaDefence(),
      options: { bandTiles },
    });
    expect(outcome.refused).not.toBeNull();
    expect(outcome.gmRoll).toBeUndefined();
  });
});

describe('the fight obeys the rules it is built on', () => {
  it('never marks more Hit Points than a hit is worth, over many seeded fights', () => {
    for (let seed = 0; seed < 40; seed++) {
      const { rng, state, diggerId } = buildFight(`fight-${seed}`);
      const grid = state.grid;
      const kara2 = state.entity('kara')!;
      const target = state.entity(diggerId)!;
      state.moveEntity('kara', grid.indexOf(grid.xOf(target.tile) - 1, grid.yOf(target.tile)));

      for (let i = 0; i < 20 && target.alive; i++) {
        const swing = resolveAttack(rng, {
          grid,
          attacker: kara2,
          target,
          profile: kara.weapon,
          defender: diggerDefence(),
          options: { bandTiles },
        });
        if (swing.hit) {
          const damage = swing.damageRoll!.total;
          const expected =
            damage >= digger.thresholds.severe ? 3 : damage >= digger.thresholds.major ? 2 : 1;
          expect(swing.hitPointsMarked).toBe(expected);
          // A critical success always adds the maximum of the damage dice.
          if (swing.critical) {
            expect(swing.damageRoll!.criticalBonus).toBe(
              swing.damageRoll!.expression.count * swing.damageRoll!.expression.sides,
            );
          }
        } else {
          expect(swing.damageRoll).toBeUndefined();
        }
        applyAttack(state, swing);
      }
      expect(target.hitPoints.marked).toBeLessThanOrEqual(target.hitPoints.max);
    }
  });

  it('gives the party exactly one of Light or Shadow per attack roll', () => {
    const { rng, state, diggerId } = buildFight('economy');
    const grid = state.grid;
    const kara2 = state.entity('kara')!;
    const target = state.entity(diggerId)!;
    state.moveEntity('kara', grid.indexOf(grid.xOf(target.tile) - 1, grid.yOf(target.tile)));
    target.hitPoints = { max: 99, marked: 0 }; // keep it standing to count rolls

    let rolls = 0;
    for (let i = 0; i < 30; i++) {
      const swing = resolveAttack(rng, {
        grid,
        attacker: kara2,
        target,
        profile: kara.weapon,
        defender: diggerDefence(),
        options: { bandTiles },
      });
      expect(swing.hopeGained + swing.fearGained).toBe(1);
      applyAttack(state, swing);
      rolls++;
    }
    expect(rolls).toBe(30);
    // Light caps at 6 and Shadow at 12; nothing overflows.
    expect(kara2.hope!.value).toBeLessThanOrEqual(6);
    expect(state.fear.value).toBeLessThanOrEqual(12);
  });
});
