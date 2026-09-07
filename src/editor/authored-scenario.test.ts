import { describe, it, expect } from 'vitest';
import { blankScene } from '../engine/scene/grid-from-scene';
import { encounterSchema, interactableSchema, projectSchema, sceneSchema } from '../engine/scene/schema';
import { itemSchema, lootTableSchema } from '../engine/content/items';
import { abilitySchema } from '../engine/content/abilities';
import { blankSheet } from '../engine/character/sheet';
import { characterSheetSchema } from '../engine/character/sheet-schema';
import {
  EditorSession,
  addAdversary,
  addEncounter,
  addInteractable,
  addItem,
  addLootTable,
  addSheet,
  setSpawns,
  toggleTriggerCell,
  updateInteractable,
  updateSheet,
} from './session';
import { validateProject } from './validate';
import {
  attackWithSelected,
  answerPending,
  buildProjectScene,
  endTurn,
  moveSelectedTo,
  settleFight,
  startEncounter,
  useSelectedOn,
} from '../game/demo-scene';

/**
 * The question `docs/CRPG-GAPS.md` exists to answer: could someone build a
 * small BG3-like scenario with this and no engine code?
 *
 * This is that question as a test. Nothing here reaches for the demo's
 * literals — no map, no party, no chest. A blank project is built up with the
 * same session edits the editor's panels run, checked with the same validator
 * the **Check** button runs, and then *played*: walk up to a locked door, be
 * refused, open a chest for the key it wanted, and swing at what is waiting.
 *
 * If any step of that ever needs something the editor cannot write, this test
 * is where it will show.
 */

const KARA = characterSheetSchema.parse(
  blankSheet('kara', 'guardian', {
    name: 'Kara',
    traits: { agility: 0, strength: 2, finesse: 1, instinct: 1, presence: 0, knowledge: -1 },
    ancestryId: 'human',
    armorId: 'chainmail-armor',
    primaryWeaponId: 'broadsword',
    subclassId: 'stalwart',
    domainCards: ['bare-bones', 'get-back-up'],
  }),
);

/** A blank project with one empty room, which is where a designer starts. */
function blank(): EditorSession {
  return new EditorSession(
    projectSchema.parse({
      id: 'authored',
      name: 'Authored',
      scenes: [sceneSchema.parse({ ...blankScene('hall', 12, 8), spawns: [{ x: 1, y: 4 }] })],
      startScene: 'hall',
    }),
  );
}

/** Every edit the panels would run, in the order a designer would run them. */
function author(): EditorSession {
  const s = blank();

  // The party.
  s.run(addSheet(KARA));

  // What they can carry, and what a chest gives them.
  s.run(addItem(itemSchema.parse({ id: 'iron-key', name: 'An iron key', kind: 'key', stackable: false })));
  s.run(addLootTable(lootTableSchema.parse({ id: 'strongbox', entries: [{ item: 'iron-key' }] })));

  // A chest that pays out, and a door that wants what it pays.
  s.run(
    addInteractable(
      'hall',
      interactableSchema.parse({
        id: 'strongbox',
        kind: 'chest',
        position: { x: 3, y: 4 },
        name: 'A strongbox',
        effects: [
          { kind: 'log', text: 'The lid gives.' },
          { kind: 'loot', table: 'strongbox' },
          { kind: 'open' },
        ],
      }),
    ),
  );
  s.run(
    addInteractable(
      'hall',
      interactableSchema.parse({
        id: 'iron-door',
        kind: 'door',
        position: { x: 6, y: 4 },
        name: 'An iron door',
        requiresKey: 'iron-key',
        lockedText: 'The lock will not turn without its key.',
        effects: [{ kind: 'log', text: 'The door swings wide.' }, { kind: 'open' }],
      }),
    ),
  );

  // Something waiting past it, and the cell that wakes it.
  s.run(addEncounter('hall', encounterSchema.parse({ id: 'ambush', name: 'An ambush' })));
  s.run(addAdversary('hall', 'ambush', { id: 'burrower-1', adversary: 'acid-burrower', position: { x: 8, y: 4 } }));
  s.run(toggleTriggerCell('hall', 'ambush', { x: 7, y: 4 }));
  s.run(setSpawns('hall', [{ x: 1, y: 4 }]));

  return s;
}

/**
 * The other half of the same question, for the GM's side: a room with a stat
 * block nobody wrote by hand, whose printed feature the engine plays.
 *
 * Every other test of the GM's turn injects an ability of its own; this one
 * places a real adversary from the vendored blocks and lets the turn find the
 * real feature — the only test that would notice a misfiled id, a Difficulty
 * that never reached the roll, or a cost the turn cannot pay.
 */
