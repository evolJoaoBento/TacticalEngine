import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Rng } from '../core/rng';
import { TileGrid } from '../grid/grid';
import { SceneState, createAdversaryEntity, createPartyEntity } from '../scene/state';
import { importCharacterContent } from '../content/srd/daggersearch';
import type { AdversaryDef } from '../content/types';
import { blankSheet, deriveCharacter, startingPools, type DerivedCharacter } from '../character/sheet';
import { ScriptRunner, runScript, type JournalEntry } from './runner';
import { SceneScriptWorld, createScenarioState } from './world';
import type { Effect } from './schema';
import { SRD_ABILITIES, SRD_ABILITY_MAP } from '../content/srd/abilities';
import { SRD_CONDITIONS } from '../content/conditions';

/**
 * The combat half of the script vocabulary: what lets a domain card be a
 * script. Every rule here is one the SRD states — one roll against many
 * targets, damage rolled once and applied to each, a critical's maximum dice,
 * Stress overflowing into a Hit Point, a reaction roll as a d20 for an
 * adversary — and every refusal draws no dice, so a replay stays in step.
 */

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const read = (name: string): unknown[] =>
  JSON.parse(readFileSync(`${repoRoot}tools/srd-sources/daggersearch/core/${name}.json`, 'utf8'));
const content = importCharacterContent({
  weapons: read('weapons'),
  armors: read('armors'),
  classes: read('classes'),
  ancestries: read('ancestries'),
  communities: read('communities'),
  subclasses: read('subclasses'),
  domainCards: read('domain-cards'),
}).content;

/** A die stream that hands out exactly the numbers a test writes down. */
function scripted(values: number[]): Rng & { drawn: () => number } {
  let i = 0;
  const take = (): number => {
    const v = values[i];
    if (v === undefined) throw new Error(`the script ran out of dice after ${i}`);
    i++;
    return v;
  };
  const rng: Rng & { drawn: () => number } = {
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
    drawn: () => i,
  };
  return rng;
}

const husk = (id: string, difficulty: number): AdversaryDef => ({
  id,
  name: id,
  tier: 1,
  role: 'standard',
  description: '',
  motivesAndTactics: '',
  difficulty,
  thresholds: { major: 7, severe: 12 },
  hitPoints: 5,
  stress: 3,
  attackName: 'Claws',
  attackModifier: { count: 0, sides: 0, modifier: 1 },
  attackRange: 'melee',
  attackDamage: { count: 1, sides: 6, modifier: 2, types: ['physical'] },
  experiences: [],
  features: [],
});

const bandTiles = { melee: 1, veryClose: 2, close: 4, far: 8, veryFar: 12 };

/**
 * A corridor: Kara (a Guardian, no Spellcast trait) and Mira (a Wizard, who
 * casts with Knowledge +2), a soft husk two tiles east and a tough one four.
 */
function scene(options: { fighting?: boolean; armor?: 'auto' | 'never'; content?: boolean } = {}) {
  const grid = new TileGrid({ width: 14, height: 3 });
  const state = new SceneState({ id: 'corridor' }, grid);
  const sheets = [
    blankSheet('kara', 'guardian', {
      name: 'Kara',
      traits: { agility: 0, strength: 2, finesse: 0, instinct: 1, presence: 1, knowledge: -1 },
      armorId: 'chainmail-armor',
      primaryWeaponId: 'broadsword',
      subclassId: 'stalwart',
      domainCards: ['bare-bones', 'get-back-up'],
      experiences: [{ name: 'Held the line', modifier: 2 }],
    }),
    blankSheet('mira', 'wizard', {
      name: 'Mira',
      traits: { agility: 0, strength: -1, finesse: 1, instinct: 2, presence: 1, knowledge: 2 },
      armorId: 'gambeson-armor',
      primaryWeaponId: 'greatstaff',
      subclassId: 'school-of-knowledge',
      domainCards: ['book-of-ava', 'rune-ward'],
      experiences: [{ name: 'Read the runes', modifier: 2 }],
    }),
  ];
  const characters = new Map<string, DerivedCharacter>();
  for (const sheet of sheets) {
    const derived = deriveCharacter(sheet, content);
    expect(derived.issues).toEqual([]);
    characters.set(sheet.id, derived.character);
    const pools = startingPools(derived.character);
    state.addEntity({ ...createPartyEntity(sheet.id, sheet.classId, grid.indexOf(sheet.id === 'kara' ? 1 : 0, 1)), ...pools });
  }
  const adversaries = new Map<string, AdversaryDef>([
    ['soft-husk', husk('soft-husk', 10)],
    ['tough-husk', husk('tough-husk', 16)],
  ]);
  state.addEntity(createAdversaryEntity('husk-1', 'soft-husk', grid.indexOf(3, 1), { hitPoints: 5, stress: 3 }));
  state.addEntity(createAdversaryEntity('husk-2', 'tough-husk', grid.indexOf(5, 1), { hitPoints: 5, stress: 3 }));

  const scenario = createScenarioState({}, 'mira');
  const world = new SceneScriptWorld(state, scenario, {
    traits: { strength: 2, knowledge: 2, finesse: 1 },
    characters,
    adversaries,
    bandTiles,
    inCombat: () => options.fighting === true,
    ...(options.armor === undefined ? {} : { armor: options.armor }),
    // The shipped cards and conditions, when a test plays the real ones.
    ...(options.content === true ? { abilities: SRD_ABILITIES, conditionDefs: SRD_CONDITIONS } : {}),
  });
  return { grid, state, scenario, world, characters };
}

