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

describe('a shape aimed at a point', () => {
  /**
   * The corridor is 14x3 with Mira at (0,1), Kara at (1,1), husk-1 at (3,1)
   * and husk-2 at (5,1) - so a line east from Mira runs through all of them,
   * and a creature parked well off that row is a creature the charge misses.
   */
  it('catches everything the line runs through, and leaves the one charging out of it', () => {
    const { world, grid } = scene();
    // Mira is the actor. A path east to (7,1) crosses both husks and Kara.
    const down = { targets: [], hit: [], point: grid.indexOf(7, 1) };
    expect(world.resolveTargets({ kind: 'inPath' }, down)).toEqual(['kara', 'husk-1', 'husk-2']);
    // "All adversaries along that path": the same line, one side of it.
    expect(world.resolveTargets({ kind: 'inPath', side: 'adversaries' }, down)).toEqual(['husk-1', 'husk-2']);
    expect(world.resolveTargets({ kind: 'inPath', side: 'allies' }, down)).toEqual(['kara']);
    // Stopping short catches only what is passed on the way - and the ring
    // around the line counts, so the husk one tile past the end is caught and
    // the one three tiles past it is not.
    expect(world.resolveTargets({ kind: 'inPath', side: 'adversaries' }, { targets: [], hit: [], point: grid.indexOf(2, 1) })).toEqual(['husk-1']);
    // Somebody standing on the spot being run to is in the path.
    expect(world.resolveTargets({ kind: 'inPath', side: 'adversaries' }, { targets: [], hit: [], point: grid.indexOf(3, 1) })).toEqual(['husk-1']);
  });

  it('reaches only as far off the line as it says', () => {
    const { world, grid, state } = scene();
    // Well off the row the charge runs down: Melee is the tiles it crosses and
    // the ring around them, and this is neither.
    state.moveEntity('husk-2', grid.indexOf(12, 0));
    const down = { targets: [], hit: [], point: grid.indexOf(7, 1) };
    expect(world.resolveTargets({ kind: 'inPath', side: 'adversaries' }, down)).toEqual(['husk-1']);
    expect(world.resolveTargets({ kind: 'inPath', side: 'adversaries', range: 'far' }, down)).toEqual(['husk-1', 'husk-2']);
  });

  it('catches nobody when nobody aimed it', () => {
    const { world } = scene();
    expect(world.resolveTargets({ kind: 'inPath' }, { targets: [], hit: [] })).toEqual([]);
    expect(world.resolveTargets({ kind: 'adversaries', range: 'far', around: 'point' }, { targets: [], hit: [] })).toEqual([]);
    expect(world.resolveTargets({ kind: 'allies', around: 'point' }, { targets: [], hit: [] })).toEqual([]);
  });

  it('measures a band from the ground when the card aims at a spot', () => {
    const { world, grid } = scene();
    // A point on husk-2 at (5,1): husk-1 two tiles off is Close, not Melee.
    const at = { targets: [], hit: [], point: grid.indexOf(5, 1) };
    expect(world.resolveTargets({ kind: 'adversaries', range: 'melee', around: 'point' }, at)).toEqual(['husk-2']);
    expect(world.resolveTargets({ kind: 'adversaries', range: 'close', around: 'point' }, at)).toEqual(['husk-1', 'husk-2']);
    // Allies read the same way, and leave the one casting out unless asked.
    const near = { targets: [], hit: [], point: grid.indexOf(1, 1) };
    expect(world.resolveTargets({ kind: 'allies', range: 'melee', around: 'point' }, near)).toEqual(['kara']);
    expect(world.resolveTargets({ kind: 'allies', range: 'melee', around: 'point', includeSelf: true }, near)).toEqual(['kara', 'mira']);
  });

  it("reads 'along that path within your weapon's range' off the weapon", () => {
    const { world, grid, state, scenario } = scene();
    state.moveEntity('husk-2', grid.indexOf(12, 0));
    const down = { targets: [], hit: [], point: grid.indexOf(7, 1) };
    // Mira's greatstaff reaches Very Far, so her path is wide enough to sweep
    // in the husk standing well off it.
    expect(world.weaponRange('mira')).toBe('veryFar');
    expect(world.resolveTargets({ kind: 'inPath', side: 'adversaries', reach: 'weapon' }, down)).toEqual(['husk-1', 'husk-2']);
    // Kara's broadsword reaches Melee, and the same run down the same line
    // catches only what it passes.
    scenario.actorId = 'kara';
    expect(world.weaponRange('kara')).toBe('melee');
    expect(world.resolveTargets({ kind: 'inPath', side: 'adversaries', reach: 'weapon' }, down)).toEqual(['husk-1']);
  });
});

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

