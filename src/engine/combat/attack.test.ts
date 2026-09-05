import { describe, it, expect } from 'vitest';
import { createRng, type Rng } from '../core/rng';
import { TileGrid } from '../grid/grid';
import { parseDice } from '../rules/dice';
import { createMarkPool } from '../rules/resources';
import {
  SceneState,
  createAdversaryEntity,
  createPartyEntity,
  type EntityState,
} from '../scene/state';
import { applyAttack, conditionModifiers, resolveAttack, type AttackProfile } from './attack';

/** An Rng returning scripted die faces, so a rule branch can be pinned exactly. */
function scriptedRng(faces: number[]): Rng {
  let i = 0;
  const take = () => {
    if (i >= faces.length) throw new Error(`scriptedRng exhausted after ${i} draws`);
    return faces[i++]!;
  };
  const rng: Rng = {
    next: () => take() / 100,
    nextInt: () => take(),
    die: () => take(),
    dice: (count) => Array.from({ length: count }, take),
    pick: (items) => items[0]!,
    shuffle: (items) => items,
    fork: () => rng,
    save: () => i,
    restore: (s) => {
      i = s;
    },
  };
  return rng;
}

const grid = new TileGrid({ width: 10, height: 3 });
const bandTiles = { melee: 1, veryClose: 2, close: 4, far: 8, veryFar: 12 };

const greatblade: AttackProfile = {
  kind: 'pc',
  name: 'Greatblade',
  modifier: parseDice('+2')!,
  range: 'melee',
  damage: parseDice('d8+2 phy')!,
  proficiency: 2,
};

const claws: AttackProfile = {
  kind: 'adversary',
  name: 'Claws',
  modifier: parseDice('+3')!,
  range: 'veryClose',
  damage: parseDice('1d12+2 phy')!,
};

const defender = { difficulty: 13, thresholds: { major: 8, severe: 15 } };

function party(id: string, tile: number, hitPoints = 6): EntityState {
  return { ...createPartyEntity(id, 'sentinel', tile), hitPoints: createMarkPool(hitPoints) };
}

function adversary(id: string, tile: number, hitPoints = 8): EntityState {
  return createAdversaryEntity(id, 'acid-burrower', tile, { hitPoints, stress: 3 });
}

describe('conditionModifiers', () => {
  it('gives advantage against a Vulnerable target', () => {
    expect(conditionModifiers({ conditions: new Set(['vulnerable']) })).toEqual({
      advantage: 1,
      disadvantage: 0,
    });
  });

  it('gives disadvantage against a Hidden target', () => {
    expect(conditionModifiers({ conditions: new Set(['hidden']) })).toEqual({
      advantage: 0,
      disadvantage: 1,
    });
  });

  it('is neutral with no conditions, and reports both when both apply', () => {
    expect(conditionModifiers({ conditions: new Set() })).toEqual({
      advantage: 0,
      disadvantage: 0,
    });
    expect(conditionModifiers({ conditions: new Set(['vulnerable', 'hidden']) })).toEqual({
      advantage: 1,
      disadvantage: 1,
    });
  });
});

describe('resolveAttack — refusals', () => {
  const attempt = (attackerTile: number, targetTile: number, profile = greatblade) =>
    resolveAttack(scriptedRng([]), {
      grid,
      attacker: party('kara', attackerTile),
      target: adversary('husk', targetTile),
      profile,
      defender,
      options: { bandTiles },
    });

  it('rolls nothing at all when the target is out of range', () => {
    // scriptedRng([]) throws on the first draw, so this passing proves no dice
    // were rolled — a range preview must not shift the random stream.
    const outcome = attempt(grid.indexOf(0, 0), grid.indexOf(6, 0));
    expect(outcome.refused).toBe('outOfRange');
    expect(outcome.hit).toBe(false);
    expect(outcome.dualityRoll).toBeUndefined();
    expect(outcome.hitPointsMarked).toBe(0);
  });

  it('rolls nothing when a wall blocks the line of sight', () => {
    const walled = new TileGrid({ width: 10, height: 3 });
    walled.setTerrainById(walled.indexOf(2, 0), 'wall');
    const outcome = resolveAttack(scriptedRng([]), {
      grid: walled,
      attacker: party('kara', walled.indexOf(0, 0)),
      target: adversary('husk', walled.indexOf(4, 0)),
      profile: { ...greatblade, range: 'far' },
      defender,
      options: { bandTiles },
    });
    expect(outcome.refused).toBe('noLineOfSight');
  });
});