const kinds = (journal: readonly JournalEntry[]): string[] => journal.map((e) => e.kind);
const refusals = (journal: readonly JournalEntry[]): string[] =>
  journal.filter((e): e is Extract<JournalEntry, { kind: 'refused' }> => e.kind === 'refused').map((e) => e.reason);

describe('selectors', () => {
  it('names the chosen target, the hit list, and creatures by range', () => {
    const { world } = scene();
    const bound = { targets: ['husk-1', 'husk-2'], hit: ['husk-2'] };
    expect(world.resolveTargets({ kind: 'target' }, bound)).toEqual(['husk-1', 'husk-2']);
    expect(world.resolveTargets({ kind: 'hit' }, bound)).toEqual(['husk-2']);
    // Mira stands at x=0: husk-1 is three tiles off (Close), husk-2 five (Far).
    expect(world.resolveTargets({ kind: 'adversaries', range: 'close' }, bound)).toEqual(['husk-1']);
    expect(world.resolveTargets({ kind: 'adversaries', range: 'far' }, bound)).toEqual(['husk-1', 'husk-2']);
    // A group around the chosen target: husk-2's Very Close neighbours.
    expect(world.resolveTargets({ kind: 'adversaries', range: 'veryClose', around: 'target' }, { targets: ['husk-2'], hit: [] })).toEqual(['husk-1', 'husk-2']);
    // "All other targets": the chosen one left out.
    expect(world.resolveTargets({ kind: 'adversaries', range: 'far', except: 'target' }, { targets: ['husk-1'], hit: [] })).toEqual(['husk-2']);
    // Allies leave the actor out unless asked, and can be ranged too.
    expect(world.resolveTargets({ kind: 'allies' }, bound)).toEqual(['kara']);
    expect(world.resolveTargets({ kind: 'allies', includeSelf: true }, bound)).toEqual(['kara', 'mira']);
    expect(world.resolveTargets({ kind: 'allies', range: 'melee' }, bound)).toEqual(['kara']);
  });

  it('leaves the fallen out', () => {
    const { world, state } = scene();
    state.entity('husk-1')!.alive = false;
    expect(world.resolveTargets({ kind: 'target' }, { targets: ['husk-1', 'husk-2'], hit: [] })).toEqual(['husk-2']);
  });
});