describe("a room with a stat block the engine did not write", () => {
  it("plays the block's own printed feature on the GM's turn", () => {
    const s = blank();
    s.run(addSheet(KARA));
    s.run(addSheet(characterSheetSchema.parse({ ...KARA, id: 'lio', name: 'Lio' })));
    s.run(setSpawns('hall', [{ x: 1, y: 3 }, { x: 1, y: 5 }]));
    s.run(addEncounter('hall', encounterSchema.parse({ id: 'demon', name: 'A demon' })));
    // The Minor Demon's Hellfire: a Fear, an Agility Reaction Roll from
    // everyone within Far range, and magic damage on those who fail.
    s.run(addAdversary('hall', 'demon', { id: 'demon-1', adversary: 'minor-demon', position: { x: 5, y: 4 } }));

    const demo = buildProjectScene(s.project, 'hellfire');
    demo.askDefender = false;
    startEncounter(demo, 'demon');
    demo.state.fear = { ...demo.state.fear, value: demo.state.fear.max };

    let rained = false;
    for (let i = 0; i < 6 && !rained && demo.encounter?.outcome === 'ongoing'; i++) {
      endTurn(demo);
      rained = demo.log.some((l) => l.text.includes('uses Hellfire'));
    }
    expect(rained).toBe(true);
    // Everyone it caught rolled against the block's own Difficulty of 14.
    const rolls = demo.log.map((l) => l.text).filter((t) => t.includes('reacts:'));
    expect(rolls.length).toBeGreaterThanOrEqual(2);
    expect(rolls[0]).toContain('against 14');
  });
});

describe('a block that shrugs the party off', () => {
  it('halves what it resists, at the button a player actually presses', () => {
    const build = (silence: boolean, seed = 'bones') => {
      const s = blank();
      s.run(addSheet(KARA));
      s.run(setSpawns('hall', [{ x: 1, y: 4 }]));
      s.run(addEncounter('hall', encounterSchema.parse({ id: 'bones', name: 'Bones' })));
      s.run(addAdversary('hall', 'bones', { id: 'warrior-1', adversary: 'skeleton-warrior', position: { x: 3, y: 4 } }));
      if (silence) {
        // A project ability with the shipped feature's id says something else
        // with it — here, nothing at all. That is the override the manual
        // promises, and it is also how this test gets its control run.
        s.project.abilities.push(
          abilitySchema.parse({
            id: 'skeleton-warrior-only-bones',
            name: 'Only Bones',
            source: { kind: 'adversary', adversaries: ['skeleton-warrior'] },
            kind: 'passive',
            action: false,
            text: 'Nothing, for the sake of the test.',
          }),
        );
      }
      const demo = buildProjectScene(s.project, seed);
      startEncounter(demo, 'bones');
      demo.state.moveEntity('kara', demo.grid.indexOf(2, 4));
      demo.party.select('kara');
      // Several swings off one seed: the same rolls in both runs, so the only
      // thing that differs is what the bones do with the damage.
      attackWithSelected(demo, 'warrior-1');
      return demo.state.entity('warrior-1')!.hitPoints.marked;
    };

    // One seed, so both runs roll the same swing: Kara's broadsword deals
    // physical damage, which is what a pile of bones shrugs off. Major on the
    // Warrior's thresholds, and Minor once it is halved.
    const plain = build(true, 's5');
    const resisted = build(false, 's5');
    expect(plain).toBe(3);
    expect(resisted).toBe(2);
  });
});