describe('the turn handed to the other side', () => {
  /** The corridor, with two more husks further east. */
  const crowd = () => {
    const built = scene();
    built.state.addEntity(createAdversaryEntity('husk-3', 'soft-husk', built.grid.indexOf(7, 1), { hitPoints: 5, stress: 3 }));
    built.state.addEntity(createAdversaryEntity('husk-4', 'soft-husk', built.grid.indexOf(9, 1), { hitPoints: 5, stress: 3 }));
    built.scenario.actorId = 'husk-1';
    return built;
  };

  const called = (journal: readonly JournalEntry[]): { ids: readonly string[]; halfDamage: boolean } =>
    journal.find((e) => e.kind === 'spotlighted') as { ids: readonly string[]; halfDamage: boolean };

  it('calls its own side and never itself', () => {
    const built = crowd();
    const journal = runScript(
      [{ kind: 'spotlight', targets: { kind: 'adversaries', range: 'far' } }],
      built.world,
      scripted([]),
      { rollAs: 'actor' },
    );
    // Everything the selector caught except the one already in the spotlight,
    // and no party member: `adversaries` names a faction, not a side.
    expect([...called(journal).ids].sort()).toEqual(['husk-2', 'husk-3', 'husk-4']);
    expect(called(journal).halfDamage).toBe(false);
  });

  it('takes the nearest when the feature counts them, and rolls that count', () => {
    const built = crowd();
    // "Up to 2d4 allies": one 2, one 1, so three - the three nearest, which in
    // a corridor is the order they stand in.
    const journal = runScript(
      [{ kind: 'spotlight', targets: { kind: 'adversaries', range: 'far' }, count: '2d4', halfDamage: true }],
      built.world,
      scripted([2, 1]),
      { rollAs: 'actor' },
    );
    expect(called(journal).ids).toEqual(['husk-2', 'husk-3', 'husk-4']);
    expect(called(journal).halfDamage).toBe(true);

    const fewer = crowd();
    const two = runScript(
      [{ kind: 'spotlight', targets: { kind: 'adversaries', range: 'far' }, count: '2' }],
      fewer.world,
      scripted([]),
      { rollAs: 'actor' },
    );
    expect(called(two).ids).toEqual(['husk-2', 'husk-3']);
  });

  it('passes over anyone who has already had this turn', () => {
    const built = crowd();
    built.world.spotlightSpent = (id) => id === 'husk-2';
    const journal = runScript(
      [{ kind: 'spotlight', targets: { kind: 'adversaries', range: 'far' }, count: '1' }],
      built.world,
      scripted([]),
      { rollAs: 'actor' },
    );
    // A Leader that could hand the same ally the spotlight twice would be
    // handing out turns for nothing.
    expect(called(journal).ids).toEqual(['husk-3']);
  });

  it('refuses when there is nobody left to call, and draws no dice doing it', () => {
    const built = scene();
    built.scenario.actorId = 'husk-1';
    built.world.spotlightSpent = () => true;
    const rng = scripted([]);
    const journal = runScript(
      [{ kind: 'spotlight', targets: { kind: 'adversaries', range: 'far' }, count: '2d4' }],
      built.world,
      rng,
      { rollAs: 'actor' },
    );
    expect(refusals(journal)[0]).toContain('nobody left to spotlight');
    expect(rng.drawn()).toBe(0);
  });
});

describe('a clock a feature arms', () => {
  it('starts at the value it rolled, owned by whoever armed it', () => {
    const built = scene();
    built.scenario.actorId = 'husk-1';
    const journal = runScript(
      [
        {
          kind: 'countdown',
          countdown: 'ritual',
          name: 'Summoning Ritual',
          start: '6',
          advance: 'hpMarked',
          effects: [{ kind: 'log', text: 'It is done.' }],
        },
      ],
      built.world,
      scripted([]),
      { rollAs: 'actor' },
    );
    expect(journal.find((e) => e.kind === 'countdown')).toMatchObject({ countdown: 'ritual', value: 6 });

    const [running] = built.world.countdowns();
    expect(running).toMatchObject({ id: 'ritual', owner: 'husk-1', value: 6, start: 6, advance: 'hpMarked' });
    // The clock is on the scenario, not the scene: it outlives the turn that
    // armed it, and a save carries it.
    expect(built.scenario.countdowns.get('ritual')).toBe(running);
  });

  it('restarts the one already running under its id rather than keeping two', () => {
    const built = scene();
    built.scenario.actorId = 'husk-1';
    const arm = () =>
      runScript(
        [{ kind: 'countdown', countdown: 'ritual', name: 'Summoning Ritual', start: '4', effects: [] }],
        built.world,
        scripted([]),
        { rollAs: 'actor' },
      );
    arm();
    built.scenario.countdowns.get('ritual')!.value = 1;
    arm();
    expect(built.world.countdowns()).toHaveLength(1);
    expect(built.world.countdowns()[0]!.value).toBe(4);
  });

  it('refuses a length it cannot read', () => {
    const built = scene();
    built.scenario.actorId = 'husk-1';
    const journal = runScript(
      [{ kind: 'countdown', countdown: 'ritual', name: 'Ritual', start: 'soon', effects: [] }],
      built.world,
      scripted([]),
      { rollAs: 'actor' },
    );
    expect(refusals(journal)[0]).toContain('soon');
    expect(built.world.countdowns()).toEqual([]);
  });
});