describe('a check against targets', () => {
  const bolt: Effect = {
    kind: 'check',
    check: {
      trait: 'spellcast',
      difficulty: 'target',
      onSuccessWithHope: [{ kind: 'damage', dice: '1d8+4', type: 'magic' }],
      onFailureWithFear: [{ kind: 'log', text: 'fizzle' }],
    },
  };

  it('rolls once, beats each target on its own Difficulty, and damages the ones it beat', () => {
    const { world, state } = scene();
    // Hope 9 + Fear 3 + Knowledge 2 = 14: past the soft husk's 10, short of the tough one's 16.
    const rng = scripted([9, 3, 5]);
    const runner = new ScriptRunner(world, rng, { targets: ['husk-1', 'husk-2'], rollAs: 'actor' });
    const waiting = runner.run([bolt]);
    expect(waiting.status).toBe('waiting');
    if (waiting.status !== 'waiting' || waiting.prompt.kind !== 'check') throw new Error('expected a check prompt');
    expect(waiting.prompt.targets).toEqual(['husk-1', 'husk-2']);
    expect(waiting.prompt.modifier).toBe(2);
    expect(waiting.prompt.experiences).toEqual([{ name: 'Read the runes', modifier: 2 }]);

    const done = runner.resume({ kind: 'roll' });
    expect(done.status).toBe('done');
    const check = done.journal.find((e) => e.kind === 'check');
    expect(check).toMatchObject({ targets: ['husk-1', 'husk-2'], hit: ['husk-1'], outcome: 'successWithHope' });
    // One d8 (5) + 4 = 9: Major against 7/12, two Hit Points on the soft husk only.
    expect(done.journal.find((e) => e.kind === 'damage')).toMatchObject({ amount: 9, marked: 2, targets: ['husk-1'], dice: '1d8+4' });
    expect(state.entity('husk-1')!.hitPoints.marked).toBe(2);
    expect(state.entity('husk-2')!.hitPoints.marked).toBe(0);
    // Two duality dice and one damage die; nothing else was drawn.
    expect(rng.drawn()).toBe(3);
    // Hope for a roll with Hope, to the caster.
    expect(state.entity('mira')!.hope!.value).toBe(3);
    expect(runner.spotlightToGm).toBe(false);
  });

  it('hits nobody on a failure, and the spotlight passes', () => {
    const { world, state } = scene();
    // Hope 2 + Fear 4 + 2 = 8: short of 10, with Fear.
    const rng = scripted([2, 4]);
    const runner = new ScriptRunner(world, rng, { targets: ['husk-1'], rollAs: 'actor' });
    runner.run([bolt]);
    const done = runner.resume({ kind: 'roll' });
    expect(kinds(done.journal)).toEqual(['check', 'fear', 'log']);
    expect(rng.drawn()).toBe(2);
    expect(state.entity('husk-1')!.hitPoints.marked).toBe(0);
    expect(runner.spotlightToGm).toBe(true);
  });

  it('adds the maximum dice on a critical, and clears a Stress', () => {
    const { world, state } = scene();
    state.entity('mira')!.stress = { max: 6, marked: 2 };
    const rng = scripted([7, 7, 2]);
    const runner = new ScriptRunner(world, rng, { targets: ['husk-2'], rollAs: 'actor' });
    runner.run([bolt]);
    const done = runner.resume({ kind: 'roll' });
    // 7 + 7 + 2 = 16 would beat it anyway; matched dice beat anything.
    expect(done.journal.find((e) => e.kind === 'check')).toMatchObject({ outcome: 'criticalSuccess', hit: ['husk-2'] });
    // 1d8 rolled 2, plus the maximum 8, plus 4: 14 is Severe.
    expect(done.journal.find((e) => e.kind === 'damage')).toMatchObject({ amount: 14, marked: 3 });
    expect(state.entity('mira')!.stress.marked).toBe(1);
  });

  it('refuses a Spellcast Roll to a character without the trait, drawing nothing', () => {
    const { world, scenario } = scene();
    scenario.actorId = 'kara';
    const rng = scripted([]);
    const journal = runScript([bolt], world, rng, { targets: ['husk-1'], rollAs: 'actor' });
    expect(refusals(journal)).toEqual(['no spellcast trait to roll with']);
    expect(rng.drawn()).toBe(0);
  });

  it('rolls a plain trait as the party by default, and as the actor when told', () => {
    const { world, scenario } = scene();
    scenario.actorId = 'mira';
    const check: Effect = { kind: 'check', check: { trait: 'strength', difficulty: 10 } };
    const asParty = new ScriptRunner(world, scripted([]), { targets: ['husk-1'] }).run([check]);
    const asActor = new ScriptRunner(world, scripted([]), { targets: ['husk-1'], rollAs: 'actor' }).run([check]);
    if (asParty.status !== 'waiting' || asParty.prompt.kind !== 'check') throw new Error('expected a prompt');
    if (asActor.status !== 'waiting' || asActor.prompt.kind !== 'check') throw new Error('expected a prompt');
    // The party's best Strength is Kara's +2; Mira's own is −1.
    expect(asParty.prompt.modifier).toBe(2);
    expect(asActor.prompt.modifier).toBe(-1);
  });

  it('utilizes an Experience for a Hope, and not without one', () => {
    const { world, state } = scene();
    const roll = (): number => {
      const runner = new ScriptRunner(world, scripted([5, 3]), { targets: ['husk-1'], rollAs: 'actor' });
      runner.run([{ kind: 'check', check: { trait: 'knowledge', difficulty: 10 } }]);
      const done = runner.resume({ kind: 'roll', experience: 'Read the runes' });
      const check = done.journal.find((e) => e.kind === 'check');
      if (check?.kind !== 'check') throw new Error('no check');
      return check.roll.total;
    };
    // 5 + 3 + 2 (Knowledge) + 2 (the Experience) = 12, for a Hope.
    expect(state.entity('mira')!.hope!.value).toBe(2);
    expect(roll()).toBe(12);
    // The Hope spent, then one gained for rolling with Hope.
    expect(state.entity('mira')!.hope!.value).toBe(2);
    state.entity('mira')!.hope = { max: 6, value: 0 };
    expect(roll()).toBe(10);
  });
});