describe('a Lieutenant with more where that came from', () => {
  it('calls three Lackeys onto the map, and they are in the fight from that moment', () => {
    const s = blank();
    s.run(addSheet(KARA));
    s.run(setSpawns('hall', [{ x: 2, y: 4 }]));
    s.run(addEncounter('hall', encounterSchema.parse({ id: 'thieves', name: 'Thieves' })));
    s.run(addAdversary('hall', 'thieves', { id: 'boss', adversary: 'jagged-knife-lieutenant', position: { x: 7, y: 4 } }));

    const demo = buildProjectScene(s.project, 'knives');
    demo.askDefender = false;
    startEncounter(demo, 'thieves');
    demo.state.fear = { ...demo.state.fear, value: demo.state.fear.max };
    const before = demo.state.entitiesOf('adversary').length;

    let called = false;
    for (let i = 0; i < 4 && !called && demo.encounter?.outcome === 'ongoing'; i++) {
      endTurn(demo);
      called = demo.log.some((l) => l.text.includes('uses More Where That Came From'));
    }
    expect(called).toBe(true);

    // Three Lackeys, on the map, off the shipped stat block.
    const now = demo.state.entitiesOf('adversary');
    expect(now.length).toBe(before + 3);
    const lackeys = now.filter((e) => e.definition === 'jagged-knife-lackey');
    expect(lackeys).toHaveLength(3);
    expect(demo.log.some((l) => l.text.includes('3 Jagged Knife Lackeys arrive.'))).toBe(true);

    // They are in the fight: the encounter waits on them, so killing the
    // Lieutenant alone does not end it.
    demo.state.entity('boss')!.alive = false;
    settleFight(demo);
    expect(demo.encounter!.outcome).toBe('ongoing');
    expect(demo.encounter!.view().waiting).toEqual(expect.arrayContaining(lackeys.map((e) => e.id)));
  });
});

describe('a clock the fight carries', () => {
  /** One Sorcerer across the hall from Kara, and the fight already on. */
  const ruin = (adversary: string, at: { x: number; y: number }, seed: string) => {
    const s = blank();
    s.run(addSheet(KARA));
    s.run(setSpawns('hall', [{ x: 2, y: 4 }]));
    s.run(addEncounter('hall', encounterSchema.parse({ id: 'ruin', name: 'The ruin' })));
    s.run(addAdversary('hall', 'ruin', { id: 'foe', adversary, position: at }));
    const demo = buildProjectScene(s.project, seed);
    demo.askDefender = false;
    startEncounter(demo, 'ruin');
    demo.state.fear = { ...demo.state.fear, value: demo.state.fear.max };
    demo.party.select('kara');
    // A level 1 Guardian does not live long in front of a Tier 4 block, and
    // this test is about the clock rather than about Kara: give her the Hit
    // Points to stand there while it runs down.
    demo.state.entity('kara')!.hitPoints = { max: 40, marked: 0 };
    return demo;
  };

  /** Kara swings, taking the spotlight back first if a roll with Fear lost it. */
  const swing = (demo: ReturnType<typeof ruin>): void => {
    if (!demo.encounter!.canAct('kara')) endTurn(demo);
    attackWithSelected(demo, 'foe');
  };

  it('is armed on the Sorcerer first spotlight and goes off on a later roll', () => {
    const demo = ruin('fallen-sorcerer', { x: 3, y: 4 }, 'shackles');
    endTurn(demo);

    // "When the Sorcerer is in the spotlight for the first time, activate the
    // countdown."
    expect(demo.log.some((l) => l.text.includes('Shackles of Guilt begins'))).toBe(true);
    const clock = demo.scenario.countdowns.get('fallen-sorcerer-shackles-of-guilt');
    expect(clock).toMatchObject({ owner: 'foe', advance: 'standard', loop: 'reset' });
    expect(clock!.value).toBeGreaterThanOrEqual(2);

    // A clock nobody spends a turn on: Kara swings, and it moves.
    const started = demo.scenario.countdowns.get('fallen-sorcerer-shackles-of-guilt')!.value;
    swing(demo);
    expect(demo.scenario.countdowns.get('fallen-sorcerer-shackles-of-guilt')!.value).toBe(started - 1);

    // Down to its last tick, and the next roll sets it off: everyone within
    // Far range relives what they would rather not.
    demo.scenario.countdowns.get('fallen-sorcerer-shackles-of-guilt')!.value = 1;
    const stress = demo.state.entity('kara')!.stress.marked;
    swing(demo);
    expect(demo.log.some((l) => l.text.includes('Shackles of Guilt triggers'))).toBe(true);
    expect(demo.state.entity('kara')!.conditions.has('vulnerable')).toBe(true);
    expect(demo.state.entity('kara')!.stress.marked).toBeGreaterThan(stress);

    // "Loop 2d6": it comes straight back, at a length nobody at the table knows.
    const again = demo.scenario.countdowns.get('fallen-sorcerer-shackles-of-guilt');
    expect(again).toBeDefined();
    expect(again!.value).toBe(again!.start);
  });

  it('goes off as the Tyrant falls, because that is what their feature says', () => {
    // Across the hall, so the Tyrant spends its first turn walking rather
    // than eating a level 1 Guardian: the countdown is the point.
    const demo = ruin('volcanic-dragon-ashen-tyrant', { x: 11, y: 4 }, 'tyrant');
    endTurn(demo);
    const id = 'volcanic-dragon-ashen-tyrant-apocalyptic-thrashing';
    expect(demo.scenario.countdowns.get(id)).toMatchObject({ advance: 'withFear', onDeath: 'trigger' });

    // "If the Ashen Tyrant is defeated while this countdown is active,
    // trigger the countdown immediately as the destruction caused by their
    // death throes."
    const before = demo.state.entity('kara')!.hitPoints.marked;
    demo.state.entity('foe')!.alive = false;
    settleFight(demo);
    expect(demo.log.some((l) => l.text.includes('Apocalyptic Thrashing triggers'))).toBe(true);
    expect(demo.state.entity('kara')!.hitPoints.marked).toBeGreaterThan(before);
    // Spent: a second death does not bring the mountain down twice.
    expect(demo.scenario.countdowns.has(id)).toBe(false);
    settleFight(demo);
    expect(demo.log.filter((l) => l.text.includes('Apocalyptic Thrashing triggers')).length).toBe(1);
  });

  it('does not bring the mountain down in a room the Tyrant is not in', () => {
    const demo = ruin('volcanic-dragon-ashen-tyrant', { x: 11, y: 4 }, 'tyrant-elsewhere');
    endTurn(demo);
    const id = 'volcanic-dragon-ashen-tyrant-apocalyptic-thrashing';
    expect(demo.scenario.countdowns.has(id)).toBe(true);

    // The clock is on the scenario, which outlives the room: walking out of
    // the room the Tyrant is in is not the Tyrant being defeated.
    demo.state.removeEntity('foe');
    settleFight(demo);
    expect(demo.log.some((l) => l.text.includes('Apocalyptic Thrashing triggers'))).toBe(false);
    expect(demo.scenario.countdowns.has(id)).toBe(false);
  });

  it('stops when the fight does, so nothing ticks in the quiet afterwards', () => {
    const demo = ruin('fallen-sorcerer', { x: 3, y: 4 }, 'shackles-3');
    endTurn(demo);
    expect(demo.scenario.countdowns.size).toBe(1);

    // A script calls the fight off with the Sorcerer still standing - a truce,
    // an objective met. The fight is over, so a clock a creature was counting
    // has nothing left to count, and a chest opened afterwards must not tick
    // it: countdowns advance on action rolls, in a fight or out of one.
    demo.encounter!.end('victory');
    settleFight(demo);
    expect(demo.state.entity('foe')!.alive).toBe(true);
    expect(demo.scenario.countdowns.size).toBe(0);
  });

  it('is armed once, however many turns the Sorcerer gets', () => {
    const demo = ruin('fallen-sorcerer', { x: 3, y: 4 }, 'shackles-2');
    endTurn(demo);
    const first = demo.scenario.countdowns.get('fallen-sorcerer-shackles-of-guilt')!.value;
    demo.scenario.countdowns.get('fallen-sorcerer-shackles-of-guilt')!.value = 2;
    endTurn(demo);
    // "For the first time": a second spotlight does not start it over.
    expect(demo.scenario.countdowns.get('fallen-sorcerer-shackles-of-guilt')!.value).not.toBe(first);
    expect(demo.log.filter((l) => l.text.includes('Shackles of Guilt begins')).length).toBe(1);
  });
});

