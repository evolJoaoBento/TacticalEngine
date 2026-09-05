/**
 * End to end, on real content: legacy document -> SceneDoc -> TileGrid ->
 * SceneState -> move -> attack -> damage -> marked Hit Points -> a creature falls.
 *
 * Everything here is driven from one seed and nothing calls `Math.random`, so the
 * whole fight replays identically — which is the property a save file, a replay
 * and a regression test all depend on.
 *
 * The map is the prototype's own demo vault, and the stat block is the SRD's Acid
 * Burrower, imported from the vendored adversary JSON rather than typed in here.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { demoMap } from '../../legacy/js/data.js';
import { createRng, type Rng } from '../../src/engine/core/rng';
import {
  importSeansboxAdversaries,
  type RawAdversary,
} from '../../src/engine/content/srd/seansbox-adversaries';
import type { AdversaryDef } from '../../src/engine/content/types';
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

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const rawAdversaries = JSON.parse(
  readFileSync(`${repoRoot}tools/srd-sources/seansbox/adversaries.json`, 'utf8'),
) as RawAdversary[];
const srd = new Map<string, AdversaryDef>(
  importSeansboxAdversaries(rawAdversaries).defs.map((def) => [def.id, def]),
);

const burrower = srd.get('acid-burrower')!;

/** A tight band table so the demo vault spans more than one band. */
const bandTiles = { melee: 1, veryClose: 2, close: 4, far: 8, veryFar: 12 };

/** Kara from the legacy party, restated in SRD terms: level 1, gambeson armor. */
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
  burrowerId: string;
} {
  const scene = importLegacyScene(demoMap()).scene!;
  const { grid, issues: gridIssues } = gridFromScene(scene);
  expect(gridIssues).toEqual([]);

  // The demo map's own enemies are the prototype's homebrew Hollow Husks, which
  // have no SRD stat block. Standing the scene up with the SRD's Acid Burrower in
  // their place is what makes this a Daggerheart fight rather than a legacy one.
  const { state, issues } = sceneStateFromScene(scene, grid, {
    adversaries: new Map(
      [...srd.values()].map((def) => [
        def.id,
        { id: def.id, hitPoints: def.hitPoints, stress: def.stress },
      ]),
    ),
    party: [createPartyEntity('kara', 'sentinel', -1)],
  });
  // Every placement asks for hollow-husk, which the SRD does not have.
  expect(issues.every((i) => i.message.includes('hollow-husk'))).toBe(true);

  // Open the vault door, then put a Burrower just inside it.
  const door = scene.interactables.find((i) => i.kind === 'door')!;
  state.setInteractableBlocking(tileOf(grid, door.position), false);

  // Just inside the door, on open floor — (door.x + 2) is the legacy pillar's
  // tile, which sceneStateFromScene registers as blocking.
  const burrowerTile = grid.indexOf(door.position.x + 1, door.position.y);
  expect(state.blockedFor('nobody')(burrowerTile)).toBe(false);
  expect(grid.isPassable(burrowerTile)).toBe(true);
  const burrowerId = 'burrower-1';
  state.addEntity({
    id: burrowerId,
    faction: 'adversary',
    definition: burrower.id,
    tile: burrowerTile,
    hitPoints: { max: burrower.hitPoints, marked: 0 },
    stress: { max: burrower.stress, marked: 0 },
    armorSlots: { max: 0, marked: 0 },
    conditions: new Set(),
    alive: true,
  });

  const karaEntity = state.entity('kara')!;
  karaEntity.hitPoints = { max: kara.hitPoints, marked: 0 };
  karaEntity.stress = { max: kara.stress, marked: 0 };
  karaEntity.armorSlots = { max: kara.armorScore, marked: 0 };

  return { rng: createRng(seed), state, pathfinder: new Pathfinder(grid), burrowerId };
}

const burrowerDefence = () => ({
  difficulty: burrower.difficulty,
  thresholds: burrower.thresholds,
});

const karaDefence = () => ({
  difficulty: kara.evasion,
  thresholds: pcThresholds(kara.level, kara.armor),
});

const burrowerAttack: AttackProfile = {
  kind: 'adversary',
  name: burrower.attackName,
  modifier: burrower.attackModifier,
  range: burrower.attackRange,
  damage: burrower.attackDamage,
};

describe('the imported SRD stat block is the one being fought', () => {
  it('reads the Acid Burrower off the vendored JSON', () => {
    expect(burrower).toMatchObject({
      name: 'Acid Burrower',
      tier: 1,
      role: 'solo',
      difficulty: 14,
      hitPoints: 8,
      stress: 3,
      attackName: 'Claws',
      attackRange: 'veryClose',
      thresholds: { major: 8, severe: 15 },
    });
    expect(burrower.attackModifier).toEqual({ count: 0, sides: 0, modifier: 3 });
    expect(burrower.attackDamage).toEqual({
      count: 1,
      sides: 12,
      modifier: 2,
      types: ['physical'],
    });
  });
});