describe('damage with dice', () => {
  it('halves, goes direct past armor, and scales with Proficiency or the Spellcast trait', () => {
    const { world, state, scenario } = scene();
    const bound = { targets: ['kara'], rollAs: 'actor' as const };
    // Kara wears chainmail: thresholds 7/15 at level 1, Armor Score 4.
    // 12 is Major; one Armor Slot makes it Minor.
    runScript([{ kind: 'damage', dice: '12 phy', target: { kind: 'target' } }], world, scripted([]), bound);
    expect(state.entity('kara')!.hitPoints.marked).toBe(1);
    expect(state.entity('kara')!.armorSlots.marked).toBe(1);
    // Direct damage cannot be reduced.
    runScript([{ kind: 'damage', dice: '12 phy', direct: true, target: { kind: 'target' } }], world, scripted([]), bound);
    expect(state.entity('kara')!.hitPoints.marked).toBe(3);
    expect(state.entity('kara')!.armorSlots.marked).toBe(1);
    // Half of 12 is 6: Minor, and one more Armor Slot turns Minor into nothing.
    runScript([{ kind: 'damage', dice: '12 phy', half: true, target: { kind: 'target' } }], world, scripted([]), bound);
    expect(state.entity('kara')!.hitPoints.marked).toBe(3);
    expect(state.entity('kara')!.armorSlots.marked).toBe(2);

    // Mira's Spellcast trait is 2: "d6 using your Spellcast trait" is 2d6.
    scenario.actorId = 'mira';
    const rng = scripted([4, 4]);
    const journal = runScript([{ kind: 'damage', dice: 'd6', using: 'spellcast', target: { kind: 'entity', id: 'husk-1' } }], world, rng, bound);
    expect(journal.find((e) => e.kind === 'damage')).toMatchObject({ amount: 8, dice: '2d6' });
    expect(rng.drawn()).toBe(2);

    // Kara's Proficiency is 1; a level-5 sheet would roll more, but the rule is the same call.
    scenario.actorId = 'kara';
    const one = scripted([3]);
    runScript([{ kind: 'damage', dice: 'd8', using: 'proficiency', target: { kind: 'entity', id: 'husk-1' } }], world, one, bound);
    expect(one.drawn()).toBe(1);
  });

  it('never marks armor when the policy says so', () => {
    const { world, state } = scene({ armor: 'never' });
    runScript([{ kind: 'damage', dice: '12 phy', target: { kind: 'entity', id: 'kara' } }], world, scripted([]));
    expect(state.entity('kara')!.hitPoints.marked).toBe(2);
    expect(state.entity('kara')!.armorSlots.marked).toBe(0);
  });

  it('marks flat damage outright, as content always meant', () => {
    const { world, state } = scene();
    runScript([{ kind: 'damage', amount: 2, target: { kind: 'entity', id: 'kara' } }], world, scripted([]));
    expect(state.entity('kara')!.hitPoints.marked).toBe(2);
    expect(state.entity('kara')!.armorSlots.marked).toBe(0);
  });
});

