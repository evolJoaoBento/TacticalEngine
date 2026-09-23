import { describe, it, expect } from 'vitest';
import { blankScene } from '../engine/scene/grid-from-scene';
import { encounterSchema, interactableSchema, projectSchema, sceneSchema } from '../engine/scene/schema';
import { itemSchema, lootTableSchema } from '../engine/content/items';
import { abilitySchema } from '../engine/content/abilities';
import { conditionDefSchema } from '../engine/content/conditions';
import { blankSheet } from '../engine/character/sheet';
import { characterSheetSchema } from '../engine/character/sheet-schema';
import { addAbility, addCardWithAbility } from './card-edits';
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
import { FIXTURE_ADVERSARIES, FIXTURE_CARDS } from '../../tests/fixtures/adversaries';
import { FIXTURE_CONDITIONS } from '../../tests/fixtures/conditions';
import {
  ANSWERING_CARD,
  AN_ANSWER_TO_A_BLOW_ON_AN_ALLY,
  A_SHARE_OF_WHAT_THEY_CARRY,
  A_SPEND_OF_WHATEVER_IS_ON_THE_CARD,
  A_TALLY_THAT_COUNTS_A_MARK,
  A_BLAST_AROUND_WHAT_IT_HIT,
  A_GLYPH_THAT_OPENS_THEM_UP,
  A_HOLD_ON_ONE_OF_THEM,
  A_HOLD_ON_THE_WHOLE_ROOM,
  A_TETHER_THAT_BINDS,
  BLAST_ABILITY,
  BLAST_CARD,
  CHAOS_ABILITY,
  CHAOS_CARD,
  GLYPHED,
  GLYPHED_CONDITION,
  GLYPH_ABILITY,
  GLYPH_CARD,
  HELD,
  HELD_ABILITY,
  HELD_CARD,
  HELD_CONDITION,
  HELD_TIGHTEN,
  MARKED,
  MARKED_TALLY_CARD,
  ROOM_HELD_ABILITY,
  ROOM_HELD_CARD,
  ROOM_HELD_RELEASE,
  SHARE_ABILITY,
  SHARING_CARD,
  TALLY,
  TETHER_ABILITY,
  TETHER_CARD,
  A_BLOW_FORCED_FROM_ITS_OWN_WOUNDS,
  A_BONUS_OFF_THE_SHEET,
  A_CHARGE_THAT_BANKS_A_WOUND,
  A_CRACK_PAID_FOR_IN_ADVANCE,
  A_CRITICAL_WORTH_SOMETHING,
  A_FLOOR_UNDER_EVERY_BLOW,
  A_LIFT_FOR_EVERYONE_NEARBY,
  A_ROUSING_BLOW,
  A_TOLL_CALLED_IN,
  AN_EDGE_ASKED_THREE_TIMES,
  BREAK_CARD,
  BROKEN,
  CHARGE_CARD,
  CHARGE_TOKENS,
  EDGE_CARD,
  FLOOR_CARD,
  FORCED_ABILITY,
  FORCED_CARD,
  GLORY_CARD,
  RAGE_CARD,
  ROOM_LIFT_CARD,
  ROUSE_CARD,
  TOLLED,
  TOLL_ABILITY,
  TOLL_CARD,
  TOLL_PAID,
} from '../../tests/fixtures/cards';
import {
  A_BONUS_READ_OFF_ITS_OWN_WOUNDS,
  A_CALL_THAT_ARRIVES_SWINGING,
  A_BREATH_GATED_ON_A_DIE,
  A_CALL_FOR_MORE_OF_THEM,
  A_HIDE_THAT_SHRUGS_OFF_STEEL,
  A_HUNGER_DRAWN_TO_A_WOUND,
  A_RAIN_THAT_EVERYONE_ANSWERS,
  A_RALLY_OF_TWO_AT_RANGE,
  A_RALLY_THAT_BUYS_TWO_TURNS,
  A_RALLY_THAT_STRIKES_FOR_HALF,
  A_SPEND_GATED_ON_WHAT_THEY_CARRY,
  A_STORE_THAT_HOLDS_WHOEVER_IT_HIT,
  A_STORE_TORN_OFF_BY_A_REAL_WOUND,
  A_WATCHER_THAT_ADDS_TO_A_HIT,
  A_WIND_UP_THAT_COSTS_A_TURN,
  A_WIND_UP_WITH_ITS_OWN_STORE,
  A_WOUND_HANDED_BACK,
  A_WOUND_THAT_ANSWERS,
  AN_OVERLOAD_THAT_BUYS_ANOTHER_TURN,
  PLATE_THAT_ROLLS_WHAT_IT_TURNS,
  PLATE_THAT_TURNS_A_FLAT_AMOUNT,
  ROOTS_PUT_DOWN_ONCE,
  print,
  printed,
  type Printed,
} from '../../tests/fixtures/adversary-features';
import { STARTER_ABILITIES } from '../engine/content/pack/starter';
import { runScript } from '../engine/script/runner';
import type { Rng } from '../engine/core/rng';
import { abilitiesOf, abilityTargets, useAbility } from '../game/demo-abilities';
import {
  attackWithSelected,
  answerPending,
  buildProjectScene,
  endTurn,
  moveSelectedTo,
  refreshWorld,
  settleFight,
  useSelectedOn,
} from '../game/demo-scene';
import { startEncounter } from '../game/movement';
import { interactablesOf } from '../engine/scene/prop-functions';

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
  blankSheet('kara', 'sentinel', {
    name: 'Quim',
    traits: { agility: 0, strength: 2, finesse: 1, instinct: 1, presence: 0, knowledge: -1 },
    ancestryId: 'human',
    armorId: 'ringmail',
    primaryWeaponId: 'longsword',
    subclassId: 'shieldbearer',
    domainCards: ['power-slash', 'iron-stance'],
  }),
);

/**
 * A blank project with one empty room, which is where a designer starts.
 *
 * The room is small on purpose - a fight in it is over quickly - so a fixture
 * that needs somebody genuinely out of range asks for a bigger one rather than
 * parking them off the board, which is authored scenery and never enters play.
 */
function blank(width = 12, height = 8): EditorSession {
  const session = new EditorSession(
    projectSchema.parse({
      id: 'authored',
      name: 'Authored',
      scenes: [sceneSchema.parse({ ...blankScene('hall', width, height), spawns: [{ x: 1, y: 4 }] })],
      startScene: 'hall',
    }),
  );
  // The stat blocks its fights place. A project that names a creature nobody can
  // look up is a broken document and the engine says so, so the creatures a
  // fixture fights are carried by the fixture — not borrowed from whatever pack
  // the app happens to ship.
  session.project.adversaries.push(...FIXTURE_ADVERSARIES);
  // And the catalogue conditions its fights apply, for the same reason: the engine ships only the
  // three its own rules read.
  session.project.conditionDefs.push(...FIXTURE_CONDITIONS);
  return session;
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
  s.run(addAdversary('hall', 'ambush', { id: 'foe-1', adversary: 'fixture-foe', position: { x: 8, y: 4 } }));
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
    // The mechanism: a Shadow, an Agility Reaction Roll from everyone within Far
    // range, and magic damage on those who fail -- halved for those who do not.
    s.run(addAdversary('hall', 'demon', { id: 'demon-1', adversary: 'fixture-brute', position: { x: 5, y: 4 } }));
    print(s.project, A_RAIN_THAT_EVERYONE_ANSWERS('fixture-brute'));

    const demo = buildProjectScene(s.project, 'hellfire');
    demo.askDefender = false;
    startEncounter(demo, 'demon');
    demo.state.bad = { ...demo.state.bad, value: demo.state.bad.max };

    let rained = false;
    for (let i = 0; i < 6 && !rained && demo.encounter?.outcome === 'ongoing'; i++) {
      endTurn(demo);
      rained = demo.log.some((l) => l.text.includes('uses Rain of Cinders'));
    }
    expect(rained).toBe(true);
    // Everyone it caught rolled against the 14 the feature names. It cannot be
    // read off the creature: `reactionRoll` takes a literal or 'roll', so a test
    // reading the two as the same number is reading a coincidence.
    const rolls = demo.log.map((l) => l.text).filter((t) => t.includes('reacts:'));
    expect(rolls.length).toBeGreaterThanOrEqual(2);
    expect(rolls[0]).toContain('against 14');
  });
});