describe('what a block calls onto the map', () => {
  /** The band a tile stands in, from the one who summoned. */
  const bandOf = (built: ReturnType<typeof scene>, id: string): string => {
    const from = built.state.entity('husk-1')!.tile;
    const to = built.state.entity(id)!.tile;
    const tiles = Math.ceil(built.grid.euclideanDistance(from, to));
    return tiles <= 1 ? 'melee' : tiles <= 2 ? 'veryClose' : tiles <= 4 ? 'close' : tiles <= 8 ? 'far' : 'veryFar';
  };

  it('stands them in the band it named, and gives each one an id of its own', () => {
    const built = scene();
    built.scenario.actorId = 'husk-1';
    const journal = runScript(
      [{ kind: 'summon', adversary: 'soft-husk', count: '2', range: 'far' }],
      built.world,
      scripted([]),
      { rollAs: 'actor' },
    );
    const summoned = journal.find((e) => e.kind === 'summoned') as { ids: readonly string[]; spotlight: boolean };
    expect(summoned.ids).toEqual(['soft-husk-s1', 'soft-husk-s2']);
    expect(summoned.spotlight).toBe(false);
    for (const id of summoned.ids) {
      expect(built.state.entity(id)!.alive).toBe(true);
      expect(bandOf(built, id)).toBe('far');
    }
    // They are adversaries on the map, which is all it takes to be in the
    // fight: nothing keeps a roster.
    expect(built.state.entitiesOf('adversary').map((e) => e.id)).toContain('soft-husk-s1');
  });

  it('multiplies by the party still standing when the text counts PCs', () => {
    const built = scene();
    built.scenario.actorId = 'husk-1';
    // "A number equal to twice the number of PCs": Kara and Mira, so four.
    const journal = runScript(
      [{ kind: 'summon', adversary: 'soft-husk', count: '2', perPc: true, range: 'close' }],
      built.world,
      scripted([]),
      { rollAs: 'actor' },
    );
    expect((journal.find((e) => e.kind === 'summoned') as { ids: readonly string[] }).ids).toHaveLength(4);

    // One of them down, and the next summons counts three.
    const fewer = scene();
    fewer.scenario.actorId = 'husk-1';
    fewer.state.entity('mira')!.alive = false;
    const second = runScript(
      [{ kind: 'summon', adversary: 'soft-husk', count: '2', perPc: true, range: 'close' }],
      fewer.world,
      scripted([]),
      { rollAs: 'actor' },
    );
    expect((second.find((e) => e.kind === 'summoned') as { ids: readonly string[] }).ids).toHaveLength(2);
  });

  it('falls inward rather than summoning nobody, and takes what room there is', () => {
    const built = scene();
    built.scenario.actorId = 'husk-1';
    // More than the Far ring of a corridor can hold: the rest stand closer.
    const journal = runScript(
      [{ kind: 'summon', adversary: 'soft-husk', count: '20', range: 'far' }],
      built.world,
      scripted([]),
      { rollAs: 'actor' },
    );
    const ids = (journal.find((e) => e.kind === 'summoned') as { ids: readonly string[] }).ids;
    expect(ids.length).toBeGreaterThan(4);
    expect(ids.some((id) => bandOf(built, id) !== 'far')).toBe(true);
    // Nobody is standing on anybody.
    const tiles = built.state.entitiesOf('adversary').map((e) => e.tile);
    expect(new Set(tiles).size).toBe(tiles.length);
  });

  it('refuses a stat block nothing ships, and says which', () => {
    const built = scene();
    built.scenario.actorId = 'husk-1';
    const journal = runScript(
      [{ kind: 'summon', adversary: 'unwritten-horror', range: 'close' }],
      built.world,
      scripted([]),
      { rollAs: 'actor' },
    );
    expect(refusals(journal)[0]).toContain('unwritten-horror');
    expect(journal.some((e) => e.kind === 'summoned')).toBe(false);
  });

  it('never reuses the id of something already in the room, fallen or not', () => {
    const built = scene();
    built.scenario.actorId = 'husk-1';
    const first = runScript([{ kind: 'summon', adversary: 'soft-husk', range: 'close' }], built.world, scripted([]), {
      rollAs: 'actor',
    });
    const one = (first.find((e) => e.kind === 'summoned') as { ids: readonly string[] }).ids[0]!;
    built.state.entity(one)!.alive = false;

    const second = runScript([{ kind: 'summon', adversary: 'soft-husk', range: 'close' }], built.world, scripted([]), {
      rollAs: 'actor',
    });
    const two = (second.find((e) => e.kind === 'summoned') as { ids: readonly string[] }).ids[0]!;
    // A corpse is still an entity, so its name is not handed to the next one.
    expect(two).not.toBe(one);
  });
});