describe('pools and conditions', () => {
  it('marks Stress, and a full track marks a Hit Point instead', () => {
    const { world, state } = scene();
    const journal = runScript([{ kind: 'markStress', amount: 7 }], world, scripted([]));
    expect(journal[0]).toMatchObject({ kind: 'stress', id: 'mira', marked: 6, hitPoints: 1 });
    expect(state.entity('mira')!.stress.marked).toBe(6);
    expect(state.entity('mira')!.hitPoints.marked).toBe(1);
    runScript([{ kind: 'clearStress', amount: 2 }], world, scripted([]));
    expect(state.entity('mira')!.stress.marked).toBe(4);
  });

  it('spends Hope when there is Hope, and refuses when there is not', () => {
    const { world, state } = scene();
    expect(kinds(runScript([{ kind: 'spendHope', amount: 2 }], world, scripted([])))).toEqual(['hopeSpent']);
    expect(state.entity('mira')!.hope!.value).toBe(0);
    expect(refusals(runScript([{ kind: 'spendHope' }], world, scripted([])))).toEqual(['not enough Hope to spend 1']);
    // Hope to an ally is journalled with who got it; an adversary gains none.
    const journal = runScript(
      [
        { kind: 'gainHope', amount: 9, target: { kind: 'allies' } },
        { kind: 'gainHope', target: { kind: 'entity', id: 'husk-1' } },
      ],
      world,
      scripted([]),
    );
    expect(journal).toEqual([{ kind: 'hope', gained: 4, id: 'kara' }]);
    expect(state.entity('kara')!.hope!.value).toBe(6);
  });

  it('clears Armor Slots', () => {
    const { world, state } = scene();
    state.entity('kara')!.armorSlots = { max: 4, marked: 3 };
    const journal = runScript([{ kind: 'clearArmor', amount: 2, target: { kind: 'entity', id: 'kara' } }], world, scripted([]));
    expect(journal).toEqual([{ kind: 'armor', id: 'kara', cleared: 2 }]);
    expect(state.entity('kara')!.armorSlots.marked).toBe(1);
  });

  it('applies a condition once, with a duration the scene ends', () => {
    const { world, state } = scene();
    const apply: Effect = { kind: 'applyCondition', condition: 'vulnerable', target: { kind: 'entity', id: 'husk-1' } };
    expect(runScript([apply, apply], world, scripted([]))).toEqual([{ kind: 'condition', id: 'husk-1', condition: 'vulnerable', applied: true }]);
    runScript([{ kind: 'applyCondition', condition: 'corroded', duration: 'permanent', target: { kind: 'entity', id: 'husk-1' } }], world, scripted([]));
    runScript([{ kind: 'applyCondition', condition: 'shaken', duration: 'rest', target: { kind: 'entity', id: 'kara' } }], world, scripted([]));

    // The durations survive a snapshot.
    const copy = new SceneState({ id: 'corridor' }, state.grid);
    copy.restore(state.snapshot());
    expect(copy.entity('husk-1')!.conditionDurations.get('vulnerable')).toBe('temporary');

    expect(copy.clearConditions('scene')).toEqual([{ id: 'husk-1', condition: 'vulnerable' }]);
    expect([...copy.entity('husk-1')!.conditions]).toEqual(['corroded']);
    expect(copy.clearConditions('rest')).toEqual([{ id: 'kara', condition: 'shaken' }]);
    expect([...copy.entity('husk-1')!.conditions]).toEqual(['corroded']);

    expect(runScript([{ kind: 'clearCondition', condition: 'corroded', target: { kind: 'entity', id: 'husk-1' } }], world, scripted([]))).toEqual([
      { kind: 'condition', id: 'husk-1', condition: 'corroded', applied: false },
    ]);
  });

  it('reads pools, the fight, conditions and range as conditions', () => {
    const { world, state } = scene({ fighting: true });
    state.entity('husk-1')!.conditions.add('vulnerable');
    const branch = (when: Extract<Effect, { kind: 'branch' }>['when']): Effect => ({ kind: 'branch', when, then: [{ kind: 'log', text: 'yes' }], otherwise: [{ kind: 'log', text: 'no' }] });
    const says = (effect: Effect, targets: string[] = ['husk-1']): string => {
      const entry = runScript([effect], world, scripted([]), { targets })[0];
      return entry?.kind === 'log' ? entry.text : '?';
    };
    expect(says(branch({ kind: 'inCombat' }))).toBe('yes');
    expect(says(branch({ kind: 'hasCondition', condition: 'vulnerable' }))).toBe('yes');
    expect(says(branch({ kind: 'hasCondition', condition: 'vulnerable' }), ['husk-2'])).toBe('no');
    // Mira has 2 Hope and 6 free Stress slots.
    expect(says(branch({ kind: 'pool', pool: 'hope', op: '>=', value: 2 }))).toBe('yes');
    expect(says(branch({ kind: 'pool', pool: 'hope', op: '>=', value: 3 }))).toBe('no');
    expect(says(branch({ kind: 'pool', pool: 'stress', op: '>=', value: 1 }))).toBe('yes');
    expect(says(branch({ kind: 'pool', pool: 'stress', measure: 'marked', op: '==', value: 0 }))).toBe('yes');
    // husk-1 is Close to Mira, husk-2 Far.
    expect(says(branch({ kind: 'withinRange', range: 'close' }))).toBe('yes');
    expect(says(branch({ kind: 'withinRange', range: 'close' }), ['husk-2'])).toBe('no');
    expect(says(branch({ kind: 'withinRange', range: 'far' }), ['husk-2'])).toBe('yes');
  });
});

