import { describe, it, expect } from 'vitest';
import { blankScene } from '../engine/scene/grid-from-scene';
import { encounterSchema, interactableSchema, projectSchema, sceneSchema } from '../engine/scene/schema';
import { itemSchema, lootTableSchema } from '../engine/content/items';
import { abilitySchema } from '../engine/content/abilities';
import { blankSheet } from '../engine/character/sheet';
import { characterSheetSchema } from '../engine/character/sheet-schema';
import {
  EditorSession,
  addAbility,
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
import { SRD_ABILITIES } from '../engine/content/srd/abilities';
import { abilitiesOf, abilityTargets, useAbility } from '../game/demo-abilities';
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

describe('a Leader buying its own side a turn', () => {
  /** A Lieutenant and two Lackeys down the hall from Kara. */
  const gang = (seed: string, fear: number) => {
    const s = blank();
    s.run(addSheet(KARA));
    s.run(setSpawns('hall', [{ x: 2, y: 4 }]));
    s.run(addEncounter('hall', encounterSchema.parse({ id: 'thieves', name: 'Thieves' })));
    s.run(addAdversary('hall', 'thieves', { id: 'boss', adversary: 'jagged-knife-lieutenant', position: { x: 7, y: 4 } }));
    s.run(addAdversary('hall', 'thieves', { id: 'knife-1', adversary: 'jagged-knife-lackey', position: { x: 7, y: 3 } }));
    s.run(addAdversary('hall', 'thieves', { id: 'knife-2', adversary: 'jagged-knife-lackey', position: { x: 7, y: 5 } }));
    const demo = buildProjectScene(s.project, seed);
    demo.askDefender = false;
    startEncounter(demo, 'thieves');
    demo.state.fear = { ...demo.state.fear, value: fear };
    demo.party.select('kara');
    return demo;
  };

  it('hands the spotlight to two allies on its own turn, with no Fear in the pool', () => {
    // Not a single Fear: an ordinary second spotlight would be refused, and
    // the turn would stop. "Mark a Stress to also spotlight two allies within
    // Close range" pays in Stress, and what it buys has to be honoured.
    const demo = gang('tactician', 0);
    const stress = demo.state.entity('boss')!.stress.marked;
    endTurn(demo);

    expect(demo.log.some((l) => l.text.includes('uses Tactician'))).toBe(true);
    expect(demo.state.entity('boss')!.stress.marked).toBe(stress + 1);

    // Both Lackeys acted, this turn, exactly once each.
    const acted = demo.encounter!.log.filter((e) => e.kind === 'adversaryActed') as { id: string }[];
    expect(acted.filter((e) => e.id === 'knife-1')).toHaveLength(1);
    expect(acted.filter((e) => e.id === 'knife-2')).toHaveLength(1);
    // And the GM was billed for none of it beyond the first, free spotlight.
    expect(acted.every((e) => (e as unknown as { fearSpent: number }).fearSpent === 0)).toBe(true);
  });

  it('says nothing and spends nothing when there is nobody to rally', () => {
    const demo = gang('tactician-alone', 0);
    demo.state.entity('knife-1')!.alive = false;
    demo.state.entity('knife-2')!.alive = false;
    const stress = demo.state.entity('boss')!.stress.marked;
    endTurn(demo);
    // A Lieutenant standing alone would otherwise bleed a Stress every turn
    // for a rally nobody answers.
    expect(demo.log.some((l) => l.text.includes('uses Tactician'))).toBe(false);
    expect(demo.state.entity('boss')!.stress.marked).toBe(stress);
  });
});

describe('a creature that does not stay the same creature', () => {
  const arena = (adversary: string, seed: string, fear: number) => {
    const s = blank();
    s.run(addSheet(KARA));
    s.run(setSpawns('hall', [{ x: 2, y: 4 }]));
    s.run(addEncounter('hall', encounterSchema.parse({ id: 'arena', name: 'The arena' })));
    s.run(addAdversary('hall', 'arena', { id: 'foe', adversary, position: { x: 3, y: 4 } }));
    const demo = buildProjectScene(s.project, seed);
    demo.askDefender = false;
    startEncounter(demo, 'arena');
    demo.state.fear = { ...demo.state.fear, value: fear };
    demo.state.entity('kara')!.hitPoints = { max: 40, marked: 0 };
    demo.party.select('kara');
    return demo;
  };

  it('stands the next form up before anybody says the fight is won', () => {
    const demo = arena('volcanic-dragon-obsidian-predator', 'phase', 0);
    const where = demo.state.entity('foe')!.tile;
    // The killing blow, delivered by hand: the Predator marks its last HP.
    demo.state.entity('foe')!.hitPoints = { max: 6, marked: 5 };
    attackWithSelected(demo, 'foe');
    if (demo.state.entity('foe')?.alive === true) {
      // A miss: put it down directly, the way the fight would have.
      const foe = demo.state.entity('foe')!;
      foe.hitPoints = { max: 6, marked: 6 };
      foe.alive = false;
      settleFight(demo);
    }

    // "Replace them with the Molten Scourge and immediately spotlight them."
    expect(demo.state.entity('foe')).toBeUndefined();
    const next = demo.state.entitiesOf('adversary').filter((e) => e.alive);
    expect(next.map((e) => e.definition)).toEqual(['volcanic-dragon-molten-scourge']);
    // In the same place the fight left it, at full strength off its own block.
    expect(next[0]!.tile).toBe(where);
    expect(next[0]!.hitPoints.marked).toBe(0);
    // And the fight is not over: the party won nothing yet.
    expect(demo.encounter!.outcome).toBe('ongoing');
    // One feature on the block, not two: the printed name carries "(Phase
    // Change)" and the scripted one does not, and nothing merges by name.
    const named = demo.world
      .abilitiesForAdversary('volcanic-dragon-obsidian-predator')
      .filter((a) => a.name.startsWith('Erupting Rage'));
    expect(named).toHaveLength(1);
  });

  it('splits an Ooze in two, on the Fear that says so', () => {
    const demo = arena('green-ooze', 'ooze', 3);
    const foe = demo.state.entity('foe')!;
    // "When the Ooze has 3 or more HP marked": one short, so the blow that
    // lands is the one that splits it.
    foe.hitPoints = { max: 8, marked: 2 };
    const fear = demo.state.fear.value;
    attackWithSelected(demo, 'foe');

    // The log names what is gone, which nothing can look up once it is: the
    // line comes after the swing that caused it, not before.
    const said = demo.log.map((l) => l.text);
    expect(said).toContain('Green Ooze is gone: 2 Tiny Green Oozes in their place.');
    expect(said.indexOf('Green Ooze is gone: 2 Tiny Green Oozes in their place.')).toBeGreaterThan(
      said.findIndex((t) => t.includes('Kara hits with the Broadsword')),
    );

    const oozes = demo.state.entitiesOf('adversary').filter((e) => e.alive);
    expect(oozes.map((e) => e.definition)).toEqual(['tiny-green-ooze', 'tiny-green-ooze']);
    // "(with no marked HP or Stress)"
    expect(oozes.every((e) => e.hitPoints.marked === 0 && e.stress.marked === 0)).toBe(true);
    expect(demo.state.entity('foe')).toBeUndefined();
    expect(fear - demo.state.fear.value).toBe(1);
  });

  it('leaves an Ooze whole while the wound is shallow, and while the pool is empty', () => {
    const shallow = arena('green-ooze', 'ooze-shallow', 3);
    shallow.state.entity('foe')!.hitPoints = { max: 8, marked: 0 };
    attackWithSelected(shallow, 'foe');
    expect(shallow.state.entity('foe')?.definition).toBe('green-ooze');

    const broke = arena('green-ooze', 'ooze-broke', 0);
    broke.state.entity('foe')!.hitPoints = { max: 8, marked: 2 };
    // Damage rather than a swing, so no roll hands the GM the Fear back.
    broke.world.dealDamage('foe', { amount: 4, types: ['physical'] }, broke.rng);
    settleFight(broke);
    // Nothing to spend: "spend a Fear to split them" is not a suggestion.
    expect(broke.state.entity('foe')?.definition).toBe('green-ooze');
  });
});

describe('what the two of them make of each other', () => {
  /** Kara and one creature, at the distance the test asks for. */
  const facing = (adversary: string, at: { x: number; y: number }, seed: string) => {
    const s = blank();
    s.run(addSheet(KARA));
    s.run(setSpawns('hall', [{ x: 2, y: 4 }]));
    s.run(addEncounter('hall', encounterSchema.parse({ id: 'yard', name: 'The yard' })));
    s.run(addAdversary('hall', 'yard', { id: 'foe', adversary, position: at }));
    const demo = buildProjectScene(s.project, seed);
    demo.askDefender = false;
    startEncounter(demo, 'yard');
    demo.state.entity('kara')!.hitPoints = { max: 40, marked: 0 };
    demo.party.select('kara');
    return demo;
  };

  it('puts a shield in the way of anyone standing close enough to be blocked', () => {
    // "Creatures within Melee range of the Gaoler have disadvantage on attack
    // rolls against them."
    const near = facing('vault-guardian-gaoler', { x: 3, y: 4 }, 'shield');
    expect(near.world.advantageFor('kara', 'foe')).toEqual({ advantage: 0, disadvantage: 1 });

    // And a shield only reaches as far as the arm holding it.
    const far = facing('vault-guardian-gaoler', { x: 8, y: 4 }, 'shield-far');
    expect(far.world.advantageFor('kara', 'foe')).toEqual({ advantage: 0, disadvantage: 0 });
  });

  it('hands the Assassin the advantage its own passive names, and only while it holds', () => {
    const demo = facing('assassin-poisoner', { x: 3, y: 4 }, 'assassin');
    expect(demo.world.advantageFor('foe', 'kara')).toEqual({ advantage: 0, disadvantage: 0 });

    // "The Assassin has advantage on attacks if they are Hidden."
    demo.state.entity('foe')!.conditions.add('hidden');
    expect(demo.world.advantageFor('foe', 'kara')).toEqual({ advantage: 1, disadvantage: 0 });
    // It is the Assassin's own advantage: nothing about swinging at them.
    expect(demo.world.advantageFor('kara', 'foe').advantage).toBe(0);
  });

  it('reads a bonus to Difficulty straight off a passive nobody had written down', () => {
    const demo = facing('dire-bat', { x: 3, y: 4 }, 'bat');
    const bat = demo.state.entity('foe')!;
    // "While flying, the Bat gains a +3 bonus to their Difficulty."
    expect(demo.world.defenderOf(bat).difficulty).toBe(14 + 3);
  });

  it('chills whoever gets close enough to cut it, and a Chilled arm swings worse', () => {
    const demo = facing('young-ice-dragon', { x: 3, y: 4 }, 'chill');
    demo.state.entity('foe')!.hitPoints = { max: 40, marked: 0 };
    for (let i = 0; i < 4 && !demo.state.entity('kara')!.conditions.has('chilled'); i++) {
      if (!demo.encounter!.canAct('kara')) endTurn(demo);
      attackWithSelected(demo, 'foe');
    }
    expect(demo.state.entity('kara')!.conditions.has('chilled')).toBe(true);
    // The condition carries the disadvantage, so it follows her to any target.
    expect(demo.world.advantageFor('kara', 'foe').disadvantage).toBeGreaterThan(0);
  });
});

describe('a wound that answers back', () => {
  /** Kara toe to toe with something, the fight already on. */
  const duel = (adversary: string, seed: string) => {
    const s = blank();
    s.run(addSheet(KARA));
    s.run(setSpawns('hall', [{ x: 2, y: 4 }]));
    s.run(addEncounter('hall', encounterSchema.parse({ id: 'duel', name: 'The duel' })));
    s.run(addAdversary('hall', 'duel', { id: 'foe', adversary, position: { x: 3, y: 4 } }));
    const demo = buildProjectScene(s.project, seed);
    demo.askDefender = false;
    startEncounter(demo, 'duel');
    demo.state.entity('kara')!.hitPoints = { max: 40, marked: 0 };
    demo.party.select('kara');
    return demo;
  };

  it('drives thorns back into the one who struck, and marks the Stress for it', () => {
    const demo = duel('stag-knight', 'thorns');
    const before = demo.state.entity('kara')!;
    const wounds = before.hitPoints.marked + before.armorSlots.marked;
    const stress = demo.state.entity('foe')!.stress.marked;

    attackWithSelected(demo, 'foe');

    // "When the Knight takes damage from an attack within Melee range, you can
    // mark a Stress to deal 1d10+5 physical damage to the attacker."
    expect(demo.log.some((l) => l.text.includes('Thorns drive back into the blow.'))).toBe(true);
    expect(demo.state.entity('foe')!.stress.marked).toBe(stress + 1);
    const after = demo.state.entity('kara')!;
    expect(after.hitPoints.marked + after.armorSlots.marked).toBeGreaterThan(wounds);
  });

  it('stays quiet when the wound has nobody behind it', () => {
    const demo = duel('stag-knight', 'thorns-nobody');
    const stress = demo.state.entity('foe')!.stress.marked;
    // Damage out of a script - a trap, a countdown, a spell with no attacker.
    // "From an attack within Melee range" has nobody to measure to, so the
    // armor answers nothing and the Stress stays unmarked.
    demo.world.dealDamage('foe', { amount: 9, types: ['physical'] }, demo.rng);
    settleFight(demo);
    expect(demo.log.some((l) => l.text.includes('Thorns drive back'))).toBe(false);
    expect(demo.state.entity('foe')!.stress.marked).toBe(stress);
  });

  it('answers the first wound only, which is what arms a Flickerfly', () => {
    const demo = duel('juvenile-flickerfly', 'flicker');
    const foe = demo.state.entity('foe')!;
    foe.hitPoints = { max: 40, marked: 0 };
    for (let i = 0; i < 4; i++) {
      if (!demo.encounter!.canAct('kara')) endTurn(demo);
      attackWithSelected(demo, 'foe');
    }
    // "When the Flickerfly takes damage for the first time, activate the
    // countdown": a `uses` of one, however many times Kara connects.
    expect(demo.log.filter((l) => l.text.includes('Hallucinatory Breath begins')).length).toBe(1);
    expect(demo.scenario.countdowns.has('juvenile-flickerfly-hallucinatory-breath')).toBe(true);
  });
});

describe('a wound big enough to be counted', () => {
  /** Kara toe to toe with something, the fight already on. */
  const duel = (adversary: string, seed: string) => {
    const s = blank();
    s.run(addSheet(KARA));
    s.run(setSpawns('hall', [{ x: 2, y: 4 }]));
    s.run(addEncounter('hall', encounterSchema.parse({ id: 'duel', name: 'The duel' })));
    s.run(addAdversary('hall', 'duel', { id: 'foe', adversary, position: { x: 3, y: 4 } }));
    const demo = buildProjectScene(s.project, seed);
    demo.askDefender = false;
    startEncounter(demo, 'duel');
    demo.state.entity('kara')!.hitPoints = { max: 40, marked: 0 };
    demo.state.entity('foe')!.hitPoints = { max: 40, marked: 0 };
    demo.party.select('kara');
    return demo;
  };

  it('throws half of the blow back, off the damage rather than the Hit Points', () => {
    // "Deal an amount of damage to the attacker equal to half the damage they
    // dealt." Twenty magic damage marks the Elemental once or twice; what
    // comes back is ten, which is half of the swing and not half of that.
    const demo = duel('minor-chaos-elemental', 'reflect');
    demo.world.noteDamage('foe', { attacker: 'kara', hitPoints: 2, damage: 20, types: ['magic'] });
    settleFight(demo);

    expect(demo.log.some((l) => l.text.includes('The blow bends back on itself.'))).toBe(true);
    expect(demo.log.some((l) => l.text.includes('10 damage to Kara'))).toBe(true);
  });

  it('answers only a wound of the size the block names', () => {
    // "When the Brawler marks 2 or more HP from an attack within Very Close
    // range." One Hit Point is a scratch, and the hammer stays down.
    const light = duel('giant-brawler', 'brawler-light');
    light.world.noteDamage('foe', { attacker: 'kara', hitPoints: 1, damage: 5, types: ['physical'] });
    settleFight(light);
    expect(light.log.some((l) => l.text.includes('answers the wound with the hammer'))).toBe(false);

    const heavy = duel('giant-brawler', 'brawler-heavy');
    heavy.world.noteDamage('foe', { attacker: 'kara', hitPoints: 2, damage: 30, types: ['physical'] });
    settleFight(heavy);
    expect(heavy.log.some((l) => l.text.includes('answers the wound with the hammer'))).toBe(true);
  });

  it('drinks back exactly what its own clock took out of somebody', () => {
    // "The Necromancer then clears a number of Stress or HP equal to the
    // number of HP marked by the target from this attack."
    const demo = duel('arch-necromancer', 'life-is-mine');
    const foe = demo.state.entity('foe')!;
    foe.hitPoints = { max: 12, marked: 6 };
    demo.world.noteDamage('foe', { attacker: 'kara', hitPoints: 1, damage: 8, types: ['physical'] });
    settleFight(demo);
    const clock = demo.scenario.countdowns.get('arch-necromancer-your-life-is-mine');
    expect(clock).toBeDefined();

    clock!.value = 1;
    const marked = foe.hitPoints.marked;
    const hurt = demo.state.entity('kara')!.hitPoints.marked;
    if (!demo.encounter!.canAct('kara')) endTurn(demo);
    attackWithSelected(demo, 'foe');

    expect(demo.log.some((l) => l.text.includes('drinks the wound back'))).toBe(true);
    const took = demo.state.entity('kara')!.hitPoints.marked - hurt;
    expect(took).toBeGreaterThan(0);
    // What it cleared is what the blast marked, less whatever Kara's own swing
    // put back on it.
    expect(foe.hitPoints.marked).toBeLessThanOrEqual(marked - took + 1);
  });
});

describe('a wound too small to be worth taking', () => {
  const duel = (adversary: string, seed: string) => {
    const s = blank();
    s.run(addSheet(KARA));
    s.run(setSpawns('hall', [{ x: 2, y: 4 }]));
    s.run(addEncounter('hall', encounterSchema.parse({ id: 'duel', name: 'The duel' })));
    s.run(addAdversary('hall', 'duel', { id: 'foe', adversary, position: { x: 3, y: 4 } }));
    const demo = buildProjectScene(s.project, seed);
    demo.askDefender = false;
    startEncounter(demo, 'duel');
    demo.state.entity('kara')!.hitPoints = { max: 40, marked: 0 };
    demo.state.entity('foe')!.hitPoints = { max: 40, marked: 0 };
    demo.party.select('kara');
    return demo;
  };

  it('costs the attacker a Stress for a blow the Captain shrugs off, and nothing for a real one', () => {
    // "When the Captain marks 2 or fewer HP from an attack within Melee range,
    // the attacker must mark a Stress."
    const small = duel('pirate-captain', 'swash-small');
    const before = small.state.entity('kara')!.stress.marked;
    small.world.noteDamage('foe', { attacker: 'kara', hitPoints: 1, damage: 6, types: ['physical'] });
    settleFight(small);
    expect(small.log.some((l) => l.text.includes('Turned aside with a laugh.'))).toBe(true);
    expect(small.state.entity('kara')!.stress.marked).toBe(before + 1);

    const big = duel('pirate-captain', 'swash-big');
    const was = big.state.entity('kara')!.stress.marked;
    big.world.noteDamage('foe', { attacker: 'kara', hitPoints: 3, damage: 24, types: ['physical'] });
    settleFight(big);
    expect(big.log.some((l) => l.text.includes('Turned aside with a laugh.'))).toBe(false);
    expect(big.state.entity('kara')!.stress.marked).toBe(was);
  });
});

describe('a creature that walks before it swings', () => {
  /** Kara at one end of the hall and something at the other. */
  const hall = (adversary: string, at: { x: number; y: number }, seed: string) => {
    const s = blank();
    s.run(addSheet(KARA));
    s.run(setSpawns('hall', [{ x: 2, y: 4 }]));
    s.run(addEncounter('hall', encounterSchema.parse({ id: 'hall', name: 'The hall' })));
    s.run(addAdversary('hall', 'hall', { id: 'foe', adversary, position: at }));
    const demo = buildProjectScene(s.project, seed);
    demo.askDefender = false;
    startEncounter(demo, 'hall');
    demo.state.fear = { ...demo.state.fear, value: demo.state.fear.max };
    demo.state.entity('kara')!.hitPoints = { max: 40, marked: 0 };
    demo.state.entity('foe')!.hitPoints = { max: 40, marked: 0 };
    demo.party.select('kara');
    return demo;
  };

  const bandTo = (demo: ReturnType<typeof hall>, a: string, b: string) => demo.world.bandTo(a, b);

  it('closes the ground the feature says it can, and no further than it needs', () => {
    // "If the Knight is mounted, move up to Far range and make a standard
    // attack against a target."
    const demo = hall('knight-of-the-realm', { x: 9, y: 4 }, 'charge');
    expect(bandTo(demo, 'foe', 'kara')).not.toBe('melee');

    for (let i = 0; i < 4 && bandTo(demo, 'foe', 'kara') !== 'melee'; i++) endTurn(demo);
    expect(demo.log.some((l) => l.text.includes('Hooves, and then the sword.'))).toBe(true);
    expect(bandTo(demo, 'foe', 'kara')).toBe('melee');
  });

  it('walks away from whoever wounded it, and stands still when nobody did', () => {
    // "When the Sorcerer takes damage from an attack, they can teleport up to
    // Far range."
    const demo = hall('fallen-sorcerer', { x: 3, y: 4 }, 'slippery');
    expect(bandTo(demo, 'kara', 'foe')).toBe('melee');
    // Whether a given swing lands is the seed's business; that the wound moves
    // the Sorcerer is not.
    for (let i = 0; i < 8 && bandTo(demo, 'kara', 'foe') === 'melee'; i++) {
      if (!demo.encounter!.canAct('kara')) endTurn(demo);
      demo.world.drawIn('kara', 'foe', 'melee', 'far');
      attackWithSelected(demo, 'foe');
    }
    const after = demo.state.entity('foe')!.tile;
    expect(bandTo(demo, 'kara', 'foe')).not.toBe('melee');

    // Damage out of a script has nobody behind it: there is nothing to get
    // away from, and the Sorcerer does not move.
    demo.world.dealDamage('foe', { amount: 9, types: ['magic'] }, demo.rng);
    settleFight(demo);
    expect(demo.state.entity('foe')!.tile).toBe(after);
  });

  it('walks to an ally rather than to itself', () => {
    // "Mark a Stress to move into Melee range of an ally and make a standard
    // attack." A creature is within Melee of itself, so a selector that counts
    // the one acting would have the Soldier reinforce nobody at all.
    const s = blank();
    s.run(addSheet(KARA));
    s.run(setSpawns('hall', [{ x: 2, y: 4 }]));
    s.run(addEncounter('hall', encounterSchema.parse({ id: 'line', name: 'The line' })));
    s.run(addAdversary('hall', 'line', { id: 'soldier', adversary: 'elite-soldier', position: { x: 8, y: 4 } }));
    s.run(addAdversary('hall', 'line', { id: 'mate', adversary: 'elite-soldier', position: { x: 4, y: 4 } }));
    const demo = buildProjectScene(s.project, 'reinforce');
    demo.askDefender = false;
    startEncounter(demo, 'line');
    demo.state.fear = { ...demo.state.fear, value: demo.state.fear.max };
    demo.state.entity('kara')!.hitPoints = { max: 60, marked: 0 };
    demo.state.entity('mate')!.stress = { max: 4, marked: 2 };

    // The selector the feature walks at, read from the Soldier's own chair.
    demo.scenario.actorId = 'soldier';
    const ally = demo.world.resolveTargets(
      { kind: 'adversaries', range: 'far', nearest: 1, except: 'actor' },
      { targets: [], hit: [] },
    );
    expect(ally).toEqual(['mate']);
    // Without leaving itself out it would name itself, and a creature is
    // always within Melee of itself: the Soldier would reinforce nobody.
    expect(
      demo.world.resolveTargets({ kind: 'adversaries', range: 'far', nearest: 1 }, { targets: [], hit: [] }),
    ).toEqual(['soldier']);
    demo.scenario.actorId = null;

    const stood = demo.state.entity('soldier')!.tile;
    for (let i = 0; i < 4 && demo.state.entity('soldier')!.tile === stood; i++) endTurn(demo);
    expect(demo.log.some((l) => l.text.includes('falls in beside one of their own'))).toBe(true);
  });

  it('cannot walk while something is holding it, either way', () => {
    const demo = hall('knight-of-the-realm', { x: 9, y: 4 }, 'held');
    const foe = demo.state.entity('foe')!;
    const stood = foe.tile;
    foe.conditions.add('restrained');
    // Restrained is Restrained whether a feature says walk or the turn does,
    // and it holds a creature closing in as firmly as one backing away.
    expect(demo.world.drawIn('foe', 'kara', 'melee', 'far')).toBeNull();
    expect(demo.world.breakAway('foe', 'kara', 'far')).toBeNull();
    for (let i = 0; i < 3; i++) endTurn(demo);
    expect(demo.state.entity('foe')!.tile).toBe(stood);

    // Loose again, and the same walk crosses the hall.
    foe.conditions.delete('restrained');
    expect(demo.world.drawIn('foe', 'kara', 'melee', 'far')).not.toBeNull();
    expect(demo.world.bandTo('foe', 'kara')).toBe('melee');
    // And away goes as far the other way as the ground allows.
    expect(demo.world.breakAway('foe', 'kara', 'far')).not.toBeNull();
    expect(demo.world.bandTo('foe', 'kara')).not.toBe('melee');
  });
});

describe('what the room makes of a roll', () => {
  /** Kara and something watching her roll, at the distance the test asks for. */
  const watched = (adversary: string, at: { x: number; y: number }, seed: string) => {
    const s = blank();
    s.run(addSheet(KARA));
    s.run(setSpawns('hall', [{ x: 2, y: 4 }]));
    s.run(addEncounter('hall', encounterSchema.parse({ id: 'watch', name: 'The watch' })));
    s.run(addAdversary('hall', 'watch', { id: 'foe', adversary, position: at }));
    const demo = buildProjectScene(s.project, seed);
    demo.askDefender = false;
    startEncounter(demo, 'watch');
    demo.state.entity('kara')!.hitPoints = { max: 60, marked: 0 };
    demo.state.entity('foe')!.hitPoints = { max: 60, marked: 0 };
    demo.party.select('kara');
    return demo;
  };

  /** Swing until the dice come up with Fear, and say what they cost. */
  const rollUntilFear = (demo: ReturnType<typeof watched>): { hope: number; fell: boolean } => {
    for (let i = 0; i < 12; i++) {
      const kara = demo.state.entity('kara')!;
      // Patched up between swings: what is under test is what the dice cost
      // her, and a Tier 3 dragon would otherwise put her down first.
      kara.hope = { max: 6, value: 6 };
      kara.hitPoints = { max: 60, marked: 0 };
      kara.stress = { max: kara.stress.max, marked: 0 };
      kara.alive = true;
      if (!demo.encounter!.canAct('kara')) endTurn(demo);
      demo.state.entity('foe')!.hitPoints = { max: 60, marked: 0 };
      const before = demo.log.length;
      attackWithSelected(demo, 'foe');
      const rolled = demo.rolls.at(-1);
      if (rolled === undefined) continue;
      const withFear = rolled.roll.outcome === 'successWithFear' || rolled.roll.outcome === 'failureWithFear';
      if (!withFear) continue;
      return {
        hope: demo.state.entity('kara')!.hope!.value,
        fell: demo.log.slice(before).some((l) => l.text.includes('The cold takes something out of them.')),
      };
    }
    throw new Error('the dice never came up with Fear');
  };

  it('takes a Hope off a roll with Fear made in front of the Dragon', () => {
    // "When a PC rolls with Fear while within Far range of the Dragon, they
    // lose a Hope."
    const demo = watched('young-ice-dragon', { x: 3, y: 4 }, 'no-hope');
    const { hope, fell } = rollUntilFear(demo);
    expect(fell).toBe(true);
    // Six going in, and the roll with Fear costs one of them.
    expect(hope).toBe(5);
  });

  it('leaves a roll made across the room alone', () => {
    // The same Dragon, out past Far range, with something in reach to swing
    // at: the dice say the same thing and the Dragon is too far to hear it.
    const s = blank();
    s.run(addSheet(KARA));
    s.run(setSpawns('hall', [{ x: 2, y: 4 }]));
    s.run(addEncounter('hall', encounterSchema.parse({ id: 'watch', name: 'The watch' })));
    s.run(addAdversary('hall', 'watch', { id: 'foe', adversary: 'young-ice-dragon', position: { x: 11, y: 7 } }));
    s.run(addAdversary('hall', 'watch', { id: 'husk', adversary: 'acid-burrower', position: { x: 3, y: 4 } }));
    const demo = buildProjectScene(s.project, 'no-hope-far');
    demo.askDefender = false;
    startEncounter(demo, 'watch');
    demo.party.select('kara');
    expect(demo.world.bandTo('foe', 'kara')).toBe('veryFar');

    for (let i = 0; i < 12; i++) {
      const kara = demo.state.entity('kara')!;
      kara.hope = { max: 6, value: 6 };
      kara.hitPoints = { max: 60, marked: 0 };
      kara.stress = { max: kara.stress.max, marked: 0 };
      kara.alive = true;
      // The Dragon stays where it was put: this is about the distance.
      demo.state.moveEntity('foe', demo.grid.indexOf(11, 7));
      if (!demo.encounter!.canAct('kara')) endTurn(demo);
      demo.state.entity('husk')!.hitPoints = { max: 60, marked: 0 };
      attackWithSelected(demo, 'husk');
      const rolled = demo.rolls.at(-1);
      if (rolled === undefined) continue;
      const withFear = rolled.roll.outcome === 'successWithFear' || rolled.roll.outcome === 'failureWithFear';
      if (!withFear) continue;
      expect(demo.log.some((l) => l.text.includes('The cold takes something out of them.'))).toBe(false);
      expect(demo.state.entity('kara')!.hope!.value).toBe(6);
      return;
    }
    throw new Error('the dice never came up with Fear');
  });

  it('reads what the roll was, not merely that there was one', () => {
    // The Demon answers a *failure* with Fear. A roll that succeeded with Fear
    // is still a roll with Fear, and it costs nothing.
    const demo = watched('minor-demon', { x: 3, y: 4 }, 'all-must-fall');
    for (let i = 0; i < 12; i++) {
      const kara = demo.state.entity('kara')!;
      kara.hope = { max: 6, value: 6 };
      kara.hitPoints = { max: 60, marked: 0 };
      kara.stress = { max: kara.stress.max, marked: 0 };
      kara.alive = true;
      if (!demo.encounter!.canAct('kara')) endTurn(demo);
      demo.state.entity('foe')!.hitPoints = { max: 60, marked: 0 };
      attackWithSelected(demo, 'foe');
      const rolled = demo.rolls.at(-1);
      if (rolled === undefined) continue;
      const hope = demo.state.entity('kara')!.hope!.value;
      if (rolled.roll.outcome === 'failureWithFear') expect(hope).toBe(5);
      if (rolled.roll.outcome === 'successWithFear') expect(hope).toBe(6);
      if (rolled.roll.outcome === 'failureWithHope') expect(hope).toBe(6);
    }
  });
});

describe('a Spellcast Roll against a target, and what it leaves on them', () => {
  /** A caster holding one card, with something to point it at. */
  const casting = (cards: readonly string[], seed: string, at: { x: number; y: number } = { x: 3, y: 4 }) => {
    const sheet = characterSheetSchema.parse(
      blankSheet('vela', 'wizard', {
        name: 'Vela',
        traits: { agility: 0, strength: -1, finesse: 1, instinct: 1, presence: 0, knowledge: 2 },
        ancestryId: 'faerie',
        armorId: 'gambeson-armor',
        primaryWeaponId: 'greatstaff',
        subclassId: 'school-of-knowledge',
        domainCards: [...cards],
      }),
    );
    const s = blank();
    // A blank project ships no cards: the SRD library is content the game
    // folds in, and an authored project has to say it wants it.
    for (const ability of SRD_ABILITIES) s.run(addAbility(ability));
    s.run(addSheet(sheet));
    s.run(setSpawns('hall', [{ x: 2, y: 4 }]));
    s.run(addEncounter('hall', encounterSchema.parse({ id: 'duel', name: 'The duel' })));
    s.run(addAdversary('hall', 'duel', { id: 'foe', adversary: 'acid-burrower', position: at }));
    const demo = buildProjectScene(s.project, seed);
    demo.askDefender = false;
    startEncounter(demo, 'duel');
    demo.state.entity('vela')!.hitPoints = { max: 60, marked: 0 };
    demo.state.entity('foe')!.hitPoints = { max: 60, marked: 0 };
    demo.party.select('vela');
    return demo;
  };

  /** Cast until the dice land it, and say whether they ever did. */
  const landed = (
    cards: readonly string[],
    ability: string,
    check: (demo: ReturnType<typeof casting>) => boolean,
    targets?: readonly string[],
  ): ReturnType<typeof casting> | null => {
    for (let seed = 1; seed < 40; seed++) {
      const demo = casting(cards, `${ability}-${seed}`);
      const used = useAbility(demo, 'vela', ability, targets);
      if (used.status === 'refused') throw new Error(`${ability}: ${demo.log.at(-1)?.text ?? 'refused'}`);
      if (used.status === 'waiting') answerPending(demo, { kind: 'roll' });
      while (demo.pending?.kind === 'script') answerPending(demo, { kind: 'choose', index: 1 });
      if (check(demo)) return demo;
    }
    return null;
  };

  it('binds them where they stand, and the binding lasts one spotlight', () => {
    // "On a success, they're temporarily Restrained and must mark a Stress."
    const demo = landed(['book-of-norai'], 'mystic-tether', (d) =>
      d.state.entity('foe')!.conditions.has('restrained'),
    );
    expect(demo).not.toBeNull();
    expect(demo!.state.entity('foe')!.stress.marked).toBe(1);
    // "Temporarily" on an adversary is exactly one spotlight: it spends the
    // turn tearing free rather than swinging.
    endTurn(demo!);
    expect(demo!.state.entity('foe')!.conditions.has('restrained')).toBe(false);
  });

  it('fixes their attention on the caster, which is worth two Evasion', () => {
    // "They become temporarily Enraptured." What the condition does is on the
    // condition, so the card only has to put the name on them.
    const demo = landed(['enrapture'], 'enrapture', (d) => d.state.entity('foe')!.conditions.has('enraptured'));
    expect(demo).not.toBeNull();
    const held = demo!.world.defenderOf(demo!.state.entity('foe')!).difficulty;
    const free = casting(['enrapture'], 'plain');
    expect(held).toBe(free.world.defenderOf(free.state.entity('foe')!).difficulty - 2);
  });

  it('holds the whole room, and lets go of all of them at once', () => {
    // A seed where the song lands *and* the spotlight stays with the party,
    // so the second half is a move Vela can still make.
    const demo = landed(
      ['mass-enrapture'],
      'mass-enrapture',
      (d) => d.state.entity('foe')!.conditions.has('enraptured') && d.encounter!.view().side === 'party',
    );
    expect(demo).not.toBeNull();
    // "Mark a Stress to force all Enraptured targets to mark a Stress, ending
    // this spell": the spell ends because the condition comes off with it.
    const before = demo!.state.entity('foe')!.stress.marked;
    demo!.party.select('vela');
    expect(useAbility(demo!, 'vela', 'mass-enrapture-hold').status).toBe('done');
    expect(demo!.state.entity('foe')!.stress.marked).toBe(before + 1);
    expect(demo!.state.entity('foe')!.conditions.has('enraptured')).toBe(false);
  });

  it('will not tighten a song nobody is under', () => {
    // The second half of Enrapture is aimed at whoever is already held, which
    // is a gate on the target rather than on the card.
    const demo = casting(['enrapture'], 'not-yet');
    const card = abilitiesOf(demo, 'vela').find((a) => a.id === 'enrapture-hold')!;
    expect(abilityTargets(demo, 'vela', card)).toEqual([]);
    demo.state.entity('foe')!.conditions.add('enraptured');
    expect(abilityTargets(demo, 'vela', card)).toEqual(['foe']);
  });
});

describe('a number read off a pool', () => {
  /** Kara toe to toe with something, the fight already on. */
  const facing = (adversary: string, seed: string) => {
    const s = blank();
    s.run(addSheet(KARA));
    s.run(setSpawns('hall', [{ x: 2, y: 4 }]));
    s.run(addEncounter('hall', encounterSchema.parse({ id: 'duel', name: 'The duel' })));
    s.run(addAdversary('hall', 'duel', { id: 'foe', adversary, position: { x: 3, y: 4 } }));
    const demo = buildProjectScene(s.project, seed);
    demo.askDefender = false;
    startEncounter(demo, 'duel');
    demo.state.entity('kara')!.hitPoints = { max: 90, marked: 0 };
    demo.party.select('kara');
    return demo;
  };

  it('puts what the Demon has lost behind the claws, and nothing when it is whole', () => {
    // "A bonus to the damage roll equal to the Demon's current number of
    // marked HP." Two runs of the same fixture and the same seed, the only
    // difference being what has been taken out of the Demon.
    const reap = (marked: number): string => {
      const demo = facing('minor-demon', 'reaper');
      demo.state.entity('foe')!.hitPoints = { max: 8, marked };
      demo.state.entity('foe')!.stress = { max: 4, marked: 0 };
      endTurn(demo);
      expect(demo.log.some((l) => l.text.includes('Claws'))).toBe(true);
      return demo.log.map((l) => l.text).join(' | ');
    };
    expect(reap(3)).toContain('The blow lands harder by 3.');
    // Whole, it says nothing at all - and keeps the Stress it would have paid.
    const whole = reap(0);
    expect(whole).not.toContain('lands harder');
    expect(whole).not.toContain('behind the claws');
  });

  it('hands back exactly the wound it took', () => {
    // "Cause the attacker to mark the same number of HP", which is a count the
    // blow carries rather than a pool - but the Fear it costs is one either way.
    const demo = facing('demon-of-jealousy', 'my-turn');
    demo.state.entity('foe')!.hitPoints = { max: 90, marked: 0 };
    demo.state.fear = { ...demo.state.fear, value: demo.state.fear.max };
    const before = demo.state.entity('kara')!.hitPoints.marked;
    demo.world.noteDamage('foe', { attacker: 'kara', hitPoints: 2, damage: 20, types: ['physical'] });
    settleFight(demo);
    expect(demo.log.some((l) => l.text.includes('will not be the only one bleeding'))).toBe(true);
    expect(demo.state.entity('kara')!.hitPoints.marked - before).toBe(2);
  });
});

describe('the blow that has landed and not yet been counted', () => {
  /** One thing swinging at Kara, and optionally somebody watching. */
  const swinging = (adversary: string, seed: string, bystander?: { id: string; adversary: string; at: { x: number; y: number } }) => {
    const s = blank();
    s.run(addSheet(KARA));
    s.run(setSpawns('hall', [{ x: 2, y: 4 }]));
    s.run(addEncounter('hall', encounterSchema.parse({ id: 'duel', name: 'The duel' })));
    s.run(addAdversary('hall', 'duel', { id: 'foe', adversary, position: { x: 3, y: 4 } }));
    if (bystander !== undefined) {
      s.run(addAdversary('hall', 'duel', { id: bystander.id, adversary: bystander.adversary, position: bystander.at }));
    }
    const demo = buildProjectScene(s.project, seed);
    demo.askDefender = false;
    startEncounter(demo, 'duel');
    demo.state.entity('kara')!.hitPoints = { max: 90, marked: 0 };
    demo.state.entity('foe')!.hitPoints = { max: 90, marked: 0 };
    demo.party.select('kara');
    return demo;
  };

  it('adds the ten only when there is a Stress to pay for it', () => {
    // "Before rolling damage for the Construct's attack, mark a Stress to gain
    // a +10 bonus." The same fixture and the same seed twice over, the only
    // difference being whether the Construct can afford the Stress.
    const swing = (stress: number): { marked: number; overloaded: boolean } => {
      const demo = swinging('construct', 'overload');
      demo.state.entity('foe')!.stress = { max: 4, marked: stress };
      const before = demo.state.entity('kara')!.hitPoints.marked;
      endTurn(demo);
      expect(demo.log.some((l) => l.text.includes('Fist Slam hits'))).toBe(true);
      return {
        marked: demo.state.entity('kara')!.hitPoints.marked - before,
        overloaded: demo.log.some((l) => l.text.includes('The blow lands harder by 10')),
      };
    };
    const spent = swing(0);
    const broke = swing(4);
    expect(spent.overloaded).toBe(true);
    // Nothing left to mark, nothing added: the same hit, ten lighter.
    expect(broke.overloaded).toBe(false);
    // A Fist Slam is 1d20; ten more of it is worth at least one more threshold.
    expect(spent.marked).toBeGreaterThan(broke.marked);
  });

  it("lets a Turret fire into somebody else's hit, but never into its own", () => {
    // "When another adversary deals damage to a target within Far range of the
    // Turret." The Turret is standing off, the Zombie does the hitting.
    const demo = swinging('brawny-zombie', 'concentrate', {
      id: 'turret',
      adversary: 'vault-guardian-turret',
      at: { x: 6, y: 4 },
    });
    demo.state.entity('turret')!.hitPoints = { max: 90, marked: 0 };
    demo.state.fear = { ...demo.state.fear, value: demo.state.fear.max };
    for (let i = 0; i < 6 && !demo.log.some((l) => l.text.includes('swings around and fires')); i++) {
      demo.state.entity('kara')!.hitPoints = { max: 90, marked: 0 };
      demo.state.entity('kara')!.stress = { max: 6, marked: 0 };
      demo.state.entity('kara')!.alive = true;
      demo.world.addTokens('foe', 'slow', 1);
      endTurn(demo);
    }
    expect(demo.log.some((l) => l.text.includes('swings around and fires'))).toBe(true);
    expect(demo.log.some((l) => l.text.includes('The blow lands harder by'))).toBe(true);

    // Parked out past Far, the same Turret says nothing: the gate is read from
    // the Turret's chair to whoever is being hit, not from the attacker's -
    // where everyone is always in range, a hit having just landed.
    const distant = swinging('brawny-zombie', 'concentrate-far', {
      id: 'turret',
      adversary: 'vault-guardian-turret',
      at: { x: 18, y: 16 },
    });
    distant.state.entity('turret')!.hitPoints = { max: 90, marked: 0 };
    distant.state.fear = { ...distant.state.fear, value: distant.state.fear.max };
    for (let i = 0; i < 6; i++) {
      distant.state.entity('kara')!.hitPoints = { max: 90, marked: 0 };
      distant.state.entity('kara')!.stress = { max: 6, marked: 0 };
      distant.state.entity('kara')!.alive = true;
      distant.world.addTokens('foe', 'slow', 1);
      endTurn(distant);
    }
    expect(distant.log.some((l) => l.text.includes('Slam'))).toBe(true);
    expect(distant.log.some((l) => l.text.includes('swings around and fires'))).toBe(false);

    // And on its own Magitech Cannon it says nothing: the feature is about
    // another adversary's blow, and the trigger it answers is the other one.
    const alone = swinging('vault-guardian-turret', 'turret-alone');
    for (let i = 0; i < 4; i++) {
      alone.state.entity('kara')!.hitPoints = { max: 90, marked: 0 };
      alone.state.entity('kara')!.alive = true;
      alone.world.addTokens('foe', 'slow-firing', 1);
      endTurn(alone);
    }
    expect(alone.log.some((l) => l.text.includes("Magitech Cannon"))).toBe(true);
    expect(alone.log.some((l) => l.text.includes('swings around and fires'))).toBe(false);
  });
});

describe('one of its own, standing beside the target', () => {
  /** Kara with two of a kind on her, or one of them standing off. */
  const pack = (adversary: string, seed: string, together = true) => {
    const s = blank();
    s.run(addSheet(KARA));
    s.run(setSpawns('hall', [{ x: 2, y: 4 }]));
    s.run(addEncounter('hall', encounterSchema.parse({ id: 'duel', name: 'The duel' })));
    s.run(addAdversary('hall', 'duel', { id: 'foe', adversary, position: { x: 3, y: 4 } }));
    s.run(addAdversary('hall', 'duel', { id: 'pack-mate', adversary, position: together ? { x: 2, y: 5 } : { x: 12, y: 14 } }));
    const demo = buildProjectScene(s.project, seed);
    demo.askDefender = false;
    startEncounter(demo, 'duel');
    demo.state.entity('kara')!.hitPoints = { max: 60, marked: 0 };
    demo.state.entity('foe')!.hitPoints = { max: 60, marked: 0 };
    demo.state.entity('pack-mate')!.hitPoints = { max: 60, marked: 0 };
    demo.party.select('kara');
    return demo;
  };

  it('swaps the dice only while another of its own is on the target', () => {
    // "If the Wolf makes a successful standard attack and another Dire Wolf is
    // within Melee range of the target, deal 1d6+5 instead."
    const together = pack('dire-wolf', 'wolves');
    expect(together.world.standardAttackOf('dire-wolf', { attacker: 'foe', target: 'kara' }).damage).toMatchObject({
      count: 1,
      sides: 6,
      modifier: 5,
    });

    const alone = pack('dire-wolf', 'lone-wolf', false);
    expect(alone.world.standardAttackOf('dire-wolf', { attacker: 'foe', target: 'kara' }).damage).toBeUndefined();
  });

  it('does not count the one asking', () => {
    // A creature is within Melee of itself, so a Wolf with nobody beside it
    // would otherwise be its own pack.
    const alone = pack('dire-wolf', 'self-count', false);
    alone.state.entity('pack-mate')!.alive = false;
    expect(
      alone.world.resolveTargets(
        { kind: 'adversaries', range: 'melee', around: 'target', except: 'actor', sameKind: true },
        { targets: ['kara'], hit: ['kara'] },
      ),
    ).toEqual([]);
  });

  it('counts its own kind, not whoever else is standing there', () => {
    // "Another *Sylvan Soldier*": a Wolf beside the target is not a Soldier.
    const s = blank();
    s.run(addSheet(KARA));
    s.run(setSpawns('hall', [{ x: 2, y: 4 }]));
    s.run(addEncounter('hall', encounterSchema.parse({ id: 'duel', name: 'The duel' })));
    s.run(addAdversary('hall', 'duel', { id: 'foe', adversary: 'sylvan-soldier', position: { x: 3, y: 4 } }));
    s.run(addAdversary('hall', 'duel', { id: 'stranger', adversary: 'dire-wolf', position: { x: 2, y: 5 } }));
    const demo = buildProjectScene(s.project, 'mixed');
    demo.askDefender = false;
    startEncounter(demo, 'duel');
    demo.party.select('kara');
    expect(demo.world.standardAttackOf('sylvan-soldier', { attacker: 'foe', target: 'kara' }).damage).toBeUndefined();
  });

  it('eats one of its own, but only with a wound to close', () => {
    // "When the Vampire is within Melee range of an ally, they can cause the
    // ally to mark a HP. The Vampire then clears a HP." Somebody beside it is
    // a count of creatures; a reason to bite is a pool on itself.
    const fed = (marked: number): ReturnType<typeof pack> => {
      const demo = pack('head-vampire', `vampire-${marked}`);
      // One Fear: enough to spotlight the second Vampire, not enough for The
      // Hunt Is On, which would otherwise be the first thing it reaches for.
      demo.state.fear = { ...demo.state.fear, value: 1 };
      demo.state.entity('foe')!.hitPoints = { max: 12, marked };
      demo.state.entity('pack-mate')!.hitPoints = { max: 12, marked: 0 };
      demo.world.drawIn('pack-mate', 'foe', 'melee', 'far');
      endTurn(demo);
      return demo;
    };

    const hungry = fed(3);
    expect(hungry.log.some((l) => l.text.includes('takes what it needs'))).toBe(true);
    expect(hungry.state.entity('foe')!.hitPoints.marked).toBe(2);
    expect(hungry.state.entity('pack-mate')!.hitPoints.marked).toBe(1);

    // Whole, it has nothing to close, and its followers keep their blood.
    const whole = fed(0);
    expect(whole.log.some((l) => l.text.includes('takes what it needs'))).toBe(false);
    expect(whole.state.entity('pack-mate')!.hitPoints.marked).toBe(0);
  });

  it('takes the Fear on the hit, and only with the pack there', () => {
    // "…and you gain a Fear", which only the Wolf's half says. The Fear itself
    // is hard to read off a finished turn - the GM spends it again to spotlight
    // the second Wolf - so what is asserted is the rider running at all.
    const closed = (demo: ReturnType<typeof pack>): boolean => {
      for (let i = 0; i < 8; i++) {
        const kara = demo.state.entity('kara')!;
        kara.hitPoints = { max: 60, marked: 0 };
        kara.stress = { max: 6, marked: 0 };
        kara.alive = true;
        endTurn(demo);
      }
      // A Wolf that never got its claws in says nothing either way, so the
      // lone half only means something once it has swung.
      expect(demo.log.some((l) => l.text.includes('Claws'))).toBe(true);
      return demo.log.some((l) => l.text.includes('The pack closes'));
    };
    expect(closed(pack('dire-wolf', 'wolf-fear'))).toBe(true);
    expect(closed(pack('dire-wolf', 'wolf-alone', false))).toBe(false);
  });
});

describe('a token on the stat block', () => {
  /** A slow thing standing next to Kara, the fight already on. */
  const winding = (adversary: string, seed: string, second = false) => {
    const s = blank();
    s.run(addSheet(KARA));
    s.run(setSpawns('hall', [{ x: 2, y: 4 }]));
    s.run(addEncounter('hall', encounterSchema.parse({ id: 'duel', name: 'The duel' })));
    s.run(addAdversary('hall', 'duel', { id: 'foe', adversary, position: { x: 3, y: 4 } }));
    if (second) s.run(addAdversary('hall', 'duel', { id: 'other', adversary, position: { x: 2, y: 5 } }));
    const demo = buildProjectScene(s.project, seed);
    demo.askDefender = false;
    startEncounter(demo, 'duel');
    demo.state.entity('kara')!.hitPoints = { max: 60, marked: 0 };
    demo.state.entity('foe')!.hitPoints = { max: 60, marked: 0 };
    demo.party.select('kara');
    return demo;
  };

  /** Every line the GM's turn wrote, and the tokens left behind. */
  const spotlight = (demo: ReturnType<typeof winding>): { said: string; tokens: number } => {
    const at = demo.log.length;
    endTurn(demo);
    return {
      said: demo.log.slice(at).map((l) => l.text).join(' '),
      tokens: demo.world.tokensOn('foe', 'slow'),
    };
  };

  it('spends one spotlight winding up and the next one swinging', () => {
    // "When you spotlight the Zombie and they don't have a token on their stat
    // block, they can't act yet." The Zombie's attack is its Slam, so whether
    // it swung is whether Slam is in the log - a miss says so as loudly as a
    // hit, which a Hit Point count would not.
    const demo = winding('brawny-zombie', 'slow-zombie');
    const first = spotlight(demo);
    expect(first.tokens).toBe(1);
    expect(first.said).toContain('gathers itself');
    expect(first.said).not.toContain('Slam');

    const second = spotlight(demo);
    expect(second.tokens).toBe(0);
    expect(second.said).toContain('Slam');

    // And it is a cycle, not a one-off toll at the door.
    const third = spotlight(demo);
    expect(third.tokens).toBe(1);
    expect(third.said).not.toContain('Slam');
  });

  it('counts the token on the creature, not on the card', () => {
    // One card for four stat blocks: two Zombies winding up separately do not
    // hand each other a turn.
    const demo = winding('brawny-zombie', 'two-zombies', true);
    demo.state.entity('other')!.hitPoints = { max: 60, marked: 0 };
    demo.world.addTokens('other', 'slow', 1);
    demo.state.fear = { ...demo.state.fear, value: demo.state.fear.max };
    endTurn(demo);
    expect(demo.world.tokensOn('foe', 'slow')).toBe(1);
    expect(demo.world.tokensOn('other', 'slow')).toBe(0);
  });

  it('hands the token to whoever it hit, and takes it back when it is torn apart', () => {
    // "Give the target a bramble token. If a target has any bramble tokens,
    // they are Restrained. If a target has 3 or more, they are also
    // Vulnerable." The same store, on a creature the block does not own.
    const demo = winding('tangle-bramble-swarm', 'brambles');
    const kara = demo.state.entity('kara')!;
    const brambles = (): number => demo.world.tokensOn('kara', 'tangle-bramble-swarm-encumber');
    for (let i = 0; i < 24 && brambles() < 3; i++) {
      kara.hitPoints = { max: 60, marked: 0 };
      kara.stress = { max: 6, marked: 0 };
      kara.conditions.delete('restrained');
      endTurn(demo);
    }
    expect(brambles()).toBe(3);
    expect(kara.conditions.has('restrained')).toBe(true);
    expect(kara.conditions.has('vulnerable')).toBe(true);

    // "All bramble tokens can be removed by dealing Major or greater damage to
    // the Swarm": two Hit Points is Major, and the thorns come off.
    demo.world.noteDamage('foe', { attacker: 'kara', hitPoints: 2, damage: 8, types: ['physical'] });
    settleFight(demo);
    expect(demo.log.some((l) => l.text.includes('the thorns fall away'))).toBe(true);
    expect(brambles()).toBe(0);
    expect(kara.conditions.has('restrained')).toBe(false);
    expect(kara.conditions.has('vulnerable')).toBe(false);
  });

  it('spends the Stress only on somebody carrying enough of them', () => {
    // "Mark a Stress to deal 2d6+8 direct physical damage to a target with 3
    // or more bramble tokens." The GM aims at the nearest creature in reach,
    // so without a gate on the target it would pay for the wrong one.
    const short = winding('tangle-bramble-swarm', 'crush-short');
    short.world.addTokens('kara', 'tangle-bramble-swarm-encumber', 2);
    const before = short.state.entity('foe')!.stress.marked;
    endTurn(short);
    expect(short.log.some((l) => l.text.includes('The brambles close and squeeze'))).toBe(false);
    expect(short.state.entity('foe')!.stress.marked).toBe(before);

    const ready = winding('tangle-bramble-swarm', 'crush-ready');
    ready.world.addTokens('kara', 'tangle-bramble-swarm-encumber', 3);
    endTurn(ready);
    expect(ready.log.some((l) => l.text.includes('The brambles close and squeeze'))).toBe(true);
  });

  it('leaves the thorns on for a scratch', () => {
    // One Hit Point is Minor, and Minor is not "Major or greater".
    const demo = winding('tangle-bramble-swarm', 'brambles-scratch');
    demo.world.addTokens('kara', 'tangle-bramble-swarm-encumber', 2);
    demo.world.noteDamage('foe', { attacker: 'kara', hitPoints: 1, damage: 4, types: ['physical'] });
    settleFight(demo);
    expect(demo.world.tokensOn('kara', 'tangle-bramble-swarm-encumber')).toBe(2);
  });

  it('takes the whole turn, not just the swing', () => {
    // Simplified, and worth pinning: the Turret's block only forbids its
    // standard attack while it winds, but nothing here can take the swing away
    // and leave the turn standing, so Mark Target waits too.
    const demo = winding('vault-guardian-turret', 'turret');
    const first = spotlight(demo);
    expect(demo.world.tokensOn('foe', 'slow-firing')).toBe(1);
    expect(first.said).toContain('winding up');
    expect(first.said).not.toContain('Magitech Cannon');
  });
});

describe("what a block's own teeth do to this target", () => {
  /** Kara in reach of something, the fight already on. */
  const facing = (adversary: string, seed: string) => {
    const s = blank();
    s.run(addSheet(KARA));
    s.run(setSpawns('hall', [{ x: 2, y: 4 }]));
    s.run(addEncounter('hall', encounterSchema.parse({ id: 'duel', name: 'The duel' })));
    s.run(addAdversary('hall', 'duel', { id: 'foe', adversary, position: { x: 3, y: 4 } }));
    const demo = buildProjectScene(s.project, seed);
    demo.askDefender = false;
    startEncounter(demo, 'duel');
    demo.state.entity('kara')!.hitPoints = { max: 60, marked: 0 };
    demo.state.entity('foe')!.hitPoints = { max: 60, marked: 0 };
    demo.party.select('kara');
    return demo;
  };

  it('swaps the dice for the ones the passive names, and only while it holds', () => {
    // "If the Sniper is Hidden when they make a successful standard attack,
    // they deal 1d10+4 physical damage instead of their standard damage."
    const demo = facing('jagged-knife-sniper', 'unseen');
    const plain = demo.world.standardAttackOf('jagged-knife-sniper', { attacker: 'foe', target: 'kara' });
    expect(plain.damage).toBeUndefined();

    demo.state.entity('foe')!.conditions.add('hidden');
    const hidden = demo.world.standardAttackOf('jagged-knife-sniper', { attacker: 'foe', target: 'kara' });
    expect(hidden.damage).toMatchObject({ count: 1, sides: 10, modifier: 4 });
  });

  it('doubles what the dice said against a target with nothing left to hope for', () => {
    // "The Demon deals double damage to PCs with 0 Hope."
    const demo = facing('demon-of-despair', 'despair');
    const kara = demo.state.entity('kara')!;
    kara.hope = { max: 6, value: 3 };
    expect(demo.world.standardAttackOf('demon-of-despair', { attacker: 'foe', target: 'kara' }).double).toBeUndefined();

    kara.hope = { max: 6, value: 0 };
    expect(demo.world.standardAttackOf('demon-of-despair', { attacker: 'foe', target: 'kara' }).double).toBe(true);

    // And what lands is twice what the dice said: the same fixture and the
    // same seed twice over, the only difference being the Hope left in her.
    const swing = (hope: number): number => {
      const twin = facing('demon-of-despair', 'despair-twin');
      twin.state.entity('kara')!.hope = { max: 6, value: hope };
      twin.scenario.actorId = 'foe';
      const summary = twin.world.attack({ attacker: 'foe', target: 'kara', weapon: 'primary' }, twin.rng);
      expect(summary.refused).toBeNull();
      return summary.damage ?? 0;
    };
    const hopeful = swing(3);
    expect(hopeful).toBeGreaterThan(0);
    expect(swing(0)).toBe(hopeful * 2);
  });

  it('marks a target for the Seraph, and the Archer reads the mark', () => {
    // "Spend a Fear to make a target Guilty…" and "the Archer deals double
    // damage to targets marked Guilty by a High Seraph".
    const demo = facing('high-seraph', 'judgment');
    demo.state.fear = { ...demo.state.fear, value: demo.state.fear.max };
    for (let i = 0; i < 4 && !demo.state.entity('kara')!.conditions.has('guilty'); i++) {
      demo.state.entity('kara')!.hitPoints = { max: 60, marked: 0 };
      demo.state.entity('kara')!.alive = true;
      endTurn(demo);
    }
    expect(demo.log.some((l) => l.text.includes('The Seraph names them'))).toBe(true);
    expect(demo.state.entity('kara')!.conditions.has('guilty')).toBe(true);
    // A different block, the same mark: what the Seraph named, the Archer punishes.
    expect(demo.world.standardAttackOf('hallowed-archer', { attacker: 'foe', target: 'kara' }).double).toBe(true);
  });
});

describe('a Demon rallying Relentless allies', () => {
  /** A Demon of Hubris and two Minor Demons, who can each be spotlighted twice. */
  const pit = (fear: number, seed: string) => {
    const s = blank();
    s.run(addSheet(KARA));
    s.run(setSpawns('hall', [{ x: 2, y: 4 }]));
    s.run(addEncounter('hall', encounterSchema.parse({ id: 'pit', name: 'The pit' })));
    s.run(addAdversary('hall', 'pit', { id: 'hubris', adversary: 'demon-of-hubris', position: { x: 7, y: 4 } }));
    s.run(addAdversary('hall', 'pit', { id: 'imp-1', adversary: 'minor-demon', position: { x: 7, y: 3 } }));
    s.run(addAdversary('hall', 'pit', { id: 'imp-2', adversary: 'minor-demon', position: { x: 7, y: 5 } }));
    const demo = buildProjectScene(s.project, seed);
    demo.askDefender = false;
    startEncounter(demo, 'pit');
    demo.state.fear = { ...demo.state.fear, value: fear };
    demo.state.entity('kara')!.hitPoints = { max: 40, marked: 0 };
    demo.party.select('kara');
    return demo;
  };

  it('lets the second one act, though the first could have been spotlighted again', () => {
    // Exactly the Fear the feature costs. A Relentless ally keeps its place at
    // the head of the queue after its granted spotlight, and the GM cannot
    // afford the second one - which must not end the turn while somebody
    // behind it is standing on a spotlight the Demon already paid for.
    const demo = pit(1, 'hubris');
    endTurn(demo);

    expect(demo.log.some((l) => l.text.includes('uses The Root of Villainy'))).toBe(true);
    const acted = demo.encounter!.log.filter((e) => e.kind === 'adversaryActed') as { id: string }[];
    expect(acted.filter((e) => e.id === 'imp-1')).toHaveLength(1);
    expect(acted.filter((e) => e.id === 'imp-2')).toHaveLength(1);
  });
});

describe('what a feature calls in and spotlights', () => {
  it('acts on the turn it arrived, on the Fear the feature already spent', () => {
    const s = blank();
    s.run(addSheet(KARA));
    s.run(setSpawns('hall', [{ x: 2, y: 4 }]));
    s.run(addEncounter('hall', encounterSchema.parse({ id: 'crypt', name: 'The crypt' })));
    s.run(addAdversary('hall', 'crypt', { id: 'lord', adversary: 'head-vampire', position: { x: 7, y: 4 } }));
    const demo = buildProjectScene(s.project, 'the-hunt');
    demo.askDefender = false;
    startEncounter(demo, 'crypt');
    // Exactly what "The Hunt Is On" costs, and not a Fear more: what it calls
    // in was paid for by the feature, so the turn must not stop billing for it.
    demo.state.fear = { ...demo.state.fear, value: 2 };
    demo.state.entity('kara')!.hitPoints = { max: 40, marked: 0 };
    endTurn(demo);

    expect(demo.log.some((l) => l.text.includes('uses The Hunt Is On'))).toBe(true);
    const arrivals = demo.state.entitiesOf('adversary').filter((e) => e.definition === 'vampire');
    expect(arrivals.length).toBeGreaterThan(0);
    const acted = demo.encounter!.log.filter((e) => e.kind === 'adversaryActed') as { id: string; fearSpent: number }[];
    for (const arrival of arrivals) {
      expect(acted.filter((e) => e.id === arrival.id)).toHaveLength(1);
      expect(acted.find((e) => e.id === arrival.id)!.fearSpent).toBe(0);
    }
  });
});

describe('a Necromancer who buys their troops a turn', () => {
  /**
   * "Attacks they make while spotlighted in this way deal half damage."
   *
   * Two runs of the same seed, the second with the shipped feature overridden
   * by one that rallies without the rider, so the only difference between them
   * is the halving. A Fallen Shock Troop hits for 12, which crosses a level 1
   * Guardian's Major threshold going full and does not going half.
   */
  const gates = (half: boolean) => {
    const s = blank();
    s.run(addSheet(KARA));
    s.run(setSpawns('hall', [{ x: 2, y: 4 }]));
    s.run(addEncounter('hall', encounterSchema.parse({ id: 'lists', name: 'The gates' })));
    s.run(addAdversary('hall', 'lists', { id: 'necromancer', adversary: 'arch-necromancer', position: { x: 7, y: 4 } }));
    s.run(addAdversary('hall', 'lists', { id: 'troop-1', adversary: 'fallen-shock-troop', position: { x: 6, y: 3 } }));
    s.run(addAdversary('hall', 'lists', { id: 'troop-2', adversary: 'fallen-shock-troop', position: { x: 6, y: 5 } }));
    if (!half) {
      s.project.abilities.push(
        abilitySchema.parse({
          id: 'arch-necromancer-dance-of-death',
          name: 'Dance of Death',
          source: { kind: 'adversary', adversaries: ['arch-necromancer'] },
          cost: { stress: 1 },
          target: { kind: 'none', range: 'far' },
          inCombatOnly: true,
          effects: [{ kind: 'spotlight', targets: { kind: 'adversaries', range: 'far' }, count: '1d4+1' }],
        }),
      );
    }
    const demo = buildProjectScene(s.project, 'the-lists');
    demo.askDefender = false;
    startEncounter(demo, 'lists');
    demo.state.entity('kara')!.hitPoints = { max: 40, marked: 0 };
    endTurn(demo);
    return demo;
  };

  it('halves what they deal on the turn they were handed', () => {
    const halved = gates(true);
    expect(halved.log.some((l) => l.text.includes('uses Dance of Death'))).toBe(true);
    expect(halved.log.filter((l) => l.text.includes("somebody else's word")).length).toBeGreaterThan(0);

    const full = gates(false);
    expect(full.log.some((l) => l.text.includes("somebody else's word"))).toBe(false);
    // Same seed, same swings; the rider is the whole difference.
    expect(halved.state.entity('kara')!.hitPoints.marked).toBeLessThan(
      full.state.entity('kara')!.hitPoints.marked,
    );
  });

  it('carries the half through the turn it bought and no further', () => {
    // A Necromancer rallies two Minor Demons, who are Relentless (2): each
    // takes the spotlight it was handed and then a second the GM pays a Fear
    // for. The whole turn, on one seed, because the claim is about which of
    // the four swings is at half strength and which is not.
    const s = blank();
    s.run(addSheet(KARA));
    s.run(setSpawns('hall', [{ x: 2, y: 4 }]));
    s.run(addEncounter('hall', encounterSchema.parse({ id: 'gates', name: 'The gates' })));
    s.run(addAdversary('hall', 'gates', { id: 'necromancer', adversary: 'arch-necromancer', position: { x: 7, y: 4 } }));
    s.run(addAdversary('hall', 'gates', { id: 'imp-1', adversary: 'minor-demon', position: { x: 6, y: 3 } }));
    s.run(addAdversary('hall', 'gates', { id: 'imp-2', adversary: 'minor-demon', position: { x: 6, y: 5 } }));
    const demo = buildProjectScene(s.project, 'dance');
    demo.askDefender = false;
    startEncounter(demo, 'gates');
    demo.state.fear = { ...demo.state.fear, value: 3 };
    demo.state.entity('kara')!.hitPoints = { max: 60, marked: 0 };
    endTurn(demo);

    expect(demo.log.map((l) => l.text)).toEqual([
      'The Arch-Necromancer uses Dance of Death.',
      'Minor Demon, Minor Demon are called into the fight, striking for half.',
      "The Minor Demon's Claws misses Kara.",
      'The GM gains 1 Fear.',
      "The Minor Demon's Claws hits Kara: 1 Hit Point.",
      "The Minor Demon's Claws misses Kara.",
      "The Minor Demon's Claws misses Kara.",
    ]);
    // Four swings for two demons: the two the Necromancer bought, and one
    // more each that the GM paid a Fear for. The hit landed on a paid
    // spotlight, so nothing says it struck for half.
    const acted = demo.encounter!.log.filter((e) => e.kind === 'adversaryActed') as { id: string; fearSpent: number }[];
    expect(acted.filter((e) => e.id === 'imp-1')).toHaveLength(2);
    expect(acted.filter((e) => e.id === 'imp-2')).toHaveLength(2);
    expect(acted.filter((e) => e.fearSpent > 0)).toHaveLength(2);
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

  /**
   * Kara swings, taking the spotlight back first if a roll with Fear lost it -
   * and closing the ground again first, because a Sorcerer that answers a
   * wound by teleporting away is a Sorcerer somebody has to walk back to.
   */
  const swing = (demo: ReturnType<typeof ruin>): void => {
    if (!demo.encounter!.canAct('kara')) endTurn(demo);
    demo.world.drawIn('kara', 'foe', 'melee', 'far');
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

  it('spends the one Fear the feature costs, not one for every rat that piles in', () => {
    // Three rats, all of them close enough to join: the whole pack acts on the
    // one feature, so nothing else in the turn is left to spend Fear on.
    const demo = hall([{ x: 7, y: 4 }, { x: 7, y: 3 }, { x: 7, y: 5 }], 6);
    const before = demo.state.fear.value;
    endTurn(demo);
    expect(demo.log.some((l) => l.text.includes('3 of them at once'))).toBe(true);
    // "Spend a Fear to choose a target and spotlight all Giant Rats within
    // Close range": the Fear buys the whole pack's one shared bite. The rats
    // that joined have had their spotlight, and the GM pays for it once.
    expect(before - demo.state.fear.value).toBe(1);
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