describe('a swarm that piles in', () => {
  /**
   * "Spend a Fear to choose a target and spotlight all Giant Rats within Close
   * range of them. Those Minions move into Melee range of the target and make
   * one shared attack roll. On a success, they deal N damage each. Combine
   * this damage."
   */
  const swarm: Effect[] = [
    {
      kind: 'attack',
      target: { kind: 'entity', id: 'kara' },
      joinedBy: { kind: 'adversaries', range: 'close', around: 'target', sameKind: true },
    },
  ];

  /**
   * The corridor with more of husk-1's kind loose in it, and Kara a step
   * further in so there is a free tile on every side of her: eight creatures
   * can stand beside anyone, a diagonal being as close as a side.
   *
   * Armor is left alone here so the arithmetic is the swarm's: Kara's
   * thresholds are 8/16, and each husk deals 1d6+2.
   */
  function rats(where: readonly [number, number][]) {
    const built = scene({ armor: 'never' });
    built.state.moveEntity('kara', built.grid.indexOf(2, 1));
    let n = 2;
    for (const [x, y] of where) {
      built.state.addEntity(
        createAdversaryEntity(`rat-${++n}`, 'soft-husk', built.grid.indexOf(x, y), { hitPoints: 5, stress: 3 }),
      );
    }
    built.scenario.actorId = 'husk-1';
    return built;
  }

  const beside = (built: ReturnType<typeof rats>, id: string): boolean =>
    built.grid.chebyshevDistance(built.state.entity(id)!.tile, built.state.entity('kara')!.tile) <= 1;

  it('walks its own kind into reach, swings once, and counts the damage for each', () => {
    const built = rats([[4, 0], [4, 2], [5, 2]]);
    // One d20 for the swing, then the damage: four husks at 1d6+2 each is
    // 4d6+8, so four dice come off the stream rather than one.
    const rng = scripted([18, 3, 3, 3, 3]);
    const journal = runScript(swarm, built.world, rng, { rollAs: 'actor', targets: ['kara'] });
    expect(journal.find((e) => e.kind === 'attack')).toMatchObject({
      hit: true,
      joined: ['rat-3', 'rat-4', 'rat-5'],
    });
    expect(rng.drawn()).toBe(5);
    for (const id of ['husk-1', 'rat-3', 'rat-4', 'rat-5']) expect(beside(built, id)).toBe(true);
    // 12 + 8 is 20: Severe, three Hit Points, where one husk's 3 + 2 is Minor.
    expect(built.state.entity('kara')!.hitPoints.marked).toBe(3);
  });

  it('leaves out the one that cannot move, and the kind that is not its own', () => {
    const built = rats([[4, 0], [4, 2]]);
    // Restrained: it cannot walk in, so it does not swing.
    built.state.entity('rat-3')!.conditions.add('restrained');
    // The tough husk is a different block, so "all Giant Rats" never named it,
    // even standing right here.
    built.state.moveEntity('husk-2', built.grid.indexOf(3, 0));

    const journal = runScript(swarm, built.world, scripted([18, 3, 3]), { rollAs: 'actor', targets: ['kara'] });
    expect(journal.find((e) => e.kind === 'attack')).toMatchObject({ joined: ['rat-4'] });
    // Two husks at 1d6+2: 3 + 3 + 4 is 10, Major rather than Severe.
    expect(built.state.entity('kara')!.hitPoints.marked).toBe(2);
  });

  it('takes no more than can get there', () => {
    // Six of them. Kara has seven free tiles round her with husk-1 on the
    // eighth, but the two on her far side are past a Close-range walk for the
    // last rat in the corridor, which stops short.
    const built = rats([[4, 0], [4, 2], [5, 2], [5, 0], [6, 1], [6, 0]]);
    const journal = runScript(swarm, built.world, scripted([18, 3, 3, 3, 3, 3, 3]), { rollAs: 'actor', targets: ['kara'] });
    const attack = journal.find((e) => e.kind === 'attack') as { joined?: readonly string[] };
    expect(attack.joined).toHaveLength(5);
    // The one who could not get there is still out in the corridor.
    expect(beside(built, 'rat-8')).toBe(false);
    expect(built.state.entity('rat-8')!.tile).not.toBe(built.grid.indexOf(6, 0));
  });

  it('is a plain swing when nobody else is near', () => {
    const built = rats([]);
    const journal = runScript(swarm, built.world, scripted([18, 3]), { rollAs: 'actor', targets: ['kara'] });
    const attack = journal.find((e) => e.kind === 'attack');
    expect(attack).toMatchObject({ hit: true });
    expect(attack).not.toHaveProperty('joined');
    expect(built.state.entity('kara')!.hitPoints.marked).toBe(1);
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

  /**
   * "All rolls targeting you" and "any rolls against you" are not sentences
   * about swings, so a Spellcast Roll reads them the way an attack does. The
   * shape here is the one most spells print: a fixed Difficulty and whoever
   * the caster picked.
   */
  describe('reads the creatures it is aimed at', () => {
    const bolt13: Effect = { kind: 'check', check: { trait: 'spellcast', difficulty: 13 } };

    /** The roll's total and the signed advantage die that went into it. */
    const cast = (
      world: SceneScriptWorld,
      faces: number[],
      targets: string[],
    ): { total: number; advantageDie: number; drawn: number } => {
      const rng = scripted(faces);
      const runner = new ScriptRunner(world, rng, { targets, rollAs: 'actor' });
      runner.run([bolt13]);
      const done = runner.resume({ kind: 'roll' });
      const check = done.journal.find((e) => e.kind === 'check');
      if (check?.kind !== 'check') throw new Error('no check');
      return { total: check.roll.total, advantageDie: check.roll.advantageDie, drawn: rng.drawn() };
    };

    it('takes advantage against a Vulnerable target, and rolls no d6 without one', () => {
      const { world, state } = scene();
      // Hope 5 + Fear 4 + Knowledge 2 = 11, short of 13: no die drawn for it.
      expect(cast(world, [5, 4], ['husk-1'])).toMatchObject({ total: 11, advantageDie: 0, drawn: 2 });
      state.entity('husk-1')!.conditions.add('vulnerable');
      // The same dice, plus a d6 of 3: 14, and the bolt lands.
      expect(cast(world, [5, 4, 3], ['husk-1'])).toMatchObject({ total: 14, advantageDie: 3, drawn: 3 });
    });

    it('takes disadvantage against a Hidden one', () => {
      const { world, state } = scene();
      state.entity('husk-1')!.conditions.add('hidden');
      expect(cast(world, [5, 4, 3], ['husk-1'])).toMatchObject({ total: 8, advantageDie: -3, drawn: 3 });
    });

    it('cancels one against the other, and reads the best and the worst of a group', () => {
      const { world, state } = scene();
      state.entity('husk-1')!.conditions.add('vulnerable');
      // A roll that names a Vulnerable creature does target them, so it keeps
      // the die even with a plain creature beside them.
      expect(cast(world, [5, 4, 3], ['husk-1', 'husk-2'])).toMatchObject({ total: 14, advantageDie: 3 });
      // One Hidden creature in the group costs it, and nothing is rolled.
      state.entity('husk-2')!.conditions.add('hidden');
      expect(cast(world, [5, 4], ['husk-1', 'husk-2'])).toMatchObject({ total: 11, advantageDie: 0, drawn: 2 });
    });

    it('tells "all rolls targeting you" from "attack rolls targeting you"', () => {
      const { world, state } = scene({ content: true });
      // Horrified is the SRD's Vulnerable in another name: a check reads it.
      state.entity('husk-1')!.conditions.add('horrified');
      expect(cast(world, [5, 4, 3], ['husk-1'])).toMatchObject({ total: 14, advantageDie: 3 });
      // In Shadow says attack rolls, and a Spellcast Roll is not one.
      state.entity('husk-1')!.conditions.delete('horrified');
      state.entity('husk-1')!.conditions.add('in-shadow');
      expect(cast(world, [5, 4], ['husk-1'])).toMatchObject({ total: 11, advantageDie: 0, drawn: 2 });
    });

    it('counts nothing for a check made on a door', () => {
      const { world } = scene();
      // An interactable's check binds its own id as the target; it is not a
      // creature, and reading scales off it must neither throw nor draw a die.
      expect(cast(world, [5, 4], ['vault-door'])).toMatchObject({ total: 11, advantageDie: 0, drawn: 2 });
    });
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

  /**
   * A stat block prints one reach for its claws, and its features say their
   * own — "make an attack against all targets within Close range" from a
   * creature that swings at Melee. The feature's reach wins.
   */
  it('reaches as far as the feature says, not as far as the block does', () => {
    const { world, scenario } = scene();
    scenario.actorId = 'husk-1';
    const at = (effect: Effect) =>
      runScript([effect], world, scripted([12, 4]), { targets: ['kara'], rollAs: 'actor' });
    // Kara stands at Very Close; the husk's claws are a Melee weapon.
    expect(at({ kind: 'attack' }).filter((e) => e.kind === 'refused').map((e) => e.reason)).toEqual([
      expect.stringContaining('outOfRange'),
    ]);
    const reached = at({ kind: 'attack', range: 'veryClose' });
    expect(reached.filter((e) => e.kind === 'refused')).toEqual([]);
    expect(reached.find((e) => e.kind === 'attack')).toMatchObject({ target: 'kara', hit: true });
  });

  it('goes through armor when the feature says direct, and lands once', () => {
    const { world, state, scenario } = scene();
    scenario.actorId = 'husk-1';
    const kara = state.entity('kara')!;
    const armorBefore = kara.armorSlots.marked;
    // 12 + 4 beats Kara's Evasion; the damage is stated, so no die is rolled for it.
    const journal = runScript(
      [{ kind: 'attack', range: 'veryClose', damage: '20 phy', direct: true }],
      world,
      scripted([12, 4]),
      { targets: ['kara'], rollAs: 'actor' },
    );
    expect(journal.filter((e) => e.kind === 'attack').length).toBe(1);
    // Nothing else dealt damage after it: an attack pays out once.
    expect(journal.filter((e) => e.kind === 'damage')).toEqual([]);
    // And no Armor Slot answered it.
    expect(state.entity('kara')!.armorSlots.marked).toBe(armorBefore);
    expect(state.entity('kara')!.hitPoints.marked).toBeGreaterThan(0);
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

  /**
   * "Targets who fail take 4d6+5 physical damage; targets who succeed take
   * half damage" is how nearly every area attack in the SRD is written, so the
   * damage is rolled once, before anyone rolls to avoid it.
   */
  it('rolls its damage once, up front, and halves that same number for the ones who made it', () => {
    const { world } = scene();
    const blast: Effect = {
      kind: 'reactionRoll',
      difficulty: 13,
      targets: { kind: 'target' },
      damage: { dice: '2d6+1', type: 'physical' },
      onFail: [{ kind: 'damage', dice: 'same' }],
      onSuccess: [{ kind: 'damage', dice: 'same', half: true }],
    };
    // 5 and 4 make the damage 10; husk-1 then rolls 4 and fails, husk-2 rolls 20.
    const rng = scripted([5, 4, 4, 20]);
    const journal = runScript([blast], world, rng, { targets: ['husk-1', 'husk-2'] });
    expect(journal.filter((e) => e.kind === 'damage')).toEqual([
      expect.objectContaining({ amount: 10, targets: ['husk-1'], dice: '2d6+1' }),
      expect.objectContaining({ amount: 5, targets: ['husk-2'], dice: '2d6+1' }),
    ]);
    // Two dice for the damage and one per creature dodging: no second roll.
    expect(rng.drawn()).toBe(4);
  });

  it('still has something to halve when nobody failed', () => {
    const { world, state } = scene();
    const blast: Effect = {
      kind: 'reactionRoll',
      difficulty: 13,
      targets: { kind: 'target' },
      damage: { dice: '2d6+1', type: 'physical' },
      onFail: [{ kind: 'damage', dice: 'same' }],
      onSuccess: [{ kind: 'damage', dice: 'same', half: true }],
    };
    const journal = runScript([blast], world, scripted([5, 4, 20, 20]), { targets: ['husk-1', 'husk-2'] });
    expect(refusals(journal)).toEqual([]);
    expect(journal.filter((e) => e.kind === 'damage')).toEqual([
      expect.objectContaining({ amount: 5, targets: ['husk-1', 'husk-2'] }),
    ]);
    expect(state.entity('husk-1')!.hitPoints.marked).toBe(1);
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

describe('a creature that shrugs damage off', () => {
  /** The husk's stat block, with a passive that halves what it is made of. */
  const bones = {
    id: 'only-bones',
    name: 'Only Bones',
    source: { kind: 'adversary' as const, adversaries: ['soft-husk'] },
    text: 'The husk is resistant to physical damage.',
    kind: 'passive' as const,
    action: false,
    defenses: { resistances: ['physical' as const] },
  };

  it("halves a script's damage, rounding up, and leaves the other type alone", () => {
    // 12 physical is Severe on 7/12 and marks 3 Hit Points; halved to 6 it is
    // Minor and marks one.
    const plain = scene();
    runScript([{ kind: 'damage', dice: '12 phy', target: { kind: 'entity', id: 'husk-1' } }], plain.world, scripted([]));
    expect(plain.state.entity('husk-1')!.hitPoints.marked).toBe(3);

    const heavy = scene({ abilities: [bones] });
    runScript([{ kind: 'damage', dice: '12 phy', target: { kind: 'entity', id: 'husk-1' } }], heavy.world, scripted([]));
    expect(heavy.state.entity('husk-1')!.hitPoints.marked).toBe(1);
    // The same magic damage is not resisted at all.
    const magic = scene({ abilities: [bones] });
    runScript([{ kind: 'damage', dice: '12 mag', target: { kind: 'entity', id: 'husk-1' } }], magic.world, scripted([]));
    expect(magic.state.entity('husk-1')!.hitPoints.marked).toBe(3);
  });

  it('halves a weapon swing too, on the attack path', () => {
    const resisting = scene({ abilities: [bones] });
    resisting.scenario.actorId = 'kara';
    resisting.state.moveEntity('kara', resisting.grid.indexOf(2, 1));
    // A stated 12 physical: Severe without the passive, Minor with it.
    const journal = runScript(
      [{ kind: 'attack', damage: '12 phy', target: { kind: 'entity', id: 'husk-1' } }],
      resisting.world,
      scripted([10, 2]),
      { rollAs: 'actor' },
    );
    expect(journal.find((e) => e.kind === 'attack')).toMatchObject({ hit: true, hitPointsMarked: 1 });
  });

  it('reads a condition as well as a passive, and never halves twice', () => {
    const { world, state } = scene({ abilities: [bones] });
    state.entity('husk-1')!.conditions.add('rooted');
    expect(world.defensesOf('husk-1')).toEqual({ resistances: ['physical'] });
    runScript([{ kind: 'damage', dice: '12 phy', target: { kind: 'entity', id: 'husk-1' } }], world, scripted([]));
    expect(state.entity('husk-1')!.hitPoints.marked).toBe(1);
  });
});

describe('a creature that takes a number off the damage', () => {
  /** "When the husk takes physical damage, reduce it by 3." */
  const plate = {
    id: 'thick-hide',
    name: 'Thick Hide',
    source: { kind: 'adversary' as const, adversaries: ['soft-husk'] },
    text: 'When the husk takes physical damage, reduce it by 3.',
    kind: 'passive' as const,
    action: false,
    defenses: { reduce: [{ dice: '3', only: 'physical' as const }] },
  };
  /** And the kind that is rolled: "reduce it by 1d10". */
  const rolled = { ...plate, id: 'unreal-form', defenses: { reduce: [{ dice: '1d10' }] } };

  it("takes it off a script's damage, and says so in the log", () => {
    // 12 physical is Severe on 7/12 and marks 3; 3 off leaves 9, which is
    // Major, and marks 2.
    const { world, state } = scene({ abilities: [plate] });
    const journal = runScript(
      [{ kind: 'damage', dice: '12 phy', target: { kind: 'entity', id: 'husk-1' } }],
      world,
      scripted([]),
    );
    expect(state.entity('husk-1')!.hitPoints.marked).toBe(2);
    expect(journal.find((e) => e.kind === 'damage')).toMatchObject({ marked: 2, reduced: 3 });
    // Magic is not what this hide answers.
    const magic = scene({ abilities: [plate] });
    runScript([{ kind: 'damage', dice: '12 mag', target: { kind: 'entity', id: 'husk-1' } }], magic.world, scripted([]));
    expect(magic.state.entity('husk-1')!.hitPoints.marked).toBe(3);
  });

  it('rolls the dice kind once for a swing, on the attack path', () => {
    const swung = scene({ abilities: [rolled] });
    swung.scenario.actorId = 'kara';
    swung.state.moveEntity('kara', swung.grid.indexOf(2, 1));
    // Two dice for the attack roll, then one d10 for the hide. A second roll
    // would run the scripted stream out and throw.
    const journal = runScript(
      [{ kind: 'attack', damage: '12 phy', target: { kind: 'entity', id: 'husk-1' } }],
      swung.world,
      scripted([10, 2, 6]),
      { rollAs: 'actor' },
    );
    // 12 less the 6 it rolled is 6: Minor on 7/12, where 12 was Severe.
    expect(journal.find((e) => e.kind === 'attack')).toMatchObject({ hit: true, hitPointsMarked: 1, reduced: 6 });
  });
});

describe("a passive printed on a stat block", () => {
  it('changes the numbers on the block, the way a card changes a sheet', () => {
    const wary = {
      id: 'wary',
      name: 'Wary',
      source: { kind: 'adversary' as const, adversaries: ['soft-husk'] },
      text: 'The husk is hard to catch.',
      kind: 'passive' as const,
      action: false,
      modifiers: [{ stat: 'evasion' as const, bonus: 5 }],
    };
    // The soft husk's Difficulty is 10; the passive makes it 15.
    expect(scene().world.difficultyOf('husk-1')).toBe(10);
    expect(scene({ abilities: [wary] }).world.difficultyOf('husk-1')).toBe(15);
  });
});

describe('Hope taken rather than spent', () => {
  it('takes what is there and no more, and a creature with none is untouched', () => {
    const { world, state } = scene();
    // Kara has 2 Hope; the husk has none at all.
    const journal = runScript(
      [
        { kind: 'loseHope', amount: 3, target: { kind: 'entity', id: 'kara' } },
        { kind: 'loseHope', target: { kind: 'entity', id: 'husk-1' } },
      ],
      world,
      scripted([]),
    );
    expect(state.entity('kara')!.hope!.value).toBe(0);
    // Only the loss that happened is journalled: no line for the husk.
    expect(journal).toEqual([{ kind: 'hopeLost', lost: 2, id: 'kara' }]);
  });
});

describe('a walk', () => {
  it('carries the line the creature crossed, from where it stood to where it stands', () => {
    const { world, state, grid } = scene();
    // Mira (0,1) closes on husk-2 (5,1), round Kara and husk-1 in the row.
    const journal = runScript([{ kind: 'move', how: 'toward', range: 'melee' }], world, scripted([]), {
      targets: ['husk-2'],
      rollAs: 'actor',
    });
    const moved = journal.find((e) => e.kind === 'moved') as { walked?: boolean; to: number; route?: readonly { x: number; y: number }[] };
    expect(moved.walked).toBe(true);
    expect(moved.to).toBe(state.entity('mira')!.tile);
    expect(moved.route).toBeDefined();
    expect(moved.route![0]).toEqual({ x: 0, y: 1 });
    expect(moved.route!.at(-1)).toEqual(grid.spotOf(moved.to));
    expect(moved.route!.length).toBeGreaterThanOrEqual(2);
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

describe("damage that carries the roll over", () => {
  it('deals the same total again, halves it when asked, and refuses when nothing has been rolled', () => {
    const { world, state, scenario, grid } = scene();
    scenario.actorId = 'kara';
    state.moveEntity('kara', grid.indexOf(2, 1));

    // Nothing rolled yet: the script says so rather than inventing a number.
    expect(refusals(runScript([{ kind: 'damage', dice: 'same' }], world, scripted([]), { targets: ['husk-1'] })))
      .toEqual(['no damage to carry over']);

    // 2d6 rolls 4 and 4: eight to the first target, then the same eight again,
    // then half of it — off the one roll, with no further dice drawn.
    const rng = scripted([4, 4]);
    const journal = runScript(
      [
        { kind: 'damage', dice: '2d6', type: 'physical', target: { kind: 'entities', ids: ['husk-1'] } },
        { kind: 'damage', dice: 'same', type: 'physical', target: { kind: 'entities', ids: ['husk-2'] } },
        { kind: 'damage', dice: 'same', half: true, type: 'physical', target: { kind: 'entities', ids: ['husk-2'] } },
      ],
      world,
      rng,
    );
    expect(journal.filter((e) => e.kind === 'damage')).toMatchObject([
      { amount: 8, targets: ['husk-1'], dice: '2d6' },
      { amount: 8, targets: ['husk-2'], dice: '2d6' },
      { amount: 4, targets: ['husk-2'], dice: '2d6' },
    ]);
    expect(rng.drawn()).toBe(2);
  });
});

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

describe('a hook in a script', () => {
  it('queues effects that journal like any other, right where it sits', () => {
    const { world, state } = scene({
      code: [
        {
          id: 'scorch',
          source: `ctx.log('the air catches');
ctx.queue([{ kind: 'damage', amount: ctx.args.amount, target: { kind: 'entities', ids: ctx.select({ kind: 'adversaries', range: 'far' }) } }]);`,
        },
      ],
    });
    const journal = runScript(
      [{ kind: 'run', hook: 'scorch', args: { amount: 3 } }, { kind: 'log', text: 'and then the door' }],
      world,
      scripted([]),
      { rollAs: 'actor' },
    );
    // The hook's own effects run before what follows it, and each is journalled.
    expect(kinds(journal)).toEqual(['log', 'damage', 'log']);
    expect(journal.map((e) => (e.kind === 'log' ? e.text : ''))).toEqual(['the air catches', '', 'and then the door']);
    expect(journal.find((e) => e.kind === 'damage')).toMatchObject({ amount: 3 });
    // Flat damage, straight to the Hit Points, on both husks the selector named.
    expect(state.entity('husk-1')!.hitPoints.marked).toBe(3);
    expect(state.entity('husk-2')!.hitPoints.marked).toBe(3);
  });

  it('refuses a hook nobody defined, and one that throws, without drawing dice', () => {
    const { world } = scene({ code: [{ id: 'angry', source: 'throw new Error("the runes are wrong");' }] });
    const rng = scripted([]);
    const journal = runScript([{ kind: 'run', hook: 'missing' }, { kind: 'run', hook: 'angry' }], world, rng, { rollAs: 'actor' });
    expect(refusals(journal)).toEqual(['no hook named "missing"', 'hook "angry" failed: the runes are wrong']);
    expect(rng.drawn()).toBe(0);
  });

  it('rolls a hook\'s dice off the scenario stream, in order', () => {
    const { world } = scene({
      code: [{ id: 'sparks', source: "ctx.queue([{ kind: 'damage', amount: ctx.rng.die(6) + ctx.rng.die(6), target: { kind: 'target' } }]);" }],
    });
    const rng = scripted([2, 5]);
    const journal = runScript([{ kind: 'run', hook: 'sparks' }], world, rng, { targets: ['husk-1'], rollAs: 'actor' });
    expect(journal.find((e) => e.kind === 'damage')).toMatchObject({ amount: 7 });
    expect(rng.drawn()).toBe(2);
  });

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