describe('an attack from a script', () => {
  const swing: Effect = {
    kind: 'attack',
    onHit: [{ kind: 'push', to: 'close' }, { kind: 'log', text: 'hit' }],
    onMiss: [{ kind: 'log', text: 'miss' }],
  };

  it('rolls the weapon, damages, and runs the hit branch with the target bound', () => {
    const { world, state, scenario, grid } = scene();
    scenario.actorId = 'kara';
    state.moveEntity('kara', grid.indexOf(2, 1)); // adjacent to husk-1 at x=3
    // Hope 10 + Fear 2 + Strength 2 = 14 beats 10; broadsword d8 rolls 6 → 6: Minor.
    const rng = scripted([10, 2, 6]);
    const journal = runScript([swing], world, rng, { targets: ['husk-1'], rollAs: 'actor' });
    expect(journal.find((e) => e.kind === 'attack')).toMatchObject({ attacker: 'kara', target: 'husk-1', hit: true, hitPointsMarked: 1, weapon: 'Broadsword' });
    expect(kinds(journal)).toEqual(['attack', 'hope', 'moved', 'log']);
    expect(journal.find((e) => e.kind === 'log')).toMatchObject({ text: 'hit' });
    // Pushed east from x=3 to the first tile that reads as Close of Kara at x=2: x=5 is taken, so x=4 … no: x=5 blocks, it stops at x=4.
    expect(grid.xOf(state.entity('husk-1')!.tile)).toBe(4);
    expect(state.entity('kara')!.hope!.value).toBe(3);
    expect(rng.drawn()).toBe(3);
  });

  it('runs the miss branch, hands out Fear, and draws no damage dice', () => {
    const { world, state, scenario, grid } = scene();
    scenario.actorId = 'kara';
    state.moveEntity('kara', grid.indexOf(2, 1));
    const rng = scripted([1, 5]);
    const runner = new ScriptRunner(world, rng, { targets: ['husk-1'], rollAs: 'actor' });
    const done = runner.run([swing]);
    expect(kinds(done.journal)).toEqual(['attack', 'fear', 'log']);
    expect(done.journal[2]).toMatchObject({ text: 'miss' });
    expect(rng.drawn()).toBe(2);
    expect(runner.spotlightToGm).toBe(true);
    expect(state.fear.value).toBe(1);
  });

  it('refuses out of reach, before any die', () => {
    const { world, scenario } = scene();
    scenario.actorId = 'kara';
    const rng = scripted([]);
    const journal = runScript([swing], world, rng, { targets: ['husk-2'], rollAs: 'actor' });
    expect(refusals(journal)).toEqual([expect.stringContaining('outOfRange')]);
    expect(rng.drawn()).toBe(0);
  });
});

describe('a reaction roll', () => {
  it('has adversaries roll a d20, then runs failures and successes with their own hit lists', () => {
    const { world, state } = scene();
    const fireball: Effect = {
      kind: 'reactionRoll',
      difficulty: 13,
      targets: { kind: 'target' },
      onFail: [{ kind: 'damage', dice: '10 mag' }],
      onSuccess: [{ kind: 'damage', dice: '10 mag', half: true }],
    };
    // husk-1 rolls 4 and fails; husk-2 rolls 20 and passes.
    const rng = scripted([4, 20]);
    const journal = runScript([fireball], world, rng, { targets: ['husk-1', 'husk-2'] });
    expect(journal.filter((e) => e.kind === 'reaction')).toEqual([
      { kind: 'reaction', id: 'husk-1', success: false, total: 4, difficulty: 13 },
      { kind: 'reaction', id: 'husk-2', success: true, total: 20, difficulty: 13 },
    ]);
    const damage = journal.filter((e) => e.kind === 'damage');
    expect(damage).toEqual([
      expect.objectContaining({ amount: 10, targets: ['husk-1'], marked: 2 }),
      expect.objectContaining({ amount: 5, targets: ['husk-2'], marked: 1 }),
    ]);
    expect(state.entity('husk-1')!.hitPoints.marked).toBe(2);
    expect(state.entity('husk-2')!.hitPoints.marked).toBe(1);
  });

  it('can take its Difficulty from the actor\'s last roll', () => {
    const { world } = scene();
    const chain: Effect = {
      kind: 'check',
      check: {
        trait: 'spellcast',
        difficulty: 'target',
        onSuccessWithHope: [{ kind: 'reactionRoll', difficulty: 'roll', onFail: [{ kind: 'log', text: 'zapped' }] }],
      },
    };
    // 9 + 5 + 2 = 16 with Hope; the husk then needs 16 on a d20 and rolls 15.
    const runner = new ScriptRunner(world, scripted([9, 5, 15]), { targets: ['husk-1'], rollAs: 'actor' });
    runner.run([chain]);
    const done = runner.resume({ kind: 'roll' });
    expect(done.journal.find((e) => e.kind === 'reaction')).toMatchObject({ difficulty: 16, success: false });
    expect(done.journal.some((e) => e.kind === 'log' && e.text === 'zapped')).toBe(true);
  });

  it('has a party member roll their Duality Dice with the named trait, gaining nothing', () => {
    const { world, state } = scene();
    const journal = runScript(
      [{ kind: 'reactionRoll', difficulty: 12, trait: 'strength', targets: { kind: 'entity', id: 'kara' }, onSuccess: [{ kind: 'log', text: 'held' }] }],
      world,
      scripted([6, 4]),
    );
    // 6 + 4 + Strength 2 = 12: a success, and no Hope for a reaction.
    expect(journal[0]).toMatchObject({ kind: 'reaction', id: 'kara', success: true, total: 12 });
    expect(journal[1]).toMatchObject({ kind: 'log', text: 'held' });
    expect(state.entity('kara')!.hope!.value).toBe(2);
  });
});