describe('a full melee exchange on the demo map', () => {
  it('walks Kara into Melee range and fights until the Burrower falls', () => {
    const { rng, state, pathfinder, burrowerId } = buildFight('the-vault');
    const grid = state.grid;
    const kara2 = state.entity('kara')!;
    const target = state.entity(burrowerId)!;

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
        defender: burrowerDefence(),
        options: { bandTiles },
      });
      expect(swing.refused).toBeNull();
      expect(swing.dualityRoll).toBeDefined();
      const hit = applyAttack(state, swing);
      log.push(
        `kara ${swing.dualityRoll!.outcome} total ${swing.dualityRoll!.total} vs ${burrower.difficulty}` +
          (swing.hit ? ` -> ${swing.damageRoll!.total} damage, ${hit.hitPointsMarked} HP` : ' -> miss'),
      );
      if (!target.alive) break;

      // The GM answers with the Burrower's standard attack.
      const claw = resolveAttack(rng, {
        grid,
        attacker: target,
        target: kara2,
        profile: burrowerAttack,
        defender: karaDefence(),
        options: { bandTiles, armorSlotsMarked: 0 },
      });
      expect(claw.refused).toBeNull();
      expect(claw.gmRoll).toBeDefined();
      const bite = applyAttack(state, claw);
      log.push(
        `burrower d20 ${claw.gmRoll!.die}+${claw.gmRoll!.modifier} vs ${kara.evasion}` +
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
    // Hope/Fear economy moved.
    expect(kara2.hitPoints.marked).toBeGreaterThan(0);
    expect(kara2.hope!.value + state.fear.value).toBeGreaterThan(2);
  });

  it('replays identically from the same seed, and differently from another', () => {
    const run = (seed: string): string => {
      const { rng, state, burrowerId } = buildFight(seed);
      const grid = state.grid;
      const kara2 = state.entity('kara')!;
      const target = state.entity(burrowerId)!;
      state.moveEntity('kara', grid.indexOf(grid.xOf(target.tile) - 1, grid.yOf(target.tile)));

      const trace: string[] = [];
      for (let i = 0; i < 12 && target.alive; i++) {
        const swing = resolveAttack(rng, {
          grid,
          attacker: kara2,
          target,
          profile: kara.weapon,
          defender: burrowerDefence(),
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

  it('refuses the Burrower a shot at Kara from across the vault', () => {
    const { rng, state, burrowerId } = buildFight('range');
    const target = state.entity(burrowerId)!;
    const kara2 = state.entity('kara')!;
    // Kara starts at the spawn, on the far side of the wall from the Burrower.
    const outcome = resolveAttack(rng, {
      grid: state.grid,
      attacker: target,
      target: kara2,
      profile: burrowerAttack,
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
      const { rng, state, burrowerId } = buildFight(`fight-${seed}`);
      const grid = state.grid;
      const kara2 = state.entity('kara')!;
      const target = state.entity(burrowerId)!;
      state.moveEntity('kara', grid.indexOf(grid.xOf(target.tile) - 1, grid.yOf(target.tile)));

      for (let i = 0; i < 20 && target.alive; i++) {
        const swing = resolveAttack(rng, {
          grid,
          attacker: kara2,
          target,
          profile: kara.weapon,
          defender: burrowerDefence(),
          options: { bandTiles },
        });
        if (swing.hit) {
          const damage = swing.damageRoll!.total;
          const expected =
            damage >= burrower.thresholds.severe ? 3 : damage >= burrower.thresholds.major ? 2 : 1;
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

  it('gives the party exactly one of Hope or Fear per attack roll', () => {
    const { rng, state, burrowerId } = buildFight('economy');
    const grid = state.grid;
    const kara2 = state.entity('kara')!;
    const target = state.entity(burrowerId)!;
    state.moveEntity('kara', grid.indexOf(grid.xOf(target.tile) - 1, grid.yOf(target.tile)));
    target.hitPoints = { max: 99, marked: 0 }; // keep it standing to count rolls

    let rolls = 0;
    for (let i = 0; i < 30; i++) {
      const swing = resolveAttack(rng, {
        grid,
        attacker: kara2,
        target,
        profile: kara.weapon,
        defender: burrowerDefence(),
        options: { bandTiles },
      });
      expect(swing.hopeGained + swing.fearGained).toBe(1);
      applyAttack(state, swing);
      rolls++;
    }
    expect(rolls).toBe(30);
    // Hope caps at 6 and Fear at 12; nothing overflows.
    expect(kara2.hope!.value).toBeLessThanOrEqual(6);
    expect(state.fear.value).toBeLessThanOrEqual(12);
  });
});