describe('a swarm of Giant Rats', () => {
  /** Rats loose in the hall, and Kara alone in the middle of it. */
  const hall = (rats: readonly { x: number; y: number }[], fear: number) => {
    const s = blank();
    s.run(addSheet(KARA));
    s.run(setSpawns('hall', [{ x: 4, y: 4 }]));
    s.run(addEncounter('hall', encounterSchema.parse({ id: 'vermin', name: 'Vermin' })));
    rats.forEach((at, i) => {
      s.run(addAdversary('hall', 'vermin', { id: `rat-${i + 1}`, adversary: 'giant-rat', position: at }));
    });
    const demo = buildProjectScene(s.project, 'rats');
    demo.askDefender = false;
    startEncounter(demo, 'vermin');
    demo.state.fear = { ...demo.state.fear, value: fear };
    return demo;
  };

  it('calls the rest of the pack in for one shared bite, and each rat swings once', () => {
    // Four rats, none of them next to Kara: Close range of her, which is what
    // the feature gathers.
    const demo = hall([{ x: 7, y: 4 }, { x: 7, y: 3 }, { x: 7, y: 5 }, { x: 8, y: 4 }], 6);
    endTurn(demo);

    const said = demo.log.map((l) => l.text);
    expect(said.filter((t) => t.includes('uses Group Attack')).length).toBe(1);
    // One roll, and the bite counted for every rat that got there.
    expect(said.some((t) => /of them at once/.test(t))).toBe(true);
    // A rat that piled in has had its turn: four rats, and no more than four
    // acts in the whole GM turn — without the spotlight bookkeeping the three
    // that joined would each come round again and bite a second time.
    const bites = said.filter((t) => t.includes('Bite') || t.includes('Group Attack')).length;
    expect(bites).toBeLessThanOrEqual(4);
  });

  it('does not spend a Fear on a swarm of one', () => {
    const demo = hall([{ x: 7, y: 4 }], 6);
    const before = demo.state.fear.value;
    endTurn(demo);
    const said = demo.log.map((l) => l.text);
    expect(said.some((t) => t.includes('uses Group Attack'))).toBe(false);
    expect(demo.state.fear.value).toBe(before);
  });
});