describe('a push', () => {
  it('moves the target straight away from the actor until the band reads right, and stops at a wall', () => {
    const { world, state, grid } = scene();
    // Mira at x=0 pushes husk-1 (x=3) to Far: the first tile that reads as Far is x=5 — held by husk-2 — so it stops at x=4.
    expect(runScript([{ kind: 'push', to: 'far' }], world, scripted([]), { targets: ['husk-1'] })).toEqual([
      { kind: 'moved', id: 'husk-1', from: grid.indexOf(3, 1), to: grid.indexOf(4, 1) },
    ]);
    // husk-2 from x=5 to Very Far (9+ tiles): x=9.
    runScript([{ kind: 'push', to: 'veryFar' }], world, scripted([]), { targets: ['husk-2'] });
    expect(grid.xOf(state.entity('husk-2')!.tile)).toBe(9);
    // Already there: nothing moves, nothing is journalled.
    expect(runScript([{ kind: 'push', to: 'far' }], world, scripted([]), { targets: ['husk-2'] })).toEqual([]);
  });
});

describe('the shipped cards', () => {
  it("Whirlwind: the same attack roll at everyone else in reach, for half the weapon's own dice", () => {
    const { world, state, scenario, grid } = scene({ content: true });
    scenario.actorId = 'kara';
    state.moveEntity('kara', grid.indexOf(2, 1)); // adjacent to husk-1 at x=3
    state.moveEntity('husk-2', grid.indexOf(4, 1)); // Very Close, not adjacent
    // One roll: Hope 12 + Fear 6 = 18 beats the soft husk's 10 and the tough one's 16.
    // Broadsword d8 rolls 6 on the target (Minor, one Hit Point); the whirl rolls it again, 7, halved to 4 (Minor).
    const rng = scripted([12, 6, 6, 7]);
    const journal = runScript(SRD_ABILITY_MAP.get('whirlwind')!.effects, world, rng, { targets: ['husk-1'], rollAs: 'actor' });
    expect(journal.find((e) => e.kind === 'attack')).toMatchObject({ target: 'husk-1', hit: true, hitPointsMarked: 1 });
    // The roll carries to the *other* husk only, without new dice, Hope or Fear; the damage is the broadsword's, not a fixed die.
    expect(kinds(journal)).toEqual(['attack', 'hope', 'check', 'damage']);
    expect(journal.find((e) => e.kind === 'check')).toMatchObject({ targets: ['husk-2'], hit: ['husk-2'], reused: true, outcome: 'successWithHope' });
    expect(journal.find((e) => e.kind === 'damage')).toMatchObject({ amount: 4, targets: ['husk-2'], dice: '1d8', marked: 1 });
    expect(state.entity('husk-1')!.hitPoints.marked).toBe(1);
    expect(state.entity('husk-2')!.hitPoints.marked).toBe(1);
    expect(state.entity('kara')!.hope!.value).toBe(3);
    expect(rng.drawn()).toBe(4);

    // A roll that beats the target but not the tough husk reaches nobody else, and draws no damage die for it.
    const short = scene({ content: true });
    short.scenario.actorId = 'kara';
    short.state.moveEntity('kara', short.grid.indexOf(2, 1));
    short.state.moveEntity('husk-2', short.grid.indexOf(4, 1));
    const few = scripted([10, 2, 6]);
    const again = runScript(SRD_ABILITY_MAP.get('whirlwind')!.effects, short.world, few, { targets: ['husk-1'], rollAs: 'actor' });
    expect(kinds(again)).toEqual(['attack', 'hope', 'check']);
    expect(again.find((e) => e.kind === 'check')).toMatchObject({ targets: ['husk-2'], hit: [], reused: true, outcome: 'failureWithHope' });
    expect(short.state.entity('husk-2')!.hitPoints.marked).toBe(0);
    expect(few.drawn()).toBe(3);
  });

  it('refuses to reuse a roll nobody made', () => {
    const { world } = scene();
    const journal = runScript(
      [{ kind: 'check', check: { trait: 'strength', difficulty: 10, roll: 'last', onSuccessWithHope: [{ kind: 'log', text: 'no' }] } }],
      world,
      scripted([]),
      { targets: ['husk-1'], rollAs: 'actor' },
    );
    expect(refusals(journal)).toEqual(['no roll to reuse']);
  });

  it('rolls `weapon` damage as whatever the actor carries', () => {
    const { world, state } = scene();
    // Mira's greatstaff: d6 magic. The dice are the weapon's own; Proficiency
    // is applied only when the effect says `using: 'proficiency'`.
    expect(world.weaponDamage('mira')).toMatchObject({ count: 1, sides: 6 });
    expect(world.weaponDamage('kara')).toMatchObject({ count: 1, sides: 8, modifier: 0 });
    expect(world.weaponDamage('husk-1')).toMatchObject({ count: 1, sides: 6, modifier: 2 });
    const journal = runScript([{ kind: 'damage', dice: 'weapon', target: { kind: 'target' } }], world, scripted([4]), { targets: ['husk-1'], rollAs: 'actor' });
    expect(journal.find((e) => e.kind === 'damage')).toMatchObject({ amount: 4, dice: '1d6', targets: ['husk-1'] });
    expect(state.entity('husk-1')!.hitPoints.marked).toBe(1);
  });

  it('Bolt Beacon sends no bolt without a Hope to spend, and one with', () => {
    const bolt = SRD_ABILITY_MAP.get('bolt-beacon')!.effects;
    const empty = scene({ content: true });
    empty.state.entity('mira')!.hope = { max: 6, value: 0 };
    // Hope 3 + Fear 9 + 2 = 14 beats 10, with Fear: a success, but no Hope arrives to pay with.
    const dry = scripted([3, 9]);
    const runner = new ScriptRunner(empty.world, dry, { targets: ['husk-1'], rollAs: 'actor' });
    runner.run(bolt);
    const done = runner.resume({ kind: 'roll' });
    expect(kinds(done.journal)).toEqual(['check', 'fear', 'log']);
    expect(done.journal.find((e) => e.kind === 'log')).toMatchObject({ text: 'No Hope to spend: the bolt never forms.' });
    expect(empty.state.entity('husk-1')!.hitPoints.marked).toBe(0);
    expect(empty.state.entity('husk-1')!.conditions.has('vulnerable')).toBe(false);
    expect(dry.drawn()).toBe(2);

    const lit = scene({ content: true });
    lit.state.entity('mira')!.hope = { max: 6, value: 1 };
    // The same roll; d8 rolls 5, +2 = 7: Major against 7/12, two Hit Points, and Vulnerable.
    const again = new ScriptRunner(lit.world, scripted([3, 9, 5]), { targets: ['husk-1'], rollAs: 'actor' });
    again.run(bolt);
    const journal = again.resume({ kind: 'roll' }).journal;
    expect(journal.find((e) => e.kind === 'damage')).toMatchObject({ amount: 7, marked: 2, targets: ['husk-1'] });
    expect(lit.state.entity('mira')!.hope!.value).toBe(0);
    expect(lit.state.entity('husk-1')!.conditions.has('vulnerable')).toBe(true);
  });
});