describe('a block that shrugs the party off', () => {
  it('halves what it resists, at the button a player actually presses', () => {
    const build = (resists: boolean, seed = 'bones') => {
      const s = blank();
      s.run(addSheet(KARA));
      s.run(setSpawns('hall', [{ x: 1, y: 4 }]));
      s.run(addEncounter('hall', encounterSchema.parse({ id: 'bones', name: 'Bones' })));
      s.run(addAdversary('hall', 'bones', { id: 'warrior-1', adversary: 'fixture-foe', position: { x: 3, y: 4 } }));
      if (resists) {
        // The control run is the absence of the feature rather than a silenced
        // one: nothing the app ships is sourced to a fixture block, so there is
        // nothing to suppress. Carrying it is the whole difference.
        print(s.project, A_HIDE_THAT_SHRUGS_OFF_STEEL('fixture-foe'));
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

    // One seed, so both runs roll the same swing: Quim's longsword deals
    // physical damage, which is what the hide answers. Major on this block's
    // thresholds, and one band down once it is halved.
    const plain = build(false, 's5');
    const resisted = build(true, 's5');
    expect(plain).toBe(2);
    expect(resisted).toBe(1);
  });
});

describe('a Lieutenant with more where that came from', () => {
  it('calls three more of them onto the map, and they are in the fight from that moment', () => {
    const s = blank();
    s.run(addSheet(KARA));
    s.run(setSpawns('hall', [{ x: 2, y: 4 }]));
    s.run(addEncounter('hall', encounterSchema.parse({ id: 'thieves', name: 'Thieves' })));
    s.run(addAdversary('hall', 'thieves', { id: 'boss', adversary: 'fixture-captain', position: { x: 7, y: 4 } }));
    print(s.project, A_CALL_FOR_MORE_OF_THEM('fixture-captain', 'fixture-runt'));

    const demo = buildProjectScene(s.project, 'knives');
    demo.askDefender = false;
    startEncounter(demo, 'thieves');
    demo.state.bad = { ...demo.state.bad, value: demo.state.bad.max };
    const before = demo.state.entitiesOf('adversary').length;

    let called = false;
    for (let i = 0; i < 4 && !called && demo.encounter?.outcome === 'ongoing'; i++) {
      endTurn(demo);
      called = demo.log.some((l) => l.text.includes('uses Plenty More'));
    }
    expect(called).toBe(true);

    // Three more of them, on the map, off the specimen the test carries.
    const now = demo.state.entitiesOf('adversary');
    expect(now.length).toBe(before + 3);
    const lackeys = now.filter((e) => e.definition === 'fixture-runt');
    expect(lackeys).toHaveLength(3);
    expect(demo.log.some((l) => l.text.includes('3 Runts arrive.'))).toBe(true);

    // They are in the fight: the encounter waits on them, so killing the one
    // that called them does not end it.
    demo.state.entity('boss')!.alive = false;
    settleFight(demo);
    expect(demo.encounter!.outcome).toBe('ongoing');
    expect(demo.encounter!.view().waiting).toEqual(expect.arrayContaining(lackeys.map((e) => e.id)));
  });
});

describe('a Leader buying its own side a turn', () => {
  /** A leader and two of its own down the hall from Quim. */
  const gang = (seed: string, bad: number) => {
    const s = blank();
    s.run(addSheet(KARA));
    s.run(setSpawns('hall', [{ x: 2, y: 4 }]));
    s.run(addEncounter('hall', encounterSchema.parse({ id: 'thieves', name: 'Thieves' })));
    s.run(addAdversary('hall', 'thieves', { id: 'boss', adversary: 'fixture-captain', position: { x: 7, y: 4 } }));
    s.run(addAdversary('hall', 'thieves', { id: 'knife-1', adversary: 'fixture-runt', position: { x: 7, y: 3 } }));
    s.run(addAdversary('hall', 'thieves', { id: 'knife-2', adversary: 'fixture-runt', position: { x: 7, y: 5 } }));
    print(s.project, A_RALLY_THAT_BUYS_TWO_TURNS('fixture-captain'));
    const demo = buildProjectScene(s.project, seed);
    demo.askDefender = false;
    startEncounter(demo, 'thieves');
    demo.state.bad = { ...demo.state.bad, value: bad };
    demo.party.select('kara');
    return demo;
  };

  it('hands the spotlight to two allies on its own turn, with no Shadow in the pool', () => {
    // Not a single Shadow: an ordinary second spotlight would be refused and the
    // turn would stop. This one pays in Stress, and what a Stress buys has to be
    // honoured on its own terms.
    const demo = gang('tactician', 0);
    const stress = demo.state.entity('boss')!.stress.marked;
    endTurn(demo);

    expect(demo.log.some((l) => l.text.includes('uses Press the Advantage'))).toBe(true);
    expect(demo.state.entity('boss')!.stress.marked).toBe(stress + 1);

    // Both of the others acted, this turn, exactly once each.
    const acted = demo.encounter!.log.filter((e) => e.kind === 'adversaryActed') as { id: string }[];
    expect(acted.filter((e) => e.id === 'knife-1')).toHaveLength(1);
    expect(acted.filter((e) => e.id === 'knife-2')).toHaveLength(1);
    // And the GM was billed for none of it beyond the first, free spotlight.
    expect(acted.every((e) => (e as unknown as { badSpent: number }).badSpent === 0)).toBe(true);
  });

  it('says nothing and spends nothing when there is nobody to rally', () => {
    const demo = gang('tactician-alone', 0);
    demo.state.entity('knife-1')!.alive = false;
    demo.state.entity('knife-2')!.alive = false;
    const stress = demo.state.entity('boss')!.stress.marked;
    endTurn(demo);
    // One standing alone would otherwise bleed a Stress every turn for a rally
    // nobody answers.
    expect(demo.log.some((l) => l.text.includes('uses Press the Advantage'))).toBe(false);
    expect(demo.state.entity('boss')!.stress.marked).toBe(stress);
  });
});

describe('a creature that does not stay the same creature', () => {
  /**
   * A second form, stood up the moment the first one falls. `defeated` is the
   * trigger, and the replacement is spotlighted rather than left waiting — so
   * the fight is not over at the very moment it looked won.
   */
  const SECOND_WIND = printed('fixture-foe', {
    id: 'fixture-second-wind',
    name: 'Second Wind',
    text: 'Put down, it gets back up as something worse.',
    kind: 'reaction',
    trigger: 'defeated',
    action: false,
    target: { kind: 'none' },
    effects: [{ kind: 'replace', adversary: 'fixture-champion', spotlight: true }],
  });

  /**
   * The same move on a different trigger, and paid for: a wound deep enough
   * splits it into two smaller ones, which stand up unmarked.
   */
  const SPLITS_IN_TWO = printed('fixture-foe', {
    id: 'fixture-splits-in-two',
    name: 'Splits in Two',
    text: 'Wounded deeply enough, and at a price, it comes apart into two of itself.',
    kind: 'reaction',
    trigger: 'tookHitPoints',
    action: false,
    cost: { bad: 1 },
    available: { kind: 'pool', pool: 'hitPoints', measure: 'marked', op: '>=', value: 3 },
    target: { kind: 'none' },
    inCombatOnly: true,
    effects: [{ kind: 'replace', adversary: 'fixture-runt', count: '2', spotlight: true }],
  });

  const arena = (seed: string, bad: number, features: readonly Printed[]) => {
    const s = blank();
    s.run(addSheet(KARA));
    s.run(setSpawns('hall', [{ x: 2, y: 4 }]));
    s.run(addEncounter('hall', encounterSchema.parse({ id: 'arena', name: 'The arena' })));
    s.run(addAdversary('hall', 'arena', { id: 'foe', adversary: 'fixture-foe', position: { x: 3, y: 4 } }));
    for (const { card, ability } of features) s.run(addCardWithAbility(card, ability));
    const demo = buildProjectScene(s.project, seed);
    demo.askDefender = false;
    startEncounter(demo, 'arena');
    demo.state.bad = { ...demo.state.bad, value: bad };
    demo.state.entity('kara')!.hitPoints = { max: 40, marked: 0 };
    demo.party.select('kara');
    return demo;
  };

  it('stands the next form up before anybody says the fight is won', () => {
    const demo = arena('phase', 0, [SECOND_WIND]);
    const where = demo.state.entity('foe')!.tile;
    // The killing blow, delivered by hand: it marks its last Hit Point.
    demo.state.entity('foe')!.hitPoints = { max: 6, marked: 5 };
    attackWithSelected(demo, 'foe');
    if (demo.state.entity('foe')?.alive === true) {
      // A miss: put it down directly, the way the fight would have.
      const foe = demo.state.entity('foe')!;
      foe.hitPoints = { max: 6, marked: 6 };
      foe.alive = false;
      settleFight(demo);
    }

    expect(demo.state.entity('foe')).toBeUndefined();
    const next = demo.state.entitiesOf('adversary').filter((e) => e.alive);
    expect(next.map((e) => e.definition)).toEqual(['fixture-champion']);
    // In the same place the fight left it, at full strength off its own block.
    expect(next[0]!.tile).toBe(where);
    expect(next[0]!.hitPoints.marked).toBe(0);
    // And the fight is not over: the party won nothing yet.
    expect(demo.encounter!.outcome).toBe('ongoing');
  });

  it('splits a creature in two, on the Shadow that says so', () => {
    const demo = arena('ooze', 3, [SPLITS_IN_TWO]);
    const foe = demo.state.entity('foe')!;
    // Three or more Hit Points marked, and it is one short: the blow that
    // lands is the one that splits it.
    foe.hitPoints = { max: 8, marked: 2 };
    const bad = demo.state.bad.value;
    attackWithSelected(demo, 'foe');

    // The log names what is gone, which nothing can look up once it is: the
    // line comes after the swing that caused it, not before.
    const said = demo.log.map((l) => l.text);
    expect(said).toContain('Foe is gone: 2 Runts in their place.');
    expect(said.indexOf('Foe is gone: 2 Runts in their place.')).toBeGreaterThan(
      said.findIndex((t) => t.includes('Quim hits with the Longsword')),
    );

    const halves = demo.state.entitiesOf('adversary').filter((e) => e.alive);
    expect(halves.map((e) => e.definition)).toEqual(['fixture-runt', 'fixture-runt']);
    // They stand up with nothing marked against them.
    expect(halves.every((e) => e.hitPoints.marked === 0 && e.stress.marked === 0)).toBe(true);
    expect(demo.state.entity('foe')).toBeUndefined();
    expect(bad - demo.state.bad.value).toBe(1);
  });

  it('leaves it whole while the wound is shallow, and while the pool is empty', () => {
    const shallow = arena('ooze-shallow', 3, [SPLITS_IN_TWO]);
    shallow.state.entity('foe')!.hitPoints = { max: 8, marked: 0 };
    attackWithSelected(shallow, 'foe');
    expect(shallow.state.entity('foe')?.definition).toBe('fixture-foe');

    const broke = arena('ooze-broke', 0, [SPLITS_IN_TWO]);
    broke.state.entity('foe')!.hitPoints = { max: 8, marked: 2 };
    // Damage rather than a swing, so no roll hands the GM the Shadow back.
    broke.world.dealDamage('foe', { amount: 4, types: ['physical'] }, broke.rng);
    settleFight(broke);
    // Nothing to spend, and a cost is not a suggestion.
    expect(broke.state.entity('foe')?.definition).toBe('fixture-foe');
  });
});

describe('what the two of them make of each other', () => {
  /**
   * A shield read from the *attacker's* chair: `against` is what turns a
   * modifier on the holder into one on whoever swings at them, and the range
   * on `when` is how far the arm holding it reaches.
   */
  const BLOCKING_SHIELD = printed('fixture-foe', {
    id: 'fixture-blocking-shield',
    name: 'Blocking Shield',
    text: 'Anyone close enough to be blocked swings at it the harder.',
    kind: 'passive',
    action: false,
    target: { kind: 'none' },
    modifiers: [{ stat: 'advantage', bonus: -1, against: true, when: { kind: 'withinRange', range: 'melee' } }],
  });

  /** The same stat the other way round: its own advantage, while a condition holds. */
  const OUT_OF_NOWHERE = printed('fixture-foe', {
    id: 'fixture-out-of-nowhere',
    name: 'Out of Nowhere',
    text: 'Unseen, it strikes the better for it.',
    kind: 'passive',
    action: false,
    target: { kind: 'none' },
    modifiers: [{ stat: 'advantage', bonus: 1, when: { kind: 'hasCondition', condition: 'hidden', of: { kind: 'actor' } } }],
  });

  /** A flat bonus to how hard it is to hit, which the block never wrote down. */
  const ON_THE_WING = printed('fixture-foe', {
    id: 'fixture-on-the-wing',
    name: 'On the Wing',
    text: 'It does not stand still to be hit.',
    kind: 'passive',
    action: false,
    target: { kind: 'none' },
    modifiers: [{ stat: 'evasion', bonus: 3 }],
  });

  /** Something a wound puts on whoever dealt it, which then follows them. */
  const FROZEN_SCALES = printed('fixture-foe', {
    id: 'fixture-frozen-scales',
    name: 'Frozen Scales',
    text: 'Cut it from close in and the cold comes back up the blade.',
    kind: 'reaction',
    trigger: 'tookDamage',
    action: false,
    available: { kind: 'withinRange', range: 'veryClose' },
    target: { kind: 'none' },
    effects: [
      { kind: 'markStress', target: { kind: 'target' } },
      { kind: 'applyCondition', condition: 'chilled', duration: 'scene', target: { kind: 'target' } },
    ],
  });

  /** Quim and one creature, at the distance the test asks for. */
  const facing = (seed: string, features: readonly Printed[], at: { x: number; y: number } = { x: 3, y: 4 }) => {
    const s = blank();
    s.run(addSheet(KARA));
    s.run(setSpawns('hall', [{ x: 2, y: 4 }]));
    s.run(addEncounter('hall', encounterSchema.parse({ id: 'yard', name: 'The yard' })));
    s.run(addAdversary('hall', 'yard', { id: 'foe', adversary: 'fixture-foe', position: at }));
    for (const { card, ability } of features) s.run(addCardWithAbility(card, ability));
    const demo = buildProjectScene(s.project, seed);
    demo.askDefender = false;
    startEncounter(demo, 'yard');
    demo.state.entity('kara')!.hitPoints = { max: 40, marked: 0 };
    demo.party.select('kara');
    return demo;
  };

  it('puts a shield in the way of anyone standing close enough to be blocked', () => {
    const near = facing('shield', [BLOCKING_SHIELD]);
    expect(near.world.advantageFor('kara', 'foe')).toEqual({ advantage: 0, disadvantage: 1 });

    // And a shield only reaches as far as the arm holding it.
    const far = facing('shield-far', [BLOCKING_SHIELD], { x: 8, y: 4 });
    expect(far.world.advantageFor('kara', 'foe')).toEqual({ advantage: 0, disadvantage: 0 });
  });

  it('hands a creature the advantage its own passive names, and only while it holds', () => {
    const demo = facing('assassin', [OUT_OF_NOWHERE]);
    expect(demo.world.advantageFor('foe', 'kara')).toEqual({ advantage: 0, disadvantage: 0 });

    demo.state.entity('foe')!.conditions.add('hidden');
    expect(demo.world.advantageFor('foe', 'kara')).toEqual({ advantage: 1, disadvantage: 0 });
    // It is the creature's own advantage: nothing about swinging at them.
    expect(demo.world.advantageFor('kara', 'foe').advantage).toBe(0);
  });

  it('reads a bonus to Difficulty straight off a passive nobody had written down', () => {
    const demo = facing('bat', [ON_THE_WING]);
    const flier = demo.state.entity('foe')!;
    // Difficulty is the block's own, plus whatever a passive adds to Evasion.
    expect(demo.world.defenderOf(flier).difficulty).toBe(11 + 3);
  });

  it('chills whoever gets close enough to cut it, and a Chilled arm swings worse', () => {
    const demo = facing('chill', [FROZEN_SCALES]);
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
  /**
   * A hide that bites the hand: a reaction on the creature's own wound, priced
   * in Stress and measured back to whoever swung.
   */
  const BARBED_HIDE = printed('fixture-foe', {
    id: 'fixture-barbed-hide',
    name: 'Barbed Hide',
    text: 'Wounded from close in, it may spend itself to drive its hide back into the blow.',
    kind: 'reaction',
    trigger: 'tookDamage',
    action: false,
    cost: { stress: 1 },
    available: { kind: 'withinRange', range: 'melee' },
    target: { kind: 'none' },
    effects: [
      { kind: 'log', text: 'Barbs drive back into the blow.', tone: 'bad' },
      { kind: 'damage', dice: '1d10+5', type: 'physical', target: { kind: 'target' } },
    ],
  });

  /** The other half: a clock the first wound starts, and no later wound restarts. */
  const RISING_HUM = printed('fixture-foe', {
    id: 'fixture-rising-hum',
    name: 'Rising Hum',
    text: 'The first wound it takes sets something humming, and it builds from there.',
    kind: 'reaction',
    trigger: 'tookDamage',
    action: false,
    uses: { count: 1, per: 'scene' },
    target: { kind: 'none', range: 'far' },
    inCombatOnly: true,
    effects: [
      {
        kind: 'countdown',
        countdown: 'fixture-rising-hum',
        name: 'Rising Hum',
        start: '1d6',
        loop: 'reset',
        effects: [
          { kind: 'log', text: 'The hum breaks over everyone.', tone: 'bad' },
          {
            kind: 'reactionRoll',
            difficulty: 14,
            trait: 'instinct',
            targets: { kind: 'allies', range: 'far' },
            onFail: [
              { kind: 'markStress', target: { kind: 'hit' } },
              { kind: 'loseGood', target: { kind: 'hit' } },
            ],
          },
        ],
      },
    ],
  });

  /** Quim toe to toe with something carrying the feature under test. */
  const duel = (seed: string, features: readonly Printed[]) => {
    const s = blank();
    s.run(addSheet(KARA));
    s.run(setSpawns('hall', [{ x: 2, y: 4 }]));
    s.run(addEncounter('hall', encounterSchema.parse({ id: 'duel', name: 'The duel' })));
    s.run(addAdversary('hall', 'duel', { id: 'foe', adversary: 'fixture-foe', position: { x: 3, y: 4 } }));
    // The stat block is a fixture with no features of its own, so the only
    // thing that can answer a wound here is the one the test wrote.
    for (const { card, ability } of features) s.run(addCardWithAbility(card, ability));
    const demo = buildProjectScene(s.project, seed);
    demo.askDefender = false;
    startEncounter(demo, 'duel');
    demo.state.entity('kara')!.hitPoints = { max: 40, marked: 0 };
    demo.party.select('kara');
    return demo;
  };

  it('drives the hide back into the one who struck, and marks the Stress for it', () => {
    const demo = duel('thorns', [BARBED_HIDE]);
    const before = demo.state.entity('kara')!;
    const wounds = before.hitPoints.marked + before.armorSlots.marked;
    const stress = demo.state.entity('foe')!.stress.marked;

    attackWithSelected(demo, 'foe');

    // A wound from Melee range, so the reaction is available; it costs a Stress
    // and the damage lands back on whoever the blow came from.
    expect(demo.log.some((l) => l.text.includes('Barbs drive back into the blow.'))).toBe(true);
    expect(demo.state.entity('foe')!.stress.marked).toBe(stress + 1);
    const after = demo.state.entity('kara')!;
    expect(after.hitPoints.marked + after.armorSlots.marked).toBeGreaterThan(wounds);
  });

  it('stays quiet when the wound has nobody behind it', () => {
    const demo = duel('thorns-nobody', [BARBED_HIDE]);
    const stress = demo.state.entity('foe')!.stress.marked;
    // Damage out of a script - a trap, a countdown, a spell with no attacker.
    // "Within Melee range" has nobody to measure to, so the hide answers
    // nothing and the Stress stays unmarked.
    demo.world.dealDamage('foe', { amount: 9, types: ['physical'] }, demo.rng);
    settleFight(demo);
    expect(demo.log.some((l) => l.text.includes('Barbs drive back'))).toBe(false);
    expect(demo.state.entity('foe')!.stress.marked).toBe(stress);
  });

  it('answers the first wound only, and not again in the same scene', () => {
    const demo = duel('flicker', [RISING_HUM]);
    const foe = demo.state.entity('foe')!;
    foe.hitPoints = { max: 40, marked: 0 };
    for (let i = 0; i < 4; i++) {
      if (!demo.encounter!.canAct('kara')) endTurn(demo);
      attackWithSelected(demo, 'foe');
    }
    // A `uses` of one per scene: the clock starts once, however many times Quim
    // connects, and the countdown it started is the one on the board.
    expect(demo.log.filter((l) => l.text.includes('Rising Hum begins')).length).toBe(1);
    expect(demo.scenario.countdowns.has('fixture-rising-hum')).toBe(true);
  });
});

describe('a wound big enough to be counted', () => {
  /**
   * Half of whatever landed, sent back the way it came. `same` is the blow that
   * just arrived and `half` is what of it returns, so it goes through the
   * attacker's thresholds the way it went through this creature's.
   */
  const MIRRORED_SKIN = printed('fixture-foe', {
    id: 'fixture-mirrored-skin',
    name: 'Mirrored Skin',
    text: 'Struck from close in, it sends half of what landed straight back.',
    kind: 'reaction',
    trigger: 'tookDamage',
    action: false,
    available: { kind: 'withinRange', range: 'close' },
    target: { kind: 'none' },
    effects: [
      { kind: 'log', text: 'The blow folds back on itself.', tone: 'bad' },
      { kind: 'damage', dice: 'same', half: true, target: { kind: 'target' } },
    ],
  });

  /** A gate on the size of the wound: two Hit Points or more, or nothing. */
  const HEAVY_ANSWER = printed('fixture-foe', {
    id: 'fixture-heavy-answer',
    name: 'Heavy Answer',
    text: 'A wound worth noticing buys the one who dealt it a swing in return.',
    kind: 'reaction',
    trigger: 'tookHitPoints',
    action: false,
    available: {
      kind: 'all',
      of: [
        { kind: 'withinRange', range: 'veryClose' },
        { kind: 'count', of: 'hitPointsTaken', op: '>=', value: 2 },
      ],
    },
    target: { kind: 'none' },
    effects: [
      { kind: 'log', text: 'It brings the hammer round in answer.', tone: 'bad' },
      { kind: 'attack', damage: '2d6+15', target: { kind: 'target' } },
    ],
  });

  /**
   * A clock armed by its own wounds, which takes back exactly what it dealt:
   * `hitPointsDealt` is what the blast marked, healed onto the creature that
   * threw it.
   */
  const TAKES_IT_BACK = printed('fixture-foe', {
    id: 'fixture-takes-it-back',
    name: 'Takes It Back',
    text: 'Worn down far enough, it starts counting, and what it spends next it takes out of somebody.',
    kind: 'reaction',
    trigger: 'tookHitPoints',
    action: false,
    uses: { count: 1, per: 'scene' },
    available: { kind: 'pool', pool: 'hitPoints', of: { kind: 'actor' }, measure: 'marked', op: '>=', value: 6 },
    target: { kind: 'none', range: 'close' },
    inCombatOnly: true,
    effects: [
      {
        kind: 'countdown',
        countdown: 'fixture-takes-it-back',
        name: 'Takes It Back',
        start: '2d6',
        loop: 'reset',
        effects: [
          { kind: 'log', text: 'It takes the wound back out of somebody.', tone: 'bad' },
          { kind: 'damage', dice: '2d10+6', type: 'magic', direct: true, target: { kind: 'allies', range: 'close', nearest: 1 } },
          { kind: 'heal', amount: 'hitPointsDealt', target: { kind: 'actor' } },
        ],
      },
    ],
  });

  /** Quim toe to toe with something carrying the feature under test. */
  const duel = (seed: string, features: readonly Printed[]) => {
    const s = blank();
    s.run(addSheet(KARA));
    s.run(setSpawns('hall', [{ x: 2, y: 4 }]));
    s.run(addEncounter('hall', encounterSchema.parse({ id: 'duel', name: 'The duel' })));
    s.run(addAdversary('hall', 'duel', { id: 'foe', adversary: 'fixture-foe', position: { x: 3, y: 4 } }));
    for (const { card, ability } of features) s.run(addCardWithAbility(card, ability));
    const demo = buildProjectScene(s.project, seed);
    demo.askDefender = false;
    startEncounter(demo, 'duel');
    demo.state.entity('kara')!.hitPoints = { max: 40, marked: 0 };
    demo.state.entity('foe')!.hitPoints = { max: 40, marked: 0 };
    demo.party.select('kara');
    return demo;
  };

  it('throws half of the blow back, off the damage rather than the Hit Points', () => {
    // Half of the damage that landed, not half of the Hit Points it cost:
    // twenty marks the creature once or twice, and ten is what comes back.
    const demo = duel('reflect', [MIRRORED_SKIN]);
    demo.world.noteDamage('foe', { attacker: 'kara', hitPoints: 2, damage: 20, types: ['magic'] });
    settleFight(demo);

    expect(demo.log.some((l) => l.text.includes('The blow folds back on itself.'))).toBe(true);
    expect(demo.log.some((l) => l.text.includes('10 damage to Quim'))).toBe(true);
  });

  it('answers only a wound of the size the block names', () => {
    // Two Hit Points or more, and within Very Close. One Hit Point is a
    // scratch, and the hammer stays down.
    const light = duel('brawler-light', [HEAVY_ANSWER]);
    light.world.noteDamage('foe', { attacker: 'kara', hitPoints: 1, damage: 5, types: ['physical'] });
    settleFight(light);
    expect(light.log.some((l) => l.text.includes('brings the hammer round'))).toBe(false);

    const heavy = duel('brawler-heavy', [HEAVY_ANSWER]);
    heavy.world.noteDamage('foe', { attacker: 'kara', hitPoints: 2, damage: 30, types: ['physical'] });
    settleFight(heavy);
    expect(heavy.log.some((l) => l.text.includes('brings the hammer round'))).toBe(true);
  });

  it('drinks back exactly what its own clock took out of somebody', () => {
    // What it heals is what the blast marked — `hitPointsDealt`, not a flat
    // number — so the two are checked against each other rather than a total.
    const demo = duel('life-is-mine', [TAKES_IT_BACK]);
    const foe = demo.state.entity('foe')!;
    foe.hitPoints = { max: 12, marked: 6 };
    demo.world.noteDamage('foe', { attacker: 'kara', hitPoints: 1, damage: 8, types: ['physical'] });
    settleFight(demo);
    const clock = demo.scenario.countdowns.get('fixture-takes-it-back');
    expect(clock).toBeDefined();

    clock!.value = 1;
    const marked = foe.hitPoints.marked;
    const hurt = demo.state.entity('kara')!.hitPoints.marked;
    if (!demo.encounter!.canAct('kara')) endTurn(demo);
    attackWithSelected(demo, 'foe');

    expect(demo.log.some((l) => l.text.includes('takes the wound back'))).toBe(true);
    const took = demo.state.entity('kara')!.hitPoints.marked - hurt;
    expect(took).toBeGreaterThan(0);
    // What it cleared is what the blast marked, less whatever Quim's own swing
    // put back on it.
    expect(foe.hitPoints.marked).toBeLessThanOrEqual(marked - took + 1);
  });
});

describe('a wound too small to be worth taking', () => {
  /**
   * The same gate as a counted wound, read the other way: two Hit Points or
   * *fewer*, which includes a hit that marked none at all. That is why the
   * trigger is the damage rather than the Hit Points.
   */
  const SHRUGS_IT_OFF = printed('fixture-foe', {
    id: 'fixture-shrugs-it-off',
    name: 'Shrugs It Off',
    text: 'A blow that barely tells costs whoever threw it something instead.',
    kind: 'reaction',
    trigger: 'tookDamage',
    action: false,
    available: {
      kind: 'all',
      of: [
        { kind: 'withinRange', range: 'melee' },
        { kind: 'count', of: 'hitPointsTaken', op: '<=', value: 2 },
      ],
    },
    target: { kind: 'none' },
    effects: [
      { kind: 'log', text: 'Turned aside, and laughed at.', tone: 'bad' },
      { kind: 'markStress', target: { kind: 'target' } },
    ],
  });

  const duel = (seed: string, features: readonly Printed[]) => {
    const s = blank();
    s.run(addSheet(KARA));
    s.run(setSpawns('hall', [{ x: 2, y: 4 }]));
    s.run(addEncounter('hall', encounterSchema.parse({ id: 'duel', name: 'The duel' })));
    s.run(addAdversary('hall', 'duel', { id: 'foe', adversary: 'fixture-foe', position: { x: 3, y: 4 } }));
    for (const { card, ability } of features) s.run(addCardWithAbility(card, ability));
    const demo = buildProjectScene(s.project, seed);
    demo.askDefender = false;
    startEncounter(demo, 'duel');
    demo.state.entity('kara')!.hitPoints = { max: 40, marked: 0 };
    demo.state.entity('foe')!.hitPoints = { max: 40, marked: 0 };
    demo.party.select('kara');
    return demo;
  };

  it('costs the attacker a Stress for a blow it shrugs off, and nothing for a real one', () => {
    const small = duel('swash-small', [SHRUGS_IT_OFF]);
    const before = small.state.entity('kara')!.stress.marked;
    small.world.noteDamage('foe', { attacker: 'kara', hitPoints: 1, damage: 6, types: ['physical'] });
    settleFight(small);
    expect(small.log.some((l) => l.text.includes('Turned aside, and laughed at.'))).toBe(true);
    expect(small.state.entity('kara')!.stress.marked).toBe(before + 1);

    const big = duel('swash-big', [SHRUGS_IT_OFF]);
    const was = big.state.entity('kara')!.stress.marked;
    big.world.noteDamage('foe', { attacker: 'kara', hitPoints: 3, damage: 24, types: ['physical'] });
    settleFight(big);
    expect(big.log.some((l) => l.text.includes('Turned aside, and laughed at.'))).toBe(false);
    expect(big.state.entity('kara')!.stress.marked).toBe(was);
  });
});

describe('a creature that walks before it swings', () => {
  /**
   * Ground closed on the way in: a move toward whoever was picked, spending up
   * to Far to arrive at Melee, and then the swing.
   */
  const RUN_UP = printed('fixture-foe', {
    id: 'fixture-run-up',
    name: 'Run-Up',
    text: 'It covers the ground first and swings on arrival.',
    target: { kind: 'creature', range: 'far' },
    inCombatOnly: true,
    effects: [
      { kind: 'log', text: 'A run-up, and then the blade.', tone: 'combat' },
      { kind: 'move', how: 'toward', of: { kind: 'target' }, range: 'melee', budget: 'far' },
      {
        kind: 'attack',
        damage: '2d8+4',
        target: { kind: 'target' },
        onHit: [{ kind: 'markStress', target: { kind: 'hit' } }],
      },
    ],
  });

  /**
   * The other direction: a wound moves it away. Free, so the fight plays it
   * every time — and a blow with nobody behind it has nothing to back away
   * from, which is the half of this the second test is about.
   */
  const GIVES_GROUND = printed('fixture-foe', {
    id: 'fixture-gives-ground',
    name: 'Gives Ground',
    text: 'Wounded, it is somewhere else.',
    kind: 'reaction',
    trigger: 'tookDamage',
    action: false,
    target: { kind: 'none' },
    effects: [{ kind: 'move', how: 'away', of: { kind: 'target' }, budget: 'far' }],
  });

  /**
   * A walk aimed at its own side. `except: 'actor'` is the whole point: a
   * creature is within Melee of itself, so a selector that counted the one
   * acting would have it close up beside nobody at all.
   */
  const CLOSE_RANKS = printed('fixture-foe', {
    id: 'fixture-close-ranks',
    name: 'Close Ranks',
    text: 'It spends itself to reach one of its own and swing from there.',
    cost: { stress: 1 },
    target: { kind: 'creature', range: 'veryClose' },
    inCombatOnly: true,
    effects: [
      { kind: 'log', text: 'It closes up beside one of its own.', tone: 'combat' },
      { kind: 'move', how: 'toward', of: { kind: 'adversaries', range: 'far', nearest: 1, except: 'actor' }, range: 'melee' },
      {
        kind: 'attack',
        range: 'veryClose',
        damage: '2d10+2',
        target: { kind: 'target' },
        onHit: [{ kind: 'clearStress', target: { kind: 'adversaries', range: 'melee', nearest: 1, except: 'actor' } }],
      },
    ],
  });

  /** Quim at one end of the hall and something at the other. */
  const hall = (seed: string, features: readonly Printed[], at: { x: number; y: number } = { x: 9, y: 4 }) => {
    const s = blank();
    s.run(addSheet(KARA));
    s.run(setSpawns('hall', [{ x: 2, y: 4 }]));
    s.run(addEncounter('hall', encounterSchema.parse({ id: 'hall', name: 'The hall' })));
    s.run(addAdversary('hall', 'hall', { id: 'foe', adversary: 'fixture-foe', position: at }));
    for (const { card, ability } of features) s.run(addCardWithAbility(card, ability));
    const demo = buildProjectScene(s.project, seed);
    demo.askDefender = false;
    startEncounter(demo, 'hall');
    demo.state.bad = { ...demo.state.bad, value: demo.state.bad.max };
    demo.state.entity('kara')!.hitPoints = { max: 40, marked: 0 };
    demo.state.entity('foe')!.hitPoints = { max: 40, marked: 0 };
    demo.party.select('kara');
    return demo;
  };

  const bandTo = (demo: ReturnType<typeof hall>, a: string, b: string) => demo.world.bandTo(a, b);

  it('closes the ground the feature says it can, and no further than it needs', () => {
    const demo = hall('charge', [RUN_UP]);
    expect(bandTo(demo, 'foe', 'kara')).not.toBe('melee');

    for (let i = 0; i < 4 && bandTo(demo, 'foe', 'kara') !== 'melee'; i++) endTurn(demo);
    expect(demo.log.some((l) => l.text.includes('A run-up, and then the blade.'))).toBe(true);
    expect(bandTo(demo, 'foe', 'kara')).toBe('melee');
  });

  it('walks away from whoever wounded it, and stands still when nobody did', () => {
    const demo = hall('slippery', [GIVES_GROUND], { x: 3, y: 4 });
    expect(bandTo(demo, 'kara', 'foe')).toBe('melee');
    // Whether a given swing lands is the seed's business; that the wound moves
    // the creature is not.
    for (let i = 0; i < 8 && bandTo(demo, 'kara', 'foe') === 'melee'; i++) {
      if (!demo.encounter!.canAct('kara')) endTurn(demo);
      demo.world.drawIn('kara', 'foe', 'melee', 'far');
      attackWithSelected(demo, 'foe');
    }
    const after = demo.state.entity('foe')!.tile;
    expect(bandTo(demo, 'kara', 'foe')).not.toBe('melee');

    // Damage out of a script has nobody behind it: there is nothing to get
    // away from, and it does not move.
    demo.world.dealDamage('foe', { amount: 9, types: ['magic'] }, demo.rng);
    settleFight(demo);
    expect(demo.state.entity('foe')!.tile).toBe(after);
  });

  it('walks to an ally rather than to itself', () => {
    const s = blank();
    s.run(addSheet(KARA));
    s.run(setSpawns('hall', [{ x: 2, y: 4 }]));
    s.run(addEncounter('hall', encounterSchema.parse({ id: 'line', name: 'The line' })));
    s.run(addAdversary('hall', 'line', { id: 'soldier', adversary: 'fixture-foe', position: { x: 8, y: 4 } }));
    s.run(addAdversary('hall', 'line', { id: 'mate', adversary: 'fixture-foe', position: { x: 4, y: 4 } }));
    s.run(addCardWithAbility(CLOSE_RANKS.card, CLOSE_RANKS.ability));
    const demo = buildProjectScene(s.project, 'reinforce');
    demo.askDefender = false;
    startEncounter(demo, 'line');
    demo.state.bad = { ...demo.state.bad, value: demo.state.bad.max };
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
    expect(demo.log.some((l) => l.text.includes('closes up beside one of its own'))).toBe(true);
  });

  it('cannot walk while something is holding it, either way', () => {
    // No feature at all: what is under test is the walk the turn itself takes,
    // and the condition that refuses it.
    const demo = hall('held', []);
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
  /**
   * A trigger on the party's *own* dice. The one who rolled is bound as the
   * target, so the distance is a plain `withinRange`, and what the dice said
   * is a `rolled` gate — the two composing under `all`.
   */
  const COLD_WATCH = printed('fixture-foe', {
    id: 'fixture-cold-watch',
    name: 'Cold Watch',
    text: 'Roll badly in front of it and something goes out of you.',
    kind: 'reaction',
    trigger: 'partyRolled',
    action: false,
    available: {
      kind: 'all',
      of: [
        { kind: 'withinRange', range: 'far' },
        { kind: 'rolled', is: 'withBad' },
      ],
    },
    target: { kind: 'none' },
    effects: [
      { kind: 'log', text: 'The cold takes something out of them.', tone: 'bad' },
      { kind: 'loseGood', target: { kind: 'target' } },
    ],
  });

  /**
   * The same shape read more narrowly: a *failure* with Shadow, which is two
   * gates rather than one. A roll that succeeded with Shadow is still a roll
   * with Shadow, and this one costs nothing for it.
   */
  const ONLY_ON_A_FAILURE = printed('fixture-foe', {
    id: 'fixture-only-on-a-failure',
    name: 'Only on a Failure',
    text: 'It answers the rolls that went wrong, and nothing else.',
    kind: 'reaction',
    trigger: 'partyRolled',
    action: false,
    available: {
      kind: 'all',
      of: [
        { kind: 'withinRange', range: 'close' },
        { kind: 'rolled', is: 'failure' },
        { kind: 'rolled', is: 'withBad' },
      ],
    },
    target: { kind: 'none' },
    effects: [{ kind: 'loseGood', target: { kind: 'target' } }],
  });

  /** Quim and something watching her roll, at the distance the test asks for. */
  const watched = (seed: string, features: readonly Printed[], at: { x: number; y: number } = { x: 3, y: 4 }) => {
    const s = blank();
    s.run(addSheet(KARA));
    s.run(setSpawns('hall', [{ x: 2, y: 4 }]));
    s.run(addEncounter('hall', encounterSchema.parse({ id: 'watch', name: 'The watch' })));
    s.run(addAdversary('hall', 'watch', { id: 'foe', adversary: 'fixture-foe', position: at }));
    for (const { card, ability } of features) s.run(addCardWithAbility(card, ability));
    const demo = buildProjectScene(s.project, seed);
    demo.askDefender = false;
    startEncounter(demo, 'watch');
    demo.state.entity('kara')!.hitPoints = { max: 60, marked: 0 };
    demo.state.entity('foe')!.hitPoints = { max: 60, marked: 0 };
    demo.party.select('kara');
    return demo;
  };

  /** Swing until the dice come up with Shadow, and say what they cost. */
  const rollUntilBad = (demo: ReturnType<typeof watched>): { good: number; fell: boolean } => {
    for (let i = 0; i < 12; i++) {
      const kara = demo.state.entity('kara')!;
      // Patched up between swings: what is under test is what the dice cost
      // her, and a Tier 3 dragon would otherwise put her down first.
      kara.good = { max: 6, value: 6 };
      kara.hitPoints = { max: 60, marked: 0 };
      kara.stress = { max: kara.stress.max, marked: 0 };
      kara.alive = true;
      if (!demo.encounter!.canAct('kara')) endTurn(demo);
      demo.state.entity('foe')!.hitPoints = { max: 60, marked: 0 };
      const before = demo.log.length;
      attackWithSelected(demo, 'foe');
      const rolled = demo.rolls.at(-1);
      if (rolled === undefined) continue;
      const withBad = rolled.roll.outcome === 'successWithBad' || rolled.roll.outcome === 'failureWithBad';
      if (!withBad) continue;
      return {
        good: demo.state.entity('kara')!.good!.value,
        fell: demo.log.slice(before).some((l) => l.text.includes('The cold takes something out of them.')),
      };
    }
    throw new Error('the dice never came up with Shadow');
  };

  it('takes a Light off a roll with Shadow made in front of it', () => {
    const demo = watched('no-hope', [COLD_WATCH]);
    const { good, fell } = rollUntilBad(demo);
    expect(fell).toBe(true);
    // Six going in, and the roll with Shadow costs one of them.
    expect(good).toBe(5);
  });

  it('leaves a roll made across the room alone', () => {
    // The same creature, out past Far range, with something in reach to swing
    // at: the dice say the same thing and it is too far off to hear them.
    const s = blank();
    s.run(addSheet(KARA));
    s.run(setSpawns('hall', [{ x: 2, y: 4 }]));
    s.run(addEncounter('hall', encounterSchema.parse({ id: 'watch', name: 'The watch' })));
    s.run(addAdversary('hall', 'watch', { id: 'foe', adversary: 'fixture-foe', position: { x: 11, y: 7 } }));
    s.run(addAdversary('hall', 'watch', { id: 'husk', adversary: 'fixture-lurker', position: { x: 3, y: 4 } }));
    s.run(addCardWithAbility(COLD_WATCH.card, COLD_WATCH.ability));
    const demo = buildProjectScene(s.project, 'no-good-far');
    demo.askDefender = false;
    startEncounter(demo, 'watch');
    demo.party.select('kara');
    expect(demo.world.bandTo('foe', 'kara')).toBe('veryFar');

    for (let i = 0; i < 12; i++) {
      const kara = demo.state.entity('kara')!;
      kara.good = { max: 6, value: 6 };
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
      const withBad = rolled.roll.outcome === 'successWithBad' || rolled.roll.outcome === 'failureWithBad';
      if (!withBad) continue;
      expect(demo.log.some((l) => l.text.includes('The cold takes something out of them.'))).toBe(false);
      expect(demo.state.entity('kara')!.good!.value).toBe(6);
      return;
    }
    throw new Error('the dice never came up with Shadow');
  });

  it('reads what the roll was, not merely that there was one', () => {
    // This one answers a *failure* with Shadow. A roll that succeeded with Shadow
    // is still a roll with Shadow, and it costs nothing.
    const demo = watched('all-must-fall', [ONLY_ON_A_FAILURE]);
    for (let i = 0; i < 12; i++) {
      const kara = demo.state.entity('kara')!;
      kara.good = { max: 6, value: 6 };
      kara.hitPoints = { max: 60, marked: 0 };
      kara.stress = { max: kara.stress.max, marked: 0 };
      kara.alive = true;
      if (!demo.encounter!.canAct('kara')) endTurn(demo);
      demo.state.entity('foe')!.hitPoints = { max: 60, marked: 0 };
      attackWithSelected(demo, 'foe');
      const rolled = demo.rolls.at(-1);
      if (rolled === undefined) continue;
      const good = demo.state.entity('kara')!.good!.value;
      if (rolled.roll.outcome === 'failureWithBad') expect(good).toBe(5);
      if (rolled.roll.outcome === 'successWithBad') expect(good).toBe(6);
      if (rolled.roll.outcome === 'failureWithGood') expect(good).toBe(6);
    }
  });
});

describe("what the party puts behind its own blow", () => {
  /** A caster holding one card, standing over something. */
  const swinging = (
    cards: readonly string[],
    seed: string,
    // What the thing being hit carries. Only one test wants a creature feature
    // here, and it answers Severe damage by hurting everyone close -- carried for
    // all thirteen it would wound the caster in fights that count her pools.
    features: readonly Printed[] = [],
  ) => {
    const s = blank();
    s.project.cards.push(...FIXTURE_CARDS);
    for (const ability of [
      ...A_TALLY_THAT_COUNTS_A_MARK,
      ...A_CHARGE_THAT_BANKS_A_WOUND,
      ...A_BLOW_FORCED_FROM_ITS_OWN_WOUNDS,
      ...A_CRACK_PAID_FOR_IN_ADVANCE,
      ...A_BONUS_OFF_THE_SHEET,
      ...A_FLOOR_UNDER_EVERY_BLOW,
      ...A_CRITICAL_WORTH_SOMETHING,
      ...AN_EDGE_ASKED_THREE_TIMES,
      ...A_LIFT_FOR_EVERYONE_NEARBY,
      ...A_ROUSING_BLOW,
      ...A_TOLL_CALLED_IN,
    ]) {
      s.project.abilities.push(abilitySchema.parse(ability));
    }
    print(s.project, ...features);
    s.run(
      addSheet(
        characterSheetSchema.parse(
          blankSheet('vela', 'emberwright', {
            name: 'Vela',
            traits: { agility: 0, strength: -1, finesse: 2, instinct: 1, presence: 0, knowledge: 2 },
            ancestryId: 'human',
            armorId: 'padded-coat',
            primaryWeaponId: 'ember-staff',
            subclassId: 'flamecaller',
            domainCards: [...cards],
          }),
        ),
      ),
    );
    s.run(setSpawns('hall', [{ x: 2, y: 4 }]));
    s.run(addEncounter('hall', encounterSchema.parse({ id: 'duel', name: 'The duel' })));
    s.run(addAdversary('hall', 'duel', { id: 'foe', adversary: 'fixture-foe', position: { x: 3, y: 4 } }));
    const demo = buildProjectScene(s.project, seed);
    demo.askDefender = false;
    startEncounter(demo, 'duel');
    demo.state.entity('foe')!.hitPoints = { max: 90, marked: 0 };
    demo.party.select('vela');
    return demo;
  };

  it('stops the swing to ask, and counts nothing until it is answered', () => {
    // The mechanism: tokens spent for a die each, asked after the roll and before
    // the thresholds read anything.
    for (let seed = 1; seed < 40; seed++) {
      const demo = swinging([CHARGE_CARD], `charge-${seed}`);
      demo.askDefender = true;
      demo.world.addTokens('vela', CHARGE_TOKENS, 2);
      const swung = attackWithSelected(demo, 'foe');
      if (swung === null || !swung.hit) continue;

      // The blow is in the air: nothing has been marked, and the question is up.
      expect(swung.waiting).toBe(true);
      expect(swung.hitPointsMarked).toBe(0);
      expect(demo.pending?.kind).toBe('reaction');
      expect(demo.state.entity('foe')!.hitPoints.marked).toBe(0);

      // Two tokens in: they go, and the blow lands heavier than it rolled.
      answerPending(demo, { kind: 'choose', index: 1 });
      if (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 1 });
      expect(demo.pending).toBeNull();
      expect(demo.world.tokensOn('vela', CHARGE_TOKENS)).toBe(0);
      expect(demo.state.entity('foe')!.hitPoints.marked).toBeGreaterThan(0);
      expect(demo.log.some((l) => /hits with|lands a critical with/.test(l.text))).toBe(true);

      // And the dice went into the blow: the same seed and the same swing,
      // the only difference being whether the card was played.
      const cold = swinging([CHARGE_CARD], `charge-${seed}`);
      cold.askDefender = true;
      cold.world.addTokens('vela', CHARGE_TOKENS, 2);
      attackWithSelected(cold, 'foe');
      answerPending(cold, { kind: 'choose', index: 0 });
      if (demo.state.entity('foe')!.hitPoints.marked <= cold.state.entity('foe')!.hitPoints.marked) continue;
      return;
    }
    throw new Error('no seed landed a charged swing in forty tries');
  });

  it('lands the blow when the card is let pass, and swings straight through without one', () => {
    // Declining is still an answer, and the swing it was holding still lands.
    for (let seed = 1; seed < 40; seed++) {
      const demo = swinging([CHARGE_CARD], `pass-${seed}`);
      demo.askDefender = true;
      demo.world.addTokens('vela', CHARGE_TOKENS, 2);
      const swung = attackWithSelected(demo, 'foe');
      if (swung === null || !swung.hit) continue;
      expect(swung.waiting).toBe(true);
      answerPending(demo, { kind: 'choose', index: 0 });
      expect(demo.pending).toBeNull();
      expect(demo.world.tokensOn('vela', CHARGE_TOKENS)).toBe(2);
      expect(demo.state.entity('foe')!.hitPoints.marked).toBeGreaterThan(0);

      // And a caster with nothing to say swings in one call, as always.
      const plain = swinging([], `plain-${seed}`);
      plain.askDefender = true;
      const straight = attackWithSelected(plain, 'foe');
      expect(straight?.waiting).toBeUndefined();
      expect(plain.pending).toBeNull();
      if (straight?.hit === true) expect(straight.hitPointsMarked).toBeGreaterThanOrEqual(0);
      return;
    }
    throw new Error('no seed landed a swing in forty tries');
  });

  it('rolls the dice a mark collected without stopping to ask, and they land', () => {
    // Nothing is asked and nothing is spent, so the card runs on its own -- and
    // what it rolled has to reach the blow that is still being held, rather than
    // the log alone.
    for (let seed = 1; seed < 40; seed++) {
      const demo = swinging([MARKED_TALLY_CARD], `tally-${seed}`);
      demo.askDefender = true;
      demo.state.entity('foe')!.conditions.add(MARKED);
      demo.world.addTokens('vela', TALLY, 3);
      const swung = attackWithSelected(demo, 'foe');
      if (swung === null || !swung.hit) continue;

      // It never became a question, and the dice are off the card.
      expect(swung.waiting).toBeUndefined();
      expect(demo.pending).toBeNull();
      expect(demo.world.tokensOn('vela', TALLY)).toBe(0);

      // The same seed and the same swing, with nothing marked to pay for.
      const cold = swinging([MARKED_TALLY_CARD], `tally-${seed}`);
      cold.askDefender = true;
      cold.world.addTokens('vela', TALLY, 3);
      attackWithSelected(cold, 'foe');
      expect(cold.world.tokensOn('vela', TALLY)).toBe(3);
      if (demo.state.entity('foe')!.hitPoints.marked <= cold.state.entity('foe')!.hitPoints.marked) continue;
      return;
    }
    throw new Error('no seed landed a marked swing in forty tries');
  });

  it('forces the Hit Points a blow marks, whatever the dice said', () => {
    // The mechanism: four Stress to hand back exactly what the caster is carrying,
    // past the thresholds and past whatever armour would have turned it aside.
    for (let seed = 1; seed < 40; seed++) {
      const demo = swinging([FORCED_CARD], `monster-${seed}`);
      demo.askDefender = true;
      demo.state.entity('vela')!.hitPoints = { max: 6, marked: 3 };
      demo.state.entity('vela')!.stress = { max: 6, marked: 0 };
      const swung = attackWithSelected(demo, 'foe');
      if (swung === null || !swung.hit) continue;

      expect(swung.waiting).toBe(true);
      answerPending(demo, { kind: 'choose', index: 1 });
      expect(demo.pending).toBeNull();
      expect(demo.state.entity('foe')!.hitPoints.marked).toBe(3);
      expect(demo.state.entity('vela')!.stress.marked).toBe(4);
      return;
    }
    throw new Error('no seed landed a swing in forty tries');
  });

  it('reads Severe as a floor when a forced blow lands past it', () => {
    // Four Hit Points at once is worse than Severe, and a feature that answers
    // Severe damage still fires: the band is a floor, not a bracket.
    for (let seed = 1; seed < 40; seed++) {
      const demo = swinging([FORCED_CARD], `massive-${seed}`, [A_WOUND_THAT_ANSWERS('fixture-foe')]);
      demo.askDefender = true;
      demo.state.entity('vela')!.hitPoints = { max: 8, marked: 4 };
      demo.state.entity('vela')!.stress = { max: 6, marked: 0 };
      const swung = attackWithSelected(demo, 'foe');
      if (swung === null || !swung.hit) continue;
      answerPending(demo, { kind: 'choose', index: 1 });
      expect(demo.state.entity('foe')!.hitPoints.marked).toBe(4);
      expect(demo.log.some((l) => l.text.includes('The wound opens, and the room pays for it.'))).toBe(true);
      return;
    }
    throw new Error('no seed landed a swing in forty tries');
  });

  it('will not force nothing: an unmarked caster is not offered the card', () => {
    const demo = swinging([FORCED_CARD], 'monster-clean');
    demo.state.entity('vela')!.hitPoints = { max: 6, marked: 0 };
    demo.state.entity('vela')!.stress = { max: 6, marked: 0 };
    expect(demo.world.reactionsFor('vela', 'rollingDamage', { targets: ['foe'], hit: ['foe'] })).toEqual([]);
    demo.state.entity('vela')!.hitPoints = { max: 6, marked: 1 };
    expect(demo.world.reactionsFor('vela', 'rollingDamage', { targets: ['foe'], hit: ['foe'] }).map((a) => a.id)).toEqual([
      FORCED_ABILITY,
    ]);
  });

  it('leaves a crack in one blow and goes through it with the next', () => {
    // One card, two moments: a Stress opens the crack, and the second half pays
    // out on its own when the next blow goes through it.
    for (let seed = 1; seed < 40; seed++) {
      const demo = swinging([BREAK_CARD], `break-${seed}`);
      const cold = swinging([BREAK_CARD], `break-${seed}`);
      demo.askDefender = true;
      cold.askDefender = true;
      const first = attackWithSelected(demo, 'foe');
      const same = attackWithSelected(cold, 'foe');
      if (first === null || !first.hit || same === null || !same.hit) continue;

      // The offer is the card; the control lets it pass, at the same cost in
      // dice, so the two swings that follow are rolled off the same seed.
      expect(demo.pending?.kind).toBe('reaction');
      answerPending(demo, { kind: 'choose', index: 1 });
      answerPending(cold, { kind: 'choose', index: 0 });
      expect(demo.state.entity('foe')!.conditions.has(BROKEN)).toBe(true);
      expect(cold.state.entity('foe')!.conditions.has(BROKEN)).toBe(false);

      const marked = demo.state.entity('foe')!.hitPoints.marked;
      const plain = cold.state.entity('foe')!.hitPoints.marked;
      const again = attackWithSelected(demo, 'foe');
      attackWithSelected(cold, 'foe');
      if (again === null || !again.hit) continue;

      // The crack is spent by the blow that went through it, and what is being
      // asked now is the card again, on the new hit. Let it pass.
      expect(demo.state.entity('foe')!.conditions.has(BROKEN)).toBe(false);
      if (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
      if (cold.pending !== null) answerPending(cold, { kind: 'choose', index: 0 });
      const through = demo.state.entity('foe')!.hitPoints.marked - marked;
      const without = cold.state.entity('foe')!.hitPoints.marked - plain;
      if (through <= without) continue;
      return;
    }
    throw new Error('no seed landed two swings in forty tries');
  });

  it('puts twice a trait behind the blow, once the blow is worth it', () => {
    // The number comes off the sheet rather than the card, so a caster who has
    // been lifting reads four where the card only names a trait.
    for (let seed = 1; seed < 40; seed++) {
      const demo = swinging([RAGE_CARD], `rage-${seed}`);
      const cold = swinging([RAGE_CARD], `rage-${seed}`);
      for (const scene of [demo, cold]) {
        scene.askDefender = true;
        const vela = scene.characters.get('vela')!;
        scene.characters.set('vela', { ...vela, traits: { ...vela.traits, strength: 2 } });
        refreshWorld(scene);
        scene.state.entity('vela')!.stress = { max: 6, marked: 0 };
      }
      const swung = attackWithSelected(demo, 'foe');
      const same = attackWithSelected(cold, 'foe');
      if (swung === null || !swung.hit || same === null || !same.hit) continue;

      expect(swung.waiting).toBe(true);
      answerPending(demo, { kind: 'choose', index: 1 });
      answerPending(cold, { kind: 'choose', index: 0 });
      expect(demo.state.entity('vela')!.stress.marked).toBe(1);
      expect(cold.state.entity('vela')!.stress.marked).toBe(0);
      if (demo.state.entity('foe')!.hitPoints.marked <= cold.state.entity('foe')!.hitPoints.marked) continue;
      return;
    }
    throw new Error('no seed landed a raging swing in forty tries');
  });

  it('never lets a blow land beneath the band the card floors it at', () => {
    // Counted as rolled, then lifted to the band. The seed hunted for is one where
    // the blow really was smaller, so the lift is doing the work.
    for (let seed = 1; seed < 60; seed++) {
      const cold = swinging([], `floor-${seed}`);
      cold.askDefender = true;
      const plain = attackWithSelected(cold, 'foe');
      if (plain === null || !plain.hit || plain.hitPointsMarked !== 1) continue;

      const demo = swinging([FLOOR_CARD], `floor-${seed}`);
      demo.askDefender = true;
      const swung = attackWithSelected(demo, 'foe');
      expect(swung?.hit).toBe(true);
      expect(demo.state.entity('foe')!.hitPoints.marked).toBe(2);
      // And nothing was asked: the floor costs nothing and is not a decision.
      expect(demo.pending).toBeNull();
      return;
    }
    throw new Error('no seed landed a blow small enough to floor in sixty tries');
  });

  /**
   * A seed whose swing comes up a critical, found once and used by everything
   * that answers one. The dice are the same whichever of these cards is held:
   * all four are reactions, and none of them touches the roll.
   */
  const critical = (): number => {
    for (let seed = 1; seed < 400; seed++) {
      const demo = swinging([], `crit-${seed}`);
      const swung = attackWithSelected(demo, 'foe');
      if (swung?.hit === true && demo.log.some((l) => l.text.includes('lands a critical with'))) return seed;
    }
    throw new Error('no seed rolled a critical in four hundred tries');
  };

  it('answers a critical, and says nothing about an ordinary hit', () => {
    const seed = critical();
    const demo = swinging([GLORY_CARD], `crit-${seed}`);
    demo.askDefender = true;
    demo.state.entity('vela')!.stress = { max: 6, marked: 3 };
    expect(attackWithSelected(demo, 'foe')?.hit).toBe(true);

    // The card is free and not a decision, so it simply asks its question.
    expect(demo.pending?.kind).toBe('script');
    answerPending(demo, { kind: 'choose', index: 1 });
    // Three marked, one cleared by the critical itself, and one more by the card.
    expect(demo.state.entity('vela')!.stress.marked).toBe(1);

    // An ordinary hit is not a critical, and the card has nothing to say.
    for (let other = 1; other < 400; other++) {
      if (other === seed) continue;
      const plain = swinging([GLORY_CARD], `crit-${other}`);
      plain.askDefender = true;
      const swung = attackWithSelected(plain, 'foe');
      if (swung?.hit !== true || plain.log.some((l) => l.text.includes('lands a critical with'))) continue;
      expect(plain.pending).toBeNull();
      return;
    }
    throw new Error('no seed rolled an ordinary hit in four hundred tries');
  });

  it('asks for each Light in turn, and spends only what was said yes to', () => {
    // Three questions, asked in the order they are written, each for a Light and
    // each offering a plain no -- so none can be taken twice.
    const demo = swinging([EDGE_CARD], `crit-${critical()}`);
    demo.askDefender = true;
    const vela = demo.state.entity('vela')!;
    vela.good = { max: 6, value: 3 };
    vela.hitPoints = { max: 6, marked: 2 };
    vela.armorSlots = { max: 3, marked: 2 };
    const foe = demo.state.entity('foe')!;
    expect(attackWithSelected(demo, 'foe')?.hit).toBe(true);
    const marked = foe.hitPoints.marked;

    // The card is a decision, so it is offered before anything is asked.
    expect(demo.pending?.kind).toBe('reaction');
    answerPending(demo, { kind: 'choose', index: 1 });

    // Three questions in the order the card prints them: yes, no, yes.
    answerPending(demo, { kind: 'choose', index: 0 });
    answerPending(demo, { kind: 'choose', index: 1 });
    answerPending(demo, { kind: 'choose', index: 0 });
    expect(demo.pending).toBeNull();
    expect(vela.hitPoints.marked).toBe(1);
    expect(vela.armorSlots.marked).toBe(2);
    expect(foe.hitPoints.marked).toBe(marked + 1);
    // Three Light, one more for the critical, two spent on the two yeses.
    expect(vela.good!.value).toBe(2);
  });

  it('hands the room a Light or a Stress off one critical, once per rest', () => {
    const seed = critical();
    const demo = swinging([ROOM_LIFT_CARD], `crit-${seed}`);
    demo.askDefender = true;
    const vela = demo.state.entity('vela')!;
    vela.stress = { max: 6, marked: 2 };
    expect(attackWithSelected(demo, 'foe')?.hit).toBe(true);
    expect(demo.pending?.kind).toBe('script');
    // Nobody else is standing in this fixture, so what the card is worth here
    // is the asking: the allies it clears for are read off the same selector
    // every other card uses.
    answerPending(demo, { kind: 'choose', index: 0 });
    expect(demo.pending).toBeNull();

    // The other card answers the same moment and counts its holder in, which is
    // the difference between the two.
    const roused = swinging([ROUSE_CARD], `crit-${seed}`);
    roused.askDefender = true;
    roused.state.entity('vela')!.hitPoints = { max: 6, marked: 2 };
    expect(attackWithSelected(roused, 'foe')?.hit).toBe(true);
    expect(roused.pending?.kind).toBe('script');
    answerPending(roused, { kind: 'choose', index: 0 });
    expect(roused.state.entity('vela')!.hitPoints.marked).toBe(1);
  });

  it('will not call in a toll on somebody who is not carrying one', () => {
    const demo = swinging([TOLL_CARD], 'toll');
    demo.askDefender = true;
    demo.world.addTokens('vela', TOLL_ABILITY, 1);
    // Nobody is marked yet, so the payout has nothing to answer.
    const card = abilitiesOf(demo, 'vela').find((a) => a.id === TOLL_PAID)!;
    expect(card.available).toBeDefined();
    demo.state.entity('foe')!.conditions.add(TOLLED);
    expect(demo.world.reactionsFor('vela', 'rollingDamage', { targets: ['foe'], hit: ['foe'] }).map((a) => a.id)).toEqual([
      TOLL_PAID,
    ]);
    demo.state.entity('foe')!.conditions.delete(TOLLED);
    expect(demo.world.reactionsFor('vela', 'rollingDamage', { targets: ['foe'], hit: ['foe'] })).toEqual([]);
  });
});

describe('a creature that acts again, and one that acts out of turn', () => {
  /** Quim, and whatever is standing over her. */
  const room = (seed: string, blocks: readonly { id: string; adversary: string; x: number }[]) => {
    const s = blank();
    // The pack's abilities, not a catalogue's. The blocks these tests place carry their own
    // features, pushed into the project a few lines below; the library was breadth for its
    // own sake.
    for (const ability of STARTER_ABILITIES) s.run(addAbility(ability));
    s.run(addSheet(KARA));
    s.run(setSpawns('hall', [{ x: 4, y: 4 }]));
    s.run(addEncounter('hall', encounterSchema.parse({ id: 'duel', name: 'The duel' })));
    for (const block of blocks) {
      s.run(addAdversary('hall', 'duel', { id: block.id, adversary: block.adversary, position: { x: block.x, y: 4 } }));
      // Only the block whose feature is under test carries one. A plain foe
      // handed an overload would kill Quim early and fail a loop that is
      // waiting on something else entirely.
      const feature =
        block.adversary === 'fixture-brute'
          ? AN_OVERLOAD_THAT_BUYS_ANOTHER_TURN(block.adversary)
          : block.adversary === 'fixture-lurker'
            ? A_HUNGER_DRAWN_TO_A_WOUND(block.adversary)
            : undefined;
      if (feature !== undefined) print(s.project, feature);
    }
    const demo = buildProjectScene(s.project, seed);
    demo.askDefender = false;
    startEncounter(demo, 'duel');
    demo.party.select('kara');
    demo.state.entity('kara')!.hitPoints = { max: 40, marked: 0 };
    return demo;
  };

  it('overloads, and takes the turn again on the Stress that paid for it', () => {
    // The second half of the mechanism: it takes the spotlight again. With no
    // Shadow in the pool a second spotlight is something only the feature can buy,
    // so a turn count above one is the feature and nothing else.
    for (let seed = 1; seed < 30; seed++) {
      const demo = room(`overload-${seed}`, [{ id: 'foe', adversary: 'fixture-brute', x: 5 }]);
      demo.state.bad = { ...demo.state.bad, value: 0 };
      const acted = endTurn(demo);
      if (!demo.log.some((l) => l.text.includes('It overloads'))) continue;
      expect(acted).toBeGreaterThanOrEqual(2);

      // The same fight with nothing left to mark: it overloads nothing, and
      // takes the one turn the pool can pay for.
      const spent = room(`overload-${seed}`, [{ id: 'foe', adversary: 'fixture-brute', x: 5 }]);
      spent.state.bad = { ...spent.state.bad, value: 0 };
      const foe = spent.state.entity('foe')!;
      foe.stress = { ...foe.stress, marked: foe.stress.max };
      expect(endTurn(spent)).toBe(1);
      return;
    }
    throw new Error('nothing landed a blow to overload in thirty tries');
  });

  it('smells blood in the water and comes for whoever is bleeding', () => {
    // The mechanism: a creature that answers a wound it did not take. The Foe
    // does the cutting, and the Lurker reacts to a hit that was never aimed at
    // it.
    for (let seed = 1; seed < 30; seed++) {
      const demo = room(`lurker-${seed}`, [
        { id: 'foe', adversary: 'fixture-foe', x: 5 },
        { id: 'lurker', adversary: 'fixture-lurker', x: 6 },
      ]);
      const lurker = demo.state.entity('lurker')!;
      const before = lurker.stress.marked;
      for (let turn = 0; turn < 3 && demo.encounter?.outcome === 'ongoing'; turn++) endTurn(demo);
      if (!demo.log.some((l) => l.text.includes('uses Drawn to the Wound'))) continue;

      expect(demo.log.some((l) => l.text.includes('something turns toward it'))).toBe(true);
      expect(lurker.stress.marked).toBeGreaterThan(before);
      // It moved to the wound: the Lurker is standing over Quim now.
      expect(demo.world.bandTo('lurker', 'kara')).toBe('melee');
      return;
    }
    throw new Error('nothing bled near the Lurker in thirty tries');
  });
});

describe('a breath that only comes when the dice say so', () => {
  /** Dice that always come up their best, for a feature whose gate is a d10. */
  const everyDieHigh = (): Rng => {
    const rng: Rng = {
      next: () => 0.99,
      nextInt: (max: number) => max - 1,
      die: (sides: number) => sides,
      dice: (count: number, sides: number) => Array.from({ length: count }, () => sides),
      pick: <T,>(items: readonly T[]) => items[0]!,
      shuffle: <T,>(items: T[]) => items,
      fork: () => rng,
      save: () => ({}) as ReturnType<Rng['save']>,
      restore: () => {},
    };
    return rng;
  };

  const dragon = (seed: string) => {
    const s = blank();
    // The pack's abilities, not a catalogue's. The blocks these tests place carry their own
    // features, pushed into the project a few lines below; the library was breadth for its
    // own sake.
    for (const ability of STARTER_ABILITIES) s.run(addAbility(ability));
    s.run(addSheet(KARA));
    s.run(setSpawns('hall', [{ x: 2, y: 4 }]));
    s.run(addEncounter('hall', encounterSchema.parse({ id: 'duel', name: 'The duel' })));
    s.run(
      addAdversary('hall', 'duel', {
        id: 'foe',
        adversary: 'fixture-champion',
        position: { x: 4, y: 4 },
      }),
    );
    print(s.project, A_BREATH_GATED_ON_A_DIE('fixture-champion'));
    const demo = buildProjectScene(s.project, seed);
    demo.askDefender = false;
    startEncounter(demo, 'duel');
    demo.party.select('kara');
    return demo;
  };

  it('asks the d10 only when the wound was Major, and scorches the room when it comes up', () => {
    const demo = dragon('lava');
    const bound = { targets: [], hit: [] };

    // The gate on the blow: two Hit Points marked is the number the hit left
    // behind, and one is not enough. It is a count the blow carries rather than
    // a band read back off anything.
    expect(demo.world.reactionsFor('foe', 'tookDamage', { ...bound, counts: { hitPointsTaken: 1 } })).toEqual([]);
    expect(
      demo.world
        .reactionsFor('foe', 'tookDamage', { ...bound, counts: { hitPointsTaken: 2 } })
        .map((a) => a.id),
    ).toEqual(['fixture-champion-volcanic-breath']);

    // And with the d10 coming up, what it breathes reaches whoever is standing
    // there. The dice are rigged high here because the second gate is a roll,
    // and a test waiting on an 8 in 10 would be a slow way to learn nothing.
    const card = demo.world.reactionsFor('foe', 'tookDamage', { ...bound, counts: { hitPointsTaken: 2 } })[0]!;
    const was = demo.scenario.actorId;
    demo.scenario.actorId = 'foe';
    const journal = runScript(card.effects, demo.world, everyDieHigh(), {
      targets: [],
      hit: [],
      counts: { hitPointsTaken: 2 },
    });
    demo.scenario.actorId = was;
    expect(journal.some((e) => e.kind === 'diceChecked' && e.passed)).toBe(true);
    expect(journal.some((e) => e.kind === 'reaction')).toBe(true);
    const kara = demo.state.entity('kara')!;
    expect(kara.hitPoints.marked + kara.stress.marked).toBeGreaterThan(0);
  });
});

describe('what a card makes of somebody else being hit', () => {
  /** The caster holding a tally, a friend to stand in front of it, and a foe. */
  const pair = (seed: string, cards: readonly string[] = [MARKED_TALLY_CARD]) => {
    const s = blank();
    s.run(
      addSheet(
        characterSheetSchema.parse(
          blankSheet('vela', 'emberwright', {
            name: 'Vela',
            traits: { agility: 0, strength: -1, finesse: 1, instinct: 1, presence: 0, knowledge: 2 },
            ancestryId: 'human',
            armorId: 'padded-coat',
            primaryWeaponId: 'ember-staff',
            subclassId: 'flamecaller',
            domainCards: [...cards],
          }),
        ),
      ),
    );
    s.run(addSheet(KARA));
    s.run(setSpawns('hall', [{ x: 8, y: 4 }, { x: 4, y: 4 }]));
    s.run(addEncounter('hall', encounterSchema.parse({ id: 'duel', name: 'The duel' })));
    s.run(addAdversary('hall', 'duel', { id: 'foe', adversary: 'fixture-foe', position: { x: 5, y: 4 } }));
    // The cards the hands are drawn from, and the specimens that come with them.
    // A card nobody holds is offered to nobody, so both families are carried
    // whichever one this run puts in a loadout.
    s.project.cards.push(...FIXTURE_CARDS);
    for (const ability of [...A_TALLY_THAT_COUNTS_A_MARK, ...AN_ANSWER_TO_A_BLOW_ON_AN_ALLY]) {
      s.project.abilities.push(abilitySchema.parse(ability));
    }
    const demo = buildProjectScene(s.project, seed);
    demo.askDefender = false;
    startEncounter(demo, 'duel');
    demo.state.entity('foe')!.conditions.add(MARKED);
    demo.party.select('vela');
    return demo;
  };

  it('puts a die on the card when the marked creature hurts an ally', () => {
    // The mechanism: a marked creature hurting anybody adds to the count. Quim is
    // the one standing in front of it; the card is Vela's, and it hears about her
    // wound from across the room.
    for (let seed = 1; seed < 30; seed++) {
      const demo = pair(`ally-${seed}`);
      const kara = demo.state.entity('kara')!;
      for (let turn = 0; turn < 3 && kara.hitPoints.marked === 0; turn++) endTurn(demo);
      if (kara.hitPoints.marked === 0) continue;
      expect(demo.world.tokensOn('vela', TALLY)).toBeGreaterThan(0);
      return;
    }
    throw new Error('nothing landed a blow on Quim in thirty tries');
  });

  it('answers a blow that landed on somebody else, once it is offered', () => {
    // The mechanism: a blow on an ally, within reach of the one holding the card,
    // bought with a Stress -- and what it buys is a Reaction Roll the attacker has
    // to make, with a Hit Point for failing it.
    for (let seed = 1; seed < 30; seed++) {
      const demo = pair(`answer-${seed}`, [ANSWERING_CARD]);
      demo.askDefender = true;

      // Turns until the card is the question on the table, answering every
      // other question the fight asks with the plainest answer there is.
      let offered = -1;
      for (let turn = 0; turn < 4 && offered < 0 && demo.encounter?.outcome === 'ongoing'; turn++) {
        endTurn(demo);
        while (demo.pending !== null && offered < 0) {
          const waiting = demo.pending;
          if (waiting.kind === 'reaction') {
            const found = waiting.offers.findIndex((o) => o.ability.id === 'fixture-answer');
            if (found >= 0) {
              offered = found + 1;
              break;
            }
          }
          answerPending(demo, { kind: 'choose', index: 0 });
        }
      }
      if (offered < 0) continue;

      const foe = demo.state.entity('foe')!;
      const before = { hp: foe.hitPoints.marked, stress: demo.state.entity('vela')!.stress.marked };
      answerPending(demo, { kind: 'choose', index: offered });
      expect(demo.state.entity('vela')!.stress.marked).toBe(before.stress + 1);
      // It rolls against the 15 the card names; a failure costs it a Hit Point,
      // and either way it was made to answer.
      expect(demo.log.some((l) => /reacts: \d+ against 15/.test(l.text))).toBe(true);
      expect(foe.hitPoints.marked).toBeGreaterThanOrEqual(before.hp);
      return;
    }
    throw new Error('nothing landed a blow on Quim in thirty tries');
  });

  it('says nothing about a blow from something that carries no mark', () => {
    for (let seed = 1; seed < 30; seed++) {
      const demo = pair(`plain-${seed}`);
      demo.state.entity('foe')!.conditions.delete(MARKED);
      const kara = demo.state.entity('kara')!;
      for (let turn = 0; turn < 3 && kara.hitPoints.marked === 0; turn++) endTurn(demo);
      if (kara.hitPoints.marked === 0) continue;
      expect(demo.world.tokensOn('vela', TALLY)).toBe(0);
      return;
    }
    throw new Error('nothing landed a blow on Quim in thirty tries');
  });
});

describe('asking the player how many', () => {
  /** A caster and a wounded friend, both holding one card. */
  const twoOfThem = (cards: readonly string[], seed: string) => {
    const s = blank();
    s.run(
      addSheet(
        characterSheetSchema.parse(
          blankSheet('vela', 'emberwright', {
            name: 'Vela',
            traits: { agility: 0, strength: -1, finesse: 1, instinct: 1, presence: 0, knowledge: 2 },
            ancestryId: 'human',
            armorId: 'padded-coat',
            primaryWeaponId: 'ember-staff',
            subclassId: 'flamecaller',
            domainCards: [...cards],
          }),
        ),
      ),
    );
    s.run(addSheet(KARA));
    s.run(setSpawns('hall', [{ x: 2, y: 4 }, { x: 3, y: 4 }]));
    s.run(addEncounter('hall', encounterSchema.parse({ id: 'duel', name: 'The duel' })));
    s.run(addAdversary('hall', 'duel', { id: 'foe', adversary: 'fixture-foe', position: { x: 5, y: 4 } }));
    s.project.cards.push(...FIXTURE_CARDS);
    for (const ability of [...A_SHARE_OF_WHAT_THEY_CARRY, ...A_SPEND_OF_WHATEVER_IS_ON_THE_CARD]) {
      s.project.abilities.push(abilitySchema.parse(ability));
    }
    const demo = buildProjectScene(s.project, seed);
    demo.askDefender = false;
    startEncounter(demo, 'duel');
    demo.party.select('vela');
    return demo;
  };

  it('offers one button per amount, and takes exactly what was pressed', () => {
    // The mechanism: as much of their marked Stress as the player says, onto the
    // one offering, and a Light for each point carried.
    const demo = twoOfThem([SHARING_CARD], 'burden');
    const kara = demo.state.entity('kara')!;
    const vela = demo.state.entity('vela')!;
    kara.stress = { max: 6, marked: 3 };
    vela.stress = { max: 6, marked: 0 };
    vela.good = { max: 6, value: 0 };

    const used = useAbility(demo, 'vela', SHARE_ABILITY, ['kara']);
    expect(used.status).toBe('waiting');
    const prompt = demo.pending!.prompt;
    expect(prompt.kind).toBe('choice');
    expect(prompt.kind === 'choice' ? prompt.options.map((o) => o.label) : []).toEqual(['1', '2', '3']);

    // The second button: two off her, two onto Vela, two Light for the carrying.
    answerPending(demo, { kind: 'choose', index: 1 });
    expect(kara.stress.marked).toBe(1);
    expect(vela.stress.marked).toBe(2);
    expect(vela.good.value).toBe(2);
  });

  it('will not ask when there is nothing to take', () => {
    const demo = twoOfThem([SHARING_CARD], 'burden-none');
    demo.state.entity('kara')!.stress = { max: 6, marked: 0 };
    useAbility(demo, 'vela', SHARE_ABILITY, ['kara']);
    expect(demo.log.some((l) => l.text.includes('there is none of it to spend'))).toBe(true);
  });

  it('rolls as many dice as the tokens the player let go of', () => {
    // The number of options depends on what is on the card, which is exactly the
    // question `howMany` asks. Seeds until the Spellcast Roll lands, because a
    // miss rolls no dice to count.
    for (let seed = 1; seed < 40; seed++) {
      const demo = twoOfThem([CHAOS_CARD], `chaos-${seed}`);
      demo.world.addTokens('vela', CHAOS_ABILITY, 2);
      expect(useAbility(demo, 'vela', CHAOS_ABILITY, ['foe']).status).toBe('waiting');
      const prompt = demo.pending!.prompt;
      expect(prompt.kind === 'choice' ? prompt.options.map((o) => o.label) : []).toEqual(['1', '2']);

      answerPending(demo, { kind: 'choose', index: 1 });
      // Two tokens go whether the roll lands or not: the card spends them to
      // make the attempt, which is what `each` says and the asking does not.
      expect(demo.world.tokensOn('vela', CHAOS_ABILITY)).toBe(0);
      if (demo.pending !== null) answerPending(demo, { kind: 'roll' });
      if (!demo.log.some((l) => l.text.includes('2d10'))) continue;
      return;
    }
    throw new Error('no seed landed the spend in forty tries');
  });
});

describe('a Spellcast Roll against a target, and what it leaves on them', () => {
  /** A caster holding one card, with something to point it at. */
  const casting = (cards: readonly string[], seed: string, at: { x: number; y: number } = { x: 3, y: 4 }) => {
    const sheet = characterSheetSchema.parse(
      blankSheet('vela', 'emberwright', {
        name: 'Vela',
        traits: { agility: 0, strength: -1, finesse: 1, instinct: 1, presence: 0, knowledge: 2 },
        ancestryId: 'human',
        armorId: 'padded-coat',
        primaryWeaponId: 'ember-staff',
        subclassId: 'flamecaller',
        domainCards: [...cards],
      }),
    );
    const s = blank();
    // A blank project ships no cards, so the block carries the ones it holds.
    s.project.cards.push(...FIXTURE_CARDS);
    for (const ability of [
      ...A_TETHER_THAT_BINDS,
      ...A_HOLD_ON_ONE_OF_THEM,
      ...A_HOLD_ON_THE_WHOLE_ROOM,
      ...A_BLAST_AROUND_WHAT_IT_HIT,
      ...A_GLYPH_THAT_OPENS_THEM_UP,
    ]) {
      s.project.abilities.push(abilitySchema.parse(ability));
    }
    for (const condition of [HELD_CONDITION, GLYPHED_CONDITION]) {
      s.project.conditionDefs.push(conditionDefSchema.parse(condition));
    }
    s.run(addSheet(sheet));
    s.run(setSpawns('hall', [{ x: 2, y: 4 }]));
    s.run(addEncounter('hall', encounterSchema.parse({ id: 'duel', name: 'The duel' })));
    s.run(addAdversary('hall', 'duel', { id: 'foe', adversary: 'fixture-foe', position: at }));
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
    // The mechanism: a success binds them where they stand and costs them a
    // Stress. `restrained` is the engine's own, so what this reads is the
    // engine's handling of a temporary condition on a creature.
    const demo = landed([TETHER_CARD], TETHER_ABILITY, (d) =>
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
    // What the condition does is on the condition, so the card only has to put
    // the name on them -- and the two Evasion is read off the definition.
    const demo = landed([HELD_CARD], HELD_ABILITY, (d) => d.state.entity('foe')!.conditions.has(HELD));
    expect(demo).not.toBeNull();
    const held = demo!.world.defenderOf(demo!.state.entity('foe')!).difficulty;
    const free = casting([HELD_CARD], 'plain');
    expect(held).toBe(free.world.defenderOf(free.state.entity('foe')!).difficulty - 2);
  });

  it('holds the whole room, and lets go of all of them at once', () => {
    // A seed where the song lands *and* the spotlight stays with the party,
    // so the second half is a move Vela can still make.
    const demo = landed(
      [ROOM_HELD_CARD],
      ROOM_HELD_ABILITY,
      (d) => d.state.entity('foe')!.conditions.has(HELD) && d.encounter!.view().side === 'party',
    );
    expect(demo).not.toBeNull();
    // The hold ending IS the condition coming off: there is nothing else holding
    // it, so the release marks them and clears it in one move.
    const before = demo!.state.entity('foe')!.stress.marked;
    demo!.party.select('vela');
    expect(useAbility(demo!, 'vela', ROOM_HELD_RELEASE).status).toBe('done');
    expect(demo!.state.entity('foe')!.stress.marked).toBe(before + 1);
    expect(demo!.state.entity('foe')!.conditions.has(HELD)).toBe(false);
  });

  it('goes up around the one it hit, not around the one who threw it', () => {
    // "The target and all creatures within Very Close range of them must make
    // a Reaction Roll": the ring is read around the target of the check, which
    // is what `around: 'target'` means inside what the check succeeded at.
    for (let seed = 1; seed < 40; seed++) {
      const s = blank();
      s.project.cards.push(...FIXTURE_CARDS);
      for (const ability of A_BLAST_AROUND_WHAT_IT_HIT) s.project.abilities.push(abilitySchema.parse(ability));
      s.run(
        addSheet(
          characterSheetSchema.parse(
            blankSheet('vela', 'emberwright', {
              name: 'Vela',
              traits: { agility: 0, strength: -1, finesse: 1, instinct: 1, presence: 0, knowledge: 2 },
              ancestryId: 'human',
              armorId: 'padded-coat',
              primaryWeaponId: 'ember-staff',
              subclassId: 'flamecaller',
              domainCards: [BLAST_CARD],
            }),
          ),
        ),
      );
      s.run(setSpawns('hall', [{ x: 1, y: 1 }]));
      s.run(addEncounter('hall', encounterSchema.parse({ id: 'duel', name: 'The duel' })));
      // Both of them together, and both far from Vela: a ring read around her
      // would catch neither.
      s.run(addAdversary('hall', 'duel', { id: 'foe', adversary: 'fixture-foe', position: { x: 9, y: 6 } }));
      s.run(addAdversary('hall', 'duel', { id: 'beside', adversary: 'fixture-foe', position: { x: 10, y: 6 } }));
      const demo = buildProjectScene(s.project, `blast-${seed}`);
      demo.askDefender = false;
      startEncounter(demo, 'duel');
      demo.party.select('vela');
      for (const id of ['foe', 'beside']) demo.state.entity(id)!.hitPoints = { max: 90, marked: 0 };

      if (useAbility(demo, 'vela', BLAST_ABILITY, ['foe']).status === 'waiting') answerPending(demo, { kind: 'roll' });
      if (!demo.log.some((l) => l.text.includes('comes apart where it lands'))) continue;
      const said = demo.log.map((l) => l.text).join(' | ');
      expect(said).toContain('Foe');
      // Both of them answered the blast, not just the one it was thrown at.
      expect(demo.state.entity('foe')!.hitPoints.marked + demo.state.entity('beside')!.hitPoints.marked).toBeGreaterThan(0);
      expect(demo.state.entity('beside')!.hitPoints.marked).toBeGreaterThan(0);
      return;
    }
    throw new Error('no seed landed the blast in forty tries');
  });

  it('leaves a glyph on for one of their spotlights, and no longer', () => {
    // "Temporarily" is the creature's next spotlight: it acts under whatever
    // was put on it, and sheds it at the end of the turn - so a caster who
    // spends their turn on a debuff buys the party exactly one round of it.
    const demo = landed([GLYPH_CARD], GLYPH_ABILITY, (d) =>
      d.state.entity('foe')!.conditions.has(GLYPHED),
    );
    expect(demo).not.toBeNull();
    endTurn(demo!);
    expect(demo!.state.entity('foe')!.conditions.has(GLYPHED)).toBe(false);
  });

  it('will not tighten a song nobody is under', () => {
    // The follow-up is aimed at whoever is already held, which is a gate on the
    // target rather than on the card: until somebody is under it, it offers no
    // targets at all, which is a different thing from being refused.
    const demo = casting([HELD_CARD], 'not-yet');
    const card = abilitiesOf(demo, 'vela').find((a) => a.id === HELD_TIGHTEN)!;
    expect(abilityTargets(demo, 'vela', card)).toEqual([]);
    demo.state.entity('foe')!.conditions.add(HELD);
    expect(abilityTargets(demo, 'vela', card)).toEqual(['foe']);
  });
});

describe('a number read off a pool', () => {
  /** Quim toe to toe with something, the fight already on. */
  const facing = (adversary: string, seed: string, features: readonly Printed[] = []) => {
    const s = blank();
    s.run(addSheet(KARA));
    s.run(setSpawns('hall', [{ x: 2, y: 4 }]));
    s.run(addEncounter('hall', encounterSchema.parse({ id: 'duel', name: 'The duel' })));
    s.run(addAdversary('hall', 'duel', { id: 'foe', adversary, position: { x: 3, y: 4 } }));
    print(s.project, ...features);
    const demo = buildProjectScene(s.project, seed);
    demo.askDefender = false;
    startEncounter(demo, 'duel');
    demo.state.entity('kara')!.hitPoints = { max: 90, marked: 0 };
    demo.party.select('kara');
    return demo;
  };

  it('puts what it has lost behind the next swing, and nothing when it is whole', () => {
    // The mechanism: a damage bonus equal to what the creature has marked. Two
    // runs of the same fixture and the same seed, the only difference being what
    // has been taken out of it.
    const reap = (marked: number): string => {
      const demo = facing('fixture-foe', 'reaper', [A_BONUS_READ_OFF_ITS_OWN_WOUNDS('fixture-foe')]);
      demo.state.entity('foe')!.hitPoints = { max: 8, marked };
      demo.state.entity('foe')!.stress = { max: 4, marked: 0 };
      endTurn(demo);
      expect(demo.log.some((l) => l.text.includes('Swing'))).toBe(true);
      return demo.log.map((l) => l.text).join(' | ');
    };
    expect(reap(3)).toContain('The blow lands harder by 3.');
    // Whole, it says nothing at all - and keeps the Stress it would have paid.
    const whole = reap(0);
    expect(whole).not.toContain('lands harder');
    expect(whole).not.toContain('behind the next swing');
  });

  it('hands back exactly the wound it took', () => {
    // What comes back is a count the blow carries rather than a number read off
    // a pool, which is what separates this from the bonus above. The Shadow it
    // costs is one either way.
    const demo = facing('fixture-lurker', 'my-turn', [A_WOUND_HANDED_BACK('fixture-lurker')]);
    demo.state.entity('foe')!.hitPoints = { max: 90, marked: 0 };
    demo.state.bad = { ...demo.state.bad, value: demo.state.bad.max };
    const before = demo.state.entity('kara')!.hitPoints.marked;
    demo.world.noteDamage('foe', { attacker: 'kara', hitPoints: 2, damage: 20, types: ['physical'] });
    settleFight(demo);
    expect(demo.log.some((l) => l.text.includes('will not be the only one bleeding'))).toBe(true);
    expect(demo.state.entity('kara')!.hitPoints.marked - before).toBe(2);
  });
});

describe('the blow that has landed and not yet been counted', () => {
  /** One thing swinging at Quim, and optionally somebody watching. */
  const swinging = (
    adversary: string,
    seed: string,
    bystander?: { id: string; adversary: string; at: { x: number; y: number } },
    hall: { width: number; height: number } = { width: 12, height: 8 },
  ) => {
    const s = blank(hall.width, hall.height);
    s.run(addSheet(KARA));
    s.run(setSpawns('hall', [{ x: 2, y: 4 }]));
    s.run(addEncounter('hall', encounterSchema.parse({ id: 'duel', name: 'The duel' })));
    s.run(addAdversary('hall', 'duel', { id: 'foe', adversary, position: { x: 3, y: 4 } }));
    if (bystander !== undefined) {
      s.run(addAdversary('hall', 'duel', { id: bystander.id, adversary: bystander.adversary, position: bystander.at }));
    }
    // Deduped by id: this helper can put an archer in as both the creature under
    // test and the bystander watching, and the same specimen twice over would be
    // offered twice.
    const carried = new Map<string, Printed>();
    for (const definition of [adversary, bystander?.adversary]) {
      const feature =
        definition === 'fixture-brute'
          ? AN_OVERLOAD_THAT_BUYS_ANOTHER_TURN(definition)
          : definition === 'fixture-archer'
            ? A_WATCHER_THAT_ADDS_TO_A_HIT(definition)
            : undefined;
      if (feature !== undefined) carried.set(feature.ability.id, feature);
    }
    print(s.project, ...carried.values());
    const demo = buildProjectScene(s.project, seed);
    demo.askDefender = false;
    startEncounter(demo, 'duel');
    demo.state.entity('kara')!.hitPoints = { max: 90, marked: 0 };
    demo.state.entity('foe')!.hitPoints = { max: 90, marked: 0 };
    demo.party.select('kara');
    return demo;
  };

  it('adds the ten only when there is a Stress to pay for it', () => {
    // The mechanism: a Stress marked while the damage is being rolled buys ten
    // more of it. The same fixture and the same seed twice over, the only
    // difference being whether there is a Stress left to pay with.
    const swing = (stress: number): { marked: number; overloaded: boolean } => {
      const demo = swinging('fixture-brute', 'overload');
      demo.state.entity('foe')!.stress = { max: 4, marked: stress };
      const before = demo.state.entity('kara')!.hitPoints.marked;
      endTurn(demo);
      expect(demo.log.some((l) => l.text.includes('Heavy Arm hits'))).toBe(true);
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
    // Ten more damage is worth at least one more threshold on these numbers.
    expect(spent.marked).toBeGreaterThan(broke.marked);
  });

  it("lets a watcher fire into somebody else's hit, but never into its own", () => {
    // The mechanism: another creature's damage, rolled within Far range of this
    // one. The watcher stands off; the other block does the hitting.
    const demo = swinging('fixture-foe', 'concentrate', {
      id: 'turret',
      adversary: 'fixture-archer',
      at: { x: 6, y: 4 },
    });
    demo.state.entity('turret')!.hitPoints = { max: 90, marked: 0 };
    demo.state.bad = { ...demo.state.bad, value: demo.state.bad.max };
    for (let i = 0; i < 6 && !demo.log.some((l) => l.text.includes('swings around and fires')); i++) {
      demo.state.entity('kara')!.hitPoints = { max: 90, marked: 0 };
      demo.state.entity('kara')!.stress = { max: 6, marked: 0 };
      demo.state.entity('kara')!.alive = true;
      endTurn(demo);
    }
    expect(demo.log.some((l) => l.text.includes('swings around and fires'))).toBe(true);
    expect(demo.log.some((l) => l.text.includes('The blow lands harder by'))).toBe(true);

    // Parked out past Far, the same watcher says nothing: the gate is read from
    // the watcher's chair to whoever is being hit, not from the attacker's -
    // where everyone is always in range, a hit having just landed.
    // A hall wide enough that it is still out past Far after six turns of
    // walking towards the noise - as far as Very Far each, since a creature
    // with no shot from within Close spends its turn on the walk.
    const distant = swinging('fixture-foe', 'concentrate-far', {
      id: 'turret',
      adversary: 'fixture-archer',
      at: { x: 94, y: 22 },
    }, { width: 96, height: 24 });
    distant.state.entity('turret')!.hitPoints = { max: 90, marked: 0 };
    distant.state.bad = { ...distant.state.bad, value: distant.state.bad.max };
    for (let i = 0; i < 6; i++) {
      distant.state.entity('kara')!.hitPoints = { max: 90, marked: 0 };
      distant.state.entity('kara')!.stress = { max: 6, marked: 0 };
      distant.state.entity('kara')!.alive = true;
      endTurn(distant);
    }
    expect(distant.log.some((l) => l.text.includes('Swing'))).toBe(true);
    expect(distant.log.some((l) => l.text.includes('swings around and fires'))).toBe(false);

    // And on its own attack it says nothing: the feature answers another
    // creature's damage roll, which is a different trigger from its own.
    const alone = swinging('fixture-archer', 'turret-alone');
    for (let i = 0; i < 4; i++) {
      alone.state.entity('kara')!.hitPoints = { max: 90, marked: 0 };
      alone.state.entity('kara')!.alive = true;
      endTurn(alone);
    }
    expect(alone.log.some((l) => l.text.includes("Loosed Arrow"))).toBe(true);
    expect(alone.log.some((l) => l.text.includes('swings around and fires'))).toBe(false);
  });
});

describe('one of its own, standing beside the target', () => {
  /**
   * A swing that changes when the creature is not alone. The gate counts
   * creatures *around the target*, off the same block, and never the one
   * asking — a creature is within Melee of itself, so without `except` it
   * would always be its own pack.
   */
  const PACK_TACTICS = printed('fixture-swarm', {
    id: 'fixture-pack-tactics',
    name: 'Pack Tactics',
    text: 'With another of its kind on the same target, it bites to better effect.',
    kind: 'passive',
    action: false,
    target: { kind: 'none' },
    standardAttack: {
      damage: '1d6+5 phy',
      when: {
        kind: 'nearby',
        of: { kind: 'adversaries', range: 'melee', around: 'target', except: 'actor', sameKind: true },
        op: '>=',
        value: 1,
      },
    },
  });

  /** The rider on the same condition, which is a reaction rather than a swing. */
  const PACK_TACTICS_BAD = printed('fixture-swarm', {
    id: 'fixture-pack-tactics-bad',
    name: 'Pack Tactics',
    text: 'Biting alongside its own kind is worth something to the one running them.',
    kind: 'reaction',
    trigger: 'dealtHit',
    action: false,
    available: {
      kind: 'nearby',
      of: { kind: 'adversaries', range: 'melee', around: 'target', except: 'actor', sameKind: true },
      op: '>=',
      value: 1,
    },
    target: { kind: 'none' },
    effects: [
      { kind: 'log', text: 'The pack closes, and the GM takes something for it.', tone: 'bad' },
      { kind: 'gainBad', amount: 1 },
    ],
  });

  /**
   * Somebody to eat, and a wound worth eating for: a creature at full strength
   * has no reason to open one of its own.
   */
  const FEED_ON_ITS_OWN = printed('fixture-swarm', {
    id: 'fixture-feed-on-its-own',
    name: 'Feed on Its Own',
    text: 'Hurt, and beside one of its own, it takes what it needs from them.',
    available: {
      kind: 'all',
      of: [
        { kind: 'nearby', of: { kind: 'adversaries', range: 'melee', except: 'actor' }, op: '>=', value: 1 },
        { kind: 'pool', pool: 'hitPoints', of: { kind: 'actor' }, measure: 'marked', op: '>=', value: 1 },
      ],
    },
    target: { kind: 'none' },
    inCombatOnly: true,
    effects: [
      { kind: 'log', text: 'It takes what it needs from one of its own.', tone: 'bad' },
      { kind: 'damage', amount: 1, target: { kind: 'adversaries', range: 'melee', except: 'actor', nearest: 1 } },
      { kind: 'heal', amount: 1, target: { kind: 'actor' } },
    ],
  });

  /** Quim with two of a kind on her, or one of them standing off. */
  const pack = (seed: string, features: readonly Printed[], together = true) => {
    const s = blank();
    s.run(addSheet(KARA));
    s.run(setSpawns('hall', [{ x: 2, y: 4 }]));
    s.run(addEncounter('hall', encounterSchema.parse({ id: 'duel', name: 'The duel' })));
    s.run(addAdversary('hall', 'duel', { id: 'foe', adversary: 'fixture-swarm', position: { x: 3, y: 4 } }));
    // Standing off means the far corner of this hall, not off the map: a
    // placement outside the board is authored scenery and never enters play.
    s.run(
      addAdversary('hall', 'duel', {
        id: 'pack-mate',
        adversary: 'fixture-swarm',
        position: together ? { x: 2, y: 5 } : { x: 11, y: 7 },
      }),
    );
    for (const { card, ability } of features) s.run(addCardWithAbility(card, ability));
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
    const together = pack('wolves', [PACK_TACTICS]);
    expect(
      together.world.standardAttackOf('fixture-swarm', { attacker: 'foe', target: 'kara' }).damage,
    ).toMatchObject({ count: 1, sides: 6, modifier: 5 });

    const alone = pack('lone-wolf', [PACK_TACTICS], false);
    expect(alone.world.standardAttackOf('fixture-swarm', { attacker: 'foe', target: 'kara' }).damage).toBeUndefined();
  });

  it('does not count the one asking', () => {
    // A creature is within Melee of itself, so one with nobody beside it would
    // otherwise be its own pack.
    const alone = pack('self-count', [PACK_TACTICS], false);
    alone.state.entity('pack-mate')!.alive = false;
    expect(
      alone.world.resolveTargets(
        { kind: 'adversaries', range: 'melee', around: 'target', except: 'actor', sameKind: true },
        { targets: ['kara'], hit: ['kara'] },
      ),
    ).toEqual([]);
  });

  it('counts its own kind, not whoever else is standing there', () => {
    // `sameKind` means the same block, so a creature off a different one
    // standing beside the target is not part of this pack.
    const s = blank();
    s.run(addSheet(KARA));
    s.run(setSpawns('hall', [{ x: 2, y: 4 }]));
    s.run(addEncounter('hall', encounterSchema.parse({ id: 'duel', name: 'The duel' })));
    s.run(addAdversary('hall', 'duel', { id: 'foe', adversary: 'fixture-swarm', position: { x: 3, y: 4 } }));
    s.run(addAdversary('hall', 'duel', { id: 'stranger', adversary: 'fixture-lurker', position: { x: 2, y: 5 } }));
    s.run(addCardWithAbility(PACK_TACTICS.card, PACK_TACTICS.ability));
    const demo = buildProjectScene(s.project, 'mixed');
    demo.askDefender = false;
    startEncounter(demo, 'duel');
    demo.party.select('kara');
    expect(demo.world.standardAttackOf('fixture-swarm', { attacker: 'foe', target: 'kara' }).damage).toBeUndefined();
  });

  it('eats one of its own, but only with a wound to close', () => {
    // "When the Vampire is within Melee range of an ally, they can cause the
    // ally to mark a HP. The Vampire then clears a HP." Somebody beside it is
    // a count of creatures; a reason to bite is a pool on itself.
    const fed = (marked: number): ReturnType<typeof pack> => {
      const demo = pack(`vampire-${marked}`, [FEED_ON_ITS_OWN]);
      // One Shadow: enough to spotlight the second of them, and nothing here is
      // worth more than that, so the feature is what the turn reaches for.
      demo.state.bad = { ...demo.state.bad, value: 1 };
      demo.state.entity('foe')!.hitPoints = { max: 12, marked };
      demo.state.entity('pack-mate')!.hitPoints = { max: 12, marked: 0 };
      demo.world.drawIn('pack-mate', 'foe', 'melee', 'far');
      endTurn(demo);
      return demo;
    };

    const hungry = fed(3);
    expect(hungry.log.some((l) => l.text.includes('takes what it needs'))).toBe(true);
    // It closed one of its own wounds with one of theirs.
    expect(hungry.state.entity('foe')!.hitPoints.marked).toBe(2);
    expect(hungry.state.entity('pack-mate')!.hitPoints.marked).toBe(1);

    // Whole, it has nothing to close, and its followers keep their blood.
    const whole = fed(0);
    expect(whole.log.some((l) => l.text.includes('takes what it needs'))).toBe(false);
    expect(whole.state.entity('pack-mate')!.hitPoints.marked).toBe(0);
  });

  it('takes the Shadow on the hit, and only with the pack there', () => {
    // The rider is its own reaction rather than part of the swing. The Shadow is
    // hard to read off a finished turn — the GM spends it again to spotlight
    // the second of them — so what is asserted is the rider running at all.
    const closed = (demo: ReturnType<typeof pack>): boolean => {
      for (let i = 0; i < 8; i++) {
        const kara = demo.state.entity('kara')!;
        kara.hitPoints = { max: 60, marked: 0 };
        kara.stress = { max: 6, marked: 0 };
        kara.alive = true;
        endTurn(demo);
      }
      // One that never got its teeth in says nothing either way, so the lone
      // half only means something once it has swung.
      expect(demo.log.some((l) => l.text.includes('Press of Bodies'))).toBe(true);
      return demo.log.some((l) => l.text.includes('The pack closes'));
    };
    expect(closed(pack('wolf-fear', [PACK_TACTICS, PACK_TACTICS_BAD]))).toBe(true);
    expect(closed(pack('wolf-alone', [PACK_TACTICS, PACK_TACTICS_BAD], false))).toBe(false);
  });
});

describe('a token on the stat block', () => {
  /** A slow thing standing next to Quim, the fight already on. */
  const winding = (adversary: string, seed: string, second = false) => {
    const s = blank();
    s.run(addSheet(KARA));
    s.run(setSpawns('hall', [{ x: 2, y: 4 }]));
    s.run(addEncounter('hall', encounterSchema.parse({ id: 'duel', name: 'The duel' })));
    s.run(addAdversary('hall', 'duel', { id: 'foe', adversary, position: { x: 3, y: 4 } }));
    if (second) s.run(addAdversary('hall', 'duel', { id: 'other', adversary, position: { x: 2, y: 5 } }));
    // What the block standing there carries. Each specimen is sourced to one
    // definition, so a test that stands up two of the same block gets one
    // store per creature rather than one between them.
    const carried =
      adversary === 'fixture-archer'
        ? [A_WIND_UP_WITH_ITS_OWN_STORE(adversary)]
        : adversary === 'fixture-swarm'
          ? [
              A_STORE_THAT_HOLDS_WHOEVER_IT_HIT(adversary),
              A_STORE_TORN_OFF_BY_A_REAL_WOUND(adversary),
              A_SPEND_GATED_ON_WHAT_THEY_CARRY(adversary),
            ]
          : [A_WIND_UP_THAT_COSTS_A_TURN(adversary)];
    print(s.project, ...carried);
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
    // The mechanism: a spotlight with nothing gathered buys only the gathering.
    // Whether it swung is whether its attack name is in the log -- a miss says
    // so as loudly as a hit, which a Hit Point count would not.
    const demo = winding('fixture-foe', 'slow-zombie');
    const first = spotlight(demo);
    expect(first.tokens).toBe(1);
    expect(first.said).toContain('gathers itself');
    expect(first.said).not.toContain('Swing');

    const second = spotlight(demo);
    expect(second.tokens).toBe(0);
    expect(second.said).toContain('Swing');

    // And it is a cycle, not a one-off toll at the door.
    const third = spotlight(demo);
    expect(third.tokens).toBe(1);
    expect(third.said).not.toContain('Swing');
  });

  it('counts the token on the creature, not on the card', () => {
    // One specimen, two creatures: each winds up in its own store, and neither
    // hands the other a turn.
    const demo = winding('fixture-foe', 'two-zombies', true);
    demo.state.entity('other')!.hitPoints = { max: 60, marked: 0 };
    demo.world.addTokens('other', 'slow', 1);
    demo.state.bad = { ...demo.state.bad, value: demo.state.bad.max };
    endTurn(demo);
    expect(demo.world.tokensOn('foe', 'slow')).toBe(1);
    expect(demo.world.tokensOn('other', 'slow')).toBe(0);
  });

  it('hands the token to whoever it hit, and takes it back when it is torn apart', () => {
    // The mechanism: a store kept on whoever was hit. One holds them, three
    // also leaves them open -- and the store sits on the target, which is not
    // the creature that owns the feature.
    const demo = winding('fixture-swarm', 'brambles');
    const kara = demo.state.entity('kara')!;
    const brambles = (): number => demo.world.tokensOn('kara', 'fixture-swarm-encumber');
    for (let i = 0; i < 24 && brambles() < 3; i++) {
      kara.hitPoints = { max: 60, marked: 0 };
      kara.stress = { max: 6, marked: 0 };
      kara.conditions.delete('restrained');
      endTurn(demo);
    }
    expect(brambles()).toBe(3);
    expect(kara.conditions.has('restrained')).toBe(true);
    expect(kara.conditions.has('vulnerable')).toBe(true);

    // Two Hit Points is Major, which is the band that tears the store off.
    demo.world.noteDamage('foe', { attacker: 'kara', hitPoints: 2, damage: 8, types: ['physical'] });
    settleFight(demo);
    expect(demo.log.some((l) => l.text.includes('what it held falls away'))).toBe(true);
    expect(brambles()).toBe(0);
    expect(kara.conditions.has('restrained')).toBe(false);
    expect(kara.conditions.has('vulnerable')).toBe(false);
  });

  it('spends the Stress only on somebody carrying enough of them', () => {
    // The mechanism: a Stress spent only on somebody carrying three. The GM
    // aims at the nearest creature in reach, so without the gate on the target
    // it would pay for the wrong one.
    const short = winding('fixture-swarm', 'crush-short');
    short.world.addTokens('kara', 'fixture-swarm-encumber', 2);
    const before = short.state.entity('foe')!.stress.marked;
    endTurn(short);
    expect(short.log.some((l) => l.text.includes('It closes, and squeezes'))).toBe(false);
    expect(short.state.entity('foe')!.stress.marked).toBe(before);

    const ready = winding('fixture-swarm', 'crush-ready');
    ready.world.addTokens('kara', 'fixture-swarm-encumber', 3);
    endTurn(ready);
    expect(ready.log.some((l) => l.text.includes('It closes, and squeezes'))).toBe(true);
  });

  it('leaves the thorns on for a scratch', () => {
    // One Hit Point is Minor, which is under the band, so nothing comes off.
    const demo = winding('fixture-swarm', 'brambles-scratch');
    demo.world.addTokens('kara', 'fixture-swarm-encumber', 2);
    demo.world.noteDamage('foe', { attacker: 'kara', hitPoints: 1, damage: 4, types: ['physical'] });
    settleFight(demo);
    expect(demo.world.tokensOn('kara', 'fixture-swarm-encumber')).toBe(2);
  });

  it('takes the whole turn, not just the swing', () => {
    // Simplified, and worth pinning: the winding turn costs the whole turn.
    // Nothing here can forbid one attack and leave the rest of a turn standing,
    // so anything else it would have reached for waits too.
    const demo = winding('fixture-archer', 'turret');
    const first = spotlight(demo);
    expect(demo.world.tokensOn('foe', 'slow-firing')).toBe(1);
    expect(first.said).toContain('winding up');
    expect(first.said).not.toContain('Loosed Arrow');
  });
});

describe("what a block's own teeth do to this target", () => {
  /** Dice in place of the block's own, while a condition on the attacker holds. */
  const UNSEEN_STRIKE = printed('fixture-foe', {
    id: 'fixture-unseen-strike',
    name: 'Unseen Strike',
    text: 'Striking unseen, it strikes for more than it usually would.',
    kind: 'passive',
    action: false,
    target: { kind: 'none' },
    standardAttack: {
      damage: '1d10+4 phy',
      when: { kind: 'hasCondition', condition: 'hidden', of: { kind: 'actor' } },
    },
  });

  /** Twice whatever was rolled, read off a pool on the *target*. */
  const NOTHING_LEFT = printed('fixture-foe', {
    id: 'fixture-nothing-left',
    name: 'Nothing Left',
    text: 'Against someone with nothing left to good for, its blows land twice as hard.',
    kind: 'passive',
    action: false,
    target: { kind: 'none' },
    standardAttack: {
      double: true,
      when: { kind: 'pool', pool: 'good', of: { kind: 'target' }, measure: 'available', op: '<=', value: 0 },
    },
  });

  /** A mark one creature puts on, for another creature's benefit. */
  const NAMES_THEM = printed('fixture-foe', {
    id: 'fixture-names-them',
    name: 'Names Them',
    text: 'It names one of them, and the name sticks to them for the rest of the fight.',
    cost: { bad: 1 },
    target: { kind: 'creature', range: 'veryFar' },
    inCombatOnly: true,
    effects: [
      { kind: 'log', text: 'It names them, and the name sticks.', tone: 'bad' },
      { kind: 'applyCondition', condition: 'guilty', duration: 'scene', target: { kind: 'target' } },
    ],
  });

  /**
   * The other half, and on a different block: the mark is worth putting on
   * because something *else* reads it.
   */
  const PUNISH_THE_NAMED = printed('fixture-archer', {
    id: 'fixture-punish-the-named',
    name: 'Punish the Named',
    text: 'Against someone already named, its shots land twice as hard.',
    kind: 'passive',
    action: false,
    target: { kind: 'none' },
    standardAttack: {
      double: true,
      when: { kind: 'hasCondition', condition: 'guilty', of: { kind: 'target' } },
    },
  });

  /** Quim in reach of something, the fight already on. */
  const facing = (seed: string, features: readonly Printed[]) => {
    const s = blank();
    s.run(addSheet(KARA));
    s.run(setSpawns('hall', [{ x: 2, y: 4 }]));
    s.run(addEncounter('hall', encounterSchema.parse({ id: 'duel', name: 'The duel' })));
    s.run(addAdversary('hall', 'duel', { id: 'foe', adversary: 'fixture-foe', position: { x: 3, y: 4 } }));
    for (const { card, ability } of features) s.run(addCardWithAbility(card, ability));
    const demo = buildProjectScene(s.project, seed);
    demo.askDefender = false;
    startEncounter(demo, 'duel');
    demo.state.entity('kara')!.hitPoints = { max: 60, marked: 0 };
    demo.state.entity('foe')!.hitPoints = { max: 60, marked: 0 };
    demo.party.select('kara');
    return demo;
  };

  it('swaps the dice for the ones the passive names, and only while it holds', () => {
    const demo = facing('unseen', [UNSEEN_STRIKE]);
    const plain = demo.world.standardAttackOf('fixture-foe', { attacker: 'foe', target: 'kara' });
    expect(plain.damage).toBeUndefined();

    demo.state.entity('foe')!.conditions.add('hidden');
    const hidden = demo.world.standardAttackOf('fixture-foe', { attacker: 'foe', target: 'kara' });
    expect(hidden.damage).toMatchObject({ count: 1, sides: 10, modifier: 4 });
  });

  it('doubles what the dice said against a target with nothing left to good for', () => {
    const demo = facing('despair', [NOTHING_LEFT]);
    const kara = demo.state.entity('kara')!;
    kara.good = { max: 6, value: 3 };
    expect(demo.world.standardAttackOf('fixture-foe', { attacker: 'foe', target: 'kara' }).double).toBeUndefined();

    kara.good = { max: 6, value: 0 };
    expect(demo.world.standardAttackOf('fixture-foe', { attacker: 'foe', target: 'kara' }).double).toBe(true);

    // And what lands is twice what the dice said: the same fixture and the
    // same seed twice over, the only difference being the Light left in her.
    const swing = (good: number): number => {
      const twin = facing('despair-twin', [NOTHING_LEFT]);
      twin.state.entity('kara')!.good = { max: 6, value: good };
      twin.scenario.actorId = 'foe';
      const summary = twin.world.attack({ attacker: 'foe', target: 'kara', weapon: 'primary' }, twin.rng);
      expect(summary.refused).toBeNull();
      return summary.damage ?? 0;
    };
    const hopeful = swing(3);
    expect(hopeful).toBeGreaterThan(0);
    expect(swing(0)).toBe(hopeful * 2);
  });

  it('marks a target for one creature, and another block reads the mark', () => {
    const demo = facing('judgment', [NAMES_THEM, PUNISH_THE_NAMED]);
    demo.state.bad = { ...demo.state.bad, value: demo.state.bad.max };
    for (let i = 0; i < 4 && !demo.state.entity('kara')!.conditions.has('guilty'); i++) {
      demo.state.entity('kara')!.hitPoints = { max: 60, marked: 0 };
      demo.state.entity('kara')!.alive = true;
      endTurn(demo);
    }
    expect(demo.log.some((l) => l.text.includes('It names them'))).toBe(true);
    expect(demo.state.entity('kara')!.conditions.has('guilty')).toBe(true);
    // A different block, the same mark: what one named, the other punishes.
    expect(demo.world.standardAttackOf('fixture-archer', { attacker: 'foe', target: 'kara' }).double).toBe(true);
  });
});

describe('a Demon rallying Relentless allies', () => {
  /** Something that rallies, and two that can each be spotlighted twice. */
  const pit = (bad: number, seed: string) => {
    const s = blank();
    s.run(addSheet(KARA));
    s.run(setSpawns('hall', [{ x: 2, y: 4 }]));
    s.run(addEncounter('hall', encounterSchema.parse({ id: 'pit', name: 'The pit' })));
    s.run(addAdversary('hall', 'pit', { id: 'hubris', adversary: 'fixture-captain', position: { x: 7, y: 4 } }));
    // The imps stand in Far range of Quim and past a Close-range walk of her:
    // rallied, they close in and stop short, and the fight makes no Shadow of its own.
    s.run(addAdversary('hall', 'pit', { id: 'imp-1', adversary: 'fixture-relentless-runt', position: { x: 10, y: 3 } }));
    s.run(addAdversary('hall', 'pit', { id: 'imp-2', adversary: 'fixture-relentless-runt', position: { x: 10, y: 5 } }));
    print(s.project, A_RALLY_OF_TWO_AT_RANGE('fixture-captain'));
    const demo = buildProjectScene(s.project, seed);
    demo.askDefender = false;
    startEncounter(demo, 'pit');
    demo.state.bad = { ...demo.state.bad, value: bad };
    demo.state.entity('kara')!.hitPoints = { max: 40, marked: 0 };
    demo.party.select('kara');
    return demo;
  };

  it('lets the second one act, though the first could have been spotlighted again', () => {
    // Exactly the Shadow the feature costs. A Relentless ally keeps its place at
    // the head of the queue after its granted spotlight, and the GM cannot afford
    // the second one - which must not end the turn while somebody behind it is
    // standing on a spotlight the feature already paid for.
    const demo = pit(1, 'hubris');
    endTurn(demo);

    expect(demo.log.some((l) => l.text.includes('uses Push Them Forward'))).toBe(true);
    const acted = demo.encounter!.log.filter((e) => e.kind === 'adversaryActed') as { id: string }[];
    expect(acted.filter((e) => e.id === 'imp-1')).toHaveLength(1);
    expect(acted.filter((e) => e.id === 'imp-2')).toHaveLength(1);
  });
});

describe('what a feature calls in and spotlights', () => {
  it('acts on the turn it arrived, on the Shadow the feature already spent', () => {
    const s = blank();
    s.run(addSheet(KARA));
    s.run(setSpawns('hall', [{ x: 2, y: 4 }]));
    s.run(addEncounter('hall', encounterSchema.parse({ id: 'crypt', name: 'The crypt' })));
    s.run(addAdversary('hall', 'crypt', { id: 'lord', adversary: 'fixture-captain', position: { x: 7, y: 4 } }));
    print(s.project, A_CALL_THAT_ARRIVES_SWINGING('fixture-captain', 'fixture-runt'));
    const demo = buildProjectScene(s.project, 'the-hunt');
    demo.askDefender = false;
    startEncounter(demo, 'crypt');
    // Exactly what the feature costs, and not a Shadow more: what it calls in was
    // paid for when it was called, so the turn must not bill the GM again.
    demo.state.bad = { ...demo.state.bad, value: 2 };
    demo.state.entity('kara')!.hitPoints = { max: 40, marked: 0 };
    endTurn(demo);

    expect(demo.log.some((l) => l.text.includes('uses The Hunt'))).toBe(true);
    const arrivals = demo.state.entitiesOf('adversary').filter((e) => e.definition === 'fixture-runt');
    expect(arrivals.length).toBeGreaterThan(0);
    const acted = demo.encounter!.log.filter((e) => e.kind === 'adversaryActed') as { id: string; badSpent: number }[];
    for (const arrival of arrivals) {
      expect(acted.filter((e) => e.id === arrival.id)).toHaveLength(1);
      expect(acted.find((e) => e.id === arrival.id)!.badSpent).toBe(0);
    }
  });
});

describe('a Necromancer who buys their troops a turn', () => {
  /**
   * The rider: what the rally hands out strikes for half.
   *
   * Two runs of the same seed, one carrying the rally with its rider and one
   * carrying a rally without it, so the halving is the only difference between
   * them. Carrying one or the other rather than overriding by id, because nothing
   * shipped is sourced to a fixture block and two abilities with one id would both
   * fire.
   */
  const gates = (half: boolean) => {
    const s = blank();
    s.run(addSheet(KARA));
    s.run(setSpawns('hall', [{ x: 2, y: 4 }]));
    s.run(addEncounter('hall', encounterSchema.parse({ id: 'lists', name: 'The gates' })));
    s.run(addAdversary('hall', 'lists', { id: 'necromancer', adversary: 'fixture-captain', position: { x: 7, y: 4 } }));
    // Troops that hit hard enough for the halving to show. A minion's jab is at
    // most 4 against thresholds of roughly 8 and 16, so it marks nothing either
    // way and the rider would be invisible rather than absent.
    s.run(addAdversary('hall', 'lists', { id: 'troop-1', adversary: 'fixture-brute', position: { x: 6, y: 3 } }));
    s.run(addAdversary('hall', 'lists', { id: 'troop-2', adversary: 'fixture-brute', position: { x: 6, y: 5 } }));
    if (half) {
      print(s.project, A_RALLY_THAT_STRIKES_FOR_HALF('fixture-captain'));
    } else {
      // The same rally without the rider, under its own id.
      print(
        s.project,
        printed('fixture-captain', {
          id: 'fixture-captain-rally-at-full',
          name: 'Rally',
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
    expect(halved.log.some((l) => l.text.includes('uses Borrowed Time'))).toBe(true);
    expect(halved.log.filter((l) => l.text.includes("somebody else's word")).length).toBeGreaterThan(0);

    const full = gates(false);
    expect(full.log.some((l) => l.text.includes("somebody else's word"))).toBe(false);
    // Same seed, same swings; the rider is the whole difference.
    expect(halved.state.entity('kara')!.hitPoints.marked).toBeLessThan(
      full.state.entity('kara')!.hitPoints.marked,
    );
  });

  it('carries the half through the turn it bought and no further', () => {
    // It rallies two that are Relentless (2): each takes the spotlight it was
    // handed and then a second the GM pays a Shadow for. The whole turn, on one
    // seed, because the claim is about which of the four swings is at half
    // strength and which is not.
    const s = blank();
    s.run(addSheet(KARA));
    s.run(setSpawns('hall', [{ x: 2, y: 4 }]));
    s.run(addEncounter('hall', encounterSchema.parse({ id: 'gates', name: 'The gates' })));
    s.run(addAdversary('hall', 'gates', { id: 'necromancer', adversary: 'fixture-captain', position: { x: 7, y: 4 } }));
    s.run(addAdversary('hall', 'gates', { id: 'imp-1', adversary: 'fixture-relentless-runt', position: { x: 6, y: 3 } }));
    s.run(addAdversary('hall', 'gates', { id: 'imp-2', adversary: 'fixture-relentless-runt', position: { x: 6, y: 5 } }));
    print(s.project, A_RALLY_THAT_STRIKES_FOR_HALF('fixture-captain'));
    const demo = buildProjectScene(s.project, 'dance');
    demo.askDefender = false;
    startEncounter(demo, 'gates');
    demo.state.bad = { ...demo.state.bad, value: 3 };
    demo.state.entity('kara')!.hitPoints = { max: 60, marked: 0 };
    endTurn(demo);

    expect(demo.log.map((l) => l.text)).toEqual([
      'The Captain uses Borrowed Time.',
      'Runt, Runt are called into the fight, striking for half.',
      "The Runt's Jab misses Quim.",
      "The Runt's Jab hits Quim, and is turned aside.",
      "The Runt's Jab misses Quim.",
      "The Runt's Jab misses Quim.",
    ]);
    // Four swings for two of them: the two the rally bought, and one more each
    // that the GM paid a Shadow for. Nothing in the log says any of them struck for
    // half, and nothing should -- that line prints on a blow that marks a Hit
    // Point, and the only one that landed was turned aside before anything was
    // counted.
    const acted = demo.encounter!.log.filter((e) => e.kind === 'adversaryActed') as { id: string; badSpent: number }[];
    expect(acted.filter((e) => e.id === 'imp-1')).toHaveLength(2);
    expect(acted.filter((e) => e.id === 'imp-2')).toHaveLength(2);
    expect(acted.filter((e) => e.badSpent > 0)).toHaveLength(2);
  });
});

describe('a clock the fight carries', () => {
  /**
   * A clock armed the first time the fight turns to the creature counting it:
   * `spotlighted` is the trigger, `uses` keeps it to once a scene, and `loop`
   * brings it straight back at a length nobody at the table knows.
   */
  const CLOSING_IN = printed('fixture-foe', {
    id: 'fixture-closing-in',
    name: 'Closing In',
    text: 'The first time the fight turns to it, something starts closing on everyone.',
    kind: 'reaction',
    trigger: 'spotlighted',
    uses: { count: 1, per: 'scene' },
    target: { kind: 'none', range: 'far' },
    inCombatOnly: true,
    effects: [
      {
        kind: 'countdown',
        countdown: 'fixture-closing-in',
        name: 'Closing In',
        start: '2d6',
        loop: 'reset',
        effects: [
          { kind: 'log', text: 'It closes in on all of them.', tone: 'bad' },
          { kind: 'applyCondition', condition: 'vulnerable', duration: 'scene', target: { kind: 'allies', range: 'far' } },
          { kind: 'markStress', target: { kind: 'allies', range: 'far' } },
        ],
      },
    ],
  });

  /**
   * The other kind: bought with a Shadow, counted down by the party's own dice,
   * and — the part that matters — `onDeath` means it goes off even if the
   * creature counting it is already down.
   */
  const LAST_THRASH = printed('fixture-foe', {
    id: 'fixture-last-thrash',
    name: 'Last Thrash',
    text: 'A reckoning it sets going, which arrives whether or not it lives to see it.',
    cost: { bad: 1 },
    uses: { count: 1, per: 'scene' },
    target: { kind: 'none', range: 'far' },
    inCombatOnly: true,
    effects: [
      {
        kind: 'countdown',
        countdown: 'fixture-last-thrash',
        name: 'Last Thrash',
        start: '1d12',
        advance: 'withBad',
        onDeath: 'trigger',
        effects: [
          { kind: 'log', text: 'The room comes down around them.', tone: 'bad' },
          {
            kind: 'reactionRoll',
            difficulty: 18,
            trait: 'strength',
            targets: { kind: 'allies', range: 'far' },
            damage: { dice: '2d10+10', type: 'physical' },
            onFail: [
              { kind: 'damage', dice: 'same' },
              { kind: 'applyCondition', condition: 'restrained', duration: 'scene', target: { kind: 'hit' } },
            ],
            onSuccess: [{ kind: 'damage', dice: 'same', half: true }],
          },
        ],
      },
    ],
  });

  /** One creature across the hall from Quim, and the fight already on. */
  const ruin = (seed: string, features: readonly Printed[], at: { x: number; y: number } = { x: 3, y: 4 }) => {
    const s = blank();
    s.run(addSheet(KARA));
    s.run(setSpawns('hall', [{ x: 2, y: 4 }]));
    s.run(addEncounter('hall', encounterSchema.parse({ id: 'ruin', name: 'The ruin' })));
    s.run(addAdversary('hall', 'ruin', { id: 'foe', adversary: 'fixture-foe', position: at }));
    for (const { card, ability } of features) s.run(addCardWithAbility(card, ability));
    const demo = buildProjectScene(s.project, seed);
    demo.askDefender = false;
    startEncounter(demo, 'ruin');
    demo.state.bad = { ...demo.state.bad, value: demo.state.bad.max };
    demo.party.select('kara');
    // This test is about the clock rather than about Quim: give her the Hit
    // Points to stand there while it runs down.
    demo.state.entity('kara')!.hitPoints = { max: 40, marked: 0 };
    return demo;
  };

  /**
   * Quim swings, taking the spotlight back first if a roll with Shadow lost it -
   * and closing the ground again first, because a creature that answers a
   * wound by backing off is one somebody has to walk back to.
   */
  const swing = (demo: ReturnType<typeof ruin>): void => {
    if (!demo.encounter!.canAct('kara')) endTurn(demo);
    demo.world.drawIn('kara', 'foe', 'melee', 'far');
    attackWithSelected(demo, 'foe');
  };

  it('is armed the first time the fight turns to it, and goes off on a later roll', () => {
    const demo = ruin('shackles', [CLOSING_IN]);
    endTurn(demo);

    // The creature was spotlighted, which is what arms it.
    expect(demo.log.some((l) => l.text.includes('Closing In begins'))).toBe(true);
    const clock = demo.scenario.countdowns.get('fixture-closing-in');
    expect(clock).toMatchObject({ owner: 'foe', advance: 'standard', loop: 'reset' });
    expect(clock!.value).toBeGreaterThanOrEqual(2);

    // A clock nobody spends a turn on: Quim swings, and it moves.
    const started = demo.scenario.countdowns.get('fixture-closing-in')!.value;
    swing(demo);
    expect(demo.scenario.countdowns.get('fixture-closing-in')!.value).toBe(started - 1);

    // Down to its last tick, and the next roll sets it off: everyone within
    // Far range is caught by it.
    demo.scenario.countdowns.get('fixture-closing-in')!.value = 1;
    const stress = demo.state.entity('kara')!.stress.marked;
    swing(demo);
    expect(demo.log.some((l) => l.text.includes('Closing In triggers'))).toBe(true);
    expect(demo.state.entity('kara')!.conditions.has('vulnerable')).toBe(true);
    expect(demo.state.entity('kara')!.stress.marked).toBeGreaterThan(stress);

    // A looping clock comes straight back, at a length nobody at the table knows.
    const again = demo.scenario.countdowns.get('fixture-closing-in');
    expect(again).toBeDefined();
    expect(again!.value).toBe(again!.start);
  });

  it('goes off as the creature falls, because that is what its feature says', () => {
    // Across the hall, so it spends its first turn walking rather than eating
    // a level 1 character: the countdown is the point. Seven tiles, not nine —
    // what the clock does reaches Far range, and Far is eight of them.
    const demo = ruin('tyrant', [LAST_THRASH], { x: 9, y: 4 });
    endTurn(demo);
    const id = 'fixture-last-thrash';
    expect(demo.scenario.countdowns.get(id)).toMatchObject({ advance: 'withBad', onDeath: 'trigger' });

    // The pools are re-read from the sheet as the turn runs, so the room to
    // stand in has to be given after it rather than before: a level 1
    // character's own seven Hit Points do not survive what this clock does.
    demo.state.entity('kara')!.hitPoints = { max: 40, marked: 0 };

    // `onDeath: 'trigger'` is the one clock that outlives the creature
    // counting it: put it down and the reckoning arrives anyway.
    const before = demo.state.entity('kara')!.hitPoints.marked;
    demo.state.entity('foe')!.alive = false;
    settleFight(demo);
    expect(demo.log.some((l) => l.text.includes('Last Thrash triggers'))).toBe(true);
    expect(demo.state.entity('kara')!.hitPoints.marked).toBeGreaterThan(before);
    // Spent: a second death does not bring the room down twice.
    expect(demo.scenario.countdowns.has(id)).toBe(false);
    settleFight(demo);
    expect(demo.log.filter((l) => l.text.includes('Last Thrash triggers')).length).toBe(1);
  });

  it('does not go off in a room the creature is not in', () => {
    const demo = ruin('tyrant-elsewhere', [LAST_THRASH], { x: 11, y: 4 });
    endTurn(demo);
    const id = 'fixture-last-thrash';
    expect(demo.scenario.countdowns.has(id)).toBe(true);

    // The clock is on the scenario, which outlives the room: walking out of
    // the room a creature is in is not that creature being defeated.
    demo.state.removeEntity('foe');
    settleFight(demo);
    expect(demo.log.some((l) => l.text.includes('Last Thrash triggers'))).toBe(false);
    expect(demo.scenario.countdowns.has(id)).toBe(false);
  });

  it('stops when the fight does, so nothing ticks in the quiet afterwards', () => {
    const demo = ruin('shackles-3', [CLOSING_IN]);
    endTurn(demo);
    expect(demo.scenario.countdowns.size).toBe(1);

    // A script calls the fight off with the creature still standing - a truce,
    // an objective met. The fight is over, so a clock a creature was counting
    // has nothing left to count, and a chest opened afterwards must not tick
    // it: countdowns advance on action rolls, in a fight or out of one.
    demo.encounter!.end('victory');
    settleFight(demo);
    expect(demo.state.entity('foe')!.alive).toBe(true);
    expect(demo.scenario.countdowns.size).toBe(0);
  });

  it('is armed once, however many turns it gets', () => {
    const demo = ruin('shackles-2', [CLOSING_IN]);
    endTurn(demo);
    const first = demo.scenario.countdowns.get('fixture-closing-in')!.value;
    demo.scenario.countdowns.get('fixture-closing-in')!.value = 2;
    endTurn(demo);
    // A `uses` of one per scene: a second spotlight does not start it over.
    expect(demo.scenario.countdowns.get('fixture-closing-in')!.value).not.toBe(first);
    expect(demo.log.filter((l) => l.text.includes('Closing In begins')).length).toBe(1);
  });
});

describe('a swarm that piles onto one target', () => {
  /**
   * One attack the rest of its own kind joins. `joinedBy` is what makes it a
   * swarm rather than a swing: the pack gathers around the target, `sameKind`
   * keeps it to creatures off the same block, and the whole pile is one roll
   * the GM pays for once.
   */
  const PACK_RUSH = printed('fixture-swarm', {
    id: 'fixture-pack-rush',
    name: 'Pack Rush',
    text: 'At a price, everything of its kind nearby piles onto one target at once.',
    cost: { bad: 1 },
    target: { kind: 'creature', range: 'close' },
    inCombatOnly: true,
    effects: [
      {
        kind: 'attack',
        target: { kind: 'target' },
        joinedBy: { kind: 'adversaries', range: 'close', around: 'target', sameKind: true },
      },
    ],
  });

  /** A pack loose in the hall, and Quim alone in the middle of it. */
  const hall = (pack: readonly { x: number; y: number }[], bad: number) => {
    const s = blank();
    s.run(addSheet(KARA));
    s.run(setSpawns('hall', [{ x: 4, y: 4 }]));
    s.run(addEncounter('hall', encounterSchema.parse({ id: 'vermin', name: 'Vermin' })));
    pack.forEach((at, i) => {
      s.run(addAdversary('hall', 'vermin', { id: `rat-${i + 1}`, adversary: 'fixture-swarm', position: at }));
    });
    s.run(addCardWithAbility(PACK_RUSH.card, PACK_RUSH.ability));
    const demo = buildProjectScene(s.project, 'rats');
    demo.askDefender = false;
    startEncounter(demo, 'vermin');
    demo.state.bad = { ...demo.state.bad, value: bad };
    return demo;
  };

  it('calls the rest of the pack in for one shared bite, and each of them swings once', () => {
    // Four of them, none next to Quim: Close range of her, which is what the
    // feature gathers.
    const demo = hall([{ x: 7, y: 4 }, { x: 7, y: 3 }, { x: 7, y: 5 }, { x: 8, y: 4 }], 6);
    endTurn(demo);

    const said = demo.log.map((l) => l.text);
    expect(said.filter((t) => t.includes('uses Pack Rush')).length).toBe(1);
    // One roll, and the bite counted for every one of them that got there.
    expect(said.some((t) => /of them at once/.test(t))).toBe(true);
    // One that piled in has had its turn: four of them, and no more than four
    // acts in the whole GM turn — without the spotlight bookkeeping the three
    // that joined would each come round again and bite a second time.
    const bites = said.filter((t) => t.includes('Press of Bodies') || t.includes('Pack Rush')).length;
    expect(bites).toBeLessThanOrEqual(4);
  });

  it('spends the one Shadow the feature costs, not one for every creature that piles in', () => {
    // Three of them, all close enough to join: the whole pack acts on the one
    // feature, so nothing else in the turn is left to spend Shadow on.
    const demo = hall([{ x: 7, y: 4 }, { x: 7, y: 3 }, { x: 7, y: 5 }], 6);
    const before = demo.state.bad.value;
    endTurn(demo);
    expect(demo.log.some((l) => l.text.includes('3 of them at once'))).toBe(true);
    // The Shadow buys the whole pack's one shared bite: the ones that joined
    // have had their spotlight, and the GM pays for it once.
    expect(before - demo.state.bad.value).toBe(1);
  });

  it('does not spend a Shadow on a swarm of one', () => {
    const demo = hall([{ x: 7, y: 4 }], 6);
    const before = demo.state.bad.value;
    endTurn(demo);
    const said = demo.log.map((l) => l.text);
    expect(said.some((t) => t.includes('uses Pack Rush'))).toBe(false);
    expect(demo.state.bad.value).toBe(before);
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
    feature: (definition: string) => Printed,
    plated: boolean,
    seed: string,
  ): { marked: number; log: string[] } => {
    const s = blank();
    s.run(addSheet(KARA));
    s.run(setSpawns('hall', [{ x: 1, y: 4 }]));
    s.run(addEncounter('hall', encounterSchema.parse({ id: 'guard', name: 'The guard' })));
    s.run(addAdversary('hall', 'guard', { id: 'foe-1', adversary, position: { x: 3, y: 4 } }));
    if (plated) {
      // As in the resistance test: the control run simply does not carry it.
      print(s.project, feature(adversary));
    }
    const demo = buildProjectScene(s.project, seed);
    startEncounter(demo, 'guard');
    demo.state.moveEntity('kara', demo.grid.indexOf(2, 4));
    demo.party.select('kara');
    attackWithSelected(demo, 'foe-1');
    return { marked: demo.state.entity('foe-1')!.hitPoints.marked, log: demo.log.map((l) => l.text) };
  };

  it('takes a flat 3 off the swing that lands, and rolls the dice kind', () => {
    // One seed, so both runs roll the same longsword: physical damage, which
    // is what plate answers. 13/26 thresholds, and a swing in the low teens is
    // Major until the plate takes three off it.
    const worn = 'fixture-champion';
    expect(swing(worn, PLATE_THAT_TURNS_A_FLAT_AMOUNT, false, 'k12').marked).toBe(2);
    const plated = swing(worn, PLATE_THAT_TURNS_A_FLAT_AMOUNT, true, 'k12');
    expect(plated.marked).toBe(1);
    expect(plated.log).toContain('Champion turns aside 3 of it.');

    // The Champion's 1d10 is rolled after the swing, so the swing itself is
    // the same in both runs and only the armor differs.
    // A seed whose roll actually crosses a threshold. Most do not: the d10 can
    // take 7 off this swing and still leave the same band, so a run that turns
    // aside more is not the run that proves the reduction reached the
    // thresholds. This one turns aside 2 and drops the Hit Point.
    expect(swing(worn, PLATE_THAT_ROLLS_WHAT_IT_TURNS, false, 'c10').marked).toBe(1);
    const rolled = swing(worn, PLATE_THAT_ROLLS_WHAT_IT_TURNS, true, 'c10');
    expect(rolled.marked).toBe(0);
    expect(rolled.log).toContain('Champion turns aside 2 of it.');
  });
});

describe('a Treant that puts its roots down', () => {
  it('roots once and then fights, rather than rooting and tearing free forever', () => {
    const s = blank();
    s.run(addSheet(KARA));
    s.run(setSpawns('hall', [{ x: 3, y: 4 }]));
    s.run(addEncounter('hall', encounterSchema.parse({ id: 'grove', name: 'The grove' })));
    s.run(addAdversary('hall', 'grove', { id: 'treant-1', adversary: 'fixture-brute', position: { x: 4, y: 4 } }));
    print(s.project, ROOTS_PUT_DOWN_ONCE('fixture-brute'));

    const demo = buildProjectScene(s.project, 'grove');
    demo.askDefender = false;
    startEncounter(demo, 'grove');
    demo.state.bad = { ...demo.state.bad, value: demo.state.bad.max };
    for (let i = 0; i < 4 && demo.encounter?.outcome === 'ongoing'; i++) endTurn(demo);

    const said = demo.log.map((l) => l.text);
    // Once, because something already rooted has nothing to gain by rooting
    // again -- and then it uses its turns on the party.
    expect(said.filter((t) => t.includes('uses Put Down Roots')).length).toBe(1);
    expect(said.some((t) => t.includes('Quim'))).toBe(true);
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
    expect(foe.definition).toBe('fixture-foe');
    const swing = attackWithSelected(demo, foe.id);
    expect(swing).not.toBeNull();
    expect(swing!.refused).toBeNull();
    expect(demo.log.map((line) => line.text).join(' ')).toMatch(/Longsword/);
  });

  it('refuses to stand up a room that places a creature nobody can look up', () => {
    const s = author();
    s.project.scenes[0]!.encounters[0]!.adversaries[0]!.adversary = 'goblin-warror';
    expect(() => buildProjectScene(s.project)).toThrow(/goblin-warror/);
    // And the validator says the same thing before it is ever played.
    expect(
      validateProject(s.project, { knownAdversaries: new Set(['fixture-foe']) })
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
    session.run(updateSheet('kara', { name: 'Quim the Unmoved' }));
    session.run(updateInteractable('hall', 'iron-door', { name: 'A rusted door' }));

    const demo = buildProjectScene(session.project, 'authored');
    expect(demo.sheets.get('kara')!.name).toBe('Quim the Unmoved');
    expect(interactablesOf(demo.scene).find((i) => i.id === 'iron-door')!.name).toBe('A rusted door');
  });
});