describe('resolveAttack — a PC attacking', () => {
  const attack = (faces: number[], options = {}) =>
    resolveAttack(scriptedRng(faces), {
      grid,
      attacker: party('kara', grid.indexOf(0, 0)),
      target: adversary('husk', grid.indexOf(1, 0)),
      profile: greatblade,
      defender,
      options: { bandTiles, ...options },
    });

  it('rolls the Duality Dice against the target Difficulty', () => {
    // Hope 8, Fear 3 -> 11 + 2 = 13, meets Difficulty 13. Damage 2d8+2: 5, 6.
    const outcome = attack([8, 3, 5, 6]);
    expect(outcome.dualityRoll).toMatchObject({ hope: 8, fear: 3, total: 13, success: true });
    expect(outcome.gmRoll).toBeUndefined();
    expect(outcome.hit).toBe(true);
    expect(outcome.damageRoll!.expression).toEqual({ count: 2, sides: 8, modifier: 2 });
    expect(outcome.damageRoll!.total).toBe(13);
  });

  it('marks Hit Points from the damage thresholds', () => {
    // 13 damage: at or above Major (8), below Severe (15) -> 2 HP.
    const outcome = attack([8, 3, 5, 6]);
    expect(outcome.damage).toMatchObject({ incoming: 13, severity: 'major' });
    expect(outcome.hitPointsMarked).toBe(2);
  });

  it('rolls no damage on a miss', () => {
    const outcome = attack([2, 3]);
    expect(outcome.hit).toBe(false);
    expect(outcome.damageRoll).toBeUndefined();
    expect(outcome.hitPointsMarked).toBe(0);
  });

  it('grants Hope on a roll with Hope and Fear on a roll with Fear', () => {
    expect(attack([8, 3, 5, 6])).toMatchObject({ hopeGained: 1, fearGained: 0 });
    expect(attack([3, 8, 5, 6])).toMatchObject({ hopeGained: 0, fearGained: 1 });
  });

  it('passes the spotlight on a success with Fear but not a success with Hope', () => {
    expect(attack([8, 3, 5, 6]).spotlightToGm).toBe(false);
    expect(attack([3, 8, 5, 6]).spotlightToGm).toBe(true);
  });

  it('deals critical damage on matching Duality Dice', () => {
    // 7/7 crits. 2d8+2 rolling 3 and 4 -> 9, plus the maximum dice result, 16.
    const outcome = attack([7, 7, 3, 4]);
    expect(outcome.critical).toBe(true);
    expect(outcome.damageRoll!.criticalBonus).toBe(16);
    expect(outcome.damageRoll!.total).toBe(25);
    expect(outcome.hitPointsMarked).toBe(3); // at or above Severe
    expect(outcome.stressCleared).toBe(1);
  });

  it('multiplies damage dice by Proficiency but not the modifier', () => {
    const outcome = resolveAttack(scriptedRng([8, 3, 4, 4, 4]), {
      grid,
      attacker: party('kara', grid.indexOf(0, 0)),
      target: adversary('husk', grid.indexOf(1, 0)),
      profile: { ...greatblade, proficiency: 3 },
      defender,
      options: { bandTiles },
    });
    expect(outcome.damageRoll!.expression).toEqual({ count: 3, sides: 8, modifier: 2 });
    expect(outcome.damageRoll!.total).toBe(14);
  });

  it('raises the Difficulty by the target cover rather than lowering the roll', () => {
    const covered = new TileGrid({ width: 10, height: 3 });
    covered.setTerrainById(covered.indexOf(3, 0), 'cover');
    const outcome = resolveAttack(scriptedRng([6, 5]), {
      grid: covered,
      attacker: party('kara', covered.indexOf(0, 0)),
      target: adversary('husk', covered.indexOf(3, 0)),
      profile: { ...greatblade, range: 'far' },
      defender,
      options: { bandTiles },
    });
    // 6 + 5 + 2 = 13 against Difficulty 13 + 1 cover = a miss by exactly one,
    // which would have been a hit on the same roll in the open.
    expect(outcome.dualityRoll!.total).toBe(13);
    expect(outcome.dualityRoll!.difficulty).toBe(14);
    expect(outcome.hit).toBe(false);
  });

  it('takes advantage from a Vulnerable target', () => {
    const outcome = resolveAttack(scriptedRng([5, 4, 6, 3, 3]), {
      grid,
      attacker: party('kara', grid.indexOf(0, 0)),
      target: { ...adversary('husk', grid.indexOf(1, 0)), conditions: new Set(['vulnerable']) },
      profile: greatblade,
      defender,
      options: { bandTiles },
    });
    expect(outcome.advantage).toBe(1);
    expect(outcome.dualityRoll!.advantageDie).toBe(6);
    expect(outcome.dualityRoll!.total).toBe(17);
  });

  it('adds Help an Ally dice and a flat bonus', () => {
    const outcome = resolveAttack(scriptedRng([4, 3, 2, 5, 4, 4]), {
      grid,
      attacker: party('kara', grid.indexOf(0, 0)),
      target: adversary('husk', grid.indexOf(1, 0)),
      profile: greatblade,
      defender,
      options: { bandTiles, helpDice: 2, bonus: 1 },
    });
    expect(outcome.modifier).toBe(3);
    expect(outcome.dualityRoll!.helpBonus).toBe(5);
    expect(outcome.dualityRoll!.total).toBe(15);
  });

  it('lets the defender reduce a hit by marking Armor Slots', () => {
    const armored = { ...adversary('husk', grid.indexOf(1, 0)), armorSlots: createMarkPool(3) };
    const outcome = resolveAttack(scriptedRng([8, 3, 5, 6]), {
      grid,
      attacker: party('kara', grid.indexOf(0, 0)),
      target: armored,
      profile: greatblade,
      defender,
      options: { bandTiles, armorSlotsMarked: 1 },
    });
    expect(outcome.damage).toMatchObject({ severity: 'major', finalSeverity: 'minor' });
    expect(outcome.hitPointsMarked).toBe(1);
  });

  it('spends no Armor Slots the target does not actually have', () => {
    // The target's own pool is the only source of truth, so a defender who marks
    // armor it has not got takes the hit in full rather than being under-damaged.
    const outcome = resolveAttack(scriptedRng([8, 3, 5, 6]), {
      grid,
      attacker: party('kara', grid.indexOf(0, 0)),
      // createAdversaryEntity gives 0 Armor Slots.
      target: adversary('husk', grid.indexOf(1, 0)),
      profile: greatblade,
      defender,
      options: { bandTiles, armorSlotsMarked: 2 },
    });
    expect(outcome.damage).toMatchObject({
      severity: 'major',
      finalSeverity: 'major',
      armorSlotsSpent: 0,
    });
    expect(outcome.hitPointsMarked).toBe(2);
  });
});