describe('conditions that hold a creature', () => {
  it('Asleep stops acting and moving, and ends when damage marks something', () => {
    const { world, state } = scene({ content: true });
    const husk = state.entity('husk-1')!;
    husk.conditions.add('asleep');
    husk.conditionDurations.set('asleep', 'scene');
    expect(world.blocking('husk-1', 'act')).toEqual(['asleep']);
    expect(world.blocks('husk-1', 'move')).toBe(true);
    expect(world.blocks('husk-1', 'reactions')).toBe(false);
    // 8 against 7/12: Major, two Hit Points; the sleeper wakes.
    world.dealDamage('husk-1', { amount: 8, types: ['physical'] }, scripted([]));
    expect(husk.hitPoints.marked).toBe(2);
    expect(husk.conditions.has('asleep')).toBe(false);
  });

  it('Stunned silences damage reactions until it clears', () => {
    const { world, state } = scene({ content: true });
    expect(world.reactionsOf('kara').map((a) => a.id)).toContain('get-back-up');
    state.entity('kara')!.conditions.add('stunned');
    expect(world.blocks('kara', 'act')).toBe(true);
    expect(world.reactionsOf('kara')).toEqual([]);
    world.clearCondition('kara', 'stunned');
    expect(world.reactionsOf('kara').map((a) => a.id)).toContain('get-back-up');
  });

  it('Hidden ends when its bearer attacks', () => {
    const { world, state, scenario, grid } = scene({ content: true });
    const kara = state.entity('kara')!;
    kara.conditions.add('hidden');
    scenario.actorId = 'kara';
    state.moveEntity('kara', grid.indexOf(2, 1));
    // A miss is still an attack: Hope 1 + Fear 2 falls short of 10.
    world.attack({ attacker: 'kara', target: 'husk-1', weapon: 'primary' }, scripted([1, 2]));
    expect(kara.conditions.has('hidden')).toBe(false);
  });
});
