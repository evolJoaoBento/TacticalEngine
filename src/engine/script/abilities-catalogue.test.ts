import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Rng } from '../core/rng';
import { TileGrid } from '../grid/grid';
import { SceneState, createAdversaryEntity, createPartyEntity } from '../scene/state';
import { importContentPack } from '../content/pack/import';
import type { AdversaryDef } from '../content/types';
import { blankSheet, deriveCharacter, startingPools, type DerivedCharacter } from '../character/sheet';
import { ScriptRunner, runScript, type JournalEntry } from './runner';
import { SceneScriptWorld, createScenarioState } from './world';
import type { Effect } from './schema';
import { SRD_ABILITIES, SRD_ABILITY_MAP } from '../content/srd/abilities';
import { SRD_HOOKS } from '../content/srd/hooks';
import { SRD_CONDITIONS } from '../content/conditions';
import { abilitySchema } from '../content/abilities';
import { compileHooks, mergeHooks } from './hooks';

/**
 * The combat half of the script vocabulary: what lets a domain card be a
 * script. Every rule here is one the SRD states — one roll against many
 * targets, damage rolled once and applied to each, a critical's maximum dice,
 * Stress overflowing into a Hit Point, a reaction roll as a d20 for an
 * adversary — and every refusal draws no dice, so a replay stays in step.
 */

/**
 * The vendored catalogue's cards, played.
 *
 * Four assertions about particular shipped cards: Whirlwind reusing one attack roll, Bolt
 * Beacon needing a Hope to spend, Arcane Barrage building its options from the Hope actually
 * held, and Wild Flame capping at three adversaries. None is about the script vocabulary --
 * that is `abilities.test.ts`, which reads the pack the app ships.
 *
 * **This file is deleted with the catalogue**, which is why it carries its own copy of the
 * harness rather than sharing one: the duplication lasts exactly as long as the four tests do.
 */

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const read = (name: string): unknown[] =>
  JSON.parse(readFileSync(`${repoRoot}tools/srd-sources/daggersearch/core/${name}.json`, 'utf8'));
const content = importContentPack({
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
function scene(
  options: {
    fighting?: boolean;
    armor?: 'auto' | 'never';
    content?: boolean;
    code?: { id: string; source: string }[];
    /** Extra abilities the world knows about — a stat block's passive, say. */
    abilities?: unknown[];
  } = {},
) {
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
    ...(options.abilities === undefined ? {} : { abilities: options.abilities.map((a) => abilitySchema.parse(a)) }),
    ...(options.abilities === undefined ? {} : { conditionDefs: SRD_CONDITIONS }),
    hooks: mergeHooks(SRD_HOOKS, compileHooks((options.code ?? []).map((c) => ({ ...c, name: c.id }))).hooks),
  });
  return { grid, state, scenario, world, characters };
}

const kinds = (journal: readonly JournalEntry[]): string[] => journal.map((e) => e.kind);
const refusals = (journal: readonly JournalEntry[]): string[] =>
  journal.filter((e): e is Extract<JournalEntry, { kind: 'refused' }> => e.kind === 'refused').map((e) => e.reason);

describe('the shipped cards', () => {
  it('Whirlwind: the same attack roll at everyone else in reach, for half the damage it already dealt', () => {
    const { world, state, scenario, grid } = scene({ content: true });
    scenario.actorId = 'kara';
    state.moveEntity('kara', grid.indexOf(2, 1)); // adjacent to husk-1 at x=3
    state.moveEntity('husk-2', grid.indexOf(4, 1)); // Very Close, not adjacent
    // One roll: Hope 12 + Fear 6 = 18 beats the soft husk's 10 and the tough one's 16.
    // Broadsword d8 rolls 6 on the target (Minor, one Hit Point); the whirl carries
    // that same 6 over, halved to 3 — it does not roll the dice a second time.
    const rng = scripted([12, 6, 6]);
    const journal = runScript(SRD_ABILITY_MAP.get('whirlwind')!.effects, world, rng, { targets: ['husk-1'], rollAs: 'actor' });
    expect(journal.find((e) => e.kind === 'attack')).toMatchObject({ target: 'husk-1', hit: true, hitPointsMarked: 1 });
    // The roll carries to the *other* husk only, without new dice, Hope or Fear; the damage is the broadsword's, not a fixed die.
    expect(kinds(journal)).toEqual(['attack', 'hope', 'check', 'damage']);
    expect(journal.find((e) => e.kind === 'check')).toMatchObject({ targets: ['husk-2'], hit: ['husk-2'], reused: true, outcome: 'successWithHope' });
    expect(journal.find((e) => e.kind === 'damage')).toMatchObject({ amount: 3, targets: ['husk-2'], dice: '1d8', marked: 1 });
    expect(state.entity('husk-1')!.hitPoints.marked).toBe(1);
    expect(state.entity('husk-2')!.hitPoints.marked).toBe(1);
    expect(state.entity('kara')!.hope!.value).toBe(3);
    // Two duality dice and one damage die: no second damage roll for the whirl.
    expect(rng.drawn()).toBe(3);

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

describe('a hook in a script, on shipped cards', () => {
  it('builds Arcane Barrage\'s options from the Hope actually held', () => {
    const { world, state } = scene({ content: true });
    state.entity('mira')!.hope = { max: 6, value: 4 };
    const rng = scripted([5, 5, 5, 5]);
    const runner = new ScriptRunner(world, rng, { targets: ['husk-1'], rollAs: 'actor' });
    const waiting = runner.run(SRD_ABILITY_MAP.get('book-of-illiat-arcane-barrage')!.effects);
    if (waiting.status !== 'waiting' || waiting.prompt.kind !== 'choice') throw new Error('expected a choice');
    expect(waiting.prompt.options.map((o) => o.label)).toEqual([
      '1 Hope: 1d6 magic',
      '2 Hope: 2d6 magic',
      '3 Hope: 3d6 magic',
      '4 Hope: 4d6 magic',
    ]);
    // Four d6 of 5 is 20: Severe against 7/12, three Hit Points, and the Hope is gone.
    const done = runner.resume({ kind: 'choose', index: 3 });
    expect(done.journal.find((e) => e.kind === 'damage')).toMatchObject({ amount: 20, marked: 3, dice: '4d6' });
    expect(state.entity('mira')!.hope!.value).toBe(0);
    expect(rng.drawn()).toBe(4);
  });

  it('caps Wild Flame at three adversaries in reach', () => {
    const { world, state, grid, scenario } = scene({ content: true });
    scenario.actorId = 'mira';
    state.moveEntity('mira', grid.indexOf(4, 1));
    state.addEntity(createAdversaryEntity('husk-3', 'soft-husk', grid.indexOf(4, 0), { hitPoints: 5, stress: 3 }));
    state.addEntity(createAdversaryEntity('husk-4', 'soft-husk', grid.indexOf(4, 2), { hitPoints: 5, stress: 3 }));
    state.moveEntity('husk-1', grid.indexOf(3, 1));
    const runner = new ScriptRunner(world, scripted([]), { rollAs: 'actor' });
    const waiting = runner.run(SRD_ABILITY_MAP.get('book-of-tyfar-wild-flame')!.effects);
    if (waiting.status !== 'waiting' || waiting.prompt.kind !== 'check') throw new Error('expected a check');
    expect(waiting.prompt.targets).toHaveLength(3);
  });
});