describe('resolveAttack — an adversary attacking', () => {
  const attack = (faces: number[], options = {}) =>
    resolveAttack(scriptedRng(faces), {
      grid,
      attacker: adversary('husk', grid.indexOf(0, 0)),
      target: party('kara', grid.indexOf(1, 0)),
      profile: claws,
      // A PC target defends with Evasion.
      defender: { difficulty: 11, thresholds: { major: 7, severe: 13 } },
      options: { bandTiles, ...options },
    });

  it('rolls a single d20 plus the attack bonus, not Duality Dice', () => {
    const outcome = attack([12, 9]);
    expect(outcome.gmRoll).toMatchObject({ die: 12, modifier: 3, total: 15, success: true });
    expect(outcome.dualityRoll).toBeUndefined();
  });

  it('generates no Hope or Fear and never passes the spotlight', () => {
    const outcome = attack([12, 9]);
    expect(outcome).toMatchObject({
      hopeGained: 0,
      fearGained: 0,
      stressCleared: 0,
      spotlightToGm: false,
    });
  });

  it('rolls its listed damage without Proficiency scaling', () => {
    const outcome = attack([12, 9]);
    expect(outcome.damageRoll!.expression).toEqual({ count: 1, sides: 12, modifier: 2 });
    expect(outcome.damageRoll!.total).toBe(11);
    expect(outcome.hitPointsMarked).toBe(2); // at or above Major 7, below Severe 13
  });

  it('crits on a natural 20 and adds the maximum damage dice', () => {
    const outcome = attack([20, 4]);
    expect(outcome.critical).toBe(true);
    expect(outcome.damageRoll!.criticalBonus).toBe(12);
    expect(outcome.damageRoll!.total).toBe(18);
    expect(outcome.hitPointsMarked).toBe(3);
  });

  it('rolls a dice-valued attack modifier before the attack roll', () => {
    // The Outer Realms Abomination's "+2d4": two d4s, then the d20.
    const outcome = resolveAttack(scriptedRng([3, 4, 6, 5]), {
      grid,
      attacker: adversary('abomination', grid.indexOf(0, 0)),
      target: party('kara', grid.indexOf(1, 0)),
      profile: { ...claws, modifier: parseDice('+2d4')! },
      defender: { difficulty: 11, thresholds: { major: 7, severe: 13 } },
      options: { bandTiles },
    });
    expect(outcome.modifier).toBe(7);
    expect(outcome.gmRoll!.die).toBe(6);
    expect(outcome.gmRoll!.total).toBe(13);
  });
});