describe('a block wearing enough plate to matter', () => {
  /**
   * The Knight's Heavily Armored and the Champion's Faltering Armor, at the
   * button a player presses: a PC's swing at an adversary is resolved in
   * `resolveAttack` and applied at once, with no defence step to catch it, so
   * a passive that reduces damage has to be read there or it does nothing.
   */
  const swing = (
    adversary: string,
    feature: string,
    quiet: boolean,
    seed: string,
  ): { marked: number; log: string[] } => {
    const s = blank();
    s.run(addSheet(KARA));
    s.run(setSpawns('hall', [{ x: 1, y: 4 }]));
    s.run(addEncounter('hall', encounterSchema.parse({ id: 'guard', name: 'The guard' })));
    s.run(addAdversary('hall', 'guard', { id: 'foe-1', adversary, position: { x: 3, y: 4 } }));
    if (quiet) {
      // The same override the resistance test uses for its control run: a
      // project ability with the shipped feature's id, saying nothing.
      s.project.abilities.push(
        abilitySchema.parse({
          id: feature,
          name: 'Quiet',
          source: { kind: 'adversary', adversaries: [adversary] },
          kind: 'passive',
          action: false,
          text: 'Nothing, for the sake of the test.',
        }),
      );
    }
    const demo = buildProjectScene(s.project, seed);
    startEncounter(demo, 'guard');
    demo.state.moveEntity('kara', demo.grid.indexOf(2, 4));
    demo.party.select('kara');
    attackWithSelected(demo, 'foe-1');
    return { marked: demo.state.entity('foe-1')!.hitPoints.marked, log: demo.log.map((l) => l.text) };
  };

  it('takes a flat 3 off the swing that lands, and rolls the dice kind', () => {
    // One seed, so both runs roll the same broadsword: physical damage, which
    // is what plate answers. 13/26 thresholds, and a swing in the low teens is
    // Major until the plate takes three off it.
    const knight = 'knight-of-the-realm';
    expect(swing(knight, knight + '-heavily-armored', true, 'k12').marked).toBe(2);
    const plated = swing(knight, knight + '-heavily-armored', false, 'k12');
    expect(plated.marked).toBe(1);
    expect(plated.log).toContain('Knight of the Realm turns aside 3 of it.');

    // The Champion's 1d10 is rolled after the swing, so the swing itself is
    // the same in both runs and only the armor differs.
    const champion = 'fallen-warlord-undefeated-champion';
    expect(swing(champion, champion + '-faltering-armor', true, 'c9').marked).toBe(1);
    const rolled = swing(champion, champion + '-faltering-armor', false, 'c9');
    expect(rolled.marked).toBe(0);
    expect(rolled.log).toContain('Fallen Warlord: Undefeated Champion turns aside 7 of it.');
  });
});

describe('a Treant that puts its roots down', () => {
  it('roots once and then fights, rather than rooting and tearing free forever', () => {
    const s = blank();
    s.run(addSheet(KARA));
    s.run(setSpawns('hall', [{ x: 3, y: 4 }]));
    s.run(addEncounter('hall', encounterSchema.parse({ id: 'grove', name: 'The grove' })));
    s.run(addAdversary('hall', 'grove', { id: 'treant-1', adversary: 'oak-treant', position: { x: 4, y: 4 } }));

    const demo = buildProjectScene(s.project, 'grove');
    demo.askDefender = false;
    startEncounter(demo, 'grove');
    demo.state.fear = { ...demo.state.fear, value: demo.state.fear.max };
    for (let i = 0; i < 4 && demo.encounter?.outcome === 'ongoing'; i++) endTurn(demo);

    const said = demo.log.map((l) => l.text);
    // Once, because a Treant already rooted has nothing to gain by rooting
    // again — and then it uses its turns on the party.
    expect(said.filter((t) => t.includes('uses Take Root')).length).toBe(1);
    expect(said.some((t) => t.includes('Kara'))).toBe(true);
    expect(demo.world.hasCondition('treant-1', 'rooted')).toBe(true);
  });
});