describe('applyAttack', () => {
  const setup = () => {
    const state = new SceneState({ id: 'room' }, grid);
    state.addEntity(party('kara', grid.indexOf(0, 0)));
    state.addEntity(adversary('husk', grid.indexOf(1, 0), 5));
    return state;
  };

  const hit = () =>
    resolveAttack(scriptedRng([8, 3, 5, 6]), {
      grid,
      attacker: party('kara', grid.indexOf(0, 0)),
      target: adversary('husk', grid.indexOf(1, 0)),
      profile: greatblade,
      defender,
      options: { bandTiles },
    });

  it('marks the target Hit Points and moves the attacker Hope', () => {
    const state = setup();
    const applied = applyAttack(state, hit());
    expect(applied.hitPointsMarked).toBe(2);
    expect(applied.hopeGained).toBe(1);
    expect(state.entity('husk')!.hitPoints.marked).toBe(2);
    expect(state.entity('kara')!.hope!.value).toBe(3);
  });

  it('gives the GM Fear on a roll with Fear', () => {
    const state = setup();
    const outcome = resolveAttack(scriptedRng([3, 8, 5, 6]), {
      grid,
      attacker: party('kara', grid.indexOf(0, 0)),
      target: adversary('husk', grid.indexOf(1, 0)),
      profile: greatblade,
      defender,
      options: { bandTiles },
    });
    const applied = applyAttack(state, outcome);
    expect(applied.fearGained).toBe(1);
    expect(state.fear.value).toBe(1);
  });

  it('reports the Hope actually gained when the attacker is at the cap', () => {
    const state = setup();
    state.entity('kara')!.hope = { max: 6, value: 6 };
    expect(applyAttack(state, hit()).hopeGained).toBe(0);
    expect(state.entity('kara')!.hope!.value).toBe(6);
  });

  it('clears a Stress on a crit, and only what is marked', () => {
    const state = setup();
    state.entity('kara')!.stress = createMarkPool(6, 1);
    const outcome = resolveAttack(scriptedRng([7, 7, 3, 4]), {
      grid,
      attacker: party('kara', grid.indexOf(0, 0)),
      target: adversary('husk', grid.indexOf(1, 0)),
      profile: greatblade,
      defender,
      options: { bandTiles },
    });
    expect(applyAttack(state, outcome).stressCleared).toBe(1);
    expect(state.entity('kara')!.stress.marked).toBe(0);

    const unstressed = setup();
    const outcome2 = resolveAttack(scriptedRng([7, 7, 3, 4]), {
      grid,
      attacker: party('kara', grid.indexOf(0, 0)),
      target: adversary('husk', grid.indexOf(1, 0)),
      profile: greatblade,
      defender,
      options: { bandTiles },
    });
    expect(applyAttack(unstressed, outcome2).stressCleared).toBe(0);
  });

  it('marks the Armor Slots the defence actually spent', () => {
    const state = setup();
    state.entity('husk')!.armorSlots = createMarkPool(3);
    const armored = { ...adversary('husk', grid.indexOf(1, 0)), armorSlots: createMarkPool(3) };
    const outcome = resolveAttack(scriptedRng([8, 3, 5, 6]), {
      grid,
      attacker: party('kara', grid.indexOf(0, 0)),
      target: armored,
      profile: greatblade,
      defender,
      options: { bandTiles, armorSlotsMarked: 1 },
    });
    const applied = applyAttack(state, outcome);
    expect(applied.armorSlotsSpent).toBe(1);
    expect(state.entity('husk')!.armorSlots.marked).toBe(1);
    expect(applied.hitPointsMarked).toBe(1);
  });

  it('fells a target that marks its last Hit Point', () => {
    const state = setup();
    state.entity('husk')!.hitPoints = createMarkPool(2);
    const applied = applyAttack(state, hit());
    expect(applied).toMatchObject({ hitPointsMarked: 2, fell: true });
    expect(state.entity('husk')!.alive).toBe(false);
    // A fallen creature stops blocking movement.
    expect(state.isOccupied(grid.indexOf(1, 0))).toBe(false);
  });

  it('marks only the Hit Points a target has left', () => {
    const state = setup();
    state.entity('husk')!.hitPoints = createMarkPool(5, 4);
    expect(applyAttack(state, hit()).hitPointsMarked).toBe(1);
  });

  it('changes nothing on a refused attack', () => {
    const state = setup();
    const refused = resolveAttack(scriptedRng([]), {
      grid,
      attacker: party('kara', grid.indexOf(0, 0)),
      target: adversary('husk', grid.indexOf(6, 0)),
      profile: greatblade,
      defender,
      options: { bandTiles },
    });
    const before = JSON.stringify(state.snapshot());
    applyAttack(state, refused);
    expect(JSON.stringify(state.snapshot())).toBe(before);
  });

  it('leaves the scene untouched until it is applied', () => {
    const state = setup();
    const before = JSON.stringify(state.snapshot());
    hit(); // resolved, not applied
    expect(JSON.stringify(state.snapshot())).toBe(before);
  });
});

describe('adjacency and range', () => {
  const diagonalGrid = new TileGrid({ width: 5, height: 5 });
  const centre = diagonalGrid.indexOf(2, 2);
  const diagonalNeighbour = diagonalGrid.indexOf(3, 3);

  it('refuses a Melee attack on a diagonal neighbour by default', () => {
    // Straight-line distance is 1.41, which rounds into Very Close. That matches
    // DEFAULT_MOVEMENT, where a diagonal is not a step either.
    const outcome = resolveAttack(scriptedRng([]), {
      grid: diagonalGrid,
      attacker: party('kara', centre),
      target: adversary('husk', diagonalNeighbour),
      profile: greatblade,
      defender,
      options: { bandTiles },
    });
    expect(outcome.targeting.band).toBe('veryClose');
    expect(outcome.refused).toBe('outOfRange');
  });

  it('reaches a diagonal neighbour when the project allows diagonal movement', () => {
    const outcome = resolveAttack(scriptedRng([8, 3, 5, 6]), {
      grid: diagonalGrid,
      attacker: party('kara', centre),
      target: adversary('husk', diagonalNeighbour),
      profile: greatblade,
      defender,
      options: { bandTiles, diagonalAdjacency: true },
    });
    expect(outcome.targeting.band).toBe('melee');
    expect(outcome.targeting.ranged).toBe(false);
    expect(outcome.refused).toBeNull();
    expect(outcome.hit).toBe(true);
  });

  it('still measures anything past a neighbour in a straight line', () => {
    const outcome = resolveAttack(scriptedRng([]), {
      grid: diagonalGrid,
      attacker: party('kara', diagonalGrid.indexOf(0, 0)),
      target: adversary('husk', diagonalGrid.indexOf(4, 4)),
      profile: { ...greatblade, range: 'veryClose' },
      defender,
      options: { bandTiles, diagonalAdjacency: true },
    });
    expect(outcome.targeting.distance).toBeCloseTo(Math.hypot(4, 4), 10);
    expect(outcome.refused).toBe('outOfRange');
  });

  it('refuses an attack on the attacker own tile without rolling', () => {
    const outcome = resolveAttack(scriptedRng([]), {
      grid,
      attacker: party('kara', grid.indexOf(2, 0)),
      target: adversary('husk', grid.indexOf(2, 0)),
      profile: greatblade,
      defender,
      options: { bandTiles },
    });
    expect(outcome.refused).toBe('selfTarget');
    expect(outcome.dualityRoll).toBeUndefined();
  });
});

describe('determinism', () => {
  it('replays an identical attack from the same seed', () => {
    const attack = (rng: Rng) =>
      resolveAttack(rng, {
        grid,
        attacker: party('kara', grid.indexOf(0, 0)),
        target: adversary('husk', grid.indexOf(1, 0)),
        profile: greatblade,
        defender,
        options: { bandTiles, helpDice: 1 },
      });
    expect(attack(createRng('fight'))).toEqual(attack(createRng('fight')));
  });

  it('advances the stream between attacks', () => {
    const rng = createRng('fight');
    const build = () =>
      resolveAttack(rng, {
        grid,
        attacker: party('kara', grid.indexOf(0, 0)),
        target: adversary('husk', grid.indexOf(1, 0)),
        profile: greatblade,
        defender,
        options: { bandTiles },
      });
    expect(build()).not.toEqual(build());
  });
});