describe('a scenario built with nothing but the editor', () => {
  it('passes the validator the Check button runs', () => {
    expect(validateProject(author().project)).toEqual([]);
  });

  it('plays: a locked door, the chest that answers it, and a fight past it', () => {
    const session = author();
    const demo = buildProjectScene(session.project, 'authored');

    // The party is the one the panel wrote, standing where the spawn says.
    expect([...demo.sheets.keys()]).toEqual(['kara']);
    expect(demo.party.selected).toBe('kara');
    const kara = demo.state.entity('kara')!;
    expect(demo.grid.xOf(kara.tile)).toBe(1);

    // The door refuses, in the words the panel wrote.
    demo.state.moveEntity('kara', demo.grid.indexOf(5, 4));
    const refused = useSelectedOn(demo, 'iron-door');
    expect(refused.lines.map((l) => l.text).join(' ')).toContain('will not turn');
    expect(demo.world.interactableState('iron-door').open).toBe(false);

    // The chest pays out the key the door wanted.
    demo.state.moveEntity('kara', demo.grid.indexOf(2, 4));
    useSelectedOn(demo, 'strongbox');
    if (demo.pending !== null) answerPending(demo, { kind: 'roll' });
    expect(demo.world.hasItem('iron-key')).toBe(true);

    // And now it opens.
    demo.state.moveEntity('kara', demo.grid.indexOf(5, 4));
    const opened = useSelectedOn(demo, 'iron-door');
    expect(opened.lines.map((l) => l.text).join(' ')).toContain('swings wide');
    expect(demo.world.interactableState('iron-door').open).toBe(true);

    // Walking onto the cell the panel marked starts the fight — nothing here
    // calls `startEncounter`, because a trigger a designer placed has to work.
    expect(demo.encounter).toBeNull();
    moveSelectedTo(demo, demo.grid.indexOf(7, 4));
    expect(demo.encounter).not.toBeNull();

    const foe = demo.state.entitiesOf('adversary')[0]!;
    expect(foe.definition).toBe('acid-burrower');
    const swing = attackWithSelected(demo, foe.id);
    expect(swing).not.toBeNull();
    expect(swing!.refused).toBeNull();
    expect(demo.log.map((line) => line.text).join(' ')).toMatch(/Broadsword/);
  });

  it('refuses to stand up a room that places a creature nobody can look up', () => {
    const s = author();
    s.project.scenes[0]!.encounters[0]!.adversaries[0]!.adversary = 'goblin-warror';
    expect(() => buildProjectScene(s.project)).toThrow(/goblin-warror/);
    // And the validator says the same thing before it is ever played.
    expect(
      validateProject(s.project, { knownAdversaries: new Set(['acid-burrower']) })
        .map((p) => p.message)
        .join(' '),
    ).toContain('goblin-warror');
  });

  it('reports what a half-finished scenario is missing', () => {
    const s = blank();
    s.run(addSheet(KARA));
    s.run(
      addInteractable(
        'hall',
        interactableSchema.parse({ id: 'iron-door', kind: 'door', position: { x: 6, y: 4 }, requiresKey: 'iron-key' }),
      ),
    );
    // A door wanting a key nobody wrote yet: an error with the id in it.
    expect(validateProject(s.project).map((p) => p.message).join(' ')).toContain('iron-key');

    // And once the item exists, it is quiet again.
    s.run(addItem(itemSchema.parse({ id: 'iron-key', name: 'An iron key', kind: 'key' })));
    expect(validateProject(s.project)).toEqual([]);
  });

  it('lets an edit made after the fact reach a game built from the document', () => {
    const session = author();
    session.run(updateSheet('kara', { name: 'Kara the Unmoved' }));
    session.run(updateInteractable('hall', 'iron-door', { name: 'A rusted door' }));

    const demo = buildProjectScene(session.project, 'authored');
    expect(demo.sheets.get('kara')!.name).toBe('Kara the Unmoved');
    expect(demo.scene.interactables.find((i) => i.id === 'iron-door')!.name).toBe('A rusted door');
  });
});
