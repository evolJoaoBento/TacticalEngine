import { describe, it, expect } from 'vitest';
import { demoMap } from '../../legacy/js/data.js';
import { deriveCharacter } from '../engine/character/sheet';
import { abilitySchema, loadoutOf, type AbilityDef } from '../engine/content/abilities';
import { conditionDefSchema } from '../engine/content/conditions';
import { adversaryDefSchema } from '../engine/content/pack/schema';
import { runScript } from '../engine/script/runner';
import { formatDice } from '../engine/rules/dice';
import type { Rng } from '../engine/core/rng';
import { abilityTargets, pointTiles, rest, shapeAt, useAbility } from './demo-abilities';
import { NO_TILE } from '../engine/grid/grid';
import { reaches } from '../engine/rules/range';
import { adversaryTraits } from '../engine/combat/adversary-features';
import type { DefenseChoice, HeldSwing, PendingDeath, PendingDefense } from './demo-scene';
import { createAdversaryEntity } from '../engine/scene/state';
import type { EntityState } from '../engine/scene/state';
import {
  adversaryDefOf,
  answerPending,
  attackWithSelected,
  buildDemoScene,
  characterContentFor,
  defenseChoices,
  endTurn,
  refreshWorld,
  settleFight,
  startEncounter,
  syncPools,
  type DemoScene,
} from './demo-scene';
import { restoreScenario, scenarioSnapshot, useKey } from '../engine/script/world';
import { FIXTURE_ADVERSARIES, FIXTURE_CARDS, FIXTURE_DOMAIN_FOUR, FIXTURE_FOE } from '../../tests/fixtures/adversaries';
import { A_SPRAY_THAT_EATS_ARMOUR, A_WOUND_THAT_ANSWERS } from '../../tests/fixtures/adversary-features';
import {
  REASSURANCE,
  REASSURANCE_CARD,
  SILENT_CARD,
  SUPPORT_CARD,
  SUPPORT_TANK,
  LIFT_CARD,
  OWN_REROLL_CARD,
  OWN_TAGGED_REROLL,
  SPELLCAST_CHECK,
  SPELL_CARD,
  TAGGED_CARD,
  TAGGED_CHECK,
  WATCHING_CARD,
  WATCHING_CHECK,
} from '../../tests/fixtures/cards';

/**
 * Passives and reactions in play: what a held card changes on the sheet,
 * what a condition changes while it lasts, and what fires when a hit lands.
 */

const scene = (seed = 'defense'): DemoScene => buildDemoScene(demoMap(), seed);

/** What the Codex block's checks resolve into, shared by their success faces. */
const ENERVATED_ARMS: Record<string, unknown>[] = [
  { kind: 'log', text: 'Something goes out of them that is not coming back.', tone: 'hope' },
  { kind: 'applyCondition', condition: 'vulnerable', duration: 'permanent', target: { kind: 'hit' } },
];

const STOPPED_ARMS: Record<string, unknown>[] = [
  { kind: 'log', text: 'Every mote of dust in the room stops where it is.', tone: 'hope' },
  { kind: 'applyCondition', condition: 'time-stopped', duration: 'scene', target: { kind: 'adversaries', range: 'far' } },
  { kind: 'applyCondition', condition: 'time-jamming', duration: 'scene', target: { kind: 'actor' } },
];

const RESUMES_ARMS: Record<string, unknown>[] = [
  { kind: 'log', text: 'They move, and the room remembers how to.', tone: 'combat' },
  { kind: 'clearCondition', condition: 'time-stopped', target: { kind: 'adversaries', range: 'veryFar' } },
  { kind: 'clearCondition', condition: 'time-jamming', target: { kind: 'actor' } },
];

const FLAME_ARMS: Record<string, unknown>[] = [
  { kind: 'log', text: 'A sheet of fire stands up out of the floor.', tone: 'hope' },
  {
    kind: 'zone',
    zone: 'fixture-flame',
    name: 'Sheet of Flame',
    condition: 'fixture-flame',
    at: 'point',
    band: 'veryClose',
    side: 'adversaries',
    onDeath: 'end',
  },
];

const DOORWAY_ARMS: Record<string, unknown>[] = [
  {
    kind: 'branch',
    when: { kind: 'pool', pool: 'hope', measure: 'available', op: '>=', value: 1 },
    then: [
      { kind: 'spendHope', amount: 1 },
      { kind: 'log', text: 'A door that was not there, and then neither are they.', tone: 'hope' },
      { kind: 'move', to: 'point', teleport: true, budget: 'far' },
    ],
    otherwise: [{ kind: 'log', text: 'The way opens onto nothing: there is no Hope to hold it.', tone: 'fear' }],
  },
];

/**
 * What a watch pays out: a Hope for having seen it, and then the offer of a
 * Stress to take something off the GM. Three faces of one check share it.
 */
const WATCHED: Record<string, unknown>[] = [
  { kind: 'log', text: 'They watch a while longer, and something about it gives.', tone: 'hope' },
  {
    kind: 'branch',
    when: { kind: 'pool', pool: 'hope', measure: 'available', op: '>=', value: 1 },
    then: [{ kind: 'spendHope', amount: 1 }],
    otherwise: [{ kind: 'log', text: 'What they saw will not stay.', tone: 'fear' }],
  },
  {
    kind: 'choice',
    title: 'Know What It Is',
    body: 'Something in what you have seen takes the wind out of the room.',
    options: [
      {
        label: 'Mark a Stress to take one off the GM',
        effects: [
          { kind: 'markStress', amount: 1, target: { kind: 'actor' } },
          { kind: 'loseFear', amount: 1 },
        ],
      },
      { label: 'Keep it to yourself', effects: [{ kind: 'none' }] },
    ],
  },
];

describe('passives on the sheet', () => {
  it('Unwavering adds one to Kara\'s thresholds, and Bare Bones rewrites them when the mail comes off', () => {
    const demo = scene();
    const kara = demo.characters.get('kara')!;
    // Chainmail 7/15 at level 1 is 8/16; Unwavering makes it 9/17.
    expect(kara.thresholds).toEqual({ major: 9, severe: 17 });
    expect(kara.modifiers.map((m) => m.stat)).toContain('thresholds');
    // Bare Bones only counts unarmored, so it is filtered out while the mail is on.
    expect(kara.modifiers.some((m) => m.stat === 'bareBones')).toBe(false);

    const { armorId: _off, ...unarmored } = demo.sheets.get('kara')!;
    const bare = deriveCharacter(unarmored, characterContentFor(demo.project), demo.project.abilities).character;
    // Tier 1: 9/19, plus level, plus Unwavering; Armor Score 3 + Strength 2.
    expect(bare.thresholds).toEqual({ major: 11, severe: 21 });
    expect(bare.armorScore).toBe(5);
    // Without the card it would be level / twice level, and no armor at all.
    const plain = deriveCharacter({ ...unarmored, domainCards: ['get-back-up'] }, characterContentFor(demo.project), demo.project.abilities).character;
    expect(plain.thresholds).toEqual({ major: 2, severe: 3 });
    expect(plain.armorScore).toBe(0);
  });

  it('reads a roll bonus with a trait and a weapon requirement at roll time', () => {
    const demo = scene();
    const sheet = demo.sheets.get('kara')!;
    const grown = { ...sheet, domainCards: ['bare-bones', 'body-basher'] };
    demo.sheets.set('kara', grown);
    demo.characters.set('kara', deriveCharacter(grown, characterContentFor(demo.project), demo.project.abilities).character);
    refreshWorld(demo);
    // Body Basher: Strength (+2) to damage with a Melee weapon, and nothing at range.
    expect(demo.world.rollBonus('kara', 'damageRoll', { melee: true })).toBe(2);
    expect(demo.world.rollBonus('kara', 'damageRoll', { melee: false })).toBe(0);
    expect(demo.world.rollBonus('kara', 'attackRoll', { melee: true })).toBe(0);
  });
});

/**
 * Three of the new cards read something about their holder — how many Hit
 * Points are unmarked, how much Stress is marked, how many cards of a domain
 * are in the loadout — from inside a reaction or a modifier, where the actor
 * is whoever is swinging rather than whoever holds the card. Each of the three
 * paths that answers that question gets a test here.
 */
describe('a card that reads its own holder', () => {
  const holding = (demo: DemoScene, cards: string[]): void => {
    const sheet = { ...demo.sheets.get('kara')!, domainCards: cards, loadout: cards.slice(0, 5) };
    demo.sheets.set('kara', sheet);
    demo.characters.set('kara', deriveCharacter(sheet, characterContentFor(demo.project), demo.project.abilities).character);
    refreshWorld(demo);
  };

  /**
   * A reaction offered only while its holder is nearly out. `available` reads
   * a pool, and the pool it reads is the *holder's* — which is the whole point
   * when somebody else is the one swinging.
   */
  const ON_THE_BRINK = {
    id: 'fixture-on-the-brink',
    name: 'On the Brink',
    source: { kind: 'granted', characters: ['kara'] },
    text: 'Nearly out, and the smallest blows stop telling.',
    kind: 'reaction',
    trigger: 'incomingDamage',
    action: false,
    available: { kind: 'pool', pool: 'hitPoints', measure: 'available', op: '<=', value: 2 },
    reaction: { kind: 'reduceSeverity', steps: 1, only: 'minor' },
  };

  /** A reaction whose effects are read from the holder's chair, not the attacker's. */
  const SWIFT_STEP = {
    id: 'fixture-swift-step',
    name: 'Swift Step',
    source: { kind: 'granted', characters: ['kara'] },
    text: 'A blow that misses leaves them better off than it found them.',
    kind: 'reaction',
    trigger: 'attackMissed',
    action: false,
    effects: [
      {
        kind: 'branch',
        when: { kind: 'pool', pool: 'stress', measure: 'marked', op: '>=', value: 1 },
        then: [{ kind: 'clearStress', amount: 1, target: { kind: 'actor' } }],
        otherwise: [{ kind: 'gainHope', amount: 1, target: { kind: 'actor' } }],
      },
    ],
  };

  /**
   * The one kind of card a `granted` source cannot stand in for: its bonus is
   * gated on what else is in the loadout, so there has to be a loadout to
   * count. The card it sits on and the four it counts are the project's own.
   */
  const WELL_ARMED = {
    id: 'fixture-well-armed',
    name: 'Well Armed',
    source: { kind: 'domainCard', card: 'fixture-card-5' },
    text: 'Carrying enough of a kind, its holder is harder to put down.',
    kind: 'passive',
    action: false,
    modifiers: [
      { stat: 'attackRoll', bonus: 2, when: { kind: 'loadout', domain: 'fixture', op: '>=', value: 4 } },
      { stat: 'severeThreshold', bonus: 4, when: { kind: 'loadout', domain: 'fixture', op: '>=', value: 4 } },
    ],
  };

  it('is offered only while its holder is nearly out, whoever is attacking', () => {
    const demo = scene();
    demo.project.abilities.push(abilitySchema.parse(ON_THE_BRINK));
    holding(demo, []);
    const kara = demo.state.entity('kara')!;
    // The GM's turn is on, so the actor is an adversary: the card still has to
    // read Kara's Hit Points and not the husk's.
    demo.scenario.actorId = demo.state.entitiesOf('adversary')[0]!.id;

    // Her own subclass features are read here too; this is about the one card.
    const offered = (): string[] =>
      demo.world.reactionsFor('kara', 'incomingDamage').map((a) => a.id).filter((id) => id === 'fixture-on-the-brink');

    kara.hitPoints = { max: 6, marked: 3 };
    expect(offered()).toEqual([]);
    kara.hitPoints = { max: 6, marked: 4 };
    expect(offered()).toEqual(['fixture-on-the-brink']);

    // And it does what it says: with no Armor Slots left to hide behind,
    // Minor damage marks nothing at all.
    kara.armorSlots = { max: kara.armorSlots.max, marked: kara.armorSlots.max };
    expect(demo.world.dealDamage('kara', { amount: 1, types: ['physical'] }, demo.rng).hpMarked).toBe(0);
    kara.hitPoints = { max: 6, marked: 3 };
    expect(demo.world.dealDamage('kara', { amount: 1, types: ['physical'] }, demo.rng).hpMarked).toBe(1);
  });

  it("clears its holder's Stress, not the attacker's", () => {
    const demo = scene();
    demo.project.abilities.push(abilitySchema.parse(SWIFT_STEP));
    holding(demo, []);
    const kara = demo.state.entity('kara')!;
    kara.stress = { max: 6, marked: 2 };
    const husk = demo.state.entitiesOf('adversary')[0]!;
    husk.stress = { max: 3, marked: 3 };
    demo.scenario.actorId = husk.id;

    const card = demo.world.reactionsFor('kara', 'attackMissed')[0]!;
    // The react path stands the holder up as the actor before running it.
    const was = demo.scenario.actorId;
    demo.scenario.actorId = 'kara';
    runScript(card.effects, demo.world, demo.rng, { targets: [husk.id] });
    demo.scenario.actorId = was;

    expect(demo.state.entity('kara')!.stress.marked).toBe(1);
    expect(demo.state.entity(husk.id)!.stress.marked).toBe(3);
  });

  it("raises its holder's Severe threshold while an adversary is the one acting", () => {
    const demo = scene();
    // The cards are the project's: what is under test is a bonus counted off
    // the loadout, so the loadout has to have something in it to count.
    demo.project.domainCards.push(...FIXTURE_CARDS);
    demo.project.abilities.push(abilitySchema.parse(WELL_ARMED));

    holding(demo, ['fixture-card-5']);
    const alone = demo.world.defenderOf(demo.state.entity('kara')!).thresholds.severe;

    holding(demo, [...FIXTURE_DOMAIN_FOUR, 'fixture-card-5']);
    demo.scenario.actorId = demo.state.entitiesOf('adversary')[0]!.id;
    // Four of a kind in the loadout beside it: the bonus holds when it is
    // read, which is while somebody else is swinging.
    expect(demo.world.defenderOf(demo.state.entity('kara')!).thresholds.severe).toBe(alone + 4);
  });
});

describe('conditions with modifiers', () => {
  it("Rogue's Dodge raises Evasion until an attack lands, then ends", () => {
    const demo = scene();
    const finn = demo.state.entity('finn')!;
    finn.hope = { max: 6, value: 3 };
    const before = demo.world.defenderOf(finn).difficulty;
    expect(useAbility(demo, 'finn', 'rogue-rogues-dodge').status).toBe('done');
    expect(finn.conditions.has('dodging')).toBe(true);
    expect(demo.world.defenderOf(finn).difficulty).toBe(before + 2);
    // Twice is refused: the condition is already there.
    finn.hope = { max: 6, value: 3 };
    expect(useAbility(demo, 'finn', 'rogue-rogues-dodge').status).toBe('refused');
    expect(demo.world.endsOnHit('finn')).toEqual(['dodging']);
    expect(demo.world.defenderOf(finn).difficulty).toBe(before);
  });

  it("Tava's Armor adds an Armor Slot to whoever wears it until a rest", () => {
    const demo = scene();
    const kara = demo.state.entity('kara')!;
    const mira = demo.state.entity('mira')!;
    demo.state.moveEntity('mira', demo.grid.indexOf(demo.grid.xOf(kara.tile) + 1, demo.grid.yOf(kara.tile)));
    mira.hope = { max: 6, value: 2 };
    const max = kara.armorSlots.max;
    expect(useAbility(demo, 'mira', 'book-of-ava-tavas-armor', ['kara']).status).toBe('done');
    expect(kara.conditions.has('tavas-armor')).toBe(true);
    expect(kara.armorSlots.max).toBe(max + 1);
    // Cast on Mira instead: Kara's goes, Mira's comes.
    mira.hope = { max: 6, value: 2 };
    expect(useAbility(demo, 'mira', 'book-of-ava-tavas-armor', ['mira']).status).toBe('done');
    expect(kara.armorSlots.max).toBe(max);
    expect(mira.armorSlots.max).toBe(demo.characters.get('mira')!.armorScore + 1);
    // A rest ends it.
    expect(rest(demo, 'short', { moves: {} }).ok).toBe(true);
    expect(mira.conditions.has('tavas-armor')).toBe(false);
    expect(mira.armorSlots.max).toBe(demo.characters.get('mira')!.armorScore);
    syncPools(demo);
  });
});

describe('reactions when a hit lands', () => {
  it('Get Back Up and Iron Will answer a Severe hit on Kara, automatically', () => {
    const demo = scene();
    const kara = demo.state.entity('kara')!;
    // 20 physical against 9/17 is Severe: the slot, Iron Will's second slot,
    // and Get Back Up bring it to nothing.
    demo.scenario.actorId = 'mira';
    const journal = runScript([{ kind: 'damage', dice: '20 phy', target: { kind: 'entity', id: 'kara' } }], demo.world, demo.rng);
    expect(journal.filter((e) => e.kind === 'defended').map((e) => (e.kind === 'defended' ? e.ability : ''))).toEqual(['Iron Will', 'Get Back Up']);
    expect(kara.hitPoints.marked).toBe(0);
    expect(kara.armorSlots.marked).toBe(2);
    expect(kara.stress.marked).toBe(1);
  });

  it('a Rune Ward spends a Hope on Mira when its die helps', () => {
    const demo = scene();
    const mira = demo.state.entity('mira')!;
    mira.hope = { max: 6, value: 2 };
    // Gambeson is 5/11 at level 1, 6/12: 13 is Severe. Try seeds until the d8
    // takes it under 12, which is any roll of 2 or more.
    for (let seed = 1; seed < 20; seed++) {
      const demo2 = scene(`ward-${seed}`);
      const m = demo2.state.entity('mira')!;
      m.hope = { max: 6, value: 2 };
      demo2.scenario.actorId = 'kara';
      const journal = runScript([{ kind: 'damage', dice: '13 mag', target: { kind: 'entity', id: 'mira' } }], demo2.world, demo2.rng);
      const ward = journal.find((e) => e.kind === 'defended');
      if (ward === undefined) continue;
      expect(ward).toMatchObject({ ability: 'Rune Ward', hopeSpent: 1 });
      expect(m.hope!.value).toBe(1);
      expect(m.hitPoints.marked).toBeLessThan(3);
      return;
    }
    throw new Error('the ward never helped in twenty seeds');
  });
});

// ---------------------------------------------------------------------------
// The defender's choice
// ---------------------------------------------------------------------------

/** A fight where one husk stands next to Kara and the party is asked. */
function standoff(seed = 'ask'): DemoScene {
  const demo = scene(seed);
  demo.askDefender = true;
  const foe = demo.state
    .entitiesOf('adversary')
    .filter((e) => e.alive)
    .sort((a, b) => demo.grid.manhattanDistance(demo.state.entity('kara')!.tile, a.tile) - demo.grid.manhattanDistance(demo.state.entity('kara')!.tile, b.tile))[0]!;
  // Kara beside it, the others out of the way but in range to help.
  const blocked = demo.state.blockedFor('kara');
  let stand = NO_TILE;
  demo.grid.forEachNeighbor(foe.tile, false, (tile) => {
    if (stand === NO_TILE && demo.grid.isPassable(tile) && !blocked(tile)) stand = tile;
  });
  demo.state.moveEntity('kara', stand);
  demo.party.select('kara');
  startEncounter(demo, demo.scene.encounters[0]!.id);
  // Everyone else is down, so the husk always swings at Kara.
  for (const e of demo.state.entitiesOf('adversary')) {
    if (e.id !== foe.id) {
      e.hitPoints = { ...e.hitPoints, marked: e.hitPoints.max };
      e.alive = false;
    }
  }
  return demo;
}


/**
 * Stand a party member where they can help Kara but are not the nearest
 * target themselves: beside her, but a step further from the husk. The GM
 * takes the nearest, so this keeps Kara the one being hit.
 */
function standBehind(demo: DemoScene, id: string, husk: number): void {
  const kara = demo.state.entity('kara')!.tile;
  const blocked = demo.state.blockedFor(id);
  let best = NO_TILE;
  demo.grid.forEachNeighbor(kara, false, (tile) => {
    if (!demo.grid.isPassable(tile) || blocked(tile)) return;
    if (demo.grid.manhattanDistance(tile, husk) <= demo.grid.manhattanDistance(kara, husk)) return;
    if (best === NO_TILE) best = tile;
  });
  expect(best).not.toBe(NO_TILE);
  demo.state.moveEntity(id, best);
}

/**
 * Play GM turns until a particular kind of answer is on offer.
 *
 * The party is patched up between turns and the plain "take it" answers are
 * given, because what is under test is one choice appearing — the Burrower
 * spits acid and erupts as often as it swings, and whoever holds the card has
 * to be standing when the blow finally lands.
 */
function untilChoice(demo: DemoScene, kind: DefenseChoice['kind'], limit = 80): PendingDefense | null {
  for (let i = 0; i < limit; i++) {
    for (const member of demo.state.entitiesOf('party')) {
      member.hitPoints = { ...member.hitPoints, marked: 0 };
      member.stress = { ...member.stress, marked: 0 };
      member.armorSlots = { ...member.armorSlots, marked: 0 };
      if (member.hope !== undefined) member.hope = { max: member.hope.max, value: member.hope.max };
      member.alive = true;
    }
    endTurn(demo);
    while (demo.pending !== null) {
      const waiting = demo.pending;
      if (waiting.kind === 'defense' && waiting.choices.some((c) => c.kind === kind)) return waiting;
      answerPending(demo, { kind: 'choose', index: 0 });
    }
    if (demo.encounter?.outcome !== 'ongoing') {
      return null;
    }
  }
  return null;
}

/**
 * Play GM turns until the husk's blow actually lands on someone.
 *
 * The party is patched up between turns: the Burrower erupts while it has the
 * Stress for it and swings when it does not, so a fight has to last a while
 * for a blow to land at all.
 */
function untilAsked(demo: DemoScene, limit = 60): boolean {
  for (let i = 0; i < limit; i++) {
    for (const member of demo.state.entitiesOf('party')) {
      member.hitPoints = { ...member.hitPoints, marked: 0 };
      member.alive = true;
    }
    endTurn(demo);
    if (demo.pending !== null) return true;
    if (demo.encounter?.outcome !== 'ongoing') return false;
  }
  return false;
}

describe('being asked how a hit lands', () => {
  it('offers the Armor Slot and the cards that can pay, and marks what was chosen', () => {
    const demo = standoff();
    expect(untilAsked(demo)).toBe(true);
    const pending = demo.pending!;
    expect(pending.kind).toBe('defense');
    if (pending.kind !== 'defense') throw new Error('expected a defence');
    expect(pending.prompt.kind).toBe('choice');
    const labels = pending.choices.map((c) => c.label);
    // "Take it" is always there, and always first, so there is always an answer.
    expect(labels[0]).toMatch(/^Take it — \d Hit Point/);
    expect(labels.some((l) => l.startsWith('Mark an Armor Slot'))).toBe(true);
    const kara = demo.state.entity('kara')!;
    const armorBefore = kara.armorSlots.marked;
    const hpBefore = kara.hitPoints.marked;

    const armor = labels.findIndex((l) => l.startsWith('Mark an Armor Slot'));
    const promised = Number(/— (\d+) Hit Point/.exec(labels[armor]!)![1]);
    answerPending(demo, { kind: 'choose', index: armor });
    expect(demo.state.entity('kara')!.armorSlots.marked).toBe(armorBefore + 1);
    expect(demo.state.entity('kara')!.hitPoints.marked).toBe(hpBefore + promised);
    // The question is answered and the fight moves on.
    expect(demo.pending).toBeNull();
  });

  it('takes it as it comes when the answer is stepped back from', () => {
    const demo = standoff('step-back');
    expect(untilAsked(demo)).toBe(true);
    const pending = demo.pending!;
    if (pending.kind !== 'defense') throw new Error('expected a defence');
    const straight = Number(/— (\d+) Hit Point/.exec(pending.choices[0]!.label)![1]);
    const kara = demo.state.entity('kara')!;
    const before = { hp: kara.hitPoints.marked, armor: kara.armorSlots.marked };
    answerPending(demo, { kind: 'cancel' });
    expect(demo.state.entity('kara')!.hitPoints.marked).toBe(before.hp + straight);
    expect(demo.state.entity('kara')!.armorSlots.marked).toBe(before.armor);
  });

  it('holds the rest of the GM\'s turn until it is answered', () => {
    const demo = standoff('two-husks');
    // Wake a second husk beside Finn, so the GM has two to spotlight.
    const down = demo.state.entitiesOf('adversary').find((e) => !e.alive)!;
    down.alive = true;
    down.hitPoints = { ...down.hitPoints, marked: 0 };
    demo.state.moveEntity('finn', demo.state.entity('kara')!.tile === NO_TILE ? down.tile : down.tile);
    expect(untilAsked(demo)).toBe(true);
    const turn = demo.gmTurn;
    expect(turn).not.toBeNull();
    // Something is still to act, and nothing else has happened yet.
    const linesBefore = demo.log.length;
    expect(demo.pending).not.toBeNull();
    answerPending(demo, { kind: 'choose', index: 0 });
    expect(demo.log.length).toBeGreaterThan(linesBefore);
    // Either the turn finished, or it stopped again on the second husk's blow.
    expect(demo.gmTurn === null || demo.pending !== null).toBe(true);
  });

  it('decides for itself when nobody is being asked', () => {
    const demo = standoff('auto');
    demo.askDefender = false;
    for (let i = 0; i < 20 && demo.encounter?.outcome === 'ongoing'; i++) endTurn(demo);
    expect(demo.pending).toBeNull();
    expect(demo.gmTurn).toBeNull();
  });
});

describe('an ally interrupting', () => {
  it('takes the hit instead when I Am Your Shield is chosen', () => {
    const demo = standoff('shield');
    // Finn holds the card and stands beside Kara.
    demo.sheets.set('finn', { ...demo.sheets.get('finn')!, domainCards: ['i-am-your-shield'], loadout: ['i-am-your-shield'] });
    demo.characters.set('finn', deriveCharacter(demo.sheets.get('finn')!, characterContentFor(demo.project), demo.project.abilities).character);
    refreshWorld(demo);
    standBehind(demo, 'finn', demo.state.entitiesOf('adversary').find((e) => e.alive)!.tile);
    // Spit Acid catches the whole party; Finn has to still be standing when a
    // single blow finally lands on Kara.
    demo.state.entity('finn')!.hitPoints = { max: 12, marked: 0 };

    const pending = untilChoice(demo, 'redirect');
    expect(pending, 'the shield was offered').not.toBeNull();
    const shield = pending!.choices.findIndex((c) => c.kind === 'redirect');
    const karaBefore = demo.state.entity('kara')!.hitPoints.marked;
    const finn = demo.state.entity('finn')!;
    const finnStress = finn.stress.marked;
    answerPending(demo, { kind: 'choose', index: shield });

    // Finn marked the Stress and is now the one being asked how it lands.
    expect(demo.state.entity('finn')!.stress.marked).toBe(finnStress + 1);
    expect(demo.log.map((l) => l.text).some((t) => t.includes('steps in front of Kara'))).toBe(true);
    if (demo.pending !== null) {
      expect(demo.pending.kind).toBe('defense');
      if (demo.pending.kind === 'defense') expect(demo.pending.attack.defender).toBe('finn');
      answerPending(demo, { kind: 'choose', index: 0 });
    }
    expect(demo.state.entity('kara')!.hitPoints.marked).toBe(karaBefore);
    expect(demo.state.entity('finn')!.hitPoints.marked).toBeGreaterThan(0);
  });

  it('makes the adversary roll again for Not This Time, and asks once per hit', () => {
    const demo = standoff('reroll');
    const mira = demo.state.entity('mira')!;
    mira.hope = { max: 6, value: 6 };
    // Mira is a Wizard: Not This Time is her Hope feature. She has to be able
    // to see it happen — within Far range of the adversary.
    standBehind(demo, 'mira', demo.state.entitiesOf('adversary').find((e) => e.alive)!.tile);
    demo.state.entity('mira')!.hitPoints = { max: 12, marked: 0 };

    const pending = untilChoice(demo, 'reroll');
    expect(pending, 'Not This Time was offered').not.toBeNull();
    const reroll = pending!.choices.findIndex((c) => c.kind === 'reroll');
    answerPending(demo, { kind: 'choose', index: reroll });
    // Three Hope gone, and the log says the blow came again.
    expect(demo.state.entity('mira')!.hope!.value).toBe(3);
    expect(demo.log.map((l) => l.text).some((t) => t.includes('Not This Time'))).toBe(true);

    // If it still landed, the same card is not offered twice for the same hit.
    if (demo.pending !== null && demo.pending.kind === 'defense') {
      expect(demo.pending.choices.some((c) => c.kind === 'reroll')).toBe(false);
      answerPending(demo, { kind: 'choose', index: 0 });
    }
    expect(demo.pending).toBeNull();
  });
});

describe('answering a miss', () => {
  it('offers Vanishing Dodge, which leaves the rogue Hidden until they act', () => {
    const demo = standoff('vanish');
    const sheet = { ...demo.sheets.get('kara')!, domainCards: ['vanishing-dodge'], loadout: ['vanishing-dodge'] };
    demo.sheets.set('kara', sheet);
    demo.characters.set('kara', deriveCharacter(sheet, characterContentFor(demo.project), demo.project.abilities).character);
    refreshWorld(demo);
    demo.state.entity('kara')!.hope = { max: 6, value: 6 };

    const pending = untilChoice(demo, 'react');
    expect(pending, 'Vanishing Dodge was offered').not.toBeNull();
    expect(pending!.choices[0]!.label).toBe('Let it go wide');
    const dodge = pending!.choices.findIndex((c) => c.kind === 'react');
    answerPending(demo, { kind: 'choose', index: dodge });

    expect(demo.world.hasCondition('kara', 'hidden')).toBe(true);
    expect(demo.state.entity('kara')!.hope!.value).toBe(5);
    expect(demo.log.map((l) => l.text)).toContain('Shadow closes over the space where they stood.');

    // Hidden until they act: swinging ends it.
    demo.state.entity('kara')!.hope = { max: 6, value: 6 };
    const foe = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    attackWithSelected(demo, foe.id);
    expect(demo.world.hasCondition('kara', 'hidden')).toBe(false);
  });
});

describe('what a block hangs on its own attack', () => {
  /** Kara, but so hard to hurt that only the Armor Slot decides the outcome. */
  function unhittable(demo: DemoScene): void {
    demo.project.conditionDefs.push({
      id: 'braced',
      name: 'Braced',
      text: 'Nothing gets through.',
      modifiers: [
        { stat: 'majorThreshold', bonus: 50, requires: undefined, plusTrait: undefined, when: undefined },
        { stat: 'severeThreshold', bonus: 50, requires: undefined, plusTrait: undefined, when: undefined },
      ],
      blocks: [],
    } as (typeof demo.project.conditionDefs)[number]);
    demo.state.entity('kara')!.conditions.add('braced');
    demo.state.entity('kara')!.conditionDurations.set('braced', 'scene');
  }

  function withRiders(seed: string): DemoScene {
    const demo = standoff(seed);
    demo.askDefender = false;
    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    const on = adversaryDefOf(demo, husk.id)!.id;
    demo.project.abilities.push(
      abilitySchema.parse({
        id: 'on-hit',
        name: 'On Hit',
        source: { kind: 'adversary', adversaries: [on] },
        text: 'When it lands.',
        kind: 'reaction',
        trigger: 'dealtHit',
        action: false,
        effects: [{ kind: 'log', text: 'the claws land', tone: 'combat' }],
      }),
      abilitySchema.parse({
        id: 'on-damage',
        name: 'On Damage',
        source: { kind: 'adversary', adversaries: [on] },
        text: 'When a Hit Point is marked.',
        kind: 'reaction',
        trigger: 'dealtDamage',
        action: false,
        effects: [{ kind: 'markStress', target: { kind: 'hit' } }],
      }),
    );
    refreshWorld(demo);
    return demo;
  }

  it('fires the hit rider on a blow the armor turns aside, and the damage rider only when a Hit Point is marked', () => {
    // Armor to spare and nothing that can reach a threshold: the claws land
    // and are turned aside, so only "on a successful attack" applies.
    const turned = withRiders('turned');
    unhittable(turned);
    const kara = turned.state.entity('kara')!;
    kara.armorSlots = { ...kara.armorSlots, marked: 0 };
    const stressBefore = kara.stress.marked;
    for (let i = 0; i < 4 && turned.encounter?.outcome === 'ongoing'; i++) endTurn(turned);
    expect(turned.log.some((l) => l.text.includes('the claws land'))).toBe(true);
    expect(turned.state.entity('kara')!.hitPoints.marked).toBe(0);
    expect(turned.state.entity('kara')!.stress.marked).toBe(stressBefore);

    // The same claws with no armor left mark a Hit Point, and then both fire.
    const through = withRiders('through');
    const hurt = through.state.entity('kara')!;
    hurt.armorSlots = { ...hurt.armorSlots, marked: hurt.armorSlots.max };
    for (let i = 0; i < 4 && through.encounter?.outcome === 'ongoing'; i++) endTurn(through);
    expect(through.log.some((l) => l.text.includes('the claws land'))).toBe(true);
    expect(through.state.entity('kara')!.stress.marked).toBeGreaterThan(0);
  });

  it('hangs nothing on the blow that puts its target down', () => {
    // One Hit Point left and no armour: whatever lands fells her. A rider that
    // fired here would push a body around or take Hope off someone who is
    // already out of the fight.
    const demo = withRiders('felled');
    const kara = demo.state.entity('kara')!;
    kara.armorSlots = { ...kara.armorSlots, marked: kara.armorSlots.max };
    kara.hitPoints = { ...kara.hitPoints, marked: kara.hitPoints.max - 1 };
    for (let i = 0; i < 4 && demo.state.entity('kara')!.alive; i++) endTurn(demo);
    expect(demo.state.entity('kara')!.alive).toBe(false);
    expect(demo.log.some((l) => l.text.includes('the claws land'))).toBe(false);
  });

  it("lets a passive make the block's own swing go through armor", () => {
    const build = (direct: boolean): number => {
      const demo = standoff('direct');
      demo.askDefender = false;
      const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
      if (direct) {
        demo.project.abilities.push(
          abilitySchema.parse({
            id: 'bone-breaker',
            name: 'Bone Breaker',
            source: { kind: 'adversary', adversaries: [adversaryDefOf(demo, husk.id)!.id] },
            text: 'Its attacks deal direct damage.',
            kind: 'passive',
            action: false,
            standardAttack: { direct: true },
          }),
        );
        refreshWorld(demo);
      }
      const kara = demo.state.entity('kara')!;
      kara.armorSlots = { ...kara.armorSlots, marked: 0 };
      endTurn(demo);
      return demo.state.entity('kara')!.armorSlots.marked;
    };
    // The same swing off the same seed: armour answers the ordinary one and
    // has no answer to the direct one.
    expect(build(false)).toBeGreaterThan(0);
    expect(build(true)).toBe(0);
  });
});

describe("an adversary's own features", () => {
  /**
   * Two stat-block features the fixture carries. The rest of this block already
   * writes its own and sources them to whatever the demo placed, which is the
   * same card-first move on the GM's side of the table.
   *
   * The eruption stays aimed at nobody in particular within Very Close: the
   * chooser prefers an area feature that catches more than one of the party,
   * and that preference is why the first test crowds three people together.
   */
  const eruptionFeature = (demo: DemoScene, husk: string): Record<string, unknown> => ({
    id: 'fixture-eruption',
    name: 'Earth Eruption',
    source: { kind: 'adversary', adversaries: [adversaryDefOf(demo, husk)!.id] },
    text: 'Mark a Stress to burst out of the ground and knock over everything close by.',
    cost: { stress: 1 },
    target: { kind: 'none', range: 'veryClose' },
    inCombatOnly: true,
    effects: [
      { kind: 'log', text: 'The ground splits and heaves.', tone: 'combat' },
      {
        kind: 'reactionRoll',
        difficulty: 14,
        trait: 'agility',
        // From a stat block, `allies` is who the feature is aimed at: the
        // selectors name factions rather than sides.
        targets: { kind: 'allies', range: 'veryClose' },
        onFail: [
          { kind: 'log', text: 'Knocked off their feet.', tone: 'fear' },
          { kind: 'applyCondition', condition: 'vulnerable', duration: 'temporary', target: { kind: 'hit' } },
        ],
      },
    ],
  });

  /** A spray with a price the next test rewrites, to watch what the GM pays. */
  const sprayFeature = (demo: DemoScene, husk: string): Record<string, unknown> => ({
    id: 'fixture-spray',
    name: 'Spit Acid',
    source: { kind: 'adversary', adversaries: [adversaryDefOf(demo, husk)!.id] },
    text: 'Spray everything in front of it, and what it hits finds no use in armour.',
    target: { kind: 'none', range: 'close' },
    inCombatOnly: true,
    effects: [
      { kind: 'log', text: 'Acid arcs out in a wide spray.', tone: 'combat' },
      {
        kind: 'attack',
        range: 'close',
        target: { kind: 'allies', range: 'close' },
        damage: '2d6',
        onHit: [{ kind: 'run', hook: 'mark-armor-or-hit-point', args: { fear: true } }],
      },
    ],
  });

  /** Its own features come off, so the one under test is the only one on offer. */
  const onlyFeature = (demo: DemoScene, feature: Record<string, unknown>): void => {
    demo.project.abilities = demo.project.abilities.filter((a) => a.source.kind !== 'adversary');
    demo.project.abilities.push(abilitySchema.parse(feature));
    refreshWorld(demo);
  };

  it('erupts when it catches more than one of the party, and the ones who fail are Vulnerable', () => {
    const demo = standoff('eruption');
    // Finn and Mira crowd in beside Kara, so the Burrower has a reason to erupt.
    const around: number[] = [];
    demo.grid.forEachNeighbor(demo.state.entity('kara')!.tile, false, (tile) => {
      if (demo.grid.isPassable(tile)) around.push(tile);
    });
    demo.state.moveEntity('finn', around[0]!);
    demo.state.moveEntity('mira', around[1]!);
    const erupting = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    onlyFeature(demo, eruptionFeature(demo, erupting.id));

    let erupted = false;
    for (let i = 0; i < 20 && !erupted; i++) {
      endTurn(demo);
      while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
      erupted = demo.log.some((l) => l.text.includes('Earth Eruption'));
      if (demo.encounter?.outcome !== 'ongoing') break;
    }
    expect(erupted).toBe(true);
    expect(demo.log.map((l) => l.text)).toContain('The ground splits and heaves.');
    // It paid the Stress the feature asks for.
    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    expect(husk.stress.marked).toBeGreaterThan(0);
    // Everyone rolled; whoever failed is Vulnerable.
    const knocked = demo.state.entitiesOf('party').filter((e) => e.conditions.has('vulnerable'));
    const rolled = demo.log.filter((l) => l.text.includes('Knocked off their feet.'));
    expect(knocked.length).toBe(rolled.length);
  });

  /**
   * "Spend a Fear to…" is written on most of the SRD's stat blocks, and what
   * it says is what the GM pays: not the one Fear a feature that names no cost
   * is charged so that its teeth still come into the fight.
   */
  it('pays what a feature says it costs, and leaves it alone when the GM is short', () => {
    const demo = standoff('fear-cost');
    demo.askDefender = false;
    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    // Two of the party in reach: the bar a feature has to clear to be worth it.
    standBehind(demo, 'finn', husk.tile);
    // Nothing left to mark, so the feature that costs Stress is out of the way
    // and Spit Acid — repriced here at two Fear — is the only one on offer.
    husk.stress = { ...husk.stress, marked: husk.stress.max };
    onlyFeature(demo, sprayFeature(demo, husk.id));
    const spit = demo.project.abilities.find((a) => a.id === 'fixture-spray')!;
    spit.cost = { fear: 2 };
    refreshWorld(demo);

    // One Fear buys nothing, though one would have paid for it unpriced.
    demo.state.fear = { ...demo.state.fear, value: 1 };
    for (let i = 0; i < 4 && demo.encounter?.outcome === 'ongoing'; i++) endTurn(demo);
    expect(demo.log.some((l) => l.text.includes('Spit Acid'))).toBe(false);

    // Three, and it spits — spending the two it named.
    demo.state.fear = { ...demo.state.fear, value: 3 };
    let sprayed = false;
    for (let i = 0; i < 4 && !sprayed && demo.encounter?.outcome === 'ongoing'; i++) {
      endTurn(demo);
      sprayed = demo.log.some((l) => l.text.includes('Spit Acid'));
    }
    expect(sprayed).toBe(true);
    expect(demo.log.map((l) => l.text)).toContain('The GM spends 2 Fear.');
  });

  /**
   * "Make an attack against a target within Very Close range" is how most of
   * the SRD's features are written. Nobody at the GM's end picks a creature,
   * so the turn has to aim it — at the nearest, as a claw is aimed.
   */
  it('aims a feature that names a creature at the nearest of the party', () => {
    const demo = standoff('aimed');
    demo.askDefender = false;
    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    // Finn stands further off than Kara, who is beside it.
    standBehind(demo, 'finn', husk.tile);
    // The block's own features would be chosen ahead of this one by the rules
    // under test; this is about how a feature is aimed, so they come off.
    demo.project.abilities = demo.project.abilities.filter((a) => a.source.kind !== 'adversary');
    demo.project.abilities.push(
      abilitySchema.parse({
        id: 'gore',
        name: 'Gore',
        source: { kind: 'adversary', adversaries: [adversaryDefOf(demo, husk.id)!.id] },
        text: 'Make an attack against a target within Very Close range.',
        target: { kind: 'creature', range: 'veryClose' },
        inCombatOnly: true,
        // No `target` on the attack: the runner aims it at whoever was picked,
        // and on this side of the table that is the GM's turn's job.
        effects: [{ kind: 'attack', damage: '1d4+20' }],
      }),
    );
    refreshWorld(demo);
    demo.state.fear = { ...demo.state.fear, value: demo.state.fear.max };

    let gored = false;
    for (let i = 0; i < 8 && !gored && demo.encounter?.outcome === 'ongoing'; i++) {
      endTurn(demo);
      gored = demo.log.some((l) => l.text.includes('uses Gore'));
    }
    expect(gored).toBe(true);
    // It swung at someone: no refusal for want of anyone to swing at.
    expect(demo.log.map((l) => l.text).join(' ')).not.toContain('nothing to attack');
    // Kara is the nearest, so Kara is who it went for — hit or missed. The
    // gore carries no attack name of its own, so the blow is logged under the
    // block's: read it off the creature rather than naming it here.
    const attack = adversaryDefOf(demo, husk.id)!.attackName;
    const swung = demo.log.map((l) => l.text).find((t) => t.includes(attack));
    expect(swung).toContain('Kara');
  });

  it('spends a once-per-scene feature once, and has it back next fight', () => {
    const demo = standoff('once');
    demo.askDefender = false;
    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    standBehind(demo, 'finn', husk.tile);
    demo.project.abilities = demo.project.abilities.filter((a) => a.source.kind !== 'adversary');
    demo.project.abilities.push(
      abilitySchema.parse({
        id: 'adrenaline-burst',
        name: 'Adrenaline Burst',
        source: { kind: 'adversary', adversaries: [adversaryDefOf(demo, husk.id)!.id] },
        text: 'Once per scene, spend a Fear to clear 2 Stress.',
        cost: { fear: 1 },
        uses: { count: 1, per: 'scene' },
        target: { kind: 'none', range: 'close' },
        inCombatOnly: true,
        effects: [{ kind: 'clearStress', amount: 2 }],
      }),
    );
    refreshWorld(demo);
    demo.state.fear = { ...demo.state.fear, value: demo.state.fear.max };

    let bursts = 0;
    for (let i = 0; i < 8 && demo.encounter?.outcome === 'ongoing'; i++) {
      endTurn(demo);
      bursts = demo.log.filter((l) => l.text.includes('uses Adrenaline Burst')).length;
      if (bursts > 1) break;
    }
    expect(bursts).toBe(1);
  });

  it('lets the party shake off a temporary hold when their turn is over', () => {
    const demo = standoff('hold');
    demo.askDefender = false;
    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    demo.project.abilities = demo.project.abilities.filter((a) => a.source.kind !== 'adversary');
    demo.project.abilities.push(
      abilitySchema.parse({
        id: 'lock-up',
        name: 'Lock Up',
        source: { kind: 'adversary', adversaries: [adversaryDefOf(demo, husk.id)!.id] },
        text: 'Restrain a target until they break free.',
        target: { kind: 'creature', range: 'veryClose' },
        inCombatOnly: true,
        effects: [
          { kind: 'applyCondition', condition: 'restrained', duration: 'temporary', target: { kind: 'target' } },
        ],
      }),
    );
    refreshWorld(demo);
    demo.state.fear = { ...demo.state.fear, value: demo.state.fear.max };

    let held = false;
    for (let i = 0; i < 6 && !held && demo.encounter?.outcome === 'ongoing'; i++) {
      endTurn(demo);
      held = demo.world.hasCondition('kara', 'restrained');
    }
    // The hold lands, and it is gone once the party has had their turn: the
    // Strength Roll the block asks for is not a roll this engine can ask for,
    // so the hold cannot be allowed to last the whole fight.
    expect(held).toBe(true);
    endTurn(demo);
    // It comes off when the party's turn ends — and goes straight back on,
    // because the only thing this adversary does is put it there, so the log
    // is what says the hold was shaken rather than the state afterwards.
    expect(demo.log.map((l) => l.text)).toContain('Kara shakes off restrained.');
  });

  it("leaves a feature alone when the block's own condition on it is not met", () => {
    const demo = standoff('unhurt');
    demo.askDefender = false;
    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    standBehind(demo, 'finn', husk.tile);
    demo.project.abilities = demo.project.abilities.filter((a) => a.source.kind !== 'adversary');
    demo.project.abilities.push(
      abilitySchema.parse({
        id: 'regeneration',
        name: 'Regeneration',
        source: { kind: 'adversary', adversaries: [adversaryDefOf(demo, husk.id)!.id] },
        text: 'If the Burrower has any marked HP, spend a Fear to clear a HP.',
        cost: { fear: 1 },
        available: { kind: 'pool', pool: 'hitPoints', measure: 'marked', op: '>=', value: 1 },
        target: { kind: 'self', range: 'melee' },
        inCombatOnly: true,
        effects: [{ kind: 'heal', amount: 1, target: { kind: 'actor' } }],
      }),
    );
    refreshWorld(demo);
    demo.state.fear = { ...demo.state.fear, value: demo.state.fear.max };

    // Unhurt: it has nothing to heal, so it does not spend a Fear on one.
    for (let i = 0; i < 3 && demo.encounter?.outcome === 'ongoing'; i++) endTurn(demo);
    expect(demo.log.some((l) => l.text.includes('Regeneration'))).toBe(false);

    // Wounded, and it heals — which also shows a heal reaches an adversary.
    husk.hitPoints = { ...husk.hitPoints, marked: 3 };
    let healed = false;
    for (let i = 0; i < 4 && !healed && demo.encounter?.outcome === 'ongoing'; i++) {
      endTurn(demo);
      healed = demo.log.some((l) => l.text.includes('Regeneration'));
    }
    expect(healed).toBe(true);
    expect(demo.state.entity(husk.id)!.hitPoints.marked).toBeLessThan(3);
  });

  it('lets a Relentless adversary act twice in one GM turn when the GM can pay', () => {
    const demo = standoff('relentless');
    demo.askDefender = false;
    demo.state.fear = { ...demo.state.fear, value: demo.state.fear.max };
    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    // The feature is the whole subject here, so the creature carrying it is
    // authored beside the assertion rather than borrowed from a catalogue --
    // and stood up rather than written over the one already there, because
    // what a creature is comes from its placement.
    demo.project.adversaries.push(
      adversaryDefSchema.parse({
        id: 'fixture-relentless',
        name: 'Tireless',
        tier: 1,
        role: 'solo',
        difficulty: 13,
        thresholds: { major: 10, severe: 20 },
        hitPoints: 12,
        stress: 4,
        attackName: 'Long Reach',
        attackModifier: { count: 0, sides: 0, modifier: 3 },
        attackRange: 'melee',
        attackDamage: { count: 1, sides: 8, modifier: 2, types: ['physical'] },
        features: [
          {
            name: 'Relentless (3)',
            kind: 'passive',
            text: 'It can be spotlighted up to three times a turn, and every one past the first costs the GM.',
          },
        ],
      }),
    );
    const tireless = demo.state.addEntity(
      createAdversaryEntity('tireless', 'fixture-relentless', husk.tile, { hitPoints: 12, stress: 4 }),
    );
    demo.state.removeEntity(husk.id);
    refreshWorld(demo);
    expect(adversaryTraits(adversaryDefOf(demo, tireless.id)!).spotlights).toBe(3);
    const fearBefore = demo.state.fear.value;
    const before = demo.encounter!.log.filter((e) => e.kind === 'adversaryActed').length;
    endTurn(demo);
    const acted = demo.encounter!.log.filter((e) => e.kind === 'adversaryActed').length - before;
    expect(acted).toBeGreaterThan(1);
    expect(acted).toBeLessThanOrEqual(3);
    // Every spotlight past the first costs the GM a Fear.
    expect(demo.state.fear.value).toBe(fearBefore - (acted - 1));
  });
});

describe('a creature that answers its own wounds', () => {
  /**
   * The creature is swapped for a fixture, and not for tidiness: every test
   * here deals 16, which cleared the old creature's Severe threshold and lands
   * well short of what the demo places now. `fixture-foe` reads 6/12, so 16 is
   * past Severe with room left to survive it, and the number stops depending on
   * whoever is standing there.
   *
   * Both features are shared rather than written here, because a second file
   * asserts the same answering wound: they live with the other fixtures, named
   * for the mechanism they carry.
   */
  const WOUND_CARD = 'fixture-card-19';

  /** Stand up the creature these tests are about, carrying what they read. */
  const answering = (demo: DemoScene, features: readonly Record<string, unknown>[]): EntityState => {
    const placed = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    demo.project.adversaries.push(...FIXTURE_ADVERSARIES);
    // What a creature is comes from its placement, so the fixture is stood up
    // where the other one was and that one goes down.
    demo.state.addEntity(
      createAdversaryEntity('answerer', FIXTURE_FOE, placed.tile, { hitPoints: 40, stress: 3 }),
    );
    demo.state.removeEntity(placed.id);
    for (const feature of features) demo.project.abilities.push(abilitySchema.parse(feature));
    refreshWorld(demo);
    return demo.state.entity('answerer')!;
  };

  /** What swings is a card in a hand, not something handed to her. */
  const holding = (demo: DemoScene, cards: string[]): void => {
    demo.project.domainCards.push(...FIXTURE_CARDS);
    const sheet = { ...demo.sheets.get('kara')!, domainCards: cards, loadout: cards };
    demo.sheets.set('kara', sheet);
    demo.characters.set('kara', deriveCharacter(sheet, characterContentFor(demo.project), demo.project.abilities).character);
    refreshWorld(demo);
  };

  it('sprays a whole band, and those without armor mark a Hit Point instead', () => {
    const demo = standoff('spray');
    demo.askDefender = false;
    const foe = answering(demo, [A_SPRAY_THAT_EATS_ARMOUR(FIXTURE_FOE)]);
    // Two of the party in reach gives it a reason, and the GM's Fear pays for
    // the spotlight it spends getting there.
    standBehind(demo, 'finn', foe.tile);
    demo.state.fear = { ...demo.state.fear, value: demo.state.fear.max };
    // Finn's armor is already gone, so the spray costs him a Hit Point instead.
    const finn = demo.state.entity('finn')!;
    finn.armorSlots = { ...finn.armorSlots, marked: finn.armorSlots.max };

    let sprayed = false;
    for (let i = 0; i < 30 && !sprayed; i++) {
      endTurn(demo);
      sprayed = demo.log.some((l) => l.text.includes('It sprays the room'));
      if (demo.encounter?.outcome !== 'ongoing') break;
    }
    expect(sprayed).toBe(true);
    // Everyone it beat was rolled for separately, and the log says what happened.
    expect(demo.log.map((l) => l.text).filter((t) => t.includes('Caustic Spray')).length).toBeGreaterThan(0);
  });

  it("answers a card's own attack, and not only damage the world was handed", () => {
    // The reaction has to fire off a script's attack too, not only off damage
    // the world was handed: a card's `attack` goes through the same door an
    // adversary's swing does, and the queue has to drain after a card.
    const demo = standoff('answer-card');
    demo.askDefender = false;
    demo.project.abilities.push(
      abilitySchema.parse({
        id: 'fixture-heavy-blow',
        name: 'Heavy Blow',
        source: { kind: 'domainCard', card: WOUND_CARD },
        text: 'One swing, with everything behind it.',
        target: { kind: 'adversary', range: 'melee' },
        action: false,
        // Well past the fixture's Severe threshold, and not enough to kill it.
        effects: [{ kind: 'attack', damage: '+16 phy' }],
      }),
    );
    holding(demo, [WOUND_CARD]);
    const foe = answering(demo, [A_WOUND_THAT_ANSWERS(FIXTURE_FOE)]);
    const kara = demo.state.entity('kara')!;
    const before = kara.hitPoints.marked + kara.armorSlots.marked;

    // Whether a given swing lands is the seed's business; that the wound
    // answers is not, so swing until one lands.
    for (let i = 0; i < 20 && !demo.log.some((l) => l.text.includes('The wound opens')); i++) {
      foe.hitPoints = { max: 40, marked: 0 };
      expect(useAbility(demo, 'kara', 'fixture-heavy-blow', [foe.id]).status).toBe('done');
    }
    expect(foe.alive).toBe(true);
    expect(demo.log.map((l) => l.text)).toContain('The wound opens, and the room pays for it.');
    const after = demo.state.entity('kara')!;
    expect(after.hitPoints.marked + after.armorSlots.marked).toBeGreaterThan(before);
  });

  it('answers a Severe wound the world handed it', () => {
    const demo = standoff('answer');
    demo.askDefender = false;
    const foe = answering(demo, [A_WOUND_THAT_ANSWERS(FIXTURE_FOE)]);
    foe.hitPoints = { max: 8, marked: 0 };
    const kara = demo.state.entity('kara')!;
    const before = kara.hitPoints.marked + kara.armorSlots.marked;
    // Straight past the fixture's Severe threshold (6/12), without killing it.
    demo.world.dealDamage(foe.id, { amount: 16, types: ['physical'] }, demo.rng);
    expect(foe.alive).toBe(true);
    settleFight(demo);
    expect(demo.log.map((l) => l.text)).toContain('The wound opens, and the room pays for it.');
    // The splash reaches her: a Hit Point, or the Armor Slot that turned it aside.
    const after = demo.state.entity('kara')!;
    expect(after.hitPoints.marked + after.armorSlots.marked).toBeGreaterThan(before);
  });
});

/** What is waiting on the player right now, if anything. */
const asked = (demo: DemoScene): string | null => demo.pending?.kind ?? null;

describe("the party's own answer to a blow", () => {
  /**
   * Kara holding a card, in a fight, with the party asked rather than decided
   * for. The cards are put straight into the loadout: what is under test is
   * the card firing, not how it was earned.
   */
  const holding = (cards: readonly string[], seed: string): DemoScene => {
    const demo = standoff(seed);
    demo.askDefender = true;
    const sheet = demo.sheets.get('kara')!;
    const grown = { ...sheet, domainCards: [...cards], loadout: [...cards] };
    demo.sheets.set('kara', grown);
    demo.characters.set('kara', deriveCharacter(grown, characterContentFor(demo.project), demo.project.abilities).character);
    refreshWorld(demo);
    syncPools(demo);
    return demo;
  };

  /** The husk Kara is standing next to, given enough Hit Points to be hit. */
  const foeOf = (demo: DemoScene): string => {
    const foe = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    foe.hitPoints = { max: 40, marked: 0 };
    return foe.id;
  };

  /**
   * A card played in answer to a blow that already landed. The question put to
   * the player is whether to spend, so it is offered rather than taken — and
   * nothing is spent while the question stands.
   */
  const HEALING_STRIKE = {
    id: 'fixture-healing-strike',
    name: 'Healing Strike',
    source: { kind: 'granted', characters: ['kara'] },
    text: 'Having hurt something, its holder may spend to mend somebody nearby.',
    kind: 'reaction',
    trigger: 'dealtDamage',
    cost: { hope: 2 },
    action: false,
    target: { kind: 'ally', range: 'close' },
    effects: [{ kind: 'heal', amount: 1, target: { kind: 'allies', range: 'close', nearest: 1 } }],
  };

  /**
   * Two halves on one card, and the reason it has to be a card rather than
   * something granted: the standing bonus is read off the loadout the card
   * sits in, while the Stress it clears is automatic — nothing about it is a
   * decision, so nobody is asked.
   */
  const RISE_UP = {
    id: 'fixture-rise-up',
    name: 'Rise Up',
    source: { kind: 'domainCard', card: 'fixture-card-5' },
    text: 'Harder to put down, and shaking off what the blow cost as it comes.',
    kind: 'reaction',
    trigger: 'tookHitPoints',
    action: false,
    modifiers: [{ stat: 'severeThreshold', plusProficiency: true }],
    effects: [{ kind: 'clearStress', target: { kind: 'actor' } }],
  };

  /** Both fixtures, and the card the second one sits on. */
  const carry = (demo: DemoScene, ability: Record<string, unknown>): void => {
    demo.project.domainCards.push(...FIXTURE_CARDS);
    demo.project.abilities.push(abilitySchema.parse(ability));
  };

  /**
   * Re-derive after carrying something, since `holding` ran before the project
   * had it. A granted ability needs no card; one that sits on a card is named.
   */
  const holdingAgain = (demo: DemoScene, cards: readonly string[] = []): void => {
    const sheet = { ...demo.sheets.get('kara')!, domainCards: [...cards], loadout: [...cards] };
    demo.sheets.set('kara', sheet);
    demo.characters.set('kara', deriveCharacter(sheet, characterContentFor(demo.project), demo.project.abilities).character);
    refreshWorld(demo);
    syncPools(demo);
  };

  it('asks before it spends the Hope, and spends it only when the answer is yes', () => {
    // "When you deal damage to an adversary, you can spend 2 Hope to clear a
    // Hit Point on an ally within Close range."
    const demo = holding([], 'healing-yes');
    carry(demo, HEALING_STRIKE);
    holdingAgain(demo);
    const foe = foeOf(demo);
    const mira = demo.state.entity('mira')!;
    mira.hitPoints = { max: mira.hitPoints.max, marked: 2 };
    standBehind(demo, 'mira', demo.state.entity(foe)!.tile);
    const kara = demo.state.entity('kara')!;
    kara.hope = { max: 6, value: 6 };

    for (let i = 0; i < 20 && demo.pending === null; i++) {
      if (!demo.encounter!.canAct('kara')) endTurn(demo);
      while (asked(demo) === 'defense') answerPending(demo, { kind: 'choose', index: 0 });
      demo.state.entity(foe)!.hitPoints = { max: 40, marked: 0 };
      attackWithSelected(demo, foe);
    }
    const waiting = demo.pending;
    expect(waiting?.kind).toBe('reaction');
    if (waiting?.kind !== 'reaction') throw new Error('nothing was offered');
    expect(waiting.offers.map((o) => o.ability.id)).toEqual(['fixture-healing-strike']);
    // Nothing has been spent while the question stands.
    expect(demo.state.entity('kara')!.hope!.value).toBe(6);

    answerPending(demo, { kind: 'choose', index: 1 });
    expect(demo.state.entity('kara')!.hope!.value).toBe(4);
    expect(demo.state.entity('mira')!.hitPoints.marked).toBe(1);
    expect(demo.pending).toBeNull();
  });

  it('lets it pass without spending anything', () => {
    const demo = holding([], 'healing-no');
    carry(demo, HEALING_STRIKE);
    holdingAgain(demo);
    const foe = foeOf(demo);
    const mira = demo.state.entity('mira')!;
    mira.hitPoints = { max: mira.hitPoints.max, marked: 2 };
    standBehind(demo, 'mira', demo.state.entity(foe)!.tile);
    demo.state.entity('kara')!.hope = { max: 6, value: 6 };

    for (let i = 0; i < 20 && demo.pending === null; i++) {
      if (!demo.encounter!.canAct('kara')) endTurn(demo);
      while (asked(demo) === 'defense') answerPending(demo, { kind: 'choose', index: 0 });
      demo.state.entity(foe)!.hitPoints = { max: 40, marked: 0 };
      attackWithSelected(demo, foe);
    }
    expect(demo.pending?.kind).toBe('reaction');
    answerPending(demo, { kind: 'choose', index: 0 });
    expect(demo.state.entity('kara')!.hope!.value).toBe(6);
    expect(demo.state.entity('mira')!.hitPoints.marked).toBe(2);
    expect(demo.pending).toBeNull();
  });

  it('never offers a card the table is not being asked about', () => {
    // The demo deciding for the party: an optional card is not played, because
    // spending somebody's Hope for them is worse than letting the moment pass.
    const demo = holding([], 'healing-quiet');
    carry(demo, HEALING_STRIKE);
    holdingAgain(demo);
    demo.askDefender = false;
    const foe = foeOf(demo);
    const mira = demo.state.entity('mira')!;
    mira.hitPoints = { max: mira.hitPoints.max, marked: 2 };
    demo.state.entity('kara')!.hope = { max: 6, value: 6 };
    for (let i = 0; i < 6; i++) {
      if (!demo.encounter!.canAct('kara')) endTurn(demo);
      demo.state.entity(foe)!.hitPoints = { max: 40, marked: 0 };
      attackWithSelected(demo, foe);
    }
    expect(demo.pending?.kind).not.toBe('reaction');
    expect(demo.state.entity('kara')!.hope!.value).toBe(6);
    expect(demo.state.entity('mira')!.hitPoints.marked).toBe(2);
  });

  it('clears the Stress on its own, because nothing about it is a decision', () => {
    // "Gain a bonus to your Severe threshold equal to your Proficiency. When
    // you mark 1 or more Hit Points from an attack, clear a Stress."
    const demo = holding([], 'rise-up');
    carry(demo, RISE_UP);
    holdingAgain(demo, ['fixture-card-5']);
    demo.askDefender = false;
    const kara = demo.state.entity('kara')!;
    kara.stress = { max: kara.stress.max, marked: 2 };
    kara.armorSlots = { max: kara.armorSlots.max, marked: kara.armorSlots.max };

    demo.scenario.actorId = 'mira';
    runScript([{ kind: 'damage', dice: '12 phy', target: { kind: 'entity', id: 'kara' } }], demo.world, demo.rng);
    expect(kara.hitPoints.marked).toBeGreaterThan(0);
    settleFight(demo);

    expect(kara.stress.marked).toBe(1);
    expect(demo.pending).toBeNull();
  });

  it('answers a wound in the middle of the GM turn without taking the turn over', () => {
    // The free half of Rise Up runs inside the GM's own swing, which is a
    // place a script must not restart the turn it is standing in: the GM has
    // adversaries left to spotlight, and they are the caller's to play.
    const demo = holding([], 'rise-up-mid-turn');
    carry(demo, RISE_UP);
    holdingAgain(demo, ['fixture-card-5']);
    demo.askDefender = false;
    const kara = demo.state.entity('kara')!;
    kara.hitPoints = { max: 40, marked: 0 };

    for (let turn = 0; turn < 12 && kara.stress.marked === 0; turn++) {
      kara.stress = { max: kara.stress.max, marked: 2 };
      kara.armorSlots = { max: kara.armorSlots.max, marked: kara.armorSlots.max };
      const before = kara.hitPoints.marked;
      endTurn(demo);
      if (kara.hitPoints.marked === before) continue;

      // The Stress it clears is the card doing its work.
      expect(kara.stress.marked).toBe(1);
      // And the turn it did it in is over exactly once: the spotlight is back
      // with the party, with nothing half-played behind it.
      expect(demo.gmTurn).toBeNull();
      expect(demo.encounter!.view().side).toBe('party');
      return;
    }
    throw new Error('the husk never marked a Hit Point on Kara');
  });

  it('reads the Severe threshold the card raises', () => {
    // The same sheet twice, the second holding the card: the only difference
    // between them is "a bonus to your Severe threshold equal to your
    // Proficiency".
    const demo = scene('sheet');
    carry(demo, RISE_UP);
    const cards = demo.project.abilities;
    const sheet = { ...demo.sheets.get('kara')!, domainCards: [], loadout: [] };
    const plain = deriveCharacter(sheet, characterContentFor(demo.project), cards).character;
    const risen = deriveCharacter(
      { ...sheet, domainCards: ['fixture-card-5'], loadout: ['fixture-card-5'] },
      characterContentFor(demo.project),
      cards,
    ).character;
    expect(risen.proficiency).toBeGreaterThan(0);
    expect(risen.thresholds.severe).toBe(plain.thresholds.severe + risen.proficiency);
    expect(risen.thresholds.major).toBe(plain.thresholds.major);
  });
});

describe('a bonus the card counts out for itself', () => {
  /**
   * Three abilities on one card, and one string tying them together: the token
   * store is named by the ability that owns it, so what places the tokens, what
   * reads them and what clears them all name the same id.
   *
   * `perToken` is never folded into a derived character — tokens are scene
   * state, not sheet state — so the bonus is read where it is used and reads
   * zero the moment the card is empty.
   */
  const FEROCITY = [
    {
      id: 'fixture-ferocity',
      name: 'Ferocity',
      source: { kind: 'domainCard', card: 'fixture-card-5' },
      text: 'Having hurt something badly, its holder may spend to become harder to catch.',
      kind: 'reaction',
      trigger: 'dealtDamage',
      cost: { hope: 2 },
      action: false,
      effects: [
        { kind: 'log', text: 'The blow leaves them somewhere else entirely.', tone: 'hope' },
        { kind: 'addToken', ability: 'fixture-ferocity', amount: 'hitPointsDealt' },
      ],
    },
    {
      id: 'fixture-ferocity-evasion',
      name: 'Ferocity',
      source: { kind: 'domainCard', card: 'fixture-card-5' },
      text: 'Harder to catch, by as much as the last blow was worth.',
      kind: 'passive',
      action: false,
      modifiers: [{ stat: 'evasion', bonus: 1, perToken: 'fixture-ferocity' }],
    },
    {
      id: 'fixture-ferocity-spent',
      name: 'Ferocity',
      source: { kind: 'domainCard', card: 'fixture-card-5' },
      text: 'It lasts until the next blow aimed their way is over, landed or not.',
      kind: 'reaction',
      trigger: 'attacked',
      action: false,
      effects: [{ kind: 'spendToken', ability: 'fixture-ferocity', all: true }],
    },
  ];

  /** The same three shapes on the other side: wounded, then paid out in damage. */
  const NEVER_UPSTAGED = [
    {
      id: 'fixture-never-upstaged',
      name: 'Never Upstaged',
      source: { kind: 'domainCard', card: 'fixture-card-4' },
      text: 'Wounded, its holder may spend to remember it for the next swing.',
      kind: 'reaction',
      trigger: 'tookHitPoints',
      cost: { stress: 1 },
      action: false,
      effects: [
        { kind: 'log', text: 'They will hear about this one.', tone: 'hope' },
        { kind: 'addToken', ability: 'fixture-never-upstaged', amount: 'hitPointsTaken' },
      ],
    },
    {
      id: 'fixture-never-upstaged-damage',
      name: 'Never Upstaged',
      source: { kind: 'domainCard', card: 'fixture-card-4' },
      text: 'Five more behind the blow for every one of them it remembers.',
      kind: 'passive',
      action: false,
      modifiers: [{ stat: 'damageRoll', bonus: 5, perToken: 'fixture-never-upstaged' }],
    },
    {
      id: 'fixture-never-upstaged-spent',
      name: 'Never Upstaged',
      source: { kind: 'domainCard', card: 'fixture-card-4' },
      text: 'Spent by the swing that finally lands.',
      kind: 'reaction',
      trigger: 'dealtHit',
      action: false,
      effects: [{ kind: 'spendToken', ability: 'fixture-never-upstaged', all: true }],
    },
  ];

  /**
   * Kara holding a card, in a fight, the party asked rather than decided for.
   * The card and its abilities are the project's, carried before the sheet is
   * derived over them.
   */
  const holding = (
    abilities: readonly Record<string, unknown>[],
    card: string,
    seed: string,
  ): DemoScene => {
    const demo = standoff(seed);
    demo.askDefender = true;
    demo.project.domainCards.push(...FIXTURE_CARDS);
    for (const ability of abilities) demo.project.abilities.push(abilitySchema.parse(ability));
    const sheet = demo.sheets.get('kara')!;
    const grown = { ...sheet, domainCards: [card], loadout: [card] };
    demo.sheets.set('kara', grown);
    demo.characters.set('kara', deriveCharacter(grown, characterContentFor(demo.project), demo.project.abilities).character);
    refreshWorld(demo);
    syncPools(demo);
    return demo;
  };

  it('reads the tokens where they are used, and never off the sheet', () => {
    const demo = holding(FEROCITY, 'fixture-card-5', 'ferocity-evasion');
    const derived = demo.characters.get('kara')!.evasion;
    expect(demo.world.poolBonus('kara', 'evasion')).toBe(0);

    demo.world.addTokens('kara', 'fixture-ferocity', 3);
    // "Increase your Evasion by the number of Hit Points they marked."
    expect(demo.world.poolBonus('kara', 'evasion')).toBe(3);
    // The sheet is where the fight is not: a token is scene state, and a
    // character derived again finds the same Evasion it always had.
    expect(deriveCharacter(demo.sheets.get('kara')!, characterContentFor(demo.project), demo.project.abilities).character.evasion).toBe(derived);
  });

  it('places a token for each Hit Point the blow marked, and none for a blow that marked nothing', () => {
    const demo = holding(NEVER_UPSTAGED, 'fixture-card-4', 'upstaged-tokens');
    const kara = demo.state.entity('kara')!;
    kara.hitPoints = { max: 40, marked: 0 };

    demo.world.noteDamage('kara', { attacker: 'husk', hitPoints: 3, damage: 14, types: ['physical'] });
    settleFight(demo);
    // "You can mark a Stress to place a number of tokens equal to the number
    // of Hit Points you marked on this card": the Stress is a price, so it is
    // asked about first.
    expect(asked(demo)).toBe('reaction');
    answerPending(demo, { kind: 'choose', index: 1 });
    expect(demo.world.tokensOn('kara', 'fixture-never-upstaged')).toBe(3);
    expect(kara.stress.marked).toBeGreaterThan(0);
  });

  it('adds five to the damage for each token, then clears the card', () => {
    const demo = holding(NEVER_UPSTAGED, 'fixture-card-4', 'upstaged-damage');
    demo.askDefender = false;
    const foe = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    foe.hitPoints = { max: 60, marked: 0 };
    demo.world.addTokens('kara', 'fixture-never-upstaged', 2);
    expect(demo.world.rollBonus('kara', 'damageRoll', { melee: true })).toBe(10);

    for (let i = 0; i < 20; i++) {
      if (!demo.encounter!.canAct('kara')) endTurn(demo);
      if (demo.state.entity(foe.id)?.alive !== true) break;
      const result = attackWithSelected(demo, foe.id);
      if (result?.hit === true) break;
    }
    // "On your next successful attack… then clear all tokens."
    expect(demo.log.some((l) => /Kara (hits|lands a critical)/.test(l.text))).toBe(true);
    expect(demo.world.tokensOn('kara', 'fixture-never-upstaged')).toBe(0);
    // And with the card empty the bonus is gone with it.
    expect(demo.world.rollBonus('kara', 'damageRoll', { melee: true })).toBe(0);
  });

  it('places a token for each Hit Point the swing marked, once the Hope is spent', () => {
    // "When you cause an adversary to mark 1 or more Hit Points, you can spend
    // 2 Hope to increase your Evasion by the number of Hit Points they marked."
    const demo = holding(FEROCITY, 'fixture-card-5', 'ferocity-placed');
    const foe = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    demo.state.entity('kara')!.hope = { max: 6, value: 6 };

    let marked = 0;
    for (let i = 0; i < 20 && asked(demo) !== 'reaction'; i++) {
      if (!demo.encounter!.canAct('kara')) endTurn(demo);
      while (asked(demo) === 'defense') answerPending(demo, { kind: 'choose', index: 0 });
      demo.state.entity(foe.id)!.hitPoints = { max: 60, marked: 0 };
      const result = attackWithSelected(demo, foe.id);
      if (result !== null && result.hitPointsMarked > 0) marked = result.hitPointsMarked;
    }
    expect(asked(demo)).toBe('reaction');
    expect(marked).toBeGreaterThan(0);

    answerPending(demo, { kind: 'choose', index: 1 });
    expect(demo.world.tokensOn('kara', 'fixture-ferocity')).toBe(marked);
    expect(demo.state.entity('kara')!.hope!.value).toBe(4);
    // Which is the Evasion the card promised, for as long as it lasts.
    expect(demo.world.poolBonus('kara', 'evasion')).toBe(marked);
  });

  it('spends the Ferocity the moment the next attack is over, hit or miss', () => {
    const demo = holding(FEROCITY, 'fixture-card-5', 'ferocity-spent');
    demo.askDefender = false;
    const kara = demo.state.entity('kara')!;
    kara.hitPoints = { max: 40, marked: 0 };
    demo.world.addTokens('kara', 'fixture-ferocity', 2);
    expect(demo.world.poolBonus('kara', 'evasion')).toBe(2);

    for (let i = 0; i < 12 && demo.world.tokensOn('kara', 'fixture-ferocity') > 0; i++) {
      kara.armorSlots = { max: kara.armorSlots.max, marked: kara.armorSlots.max };
      endTurn(demo);
    }
    // "This bonus lasts until after the next attack made against you."
    expect(demo.world.tokensOn('kara', 'fixture-ferocity')).toBe(0);
    expect(demo.world.poolBonus('kara', 'evasion')).toBe(0);
  });
});

/**
 * "They deal Severe damage instead of their standard damage": a blow that
 * names the band it lands in rather than rolling for one. Kara's thresholds
 * are pushed out of reach in both tests, so anything the dice could roll is
 * Minor - and what lands is whatever named the band, not what was rolled.
 */
describe('a blow that names its band', () => {
  const outOfReach = (demo: DemoScene): void => {
    const kara = demo.characters.get('kara')!;
    demo.characters.set('kara', { ...kara, thresholds: { major: 900, severe: 1000 } });
    refreshWorld(demo);
    // And no Armor Slots left to spend: armor steps a named band down the way
    // it steps down a rolled one, and this is about what the band itself does.
    const entity = demo.state.entity('kara')!;
    entity.armorSlots = { ...entity.armorSlots, marked: entity.armorSlots.max };
  };

  /** The husk beside Kara with one feature of its own, and Fear to spend. */
  const husking = (seed: string, ability: Record<string, unknown>): DemoScene => {
    const demo = standoff(seed);
    demo.askDefender = false;
    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    standBehind(demo, 'finn', husk.tile);
    demo.project.abilities = demo.project.abilities.filter((a) => a.source.kind !== 'adversary');
    demo.project.abilities.push(
      abilitySchema.parse({ ...ability, source: { kind: 'adversary', adversaries: [adversaryDefOf(demo, husk.id)!.id] } }),
    );
    refreshWorld(demo);
    outOfReach(demo);
    demo.state.fear = { ...demo.state.fear, value: demo.state.fear.max };
    return demo;
  };

  /**
   * Turns until the husk's claws land on Kara, and what that blow cost her,
   * read off the line the log wrote for it. The first one is the one read: the
   * Burrower swings more than once a turn, and a blow is what is under test.
   */
  const clawed = (demo: DemoScene): number | null => {
    for (let i = 0; i < 8 && demo.encounter?.outcome === 'ongoing'; i++) {
      endTurn(demo);
      for (const line of demo.log) {
        if (line.text.includes('Claws hits Kara, and is turned aside')) return 0;
        const landed = /Claws (?:hits|tears into) Kara: (\d+) Hit/.exec(line.text);
        if (landed !== null) return Number(landed[1]);
      }
    }
    return null;
  };

  const subtleBlade = {
    id: 'the-subtle-blade',
    name: 'The Subtle Blade',
    text: 'Spend a Fear to deal Severe damage instead of their standard damage.',
    kind: 'reaction',
    trigger: 'rollingDamage',
    action: false,
    cost: { fear: 1 },
    // The card reads Vulnerable; the mark here is one nothing else in this
    // fight applies, so the run without it is a control rather than a race
    // against the Burrower knocking somebody over.
    available: { kind: 'hasCondition', condition: 'guilty', of: { kind: 'target' } },
    effects: [{ kind: 'forceSeverity', severity: 'severe' }],
  };

  it('names the band mid-swing, and the thresholds have nothing to say about it', () => {
    const demo = husking('subtle', subtleBlade);
    demo.state.entity('kara')!.conditions.add('guilty');
    const marked = clawed(demo);
    expect(marked).not.toBeNull();
    // Severe is three Hit Points; an Armor Slot steps it down to two, which is
    // the one thing armor can still do about a blow that was not rolled for.
    expect(marked!).toBeGreaterThanOrEqual(2);
    expect(demo.log.some((l) => l.text.includes('lands as severe damage'))).toBe(true);

    // Nobody Vulnerable, nothing named: the same claws, off the same seed, are
    // as far beneath her thresholds as they always were.
    const plain = husking('subtle', subtleBlade);
    const ordinary = clawed(plain);
    expect(ordinary).not.toBeNull();
    expect(ordinary!).toBeLessThanOrEqual(1);
  });

  it('reads a band off the block itself, for the target it was named against', () => {
    // Judgment's other half: a passive on the stat block rather than a
    // reaction, gated on the mark the action left.
    const judgment = {
      id: 'judgment-strike',
      name: 'Judgment',
      text: 'When the Seraph succeeds on a standard attack against a Guilty target, they deal Severe damage instead.',
      kind: 'passive',
      action: false,
      standardAttack: {
        severity: 'severe',
        when: { kind: 'hasCondition', condition: 'guilty', of: { kind: 'target' } },
      },
    };
    const demo = husking('judged', judgment);
    demo.state.entity('kara')!.conditions.add('guilty');
    const marked = clawed(demo);
    expect(marked).not.toBeNull();
    expect(marked!).toBeGreaterThanOrEqual(2);

    const plain = husking('judged', judgment);
    const ordinary = clawed(plain);
    expect(ordinary).not.toBeNull();
    expect(ordinary!).toBeLessThanOrEqual(1);
  });
});

/**
 * A card that answers a swing that went wide. The one who missed is bound as
 * the target, which is both how the card measures the distance to them and
 * what it hits back at.
 */
describe('answering a miss', () => {
  it('hits back at whatever swung and missed from within reach', () => {
    const demo = standoff('riposte');
    const sheet = { ...demo.sheets.get('kara')!, domainCards: ['rapid-riposte'], loadout: ['rapid-riposte'] };
    demo.sheets.set('kara', sheet);
    demo.characters.set('kara', deriveCharacter(sheet, characterContentFor(demo.project), demo.project.abilities).character);
    refreshWorld(demo);

    // A second card of Kara's, gated on a mark the attacker does not carry.
    // She does carry it, so a card offered on a self-binding would be offered
    // here - which is the thing being ruled out.
    demo.project.abilities.push(
      abilitySchema.parse({
        id: 'grudge',
        name: 'Grudge',
        source: { kind: 'granted', characters: ['kara'] },
        kind: 'reaction',
        trigger: 'attackMissed',
        action: false,
        auto: false,
        target: { kind: 'none' },
        available: { kind: 'hasCondition', condition: 'guilty', of: { kind: 'target' } },
        effects: [{ kind: 'gainHope', amount: 1, target: { kind: 'actor' } }],
      }),
    );
    refreshWorld(demo);
    demo.state.entity('kara')!.conditions.add('guilty');

    const asked = untilChoice(demo, 'react');
    expect(asked).not.toBeNull();
    const index = asked!.choices.findIndex((c) => c.kind === 'react');
    expect(asked!.choices[index]!.label).toContain('Rapid Riposte');
    expect(asked!.choices.some((c) => c.label.includes('Grudge'))).toBe(false);

    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    const before = husk.hitPoints.marked;
    const stress = demo.state.entity('kara')!.stress.marked;
    answerPending(demo, { kind: 'choose', index });
    expect(husk.hitPoints.marked).toBeGreaterThan(before);
    expect(demo.state.entity('kara')!.stress.marked).toBe(stress + 1);
  });
});

/** Dice that always come up six: what Redirect is asking about, answered yes. */
function scriptedSixes(): Rng {
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
}

/**
 * The defence step answers a blow with shapes — dice off the total, a slot
 * marked, the severity stepped. These two answer it with a script, which is
 * offered without a number because what it is worth is not known until it has
 * been played.
 */
describe('a card that answers the blow in its own words', () => {
  /**
   * Six cards, one at a time. Each test carries its own family and holds the
   * same card, so no two of them are ever in the project together.
   *
   * What these answer a blow *with* is a script rather than a number, which is
   * why they reach the defence step through a choice: dice off the total, the
   * blow avoided outright, the severity stepped, the Difficulty raised after
   * the fact. The engine writes the lines for all of those, so most of what is
   * asserted below is its wording and not the card's.
   */
  const ANSWER_CARD = 'fixture-card-14';

  /** Tokens placed once, then spent a handful at a time off an arriving blow. */
  const THORNS = [
    {
      id: 'fixture-thorns',
      name: 'Barbed Skin',
      source: { kind: 'domainCard', card: ANSWER_CARD },
      text: 'Thorns come up through the skin, and wait there.',
      cost: { hope: 1 },
      uses: { count: 1, per: 'rest' },
      target: { kind: 'self' },
      action: false,
      effects: [
        { kind: 'log', text: 'Thorns come up through the skin.', tone: 'hope' },
        { kind: 'addToken', ability: 'fixture-thorns', amount: { trait: 'spellcast' } },
      ],
    },
    {
      id: 'fixture-thorns-turn',
      name: 'Barbed Skin',
      source: { kind: 'domainCard', card: ANSWER_CARD },
      text: 'However many break off in the blow come back out of whoever threw it.',
      kind: 'reaction',
      trigger: 'incomingDamage',
      action: false,
      auto: false,
      available: { kind: 'tokens', ability: 'fixture-thorns', op: '>=', value: 1 },
      target: { kind: 'none' },
      effects: [
        {
          kind: 'howMany',
          most: { tokens: 'fixture-thorns' },
          title: 'Barbed Skin',
          body: 'How many thorns break off in it?',
          each: [
            { kind: 'spendToken', ability: 'fixture-thorns', amount: 'spent' },
            { kind: 'softenBlow', dice: '{n}d6' },
            {
              kind: 'branch',
              when: { kind: 'withinRange', range: 'melee', of: { kind: 'target' } },
              then: [{ kind: 'damage', dice: 'same', target: { kind: 'target' } }],
            },
          ],
        },
      ],
    },
  ];

  /** Hope into a handful of dice, and a six sends the blow home instead. */
  const MIRROR = [
    {
      id: 'fixture-mirror',
      name: 'Mirror Shell',
      source: { kind: 'domainCard', card: ANSWER_CARD },
      text: 'Spend what you like on it; a six sends the blow back where it came from.',
      kind: 'reaction',
      trigger: 'incomingDamage',
      action: false,
      auto: false,
      available: { kind: 'pool', pool: 'hope', measure: 'available', op: '>=', value: 1 },
      target: { kind: 'none' },
      effects: [
        {
          kind: 'howMany',
          most: { pool: 'hope', measure: 'available' },
          title: 'Mirror Shell',
          body: 'How much of it goes into the mirror?',
          each: [
            { kind: 'spendHope', amount: 'spent' },
            {
              kind: 'diceCheck',
              dice: '1d6',
              times: 'spent',
              atLeast: 6,
              then: [
                { kind: 'log', text: 'The blow turns in the air and goes home.', tone: 'hope' },
                { kind: 'avoidBlow' },
                { kind: 'damage', dice: 'same', target: { kind: 'target' } },
              ],
              otherwise: [{ kind: 'log', text: 'The mirror holds nothing.', tone: 'system' }],
            },
          ],
        },
      ],
    },
  ];

  /**
   * A shot that went wide, caught and sent on with the shooter's own dice.
   * `theirs` is the point: what lands on the next creature is the attacker's
   * damage, not anything its holder could have rolled.
   */
  const SEND_ON = [
    {
      id: 'fixture-send-on',
      name: 'Send It On',
      source: { kind: 'domainCard', card: ANSWER_CARD },
      text: 'A shot from off at a distance can be caught and given to somebody else.',
      kind: 'reaction',
      trigger: 'attackMissed',
      action: false,
      auto: false,
      cost: { stress: 1 },
      target: { kind: 'none' },
      inCombatOnly: true,
      available: { kind: 'not', of: { kind: 'withinRange', range: 'melee', of: { kind: 'target' } } },
      effects: [
        {
          kind: 'diceCheck',
          dice: '1d6',
          times: { trait: 'proficiency' },
          atLeast: 6,
          then: [
            { kind: 'log', text: 'The shot is caught and sent somewhere else.', tone: 'hope' },
            { kind: 'damage', dice: 'theirs', target: { kind: 'adversaries', range: 'veryClose', nearest: 1 } },
          ],
          otherwise: [{ kind: 'log', text: 'Nothing about it can be caught.', tone: 'system' }],
        },
      ],
    },
  ];

  /** A handful of dice against the blow's severity rather than its total. */
  const PLATE = [
    {
      id: 'fixture-plate',
      name: 'Plate That Holds',
      source: { kind: 'domainCard', card: ANSWER_CARD },
      text: 'Sometimes the plate holds a blow it had no right to.',
      kind: 'reaction',
      trigger: 'incomingDamage',
      action: false,
      auto: false,
      target: { kind: 'none' },
      effects: [
        {
          kind: 'diceCheck',
          dice: '1d6',
          times: { trait: 'proficiency' },
          atLeast: 6,
          then: [
            { kind: 'log', text: 'The plate holds where it had no right to.', tone: 'hope' },
            { kind: 'stepSeverity', steps: 1 },
          ],
          otherwise: [{ kind: 'log', text: 'The plate gives.', tone: 'system' }],
        },
      ],
    },
  ];

  /** The Difficulty raised after the swing was already rolled. */
  const FORESEE = [
    {
      id: 'fixture-foresee',
      name: 'Saw It Coming',
      source: { kind: 'domainCard', card: ANSWER_CARD },
      text: 'A blow thrown from off at a distance can be read before it arrives.',
      kind: 'reaction',
      trigger: 'incomingDamage',
      action: false,
      auto: false,
      cost: { stress: 1 },
      target: { kind: 'none' },
      available: { kind: 'not', of: { kind: 'withinRange', range: 'melee', of: { kind: 'target' } } },
      effects: [{ kind: 'dodgeBy', dice: '1d4' }],
    },
  ];

  /** Not there when it lands, and somewhere else afterwards. */
  const NOT_THERE = [
    {
      id: 'fixture-not-there',
      name: 'Not There',
      source: { kind: 'domainCard', card: ANSWER_CARD },
      text: 'The blow closes on ground its holder is no longer standing on.',
      kind: 'reaction',
      trigger: 'incomingDamage',
      action: false,
      auto: false,
      uses: { count: 1, per: 'rest' },
      available: { kind: 'withinRange', range: 'melee', of: { kind: 'target' } },
      target: { kind: 'none' },
      effects: [
        { kind: 'log', text: 'The blow closes on empty ground.', tone: 'hope' },
        { kind: 'avoidBlow' },
        { kind: 'move', how: 'away', of: { kind: 'target' }, budget: 'close' },
      ],
    },
  ];

  const holding = (demo: DemoScene, family: readonly Record<string, unknown>[]): void => {
    demo.project.domainCards.push(...FIXTURE_CARDS);
    for (const ability of family) demo.project.abilities.push(abilitySchema.parse(ability));
    const sheet = { ...demo.sheets.get('kara')!, domainCards: [ANSWER_CARD], loadout: [ANSWER_CARD] };
    demo.sheets.set('kara', sheet);
    demo.characters.set('kara', deriveCharacter(sheet, characterContentFor(demo.project), demo.project.abilities).character);
    refreshWorld(demo);
  };

  it('takes dice off the blow and puts them back into whoever swung', () => {
    const demo = standoff('thorns');
    holding(demo, THORNS);
    demo.world.addTokens('kara', 'fixture-thorns', 3);
    const asked = untilChoice(demo, 'script');
    expect(asked).not.toBeNull();
    const index = asked!.choices.findIndex((c) => c.kind === 'script');
    expect(asked!.choices[index]!.label).toContain('Barbed Skin');

    // The same blow, taken plainly, off the same seed.
    const cold = standoff('thorns');
    holding(cold, THORNS);
    cold.world.addTokens('kara', 'fixture-thorns', 3);
    untilChoice(cold, 'script');
    answerPending(cold, { kind: 'choose', index: 0 });
    const plain = cold.state.entity('kara')!.hitPoints.marked;

    // Three thorns: dice off the blow, and the same number back into the one
    // standing over her.
    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    answerPending(demo, { kind: 'choose', index });
    expect(demo.pending?.kind).toBe('script');
    answerPending(demo, { kind: 'choose', index: 2 });
    while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });

    expect(demo.world.tokensOn('kara', 'fixture-thorns')).toBe(0);
    expect(demo.log.some((l) => l.text.includes('turns aside'))).toBe(true);
    expect(husk.hitPoints.marked).toBeGreaterThan(0);
    expect(demo.state.entity('kara')!.hitPoints.marked).toBeLessThan(plain);
  });

  it('sends the blow back at whoever cast it when the dice come up', () => {
    // "Spend any number of Hope to roll that many d6s. If any roll a 6, the
    // attack is reflected back, dealing the damage to them instead."
    for (let seed = 1; seed < 20; seed++) {
      const demo = standoff(`mirror-${seed}`);
      holding(demo, MIRROR);
      const asked = untilChoice(demo, 'script');
      if (asked === null) continue;
      const index = asked.choices.findIndex((c) => c.kind === 'script');
      expect(asked.choices[index]!.label).toContain('Mirror Shell');

      const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
      const before = husk.hitPoints.marked;
      const said = demo.log.length;
      answerPending(demo, { kind: 'choose', index });
      // Every Hope she has goes into it; the prompt lists one option per Hope.
      const prompt = demo.pending?.prompt;
      const most = prompt?.kind === 'choice' ? prompt.options.length - 1 : 0;
      answerPending(demo, { kind: 'choose', index: most });
      while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });

      const after = demo.log.slice(said).map((l) => l.text);
      if (!after.some((t) => t.includes('turns in the air and goes home'))) continue;
      // The blow found nobody, and the Burrower took it instead.
      expect(after.some((t) => t.includes('finds nothing where Kara was'))).toBe(true);
      expect(husk.hitPoints.marked).toBeGreaterThan(before);
      expect(demo.state.entity('kara')!.hitPoints.marked).toBe(0);
      return;
    }
    throw new Error('no seed reflected a blow in twenty tries');
  });

  it('turns a shot that went wide onto somebody else, with the shooter\'s own dice', () => {
    // Redirect reads how far away the one who swung is, so a Burrower standing
    // over her is not something it can answer at all.
    const demo = standoff('redirect');
    holding(demo, SEND_ON);
    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    const bound = { targets: [husk.id], hit: [husk.id] };
    expect(demo.world.reactionsFor('kara', 'attackMissed', bound)).toEqual([]);

    // Stood off from it, the card has something to say. Far enough that the
    // claws are not in reach, near enough that the fight is one room.
    const stand = demo.grid.indexOf(demo.grid.xOf(husk.tile) + 3, demo.grid.yOf(husk.tile));
    demo.state.moveEntity('kara', stand);
    expect(demo.world.reactionsFor('kara', 'attackMissed', bound).map((a) => a.id)).toEqual(['fixture-send-on']);

    // And what it says is the Burrower's own claws, in the nearest of them.
    const other = demo.state.entitiesOf('adversary').find((e) => e.id !== husk.id)!;
    other.alive = true;
    other.hitPoints = { max: 12, marked: 0 };
    demo.state.moveEntity(other.id, demo.grid.indexOf(demo.grid.xOf(stand) + 1, demo.grid.yOf(stand)));
    const card = demo.world.reactionsFor('kara', 'attackMissed', bound)[0]!;
    const was = demo.scenario.actorId;
    demo.scenario.actorId = 'kara';
    const journal = runScript(card.effects, demo.world, scriptedSixes(), { targets: [husk.id], hit: [husk.id] });
    demo.scenario.actorId = was;
    expect(journal.some((e) => e.kind === 'diceChecked' && e.passed)).toBe(true);
    expect(other.hitPoints.marked).toBeGreaterThan(0);
    // The dice are the Burrower's, not Kara's: it is their attack, turned.
    const dealt = journal.find((e) => e.kind === 'damage');
    const claws = adversaryDefOf(demo, husk.id)!.attackDamage;
    expect(dealt?.kind === 'damage' ? dealt.dice : '').toBe(formatDice(claws));
    // Every die came up its best, so the blow is the most those dice can do -
    // which is not a number Kara's own weapon could have rolled.
    expect(dealt?.kind === 'damage' ? dealt.amount : 0).toBe(claws.count * claws.sides + claws.modifier);
  });

  it('rides the blow down a band when the plate holds', () => {
    // "Roll a number of d6s equal to your Proficiency. If any roll a 6, reduce
    // the severity by one threshold without marking an Armor Slot."
    for (let seed = 1; seed < 30; seed++) {
      const demo = standoff(`plate-${seed}`);
      holding(demo, PLATE);
      const asked = untilChoice(demo, 'script');
      if (asked === null) continue;
      const index = asked.choices.findIndex((c) => c.kind === 'script');
      expect(asked.choices[index]!.label).toContain('Plate That Holds');

      // The same blow taken plainly, off the same seed.
      const cold = standoff(`plate-${seed}`);
      holding(cold, PLATE);
      untilChoice(cold, 'script');
      answerPending(cold, { kind: 'choose', index: 0 });
      const plain = cold.state.entity('kara')!.hitPoints.marked;

      answerPending(demo, { kind: 'choose', index });
      while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
      if (!demo.log.some((l) => l.text.includes('no right to'))) continue;
      expect(demo.state.entity('kara')!.hitPoints.marked).toBeLessThan(plain);
      return;
    }
    throw new Error('no seed rolled a six on the plate in thirty tries');
  });

  it('adds to the Difficulty after the fact, and the blow goes wide', () => {
    // "Mark a Stress to roll a d4 and gain a bonus to your Evasion equal to
    // the result against the attack": the swing has been rolled, so what is
    // measured again is the d20 that made it.
    for (let seed = 1; seed < 40; seed++) {
      const demo = standoff(`seen-${seed}`);
      holding(demo, FORESEE);
      // The card answers a blow thrown from beyond Melee, so what throws it has
      // to be something that shoots rather than something that closes: a melee
      // creature walks in first and the card stops applying before the blow
      // lands. The archer reaches Far and stays where it is.
      const knight = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
      demo.project.adversaries.push(...FIXTURE_ADVERSARIES);
      // What a creature is comes from the placement, so the archer is stood up
      // rather than written over the one already there, and the melee one goes
      // down the way `standoff` puts the rest of the room down.
      const archer = demo.state.addEntity(
        createAdversaryEntity('archer', 'fixture-archer', knight.tile, { hitPoints: 40, stress: 3 }),
      );
      demo.state.removeEntity(knight.id);
      refreshWorld(demo);
      demo.state.moveEntity('kara', demo.grid.indexOf(demo.grid.xOf(archer.tile) + 2, demo.grid.yOf(archer.tile)));
      const asked = untilChoice(demo, 'script');
      if (asked === null) continue;
      const index = asked.choices.findIndex((c) => c.kind === 'script');
      expect(asked.choices[index]!.label).toContain('Saw It Coming');

      const said = demo.log.length;
      answerPending(demo, { kind: 'choose', index });
      while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
      const after = demo.log.slice(said).map((t) => t.text);
      expect(after.some((t) => t.includes('sees it coming'))).toBe(true);
      if (!after.some((t) => t.includes('misses Kara'))) continue;
      // The d4 was enough: the swing that had landed no longer has.
      expect(after.some((t) => /Loosed Arrow (hits|tears into) Kara/.test(t))).toBe(false);
      expect(demo.state.entity('kara')!.stress.marked).toBeGreaterThanOrEqual(1);
      return;
    }
    throw new Error('no seed put a blow inside a d4 in forty tries');
  });

  it('is not there when the blow arrives, and the swing is spent on nothing', () => {
    const demo = standoff('scramble');
    holding(demo, NOT_THERE);
    const asked = untilChoice(demo, 'script');
    expect(asked).not.toBeNull();
    const index = asked!.choices.findIndex((c) => c.kind === 'script');
    expect(asked!.choices[index]!.label).toContain('Not There');

    const kara = demo.state.entity('kara')!;
    const stood = kara.tile;
    const said = demo.log.length;
    answerPending(demo, { kind: 'choose', index });
    const after = demo.log.slice(said).map((l) => l.text);
    expect(after.some((t) => t.includes('finds nothing where Kara was'))).toBe(true);
    // The blow was not a miss and not a hit: nothing was marked for it, and
    // Kara is no longer standing where it was aimed.
    expect(after.some((t) => /Claws (hits|tears into) Kara/.test(t))).toBe(false);
    expect(kara.tile).not.toBe(stood);
  });
});

/**
 * Cards whose whole point is what they leave behind. Each of them is a
 * condition on somebody, because a condition is where the engine keeps a
 * number that has to outlive the moment it was bought in.
 */
describe('what a card leaves on its holder', () => {
  /**
   * Four cards, and the conditions they leave do most of the work: one that
   * cannot use armour at all, one that physical damage passes through until its
   * bearer swings, one that hands an ally a die, and one that is Vulnerable
   * under another name.
   *
   * The call is the one worth reading twice. Its Stress and its Hope reach
   * everybody within earshot *including* the one who called it; the condition
   * reaches everybody except them. That asymmetry is the card.
   */
  const LEAVES_CARD = 'fixture-card-10';

  const RAGE_CONDITION = {
    id: 'fixture-frenzied',
    name: 'Frenzied',
    text: 'You cannot use Armor Slots, you deal ten more damage, and you are far harder to put down.',
    modifiers: [
      { stat: 'damageRoll', bonus: 10 },
      { stat: 'severeThreshold', bonus: 8 },
    ],
    blocks: ['armor'],
  };

  const THIN_CONDITION = {
    id: 'fixture-spectral',
    name: 'Spectral',
    text: 'You are barely here: physical damage passes through you.',
    defenses: { immunities: ['physical'] },
    endsWhen: 'attacks',
  };

  const CALLED_CONDITION = {
    id: 'fixture-inspired',
    name: 'Inspired',
    text: 'Somebody called out, and you believe them: your attacks have advantage.',
    modifiers: [{ stat: 'advantage', bonus: 1 }],
  };

  const TERROR_CONDITION = {
    id: 'fixture-horrified',
    name: 'Horrified',
    text: 'What you are looking at cannot be looked away from: every roll aimed at you has advantage.',
    modifiers: [{ stat: 'advantage', bonus: 1, against: true, anyRoll: true }],
  };

  const RAGE = [
    {
      id: 'fixture-rage',
      name: 'Frenzy',
      source: { kind: 'domainCard', card: LEAVES_CARD },
      text: 'Let go of the reins for the rest of the fight.',
      uses: { count: 1, per: 'longRest' },
      target: { kind: 'self' },
      inCombatOnly: true,
      effects: [
        { kind: 'log', text: 'Something in them lets go of the reins.', tone: 'hope' },
        { kind: 'applyCondition', condition: 'fixture-frenzied', duration: 'scene', target: { kind: 'actor' } },
      ],
    },
  ];

  const THIN = [
    {
      id: 'fixture-thin',
      name: 'Going Thin',
      source: { kind: 'domainCard', card: LEAVES_CARD },
      text: 'Go thin enough that what is solid passes through, until you swing.',
      cost: { stress: 1 },
      target: { kind: 'self' },
      action: false,
      effects: [
        { kind: 'log', text: 'They go thin, and the dark comes through them.', tone: 'hope' },
        { kind: 'applyCondition', condition: 'fixture-spectral', duration: 'scene', target: { kind: 'actor' } },
      ],
    },
  ];

  const CALL = [
    {
      id: 'fixture-call',
      name: 'Battle Cry',
      source: { kind: 'domainCard', card: LEAVES_CARD },
      text: 'Call the room together: they take heart, and swing the better for it.',
      uses: { count: 1, per: 'longRest' },
      target: { kind: 'none', range: 'far' },
      inCombatOnly: true,
      effects: [
        { kind: 'log', text: 'The call goes up, and the room answers it.', tone: 'hope' },
        { kind: 'clearStress', amount: 1, target: { kind: 'allies', range: 'far', includeSelf: true } },
        { kind: 'gainHope', amount: 1, target: { kind: 'allies', range: 'far', includeSelf: true } },
        // Not the one who called it: the die is for whoever heard them.
        { kind: 'applyCondition', condition: 'fixture-inspired', duration: 'scene', target: { kind: 'allies', range: 'far' } },
      ],
    },
  ];

  const TERROR = [
    {
      id: 'fixture-terror',
      name: 'Night Terror',
      source: { kind: 'domainCard', card: LEAVES_CARD },
      text: 'Stop being a person to look at, and take something off the GM for each one that cannot look away.',
      uses: { count: 1, per: 'longRest' },
      target: { kind: 'none', range: 'veryClose' },
      inCombatOnly: true,
      effects: [
        { kind: 'log', text: 'What they are looking at is no longer a person.', tone: 'hope' },
        {
          kind: 'reactionRoll',
          difficulty: 16,
          trait: 'presence',
          targets: { kind: 'adversaries', range: 'veryClose' },
          onFail: [
            { kind: 'applyCondition', condition: 'fixture-horrified', duration: 'scene', target: { kind: 'hit' } },
            { kind: 'loseFear', amount: 'targetsHit' },
          ],
        },
      ],
    },
  ];

  const carry = (
    demo: DemoScene,
    family: readonly Record<string, unknown>[],
    condition: Record<string, unknown>,
  ): void => {
    demo.project.domainCards.push(...FIXTURE_CARDS);
    demo.project.conditionDefs.push(conditionDefSchema.parse(condition));
    for (const ability of family) demo.project.abilities.push(abilitySchema.parse(ability));
  };

  const holding = (demo: DemoScene, cards: string[]): void => {
    const sheet = { ...demo.sheets.get('kara')!, domainCards: cards, loadout: cards };
    demo.sheets.set('kara', sheet);
    demo.characters.set('kara', deriveCharacter(sheet, characterContentFor(demo.project), demo.project.abilities).character);
    refreshWorld(demo);
  };

  /** A blow big enough that the defence would spend armor on it if it could. */
  const struck = (demo: DemoScene): void => {
    const was = demo.scenario.actorId;
    demo.scenario.actorId = 'mira';
    runScript([{ kind: 'damage', dice: '30 phy', target: { kind: 'entity', id: 'kara' } }], demo.world, demo.rng);
    demo.scenario.actorId = was;
  };

  it('rages: ten more damage, a harder creature to fell, and no armor to hide behind', () => {
    const demo = standoff('frenzy');
    carry(demo, RAGE, RAGE_CONDITION);
    holding(demo, [LEAVES_CARD]);
    const kara = demo.state.entity('kara')!;
    kara.armorSlots = { max: 4, marked: 0 };
    kara.hitPoints = { max: 12, marked: 0 };
    const before = demo.world.defenderOf(kara).thresholds.severe;

    // Without it, the engine spends a slot on a blow like that.
    struck(demo);
    expect(kara.armorSlots.marked).toBeGreaterThan(0);
    kara.armorSlots = { max: 4, marked: 0 };
    kara.hitPoints = { max: 12, marked: 0 };

    expect(useAbility(demo, 'kara', 'fixture-rage', []).status).toBe('done');
    expect(kara.conditions.has('fixture-frenzied')).toBe(true);
    expect(demo.world.rollBonus('kara', 'damageRoll', { melee: true })).toBe(10);
    expect(demo.world.defenderOf(kara).thresholds.severe).toBe(before + 8);

    // The armor is still on her; it is simply not something she will use. Read
    // off her own Armor Score rather than a number written here: what the rage
    // does is make every slot unusable, however many she has.
    const slots = demo.world.armorFor('kara');
    expect(slots.max).toBe(demo.characters.get('kara')!.armorScore);
    expect(slots.marked).toBe(slots.max);
    struck(demo);
    expect(kara.armorSlots.marked).toBe(0);
    expect(kara.hitPoints.marked).toBeGreaterThan(0);
  });

  it('goes spectral until they swing, and physical damage passes through', () => {
    const demo = standoff('specter');
    carry(demo, THIN, THIN_CONDITION);
    holding(demo, [LEAVES_CARD]);
    const kara = demo.state.entity('kara')!;
    kara.hitPoints = { max: 6, marked: 0 };

    expect(useAbility(demo, 'kara', 'fixture-thin', []).status).toBe('done');
    expect(kara.conditions.has('fixture-spectral')).toBe(true);
    expect(kara.stress.marked).toBe(1);

    struck(demo);
    expect(kara.hitPoints.marked).toBe(0);

    // Swinging is the end of it, which is what "until you make an action roll
    // targeting another creature" comes to in a fight.
    demo.world.endsOnAttack('kara');
    expect(kara.conditions.has('fixture-spectral')).toBe(false);
    struck(demo);
    expect(kara.hitPoints.marked).toBeGreaterThan(0);
  });

  it('calls the room together, and the room swings harder for it', () => {
    const demo = standoff('cry');
    carry(demo, CALL, CALLED_CONDITION);
    holding(demo, [LEAVES_CARD]);
    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    const finn = demo.state.entity('finn')!;
    // Within earshot: Kara went to meet the husk, and the rest of the party
    // spawned across the room.
    standBehind(demo, 'finn', husk.tile);
    finn.stress = { max: 6, marked: 2 };
    if (finn.hope !== undefined) finn.hope = { max: 6, value: 0 };
    expect(demo.world.advantageFor('finn', husk.id).advantage).toBe(0);

    expect(useAbility(demo, 'kara', 'fixture-call', []).status).toBe('done');
    expect(finn.stress.marked).toBe(1);
    expect(finn.hope?.value).toBe(1);
    expect(finn.conditions.has('fixture-inspired')).toBe(true);
    expect(demo.world.advantageFor('finn', husk.id).advantage).toBe(1);
    // The one who called it is not the one it inspires.
    expect(demo.state.entity('kara')!.conditions.has('fixture-inspired')).toBe(false);
  });

  it("horrifies what it can, and takes the GM's Fear for each of them", () => {
    for (let seed = 1; seed < 30; seed++) {
      const demo = standoff(`terror-${seed}`);
      carry(demo, TERROR, TERROR_CONDITION);
      holding(demo, [LEAVES_CARD]);
      demo.state.fear = { ...demo.state.fear, value: 4 };
      const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;

      expect(useAbility(demo, 'kara', 'fixture-terror', []).status).toBe('done');
      if (!husk.conditions.has('fixture-horrified')) continue;
      // Vulnerable in all but name: rolls against them have advantage.
      expect(demo.world.advantageFor('kara', husk.id).advantage).toBe(1);
      expect(demo.state.fear.value).toBe(3);
      return;
    }
    throw new Error('nothing failed a Presence Reaction Roll in thirty tries');
  });
});


// ---------------------------------------------------------------------------
// The death move
// ---------------------------------------------------------------------------

/**
 * "When a PC marks their last Hit Point, they must make a death move by
 * choosing one of the following options."
 *
 * The three moves, what each of them costs, and the ordering the whole thing
 * rests on: the question is asked before anybody counts who is left standing,
 * because two of the three put the character back on their feet.
 */
describe('a death move', () => {
  /** Kara alone against however many husks, with a player at the table. */
  const lastStand = (seed: string, foes = 1): DemoScene => {
    const demo = scene(seed);
    demo.askDefender = true;
    const kara = demo.state.entity('kara')!;
    // The rest of the party is off the map and past the veil already, so this
    // is about the one character and nobody else is asked anything.
    for (const member of demo.state.entitiesOf('party')) {
      if (member.id === 'kara') continue;
      demo.state.moveEntity(member.id, NO_TILE);
      member.hitPoints = { ...member.hitPoints, marked: member.hitPoints.max };
      member.alive = false;
      member.dead = true;
    }
    const standing = demo.state
      .entitiesOf('adversary')
      .filter((e) => e.alive)
      .sort((a, b) => demo.grid.manhattanDistance(kara.tile, a.tile) - demo.grid.manhattanDistance(kara.tile, b.tile));
    for (const extra of standing.slice(foes)) {
      extra.hitPoints = { ...extra.hitPoints, marked: extra.hitPoints.max };
      extra.alive = false;
    }
    // Kara beside the nearest of them, so its swing reaches her.
    const blocked = demo.state.blockedFor('kara');
    let stand = NO_TILE;
    demo.grid.forEachNeighbor(standing[0]!.tile, false, (tile) => {
      if (stand === NO_TILE && demo.grid.isPassable(tile) && !blocked(tile)) stand = tile;
    });
    demo.state.moveEntity('kara', stand);
    demo.party.select('kara');
    startEncounter(demo, demo.scene.encounters[0]!.id);
    return demo;
  };

  /** Put her down where the engine would have: her last Hit Point marked. */
  const felled = (demo: DemoScene): void => {
    const kara = demo.state.entity('kara')!;
    kara.hitPoints = { ...kara.hitPoints, marked: kara.hitPoints.max };
    kara.alive = false;
    settleFight(demo);
  };

  /** Choose one of the three, by the label the prompt shows. */
  const choose = (demo: DemoScene, label: string): void => {
    const waiting = demo.pending as PendingDeath;
    const option = waiting.prompt.kind === 'choice' ? waiting.prompt.options.find((o) => o.label === label) : undefined;
    expect(option).toBeDefined();
    answerPending(demo, { kind: 'choose', index: option!.index });
  };

  const said = (demo: DemoScene, text: string): boolean => demo.log.some((line) => line.text.includes(text));

  it('is asked before the encounter counts anybody out, so Risk It All can save the fight', () => {
    // Two husks: without a question to stop it, the GM's turn rolls straight
    // on to the second, and spotlighting it is where the encounter notices
    // that nobody on the party's side is standing.
    for (let seed = 1; seed < 40; seed++) {
      const demo = lastStand(`risk-up-${seed}`, 2);
      demo.state.fear = { ...demo.state.fear, value: 6 };
      const kara = demo.state.entity('kara')!;
      kara.hitPoints = { max: 6, marked: 5 };
      kara.armorSlots = { ...kara.armorSlots, marked: kara.armorSlots.max };

      endTurn(demo);
      // Take every hit as it comes until the fight stops to ask about her.
      let guard = 0;
      while (demo.pending !== null && demo.pending.kind !== 'death' && guard++ < 10) {
        answerPending(demo, { kind: 'choose', index: 0 });
      }
      if (demo.pending?.kind !== 'death') continue;

      // She is down, and the fight has not been called.
      expect(kara.alive).toBe(false);
      expect(demo.encounter!.outcome).toBe('ongoing');
      choose(demo, 'Risk It All');
      if (!said(demo, 'stays on their feet') && !said(demo, 'stands up with nothing marked')) continue;

      expect(kara.alive).toBe(true);
      expect(kara.hitPoints.marked).toBeLessThan(kara.hitPoints.max);
      expect(demo.encounter!.outcome).not.toBe('defeat');
      expect(said(demo, 'The party falls.')).toBe(false);
      return;
    }
    throw new Error('the Hope Die never came up in forty seeds');
  });

  it('drops her unconscious on Avoid Death, and the Hope Die decides the scar', () => {
    // Level 1: a scar needs the Hope Die to read exactly 1.
    for (let seed = 1; seed < 60; seed++) {
      const demo = lastStand(`scar-${seed}`);
      const kara = demo.state.entity('kara')!;
      const sheet = demo.sheets.get('kara')!;
      expect(sheet.level).toBe(1);
      const slots = kara.hope!.max;

      felled(demo);
      expect(demo.pending?.kind).toBe('death');
      choose(demo, 'Avoid Death');
      expect(kara.alive).toBe(false);
      expect(demo.pending).toBe(null);
      if (!said(demo, 'takes a scar')) {
        // The die read above her level: nothing permanent happened.
        expect(kara.hope!.max).toBe(slots);
        expect(demo.characters.get('kara')!.sheet.scars).toBeUndefined();
        continue;
      }
      // "Permanently cross out a Hope slot": on the sheet, so the next scene
      // she walks into starts a Hope short.
      expect(kara.hope!.max).toBe(slots - 1);
      expect(demo.characters.get('kara')!.sheet.scars).toBe(1);
      // On the sheets a save writes, and on the project's own copy of the
      // party: the scar outlives this fight either way it is reloaded.
      expect(demo.sheets.get('kara')!.scars).toBe(1);
      expect(demo.project.party.find((member) => member.id === 'kara')!.scars).toBe(1);
      // And the character was re-derived over it, so a fresh scene is short a
      // Hope without anybody writing the pool by hand.
      expect(demo.characters.get('kara')!.hope.max).toBe(slots - 1);
      expect(deriveCharacter({ ...sheet, scars: 1 }, characterContentFor(demo.project), demo.project.abilities).character.hope.max).toBe(slots - 1);

      // "They return to consciousness when an ally clears 1 or more of their
      // marked Hit Points."
      expect(demo.world.heal({ kind: 'entity', id: 'kara' }, 1)).toBe(1);
      expect(kara.alive).toBe(true);
      return;
    }
    throw new Error('the Hope Die never read 1 in sixty seeds');
  });

  it('crosses her through the veil when Risk It All comes up Fear, past any healing', () => {
    for (let seed = 1; seed < 60; seed++) {
      const demo = lastStand(`risk-down-${seed}`);
      const kara = demo.state.entity('kara')!;
      felled(demo);
      choose(demo, 'Risk It All');
      if (!said(demo, 'crosses through the veil')) continue;

      expect(kara.alive).toBe(false);
      expect(kara.dead).toBe(true);
      // A heal reaches a fallen creature - that is how one gets up - and
      // reaches nothing here.
      expect(demo.world.heal({ kind: 'entity', id: 'kara' }, 4)).toBeGreaterThan(0);
      expect(kara.alive).toBe(false);
      return;
    }
    throw new Error('the Fear Die never won in sixty seeds');
  });

  it('stands her up with nothing marked at all when the dice match', () => {
    for (let seed = 1; seed < 200; seed++) {
      const demo = lastStand(`risk-match-${seed}`);
      const kara = demo.state.entity('kara')!;
      kara.stress = { max: 6, marked: 4 };
      felled(demo);
      choose(demo, 'Risk It All');
      if (!said(demo, 'stands up with nothing marked')) continue;

      expect(kara.alive).toBe(true);
      expect(kara.hitPoints.marked).toBe(0);
      expect(kara.stress.marked).toBe(0);
      return;
    }
    throw new Error('the Duality Dice never matched in two hundred seeds');
  });

  it('takes one last swing on Blaze of Glory, and it lands as a critical', () => {
    const demo = lastStand('blaze');
    const kara = demo.state.entity('kara')!;
    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    const before = husk.hitPoints.marked;

    felled(demo);
    choose(demo, 'Blaze of Glory');

    // "It automatically critically succeeds": no roll, and the damage counted
    // as a critical's.
    expect(said(demo, 'goes out in a blaze of glory')).toBe(true);
    expect(said(demo, 'lands a critical with')).toBe(true);
    expect(husk.hitPoints.marked).toBeGreaterThan(before);
    // "And then you cross through the veil of death."
    expect(kara.dead).toBe(true);
    expect(kara.alive).toBe(false);
  });

  it('wins the fight with the last swing, though nobody was allowed to make it', () => {
    const demo = lastStand('blaze-win');
    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    husk.hitPoints = { max: husk.hitPoints.max, marked: husk.hitPoints.max - 1 };
    // One of the party back on their feet behind her, so the fight this swing
    // ends is one somebody is left to have won.
    const ally = demo.state.entitiesOf('party').find((member) => member.id !== 'kara')!;
    ally.alive = true;
    ally.dead = false;
    ally.hitPoints = { ...ally.hitPoints, marked: 0 };
    standBehind(demo, ally.id, husk.tile);

    felled(demo);
    choose(demo, 'Blaze of Glory');

    // `act` refuses a swing from somebody who cannot act, and `act` is where
    // the encounter usually counts who is left standing.
    expect(demo.state.entitiesOf('adversary').some((foe) => foe.alive)).toBe(false);
    expect(demo.encounter!.outcome).toBe('victory');
    expect(said(demo, 'The last of them falls.')).toBe(true);
    // And the critical is not offered back to the one who is no longer there.
    expect(said(demo, 'can answer that')).toBe(false);
  });

  it('crosses anyway when the last swing has nobody to reach', () => {
    const demo = lastStand('blaze-alone');
    const kara = demo.state.entity('kara')!;
    for (const foe of demo.state.entitiesOf('adversary')) {
      foe.hitPoints = { ...foe.hitPoints, marked: foe.hitPoints.max };
      foe.alive = false;
    }
    felled(demo);
    choose(demo, 'Blaze of Glory');

    expect(said(demo, 'finds nothing in reach')).toBe(true);
    expect(kara.dead).toBe(true);
  });

  it('ends the journey when the scar crosses out the last Hope slot', () => {
    for (let seed = 1; seed < 60; seed++) {
      const demo = lastStand(`journey-${seed}`);
      const kara = demo.state.entity('kara')!;
      // Five scars already: this one is the last slot.
      const sheet = { ...demo.sheets.get('kara')!, scars: kara.hope!.max - 1 };
      demo.sheets.set('kara', sheet);
      demo.characters.get('kara')!.sheet = sheet;
      kara.hope = { max: 1, value: 1 };

      felled(demo);
      choose(demo, 'Avoid Death');
      if (!said(demo, 'takes a scar')) continue;

      expect(said(demo, 'journey ends here')).toBe(true);
      expect(kara.hope!.max).toBe(0);
      expect(kara.dead).toBe(true);
      expect(demo.world.heal({ kind: 'entity', id: 'kara' }, 4)).toBeGreaterThan(0);
      expect(kara.alive).toBe(false);
      return;
    }
    throw new Error('the Hope Die never read 1 in sixty seeds');
  });

  /** Put a card in Kara's hands and in her loadout. */
  const carrying = (demo: DemoScene, cards: string[]): void => {
    const sheet = { ...demo.sheets.get('kara')!, domainCards: cards, loadout: cards.slice(0, 5) };
    demo.sheets.set('kara', sheet);
    demo.characters.set('kara', deriveCharacter(sheet, characterContentFor(demo.project), demo.project.abilities).character);
    refreshWorld(demo);
  };

  it('offers Unbreakable in place of the three, and the card goes to the vault after it', () => {
    const demo = lastStand('unbreakable');
    carrying(demo, ['unbreakable']);
    const kara = demo.state.entity('kara')!;

    felled(demo);
    const asked = demo.pending as PendingDeath;
    expect(asked.kind).toBe('death');
    // After the three moves, because the first option is the one that changes
    // nothing.
    expect(asked.offers.map((o) => o.ability.id)).toEqual(['unbreakable']);

    choose(demo, 'Unbreakable');
    // "Roll a d6 and clear a number of Hit Points equal to the result."
    expect(kara.alive).toBe(true);
    expect(kara.hitPoints.marked).toBeLessThan(kara.hitPoints.max);
    // "Then place this card in your vault": out of the loadout, and no longer
    // offering anything.
    expect(said(demo, 'places Unbreakable in the vault')).toBe(true);
    expect(loadoutOf(demo.characters.get('kara')!)).not.toContain('unbreakable');
    expect(demo.world.reactionsFor('kara', 'defeated')).toEqual([]);

    // The next time she goes down there is nothing but the three moves.
    felled(demo);
    expect((demo.pending as PendingDeath).offers).toEqual([]);
  });

  it('spends a Hope on Battle-Hardened, and has none of it left this long rest', () => {
    const demo = lastStand('battle-hardened');
    carrying(demo, ['battle-hardened']);
    const kara = demo.state.entity('kara')!;
    kara.hope = { max: 6, value: 3 };

    felled(demo);
    expect((demo.pending as PendingDeath).offers.map((o) => o.ability.id)).toEqual(['battle-hardened']);
    choose(demo, 'Battle-Hardened');

    // "Spend a Hope to clear a Hit Point instead."
    expect(kara.alive).toBe(true);
    expect(kara.hitPoints.marked).toBe(kara.hitPoints.max - 1);
    expect(kara.hope!.value).toBe(2);

    // "Once per long rest": down again, and there is nothing to answer with.
    felled(demo);
    expect((demo.pending as PendingDeath).offers).toEqual([]);
  });

  it('is not offered a card whose Hope the fallen character cannot pay', () => {
    const demo = lastStand('no-hope');
    carrying(demo, ['battle-hardened']);
    demo.state.entity('kara')!.hope = { max: 6, value: 0 };
    felled(demo);
    expect((demo.pending as PendingDeath).offers).toEqual([]);
  });

  it('puts the three moves again when the card played instead of them left her down', () => {
    const demo = lastStand('not-enough');
    demo.project.abilities.push(
      abilitySchema.parse({
        id: 'last-words',
        name: 'Last Words',
        source: { kind: 'granted', characters: ['kara'] },
        text: 'When you mark your last Hit Point, say something.',
        kind: 'reaction',
        trigger: 'defeated',
        action: false,
        auto: false,
        effects: [{ kind: 'log', text: 'She says something bitter.', tone: 'fear' }],
      }),
    );
    refreshWorld(demo);
    const kara = demo.state.entity('kara')!;

    felled(demo);
    choose(demo, 'Last Words');
    expect(said(demo, 'She says something bitter.')).toBe(true);
    // It bought nothing, so the question comes back - with the moves alone.
    const again = demo.pending as PendingDeath;
    expect(again.kind).toBe('death');
    expect(again.offers).toEqual([]);
    choose(demo, 'Avoid Death');
    expect(kara.alive).toBe(false);
    expect(demo.pending).toBe(null);
  });

  it('avoids death by itself when there is nobody at the table to ask', () => {
    const demo = lastStand('unasked');
    demo.askDefender = false;
    const kara = demo.state.entity('kara')!;

    felled(demo);
    expect(demo.pending).toBe(null);
    expect(said(demo, 'drops unconscious')).toBe(true);
    expect(kara.alive).toBe(false);
    expect(kara.dead).toBeUndefined();
  });

  it('asks again the next time she goes down, once an ally has stood her up', () => {
    const demo = lastStand('twice');
    const kara = demo.state.entity('kara')!;
    felled(demo);
    choose(demo, 'Avoid Death');
    expect(demo.pending).toBe(null);

    // An ally clears a Hit Point on her. Every path that can do that settles
    // the fight afterwards, and settling is where standing back up is noticed.
    demo.world.heal({ kind: 'entity', id: 'kara' }, 2);
    settleFight(demo);
    expect(kara.alive).toBe(true);

    felled(demo);
    // "When a PC marks their last Hit Point" is every time they do.
    expect(demo.pending?.kind).toBe('death');
  });
});


// ---------------------------------------------------------------------------
// What the engine counts and what it hears
// ---------------------------------------------------------------------------

describe('a card with a limit on it, answering something', () => {
  const hold = (demo: DemoScene, cards: string[]): void => {
    const sheet = { ...demo.sheets.get('kara')!, domainCards: cards, loadout: cards.slice(0, 5) };
    demo.sheets.set('kara', sheet);
    demo.characters.set('kara', deriveCharacter(sheet, characterContentFor(demo.project), demo.project.abilities).character);
    refreshWorld(demo);
  };

  it('is offered once and then not again, the way a stat block\'s feature already was', () => {
    // Scramble is "once per rest", and until now nothing on the party's side
    // of the table counted that: `canPayFor` reads the pools and knows nothing
    // about how many times a card has been played.
    const demo = standoff('scramble-once');
    hold(demo, ['scramble']);

    const first = untilChoice(demo, 'script');
    expect(first, 'Scramble was offered').not.toBeNull();
    const offered = (): boolean =>
      // The blow it was first offered against, so the answer is about the
      // card's own limit and not about having already answered this swing.
      defenseChoices(demo, first!.attack).some((c) => c.kind === 'script' && c.ability.id === 'scramble');
    expect(offered()).toBe(true);

    const at = first!.choices.findIndex((c) => c.kind === 'script' && c.ability.id === 'scramble');
    expect(at).toBeGreaterThan(0);
    const stood = demo.state.entity('kara')!.tile;
    answerPending(demo, { kind: 'choose', index: at });

    // Back where she was standing, because the card's own gate is about being
    // in Melee range and Scramble is what took her out of it: the question
    // here is the limit on the card, not where the card left her.
    demo.state.moveEntity('kara', stood);
    expect(demo.world.reactionsFor('kara', 'incomingDamage', { targets: [first!.attack.attacker], hit: [] }).map((a) => a.id)).toContain('scramble');

    // Played, counted, and gone until the party rests.
    expect(demo.scenario.abilityUses.get(useKey('kara', 'scramble'))).toBe(1);
    expect(offered()).toBe(false);
  });
});

describe('a wound marked outright', () => {
  it('is heard the same way a rolled one is', () => {
    // "Force them to mark 5 Hit Points", the vines that squeeze, a trap: the
    // number is the card's rather than a roll's, and until now nothing that
    // answers being hurt heard it at all.
    const demo = scene('flat-heard');
    demo.scenario.actorId = 'mira';
    runScript([{ kind: 'damage', amount: 2, target: { kind: 'entity', id: 'kara' } }], demo.world, demo.rng);

    const notes = demo.world.drainDamage();
    const heard = notes.find((n) => n.id === 'kara');
    expect(heard, 'the wound was noted').toBeDefined();
    expect(heard!.hitPoints).toBe(2);
    // Nobody swung it, so nothing that hits back has anybody to hit.
    expect(heard!.attacker).toBe(null);
    expect(heard!.severe).toBe(false);

    // Three Hit Points is what a Severe blow marks, whoever counted them.
    runScript([{ kind: 'damage', amount: 3, target: { kind: 'entity', id: 'mira' } }], demo.world, demo.rng);
    expect(demo.world.drainDamage().find((n) => n.id === 'mira')!.severe).toBe(true);
  });
});


describe('a swing that missed', () => {
  const hold = (demo: DemoScene, cards: string[]): void => {
    const sheet = { ...demo.sheets.get('kara')!, domainCards: cards, loadout: cards.slice(0, 5) };
    demo.sheets.set('kara', sheet);
    demo.characters.set('kara', deriveCharacter(sheet, characterContentFor(demo.project), demo.project.abilities).character);
    refreshWorld(demo);
  };

  /** Swing at the husk beside Kara until the dice go one way or the other. */
  const swingUntil = (seed: string, cards: string[], hit: boolean): DemoScene | null => {
    for (let n = 1; n < 40; n++) {
      const demo = standoff(`${seed}-${n}`);
      demo.askDefender = true;
      hold(demo, cards);
      const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
      const result = attackWithSelected(demo, husk.id);
      if (result === null || result.refused !== null) continue;
      if (result.hit !== hit) continue;
      return demo;
    }
    return null;
  };

  it('offers Glancing Blow on a miss and nothing on a hit', () => {
    // "When you fail an attack, you can mark a Stress to deal weapon damage
    // using half your Proficiency."
    const missed = swingUntil('glancing-miss', ['glancing-blow'], false);
    expect(missed, 'a swing missed').not.toBeNull();
    const demo = missed!;
    expect(demo.pending?.kind).toBe('reaction');
    const asked = demo.pending as { offers: readonly { ability: { id: string } }[] };
    expect(asked.offers.map((o) => o.ability.id)).toEqual(['glancing-blow']);

    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    const before = husk.hitPoints.marked;
    const kara = demo.state.entity('kara')!;
    const stress = kara.stress.marked;
    answerPending(demo, { kind: 'choose', index: 1 });
    expect(kara.stress.marked).toBe(stress + 1);
    expect(husk.hitPoints.marked).toBeGreaterThan(before);

    // The same card says nothing about a swing that landed: `dealtHit` and
    // `dealtMiss` are the two halves, and this one only answers the second.
    const landed = swingUntil('glancing-hit', ['glancing-blow'], true);
    expect(landed, 'a swing landed').not.toBeNull();
    expect(landed!.pending).toBe(null);
  });

  it('ends the fight it wins, though the killing blow came out of a reaction', () => {
    // A reaction's kill is neither an `act` nor a `spotlight`, and those are
    // the only two things that count who is left standing. Glancing Blow is
    // built to land one: the swing that raised it already passed the spotlight
    // to a GM with nobody left to spotlight.
    for (let seed = 1; seed < 60; seed++) {
      const demo = standoff(`glancing-win-${seed}`);
      demo.askDefender = true;
      hold(demo, ['glancing-blow']);
      const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
      husk.hitPoints = { max: 3, marked: 2 };
      husk.armorSlots = { max: 0, marked: 0 };

      const result = attackWithSelected(demo, husk.id);
      if (result === null || result.refused !== null || result.hit) continue;
      if (demo.pending?.kind !== 'reaction') continue;
      answerPending(demo, { kind: 'choose', index: 1 });
      if (husk.alive) continue;

      expect(demo.encounter!.outcome).toBe('victory');
      expect(demo.log.some((l) => l.text.includes('The last of them falls.'))).toBe(true);
      return;
    }
    throw new Error('no glancing blow felled the husk in sixty tries');
  });

  it('rolls the weapon at half Proficiency, rounded up and never under one die', () => {
    const demo = scene('half-prof');
    const sheet = demo.sheets.get('kara')!;
    // Proficiency 1 halves to 1: a die is a die.
    expect(demo.world.proficiencyOf('kara')).toBe(1);
    const one = deriveCharacter({ ...sheet, proficiency: 5 }, characterContentFor(demo.project), demo.project.abilities).character;
    demo.characters.set('kara', one);
    demo.sheets.set('kara', one.sheet);
    refreshWorld(demo);
    expect(demo.world.proficiencyOf('kara')).toBe(5);

    // Five halves to three, so three of the weapon's dice rather than five.
    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    demo.scenario.actorId = 'kara';
    const journal = runScript(
      [{ kind: 'damage', dice: 'weapon', using: 'halfProficiency', target: { kind: 'entity', id: husk.id } }],
      demo.world,
      demo.rng,
    );
    const dealt = journal.find((e) => e.kind === 'damage') as { dice: string } | undefined;
    expect(dealt).toBeDefined();
    expect(dealt!.dice.startsWith('3d')).toBe(true);
  });
});


describe('a swing lifted, and a swing that names its own number', () => {
  const hold = (demo: DemoScene, cards: string[]): void => {
    const sheet = { ...demo.sheets.get('kara')!, domainCards: cards, loadout: cards.slice(0, 5) };
    demo.sheets.set('kara', sheet);
    demo.characters.set('kara', deriveCharacter(sheet, characterContentFor(demo.project), demo.project.abilities).character);
    refreshWorld(demo);
  };

  it("lifts the lowest of the swing's dice to its highest face", () => {
    // "Mark a Stress to use the maximum result of one of your damage dice
    // instead of rolling it." The card is offered while the blow is held, and
    // what it is worth is read off the faces the dice actually came up - which
    // is why it journals nothing and the swing does the arithmetic.
    const swing = (seed: string, play: boolean): { marked: number; lift: number; stress: number } | null => {
      const demo = standoff(seed);
      demo.askDefender = true;
      hold(demo, ['versatile-fighter']);
      const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
      husk.hitPoints = { max: 30, marked: 0 };
      const result = attackWithSelected(demo, husk.id);
      if (result === null || result.refused !== null || !result.hit) return null;
      if (demo.pending?.kind !== 'reaction') return null;
      const asked = demo.pending as { offers: readonly { ability: { id: string } }[]; landing?: HeldSwing };
      if (asked.offers.map((o) => o.ability.id).join() !== 'versatile-fighter') return null;
      const roll = asked.landing?.outcome.damageRoll;
      if (roll === undefined) return null;
      const lift = roll.expression.sides - Math.min(...roll.rolls);
      answerPending(demo, { kind: 'choose', index: play ? 1 : 0 });
      return { marked: husk.hitPoints.marked, lift, stress: demo.state.entity('kara')!.stress.marked };
    };

    for (let seed = 1; seed < 60; seed++) {
      const name = `versatile-${seed}`;
      const letPass = swing(name, false);
      if (letPass === null || letPass.lift === 0) continue;
      const played = swing(name, true);
      if (played === null) continue;
      // Only a lift that carries the blow over a threshold changes what is
      // marked; when one does, it can only ever be upward.
      expect(played.marked).toBeGreaterThanOrEqual(letPass.marked);
      if (played.marked === letPass.marked) continue;
      expect(played.marked).toBeGreaterThan(letPass.marked);
      // And it cost a Stress, where letting it pass cost nothing.
      expect(played.stress).toBe(letPass.stress + 1);
      return;
    }
    throw new Error('no lifted die crossed a threshold in sixty tries');
  });

  it('reaps for five Hit Points, past thresholds and past armor', () => {
    for (let seed = 1; seed < 40; seed++) {
      const demo = standoff(`reaper-${seed}`);
      demo.askDefender = false;
      hold(demo, ['reapers-strike']);
      const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
      husk.hitPoints = { max: 30, marked: 0 };
      husk.armorSlots = { max: 6, marked: 0 };
      const hope = demo.state.entity('kara')!;
      hope.hope = { max: 6, value: 3 };

      expect(useAbility(demo, 'kara', 'reapers-strike', []).status).not.toBe('refused');
      while (demo.pending !== null) answerPending(demo, { kind: 'roll' });
      if (husk.hitPoints.marked === 0) continue;

      // "Force them to mark 5 Hit Points": the number is the card's, so
      // nothing about the husk - its thresholds, its armor - touches it.
      expect(husk.hitPoints.marked).toBe(5);
      expect(husk.armorSlots.marked).toBe(0);
      // Paid for. What the roll itself gives back - a Hope on a success with
      // Hope - is the action roll's business and not the card's.
      expect(demo.log.some((l) => l.text.includes('Spends 1 Hope.'))).toBe(true);
      // Once per long rest, counted the way an action card's uses are.
      expect(demo.scenario.abilityUses.get(useKey('kara', 'reapers-strike'))).toBe(1);
      return;
    }
    throw new Error('the reap never beat the husk in forty tries');
  });

  it("reads 'within your weapon's range' off the weapon, not off a band", () => {
    const demo = standoff('reach');
    // Kara swings a Melee weapon, so a selector that says `reach: 'weapon'`
    // reaches Melee however wide a band it names as its fallback.
    expect(demo.world.weaponRange('kara')).toBe('melee');
    demo.scenario.actorId = 'kara';
    const near = demo.world.resolveTargets({ kind: 'adversaries', range: 'far', reach: 'weapon' }, { targets: [], hit: [] });
    const far = demo.world.resolveTargets({ kind: 'adversaries', range: 'far' }, { targets: [], hit: [] });
    expect(near.length).toBeLessThanOrEqual(far.length);
    for (const id of near) expect(demo.world.bandTo('kara', id)).toBe('melee');
    // A stat block holds nothing the engine can read, so the band stands.
    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    expect(demo.world.weaponRange(husk.id)).toBe(null);
  });
});


describe('a card that moves before it swings', () => {
  const hold = (demo: DemoScene, cards: string[]): void => {
    const sheet = { ...demo.sheets.get('kara')!, domainCards: cards, loadout: cards.slice(0, 5) };
    demo.sheets.set('kara', sheet);
    demo.characters.set('kara', deriveCharacter(sheet, characterContentFor(demo.project), demo.project.abilities).character);
    refreshWorld(demo);
  };

  /** Kara well back from the husk, with an ally beside her. */
  const across = (seed: string): DemoScene => {
    const demo = standoff(seed);
    demo.askDefender = false;
    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    // Away from it, and out of Melee, with the run still inside Far range.
    const blocked = demo.state.blockedFor('kara');
    let back = NO_TILE;
    demo.grid.forEachNeighbor(demo.state.entity('kara')!.tile, false, (tile) => {
      if (back !== NO_TILE || !demo.grid.isPassable(tile) || blocked(tile)) return;
      if (demo.grid.manhattanDistance(tile, husk.tile) <= 1) return;
      back = tile;
    });
    if (back !== NO_TILE) demo.state.moveEntity('kara', back);
    return demo;
  };

  it('boosts off an ally, crosses the room and swings with advantage', () => {
    const demo = across('boost');
    hold(demo, ['boost']);
    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    // Mira beside her: the card only has to know somebody is close enough to
    // push off, and nothing happens to them.
    standBehind(demo, 'mira', husk.tile);
    expect(demo.world.bandTo('kara', 'mira')).not.toBe(null);

    const stress = demo.state.entity('kara')!.stress.marked;
    expect(useAbility(demo, 'kara', 'boost', [husk.id]).status).not.toBe('refused');
    expect(demo.state.entity('kara')!.stress.marked).toBe(stress + 1);
    // "End your move within Melee range of the target."
    expect(demo.world.bandTo('kara', husk.id)).toBe('melee');
    expect(demo.log.some((l) => l.text.includes('A shove off a shoulder'))).toBe(true);
  });

  it('is not offered with nobody close enough to push off', () => {
    const demo = across('boost-alone');
    hold(demo, ['boost']);
    // Everyone else off the map: "a willing ally within Close range" is a gate
    // on the card, so it is not usable rather than usable and pointless.
    for (const member of demo.state.entitiesOf('party')) {
      if (member.id === 'kara') continue;
      demo.state.moveEntity(member.id, NO_TILE);
    }
    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    expect(useAbility(demo, 'kara', 'boost', [husk.id]).status).toBe('refused');
  });

  it('sprints without a roll and leaves the next swing surer for it', () => {
    const demo = across('deft');
    hold(demo, ['deft-maneuvers']);
    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    expect(demo.world.bandTo('kara', husk.id)).not.toBe('melee');
    expect(demo.world.rollBonus('kara', 'attackRoll', { melee: true })).toBe(0);

    expect(useAbility(demo, 'kara', 'deft-maneuvers', [husk.id]).status).not.toBe('refused');
    expect(demo.world.bandTo('kara', husk.id)).toBe('melee');
    // "Gain a +1 bonus to the attack roll" - on the next swing, and one only.
    expect(demo.state.entity('kara')!.conditions.has('poised')).toBe(true);
    expect(demo.world.rollBonus('kara', 'attackRoll', { melee: true })).toBe(1);

    // It is not the character's action: the attack that follows is.
    expect(demo.encounter!.canAct('kara')).toBe(true);
    attackWithSelected(demo, husk.id);
    expect(demo.state.entity('kara')!.conditions.has('poised')).toBe(false);
    // Once per rest, counted like any other limited card.
    expect(demo.scenario.abilityUses.get(useKey('kara', 'deft-maneuvers'))).toBe(1);
  });

  it('rolls the dice behind a swing once, and puts them into what lands', () => {
    // "Add a d10 to the damage roll": the attack rules take a number, so the
    // dice are rolled by the script and handed over as one. What a swing marks
    // is banded, so the extra die shows up as a blow that never marks less and
    // sometimes marks more.
    const swing = (seed: string, dice: boolean): number | null => {
      const demo = standoff(`behind-${seed}`);
      demo.askDefender = false;
      const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
      husk.hitPoints = { max: 40, marked: 0 };
      demo.scenario.actorId = 'kara';
      const journal = runScript(
        [{ kind: 'attack', target: { kind: 'entity', id: husk.id }, ...(dice ? { damageDice: '1d10' } : {}) }],
        demo.world,
        demo.rng,
      );
      const landed = journal.find((e) => e.kind === 'attack') as { hit: boolean; hitPointsMarked: number } | undefined;
      return landed?.hit === true ? landed.hitPointsMarked : null;
    };

    // Not blow by blow: the extra die comes off the same seeded stream as the
    // attack roll, so asking for one moves every roll after it and the two
    // swings on a seed are different swings. Across enough of them the die is
    // simply worth something, and a card that ignored it would come to exactly
    // the same total.
    let bareTotal = 0;
    let boostedTotal = 0;
    let landed = 0;
    for (let seed = 1; seed < 80; seed++) {
      const bare = swing(String(seed), false);
      const boosted = swing(String(seed), true);
      if (bare === null || boosted === null) continue;
      landed++;
      bareTotal += bare;
      boostedTotal += boosted;
    }
    expect(landed).toBeGreaterThan(10);
    expect(boostedTotal).toBeGreaterThan(bareTotal);
  });
});


describe('a card aimed at the ground', () => {
  /** Kara alone with two husks in a row, and a card that runs a path. */
  const room = (seed: string): DemoScene => {
    const demo = standoff(seed);
    demo.askDefender = false;
    demo.project.abilities.push(
      abilitySchema.parse({
        id: 'charge',
        name: 'Charge',
        source: { kind: 'granted', characters: ['kara'] },
        text: 'Run a straight path to a point within Far range and strike everything along it.',
        cost: { stress: 1 },
        target: { kind: 'point', range: 'far' },
        effects: [
          { kind: 'damage', amount: 2, target: { kind: 'inPath', side: 'adversaries' } },
          { kind: 'move', how: 'toward', of: { kind: 'target' }, budget: 'far' },
        ],
      }),
      abilitySchema.parse({
        id: 'drop-a-ward',
        name: 'Drop A Ward',
        source: { kind: 'granted', characters: ['kara'] },
        text: 'Choose a point within Far range and shelter everyone near it.',
        target: { kind: 'point', range: 'far' },
        effects: [{ kind: 'applyCondition', condition: 'focused', target: { kind: 'allies', range: 'close', around: 'point', includeSelf: true } }],
      }),
    );
    refreshWorld(demo);
    return demo;
  };

  const charge = (demo: DemoScene): AbilityDef =>
    demo.project.abilities.find((a) => a.id === 'charge')!;

  it('offers ground rather than creatures, out to the band the card names', () => {
    const demo = room('aim');
    const here = demo.state.entity('kara')!.tile;
    const tiles = pointTiles(demo, 'kara', charge(demo));

    expect(tiles.length).toBeGreaterThan(0);
    // Never the tile the character is standing on, and never past the band.
    expect(tiles).not.toContain(here);
    for (const tile of tiles) {
      const band = demo.world.bandBetween(here, tile);
      expect(band).not.toBe(null);
      expect(['melee', 'veryClose', 'close', 'far']).toContain(band);
    }
    // A card that picks a creature offers no ground at all.
    expect(pointTiles(demo, 'kara', demo.project.abilities.find((a) => a.id === 'drop-a-ward')!).length).toBeGreaterThan(0);
  });

  it('shows what the shape would catch before it is committed to', () => {
    const demo = room('preview');
    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    // Aimed past the husk: it is on the line, so the preview names it.
    const beyond = demo.grid.indexOf(
      Math.min(demo.grid.width - 1, demo.grid.xOf(husk.tile) + 2),
      demo.grid.yOf(husk.tile),
    );
    expect(shapeAt(demo, 'kara', charge(demo), beyond)).toContain(husk.id);
    // Nothing at all is a legal answer: the preview is a question about a
    // tile, not a promise that something is there.
    expect(shapeAt(demo, 'kara', charge(demo), NO_TILE)).toEqual([]);
    // And reading it changes nothing - the actor is put back where it was.
    expect(demo.scenario.actorId).not.toBe('kara');
    expect(husk.hitPoints.marked).toBe(0);
  });

  it('runs the path it was aimed at, and refuses when nobody aimed it', () => {
    const demo = room('run');
    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    const beyond = demo.grid.indexOf(
      Math.min(demo.grid.width - 1, demo.grid.xOf(husk.tile) + 2),
      demo.grid.yOf(husk.tile),
    );
    expect(shapeAt(demo, 'kara', charge(demo), beyond)).toContain(husk.id);

    // No point, no card: it needs somewhere to aim.
    expect(useAbility(demo, 'kara', 'charge', []).status).toBe('refused');
    expect(demo.log.some((l) => l.text.includes('needs somewhere to aim'))).toBe(true);
    expect(husk.hitPoints.marked).toBe(0);

    const stress = demo.state.entity('kara')!.stress.marked;
    expect(useAbility(demo, 'kara', 'charge', [], { point: beyond }).status).not.toBe('refused');
    expect(demo.state.entity('kara')!.stress.marked).toBe(stress + 1);
    expect(husk.hitPoints.marked).toBe(2);
  });

  it('drops a ward on a spot and shelters whoever is standing near it', () => {
    const demo = room('ward');
    const ward = demo.project.abilities.find((a) => a.id === 'drop-a-ward')!;
    const kara = demo.state.entity('kara')!;
    expect(shapeAt(demo, 'kara', ward, kara.tile)).toContain('kara');

    expect(useAbility(demo, 'kara', 'drop-a-ward', [], { point: kara.tile }).status).not.toBe('refused');
    expect(kara.conditions.has('focused')).toBe(true);
  });
});


describe('a run in a straight line', () => {
  /**
   * A card aimed at the ground rather than at anybody: she picks a tile, runs
   * to it, and one roll goes against everything the path went through. `inPath`
   * is the whole of it, and the card reads that path from her own chair.
   *
   * The GM's side of the same idea is below, on a creature that charges when a
   * wound costs it enough: same `inPath`, other `side`.
   */
  const RUN_CARD = 'fixture-card-36';

  const RUN = [
    {
      id: 'fixture-run',
      name: 'Straight Line',
      source: { kind: 'domainCard', card: RUN_CARD },
      text: 'Spend three Hope to run a straight line through everything in the way.',
      cost: { hope: 3 },
      inCombatOnly: true,
      target: { kind: 'point', range: 'far' },
      effects: [
        { kind: 'log', text: 'Head down, straight through the middle, and no stopping.', tone: 'hope' },
        { kind: 'move', to: 'point', budget: 'far' },
        {
          kind: 'check',
          check: {
            trait: 'weapon',
            difficulty: 'target',
            targets: { kind: 'inPath', side: 'adversaries', reach: 'weapon' },
            prompt: 'One roll, against everything the path went through?',
            always: [{ kind: 'damage', dice: 'weapon', using: 'proficiency', target: { kind: 'hit' } }],
          },
        },
      ],
    },
  ];

  /**
   * The same shape on the GM's side: a creature that charges when a wound costs
   * it two Hit Points or more.
   *
   * The damage comes before the move deliberately. What the charge ran through
   * is measured from where it started, so a line read after it arrived would be
   * a line from the wrong end.
   */
  const charge = (demo: DemoScene, who: string): Record<string, unknown> => ({
    id: 'fixture-charge',
    name: 'Charge',
    source: { kind: 'adversary', adversaries: [adversaryDefOf(demo, who)!.id] },
    text: 'When a wound costs it two Hit Points or more, it puts its head down and runs.',
    kind: 'reaction',
    trigger: 'tookHitPoints',
    action: false,
    available: { kind: 'count', of: 'hitPointsTaken', op: '>=', value: 2 },
    target: { kind: 'none', range: 'close' },
    inCombatOnly: true,
    effects: [
      { kind: 'log', text: 'It puts its head down and goes.', tone: 'fear' },
      { kind: 'damage', dice: '2d6+3', type: 'physical', direct: true, target: { kind: 'inPath', side: 'allies' } },
      { kind: 'move', to: 'point', budget: 'close' },
    ],
  });

  const hold = (demo: DemoScene, cards: string[]): void => {
    demo.project.domainCards.push(...FIXTURE_CARDS);
    for (const ability of RUN) demo.project.abilities.push(abilitySchema.parse(ability));
    const sheet = { ...demo.sheets.get('kara')!, domainCards: cards, loadout: cards.slice(0, 5) };
    demo.sheets.set('kara', sheet);
    demo.characters.set('kara', deriveCharacter(sheet, characterContentFor(demo.project), demo.project.abilities).character);
    refreshWorld(demo);
  };

  it('takes Deathrun through everything the path went past, and moves her there', () => {
    for (let seed = 1; seed < 40; seed++) {
      const demo = standoff(`run-${seed}`);
      demo.askDefender = false;
      hold(demo, [RUN_CARD]);
      const kara = demo.state.entity('kara')!;
      kara.hope = { max: 6, value: 6 };
      const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
      husk.hitPoints = { max: 40, marked: 0 };

      // A tile on the far side of the husk, so the run goes through it.
      const past = demo.grid.indexOf(
        Math.min(demo.grid.width - 1, demo.grid.xOf(husk.tile) + 2),
        demo.grid.yOf(husk.tile),
      );
      const card = demo.project.abilities.find((a) => a.id === 'fixture-run')!;
      if (!pointTiles(demo, 'kara', card).includes(past)) continue;
      if (!shapeAt(demo, 'kara', card, past).includes(husk.id)) continue;

      const from = kara.tile;
      expect(useAbility(demo, 'kara', 'fixture-run', [], { point: past }).status).not.toBe('refused');
      while (demo.pending !== null) answerPending(demo, { kind: 'roll' });

      // "Spend 3 Hope", and the run happened. What the roll gives back is the
      // action roll's business, not the card's.
      expect(demo.log.some((l) => l.text.includes('Spends 3 Hope.'))).toBe(true);
      expect(kara.tile).not.toBe(from);
      // On a success the husk is hurt; on a failure it is not, and either way
      // the path was run.
      if (husk.hitPoints.marked > 0) return;
      expect(demo.log.some((l) => l.text.includes('straight through the middle'))).toBe(true);
      return;
    }
    throw new Error('the path never lined up in forty tries');
  });

  it('refuses Deathrun with nowhere to aim it', () => {
    const demo = standoff('run-nowhere');
    hold(demo, [RUN_CARD]);
    demo.state.entity('kara')!.hope = { max: 6, value: 6 };
    expect(useAbility(demo, 'kara', 'fixture-run', []).status).toBe('refused');
    expect(demo.log.some((l) => l.text.includes('needs somewhere to aim'))).toBe(true);
  });

  it("charges at the nearest of the party when nobody is there to click a tile", () => {
    // A stat block cannot pick a point, so it runs at whoever is nearest - the
    // same rule its swing already uses to choose whom to hit.
    for (let seed = 1; seed < 40; seed++) {
      const demo = standoff(`charge-${seed}`);
      demo.askDefender = false;
      const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
      // The charging creature is the one standing there, carrying the feature
      // under test and nothing else.
      demo.project.abilities.push(abilitySchema.parse(charge(demo, husk.id)));
      refreshWorld(demo);
      const ogre = demo.project.abilities.find((a) => a.id === 'fixture-charge')!;
      expect(ogre.trigger).toBe('tookHitPoints');
      demo.state.entity('kara')!.hitPoints = { max: 12, marked: 0 };

      // The Ogre's own script, run where the husk stands: the point is bound
      // for it, so the charge has somewhere to go and a line to cut.
      // Kara a few tiles off, so the charge has ground to cover.
      const away = demo.grid.indexOf(
        Math.min(demo.grid.width - 1, demo.grid.xOf(husk.tile) + 3),
        demo.grid.yOf(husk.tile),
      );
      if (!demo.grid.isPassable(away) || demo.state.occupantsOf(away).length > 0) continue;
      demo.state.moveEntity('kara', away);
      const before = demo.state.entity('kara')!.hitPoints.marked;
      const at = husk.tile;
      demo.scenario.actorId = husk.id;
      const journal = runScript(ogre.effects, demo.world, demo.rng, {
        point: demo.state.entity('kara')!.tile,
      });
      expect(journal.some((e) => e.kind === 'damage')).toBe(true);
      expect(demo.state.entity('kara')!.hitPoints.marked).toBeGreaterThan(before);
      // And it ran: the charge ends where it was aimed, not where it started.
      expect(husk.tile).not.toBe(at);
      return;
    }
    throw new Error('the Ogre never got to charge');
  });
});


describe('what a charge runs over', () => {
  const holds = (demo: DemoScene, cards: string[]): void => {
    const sheet = { ...demo.sheets.get('kara')!, domainCards: cards, loadout: cards.slice(0, 5) };
    demo.sheets.set('kara', sheet);
    demo.characters.set('kara', deriveCharacter(sheet, characterContentFor(demo.project), demo.project.abilities).character);
    refreshWorld(demo);
  };

  it('lets whoever a charge ran down answer the wound it dealt', () => {
    const demo = standoff('answered-charge');
    demo.askDefender = true;
    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    husk.hitPoints = { max: 40, marked: 0 };
    const on = adversaryDefOf(demo, husk.id)!.id;
    const fury = demo.project.abilities.find((a) => a.id === 'cave-ogre-rampaging-fury')!;
    // The Ogre's charge on the husk, and one card in Kara's hands that answers
    // a wound. Nothing else in the room reacts, so what she is asked about is
    // the whole of the assertion.
    // A card that answers a wound, carried on a real card of the SRD's so it
    // resolves onto her sheet - the trigger is what is under test, not which
    // card it was printed on, so that card's own ability comes off.
    demo.project.abilities = demo.project.abilities.filter(
      (a) => a.source.kind !== 'adversary' && a.id !== 'deathrun',
    );
    demo.project.abilities.push(
      abilitySchema.parse({ ...fury, id: 'husk-fury', source: { kind: 'adversary', adversaries: [on] } }),
      abilitySchema.parse({
        id: 'flinch',
        name: 'Flinch',
        source: { kind: 'domainCard', card: 'deathrun' },
        text: 'When you take damage, you can steady yourself.',
        kind: 'reaction',
        trigger: 'tookDamage',
        action: false,
        effects: [{ kind: 'log', text: 'Kara steadies herself.', tone: 'hope' }],
      }),
    );
    holds(demo, ['deathrun']);
    // Nobody is going to fall: a death move would be a question of its own.
    for (const e of demo.state.entitiesOf('party')) e.hitPoints = { max: 20, marked: 0 };
    const before = demo.state.entity('kara')!.hitPoints.marked;

    // Two Hit Points on the husk is what sets the charge off.
    demo.world.damage({ kind: 'entity', id: husk.id }, 2);
    settleFight(demo);

    expect(demo.log.some((l) => l.text.includes('puts its head down'))).toBe(true);
    expect(demo.state.entity('kara')!.hitPoints.marked).toBeGreaterThan(before);
    // The wound the charge dealt is heard in the same breath as the wound that
    // set it off, not left in the queue for whatever lands next. The card costs
    // nothing and asks nothing, so it runs where it would have been offered.
    expect(demo.log.some((l) => l.text.includes('Kara steadies herself.'))).toBe(true);
  });

  it('aims a charge that comes off a countdown, with nobody there to aim it', () => {
    const demo = standoff('clockwork-charge');
    demo.askDefender = false;
    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    husk.hitPoints = { max: 60, marked: 0 };
    for (const e of demo.state.entitiesOf('party')) e.hitPoints = { max: 20, marked: 0 };
    // "When it triggers, move in a straight line to a point within Far range
    // and attack everything in the path": a clock with a charge on it, one
    // tick from going off.
    demo.scenario.countdowns.set('rampage', {
      id: 'rampage',
      name: 'Rampage',
      owner: husk.id,
      dice: '1',
      value: 1,
      start: 1,
      advance: 'attackRoll',
      onDeath: 'end',
      effects: [
        { kind: 'log', text: 'It breaks into a run and does not turn.', tone: 'fear' },
        { kind: 'damage', dice: '4d12+20', type: 'physical', direct: true, target: { kind: 'inPath', side: 'allies' } },
      ],
    });
    const before = demo.state.entity('kara')!.hitPoints.marked;

    attackWithSelected(demo, husk.id);
    let guard = 0;
    while (demo.pending !== null && guard++ < 8) answerPending(demo, { kind: 'roll' });

    expect(demo.log.some((l) => l.text.includes('breaks into a run'))).toBe(true);
    expect(demo.state.entity('kara')!.hitPoints.marked).toBeGreaterThan(before);
  });

  it('does not run over what is standing behind the one charging', () => {
    const demo = standoff('behind-me');
    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    const card = demo.project.abilities.find((a) => a.id === 'deathrun')!;
    holds(demo, ['deathrun']);
    const tiles = pointTiles(demo, 'kara', card);
    expect(tiles.length).toBeGreaterThan(0);

    // The husk is at Kara's elbow. Aimed through it the run catches it; aimed
    // the other way it does not, because the tile she started on is not on the
    // path she ran.
    const through = tiles.filter((tile) => shapeAt(demo, 'kara', card, tile).includes(husk.id));
    const clear = tiles.filter((tile) => !shapeAt(demo, 'kara', card, tile).includes(husk.id));
    expect(through.length).toBeGreaterThan(0);
    expect(clear.length).toBeGreaterThan(0);
  });

  it('catches what the boiling line went over rather than everybody within Far', () => {
    const demo = standoff('boiling-line');
    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    const kara = demo.state.entity('kara')!;
    demo.scenario.actorId = husk.id;
    const line = (): string[] =>
      demo.world.resolveTargets({ kind: 'inPath', side: 'allies' }, { targets: [], hit: [], point: kara.tile });
    const circle = (): string[] =>
      demo.world.resolveTargets({ kind: 'allies', range: 'far' }, { targets: [], hit: [] });
    expect(line()).toContain('kara');

    // Somewhere within Far of it but off the line: the circle the Kraken used
    // to throw caught them, and the line does not.
    let missed = false;
    const blocked = demo.state.blockedFor('finn');
    for (let tile = 0; tile < demo.grid.width * demo.grid.height && !missed; tile++) {
      if (!demo.grid.isPassable(tile) || blocked(tile)) continue;
      demo.state.moveEntity('finn', tile);
      if (circle().includes('finn') && !line().includes('finn')) missed = true;
    }
    expect(missed).toBe(true);
  });
});

describe('the same blow again', () => {
  /**
   * A card that answers an ally's blow by laying the same damage on the same
   * creature again -- the roll is made against the creature, and what lands is
   * the ally's damage rather than a fresh roll of anything.
   *
   * Both its gates are about other people. An ally's blow raises the moment
   * with whoever dealt it bound as the target and whoever took it as the hit,
   * so the card asks that the target be an ally and the hit an adversary. The
   * last test here is a blow the other way round, where both gates say no.
   *
   * Offered rather than taken: a roll that succeeds with Fear costs the card,
   * so whether to answer is the player's to say. The offer is found by this
   * ability's name, and the log line carries the name too.
   */
  const AGAIN_CARD = 'fixture-card-27';

  /** The card the first test's own specimen sits on. */
  const NOTICE_CARD = 'fixture-card-26';

  const AGAIN = [
    {
      id: 'fixture-again',
      name: 'Second Blow',
      source: { kind: 'domainCard', card: AGAIN_CARD },
      text: 'When somebody beside you wounds a creature, lay the same blow on it again.',
      kind: 'reaction',
      trigger: 'nearbyTookDamage',
      action: false,
      // Asked, not taken: a roll that succeeds with Fear costs the card.
      auto: false,
      inCombatOnly: true,
      available: {
        kind: 'all',
        of: [
          { kind: 'side', of: { kind: 'target' }, is: 'ally' },
          { kind: 'side', of: { kind: 'hit' }, is: 'adversary' },
          { kind: 'withinRange', range: 'close', of: { kind: 'target' } },
        ],
      },
      effects: [
        {
          kind: 'check',
          check: {
            trait: 'spellcast',
            difficulty: 'target',
            targets: { kind: 'hit' },
            prompt: 'The same blow again, on the same creature?',
            // `always` with `hit` is the idiom for "on a success": a roll that
            // beat nobody leaves nobody bound, so the damage lands on no one.
            always: [{ kind: 'damage', dice: 'same', target: { kind: 'hit' } }],
            onSuccessWithFear: [{ kind: 'vaultCard' }],
          },
        },
      ],
    },
  ];

  const gives = (demo: DemoScene, id: string, cards: string[]): void => {
    const sheet = { ...demo.sheets.get(id)!, domainCards: cards, loadout: cards.slice(0, 5) };
    demo.sheets.set(id, sheet);
    demo.characters.set(id, deriveCharacter(sheet, characterContentFor(demo.project), demo.project.abilities).character);
    refreshWorld(demo);
  };

  /** Kara beside the husk, Mira a step behind her with the cards in hand. */
  const stage = (seed: string, cards: string[]): DemoScene => {
    const demo = standoff(seed);
    demo.askDefender = true;
    demo.project.domainCards.push(...FIXTURE_CARDS);
    for (const ability of AGAIN) demo.project.abilities.push(abilitySchema.parse(ability));
    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    husk.hitPoints = { max: 60, marked: 0 };
    standBehind(demo, 'mira', husk.tile);
    gives(demo, 'mira', cards);
    return demo;
  };

  /** The option on a reaction prompt whose label names this card, or null. */
  const offerOf = (demo: DemoScene, name: string): number | null => {
    const pending = demo.pending;
    if (pending === null || pending.kind !== 'reaction' || pending.prompt.kind !== 'choice') return null;
    const at = pending.prompt.options.findIndex((o) => o.label.includes(name));
    return at < 0 ? null : at;
  };

  it('binds the one who was hurt, not only the one who hurt them', () => {
    // A card that reads the hit. Without the second binding it reads the ally
    // who swung, and answers a moment that never happened.
    for (let seed = 1; seed < 40; seed++) {
      const demo = stage(`bindings-${seed}`, [NOTICE_CARD]);
      demo.project.abilities.push(
        abilitySchema.parse({
          id: 'fixture-notices',
          name: 'Notices',
          source: { kind: 'domainCard', card: NOTICE_CARD },
          text: 'When somebody nearby is hurt, you note who.',
          kind: 'reaction',
          trigger: 'nearbyTookDamage',
          action: false,
          available: { kind: 'side', of: { kind: 'hit' }, is: 'adversary' },
          effects: [{ kind: 'log', text: 'Mira marks the one that is bleeding.', tone: 'hope' }],
        }),
      );
      gives(demo, 'mira', [NOTICE_CARD]);

      const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
      const before = husk.hitPoints.marked;
      attackWithSelected(demo, husk.id);
      if (husk.hitPoints.marked === before) continue;
      expect(demo.log.some((l) => l.text.includes('marks the one that is bleeding'))).toBe(true);
      return;
    }
    throw new Error('Kara never landed a blow for Mira to read');
  });

  it('offers Encore when an ally lands one, and carries their damage over', () => {
    for (let seed = 1; seed < 60; seed++) {
      const demo = stage(`encore-${seed}`, [AGAIN_CARD]);
      const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
      attackWithSelected(demo, husk.id);
      const at = offerOf(demo, 'Second Blow');
      if (at === null) continue;

      const before = husk.hitPoints.marked;
      const said = demo.log.length;
      answerPending(demo, { kind: 'choose', index: at });
      let guard = 0;
      while (demo.pending !== null && guard++ < 8) answerPending(demo, { kind: 'roll' });
      const after = demo.log.slice(said).map((l) => l.text);

      expect(after.some((t) => t.includes('Mira: Second Blow'))).toBe(true);
      // A roll that beat the husk carries Kara's own damage over; one that did
      // not carries nothing, and the card is spent either way.
      if (husk.hitPoints.marked === before) continue;
      const carried = /(\d+) damage to/.exec(after.find((t) => t.includes('damage to')) ?? '');
      expect(carried).not.toBeNull();
      return;
    }
    throw new Error('Encore never landed in sixty tries');
  });

  it('puts Encore in the vault when the roll succeeds with Fear', () => {
    for (let seed = 1; seed < 60; seed++) {
      const demo = stage(`encore-fear-${seed}`, [AGAIN_CARD]);
      const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
      attackWithSelected(demo, husk.id);
      const at = offerOf(demo, 'Second Blow');
      if (at === null) continue;
      const said = demo.log.length;
      answerPending(demo, { kind: 'choose', index: at });
      let guard = 0;
      while (demo.pending !== null && guard++ < 8) answerPending(demo, { kind: 'roll' });
      const after = demo.log.slice(said).map((l) => l.text);
      if (!after.some((t) => t.includes('Success, with Fear'))) continue;
      // "Then place this card in your vault": out of the loadout, and no
      // longer offering the reaction it was just played for.
      expect(loadoutOf(demo.characters.get('mira')!)).not.toContain(AGAIN_CARD);
      return;
    }
    throw new Error('no seed put Encore through a success with Fear');
  });

  it('holds Encore back when the one bleeding is one of the party', () => {
    // The card reads "an ally deals damage to an adversary". A blow the other
    // way round names an adversary as the dealer and an ally as the hit, and
    // both gates say no.
    const demo = stage('encore-wrong-way', [AGAIN_CARD]);
    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    for (let i = 0; i < 8 && demo.encounter?.outcome === 'ongoing'; i++) {
      endTurn(demo);
      let guard = 0;
      while (demo.pending !== null && guard++ < 8) answerPending(demo, { kind: 'choose', index: 0 });
      if (demo.state.entity('kara')!.hitPoints.marked > 0) break;
    }
    expect(demo.state.entity('kara')!.hitPoints.marked).toBeGreaterThan(0);
    expect(demo.log.some((l) => l.text.includes('Mira: Second Blow'))).toBe(false);
    expect(husk.hitPoints.marked).toBe(0);
  });
});


describe('a smite held back for the next blow', () => {
  /**
   * A charge put into a weapon and kept there until a blow lands.
   *
   * Two abilities on one card. The first is what the player spends; the second
   * is where the card happens -- a reaction on `rollingDamage`, which is raised
   * only once a swing has landed and before anything counts it. So "the next
   * attack that *succeeds*", and "with a weapon", are both the trigger's own:
   * nothing below asks for either, and the charge surviving a miss falls out of
   * that rather than out of a gate.
   */
  const SMITE_CARD = 'fixture-card-22';

  /** Carries nothing. What it does is written on the card that spends it. */
  const CHARGE_CONDITION = {
    id: 'fixture-charge',
    name: 'Charged',
    text: 'Something is waiting in the weapon, and the next blow that lands spends it.',
  };

  const SMITE = [
    {
      id: 'fixture-smite',
      name: 'Charge the Blade',
      source: { kind: 'domainCard', card: SMITE_CARD },
      text: 'Spend three Hope to put a charge in your weapon, once between rests.',
      cost: { hope: 3 },
      uses: { count: 1, per: 'rest' },
      action: false,
      available: { kind: 'not', of: { kind: 'hasCondition', condition: 'fixture-charge', of: { kind: 'actor' } } },
      effects: [
        { kind: 'log', text: 'The blade takes on a light the room did not give it.', tone: 'hope' },
        // As long as the use it cost: a charge cleared when the fight ended
        // would leave the card spent until a rest and nothing to show for it.
        { kind: 'applyCondition', condition: 'fixture-charge', duration: 'rest', target: { kind: 'actor' } },
      ],
    },
    {
      id: 'fixture-smite-spends',
      name: 'Charge the Blade',
      source: { kind: 'domainCard', card: SMITE_CARD },
      text: 'The next blow that lands spends the charge, and lands as magic.',
      kind: 'reaction',
      trigger: 'rollingDamage',
      action: false,
      inCombatOnly: true,
      available: { kind: 'hasCondition', condition: 'fixture-charge', of: { kind: 'actor' } },
      effects: [
        { kind: 'log', text: 'What was waiting in the blade goes into the blow.', tone: 'hope' },
        // One effect for both halves: twice the damage, and no longer the
        // sword's kind of damage.
        { kind: 'boostDamage', double: true, type: 'magic' },
        { kind: 'clearCondition', condition: 'fixture-charge', target: { kind: 'actor' } },
      ],
    },
  ];

  /** Kara beside the husk with the card in hand and Hope to spend it. */
  const charged = (seed: string, spend: boolean) => {
    const demo = standoff(seed);
    demo.askDefender = false;
    demo.project.domainCards.push(...FIXTURE_CARDS);
    demo.project.conditionDefs.push(conditionDefSchema.parse(CHARGE_CONDITION));
    for (const ability of SMITE) demo.project.abilities.push(abilitySchema.parse(ability));
    // The same sheet in both runs, charged or not: a loadout that differs is a
    // character that differs, and the two blows would not be comparable.
    const sheet = { ...demo.sheets.get('kara')!, domainCards: [SMITE_CARD], loadout: [SMITE_CARD] };
    demo.sheets.set('kara', sheet);
    demo.characters.set('kara', deriveCharacter(sheet, characterContentFor(demo.project), demo.project.abilities).character);
    refreshWorld(demo);
    demo.state.entity('kara')!.hope = { max: 6, value: 6 };
    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    husk.hitPoints = { max: 60, marked: 0 };
    if (spend) expect(useAbility(demo, 'kara', 'fixture-smite', []).status).not.toBe('refused');
    return { demo, husk };
  };

  it('doubles the next weapon blow that lands, and only that one', () => {
    for (let seed = 1; seed < 40; seed++) {
      const bare = charged(`smite-${seed}`, false);
      attackWithSelected(bare.demo, bare.husk.id);
      if (bare.husk.hitPoints.marked === 0) continue;

      // The same seed, the same swing, with the charge spent on it. Nothing in
      // the card rolls anything, so the dice fall the same way in both.
      const lit = charged(`smite-${seed}`, true);
      expect(lit.demo.state.entity('kara')!.hope!.value).toBe(3);
      expect(lit.demo.state.entity('kara')!.conditions.has('fixture-charge')).toBe(true);
      attackWithSelected(lit.demo, lit.husk.id);

      expect(lit.husk.hitPoints.marked).toBeGreaterThan(bare.husk.hitPoints.marked);
      // Spent: the charge is gone and the swing after it is an ordinary one.
      expect(lit.demo.state.entity('kara')!.conditions.has('fixture-charge')).toBe(false);
      return;
    }
    throw new Error('Kara never landed a blow to smite with');
  });

  it('lands as magic, whatever the weapon deals', () => {
    for (let seed = 1; seed < 40; seed++) {
      // Rooted halves physical damage and does nothing to magic, so the same
      // smited blow against a rooted husk and a standing one marks the same
      // Hit Points - and would not, if the blow were still the sword's.
      const open = charged(`smite-type-${seed}`, true);
      attackWithSelected(open.demo, open.husk.id);
      if (open.husk.hitPoints.marked === 0) continue;

      const rooted = charged(`smite-type-${seed}`, true);
      rooted.demo.world.applyCondition(rooted.husk.id, 'rooted', 'scene');
      attackWithSelected(rooted.demo, rooted.husk.id);

      expect(rooted.husk.hitPoints.marked).toBe(open.husk.hitPoints.marked);
      return;
    }
    throw new Error('Kara never landed a smited blow');
  });

  it('charges once between rests, and not twice over', () => {
    const { demo } = charged('smite-once', true);
    // Already lit: the card has nothing to add to a charge that is waiting.
    expect(useAbility(demo, 'kara', 'fixture-smite', []).status).toBe('refused');
    expect(demo.log.some((l) => l.text.includes('already'))).toBe(false);
    // And with the charge spent, the use is spent with it.
    demo.world.clearCondition('kara', 'fixture-charge');
    demo.state.entity('kara')!.hope = { max: 6, value: 6 };
    const said = demo.log.length;
    expect(useAbility(demo, 'kara', 'fixture-smite', []).status).toBe('refused');
    expect(demo.log.slice(said).some((l) => l.text.includes('used until the next rest'))).toBe(true);
  });

  it('keeps the charge as long as the use it cost', () => {
    const { demo } = charged('smite-lasts', true);
    // The fight ending does not put it out: the card is spent until a rest,
    // and a charge that went out with the fight would be spent for nothing.
    demo.state.clearConditions('scene');
    expect(demo.state.entity('kara')!.conditions.has('fixture-charge')).toBe(true);
    demo.state.clearConditions('rest');
    expect(demo.state.entity('kara')!.conditions.has('fixture-charge')).toBe(false);
  });

  it('keeps the charge through a swing that misses', () => {
    for (let seed = 1; seed < 40; seed++) {
      const { demo, husk } = charged(`smite-miss-${seed}`, true);
      attackWithSelected(demo, husk.id);
      if (husk.hitPoints.marked > 0) continue;
      // "When you next successfully attack": a miss is not that swing.
      expect(demo.state.entity('kara')!.conditions.has('fixture-charge')).toBe(true);
      return;
    }
    throw new Error('Kara never missed');
  });
});

describe('a shell of light over somebody', () => {
  /**
   * A shell hung over somebody that answers the blow their armour did not
   * finish: one more threshold off, and it goes out on the blow it carries all
   * the way down to nothing.
   *
   * All of it lives in one field on the condition -- `armor` -- read where a
   * blow is counted rather than where the defence is decided, because only the
   * blow that has been answered knows whether a slot was marked for it.
   *
   * The log lines this block asserts are the engine's own: `armorAid` collects
   * its ids from whatever conditions carry that field, so the words come out
   * the same whatever the condition is called. They stay as they are.
   */
  const AURA_CARD = 'fixture-card-24';

  /** Nothing until a slot is marked, and then one threshold more. */
  const SHELL_CONDITION = {
    id: 'fixture-shell',
    name: 'Shell of Light',
    text: 'When you mark an Armor Slot, you reduce the severity of the attack by an additional threshold.',
    armor: { steps: 1, endsWhenItSaves: true },
  };

  const SHELL = [
    {
      id: 'fixture-shell-cast',
      name: 'Shell of Light',
      source: { kind: 'domainCard', card: AURA_CARD },
      text: 'Mark a Stress to close a shell of light over somebody very close by.',
      cost: { stress: 1 },
      target: { kind: 'creature', range: 'veryClose' },
      inCombatOnly: true,
      effects: [
        // One at a time: a second casting takes it off whoever was carrying it.
        { kind: 'clearCondition', condition: 'fixture-shell', target: { kind: 'party' } },
        { kind: 'applyCondition', condition: 'fixture-shell', duration: 'scene', target: { kind: 'target' } },
        { kind: 'log', text: 'A shell of light closes over them.', tone: 'hope' },
      ],
    },
  ];

  /**
   * Mira beside Kara with the spell in hand, cast on her or not, and the husk
   * swinging hard enough that an Armor Slot alone does not answer the blow.
   */
  const staged = (seed: string, cast: boolean, swing: Record<string, unknown> = { damage: '2d20+30' }): DemoScene => {
    const demo = standoff(seed);
    demo.askDefender = false;
    demo.project.domainCards.push(...FIXTURE_CARDS);
    demo.project.conditionDefs.push(conditionDefSchema.parse(SHELL_CONDITION));
    for (const ability of SHELL) demo.project.abilities.push(abilitySchema.parse(ability));
    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    standBehind(demo, 'mira', husk.tile);
    demo.project.abilities = demo.project.abilities.filter((a) => a.source.kind !== 'adversary');
    demo.project.abilities.push(
      abilitySchema.parse({
        id: 'fixture-heavy-swing',
        name: 'Heavy Swing',
        source: { kind: 'adversary', adversaries: [adversaryDefOf(demo, husk.id)!.id] },
        text: 'It swings harder than the block prints.',
        kind: 'passive',
        // Hard enough that an Armor Slot alone cannot answer it: the aura is
        // only ever worth anything on a blow the armor did not finish.
        standardAttack: swing,
      }),
    );
    const sheet = { ...demo.sheets.get('mira')!, domainCards: [AURA_CARD], loadout: [AURA_CARD] };
    demo.sheets.set('mira', sheet);
    demo.characters.set('mira', deriveCharacter(sheet, characterContentFor(demo.project), demo.project.abilities).character);
    // Kara's own cards come off: Iron Will and Get Back Up answer a blow the
    // same way the aura does, and what is under test is the aura.
    const hers = { ...demo.sheets.get('kara')!, domainCards: [], loadout: [] };
    demo.sheets.set('kara', hers);
    demo.characters.set('kara', deriveCharacter(hers, characterContentFor(demo.project), demo.project.abilities).character);
    refreshWorld(demo);
    demo.state.fear = { ...demo.state.fear, value: demo.state.fear.max };
    demo.state.entity('kara')!.hitPoints = { max: 20, marked: 0 };
    if (cast) {
      expect(useAbility(demo, 'mira', 'fixture-shell-cast', ['kara']).status).not.toBe('refused');
      expect(demo.state.entity('kara')!.conditions.has('fixture-shell')).toBe(true);
    }
    return demo;
  };

  /**
   * Turns until an Armor Slot is marked for a blow of Kara's, or null.
   *
   * A new mark, not a total. One test below hands her a single unspent slot,
   * and against a total this returned on the first turn whatever happened --
   * including a turn the creature missed on, which left the test asserting
   * about a blow that was never struck.
   */
  const untilArmored = (demo: DemoScene): number | null => {
    const kara = demo.state.entity('kara')!;
    const before = kara.armorSlots.marked;
    for (let turn = 1; turn <= 8 && demo.encounter?.outcome === 'ongoing'; turn++) {
      endTurn(demo);
      let guard = 0;
      while (demo.pending !== null && guard++ < 8) answerPending(demo, { kind: 'choose', index: 0 });
      if (kara.armorSlots.marked > before) return turn;
    }
    return null;
  };

  it('takes one more threshold off a blow the armor answered', () => {
    for (let seed = 1; seed < 60; seed++) {
      const bare = staged(`aura-${seed}`, false);
      const turns = untilArmored(bare);
      const hurt = bare.state.entity('kara')!;
      // A blow an Armor Slot was spent on that still marked Hit Points: the
      // aura is only ever worth anything on one of those.
      if (turns === null || hurt.hitPoints.marked === 0) continue;

      // The same seed and the same turns, with the aura up. Nothing in casting
      // it rolls anything, so up to that blow the fight runs the same way.
      const lit = staged(`aura-${seed}`, true);
      for (let turn = 0; turn < turns; turn++) {
        endTurn(lit);
        let guard = 0;
        while (lit.pending !== null && guard++ < 8) answerPending(lit, { kind: 'choose', index: 0 });
      }
      const shielded = lit.state.entity('kara')!;
      expect(shielded.armorSlots.marked).toBe(hurt.armorSlots.marked);
      expect(shielded.hitPoints.marked).toBeLessThan(hurt.hitPoints.marked);
      expect(lit.log.some((l) => l.text.includes('The aura around Kara takes it down to'))).toBe(true);
      return;
    }
    throw new Error('no seed put a blow through the armor in sixty tries');
  });

  it('goes out on the blow it carries all the way down to nothing', () => {
    for (let seed = 1; seed < 60; seed++) {
      // A blow that lands Major however the dice fall: two Hit Points, one off
      // for the Armor Slot, one off for the aura, and nothing marked.
      const lit = staged(`aura-out-${seed}`, true, { severity: 'major' });
      // One slot left, so the armor takes one band and the aura the other.
      const only = lit.state.entity('kara')!.armorSlots;
      lit.state.entity('kara')!.armorSlots = { ...only, marked: only.max - 1 };
      if (untilArmored(lit) === null) continue;
      const kara = lit.state.entity('kara')!;
      // A turn can hold more than one blow, so a Hit Point marked by the end
      // of it says nothing about the first: only the turn that left her
      // untouched is the one this is about.
      if (kara.hitPoints.marked > 0) continue;
      // "If this spell causes a creature who would be damaged to instead mark
      // no Hit Points, the effect ends."
      expect(lit.log.some((l) => l.text.includes('goes out'))).toBe(true);
      expect(kara.conditions.has('fixture-shell')).toBe(false);
      // And the same blow without it marks the Hit Point it saved her from.
      const bare = staged(`aura-out-${seed}`, false, { severity: 'major' });
      const slots = bare.state.entity('kara')!.armorSlots;
      bare.state.entity('kara')!.armorSlots = { ...slots, marked: slots.max - 1 };
      untilArmored(bare);
      expect(bare.state.entity('kara')!.hitPoints.marked).toBeGreaterThan(0);
      return;
    }
    throw new Error('no seed let the aura save her outright');
  });

  it('does nothing for a blow no Armor Slot answered', () => {
    for (let seed = 1; seed < 40; seed++) {
      const demo = staged(`aura-no-armor-${seed}`, true);
      const kara = demo.state.entity('kara')!;
      // Nothing left to mark, so nothing for the aura to add to.
      kara.armorSlots = { ...kara.armorSlots, marked: kara.armorSlots.max };
      for (let i = 0; i < 6 && demo.encounter?.outcome === 'ongoing' && kara.hitPoints.marked === 0; i++) {
        endTurn(demo);
        let guard = 0;
        while (demo.pending !== null && guard++ < 8) answerPending(demo, { kind: 'choose', index: 0 });
      }
      if (kara.hitPoints.marked === 0) continue;
      expect(demo.log.some((l) => l.text.includes('The aura around'))).toBe(false);
      expect(kara.conditions.has('fixture-shell')).toBe(true);
      return;
    }
    throw new Error('nothing ever got through to Kara');
  });

  it('hangs over one creature at a time', () => {
    const demo = staged('aura-one', true);
    demo.state.entity('mira')!.stress = { max: 6, marked: 0 };
    // Finn beside her, so the second casting has somebody in range to take it.
    const blocked = demo.state.blockedFor('finn');
    let stand = NO_TILE;
    demo.grid.forEachNeighbor(demo.state.entity('mira')!.tile, false, (tile) => {
      if (stand === NO_TILE && demo.grid.isPassable(tile) && !blocked(tile)) stand = tile;
    });
    demo.state.moveEntity('finn', stand);
    expect(useAbility(demo, 'mira', 'fixture-shell-cast', ['finn']).status).not.toBe('refused');
    expect(demo.state.entity('finn')!.conditions.has('fixture-shell')).toBe(true);
    expect(demo.state.entity('kara')!.conditions.has('fixture-shell')).toBe(false);
  });
});


describe('a word in the wrong ear', () => {
  /**
   * One spell, two Difficulties, and a marker that decides which. The branch is
   * the card: somebody who has heard this once is harder to say it to again,
   * and the log names the number it was rolled against, which is how two of
   * these tests tell the halves apart.
   *
   * `by: 'target'` is the rest of it. The blow is struck by the creature that
   * was whispered to, aimed at the nearest of its own and never at the party,
   * and a blow struck inside a card of the party's is neither an action nor a
   * spotlight -- which is what the last two tests are really about.
   */
  const DISCORD_CARD = 'fixture-card-9';
  const TURNED = [
    { kind: 'markStress', target: { kind: 'target' } },
    {
      kind: 'attack',
      by: 'target',
      target: { kind: 'adversaries', range: 'far', around: 'target', except: 'target', nearest: 1 },
    },
    { kind: 'applyCondition', condition: 'fixture-wise', duration: 'scene', target: { kind: 'target' } },
  ];
  const whisperCheck = (difficulty: number, prompt: string): Record<string, unknown> => ({
    kind: 'check',
    check: {
      trait: 'spellcast',
      difficulty,
      tags: ['social'],
      prompt,
      onCriticalSuccess: TURNED,
      onSuccessWithHope: TURNED,
      onSuccessWithFear: TURNED,
    },
  });
  const DISCORD = [
    {
      id: 'fixture-discord',
      name: 'Words of Discord',
      source: { kind: 'domainCard', card: DISCORD_CARD },
      text: 'Say the wrong thing to something and let it take that out on its own.',
      target: { kind: 'creature', range: 'melee' },
      inCombatOnly: true,
      effects: [
        {
          kind: 'branch',
          when: { kind: 'hasCondition', condition: 'fixture-wise', of: { kind: 'target' } },
          then: [
            { kind: 'log', text: 'They have heard this voice before, and are ready for it.', tone: 'fear' },
            whisperCheck(18, 'A word in the wrong ear, to somebody who is wise to it.'),
          ],
          otherwise: [whisperCheck(13, 'A word in the wrong ear: turn them on the one beside them.')],
        },
      ],
    },
  ];

  /** The marker itself, which carries nothing and only says it has happened. */
  const WISE = {
    id: 'fixture-wise',
    name: 'Wise to It',
    text: 'They have been whispered to once, and are harder to whisper to again.',
  };

  const carry = (demo: DemoScene): void => {
    demo.project.domainCards.push(...FIXTURE_CARDS);
    demo.project.conditionDefs.push(conditionDefSchema.parse(WISE));
    for (const ability of DISCORD) demo.project.abilities.push(abilitySchema.parse(ability));
  };

  /**
   * Mira beside one husk with the card in hand, and a second husk beside it.
   * The whisper is a Spellcast Roll, so the one who says it is the wizard.
   */
  const whispering = (seed: string) => {
    const demo = standoff(seed);
    demo.askDefender = false;
    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    husk.hitPoints = { max: 40, marked: 0 };
    husk.stress = { max: 6, marked: 0 };
    // A second one back on its feet, and Mira, both standing beside the first.
    const other = demo.state.entitiesOf('adversary').find((e) => !e.alive)!;
    other.alive = true;
    other.hitPoints = { max: 40, marked: 0 };
    const beside = (id: string): void => {
      const blocked = demo.state.blockedFor(id);
      let stand = NO_TILE;
      demo.grid.forEachNeighbor(husk.tile, false, (tile) => {
        if (stand === NO_TILE && demo.grid.isPassable(tile) && !blocked(tile)) stand = tile;
      });
      if (stand !== NO_TILE) demo.state.moveEntity(id, stand);
    };
    beside(other.id);
    beside('mira');

    carry(demo);
    const sheet = { ...demo.sheets.get('mira')!, domainCards: [DISCORD_CARD], loadout: [DISCORD_CARD] };
    demo.sheets.set('mira', sheet);
    demo.characters.set('mira', deriveCharacter(sheet, characterContentFor(demo.project), demo.project.abilities).character);
    refreshWorld(demo);
    return { demo, husk, other };
  };

  const whisper = (demo: DemoScene, at: string): string[] => {
    const said = demo.log.length;
    demo.party.select('mira');
    useAbility(demo, 'mira', 'fixture-discord', [at]);
    let guard = 0;
    while (demo.pending !== null && guard++ < 8) answerPending(demo, { kind: 'roll' });
    return demo.log.slice(said).map((l) => l.text);
  };

  it('rolls it with what she was carrying for her next roll', () => {
    const { demo, husk } = whispering('discord-carried');
    demo.world.applyCondition('mira', 'inevitable', 'scene');
    const before = demo.rolls.length;
    whisper(demo, husk.id);
    // The first roll of the whisper is the Spellcast Roll itself.
    expect(demo.rolls[before]!.roll.advantageDie).toBeGreaterThan(0);
    // And the roll it was carried into is the one that spends it.
    expect(demo.state.entity('mira')!.conditions.has('inevitable')).toBe(false);
  });

  it('carries nothing that was only ever said about a swing', () => {
    const { demo, husk } = whispering('discord-chilled');
    demo.world.applyCondition('mira', 'chilled', 'scene');
    const before = demo.rolls.length;
    whisper(demo, husk.id);
    expect(demo.rolls[before]!.roll.advantageDie).toBe(0);
  });

  it('turns an adversary on the one standing beside it', () => {
    for (let seed = 1; seed < 60; seed++) {
      const { demo, husk, other } = whispering(`discord-${seed}`);
      const after = whisper(demo, husk.id);
      if (!after.some((t) => /Success|Critical/.test(t))) continue;

      // "The target must mark a Stress and make an attack against another
      // adversary instead of against you or your allies."
      expect(husk.stress.marked).toBeGreaterThan(0);
      expect(after.some((t) => t.includes(`${adversaryDefOf(demo, husk.id)!.attackName}`))).toBe(true);
      // Whatever the swing did, it was aimed at the other one and not the party.
      expect(demo.state.entity('kara')!.hitPoints.marked).toBe(0);
      expect(husk.hitPoints.marked).toBe(0);
      expect(husk.conditions.has('fixture-wise')).toBe(true);
      // And the fight is left in one piece, whether or not the blow landed.
      expect(demo.pending).toBeNull();
      expect(other.alive || demo.encounter?.outcome === 'ongoing').toBe(true);
      return;
    }
    throw new Error('the whisper never took in sixty tries');
  });

  it('is harder to say to somebody who has heard it before', () => {
    const { demo, husk } = whispering('discord-again');
    demo.world.applyCondition(husk.id, 'fixture-wise', 'scene');
    const after = whisper(demo, husk.id);
    expect(after.some((t) => t.includes('heard this voice before'))).toBe(true);
    expect(after.some((t) => t.includes('vs 18'))).toBe(true);
    expect(after.some((t) => t.includes('vs 13'))).toBe(false);
  });

  it('says 13 to somebody who has not', () => {
    const { demo, husk } = whispering('discord-first');
    const after = whisper(demo, husk.id);
    expect(after.some((t) => t.includes('vs 13'))).toBe(true);
    expect(after.some((t) => t.includes('heard this voice before'))).toBe(false);
  });

  it('finds nobody to turn them on when they stand alone', () => {
    for (let seed = 1; seed < 60; seed++) {
      const { demo, husk, other } = whispering(`discord-alone-${seed}`);
      other.alive = false;
      const after = whisper(demo, husk.id);
      if (!after.some((t) => /Success|Critical/.test(t))) continue;
      // The Stress is marked and the whisper takes; there is simply nobody for
      // them to turn on, which is a room with one creature in it, not a fault.
      expect(husk.stress.marked).toBeGreaterThan(0);
      expect(after.some((t) => t.includes('nothing to attack'))).toBe(true);
      expect(demo.state.entity('kara')!.hitPoints.marked).toBe(0);
      return;
    }
    throw new Error('the whisper never took in sixty tries');
  });

  it('leaves the fight in one piece when the compelled blow kills', () => {
    for (let seed = 1; seed < 80; seed++) {
      const { demo, husk, other } = whispering(`discord-kill-${seed}`);
      // The other one is a blow from falling.
      other.hitPoints = { max: 1, marked: 0 };
      const after = whisper(demo, husk.id);
      if (other.alive) continue;

      expect(after.some((t) => /Success|Critical/.test(t))).toBe(true);
      // A blow struck by an adversary inside a card of the party's is neither
      // an action nor a spotlight, so nothing else counts the room: the one
      // left standing is the one that was whispered to, and nothing waits.
      expect(demo.pending).toBeNull();
      expect(demo.encounter?.outcome).toBe('ongoing');
      expect(demo.state.entitiesOf('adversary').filter((e) => e.alive).map((e) => e.id)).toEqual([husk.id]);

      // And with that one down as well, the fight is over rather than hanging.
      demo.world.damage({ kind: 'entity', id: husk.id }, husk.hitPoints.max);
      settleFight(demo);
      expect(demo.encounter?.outcome).not.toBe('ongoing');
      return;
    }
    throw new Error('the compelled blow never landed a kill');
  });
});


describe('a shout the next one hears', () => {
  /**
   * A card that marks somebody, and a condition that pays whoever swings at
   * them next. Two content types for one idea: the card cannot pay it, because
   * the one who collects is somebody the card has never heard of.
   *
   * The two names differ on purpose — the offer says one thing and the payout
   * another — because one test below reads them apart in a queue of offers.
   */
  const SHOUT_CARD = 'fixture-card-16';
  const FOLLOW_CARD = 'fixture-card-11';
  const SHOUT = [
    {
      id: 'fixture-shout',
      name: 'Lead by Example',
      source: { kind: 'domainCard', card: SHOUT_CARD },
      text: 'Having hurt something, say so, and the next one to swing takes heart.',
      kind: 'reaction',
      trigger: 'dealtDamage',
      action: false,
      auto: false,
      cost: { stress: 1 },
      inCombatOnly: true,
      effects: [
        { kind: 'log', text: 'They shout something, and the room hears it.', tone: 'hope' },
        { kind: 'applyCondition', condition: 'fixture-led', duration: 'scene', target: { kind: 'target' } },
      ],
    },
  ];

  /**
   * The debt, carried by the one it was marked on. Paid once, to whoever swung,
   * and gone with the paying — which is what makes it a debt rather than a
   * standing price.
   */
  const LED = {
    id: 'fixture-led',
    name: 'Led by Example',
    text: 'The next one to attack them can clear a Stress or gain a Hope.',
    payout: {
      on: 'attacked',
      effects: [
        {
          kind: 'choice',
          title: 'They led by example',
          body: 'Take heart from it.',
          options: [
            { label: 'Clear a Stress', effects: [{ kind: 'clearStress', amount: 1, target: { kind: 'actor' } }] },
            { label: 'Gain a Hope', effects: [{ kind: 'gainHope', amount: 1, target: { kind: 'actor' } }] },
          ],
        },
      ],
    },
  };

  const carry = (demo: DemoScene, abilities: readonly Record<string, unknown>[]): void => {
    demo.project.domainCards.push(...FIXTURE_CARDS);
    demo.project.conditionDefs.push(conditionDefSchema.parse(LED));
    for (const ability of abilities) demo.project.abilities.push(abilitySchema.parse(ability));
  };

  /** Kara beside the husk with the card in hand, Finn beside it as well. */
  const rallying = (seed: string) => {
    const demo = standoff(seed);
    demo.askDefender = true;
    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    husk.hitPoints = { max: 60, marked: 0 };
    const blocked = demo.state.blockedFor('finn');
    let stand = NO_TILE;
    demo.grid.forEachNeighbor(husk.tile, false, (tile) => {
      if (stand === NO_TILE && demo.grid.isPassable(tile) && !blocked(tile)) stand = tile;
    });
    demo.state.moveEntity('finn', stand);
    carry(demo, SHOUT);
    const sheet = { ...demo.sheets.get('kara')!, domainCards: [SHOUT_CARD], loadout: [SHOUT_CARD] };
    demo.sheets.set('kara', sheet);
    demo.characters.set('kara', deriveCharacter(sheet, characterContentFor(demo.project), demo.project.abilities).character);
    refreshWorld(demo);
    return { demo, husk };
  };

  /** Kara swings and plays the card if she is offered it; true when she did. */
  const shout = (demo: DemoScene, husk: string): boolean => {
    demo.party.select('kara');
    attackWithSelected(demo, husk);
    for (let guard = 0; guard < 6 && demo.pending !== null; guard++) {
      const pending = demo.pending;
      if (pending.kind === 'reaction' && pending.prompt.kind === 'choice') {
        const at = pending.prompt.options.findIndex((o) => o.label.includes('Lead by Example'));
        answerPending(demo, { kind: 'choose', index: at < 0 ? 0 : at });
        continue;
      }
      answerPending(demo, { kind: 'choose', index: 0 });
    }
    return demo.state.entity(husk)!.conditions.has('fixture-led');
  };

  it('pays the next one to swing at them, and not the one who shouted', () => {
    for (let seed = 1; seed < 60; seed++) {
      const { demo, husk } = rallying(`rally-${seed}`);
      const before = demo.state.entity('kara')!.stress.marked;
      if (!shout(demo, husk.id)) continue;

      // She paid a Stress for it, and collected nothing on her own swing.
      expect(demo.state.entity('kara')!.stress.marked).toBeGreaterThan(before);
      expect(demo.log.some((l) => l.text.includes('Take heart from it'))).toBe(false);
      expect(demo.pending).toBeNull();

      // Finn swings at the same one, and is the one who takes heart from it.
      const finn = demo.state.entity('finn')!;
      finn.stress = { max: 6, marked: 3 };
      demo.party.select('finn');
      attackWithSelected(demo, husk.id);
      // Offered the way a card is, so it queues behind anything else Finn was
      // already being asked about rather than sitting on top of it.
      const asked = demo.pending;
      expect(asked?.kind).toBe('reaction');
      const at = asked?.prompt.kind === 'choice' ? asked.prompt.options.findIndex((o) => o.label.includes('Led by Example')) : -1;
      expect(at).toBeGreaterThan(0);
      answerPending(demo, { kind: 'choose', index: at });
      // Then the card's own question: clear a Stress, or gain a Hope.
      expect(demo.pending?.prompt.kind === 'choice' ? demo.pending.prompt.title : '').toContain('led by example');
      answerPending(demo, { kind: 'choose', index: 0 });
      expect(finn.stress.marked).toBe(2);
      // Paid once: the mark is gone with it.
      expect(demo.state.entity(husk.id)!.conditions.has('fixture-led')).toBe(false);
      return;
    }
    throw new Error('Kara was never offered the card in sixty tries');
  });

  it('pays on a swing that misses, because a swing is a swing', () => {
    for (let seed = 1; seed < 60; seed++) {
      const { demo, husk } = rallying(`rally-miss-${seed}`);
      if (!shout(demo, husk.id)) continue;
      demo.party.select('finn');
      const said = demo.log.length;
      attackWithSelected(demo, husk.id);
      const after = demo.log.slice(said).map((l) => l.text);
      if (!after.some((t) => t.includes('and misses'))) continue;
      // "The next PC to make an attack against that adversary" - the card says
      // nothing about landing it.
      expect(demo.pending?.kind).toBe('reaction');
      expect(JSON.stringify(demo.pending)).toContain('Led by Example');
      return;
    }
    throw new Error('Finn never missed after a shout');
  });

  it('does not pay the one who marked them on the swing that marked them', () => {
    // The offered card cannot show this: the mark goes on when the player
    // answers, which is after the swing is over. A card that runs on its own
    // marks them mid-blow, and that is the one the order has to hold for.
    for (let seed = 1; seed < 60; seed++) {
      const { demo, husk } = rallying(`rally-self-${seed}`);
      demo.project.abilities.push(
        abilitySchema.parse({
          id: 'rallying-cry',
          name: 'Rallying Cry',
          source: { kind: 'domainCard', card: SHOUT_CARD },
          text: 'When you deal damage, the room takes heart at once.',
          kind: 'reaction',
          trigger: 'dealtDamage',
          action: false,
          effects: [{ kind: 'applyCondition', condition: 'fixture-led', duration: 'scene', target: { kind: 'target' } }],
        }),
      );
      refreshWorld(demo);

      demo.party.select('kara');
      const marked = demo.state.entity(husk.id)!.hitPoints.marked;
      attackWithSelected(demo, husk.id);
      let guard = 0;
      while (demo.pending !== null && guard++ < 6) answerPending(demo, { kind: 'choose', index: 0 });
      if (demo.state.entity(husk.id)!.hitPoints.marked === marked) continue;

      expect(demo.state.entity(husk.id)!.conditions.has('fixture-led')).toBe(true);
      expect(demo.log.some((l) => l.text.includes('Take heart from it'))).toBe(false);
      return;
    }
    throw new Error('Kara never landed a blow in sixty tries');
  });

  it('queues behind a card of the one collecting it, rather than over it', () => {
    // Both questions belong to Finn, and both have to reach him: a payout
    // written straight into the pending slot would take the place of the card
    // he was already being offered.
    for (let seed = 1; seed < 60; seed++) {
      const { demo, husk } = rallying(`rally-queue-${seed}`);
      demo.project.abilities.push(
        abilitySchema.parse({
          id: 'follow-through',
          name: 'Follow Through',
          source: { kind: 'domainCard', card: FOLLOW_CARD },
          text: 'When you deal damage, you can say something about it.',
          kind: 'reaction',
          trigger: 'dealtDamage',
          action: false,
          auto: false,
          effects: [{ kind: 'log', text: 'Finn follows through.', tone: 'hope' }],
        }),
      );
      const his = { ...demo.sheets.get('finn')!, domainCards: [FOLLOW_CARD], loadout: [FOLLOW_CARD] };
      demo.sheets.set('finn', his);
      demo.characters.set('finn', deriveCharacter(his, characterContentFor(demo.project), demo.project.abilities).character);
      refreshWorld(demo);
      if (!shout(demo, husk.id)) continue;

      demo.party.select('finn');
      const marked = demo.state.entity(husk.id)!.hitPoints.marked;
      attackWithSelected(demo, husk.id);
      if (demo.state.entity(husk.id)!.hitPoints.marked === marked) continue;

      const seen: string[] = [];
      for (let guard = 0; guard < 8 && demo.pending !== null; guard++) {
        const pending = demo.pending;
        if (pending.kind === 'reaction' && pending.prompt.kind === 'choice') {
          seen.push(...pending.prompt.options.map((o) => o.label));
        }
        answerPending(demo, { kind: 'choose', index: 0 });
      }
      expect(seen.some((label) => label.includes('Follow Through'))).toBe(true);
      expect(seen.some((label) => label.includes('Led by Example'))).toBe(true);
      return;
    }
    throw new Error('Finn never landed a blow after a shout');
  });

  it('is not offered to somebody swinging at anybody else', () => {
    for (let seed = 1; seed < 60; seed++) {
      const { demo, husk } = rallying(`rally-elsewhere-${seed}`);
      if (!shout(demo, husk.id)) continue;
      // Another one on its feet, standing where Finn can reach it.
      const other = demo.state.entitiesOf('adversary').find((e) => !e.alive)!;
      other.alive = true;
      other.hitPoints = { max: 40, marked: 0 };
      const blocked = demo.state.blockedFor(other.id);
      let stand = NO_TILE;
      demo.grid.forEachNeighbor(demo.state.entity('finn')!.tile, false, (tile) => {
        if (stand === NO_TILE && demo.grid.isPassable(tile) && !blocked(tile)) stand = tile;
      });
      if (stand === NO_TILE) continue;
      demo.state.moveEntity(other.id, stand);

      demo.party.select('finn');
      attackWithSelected(demo, other.id);
      expect(demo.log.some((l) => l.text.includes('Take heart from it'))).toBe(false);
      expect(demo.state.entity(husk.id)!.conditions.has('fixture-led')).toBe(true);
      return;
    }
    throw new Error('Kara was never offered the card in sixty tries');
  });
});


describe('one swing through all of them', () => {
  /** Kara with the card in hand and two husks standing beside her. */
  const surrounded = (seed: string, cards: string[]) => {
    const demo = standoff(seed);
    demo.askDefender = false;
    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    husk.hitPoints = { max: 60, marked: 0 };
    const other = demo.state.entitiesOf('adversary').find((e) => !e.alive)!;
    other.alive = true;
    other.hitPoints = { max: 60, marked: 0 };
    const blocked = demo.state.blockedFor(other.id);
    let stand = NO_TILE;
    demo.grid.forEachNeighbor(demo.state.entity('kara')!.tile, false, (tile) => {
      if (stand === NO_TILE && demo.grid.isPassable(tile) && !blocked(tile) && tile !== husk.tile) stand = tile;
    });
    demo.state.moveEntity(other.id, stand);
    const sheet = { ...demo.sheets.get('kara')!, domainCards: cards, loadout: cards.slice(0, 5) };
    demo.sheets.set('kara', sheet);
    demo.characters.set('kara', deriveCharacter(sheet, characterContentFor(demo.project), demo.project.abilities).character);
    refreshWorld(demo);
    demo.state.entity('kara')!.hope = { max: 6, value: 6 };
    return { demo, husk, other };
  };

  it('swings at everything within the weapon and spends a Hope for it', () => {
    for (let seed = 1; seed < 40; seed++) {
      const { demo, husk, other } = surrounded(`splinter-${seed}`, ['splintering-strike']);
      const said = demo.log.length;
      expect(useAbility(demo, 'kara', 'splintering-strike', []).status).not.toBe('refused');
      let guard = 0;
      while (demo.pending !== null && guard++ < 8) answerPending(demo, { kind: 'roll' });
      const after = demo.log.slice(said).map((l) => l.text);

      // Both of them were swung at, whatever came of it.
      const named = adversaryDefOf(demo, husk.id)!.name;
      expect(after.filter((t) => t.includes(named)).length).toBeGreaterThanOrEqual(2);
      // Read off the log rather than the pool: a success with Hope hands one
      // straight back, so the number on the sheet says nothing about the cost.
      expect(after.some((t) => t.includes('Spends 1 Hope.'))).toBe(true);
      // "Once per long rest": the use is spent, and a short rest is not it.
      expect(demo.scenario.abilityUses.get(useKey('kara', 'splintering-strike'))).toBe(1);
      return;
    }
    throw new Error('the card never ran');
  });

  it('rolls one more of the weapon dice behind it', () => {
    // The extra die shifts the stream, so the two runs cannot be compared at
    // one seed: what is compared is the total they mark over many.
    const total = (extra: boolean): number => {
      let marked = 0;
      for (let seed = 1; seed < 80; seed++) {
        const { demo, husk, other } = surrounded(`splinter-die-${seed}`, ['splintering-strike']);
        if (!extra) {
          const plain = demo.project.abilities.map((a) =>
            a.id !== 'splintering-strike'
              ? a
              : abilitySchema.parse({
                  ...a,
                  effects: a.effects.map((e) => (e.kind === 'attack' ? { ...e, damageDice: undefined } : e)),
                }),
          );
          demo.project.abilities = plain;
          refreshWorld(demo);
        }
        useAbility(demo, 'kara', 'splintering-strike', []);
        let guard = 0;
        while (demo.pending !== null && guard++ < 8) answerPending(demo, { kind: 'roll' });
        marked += husk.hitPoints.marked + other.hitPoints.marked;
      }
      return marked;
    };
    expect(total(true)).toBeGreaterThan(total(false));
  });
});


describe('a step across the room without crossing it', () => {
  /**
   * A card that puts its holder somewhere else without walking her there, and
   * can bring whoever is standing with her for a Hope a head.
   *
   * Three success faces, all the same one: the engine reads them separately, so
   * a specimen that filled only the best of them would leave two thirds of the
   * seeds proving nothing. The arms are built once and shared.
   */
  const BLINK_CARD = 'fixture-card-20';

  /** The offer, and the only part of it the dice do not decide. */
  const TOGETHER = {
    kind: 'choice',
    title: 'Step across',
    body: 'Anyone standing with you can come.',
    options: [
      { label: 'Step alone', effects: [] },
      {
        label: 'Bring them along (a Hope each)',
        // Offered only when she can pay for all of them: a count measured
        // against the Hope she is actually holding.
        available: {
          kind: 'all',
          of: [
            { kind: 'nearby', of: { kind: 'allies', range: 'veryClose' }, op: '>=', value: 1 },
            {
              kind: 'nearby',
              of: { kind: 'allies', range: 'veryClose' },
              op: '<=',
              value: { pool: 'hope', measure: 'available' },
            },
          ],
        },
        // They arrive first, so who is standing with her is read from where
        // they were all standing rather than from where she has already gone.
        effects: [
          { kind: 'spendHope', amount: { count: { kind: 'allies', range: 'veryClose' } } },
          { kind: 'move', who: { kind: 'allies', range: 'veryClose' }, to: 'point', teleport: true, budget: 'far' },
        ],
      },
    ],
  };

  /** The offer, then her own arrival. Every success face does both. */
  const ARRIVE = [TOGETHER, { kind: 'move', to: 'point', teleport: true, budget: 'far' }];

  const STEP = [
    {
      id: 'fixture-blink',
      name: 'Step Across',
      source: { kind: 'domainCard', card: BLINK_CARD },
      text: 'Spend a Hope to be standing somewhere else, and bring whoever is with you for a Hope a head.',
      cost: { hope: 1 },
      target: { kind: 'point', range: 'far' },
      effects: [
        {
          kind: 'check',
          check: {
            trait: 'spellcast',
            difficulty: 12,
            prompt: 'Step across the room without crossing it.',
            onCriticalSuccess: ARRIVE,
            onSuccessWithHope: ARRIVE,
            onSuccessWithFear: ARRIVE,
          },
        },
      ],
    },
  ];

  /** Mira beside Kara with the card in hand, both beside the husk. */
  const blinking = (seed: string) => {
    const demo = standoff(seed);
    demo.askDefender = false;
    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    standBehind(demo, 'mira', husk.tile);
    demo.project.domainCards.push(...FIXTURE_CARDS);
    for (const ability of STEP) demo.project.abilities.push(abilitySchema.parse(ability));
    const sheet = { ...demo.sheets.get('mira')!, domainCards: [BLINK_CARD], loadout: [BLINK_CARD] };
    demo.sheets.set('mira', sheet);
    demo.characters.set('mira', deriveCharacter(sheet, characterContentFor(demo.project), demo.project.abilities).character);
    refreshWorld(demo);
    demo.state.entity('mira')!.hope = { max: 6, value: 6 };
    demo.party.select('mira');
    return { demo, husk };
  };

  /**
   * Answer whatever is being asked: a roll is rolled, and a choice takes the
   * option at `pick` - clamped, because "how many Hope" lists one per Hope.
   */
  const answerAll = (demo: DemoScene, pick: number): void => {
    for (let guard = 0; guard < 8 && demo.pending !== null; guard++) {
      const prompt = demo.pending.prompt;
      if (prompt.kind !== 'choice') {
        answerPending(demo, { kind: 'roll' });
        continue;
      }
      answerPending(demo, { kind: 'choose', index: Math.min(pick, prompt.options.length - 1) });
    }
  };

  /**
   * Somewhere the card may be aimed that everybody named can be put: free
   * ground, and within Far of each of them - somebody standing beside the
   * caster is a step further out than she is, and the spell carries them too.
   */
  const somewhereElse = (demo: DemoScene, who: readonly string[]): number => {
    const card = demo.project.abilities.find((a) => a.id === 'fixture-blink')!;
    const taken = new Set(demo.state.entitiesOf('party').concat(demo.state.entitiesOf('adversary')).map((e) => e.tile));
    for (const tile of pointTiles(demo, 'mira', card)) {
      if (taken.has(tile) || !demo.grid.isPassable(tile)) continue;
      if (who.some((id) => demo.state.blockedFor(id)(tile))) continue;
      if (who.some((id) => demo.world.bandBetween(demo.state.entity(id)!.tile, tile) === null)) continue;
      if (who.some((id) => !reaches(demo.world.bandBetween(demo.state.entity(id)!.tile, tile)!, 'far'))) continue;
      return tile;
    }
    return NO_TILE;
  };

  it('puts her on the spot she aimed at, whatever is in the way', () => {
    for (let seed = 1; seed < 40; seed++) {
      const { demo } = blinking(`blink-${seed}`);
      const at = somewhereElse(demo, ['mira']);
      if (at === NO_TILE) continue;
      const mira = demo.state.entity('mira')!;
      const from = mira.tile;

      expect(useAbility(demo, 'mira', 'fixture-blink', [], { point: at }).status).not.toBe('refused');
      answerAll(demo, 0);
      if (!demo.log.some((l) => /Success|Critical/.test(l.text))) continue;

      // Not a walk: she is on the tile itself, not as near to it as a walk got.
      expect(mira.tile).toBe(at);
      expect(mira.tile).not.toBe(from);
      return;
    }
    throw new Error('the blink never took in forty tries');
  });

  it('takes whoever is standing with her when the Hope goes in', () => {
    for (let seed = 1; seed < 60; seed++) {
      const { demo } = blinking(`blink-with-${seed}`);
      const at = somewhereElse(demo, ['mira', 'kara']);
      if (at === NO_TILE) continue;
      const kara = demo.state.entity('kara')!;
      const stood = kara.tile;

      expect(useAbility(demo, 'mira', 'fixture-blink', [], { point: at }).status).not.toBe('refused');
      // Option 1 brings them along; option 0 steps across alone.
      answerAll(demo, 1);
      if (!demo.log.some((l) => /Success|Critical/.test(l.text))) continue;
      if (demo.state.entity('mira')!.tile === stood) continue;

      // Kara came too. Whoever is brought arrives first, so she has the spot
      // itself and the caster is standing next to her.
      expect(kara.tile).not.toBe(stood);
      expect(kara.tile).toBe(at);
      expect(demo.world.bandBetween(demo.state.entity('mira')!.tile, at)).toBe('melee');
      return;
    }
    throw new Error('nobody was ever brought along');
  });

  it('asks a Hope a head, and does not offer what she cannot pay for', () => {
    for (let seed = 1; seed < 40; seed++) {
      const { demo } = blinking(`blink-price-${seed}`);
      const mira = demo.state.entity('mira')!;
      // Kara and Finn both standing with her, so the crossing costs two.
      const blocked = demo.state.blockedFor('finn');
      let stand = NO_TILE;
      demo.grid.forEachNeighbor(mira.tile, false, (tile) => {
        if (stand === NO_TILE && demo.grid.isPassable(tile) && !blocked(tile)) stand = tile;
      });
      if (stand === NO_TILE) continue;
      demo.state.moveEntity('finn', stand);
      const at = somewhereElse(demo, ['mira', 'kara', 'finn']);
      if (at === NO_TILE) continue;

      // A Hope for the spell and nothing over. A success with Hope hands one
      // back before the choice is put, so even then there is one for one of
      // them and not for both.
      mira.hope = { max: 6, value: 1 };
      expect(useAbility(demo, 'mira', 'fixture-blink', [], { point: at }).status).not.toBe('refused');
      let offered: string[] = [];
      for (let guard = 0; guard < 8 && demo.pending !== null; guard++) {
        const prompt = demo.pending.prompt;
        if (prompt.kind !== 'choice') {
          answerPending(demo, { kind: 'roll' });
          continue;
        }
        offered = prompt.options.map((o) => o.label);
        answerPending(demo, { kind: 'choose', index: 0 });
      }
      if (!demo.log.some((l) => /Success|Critical/.test(l.text))) continue;
      expect(offered).toEqual(['Step alone']);
      expect(demo.state.entity('kara')!.tile).not.toBe(at);

      // With a Hope for each of them it is offered, and each of them is paid for.
      const { demo: rich } = blinking(`blink-price-${seed}`);
      rich.state.moveEntity('finn', stand);
      const richMira = rich.state.entity('mira')!;
      richMira.hope = { max: 6, value: 4 };
      expect(useAbility(rich, 'mira', 'fixture-blink', [], { point: at }).status).not.toBe('refused');
      let took: string[] = [];
      for (let guard = 0; guard < 8 && rich.pending !== null; guard++) {
        const prompt = rich.pending.prompt;
        if (prompt.kind !== 'choice') {
          answerPending(rich, { kind: 'roll' });
          continue;
        }
        took = prompt.options.map((o) => o.label);
        answerPending(rich, { kind: 'choose', index: Math.min(1, prompt.options.length - 1) });
      }
      if (!rich.log.some((l) => /Success|Critical/.test(l.text))) continue;
      expect(took.length).toBe(2);
      expect(rich.log.some((l) => l.text.includes('Spends 2 Hope'))).toBe(true);
      return;
    }
    throw new Error('no seed put two of the party beside her');
  });

  it('leaves them where they stand when no Hope goes in', () => {
    for (let seed = 1; seed < 60; seed++) {
      const { demo } = blinking(`blink-alone-${seed}`);
      const at = somewhereElse(demo, ['mira', 'kara']);
      if (at === NO_TILE) continue;
      const kara = demo.state.entity('kara')!;
      const stood = kara.tile;

      expect(useAbility(demo, 'mira', 'fixture-blink', [], { point: at }).status).not.toBe('refused');
      // Option 0 is going alone.
      answerAll(demo, 0);
      if (!demo.log.some((l) => /Success|Critical/.test(l.text))) continue;
      if (demo.state.entity('mira')!.tile !== at) continue;

      expect(kara.tile).toBe(stood);
      return;
    }
    throw new Error('the blink never took in sixty tries');
  });
});


describe('a line of light down the room', () => {
  /**
   * Mira with the beam in hand and the rest of the party wounded, standing in
   * a row so a line from her runs over them.
   */
  const beaming = (seed: string): { demo: DemoScene; at: number } => {
    const demo = standoff(seed);
    demo.askDefender = false;
    const sheet = { ...demo.sheets.get('mira')!, domainCards: ['salvation-beam'], loadout: ['salvation-beam'] };
    demo.sheets.set('mira', sheet);
    demo.characters.set('mira', deriveCharacter(sheet, characterContentFor(demo.project), demo.project.abilities).character);
    refreshWorld(demo);
    demo.state.entity('mira')!.stress = { max: 6, marked: 0 };
    demo.party.select('mira');

    // A row: Mira, then Kara and Finn on the two tiles after her, and the beam
    // aimed past them. A line drawn through a scattered party catches nobody,
    // and where they happen to stand is not what is under test.
    const grid = demo.grid;
    const row = (y: number, x: number): number => grid.indexOf(x, y);
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x + 4 < grid.width; x++) {
        const tiles = [row(y, x), row(y, x + 1), row(y, x + 2), row(y, x + 4)];
        if (tiles.some((tile) => !grid.isPassable(tile))) continue;
        if (tiles.some((tile) => demo.state.entitiesOf('adversary').some((e) => e.alive && e.tile === tile))) continue;
        demo.state.moveEntity('mira', tiles[0]!);
        demo.state.moveEntity('kara', tiles[1]!);
        demo.state.moveEntity('finn', tiles[2]!);
        return { demo, at: tiles[3]! };
      }
    }
    throw new Error('no room on this map for a row of three');
  };

  /** Everyone the beam would catch if it were aimed at this tile. */
  const caught = (demo: DemoScene, tile: number): string[] => {
    const was = demo.scenario.actorId;
    demo.scenario.actorId = 'mira';
    const found = demo.world.resolveTargets({ kind: 'inPath', side: 'allies' }, { targets: [], hit: [], point: tile });
    demo.scenario.actorId = was;
    return found;
  };



  it('clears Hit Points along the line, shared out rather than given to each', () => {
    for (let seed = 1; seed < 60; seed++) {
      const { demo, at } = beaming(`beam-${seed}`);
      const along = caught(demo, at);
      if (along.length < 2) continue;
      // Two Hit Points on each of them, and three Stress in the beam: shared
      // out that is three cleared in all, and one of them is still wounded.
      for (const id of along) demo.state.entity(id)!.hitPoints = { max: 8, marked: 2 };
      const before = along.reduce((sum, id) => sum + demo.state.entity(id)!.hitPoints.marked, 0);

      expect(useAbility(demo, 'mira', 'salvation-beam', [], { point: at }).status).not.toBe('refused');
      for (let guard = 0; guard < 8 && demo.pending !== null; guard++) {
        const prompt = demo.pending.prompt;
        if (prompt.kind !== 'choice') {
          answerPending(demo, { kind: 'roll' });
          continue;
        }
        // "A Stress for each Hit Point": the options run from one upwards.
        answerPending(demo, { kind: 'choose', index: Math.min(2, prompt.options.length - 1) });
      }
      if (!demo.log.some((l) => /Success|Critical/.test(l.text))) continue;

      const after = along.reduce((sum, id) => sum + demo.state.entity(id)!.hitPoints.marked, 0);
      const cleared = before - after;
      expect(cleared).toBe(3);
      expect(demo.state.entity('mira')!.stress.marked).toBe(3);
      // Shared out: nobody was given all three, so both of them are better off.
      for (const id of along) expect(demo.state.entity(id)!.hitPoints.marked).toBeLessThan(2);
      return;
    }
    throw new Error('no seed put two of the party on one line');
  });

  it('runs out of wounds rather than of beam', () => {
    for (let seed = 1; seed < 60; seed++) {
      const { demo, at } = beaming(`beam-spare-${seed}`);
      const along = caught(demo, at);
      if (along.length < 2) continue;
      // One Hit Point between them and every Stress she has in the beam.
      for (const id of along) demo.state.entity(id)!.hitPoints = { max: 8, marked: 0 };
      demo.state.entity(along[0]!)!.hitPoints = { max: 8, marked: 1 };

      expect(useAbility(demo, 'mira', 'salvation-beam', [], { point: at }).status).not.toBe('refused');
      for (let guard = 0; guard < 8 && demo.pending !== null; guard++) {
        const prompt = demo.pending.prompt;
        if (prompt.kind !== 'choice') {
          answerPending(demo, { kind: 'roll' });
          continue;
        }
        answerPending(demo, { kind: 'choose', index: prompt.options.length - 1 });
      }
      if (!demo.log.some((l) => /Success|Critical/.test(l.text))) continue;

      expect(demo.state.entity(along[0]!)!.hitPoints.marked).toBe(0);
      return;
    }
    throw new Error('no seed put two of the party on one line');
  });
});


describe('ground that means something', () => {
  /** Kara beside the husk, and a zone she can be walked in and out of. */
  const ground = (seed: string) => {
    const demo = standoff(seed);
    demo.askDefender = false;
    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    const kara = demo.state.entity('kara')!;
    // A patch of light on the tile Kara is standing on, reaching Very Close.
    demo.world.placeZone({
      id: 'light',
      name: 'Light',
      owner: 'mira',
      condition: 'rooted',
      anchor: kara.tile,
      band: 'veryClose',
      onDeath: 'keep',
    });
    return { demo, husk, kara };
  };

  /** A tile well away from everything, for walking out of the light. */
  const outside = (demo: DemoScene, from: number): number => {
    for (let tile = demo.grid.width * demo.grid.height - 1; tile >= 0; tile--) {
      if (!demo.grid.isPassable(tile) || demo.state.blockedFor('kara')(tile)) continue;
      const band = demo.world.bandBetween(from, tile);
      if (band === null || reaches(band, 'veryClose')) continue;
      return tile;
    }
    return NO_TILE;
  };

  it('puts its condition on whoever is standing in it, and takes it off whoever leaves', () => {
    const { demo, kara } = ground('zone-walk');
    expect(kara.conditions.has('rooted')).toBe(true);

    const away = outside(demo, kara.tile);
    expect(away).not.toBe(NO_TILE);
    demo.state.moveEntity('kara', away);
    demo.world.refreshZones();
    expect(kara.conditions.has('rooted')).toBe(false);
  });

  it('takes it off everybody when the ground stops meaning anything', () => {
    const { demo, kara } = ground('zone-end');
    expect(kara.conditions.has('rooted')).toBe(true);
    expect(demo.world.endZone('light')).toBe(true);
    expect(kara.conditions.has('rooted')).toBe(false);
    expect(demo.world.zones().length).toBe(0);
  });

  it('leaves somebody standing in the other one when one of two ends', () => {
    const { demo, kara } = ground('zone-two');
    demo.world.placeZone({
      id: 'second-light',
      name: 'Light',
      owner: 'mira',
      condition: 'rooted',
      anchor: kara.tile,
      band: 'veryClose',
      onDeath: 'keep',
    });
    demo.world.endZone('light');
    // Still standing in the second: the condition belongs to the ground, not
    // to whichever spell was cast first.
    expect(kara.conditions.has('rooted')).toBe(true);
    demo.world.endZone('second-light');
    expect(kara.conditions.has('rooted')).toBe(false);
  });

  it('holds exactly the tiles a creature would be caught standing on', () => {
    const { demo, kara } = ground('zone-footprint');
    const [zone] = demo.world.zoneFootprints();
    expect(zone?.name).toBe('Light');
    expect(zone?.condition).toBe('rooted');
    expect(zone?.tiles).toContain(kara.tile);
    const painted = new Set(zone!.tiles);
    // Walk Kara over every tile she can stand on: painted is rooted, unpainted
    // is not. The picture and the rule are the same measure.
    for (let tile = 0; tile < demo.grid.width * demo.grid.height; tile++) {
      if (!demo.grid.isPassable(tile) || demo.state.blockedFor('kara')(tile)) continue;
      demo.state.moveEntity('kara', tile);
      demo.world.refreshZones();
      expect(kara.conditions.has('rooted'), `tile ${tile}`).toBe(painted.has(tile));
    }
  });

  it('touches only the side it was cast for', () => {
    const demo = standoff('zone-side');
    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    demo.world.placeZone({
      id: 'ward',
      name: 'Ward',
      owner: 'mira',
      condition: 'rooted',
      anchor: demo.state.entity('kara')!.tile,
      band: 'close',
      side: 'allies',
      onDeath: 'keep',
    });
    expect(demo.state.entity('kara')!.conditions.has('rooted')).toBe(true);
    expect(husk.conditions.has('rooted')).toBe(false);
  });

  it('goes out with the one who cast it, when that is what it says', () => {
    const { demo, kara } = ground('zone-death');
    demo.world.placeZone({
      id: 'light',
      name: 'Light',
      owner: 'mira',
      condition: 'rooted',
      anchor: kara.tile,
      band: 'veryClose',
      onDeath: 'end',
    });
    expect(kara.conditions.has('rooted')).toBe(true);
    const mira = demo.state.entity('mira')!;
    mira.alive = false;
    demo.world.refreshZones();
    expect(demo.world.zones().length).toBe(0);
    expect(kara.conditions.has('rooted')).toBe(false);
  });

  it('follows a creature the GM shoved out of it', () => {
    // Not a walk of her own: what matters is that the ground is read again
    // after anything that moved somebody, whoever did the moving.
    const { demo, kara, husk } = ground('zone-shoved');
    expect(kara.conditions.has('rooted')).toBe(true);
    const away = outside(demo, kara.tile);
    expect(away).not.toBe(NO_TILE);

    demo.scenario.actorId = husk.id;
    runScript([{ kind: 'move', who: { kind: 'entity', id: 'kara' }, to: 'point', teleport: true, budget: 'veryFar' }], demo.world, demo.rng, {
      targets: [kara.id],
      hit: [kara.id],
      point: away,
    });
    expect(kara.tile).not.toBe(demo.state.entity(husk.id)!.tile);
    expect(kara.conditions.has('rooted')).toBe(false);
  });

  it('carries across a save and back', () => {
    const { demo, kara } = ground('zone-save');
    const snapshot = scenarioSnapshot(demo.scenario);
    kara.conditions.delete('rooted');
    restoreScenario(demo.scenario, snapshot);
    refreshWorld(demo);
    expect(demo.world.zones().map((z) => z.id)).toEqual(['light']);
    expect(kara.conditions.has('rooted')).toBe(true);
  });
});


describe('ground worth standing on', () => {
  /**
   * A patch of ground that takes a die off anything its own side is hit for
   * while they stand in it, turns that die up each time it answers a blow, and
   * stops meaning anything once the die would pass six.
   *
   * The number lives on the zone rather than on the card or the condition --
   * `value` with `grows` -- which is how one die on one card becomes a number
   * everybody standing there reads the same. The condition is a bare marker:
   * what comes off a blow is read from the zone through it.
   *
   * The zone's id and the condition's are deliberately different. The catalogue
   * happens to use one string for both, which reads like a requirement and is
   * not one.
   */
  const LIGHT_CARD = 'fixture-card-32';

  /** Carries nothing. The die it is read for belongs to the ground. */
  const IN_LIGHT_CONDITION = {
    id: 'fixture-in-light',
    name: 'Standing in It',
    text: 'Damage taken here is reduced by the value of the die on the ground.',
    color: '#6ed6a0',
  };

  /** One patch of ground, and the die that climbs while it answers blows. */
  const LAID = [
    {
      kind: 'zone',
      zone: 'fixture-light-ground',
      name: 'Standing Ground',
      condition: 'fixture-in-light',
      at: 'point',
      band: 'veryClose',
      side: 'allies',
      value: 1,
      grows: { by: 1, until: 6 },
    },
    { kind: 'log', text: 'The air over that ground goes hard and bright.', tone: 'hope' },
  ];

  const LIGHT = [
    {
      id: 'fixture-light',
      name: 'Standing Ground',
      source: { kind: 'domainCard', card: LIGHT_CARD },
      text: 'Once between long rests, make a patch of ground worth standing on.',
      uses: { count: 1, per: 'longRest' },
      target: { kind: 'point', range: 'far' },
      inCombatOnly: true,
      effects: [
        {
          kind: 'check',
          check: {
            trait: 'spellcast',
            difficulty: 16,
            prompt: 'Ground worth standing on?',
            onCriticalSuccess: LAID,
            onSuccessWithHope: LAID,
            onSuccessWithFear: LAID,
          },
        },
      ],
    },
  ];

  /** Mira with the spell in hand and Kara beside the husk, in reach of it. */
  const warding = (seed: string) => {
    const demo = standoff(seed);
    demo.askDefender = false;
    demo.project.domainCards.push(...FIXTURE_CARDS);
    demo.project.conditionDefs.push(conditionDefSchema.parse(IN_LIGHT_CONDITION));
    for (const ability of LIGHT) demo.project.abilities.push(abilitySchema.parse(ability));
    const sheet = { ...demo.sheets.get('mira')!, domainCards: [LIGHT_CARD], loadout: [LIGHT_CARD] };
    demo.sheets.set('mira', sheet);
    demo.characters.set('mira', deriveCharacter(sheet, characterContentFor(demo.project), demo.project.abilities).character);
    // Kara's own cards come off: what is under test is what the ground does.
    const hers = { ...demo.sheets.get('kara')!, domainCards: [], loadout: [] };
    demo.sheets.set('kara', hers);
    demo.characters.set('kara', deriveCharacter(hers, characterContentFor(demo.project), demo.project.abilities).character);
    refreshWorld(demo);
    demo.party.select('mira');
    return demo;
  };

  /** Cast it on Kara's ground; true when the roll got there. */
  const cast = (demo: DemoScene): boolean => {
    const at = demo.state.entity('kara')!.tile;
    if (useAbility(demo, 'mira', 'fixture-light', [], { point: at }).status === 'refused') return false;
    for (let guard = 0; guard < 8 && demo.pending !== null; guard++) {
      const prompt = demo.pending.prompt;
      if (prompt.kind === 'choice') answerPending(demo, { kind: 'choose', index: 0 });
      else answerPending(demo, { kind: 'roll' });
    }
    return demo.world.zones().some((z) => z.id === 'fixture-light-ground');
  };

  it('stands over the party and takes its die off what they are hit for', () => {
    for (let seed = 1; seed < 60; seed++) {
      const demo = warding(`ward-${seed}`);
      if (!cast(demo)) continue;

      const kara = demo.state.entity('kara')!;
      expect(kara.conditions.has('fixture-in-light')).toBe(true);
      // The husk is not one of theirs, so the light is nothing to it.
      const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
      expect(husk.conditions.has('fixture-in-light')).toBe(false);
      // A die of one, coming off any blow taken there.
      expect(demo.world.defensesOf('kara').reduce).toEqual([{ dice: '1' }]);
      expect(demo.world.defensesOf(husk.id).reduce ?? []).toEqual([]);
      return;
    }
    throw new Error('the spell never landed in sixty tries');
  });

  it('turns the die up each time it answers a blow, and goes out past six', () => {
    for (let seed = 1; seed < 60; seed++) {
      const demo = warding(`ward-grow-${seed}`);
      if (!cast(demo)) continue;
      const kara = demo.state.entity('kara')!;
      kara.hitPoints = { max: 30, marked: 0 };

      // Six blows, and the die climbs one for each: 1, 2, 3, 4, 5, 6.
      const seen: number[] = [];
      for (let blow = 0; blow < 6; blow++) {
        seen.push(demo.world.zones()[0]?.value ?? 0);
        demo.world.damage({ kind: 'entity', id: 'kara' }, 1);
      }
      expect(seen).toEqual([1, 2, 3, 4, 5, 6]);
      // The seventh would take it past six, so the ground stops meaning
      // anything and the light comes off her with it.
      demo.world.damage({ kind: 'entity', id: 'kara' }, 1);
      expect(demo.world.zones().length).toBe(0);
      expect(kara.conditions.has('fixture-in-light')).toBe(false);
      expect(demo.world.defensesOf('kara').reduce ?? []).toEqual([]);
      return;
    }
    throw new Error('the spell never landed in sixty tries');
  });

  it('is nothing to somebody who walks out of it', () => {
    for (let seed = 1; seed < 60; seed++) {
      const demo = warding(`ward-leave-${seed}`);
      if (!cast(demo)) continue;
      const kara = demo.state.entity('kara')!;
      const anchor = demo.world.zones()[0]!.anchor;

      let away = NO_TILE;
      for (let tile = demo.grid.width * demo.grid.height - 1; tile >= 0; tile--) {
        if (!demo.grid.isPassable(tile) || demo.state.blockedFor('kara')(tile)) continue;
        const band = demo.world.bandBetween(anchor, tile);
        if (band === null || reaches(band, 'veryClose')) continue;
        away = tile;
        break;
      }
      expect(away).not.toBe(NO_TILE);
      demo.state.moveEntity('kara', away);
      demo.world.refreshZones();
      expect(kara.conditions.has('fixture-in-light')).toBe(false);
      expect(demo.world.defensesOf('kara').reduce ?? []).toEqual([]);
      // And the ground is still there for whoever is standing on it.
      expect(demo.world.zones().length).toBe(1);
      return;
    }
    throw new Error('the spell never landed in sixty tries');
  });
});


describe('a room put out', () => {
  /**
   * One card that puts the room out, and two patches of ground over the same
   * tiles: what the dark does to the party and what it does to everything else
   * are two different rules. Each test below asserts the other side's condition
   * is absent, so one zone over everybody would prove nothing.
   *
   * The ending is a second ability -- a bare reaction to the caster's own Severe
   * wound, which needs no gate because only the holder of the card carries it.
   * The zones' `onDeath` covers the other ending, when the caster falls.
   */
  const DARK_CARD = 'fixture-card-25';

  /** On the party. `against` is the whole of it: rolls *at* them suffer. */
  const DIMMED_CONDITION = {
    id: 'fixture-dimmed',
    name: 'Hard to See',
    text: 'Attack rolls have disadvantage when targeting you.',
    color: '#5a4b8a',
    modifiers: [{ stat: 'advantage', bonus: -1, against: true }],
  };

  /** And on everything else: a debt, paid by whoever beats them well. */
  const UNLIT_CONDITION = {
    id: 'fixture-unlit',
    name: 'Caught Out',
    text: 'When somebody succeeds with Hope against you here, you must mark a Stress.',
    color: '#3d3358',
    payout: {
      on: 'attacked',
      when: {
        kind: 'all',
        of: [
          { kind: 'rolled', is: 'success' },
          { kind: 'rolled', is: 'withHope' },
        ],
      },
      // Taken rather than offered, which is why nobody is asked about it.
      auto: true,
      effects: [
        { kind: 'log', text: 'The dark closes on them.', tone: 'hope' },
        { kind: 'markStress', amount: 1, target: { kind: 'target' } },
      ],
    },
  };

  /** Both patches, raised together. Every success face does the same thing. */
  const FELL = [
    {
      kind: 'zone',
      zone: 'fixture-dark-allies',
      name: 'Put Out',
      condition: 'fixture-dimmed',
      band: 'far',
      side: 'allies',
      onDeath: 'end',
    },
    {
      kind: 'zone',
      zone: 'fixture-dark-adversaries',
      name: 'Put Out',
      condition: 'fixture-unlit',
      band: 'far',
      side: 'adversaries',
      onDeath: 'end',
    },
    { kind: 'log', text: 'The room goes dark, and only your own see through it.', tone: 'fear' },
  ];

  const DARK = [
    {
      id: 'fixture-dark',
      name: 'Put Out the Room',
      source: { kind: 'domainCard', card: DARK_CARD },
      text: 'Once between long rests, put the room out as far as you can see.',
      uses: { count: 1, per: 'longRest' },
      inCombatOnly: true,
      target: { kind: 'none', range: 'far' },
      effects: [
        {
          kind: 'check',
          check: {
            trait: 'spellcast',
            difficulty: 16,
            prompt: 'Put the room out?',
            onCriticalSuccess: FELL,
            onSuccessWithHope: FELL,
            onSuccessWithFear: FELL,
          },
        },
      ],
    },
    {
      id: 'fixture-dark-ends',
      name: 'Put Out the Room',
      source: { kind: 'domainCard', card: DARK_CARD },
      text: 'A bad enough wound on the one holding it and the room comes back.',
      kind: 'reaction',
      trigger: 'tookSevere',
      action: false,
      effects: [
        { kind: 'endZone', zone: 'fixture-dark-allies' },
        { kind: 'endZone', zone: 'fixture-dark-adversaries' },
        { kind: 'log', text: 'The dark breaks, and the room comes back.', tone: 'fear' },
      ],
    },
  ];

  /** Mira with the spell in hand, the party and the husk all within Far. */
  const dark = (seed: string) => {
    const demo = standoff(seed);
    demo.askDefender = false;
    demo.project.domainCards.push(...FIXTURE_CARDS);
    for (const condition of [DIMMED_CONDITION, UNLIT_CONDITION]) {
      demo.project.conditionDefs.push(conditionDefSchema.parse(condition));
    }
    for (const ability of DARK) demo.project.abilities.push(abilitySchema.parse(ability));
    const sheet = { ...demo.sheets.get('mira')!, domainCards: [DARK_CARD], loadout: [DARK_CARD] };
    demo.sheets.set('mira', sheet);
    demo.characters.set('mira', deriveCharacter(sheet, characterContentFor(demo.project), demo.project.abilities).character);
    refreshWorld(demo);
    // The dark reaches Far from where she stands, so she stands with them.
    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    standBehind(demo, 'mira', husk.tile);
    demo.party.select('mira');
    return demo;
  };

  /** Cast it; true when the roll got there. */
  const cast = (demo: DemoScene): boolean => {
    if (useAbility(demo, 'mira', 'fixture-dark', []).status === 'refused') return false;
    for (let guard = 0; guard < 8 && demo.pending !== null; guard++) {
      const prompt = demo.pending.prompt;
      if (prompt.kind === 'choice') answerPending(demo, { kind: 'choose', index: 0 });
      else answerPending(demo, { kind: 'roll' });
    }
    return demo.world.zones().length > 0;
  };

  it('turns attacks against the party and marks whoever is beaten with Hope', () => {
    for (let seed = 1; seed < 60; seed++) {
      const demo = dark(`eclipse-${seed}`);
      if (!cast(demo)) continue;
      const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;

      // Two patches of ground over the same tiles, one rule each.
      expect(demo.state.entity('kara')!.conditions.has('fixture-dimmed')).toBe(true);
      expect(demo.state.entity('kara')!.conditions.has('fixture-unlit')).toBe(false);
      expect(husk.conditions.has('fixture-unlit')).toBe(true);
      expect(husk.conditions.has('fixture-dimmed')).toBe(false);

      // Attacks against anyone in the party are made in the dark.
      expect(demo.world.advantageFor(husk.id, 'kara').disadvantage).toBe(1);
      expect(demo.world.advantageFor('kara', husk.id).disadvantage).toBe(0);
      return;
    }
    throw new Error('the dark never fell in sixty tries');
  });

  it('takes a Stress from whoever is beaten with Hope in it, and only then', () => {
    let withHope = false;
    let otherwise = false;
    for (let seed = 1; seed < 80 && !(withHope && otherwise); seed++) {
      const demo = dark(`eclipse-stress-${seed}`);
      if (!cast(demo)) continue;
      const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
      husk.hitPoints = { max: 60, marked: 0 };
      husk.stress = { max: 6, marked: 0 };

      demo.party.select('kara');
      const said = demo.log.length;
      attackWithSelected(demo, husk.id);
      let guard = 0;
      while (demo.pending !== null && guard++ < 8) answerPending(demo, { kind: 'choose', index: 0 });
      const after = demo.log.slice(said).map((t) => t.text);
      // What the dice said, off the roll the table saw rather than the log.
      const rolled = demo.rolls[demo.rolls.length - 1]?.roll.outcome;
      if (rolled === undefined) continue;

      if (rolled === 'successWithHope' || rolled === 'criticalSuccess') {
        // "The target must mark a Stress": nobody is asked about it.
        expect(husk.stress.marked).toBe(1);
        expect(after.some((t) => t.includes('The dark closes on them'))).toBe(true);
        withHope = true;
      } else {
        // Any other roll leaves them alone, and the dark still over them.
        expect(husk.stress.marked).toBe(0);
        expect(demo.state.entity(husk.id)!.conditions.has('fixture-unlit')).toBe(true);
        otherwise = true;
      }
    }
    expect(withHope).toBe(true);
    expect(otherwise).toBe(true);
  });

  it('breaks when the one who cast it takes Severe damage', () => {
    for (let seed = 1; seed < 60; seed++) {
      const demo = dark(`eclipse-break-${seed}`);
      if (!cast(demo)) continue;
      const mira = demo.state.entity('mira')!;
      mira.hitPoints = { max: 12, marked: 0 };

      // Three Hit Points at once is Severe, and the card answers that.
      demo.world.damage({ kind: 'entity', id: 'mira' }, 3);
      settleFight(demo);
      expect(demo.log.some((l) => l.text.includes('The dark breaks'))).toBe(true);
      expect(demo.world.zones().length).toBe(0);
      expect(demo.state.entity('kara')!.conditions.has('fixture-dimmed')).toBe(false);
      expect(demo.state.entitiesOf('adversary').every((e) => !e.conditions.has('fixture-unlit'))).toBe(true);
      return;
    }
    throw new Error('the dark never fell in sixty tries');
  });

  it('goes out with the one who cast it', () => {
    for (let seed = 1; seed < 60; seed++) {
      const demo = dark(`eclipse-fall-${seed}`);
      if (!cast(demo)) continue;
      demo.state.entity('mira')!.alive = false;
      demo.world.refreshZones();
      expect(demo.world.zones().length).toBe(0);
      expect(demo.state.entity('kara')!.conditions.has('fixture-dimmed')).toBe(false);
      return;
    }
    throw new Error('the dark never fell in sixty tries');
  });
});


describe('half of what somebody is', () => {
  /** Kara with an Agility of `agility`, holding these cards. */
  const nimble = (agility: number, cards: string[]): DemoScene => {
    const demo = standoff(`untouchable-${agility}-${cards.length}`);
    const sheet = {
      ...demo.sheets.get('kara')!,
      traits: { ...demo.sheets.get('kara')!.traits, agility },
      domainCards: cards,
      loadout: cards,
    };
    demo.sheets.set('kara', sheet);
    demo.characters.set('kara', deriveCharacter(sheet, characterContentFor(demo.project), demo.project.abilities).character);
    refreshWorld(demo);
    return demo;
  };

  it('adds half an Agility to Evasion, rounded up', () => {
    // Three is two, four is two, five is three: the SRD rounds up wherever it
    // divides, and the same number has to come out of the sheet and the scene.
    for (const [agility, worth] of [
      [3, 2],
      [4, 2],
      [5, 3],
      [0, 0],
    ] as const) {
      const bare = nimble(agility, []).characters.get('kara')!.evasion;
      const held = nimble(agility, ['untouchable']).characters.get('kara')!.evasion;
      expect(held - bare).toBe(worth);
    }
  });

  it('is read the same way by a roll made against her', () => {
    const demo = nimble(5, ['untouchable']);
    const kara = demo.state.entity('kara')!;
    // What a swing at her has to beat, off the world rather than the sheet.
    expect(demo.world.defenderOf(kara).difficulty).toBe(demo.characters.get('kara')!.evasion);
    expect(demo.world.difficultyOf('kara')).toBe(demo.characters.get('kara')!.evasion);
  });
});


describe('a sigil that answers a fall', () => {
  /**
   * A ward hung over somebody that answers the moment they would go down.
   *
   * The interception is a field on the condition rather than a reaction --
   * `insteadOfDeath`, read where a death move would be made -- and it carries
   * its own words in `says`. Nothing in the card's effects logs that line.
   *
   * One at a time is the card's own first line: it comes off the whole party
   * before it goes onto the target, which is why one test can run the effects
   * straight through the runner and watch the old one lift.
   */
  const SIGIL_CARD = 'fixture-card-23';

  /** Does nothing at all until the one moment it is for. */
  const WARDED_CONDITION = {
    id: 'fixture-warded',
    name: 'Warded',
    text: 'When you would make a death move, you clear a Hit Point instead.',
    insteadOfDeath: { clears: 1, says: 'The ward takes it, and goes out.' },
  };

  const SIGIL = [
    {
      id: 'fixture-sigil',
      name: 'Hang a Ward',
      source: { kind: 'domainCard', card: SIGIL_CARD },
      text: 'Spend three Hope to hang a ward over somebody close by, until a rest.',
      cost: { hope: 3 },
      target: { kind: 'ally', range: 'close' },
      effects: [
        // One at a time: hanging a second takes the first off whoever had it.
        { kind: 'clearCondition', condition: 'fixture-warded', target: { kind: 'party' } },
        { kind: 'applyCondition', condition: 'fixture-warded', duration: 'rest', target: { kind: 'target' } },
        { kind: 'log', text: 'Something closes over them, and holds.', tone: 'hope' },
      ],
    },
  ];

  /** Mira with the ward in hand, standing with the rest of the party. */
  const warded = (seed: string, on: string | null) => {
    const demo = standoff(seed);
    demo.askDefender = true;
    demo.project.domainCards.push(...FIXTURE_CARDS);
    demo.project.conditionDefs.push(conditionDefSchema.parse(WARDED_CONDITION));
    for (const ability of SIGIL) demo.project.abilities.push(abilitySchema.parse(ability));
    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    standBehind(demo, 'mira', husk.tile);
    const sheet = { ...demo.sheets.get('mira')!, domainCards: [SIGIL_CARD], loadout: [SIGIL_CARD] };
    demo.sheets.set('mira', sheet);
    demo.characters.set('mira', deriveCharacter(sheet, characterContentFor(demo.project), demo.project.abilities).character);
    refreshWorld(demo);
    demo.state.entity('mira')!.hope = { max: 6, value: 6 };
    if (on !== null) {
      demo.party.select('mira');
      expect(useAbility(demo, 'mira', 'fixture-sigil', [on]).status).not.toBe('refused');
      expect(demo.state.entity(on)!.conditions.has('fixture-warded')).toBe(true);
    }
    return demo;
  };

  /** Put somebody's last Hit Point down and let the fall be answered. */
  const fell = (demo: DemoScene, id: string): void => {
    const who = demo.state.entity(id)!;
    who.hitPoints = { max: 4, marked: 3 };
    demo.world.damage({ kind: 'entity', id }, 1);
    settleFight(demo);
  };

  it('clears a Hit Point in place of the death move, and goes out doing it', () => {
    const demo = warded('ward-catch', 'kara');
    const kara = demo.state.entity('kara')!;
    const said = demo.log.length;
    fell(demo, 'kara');

    const after = demo.log.slice(said).map((l) => l.text);
    expect(after.some((t) => t.includes('The ward takes it, and goes out'))).toBe(true);
    // She is standing, nothing was asked of her, and the sigil is spent.
    expect(kara.alive).toBe(true);
    expect(kara.hitPoints.marked).toBe(3);
    expect(demo.pending).toBeNull();
    expect(kara.conditions.has('fixture-warded')).toBe(false);
  });

  it('leaves the death move to somebody it is not on', () => {
    const demo = warded('ward-elsewhere', 'kara');
    const said = demo.log.length;
    fell(demo, 'finn');
    const after = demo.log.slice(said).map((l) => l.text);
    expect(after.some((t) => t.includes('The ward takes it'))).toBe(false);
    // Finn is asked what he does about it, the way anybody would be.
    expect(demo.pending?.kind).toBe('death');
    // And Kara still has hers.
    expect(demo.state.entity('kara')!.conditions.has('fixture-warded')).toBe(true);
  });

  it('hangs over one at a time', () => {
    const demo = warded('ward-one', 'kara');
    // The card again, on somebody else. Run rather than played, because the
    // first casting spent her turn and what is under test is the card's own
    // first line rather than the turn economy.
    const card = demo.project.abilities.find((a) => a.id === 'fixture-sigil')!;
    demo.scenario.actorId = 'mira';
    runScript(card.effects, demo.world, demo.rng, { targets: ['finn'], hit: ['finn'] });
    expect(demo.state.entity('finn')!.conditions.has('fixture-warded')).toBe(true);
    expect(demo.state.entity('kara')!.conditions.has('fixture-warded')).toBe(false);
  });

  it('catches one fall and no more', () => {
    const demo = warded('ward-once', 'kara');
    const kara = demo.state.entity('kara')!;
    fell(demo, 'kara');
    expect(kara.alive).toBe(true);
    // Down again with the sigil spent: this time the question is put to her.
    fell(demo, 'kara');
    expect(demo.pending?.kind).toBe('death');
  });
});


describe('a throw worth making again', () => {
  /** Kara beside the husk with these cards in hand. */
  const swinging = (seed: string, cards: string[]) => {
    const demo = standoff(seed);
    demo.askDefender = true;
    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    husk.hitPoints = { max: 90, marked: 0 };
    const sheet = { ...demo.sheets.get('kara')!, domainCards: cards, loadout: cards };
    demo.sheets.set('kara', sheet);
    demo.characters.set('kara', deriveCharacter(sheet, characterContentFor(demo.project), demo.project.abilities).character);
    refreshWorld(demo);
    demo.party.select('kara');
    return { demo, husk };
  };

  it('is offered on her own blow, before anything has counted it', () => {
    for (let seed = 1; seed < 40; seed++) {
      const { demo, husk } = swinging(`nge-${seed}`, ['not-good-enough']);
      attackWithSelected(demo, husk.id);
      const pending = demo.pending;
      if (pending === null || pending.kind !== 'reaction' || pending.prompt.kind !== 'choice') continue;
      const at = pending.prompt.options.findIndex((o) => o.label.includes('Not Good Enough'));
      if (at < 0) continue;

      const said = demo.log.length;
      answerPending(demo, { kind: 'choose', index: at });
      let guard = 0;
      while (demo.pending !== null && guard++ < 6) answerPending(demo, { kind: 'choose', index: 0 });
      expect(demo.log.slice(said).some((l) => l.text.includes('Not good enough. Again.'))).toBe(true);
      // The blow was still being held: it lands after the card, once.
      expect(demo.log.slice(said).filter((l) => /Kara (hits|lands a critical) with/.test(l.text)).length).toBe(1);
      return;
    }
    throw new Error('the card was never offered in forty tries');
  });

  it('throws the low faces again, and it usually helps', () => {
    // The reroll moves the stream, so two runs at one seed are not comparable:
    // what is compared is the Hit Points marked over many.
    const total = (holding: boolean): number => {
      let marked = 0;
      for (let seed = 1; seed < 80; seed++) {
        const { demo, husk } = swinging(`nge-sum-${seed}`, holding ? ['not-good-enough'] : []);
        attackWithSelected(demo, husk.id);
        let guard = 0;
        while (demo.pending !== null && guard++ < 6) {
          const prompt = demo.pending.prompt;
          const at =
            prompt.kind === 'choice' ? prompt.options.findIndex((o) => o.label.includes('Not Good Enough')) : -1;
          answerPending(demo, { kind: 'choose', index: at < 0 ? 0 : at });
        }
        marked += husk.hitPoints.marked;
      }
      return marked;
    };
    expect(total(true)).toBeGreaterThan(total(false));
  });
});


describe('the next one', () => {
  /**
   * Two cards that are two halves of one question. Everybody in the party
   * hears about everybody's rolls, so what tells these apart is `self` against
   * `not self` on the same trigger: one answers only its holder's own failure,
   * the other only an ally's and never the holder's own.
   *
   * The first is free and automatic -- there is nothing to decide -- so its
   * tests read a result. The second is offered and costs a use, so its tests
   * hunt for a label and then read the use back.
   */
  const CARRY_CARD = 'fixture-card-28';
  const WORD_CARD = 'fixture-card-29';

  /**
   * What the first one leaves behind. `anyRoll` is why it is worth a die on a
   * check as well as on a swing, and `endsWhen` is why the next roll spends it
   * whether that roll lands or not.
   */
  const CARRIED_CONDITION = {
    id: 'fixture-carried',
    name: 'Owed One',
    text: 'Your next action roll has advantage.',
    modifiers: [{ stat: 'advantage', bonus: 1, anyRoll: true }],
    endsWhen: 'rolls',
  };

  const CARRY = [
    {
      id: 'fixture-carry',
      name: 'The Next One',
      source: { kind: 'domainCard', card: CARRY_CARD },
      text: 'When you fail an action roll, your next action roll has advantage.',
      kind: 'reaction',
      trigger: 'partyRolled',
      action: false,
      // Only her own: the one who rolled is bound as the target, and everybody
      // in the party hears about every roll.
      available: {
        kind: 'all',
        of: [
          { kind: 'self' },
          { kind: 'rolled', is: 'failure' },
        ],
      },
      effects: [
        { kind: 'log', text: 'Not this one. The next.', tone: 'hope' },
        { kind: 'applyCondition', condition: 'fixture-carried', duration: 'scene', target: { kind: 'actor' } },
      ],
    },
  ];

  const WORD = [
    {
      id: 'fixture-word',
      name: 'A Word in Your Ear',
      source: { kind: 'domainCard', card: WORD_CARD },
      text: 'Once between long rests, when somebody beside you fails, you both clear 2 Stress.',
      kind: 'reaction',
      trigger: 'partyRolled',
      action: false,
      // Offered: whether this was the roll worth consoling is the player's.
      auto: false,
      uses: { count: 1, per: 'longRest' },
      // The other side of `self`: an ally's roll, never the holder's own.
      available: {
        kind: 'all',
        of: [
          { kind: 'not', of: { kind: 'self' } },
          { kind: 'rolled', is: 'failure' },
        ],
      },
      effects: [
        { kind: 'log', text: 'A word in their ear, and they both stand straighter.', tone: 'hope' },
        { kind: 'clearStress', amount: 2, target: { kind: 'actor' } },
        { kind: 'clearStress', amount: 2, target: { kind: 'target' } },
      ],
    },
  ];

  /** Kara beside the husk holding these cards; Finn beside it too. */
  const trying = (seed: string, cards: string[]) => {
    const demo = standoff(seed);
    demo.askDefender = true;
    demo.project.domainCards.push(...FIXTURE_CARDS);
    demo.project.conditionDefs.push(conditionDefSchema.parse(CARRIED_CONDITION));
    for (const ability of [...CARRY, ...WORD]) demo.project.abilities.push(abilitySchema.parse(ability));
    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    husk.hitPoints = { max: 90, marked: 0 };
    const blocked = demo.state.blockedFor('finn');
    let stand = NO_TILE;
    demo.grid.forEachNeighbor(husk.tile, false, (tile) => {
      if (stand === NO_TILE && demo.grid.isPassable(tile) && !blocked(tile)) stand = tile;
    });
    demo.state.moveEntity('finn', stand);
    const sheet = { ...demo.sheets.get('kara')!, domainCards: cards, loadout: cards };
    demo.sheets.set('kara', sheet);
    demo.characters.set('kara', deriveCharacter(sheet, characterContentFor(demo.project), demo.project.abilities).character);
    refreshWorld(demo);
    demo.party.select('kara');
    return { demo, husk };
  };

  /** Swing, and answer whatever is asked about it. */
  const swing = (demo: DemoScene, at: string): void => {
    attackWithSelected(demo, at);
    for (let guard = 0; guard < 8 && demo.pending !== null; guard++) {
      const prompt = demo.pending.prompt;
      if (prompt.kind === 'choice') answerPending(demo, { kind: 'choose', index: 0 });
      else answerPending(demo, { kind: 'roll' });
    }
  };

  it('carries advantage out of a failed roll and into the next one', () => {
    for (let seed = 1; seed < 60; seed++) {
      const { demo, husk } = trying(`inevitable-${seed}`, [CARRY_CARD]);
      const kara = demo.state.entity('kara')!;
      const said = demo.log.length;
      swing(demo, husk.id);
      const after = demo.log.slice(said).map((l) => l.text);
      const rolled = demo.rolls[demo.rolls.length - 1]?.roll.outcome;
      if (rolled === undefined) continue;

      const failed = rolled === 'failureWithHope' || rolled === 'failureWithFear';
      if (!failed) {
        // Nothing to carry: a roll that landed leaves her as she was.
        expect(kara.conditions.has('fixture-carried')).toBe(false);
        continue;
      }
      expect(after.some((t) => t.includes('Not this one. The next.'))).toBe(true);
      expect(kara.conditions.has('fixture-carried')).toBe(true);
      // And it is worth a die on the next roll she makes.
      expect(demo.world.advantageFor('kara', husk.id).advantage).toBe(1);
      return;
    }
    throw new Error('Kara never failed a roll in sixty tries');
  });

  it('is spent on the next roll, whether that one lands or not', () => {
    for (let seed = 1; seed < 60; seed++) {
      const { demo, husk } = trying(`inevitable-spend-${seed}`, [CARRY_CARD]);
      const kara = demo.state.entity('kara')!;
      swing(demo, husk.id);
      if (!kara.conditions.has('fixture-carried')) continue;

      // Her turn again, and the die goes into it.
      endTurn(demo);
      for (let guard = 0; guard < 8 && demo.pending !== null; guard++) {
        answerPending(demo, { kind: 'choose', index: 0 });
      }
      if (!demo.state.entity('kara')!.alive) continue;
      demo.party.select('kara');
      swing(demo, husk.id);
      expect(kara.conditions.has('fixture-carried')).toBe(false);
      return;
    }
    throw new Error('Kara never failed a roll in sixty tries');
  });

  it('leans on an ally who failed, and never on herself', () => {
    let helped = false;
    let alone = false;
    for (let seed = 1; seed < 80 && !(helped && alone); seed++) {
      const { demo, husk } = trying(`lean-${seed}`, [WORD_CARD]);
      const kara = demo.state.entity('kara')!;
      const finn = demo.state.entity('finn')!;
      kara.stress = { max: 6, marked: 4 };
      finn.stress = { max: 6, marked: 4 };

      // Finn swings and fails: the card is Kara's to offer.
      demo.party.select('finn');
      attackWithSelected(demo, husk.id);
      const rolled = demo.rolls[demo.rolls.length - 1]?.roll.outcome;
      const failed = rolled === 'failureWithHope' || rolled === 'failureWithFear';
      const pending = demo.pending;
      const at =
        pending !== null && pending.kind === 'reaction' && pending.prompt.kind === 'choice'
          ? pending.prompt.options.findIndex((o) => o.label.includes('A Word in Your Ear'))
          : -1;

      if (failed && at > 0) {
        answerPending(demo, { kind: 'choose', index: at });
        let guard = 0;
        while (demo.pending !== null && guard++ < 6) answerPending(demo, { kind: 'choose', index: 0 });
        expect(kara.stress.marked).toBe(2);
        expect(finn.stress.marked).toBe(2);
        expect(demo.scenario.abilityUses.get(useKey('kara', 'fixture-word'))).toBe(1);
        helped = true;
        continue;
      }
      if (!failed) {
        // A roll that landed is not one to console anybody about.
        expect(at).toBe(-1);
        alone = true;
      }
    }
    expect(helped).toBe(true);
    expect(alone).toBe(true);
  });

  it('is not offered to the one who failed the roll', () => {
    for (let seed = 1; seed < 60; seed++) {
      const { demo, husk } = trying(`lean-self-${seed}`, [WORD_CARD]);
      demo.state.entity('kara')!.stress = { max: 6, marked: 4 };
      // Kara's own failure: "an ally who failed an action roll" is not her.
      attackWithSelected(demo, husk.id);
      const rolled = demo.rolls[demo.rolls.length - 1]?.roll.outcome;
      if (rolled !== 'failureWithHope' && rolled !== 'failureWithFear') continue;
      expect(JSON.stringify(demo.pending ?? {})).not.toContain('A Word in Your Ear');
      expect(demo.state.entity('kara')!.stress.marked).toBe(4);
      return;
    }
    throw new Error('Kara never failed a roll in sixty tries');
  });

  it("answers her own roll and not an ally's", () => {
    for (let seed = 1; seed < 60; seed++) {
      const { demo, husk } = trying(`inevitable-mine-${seed}`, [CARRY_CARD]);
      const kara = demo.state.entity('kara')!;
      demo.party.select('finn');
      swing(demo, husk.id);
      const rolled = demo.rolls[demo.rolls.length - 1]?.roll.outcome;
      if (rolled !== 'failureWithHope' && rolled !== 'failureWithFear') continue;
      // Finn's failure is Finn's: "when *you* fail an action roll".
      expect(kara.conditions.has('fixture-carried')).toBe(false);
      expect(demo.state.entity('finn')!.conditions.has('fixture-carried')).toBe(false);
      return;
    }
    throw new Error('Finn never failed a roll in sixty tries');
  });
});


/**
 * Two cards that put a price on the other side of the table: one taunts a
 * creature into a swing it has not thought through, the other makes aiming at
 * you cost something every time.
 */
describe('a card that charges the one who swings', () => {
  const hold = (demo: DemoScene, who: string, cards: string[]): void => {
    const sheet = { ...demo.sheets.get(who)!, domainCards: cards, loadout: cards.slice(0, 5) };
    demo.sheets.set(who, sheet);
    demo.characters.set(who, deriveCharacter(sheet, characterContentFor(demo.project), demo.project.abilities).character);
    refreshWorld(demo);
  };

  it('Goad Them On costs them a Stress and their next swing', () => {
    for (let seed = 1; seed < 60; seed++) {
      const demo = standoff('goad-' + seed);
      demo.askDefender = false;
      hold(demo, 'kara', ['goad-them-on']);
      const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
      husk.stress = { max: 6, marked: 0 };

      expect(useAbility(demo, 'kara', 'goad-them-on', [husk.id]).status).not.toBe('refused');
      while (demo.pending !== null) answerPending(demo, { kind: 'roll' });
      // The taunt did not land this time; try another seed.
      if (!husk.conditions.has('goaded')) continue;

      expect(husk.stress.marked).toBe(1);
      // The disadvantage is on their own swing rather than on rolls against
      // them, so it is read off the goaded creature as the attacker.
      expect(demo.world.advantageFor(husk.id, 'kara')).toEqual({ advantage: 0, disadvantage: 1 });
      expect(demo.world.advantageFor('kara', husk.id)).toEqual({ advantage: 0, disadvantage: 0 });
      return;
    }
    throw new Error('Goad Them On never landed in sixty tries');
  });

  it('and the swing it was waiting for spends it', () => {
    for (let seed = 1; seed < 60; seed++) {
      const demo = standoff('goad-spent-' + seed);
      demo.askDefender = false;
      const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
      demo.world.applyCondition(husk.id, 'goaded', 'scene');
      expect(husk.conditions.has('goaded')).toBe(true);

      const before = demo.log.length;
      endTurn(demo);
      while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
      // Only a turn the husk actually swung on proves anything: `endsOnAttack`
      // is what spends the goad, and a turn spent walking spends nothing.
      const swung = demo.log.slice(before).some((l) => /misses|Hit Point/.test(l.text));
      if (!swung) continue;
      expect(husk.conditions.has('goaded')).toBe(false);
      return;
    }
    throw new Error('the husk never swung in sixty tries');
  });

  it('Overwhelming Aura charges an adversary for aiming, and is still up afterwards', () => {
    const demo = standoff('aura');
    demo.askDefender = false;
    const kara = demo.state.entity('kara')!;
    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    husk.stress = { max: 12, marked: 0 };
    demo.world.applyCondition('kara', 'overwhelming-aura', 'rest');
    // A price rather than a debt: `keeps` is what stops the payout clearing it.
    expect(demo.world.payoutsOn('kara', 'attacked')).toMatchObject([
      { condition: 'overwhelming-aura', auto: true, keeps: true },
    ]);

    let paid = 0;
    for (let turn = 0; turn < 12 && paid < 2; turn++) {
      for (const member of demo.state.entitiesOf('party')) {
        member.hitPoints = { ...member.hitPoints, marked: 0 };
        member.alive = true;
      }
      const before = husk.stress.marked;
      endTurn(demo);
      while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
      if (husk.stress.marked > before) paid += 1;
      if (demo.encounter?.outcome !== 'ongoing') break;
    }
    // Twice, which is the half of it that `keeps` buys: a debt would have paid
    // once and gone.
    expect(paid).toBe(2);
    expect(kara.conditions.has('overwhelming-aura')).toBe(true);
  });

  it('the aura goes up on a Spellcast Roll, and not without the Hope to hold it', () => {
    for (let seed = 1; seed < 60; seed++) {
      const demo = standoff('aura-cast-' + seed);
      demo.askDefender = false;
      hold(demo, 'mira', ['overwhelming-aura']);
      const mira = demo.state.entity('mira')!;
      mira.hope = { max: 6, value: 6 };

      expect(useAbility(demo, 'mira', 'overwhelming-aura', []).status).not.toBe('refused');
      while (demo.pending !== null) answerPending(demo, { kind: 'roll' });
      if (!mira.conditions.has('overwhelming-aura')) continue;

      // Two Hope out of six, and the aura standing.
      expect(mira.hope!.value).toBeLessThanOrEqual(4);
      return;
    }
    throw new Error('the aura never went up in sixty tries');
  });

  it('and a caster with one Hope holds nothing', () => {
    for (let seed = 1; seed < 60; seed++) {
      const demo = standoff('aura-poor-' + seed);
      demo.askDefender = false;
      hold(demo, 'mira', ['overwhelming-aura']);
      const mira = demo.state.entity('mira')!;
      mira.hope = { max: 6, value: 1 };

      const used = useAbility(demo, 'mira', 'overwhelming-aura', []);
      if (used.status === 'refused') continue;
      while (demo.pending !== null) answerPending(demo, { kind: 'roll' });
      // However the dice went, two Hope was never there to spend.
      expect(mira.conditions.has('overwhelming-aura')).toBe(false);
      return;
    }
    throw new Error('the roll was never made in sixty tries');
  });
});


/**
 * Wrangle is the first card that puts *other people* on the spot the player
 * picked: the ones its roll beat, and the party standing close.
 */
describe('a card that moves the room', () => {
  const hold = (demo: DemoScene, who: string, cards: string[]): void => {
    const sheet = { ...demo.sheets.get(who)!, domainCards: cards, loadout: cards.slice(0, 5) };
    demo.sheets.set(who, sheet);
    demo.characters.set(who, deriveCharacter(sheet, characterContentFor(demo.project), demo.project.abilities).character);
    refreshWorld(demo);
  };

  /** A free tile a couple of steps off, for the card to be aimed at. */
  const spotNear = (demo: DemoScene, from: number): number => {
    const blocked = demo.state.blockedFor('kara');
    for (let dx = 1; dx <= 3; dx++) {
      for (const dy of [0, 1, -1]) {
        const tile = demo.grid.indexOf(demo.grid.xOf(from) + dx, demo.grid.yOf(from) + dy);
        if (tile !== NO_TILE && demo.grid.isPassable(tile) && !blocked(tile)) return tile;
      }
    }
    return NO_TILE;
  };

  it('hauls the ones it beat onto the spot, and spends the Hope for it', () => {
    for (let seed = 1; seed < 60; seed++) {
      const demo = standoff('wrangle-' + seed);
      demo.askDefender = false;
      hold(demo, 'kara', ['wrangle']);
      const kara = demo.state.entity('kara')!;
      kara.hope = { max: 6, value: 4 };
      const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
      const was = husk.tile;
      const spot = spotNear(demo, kara.tile);
      if (spot === NO_TILE) continue;

      expect(useAbility(demo, 'kara', 'wrangle', [], { point: spot }).status).not.toBe('refused');
      while (demo.pending !== null) answerPending(demo, { kind: 'roll' });

      // Only a roll that beat it moves it, and only then is the Hope gone.
      if (husk.tile === was) {
        expect(kara.hope!.value).toBeLessThanOrEqual(4);
        continue;
      }
      // Onto the spot, or the nearest free tile to it when somebody is there.
      expect(demo.grid.chebyshevDistance(husk.tile, spot)).toBeLessThanOrEqual(1);
      expect(kara.hope!.value).toBeLessThan(4);
      return;
    }
    throw new Error('Wrangle never beat the husk in sixty tries');
  });

  it('takes the party standing close along with it', () => {
    for (let seed = 1; seed < 60; seed++) {
      const demo = standoff('wrangle-allies-' + seed);
      demo.askDefender = false;
      hold(demo, 'kara', ['wrangle']);
      const kara = demo.state.entity('kara')!;
      kara.hope = { max: 6, value: 4 };
      // Finn beside her, so he is one of the "willing allies within Close".
      const finn = demo.state.entity('finn')!;
      const beside = spotNear(demo, kara.tile);
      if (beside === NO_TILE) continue;
      demo.state.moveEntity('finn', beside);
      const spot = spotNear(demo, finn.tile);
      if (spot === NO_TILE || spot === finn.tile) continue;
      const stood = kara.tile;

      expect(useAbility(demo, 'kara', 'wrangle', [], { point: spot }).status).not.toBe('refused');
      while (demo.pending !== null) answerPending(demo, { kind: 'roll' });

      // However the roll went against the husk, the ally moved: the Hope buys
      // both halves of the card, and an ally is not rolled against.
      expect(demo.grid.chebyshevDistance(finn.tile, spot)).toBeLessThanOrEqual(1);
      // And the one who whistled stayed where they were: `allies` leaves the
      // actor out, so a card that moves the party does not move the caster.
      expect(kara.tile).toBe(stood);
      return;
    }
    throw new Error('never found room to stand Finn in, in sixty tries');
  });

  it('moves nobody with no Hope to spend, and a roll with Hope pays for itself', () => {
    let withFear = false;
    let withHope = false;
    for (let seed = 1; seed < 60 && !(withFear && withHope); seed++) {
      const demo = standoff('wrangle-poor-' + seed);
      demo.askDefender = false;
      hold(demo, 'kara', ['wrangle']);
      const kara = demo.state.entity('kara')!;
      kara.hope = { max: 6, value: 0 };
      const finn = demo.state.entity('finn')!;
      const beside = spotNear(demo, kara.tile);
      if (beside === NO_TILE) continue;
      demo.state.moveEntity('finn', beside);
      const spot = spotNear(demo, finn.tile);
      if (spot === NO_TILE || spot === finn.tile) continue;
      const stood = finn.tile;

      expect(useAbility(demo, 'kara', 'wrangle', [], { point: spot }).status).not.toBe('refused');
      while (demo.pending !== null) answerPending(demo, { kind: 'roll' });

      // A roll with Hope hands one over *before* the arms run, so the card
      // pays for itself out of the roll that cast it; a roll with Fear leaves
      // the pool as empty as it found it, and nobody moves.
      const hoped = demo.rolls[demo.rolls.length - 1]!.roll.hopeGained > 0;
      if (hoped) {
        expect(demo.grid.chebyshevDistance(finn.tile, spot)).toBeLessThanOrEqual(1);
        withHope = true;
      } else {
        expect(finn.tile).toBe(stood);
        withFear = true;
      }
    }
    expect({ withFear, withHope }).toEqual({ withFear: true, withHope: true });
  });
});


/**
 * The moment between the dice and the consequences: a card that puts one of
 * the Duality Dice back in the cup, and a swing rebuilt around the new pair.
 */
describe('a card that throws the dice again', () => {
  const hold = (demo: DemoScene, who: string, cards: string[]): void => {
    const sheet = { ...demo.sheets.get(who)!, domainCards: cards, loadout: cards.slice(0, 5) };
    demo.sheets.set(who, sheet);
    demo.characters.set(who, deriveCharacter(sheet, characterContentFor(demo.project), demo.project.abilities).character);
    refreshWorld(demo);
  };

  /**
   * Kara swinging with the room able to answer, and a husk that will not fall.
   * The cards and what they do are the project's, carried before any sheet is
   * derived over them.
   */
  const swinging = (
    seed: string,
    abilities: readonly Record<string, unknown>[],
    card: string | null,
    hope = 6,
  ): { demo: DemoScene; husk: EntityState } => {
    const demo = standoff(seed);
    demo.askDefender = true;
    demo.project.domainCards.push(...FIXTURE_CARDS);
    for (const ability of abilities) demo.project.abilities.push(abilitySchema.parse(ability));
    // Nothing of Kara's own answers a swing, so an offer is always Finn's: the
    // card in her hand carries nothing at all.
    hold(demo, 'kara', [SILENT_CARD]);
    hold(demo, 'finn', card === null ? [] : [card]);
    const finn = demo.state.entity('finn')!;
    finn.hope = { max: 6, value: hope };
    // Close enough to say something: Support Tank asks for an ally within Close.
    const kara = demo.state.entity('kara')!;
    const blocked = demo.state.blockedFor('finn');
    demo.grid.forEachNeighbor(kara.tile, false, (tile) => {
      if (finn.tile !== kara.tile && demo.grid.isPassable(tile) && !blocked(tile) && demo.grid.chebyshevDistance(finn.tile, kara.tile) > 2) {
        demo.state.moveEntity('finn', tile);
      }
    });
    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    husk.hitPoints = { max: 40, marked: 0 };
    return { demo, husk };
  };

  it('Reassurance is offered on an ally\'s roll and not on the holder\'s own', () => {
    const { demo, husk } = swinging('reassure-offered', REASSURANCE, REASSURANCE_CARD);
    const first = attackWithSelected(demo, husk.id);
    // Kara rolled; Finn holds the card, so Finn is asked.
    expect(first?.waiting).toBe(true);
    expect(demo.pending?.kind).toBe('reaction');
    if (demo.pending?.kind !== 'reaction') throw new Error('expected a reaction prompt');
    expect(demo.pending.offers.map((o) => o.ability.id)).toEqual(['fixture-reassurance']);
    expect(demo.pending.offers[0]!.by).toBe('finn');

    // The same card in the roller's own hand answers nothing: `not self`.
    const mine = swinging('reassure-mine', REASSURANCE, null);
    hold(mine.demo, 'kara', [REASSURANCE_CARD]);
    expect(attackWithSelected(mine.demo, mine.husk.id)?.waiting).not.toBe(true);
  });

  it('turns a miss into a hit, damage and all', () => {
    for (let seed = 1; seed < 200; seed++) {
      const { demo, husk } = swinging('reassure-hit-' + seed, REASSURANCE, REASSURANCE_CARD);
      const first = attackWithSelected(demo, husk.id);
      if (first?.waiting !== true || first.hit) continue;

      // Let it pass and the miss stands; take it and the dice go again.
      answerPending(demo, { kind: 'choose', index: 1 });
      while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
      if (husk.hitPoints.marked === 0) continue;

      // A swing that only became a hit on the second throw still rolls damage:
      // the first attempt never had any to keep.
      expect(husk.hitPoints.marked).toBeGreaterThan(0);
      expect(demo.log.some((l) => /throws again/.test(l.text))).toBe(true);
      // And the roll the log reports is the one that stands.
      const shown = demo.rolls[demo.rolls.length - 1]!.roll;
      expect(shown.success).toBe(true);
      return;
    }
    throw new Error('no miss became a hit in two hundred tries');
  });

  it('and can just as easily turn a hit into a miss', () => {
    for (let seed = 1; seed < 200; seed++) {
      const { demo, husk } = swinging('reassure-miss-' + seed, REASSURANCE, REASSURANCE_CARD);
      const first = attackWithSelected(demo, husk.id);
      if (first?.waiting !== true || !first.hit) continue;

      answerPending(demo, { kind: 'choose', index: 1 });
      while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
      if (husk.hitPoints.marked > 0) continue;

      // Nothing marked, and the log says it went wide.
      expect(husk.hitPoints.marked).toBe(0);
      expect(demo.rolls[demo.rolls.length - 1]!.roll.success).toBe(false);
      return;
    }
    throw new Error('no hit became a miss in two hundred tries');
  });

  it('letting it pass leaves the roll exactly as it was thrown', () => {
    for (let seed = 1; seed < 200; seed++) {
      const { demo, husk } = swinging('reassure-pass-' + seed, REASSURANCE, REASSURANCE_CARD);
      const first = attackWithSelected(demo, husk.id);
      if (first?.waiting !== true) continue;

      answerPending(demo, { kind: 'choose', index: 0 });
      while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
      expect(demo.log.some((l) => /throws again/.test(l.text))).toBe(false);
      expect(demo.rolls[demo.rolls.length - 1]!.roll.success).toBe(first.hit);
      return;
    }
    throw new Error('nobody was ever asked, in two hundred tries');
  });

  it('Support Tank answers a failure and stays quiet on a success', () => {
    let onFailure = false;
    let onSuccess = false;
    for (let seed = 1; seed < 120 && !(onFailure && onSuccess); seed++) {
      const { demo, husk } = swinging('tank-' + seed, SUPPORT_TANK, SUPPORT_CARD);
      const first = attackWithSelected(demo, husk.id);
      // A hit is a successful roll; the card only answers a failed one.
      if (first?.waiting === true) {
        if (demo.pending?.kind !== 'reaction') throw new Error('expected a reaction prompt');
        expect(demo.pending.offers.map((o) => o.ability.id)).toEqual(['fixture-support-tank']);
        expect(first.hit).toBe(false);
        // Two Hope, and only the Fear Die goes back in the cup.
        const before = demo.state.entity('finn')!.hope!.value;
        answerPending(demo, { kind: 'choose', index: 1 });
        while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
        expect(demo.state.entity('finn')!.hope!.value).toBe(before - 2);
        expect(demo.rolls[demo.rolls.length - 1]!.roll.hope).toBe(first.hit ? 0 : demo.rolls[demo.rolls.length - 1]!.roll.hope);
        onFailure = true;
      } else {
        onSuccess = true;
      }
    }
    expect({ onFailure, onSuccess }).toEqual({ onFailure: true, onSuccess: true });
  });

  it('and is not even offered when the two Hope are not there', () => {
    for (let seed = 1; seed < 120; seed++) {
      const rich = swinging('tank-hope-' + seed, SUPPORT_TANK, SUPPORT_CARD, 6);
      if (attackWithSelected(rich.demo, rich.husk.id)?.waiting !== true) continue;

      // The same seed, so the same roll: what changes is the purse. A card
      // nobody can pay for is never put to them - the offer is the question,
      // and there is no point asking one whose answer is refused.
      const poor = swinging('tank-hope-' + seed, SUPPORT_TANK, SUPPORT_CARD, 1);
      expect(attackWithSelected(poor.demo, poor.husk.id)?.waiting).not.toBe(true);
      expect(poor.demo.log.some((l) => /throws again/.test(l.text))).toBe(false);
      return;
    }
    throw new Error('Support Tank was never offered, in a hundred and twenty tries');
  });
});


/**
 * A bonus that reads on every action roll rather than on a kind of one, and
 * the card it was added for: a die that sits on the sheet, grows with every
 * roll it helped, and drops off past six.
 */
describe('a bonus on every action roll', () => {
  const hold = (demo: DemoScene, who: string, cards: string[]): void => {
    const sheet = { ...demo.sheets.get(who)!, domainCards: cards, loadout: cards.slice(0, 5) };
    demo.sheets.set(who, sheet);
    demo.characters.set(who, deriveCharacter(sheet, characterContentFor(demo.project), demo.project.abilities).character);
    refreshWorld(demo);
  };

  it('reaches a plain trait check, a Spellcast Roll and a swing alike', () => {
    const demo = scene('action-roll');
    hold(demo, 'mira', ['wild-surge']);
    demo.scenario.actorId = 'mira';
    const plain = demo.world.checkModifier('agility', 'actor')!;
    const spell = demo.world.checkModifier('spellcast', 'actor')!;
    const swing = demo.world.rollBonus('mira', 'attackRoll', { melee: false });
    const hurt = demo.world.rollBonus('mira', 'damageRoll', { melee: false });

    // Four tokens on the card is a Wild Surge Die showing four.
    demo.world.applyCondition('mira', 'wild-surging', 'scene');
    demo.world.addTokens('mira', 'wild-surge', 4);
    expect(demo.world.checkModifier('agility', 'actor')).toBe(plain + 4);
    expect(demo.world.checkModifier('spellcast', 'actor')).toBe(spell + 4);
    expect(demo.world.rollBonus('mira', 'attackRoll', { melee: false })).toBe(swing + 4);
    // A damage roll is not an action roll, and neither is the party's best
    // trait read for somebody who is not the one surging.
    expect(demo.world.rollBonus('mira', 'damageRoll', { melee: false })).toBe(hurt);
    demo.scenario.actorId = 'kara';
    expect(demo.world.checkModifier('agility', 'actor')).toBe(demo.characters.get('kara')!.traits.agility);
  });

  it('is worth nothing with the condition gone, however many tokens are on the card', () => {
    const demo = scene('action-roll-off');
    hold(demo, 'mira', ['wild-surge']);
    demo.scenario.actorId = 'mira';
    const plain = demo.world.checkModifier('agility', 'actor')!;
    demo.world.addTokens('mira', 'wild-surge', 5);
    // The die is on the card; what reads it is the form, and there is none.
    expect(demo.world.checkModifier('agility', 'actor')).toBe(plain);
  });

  it('Wild Surge starts at one, grows with each roll, and drops past six', () => {
    const demo = standoff('wild-surge');
    demo.askDefender = false;
    hold(demo, 'kara', ['wild-surge']);
    const kara = demo.state.entity('kara')!;
    kara.stress = { max: 12, marked: 0 };
    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    husk.hitPoints = { max: 60, marked: 0 };

    expect(useAbility(demo, 'kara', 'wild-surge', []).status).not.toBe('refused');
    while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
    // A Stress to channel it, and the die face up on one.
    expect(kara.conditions.has('wild-surging')).toBe(true);
    expect(demo.world.tokensOn('kara', 'wild-surge')).toBe(1);
    expect(kara.stress.marked).toBe(1);

    // Six swings: each takes the die it found and leaves it one higher, and
    // the seventh turn of it has nowhere to go.
    const seen: number[] = [];
    let cost: number | null = null;
    for (let i = 0; i < 6 && kara.conditions.has('wild-surging'); i++) {
      seen.push(demo.world.tokensOn('kara', 'wild-surge'));
      const stress = kara.stress.marked;
      attackWithSelected(demo, husk.id);
      while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
      if (!kara.conditions.has('wild-surging')) {
        // The swing the form dropped on. A critical clears a Stress of its own,
        // so what the drop cost is the difference net of that.
        const crit = demo.rolls[demo.rolls.length - 1]?.roll.critical === true;
        cost = kara.stress.marked - stress + (crit ? 1 : 0);
      }
      if (demo.encounter?.outcome === 'ongoing') endTurn(demo);
      while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
    }
    // One through six, and the die never showed a seven to anybody.
    expect(seen).toEqual([1, 2, 3, 4, 5, 6]);
    expect(kara.conditions.has('wild-surging')).toBe(false);
    expect(demo.world.tokensOn('kara', 'wild-surge')).toBe(0);
    // "You must mark an additional Stress."
    expect(cost).toBe(1);
  });
});


/**
 * Ground that bites: a zone whose condition carries a script, run once on
 * whoever crosses into it and never on standing still.
 */
describe('a circle burnt into the floor', () => {
  /**
   * One card, two spells: ground that bites whatever crosses onto it, and a
   * lift that sets a creature down away from the one who lifted it.
   *
   * The bite lives in the condition's `onEnter`, so the crossing is the whole
   * of it. Standing in the circle when it is drawn is a crossing -- nobody was
   * in it a moment earlier -- and standing still afterwards is not, which is
   * the distinction the first test settles the fight twice to check.
   *
   * `side: 'adversaries'` is read from the caster's chair, so this is only ever
   * ground under somebody else's feet.
   */
  const CIRCLE_CARD = 'fixture-card-35';

  /** Ground that answers a crossing: a real blow, and knocked back out of reach. */
  const CIRCLE_CONDITION = {
    id: 'fixture-circle',
    name: 'Burnt Circle',
    text: 'Ground that answers anybody who steps onto it: a blow, and knocked back.',
    color: '#b46cff',
    onEnter: {
      effects: [
        { kind: 'log', text: 'The floor answers them as they cross it.', tone: 'fear' },
        { kind: 'damage', dice: '2d12+4', type: 'magic', target: { kind: 'target' } },
        { kind: 'push', to: 'veryClose', target: { kind: 'target' } },
      ],
    },
  };

  /**
   * What a lift does, shared by all three success faces: the one lifted moves,
   * and the one lifting does not. `who` being the creature that was hit rather
   * than the actor is the whole of it.
   */
  const LIFTED = [
    { kind: 'log', text: 'They come off the floor, turn over once, and are set down somewhere else.', tone: 'combat' },
    { kind: 'move', who: { kind: 'hit' }, how: 'away', of: { kind: 'actor' }, budget: 'close' },
  ];

  const CIRCLE = [
    {
      id: 'fixture-circle-draw',
      name: 'Burnt Circle',
      source: { kind: 'domainCard', card: CIRCLE_CARD },
      text: 'Mark a Stress to burn a circle into the floor around your own feet.',
      cost: { stress: 1 },
      target: { kind: 'self' },
      inCombatOnly: true,
      effects: [
        { kind: 'log', text: 'A circle burns itself into the floor around their feet.', tone: 'hope' },
        {
          kind: 'zone',
          zone: 'fixture-circle-ground',
          name: 'Burnt Circle',
          condition: 'fixture-circle',
          at: 'actor',
          band: 'melee',
          side: 'adversaries',
          onDeath: 'end',
        },
      ],
    },
    {
      id: 'fixture-lift',
      name: 'Lift',
      source: { kind: 'domainCard', card: CIRCLE_CARD },
      text: 'Lift a creature you can see off the floor and set it down somewhere else.',
      target: { kind: 'adversary', range: 'far' },
      effects: [
        {
          kind: 'check',
          check: {
            trait: 'spellcast',
            difficulty: 'target',
            prompt: 'Lift them off the floor?',
            onCriticalSuccess: LIFTED,
            onSuccessWithHope: LIFTED,
            onSuccessWithFear: LIFTED,
          },
        },
      ],
    },
  ];

  const hold = (demo: DemoScene, who: string, cards: string[]): void => {
    demo.project.domainCards.push(...FIXTURE_CARDS);
    demo.project.conditionDefs.push(conditionDefSchema.parse(CIRCLE_CONDITION));
    for (const ability of CIRCLE) demo.project.abilities.push(abilitySchema.parse(ability));
    const sheet = { ...demo.sheets.get(who)!, domainCards: cards, loadout: cards.slice(0, 5) };
    demo.sheets.set(who, sheet);
    demo.characters.set(who, deriveCharacter(sheet, characterContentFor(demo.project), demo.project.abilities).character);
    refreshWorld(demo);
  };

  it('takes the ones already standing in it once, and not again for standing still', () => {
    const demo = standoff('circle-drawn');
    demo.askDefender = false;
    hold(demo, 'kara', [CIRCLE_CARD]);
    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    husk.hitPoints = { max: 40, marked: 0 };
    const kara = demo.state.entity('kara')!;

    expect(useAbility(demo, 'kara', 'fixture-circle-draw', []).status).not.toBe('refused');
    while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
    // Standing in Melee when the circle was drawn is a crossing: they were not
    // in it a moment ago.
    const bitten = husk.hitPoints.marked;
    expect(bitten).toBeGreaterThan(0);
    // 2d12+4 is between 6 and 28: a real blow, whatever the dice said.
    expect(demo.log.some((l) => /floor answers them/.test(l.text))).toBe(true);
    // And knocked back out of Melee, which is the other half of the card.
    expect(demo.grid.chebyshevDistance(kara.tile, husk.tile)).toBeGreaterThan(1);

    // The ground is settled twice more with nobody moving; it bites nobody.
    settleFight(demo);
    settleFight(demo);
    expect(husk.hitPoints.marked).toBe(bitten);
  });

  it('takes an adversary that walks in on its own turn, with nobody swinging', () => {
    for (let seed = 1; seed < 40; seed++) {
      const demo = standoff('circle-walk-' + seed);
      demo.askDefender = false;
      hold(demo, 'kara', [CIRCLE_CARD]);
      const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
      husk.hitPoints = { max: 60, marked: 0 };
      // Well out of the circle when it is drawn, so casting it costs them
      // nothing and only walking in can.
      const away = demo.grid.indexOf(
        Math.min(demo.grid.width - 1, demo.grid.xOf(demo.state.entity('kara')!.tile) + 5),
        demo.grid.yOf(husk.tile),
      );
      if (away === NO_TILE || !demo.grid.isPassable(away)) continue;
      demo.state.moveEntity(husk.id, away);

      expect(useAbility(demo, 'kara', 'fixture-circle-draw', []).status).not.toBe('refused');
      while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
      if (husk.hitPoints.marked > 0) continue;

      // The GM's turn walks it back in to swing, and the floor answers before
      // anybody on the party's side has done anything at all.
      endTurn(demo);
      while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
      if (husk.hitPoints.marked === 0) continue;
      expect(husk.hitPoints.marked).toBeGreaterThan(0);
      expect(demo.log.some((l) => /floor answers them/.test(l.text))).toBe(true);
      return;
    }
    throw new Error('nothing ever walked into the circle in forty tries');
  });

  it('does not touch the one who drew it, nor anybody on their side', () => {
    const demo = standoff('circle-side');
    demo.askDefender = false;
    hold(demo, 'kara', [CIRCLE_CARD]);
    const kara = demo.state.entity('kara')!;
    const finn = demo.state.entity('finn')!;
    const blocked = demo.state.blockedFor('finn');
    demo.grid.forEachNeighbor(kara.tile, false, (tile) => {
      if (demo.grid.isPassable(tile) && !blocked(tile) && finn.tile !== tile) demo.state.moveEntity('finn', tile);
    });
    const hurt = { kara: kara.hitPoints.marked, finn: finn.hitPoints.marked };

    expect(useAbility(demo, 'kara', 'fixture-circle-draw', []).status).not.toBe('refused');
    while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
    // `side: 'adversaries'` is read from the caster's chair, so the circle is
    // only ever ground under somebody else's feet.
    expect(kara.hitPoints.marked).toBe(hurt.kara);
    expect(finn.hitPoints.marked).toBe(hurt.finn);
  });

  it('lifts somebody and sets them down away from the one who lifted them', () => {
    for (let seed = 1; seed < 60; seed++) {
      const demo = standoff('circle-lift-' + seed);
      demo.askDefender = false;
      // A Codex grimoire wants somebody with a Spellcast trait behind it.
      hold(demo, 'mira', [CIRCLE_CARD]);
      const mira = demo.state.entity('mira')!;
      const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
      // Standing where she can see it, and holding the spotlight to cast.
      const blocked = demo.state.blockedFor('mira');
      demo.grid.forEachNeighbor(demo.state.entity('kara')!.tile, false, (tile) => {
        if (demo.grid.isPassable(tile) && !blocked(tile) && tile !== husk.tile) demo.state.moveEntity('mira', tile);
      });
      demo.party.select('mira');
      const stood = mira.tile;
      const was = demo.grid.chebyshevDistance(mira.tile, husk.tile);

      expect(useAbility(demo, 'mira', 'fixture-lift', [husk.id]).status).not.toBe('refused');
      while (demo.pending !== null) answerPending(demo, { kind: 'roll' });
      if (demo.grid.chebyshevDistance(mira.tile, husk.tile) === was) continue;

      // The one lifted moved; the one lifting did not. Before this, `move`'s
      // `who` was ignored outside a run at a point and the caster would have
      // walked instead - which is the bug this card found.
      expect(mira.tile).toBe(stood);
      expect(demo.grid.chebyshevDistance(mira.tile, husk.tile)).toBeGreaterThan(was);
      return;
    }
    throw new Error('the lift never landed in sixty tries');
  });
});


/**
 * The second card built on ground that bites: where Korvax's circle hurts
 * whatever crosses it, this drags it in and holds it.
 */
describe('a stance that holds the ground around it', () => {
  /**
   * A stance that makes the ground around its holder mean something: anything
   * that walks within Very Close of her is dragged into reach and pinned there.
   *
   * Two abilities on one card, and the second is not decoration. The stance
   * paints the ground; a reaction on the holder's own dice takes it away again
   * when she fails with Fear. The last test here pins that reaction, so a
   * specimen carrying only the stance would fail it for the wrong reason.
   *
   * What the ground does lives in the condition it paints, not in the card --
   * the pull and the hold both happen on the crossing.
   */
  const STANCE_CARD = 'fixture-card-21';

  /** On the one holding it. Carries nothing: the ground does the work. */
  const BRACED_CONDITION = {
    id: 'fixture-braced',
    name: 'Braced',
    text: 'Feet set: anything that comes near enough is dragged into reach and held.',
  };

  /** And on whoever walked into it. Everything happens on the crossing. */
  const CAUGHT_CONDITION = {
    id: 'fixture-caught',
    name: 'Caught',
    text: 'Dragged into reach of whoever is holding this ground.',
    color: '#e0b04a',
    onEnter: {
      effects: [
        { kind: 'log', text: 'They step one pace too near, and the ground takes them the rest of the way.', tone: 'combat' },
        { kind: 'move', who: { kind: 'target' }, how: 'toward', of: { kind: 'actor' }, range: 'melee', budget: 'veryClose' },
        // The engine's own condition, and a generic one, so it stays.
        { kind: 'applyCondition', condition: 'restrained', duration: 'temporary', target: { kind: 'target' } },
      ],
    },
  };

  const STANCE = [
    {
      id: 'fixture-stance',
      name: 'Set Feet',
      source: { kind: 'domainCard', card: STANCE_CARD },
      text: 'Spend a Hope to set your feet, and the ground around you stops being neutral.',
      cost: { hope: 1 },
      target: { kind: 'self' },
      inCombatOnly: true,
      action: false,
      effects: [
        { kind: 'log', text: 'They set their feet, and the ground stops being anybody\'s.', tone: 'hope' },
        { kind: 'applyCondition', condition: 'fixture-braced', duration: 'scene', target: { kind: 'actor' } },
        {
          kind: 'zone',
          zone: 'fixture-line',
          name: 'Set Feet',
          condition: 'fixture-caught',
          at: 'actor',
          band: 'veryClose',
          side: 'adversaries',
          onDeath: 'end',
        },
      ],
    },
    {
      id: 'fixture-stance-drops',
      name: 'Set Feet',
      source: { kind: 'domainCard', card: STANCE_CARD },
      text: 'Fail badly enough while holding it and the stance goes, and the ground with it.',
      kind: 'reaction',
      trigger: 'partyRolled',
      action: false,
      available: {
        kind: 'all',
        of: [
          { kind: 'self' },
          { kind: 'hasCondition', condition: 'fixture-braced' },
          { kind: 'rolled', is: 'failure' },
          { kind: 'rolled', is: 'withFear' },
        ],
      },
      effects: [
        { kind: 'log', text: 'The stance goes, and the ground means nothing again.', tone: 'fear' },
        { kind: 'endZone', zone: 'fixture-line' },
        { kind: 'clearCondition', condition: 'fixture-braced', target: { kind: 'actor' } },
      ],
    },
  ];

  /** The card, the ground it paints, and what the ground leaves on people. */
  const carry = (demo: DemoScene): void => {
    demo.project.domainCards.push(...FIXTURE_CARDS);
    for (const condition of [BRACED_CONDITION, CAUGHT_CONDITION]) {
      demo.project.conditionDefs.push(conditionDefSchema.parse(condition));
    }
    for (const ability of STANCE) demo.project.abilities.push(abilitySchema.parse(ability));
  };

  const hold = (demo: DemoScene, who: string, cards: string[]): void => {
    const sheet = { ...demo.sheets.get(who)!, domainCards: cards, loadout: cards.slice(0, 5) };
    demo.sheets.set(who, sheet);
    demo.characters.set(who, deriveCharacter(sheet, characterContentFor(demo.project), demo.project.abilities).character);
    refreshWorld(demo);
  };

  /** Kara braced, with the husk parked well outside Very Close of her. */
  const braced = (seed: string): { demo: DemoScene; husk: EntityState; kara: EntityState } => {
    const demo = standoff(seed);
    demo.askDefender = false;
    carry(demo);
    hold(demo, 'kara', [STANCE_CARD]);
    const kara = demo.state.entity('kara')!;
    kara.hope = { max: 6, value: 6 };
    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    husk.hitPoints = { max: 60, marked: 0 };
    return { demo, husk, kara };
  };

  it('costs a Hope, marks the one holding it, and puts a zone on the board', () => {
    const { demo, kara } = braced('line-up');
    expect(useAbility(demo, 'kara', 'fixture-stance', []).status).not.toBe('refused');
    while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });

    expect(kara.hope!.value).toBe(5);
    expect(kara.conditions.has('fixture-braced')).toBe(true);
    expect(demo.world.zones().map((z) => z.id)).toContain('fixture-line');
  });

  it('hauls in an adversary that walks within Very Close, and holds it there', () => {
    for (let seed = 1; seed < 40; seed++) {
      const { demo, husk, kara } = braced('line-pull-' + seed);
      // Out past Very Close of her, so only walking in can set it off.
      const away = demo.grid.indexOf(
        Math.min(demo.grid.width - 1, demo.grid.xOf(kara.tile) + 6),
        demo.grid.yOf(husk.tile),
      );
      if (away === NO_TILE || !demo.grid.isPassable(away)) continue;
      demo.state.moveEntity(husk.id, away);

      expect(useAbility(demo, 'kara', 'fixture-stance', []).status).not.toBe('refused');
      while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
      // Nothing was inside it when it went up.
      if (husk.conditions.has('restrained')) continue;

      endTurn(demo);
      while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
      if (!husk.conditions.has('fixture-caught')) continue;

      // Dragged the rest of the way in: Melee is one tile. The hold itself is
      // `temporary`, which the creature's own next spotlight shakes off - so
      // what this test claims is that walking in on the GM's turn sets the
      // stance off at all, with nobody on the party's side having acted.
      expect(demo.grid.chebyshevDistance(kara.tile, husk.tile)).toBeLessThanOrEqual(1);
      expect(demo.log.some((l) => /takes them the rest of the way/.test(l.text))).toBe(true);
      return;
    }
    throw new Error('nothing ever walked into the line in forty tries');
  });

  it('and what it leaves on them is the hold', () => {
    const { demo, husk, kara } = braced('line-hold');
    const away = demo.grid.indexOf(
      Math.min(demo.grid.width - 1, demo.grid.xOf(kara.tile) + 6),
      demo.grid.yOf(husk.tile),
    );
    demo.state.moveEntity(husk.id, away);
    expect(useAbility(demo, 'kara', 'fixture-stance', []).status).not.toBe('refused');
    while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
    expect(husk.conditions.has('fixture-caught')).toBe(false);

    // Walked in by hand and the ground read again, which is the crossing with
    // none of the turn's own housekeeping around it.
    let near = NO_TILE;
    demo.grid.forEachNeighbor(kara.tile, false, (tile) => {
      if (near === NO_TILE && demo.grid.isPassable(tile) && tile !== kara.tile) near = tile;
    });
    demo.state.moveEntity(husk.id, near);
    settleFight(demo);

    expect(husk.conditions.has('fixture-caught')).toBe(true);
    expect(husk.conditions.has('restrained')).toBe(true);
    expect(demo.grid.chebyshevDistance(kara.tile, husk.tile)).toBeLessThanOrEqual(1);
  });

  it('drops on a failure with Fear, and the ground stops meaning anything', () => {
    for (let seed = 1; seed < 80; seed++) {
      const { demo, husk, kara } = braced('line-drop-' + seed);
      expect(useAbility(demo, 'kara', 'fixture-stance', []).status).not.toBe('refused');
      while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
      expect(demo.world.zones().map((z) => z.id)).toContain('fixture-line');

      attackWithSelected(demo, husk.id);
      while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
      const roll = demo.rolls[demo.rolls.length - 1]?.roll;
      if (roll === undefined) continue;
      if (roll.outcome !== 'failureWithFear') {
        // Any other roll leaves the stance standing, which is half the claim.
        expect(kara.conditions.has('fixture-braced')).toBe(true);
        expect(demo.world.zones().map((z) => z.id)).toContain('fixture-line');
        continue;
      }
      expect(kara.conditions.has('fixture-braced')).toBe(false);
      expect(demo.world.zones().map((z) => z.id)).not.toContain('fixture-line');
      // And nobody is standing in ground that is no longer there.
      expect(husk.conditions.has('fixture-caught')).toBe(false);
      return;
    }
    throw new Error('Kara never failed with Fear in eighty tries');
  });
});


/**
 * The Book of Sitil's echo: the same attack roll, laid against a second
 * Difficulty rather than thrown again. The first card to reuse a roll made
 * outside the runner.
 */
describe('a swing that reaches one more', () => {
  /**
   * A mark that makes the next swing reach one creature more -- not by throwing
   * a second time, but by laying the roll already made against a second
   * Difficulty. `roll: 'last'` is that, and it is the only place a card reuses a
   * throw made outside the runner.
   *
   * Three things the tests turn on. The mark is cleared before the check, so it
   * is spent whether or not the second reading beats anybody: the attack it was
   * waiting for has been made. `except` keeps the echo off the creature already
   * hit and `nearest` picks exactly one other. And the condition carries nothing
   * but `grants`, lending its bearer the half of the card that swings -- because
   * whoever is marked is not whoever cast it.
   */
  const ECHO_CARD = 'fixture-card-34';

  /** Incidental: the first two tests apply the mark by hand and only need a
   * card in hand at all. No ability sits on this one. */
  const BARE_CARD = 'fixture-card-33';

  /** Nothing while it waits. What it does is written on what spends it. */
  const ECHO_CONDITION = {
    id: 'fixture-echo',
    name: 'Echoing',
    text: 'The next attack you make also reaches one more creature its roll would have beaten.',
    grants: { ability: 'fixture-echo-strikes' },
  };

  const ECHO = [
    {
      id: 'fixture-echo-cast',
      name: 'Echoing Strike',
      source: { kind: 'domainCard', card: ECHO_CARD },
      text: 'Spend two Hope to set an echo beside somebody close by, until their next swing.',
      cost: { hope: 2 },
      target: { kind: 'ally', range: 'close' },
      effects: [
        // One creature at a time: off everybody before it goes on anybody.
        { kind: 'clearCondition', condition: 'fixture-echo', target: { kind: 'allies' } },
        { kind: 'log', text: 'The air beside them doubles, and waits.', tone: 'hope' },
        { kind: 'applyCondition', condition: 'fixture-echo', duration: 'scene', target: { kind: 'target' } },
      ],
    },
    {
      // The half the marked creature holds, lent to them by the condition.
      id: 'fixture-echo-strikes',
      name: 'Echoing Strike',
      source: { kind: 'domainCard', card: ECHO_CARD },
      text: 'The swing that spends it also reaches the next creature along its roll would beat.',
      kind: 'reaction',
      trigger: 'dealtHit',
      action: false,
      available: { kind: 'hasCondition', condition: 'fixture-echo', of: { kind: 'actor' } },
      effects: [
        // Spent first: whether the second reading lands or not, the swing it
        // was waiting for has been made.
        { kind: 'clearCondition', condition: 'fixture-echo', target: { kind: 'actor' } },
        {
          kind: 'check',
          check: {
            trait: 'weapon',
            difficulty: 'target',
            // The throw already made, read again rather than rolled again.
            roll: 'last',
            targets: { kind: 'adversaries', range: 'far', reach: 'weapon', except: 'target', nearest: 1 },
            always: [{ kind: 'damage', dice: 'weapon', using: 'proficiency', target: { kind: 'hit' } }],
          },
        },
      ],
    },
  ];

  const hold = (demo: DemoScene, who: string, cards: string[]): void => {
    demo.project.domainCards.push(...FIXTURE_CARDS);
    demo.project.conditionDefs.push(conditionDefSchema.parse(ECHO_CONDITION));
    for (const ability of ECHO) demo.project.abilities.push(abilitySchema.parse(ability));
    const sheet = { ...demo.sheets.get(who)!, domainCards: cards, loadout: cards.slice(0, 5) };
    demo.sheets.set(who, sheet);
    demo.characters.set(who, deriveCharacter(sheet, characterContentFor(demo.project), demo.project.abilities).character);
    refreshWorld(demo);
  };

  /** Kara beside two husks, marked with the echo and about to swing. */
  const marked = (seed: string): { demo: DemoScene; first: EntityState; second: EntityState } => {
    const demo = standoff(seed);
    demo.askDefender = false;
    hold(demo, 'kara', [BARE_CARD]);
    const kara = demo.state.entity('kara')!;
    const first = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    // A second husk stood back up beside the first, so the echo has somewhere
    // to go: `nearest: 1` picks it and nobody else.
    const spare = demo.state.entitiesOf('adversary').find((e) => !e.alive)!;
    spare.alive = true;
    spare.hitPoints = { max: 40, marked: 0 };
    first.hitPoints = { max: 40, marked: 0 };
    const blocked = demo.state.blockedFor(spare.id);
    demo.grid.forEachNeighbor(kara.tile, false, (tile) => {
      if (demo.grid.isPassable(tile) && !blocked(tile) && tile !== first.tile) demo.state.moveEntity(spare.id, tile);
    });
    demo.world.applyCondition('kara', 'fixture-echo', 'scene');
    return { demo, first, second: spare };
  };

  it('lays the same roll against the next one along, and spends the mark', () => {
    for (let seed = 1; seed < 60; seed++) {
      const { demo, first, second } = marked('sitil-' + seed);
      if (demo.grid.chebyshevDistance(demo.state.entity('kara')!.tile, second.tile) > 1) continue;

      attackWithSelected(demo, first.id);
      while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
      const roll = demo.rolls[demo.rolls.length - 1]?.roll;
      if (roll === undefined || !roll.success) continue;

      // The swing landed on the one it was aimed at, and the echo carried the
      // same roll onto the other without throwing a second time.
      expect(first.hitPoints.marked).toBeGreaterThan(0);
      expect(second.hitPoints.marked).toBeGreaterThan(0);
      // Spent: the attack it was waiting for has been made.
      expect(demo.state.entity('kara')!.conditions.has('fixture-echo')).toBe(false);
      return;
    }
    throw new Error('Kara never landed a swing with the echo up, in sixty tries');
  });

  it('throws no second time: the echo is the same dice', () => {
    for (let seed = 1; seed < 60; seed++) {
      const { demo, first, second } = marked('sitil-same-' + seed);
      if (demo.grid.chebyshevDistance(demo.state.entity('kara')!.tile, second.tile) > 1) continue;

      const before = demo.rolls.length;
      attackWithSelected(demo, first.id);
      while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
      const shown = demo.rolls.slice(before);
      if (shown.length < 2) continue;

      // The swing, then the echo laying it against the second Difficulty. Two
      // readings of one throw: the faces are the same, which is the whole of
      // what "their attack roll would succeed against" asks for.
      const swing = shown[0]!.roll;
      const echo = shown[shown.length - 1]!.roll;
      expect(echo.hope).toBe(swing.hope);
      expect(echo.fear).toBe(swing.fear);
      expect(echo.total).toBe(swing.total);
      return;
    }
    throw new Error('the echo never fired in sixty tries');
  });

  it('is only cast on one creature at a time', () => {
    const demo = standoff('sitil-one');
    demo.askDefender = false;
    hold(demo, 'mira', [ECHO_CARD]);
    const mira = demo.state.entity('mira')!;
    mira.hope = { max: 6, value: 6 };
    const kara = demo.state.entity('kara')!;
    const finn = demo.state.entity('finn')!;
    // Both standing close enough to be cast on.
    const blocked = demo.state.blockedFor('mira');
    demo.grid.forEachNeighbor(kara.tile, false, (tile) => {
      if (demo.grid.isPassable(tile) && !blocked(tile)) demo.state.moveEntity('mira', tile);
    });
    demo.state.moveEntity('finn', demo.grid.indexOf(demo.grid.xOf(mira.tile), demo.grid.yOf(mira.tile) + 1));
    demo.party.select('mira');

    expect(useAbility(demo, 'mira', 'fixture-echo-cast', ['kara']).status).not.toBe('refused');
    while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
    expect(kara.conditions.has('fixture-echo')).toBe(true);

    expect(useAbility(demo, 'mira', 'fixture-echo-cast', ['finn']).status).not.toBe('refused');
    while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
    // The mark moved rather than doubling: "you can only hold this spell on
    // one creature at a time".
    expect(finn.conditions.has('fixture-echo')).toBe(true);
    expect(kara.conditions.has('fixture-echo')).toBe(false);
  });
});


/**
 * The rest of the Codex grimoires: four Books with something a fight can use,
 * cast by the one member of the party who has a Spellcast trait.
 */
describe('the last of the Codex', () => {
  /**
   * Five cards, one at a time, and the widest span of machinery here: a
   * condition made permanent, an immunity, a room stopped and started again, a
   * patch of burning ground, a way out that refuses with something in reach, a
   * roll that strips a condition off everything it beats, and one card that is
   * only ever read rather than played.
   *
   * The burning ground is the interesting one. The zone effect is geography and
   * names a condition; the condition carries what happens to whoever walks
   * through. So that card needs a condition beside it, and the fixture carries
   * both.
   */
  const CODEX_CARD = 'fixture-card-15';

  /** Permanent outlives the scene, where everything else a card hands out does not. */
  const ENERVATION = [
    {
      id: 'fixture-enervation',
      name: 'Eternal Enervation',
      source: { kind: 'domainCard', card: CODEX_CARD },
      text: 'Take something out of them that is not coming back.',
      uses: { count: 1, per: 'longRest' },
      target: { kind: 'adversary', range: 'close' },
      effects: [
        {
          kind: 'check',
          check: {
            trait: 'spellcast',
            difficulty: 'target',
            prompt: 'Take something out of them for good.',
            onCriticalSuccess: ENERVATED_ARMS,
            onSuccessWithHope: ENERVATED_ARMS,
            onSuccessWithFear: ENERVATED_ARMS,
          },
        },
      ],
    },
  ];

  /** A price on the ability itself, and a defence that lives on a condition. */
  const IMMUNITY = [
    {
      id: 'fixture-immunity',
      name: 'Magic Immunity',
      source: { kind: 'domainCard', card: CODEX_CARD },
      text: 'Whatever magic is for, it stops being for them.',
      cost: { hope: 5 },
      target: { kind: 'self' },
      action: false,
      effects: [
        { kind: 'log', text: 'Whatever magic is for, it stops being for them.', tone: 'hope' },
        { kind: 'applyCondition', condition: 'magic-immune', duration: 'rest', target: { kind: 'actor' } },
      ],
    },
  ];

  /**
   * The room held still, and let go by its own caster's next swing -- landed or
   * missed, which is two triggers for one idea.
   */
  const JAMMER = [
    {
      id: 'fixture-jammer',
      name: 'Timejammer',
      source: { kind: 'domainCard', card: CODEX_CARD },
      text: 'Stop the room, and start it again by moving in it.',
      target: { kind: 'none' },
      inCombatOnly: true,
      effects: [
        {
          kind: 'check',
          check: {
            trait: 'spellcast',
            difficulty: 18,
            prompt: 'Stop the room.',
            onCriticalSuccess: STOPPED_ARMS,
            onSuccessWithHope: STOPPED_ARMS,
            onSuccessWithFear: STOPPED_ARMS,
          },
        },
      ],
    },
    {
      id: 'fixture-jammer-ends',
      name: 'Timejammer',
      source: { kind: 'domainCard', card: CODEX_CARD },
      text: 'Moving in the stopped room is what lets it go.',
      kind: 'reaction',
      trigger: 'dealtHit',
      action: false,
      available: { kind: 'hasCondition', condition: 'time-jamming', of: { kind: 'actor' } },
      effects: RESUMES_ARMS,
    },
    {
      id: 'fixture-jammer-ends-on-a-miss',
      name: 'Timejammer',
      source: { kind: 'domainCard', card: CODEX_CARD },
      text: 'A swing that missed is still a swing.',
      kind: 'reaction',
      trigger: 'dealtMiss',
      action: false,
      available: { kind: 'hasCondition', condition: 'time-jamming', of: { kind: 'actor' } },
      effects: RESUMES_ARMS,
    },
  ];

  /** Ground that bites whoever crosses it, and the condition that does the biting. */
  const FLAME_CONDITION = {
    id: 'fixture-flame',
    name: 'Sheet of Flame',
    text: 'A standing sheet of fire: anything that crosses it is burned for doing so.',
    color: '#ff7a3a',
    onEnter: {
      effects: [
        { kind: 'log', text: 'They cross the fire, and the fire answers.', tone: 'fear' },
        { kind: 'damage', dice: '4d10+3', type: 'magic', target: { kind: 'target' } },
      ],
    },
  };

  const FLAME = [
    {
      id: 'fixture-flame-wall',
      name: 'Wall of Flame',
      source: { kind: 'domainCard', card: CODEX_CARD },
      text: 'Stand a sheet of fire up out of the floor, over there.',
      target: { kind: 'point', range: 'far' },
      inCombatOnly: true,
      effects: [
        {
          kind: 'check',
          check: {
            trait: 'spellcast',
            difficulty: 15,
            prompt: 'Stand it up there.',
            onCriticalSuccess: FLAME_ARMS,
            onSuccessWithHope: FLAME_ARMS,
            onSuccessWithFear: FLAME_ARMS,
          },
        },
      ],
    },
  ];

  /** A way out, which will not open with something already in reach. */
  const DOOR = [
    {
      id: 'fixture-door',
      name: 'Arcane Door',
      source: { kind: 'domainCard', card: CODEX_CARD },
      text: 'Open a way to a spot across the room, if nothing has hold of you.',
      target: { kind: 'point', range: 'far' },
      available: { kind: 'not', of: { kind: 'withinRange', range: 'melee', of: { kind: 'adversaries', range: 'melee' } } },
      effects: [
        {
          kind: 'check',
          check: {
            trait: 'spellcast',
            difficulty: 13,
            prompt: 'Open a way to that spot.',
            onCriticalSuccess: DOORWAY_ARMS,
            onSuccessWithHope: DOORWAY_ARMS,
            onSuccessWithFear: DOORWAY_ARMS,
          },
        },
      ],
    },
  ];

  /** One roll against everything Close, and whatever it beats stops hiding. */
  const REVEAL = [
    {
      id: 'fixture-reveal',
      name: 'Reveal',
      source: { kind: 'domainCard', card: CODEX_CARD },
      text: 'Show whatever is standing there without being seen.',
      target: { kind: 'none' },
      effects: [
        {
          kind: 'check',
          check: {
            trait: 'spellcast',
            difficulty: 'target',
            targets: { kind: 'adversaries', range: 'close' },
            prompt: 'Show what is hiding.',
            always: [
              { kind: 'log', text: 'The air goes thin, and what was not there is.', tone: 'hope' },
              { kind: 'clearCondition', condition: 'hidden', target: { kind: 'hit' } },
            ],
          },
        },
      ],
    },
  ];

  /**
   * Never played, only read: the last test asserts its shape and nothing else,
   * because four steps of severity is what negating a blow comes to.
   */
  const DEFLECTION = [
    {
      id: 'fixture-deflection',
      name: 'Arcane Deflection',
      source: { kind: 'domainCard', card: CODEX_CARD },
      text: 'Once between rests, a blow aimed at its holder comes to nothing.',
      kind: 'reaction',
      trigger: 'incomingDamage',
      uses: { count: 1, per: 'longRest' },
      cost: { hope: 1 },
      action: false,
      auto: false,
      reaction: { kind: 'reduceSeverity', steps: 4 },
    },
  ];

  const hold = (demo: DemoScene, who: string, cards: string[]): void => {
    const sheet = { ...demo.sheets.get(who)!, domainCards: cards, loadout: cards.slice(0, 5) };
    demo.sheets.set(who, sheet);
    demo.characters.set(who, deriveCharacter(sheet, characterContentFor(demo.project), demo.project.abilities).character);
    refreshWorld(demo);
  };

  /** Mira holding one card, stood beside Kara and holding the spotlight. */
  const casting = (
    seed: string,
    family: readonly Record<string, unknown>[],
  ): { demo: DemoScene; mira: EntityState; husk: EntityState } => {
    const demo = standoff(seed);
    demo.askDefender = false;
    demo.project.domainCards.push(...FIXTURE_CARDS);
    demo.project.conditionDefs.push(conditionDefSchema.parse(FLAME_CONDITION));
    for (const ability of family) demo.project.abilities.push(abilitySchema.parse(ability));
    hold(demo, 'mira', [CODEX_CARD]);
    const mira = demo.state.entity('mira')!;
    mira.hope = { max: 6, value: 6 };
    const kara = demo.state.entity('kara')!;
    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    husk.hitPoints = { max: 60, marked: 0 };
    const blocked = demo.state.blockedFor('mira');
    demo.grid.forEachNeighbor(kara.tile, false, (tile) => {
      if (demo.grid.isPassable(tile) && !blocked(tile) && tile !== husk.tile) demo.state.moveEntity('mira', tile);
    });
    demo.party.select('mira');
    return { demo, mira, husk };
  };

  it('Eternal Enervation leaves them Vulnerable for good, and the next spell reads it', () => {
    for (let seed = 1; seed < 80; seed++) {
      const { demo, husk } = casting('ronin-' + seed, ENERVATION);
      expect(useAbility(demo, 'mira', 'fixture-enervation', [husk.id]).status).not.toBe('refused');
      while (demo.pending !== null) answerPending(demo, { kind: 'roll' });
      if (!husk.conditions.has('vulnerable')) continue;

      // "They can't clear this condition by any means": permanent outlives the
      // scene, where every other condition a card hands out does not.
      demo.state.clearConditions('scene');
      expect(husk.conditions.has('vulnerable')).toBe(true);
      // And a Spellcast Roll aimed at them now carries the die, which is the
      // half of Vulnerable a check only learned to read this week.
      demo.scenario.actorId = 'mira';
      expect(demo.world.advantageAgainst([husk.id])).toEqual({ advantage: 1, disadvantage: 0 });
      return;
    }
    throw new Error('Eternal Enervation never landed in eighty tries');
  });

  it('Magic Immunity stops magic and lets a blade through', () => {
    const { demo, mira } = casting('yarrow-immune', IMMUNITY);
    expect(useAbility(demo, 'mira', 'fixture-immunity', []).status).not.toBe('refused');
    while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
    expect(mira.hope!.value).toBe(1);
    expect(mira.conditions.has('magic-immune')).toBe(true);

    const before = mira.hitPoints.marked;
    demo.world.dealDamage(mira.id, { amount: 30, types: ['magic'] }, demo.rng);
    expect(mira.hitPoints.marked).toBe(before);
    demo.world.dealDamage(mira.id, { amount: 30, types: ['physical'] }, demo.rng);
    expect(mira.hitPoints.marked).toBeGreaterThan(before);
  });

  it('Timejammer holds the room, and her next roll lets it go', () => {
    for (let seed = 1; seed < 120; seed++) {
      const { demo, mira, husk } = casting('yarrow-jam-' + seed, JAMMER);
      expect(useAbility(demo, 'mira', 'fixture-jammer', []).status).toBe('waiting');
      while (demo.pending !== null) answerPending(demo, { kind: 'roll' });
      // The caster's own marker is what says the spell landed: it is the half
      // that cannot be shaken off, where the stillness is a `blocks: act` and
      // an adversary spends its very next spotlight getting out of one.
      if (!mira.conditions.has('time-jamming')) continue;
      expect(demo.log.some((l) => /mote of dust/.test(l.text))).toBe(true);

      // Her next action roll lets it go - any roll, which is the simplification.
      // Casting it was her action, so the spotlight has to come back round
      // before she can swing: `attackWithSelected` answers nothing at all to
      // somebody who cannot act, which reads exactly like a swing that missed.
      //
      // And the GM's purse is emptied first. A creature that cannot act spends
      // its spotlight shaking the condition off and pays a Fear to do it, so
      // with anything in the pool the stillness would be bought off before she
      // swung - and the assertion below would pass without the card doing a
      // thing.
      demo.state.fear = { ...demo.state.fear, value: 0 };
      demo.party.select('mira');
      if (!demo.encounter!.canAct('mira')) endTurn(demo);
      attackWithSelected(demo, husk.id);
      while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
      expect(mira.conditions.has('time-jamming')).toBe(false);
      expect(husk.conditions.has('time-stopped')).toBe(false);
      expect(demo.log.some((l) => /remembers how to/.test(l.text))).toBe(true);
      return;
    }
    throw new Error('Timejammer never beat an 18 in a hundred and twenty tries');
  });

  it('and what the stillness is worth is nothing they can do', () => {
    const { demo, husk } = casting('yarrow-still', JAMMER);
    demo.world.applyCondition(husk.id, 'time-stopped', 'scene');
    expect(demo.world.blocks(husk.id, 'act')).toBe(true);
    expect(demo.world.blocks(husk.id, 'move')).toBe(true);
    // And it cannot answer a blow either, which is the third thing it blocks.
    expect(demo.world.reactionsFor(husk.id, 'incomingDamage')).toEqual([]);
  });

  it('Wall of Flame burns whatever walks through it', () => {
    for (let seed = 1; seed < 80; seed++) {
      const { demo, mira, husk } = casting('grynn-wall-' + seed, FLAME);
      // A spot a few tiles off, and somewhere further still to park the husk
      // so the wall goes up with nobody in it. Searched rather than guessed:
      // the demo map is a vault, not an open field.
      // Somewhere passable at least two tiles off the husk, so the wall goes
      // up with nobody in it. Searched rather than guessed: the demo map is a
      // vault, not an open field.
      let spot = NO_TILE;
      for (let dx = -4; dx <= 4 && spot === NO_TILE; dx++) {
        for (const dy of [0, 1, -1, 2, -2]) {
          const tile = demo.grid.indexOf(demo.grid.xOf(mira.tile) + dx, demo.grid.yOf(mira.tile) + dy);
          if (tile === NO_TILE || !demo.grid.isPassable(tile)) continue;
          if (demo.grid.chebyshevDistance(tile, husk.tile) < 3) continue;
          spot = tile;
          break;
        }
      }
      if (spot === NO_TILE) continue;

      expect(useAbility(demo, 'mira', 'fixture-flame-wall', [], { point: spot }).status).not.toBe('refused');
      while (demo.pending !== null) answerPending(demo, { kind: 'roll' });
      if (!demo.world.zones().some((z) => z.id === 'fixture-flame')) continue;
      // It went up with nobody in it.
      expect(husk.hitPoints.marked).toBe(0);

      // Walked into by hand and the ground read again: 4d10+3 is a real blow.
      demo.state.moveEntity(husk.id, spot);
      settleFight(demo);
      expect(husk.hitPoints.marked).toBeGreaterThan(0);
      expect(demo.log.some((l) => /the fire answers/.test(l.text))).toBe(true);
      return;
    }
    throw new Error('the wall never went up in eighty tries');
  });

  it('Arcane Door puts her across the room, and refuses with something in her face', () => {
    for (let seed = 1; seed < 80; seed++) {
      const { demo, mira, husk } = casting('vagras-door-' + seed, DOOR);
      // Nothing in Melee of her, and a spot to go to.
      const away = demo.grid.indexOf(demo.grid.xOf(mira.tile) + 6, demo.grid.yOf(mira.tile));
      if (away === NO_TILE || !demo.grid.isPassable(away)) continue;
      demo.state.moveEntity(husk.id, away);
      const spot = demo.grid.indexOf(demo.grid.xOf(mira.tile) + 3, demo.grid.yOf(mira.tile));
      if (spot === NO_TILE || !demo.grid.isPassable(spot)) continue;
      const stood = mira.tile;

      const used = useAbility(demo, 'mira', 'fixture-door', [], { point: spot });
      expect(used.status).not.toBe('refused');
      while (demo.pending !== null) answerPending(demo, { kind: 'roll' });
      if (mira.tile === stood) continue;

      expect(demo.grid.chebyshevDistance(mira.tile, spot)).toBeLessThanOrEqual(1);
      expect(mira.hope!.value).toBeLessThan(6);

      // And with the husk back in her face, the door will not open at all.
      const blocked = demo.state.blockedFor(husk.id);
      demo.grid.forEachNeighbor(mira.tile, false, (tile) => {
        if (demo.grid.isPassable(tile) && !blocked(tile)) demo.state.moveEntity(husk.id, tile);
      });
      expect(useAbility(demo, 'mira', 'fixture-door', [], { point: stood }).status).toBe('refused');
      return;
    }
    throw new Error('the door never opened in eighty tries');
  });

  it('Reveal takes Hidden off what the roll found', () => {
    for (let seed = 1; seed < 80; seed++) {
      const { demo, husk } = casting('vagras-reveal-' + seed, REVEAL);
      demo.world.applyCondition(husk.id, 'hidden', 'scene');

      expect(useAbility(demo, 'mira', 'fixture-reveal', []).status).not.toBe('refused');
      while (demo.pending !== null) answerPending(demo, { kind: 'roll' });
      if (husk.conditions.has('hidden')) continue;

      expect(husk.conditions.has('hidden')).toBe(false);
      expect(demo.log.some((l) => /what was not there is/.test(l.text))).toBe(true);
      return;
    }
    throw new Error('Reveal never beat the husk in eighty tries');
  });

  it('Arcane Deflection takes a blow to nothing, once', () => {
    const demo = standoff('grynn-deflect');
    demo.askDefender = false;
    demo.project.domainCards.push(...FIXTURE_CARDS);
    for (const ability of DEFLECTION) demo.project.abilities.push(abilitySchema.parse(ability));
    hold(demo, 'kara', [CODEX_CARD]);
    const kara = demo.state.entity('kara')!;
    kara.hope = { max: 6, value: 6 };
    kara.hitPoints = { max: 12, marked: 0 };
    // Four steps of severity takes any blow to nothing, which is what the card
    // asks for without a vocabulary of its own.
    const offered = demo.world.reactionsFor('kara', 'incomingDamage');
    expect(offered.map((a) => a.id)).toContain('fixture-deflection');
    const card = offered.find((a) => a.id === 'fixture-deflection')!;
    expect(card.reaction).toMatchObject({ kind: 'reduceSeverity', steps: 4 });
    expect(card.uses).toMatchObject({ count: 1, per: 'longRest' });
    expect(card.cost.hope).toBe(1);
    expect(card.auto).toBe(false);
  });
});


/**
 * Sage's two capstones: three storms behind one roll, and a shape that costs
 * its wearer a Hope every time they use it.
 */
describe('the weather, and the thing that wears it', () => {
  /**
   * Two cards. One drops a storm: the same roll against everything the weather
   * reaches, and for two of the three something stays on whatever it beat. The
   * other is a shape its wearer feeds -- a Stress to put on, ten more damage
   * while it holds, and a Hope for every roll made in it.
   *
   * The storm names below are looked up by exact string and asserted as a list,
   * so they are part of the behaviour rather than decoration.
   */
  const WEATHER_CARD = 'fixture-card-17';
  const SHAPE_CARD = 'fixture-card-18';

  /** One roll, everything within Far, and whatever it beat wears the weather. */
  const front = (dice: string, condition?: string): Record<string, unknown> => ({
    kind: 'check',
    check: {
      trait: 'spellcast',
      difficulty: 'target',
      targets: { kind: 'adversaries', range: 'far' },
      prompt: 'One roll, against everything the weather can reach.',
      always: [
        { kind: 'damage', dice, type: 'magic', target: { kind: 'hit' } },
        ...(condition === undefined
          ? []
          : [{ kind: 'applyCondition', condition, duration: 'scene', target: { kind: 'hit' } }]),
      ],
    },
  });

  const SAND_CONDITION = {
    id: 'fixture-sanded',
    name: 'Sandstormed',
    text: 'Lost in blowing sand: attacks aimed at you are made with disadvantage.',
    modifiers: [{ stat: 'advantage', bonus: -1, against: true }],
  };

  const SHAPE_CONDITION = {
    id: 'fixture-shape',
    name: 'Force of Nature',
    text: 'Something enormous wearing them: ten more damage, and a Hope for every roll.',
    modifiers: [{ stat: 'damageRoll', bonus: 10 }],
  };

  const WEATHER = [
    {
      id: 'fixture-weather',
      name: 'Tempest',
      source: { kind: 'domainCard', card: WEATHER_CARD },
      text: 'Bring one of three storms down on everything in reach.',
      target: { kind: 'none' },
      inCombatOnly: true,
      effects: [
        {
          kind: 'choice',
          title: 'Tempest',
          body: 'Which storm comes down?',
          options: [
            { label: 'Blizzard', effects: [front('2d20+8', 'vulnerable')] },
            { label: 'Hurricane', effects: [front('3d10+10')] },
            { label: 'Sandstorm', effects: [front('5d6+9', 'fixture-sanded')] },
          ],
        },
      ],
    },
  ];

  const SHAPE = [
    {
      id: 'fixture-shape-on',
      name: 'Force of Nature',
      source: { kind: 'domainCard', card: SHAPE_CARD },
      text: 'Put on something enormous, and feed it afterwards.',
      cost: { stress: 1 },
      target: { kind: 'self' },
      action: false,
      effects: [
        { kind: 'log', text: 'Something enormous stands up wearing them.', tone: 'hope' },
        { kind: 'applyCondition', condition: 'fixture-shape', duration: 'scene', target: { kind: 'actor' } },
      ],
    },
    {
      id: 'fixture-shape-upkeep',
      name: 'Force of Nature',
      source: { kind: 'domainCard', card: SHAPE_CARD },
      text: 'Every roll made in the shape costs a Hope, and nothing left to pay takes it off.',
      kind: 'reaction',
      trigger: 'partyRolled',
      action: false,
      available: {
        kind: 'all',
        of: [{ kind: 'self' }, { kind: 'hasCondition', condition: 'fixture-shape', of: { kind: 'actor' } }],
      },
      effects: [
        {
          kind: 'branch',
          when: { kind: 'pool', pool: 'hope', measure: 'available', op: '>=', value: 1 },
          then: [{ kind: 'spendHope', amount: 1 }],
          otherwise: [
            { kind: 'log', text: 'There is nothing left to feed it, and the shape goes out of them.', tone: 'fear' },
            { kind: 'clearCondition', condition: 'fixture-shape', target: { kind: 'actor' } },
          ],
        },
      ],
    },
  ];

  const carry = (
    demo: DemoScene,
    family: readonly Record<string, unknown>[],
    conditions: readonly Record<string, unknown>[],
  ): void => {
    demo.project.domainCards.push(...FIXTURE_CARDS);
    for (const condition of conditions) demo.project.conditionDefs.push(conditionDefSchema.parse(condition));
    for (const ability of family) demo.project.abilities.push(abilitySchema.parse(ability));
  };

  const hold = (demo: DemoScene, who: string, cards: string[]): void => {
    const sheet = { ...demo.sheets.get(who)!, domainCards: cards, loadout: cards.slice(0, 5) };
    demo.sheets.set(who, sheet);
    demo.characters.set(who, deriveCharacter(sheet, characterContentFor(demo.project), demo.project.abilities).character);
    refreshWorld(demo);
  };

  const casting = (seed: string, card: string): { demo: DemoScene; mira: EntityState; husk: EntityState } => {
    const demo = standoff(seed);
    demo.askDefender = false;
    carry(
      demo,
      card === WEATHER_CARD ? WEATHER : SHAPE,
      card === WEATHER_CARD ? [SAND_CONDITION] : [SHAPE_CONDITION],
    );
    hold(demo, 'mira', [card]);
    const mira = demo.state.entity('mira')!;
    mira.hope = { max: 6, value: 6 };
    const kara = demo.state.entity('kara')!;
    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    husk.hitPoints = { max: 90, marked: 0 };
    const blocked = demo.state.blockedFor('mira');
    demo.grid.forEachNeighbor(kara.tile, false, (tile) => {
      if (demo.grid.isPassable(tile) && !blocked(tile) && tile !== husk.tile) demo.state.moveEntity('mira', tile);
    });
    demo.party.select('mira');
    return { demo, mira, husk };
  };

  /** Pick a storm by name from the choice the card raises. */
  const storm = (demo: DemoScene, label: string): void => {
    if (demo.pending === null) throw new Error('no choice was raised');
    const prompt = demo.pending.prompt;
    if (prompt.kind !== 'choice') throw new Error('expected a choice of storms');
    const option = prompt.options.find((o) => o.label === label);
    if (option === undefined) throw new Error(`no storm called ${label}: ${prompt.options.map((o) => o.label).join(', ')}`);
    answerPending(demo, { kind: 'choose', index: option.index });
  };

  it('offers three storms and drops the one that was chosen', () => {
    for (let seed = 1; seed < 60; seed++) {
      const { demo, husk } = casting('tempest-' + seed, WEATHER_CARD);
      expect(useAbility(demo, 'mira', 'fixture-weather', []).status).toBe('waiting');
      if (demo.pending?.prompt.kind !== 'choice') throw new Error('expected the storms');
      expect(demo.pending.prompt.options.map((o) => o.label)).toEqual(['Blizzard', 'Hurricane', 'Sandstorm']);

      storm(demo, 'Blizzard');
      while (demo.pending !== null) answerPending(demo, { kind: 'roll' });
      if (husk.hitPoints.marked === 0) continue;

      // 2d20+8 is a real blow, and what it beat is left Vulnerable.
      expect(husk.hitPoints.marked).toBeGreaterThan(0);
      expect(husk.conditions.has('vulnerable')).toBe(true);
      return;
    }
    throw new Error('the blizzard never landed in sixty tries');
  });

  it('leaves the sand on them and nothing but weather behind the hurricane', () => {
    let sanded = false;
    let blown = false;
    for (let seed = 1; seed < 60 && !(sanded && blown); seed++) {
      for (const [label, condition] of [['Sandstorm', 'fixture-sanded'], ['Hurricane', null]] as const) {
        const { demo, husk } = casting(`tempest-${label}-${seed}`, WEATHER_CARD);
        useAbility(demo, 'mira', 'fixture-weather', []);
        storm(demo, label);
        while (demo.pending !== null) answerPending(demo, { kind: 'roll' });
        if (husk.hitPoints.marked === 0) continue;

        if (condition === null) {
          // The wind is the table's: what the engine lands is the damage.
          expect(husk.conditions.has('fixture-sanded')).toBe(false);
          expect(husk.conditions.has('vulnerable')).toBe(false);
          blown = true;
          continue;
        }
        expect(husk.conditions.has(condition)).toBe(true);
        // And the sand is worth a disadvantage die on anything aimed at them.
        demo.scenario.actorId = 'kara';
        expect(demo.world.advantageFor('kara', husk.id)).toEqual({ advantage: 0, disadvantage: 1 });
        sanded = true;
      }
    }
    expect({ sanded, blown }).toEqual({ sanded: true, blown: true });
  });

  it('Force of Nature adds ten to a blow and takes a Hope for every roll', () => {
    const { demo, mira, husk } = casting('force-of-nature', SHAPE_CARD);
    mira.stress = { max: 6, marked: 0 };
    expect(useAbility(demo, 'mira', 'fixture-shape-on', []).status).not.toBe('refused');
    while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
    expect(mira.conditions.has('fixture-shape')).toBe(true);
    expect(mira.stress.marked).toBe(1);
    expect(demo.world.rollBonus('mira', 'damageRoll')).toBe(10);

    // Every action roll she makes costs a Hope out of the six.
    const hope = mira.hope!.value;
    attackWithSelected(demo, husk.id);
    while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
    expect(mira.hope!.value).toBeLessThan(hope + 1);
    expect(mira.conditions.has('fixture-shape')).toBe(true);
  });

  it('and drops off somebody with nothing left to feed it', () => {
    const { demo, mira, husk } = casting('force-of-nature-broke', SHAPE_CARD);
    mira.stress = { max: 6, marked: 0 };
    expect(useAbility(demo, 'mira', 'fixture-shape-on', []).status).not.toBe('refused');
    while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
    mira.hope = { max: 6, value: 0 };

    attackWithSelected(demo, husk.id);
    while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
    // A roll with Hope hands one over before the upkeep reads the pool, so the
    // shape only goes when the dice gave her nothing to pay with either.
    const gained = demo.rolls[demo.rolls.length - 1]!.roll.hopeGained;
    expect(mira.conditions.has('fixture-shape')).toBe(gained > 0);
    if (gained === 0) expect(demo.log.some((l) => /goes out of them/.test(l.text))).toBe(true);
  });
});


/**
 * A roll reached after it was read. A swing is held by the game layer, where a
 * card can be offered that moment; a check belongs to the runner, and this is
 * the half of the moment the runner owns.
 */
describe('a card that saves a roll already made', () => {
  /**
   * A card that pays for a roll out of its own tokens, and counts those tokens
   * off the loadout it sits in. No effects at all — the engine reads `lift`
   * where the roll is settled, spending the least that carries it over and
   * nothing on a roll that never needed it.
   */
  const LIFT = [
    {
      id: 'fixture-lift',
      name: 'Fane of the Wilds',
      source: { kind: 'domainCard', card: LIFT_CARD },
      text: 'What it has gathered, it spends to carry a spell over the line.',
      kind: 'passive',
      action: false,
      tokens: { amount: 'domainCards', domain: 'fixture', minimum: 1, refill: 'longRest' },
      lift: { each: 1, only: 'spellcast' },
    },
  ];

  const carry = (demo: DemoScene): void => {
    demo.project.domainCards.push(...FIXTURE_CARDS);
    for (const ability of [...LIFT, ...SPELLCAST_CHECK]) demo.project.abilities.push(abilitySchema.parse(ability));
  };

  const hold = (demo: DemoScene, who: string, cards: string[]): void => {
    const sheet = { ...demo.sheets.get(who)!, domainCards: cards, loadout: cards.slice(0, 5) };
    demo.sheets.set(who, sheet);
    demo.characters.set(who, deriveCharacter(sheet, characterContentFor(demo.project), demo.project.abilities).character);
    refreshWorld(demo);
  };

  const fane = (seed: string, tokens: number): { demo: DemoScene; mira: EntityState; husk: EntityState } => {
    const demo = standoff(seed);
    demo.askDefender = false;
    carry(demo);
    hold(demo, 'mira', [LIFT_CARD, SPELL_CARD]);
    const mira = demo.state.entity('mira')!;
    mira.hope = { max: 6, value: 6 };
    const kara = demo.state.entity('kara')!;
    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    husk.hitPoints = { max: 90, marked: 0 };
    const blocked = demo.state.blockedFor('mira');
    demo.grid.forEachNeighbor(kara.tile, false, (tile) => {
      if (demo.grid.isPassable(tile) && !blocked(tile) && tile !== husk.tile) demo.state.moveEntity('mira', tile);
    });
    demo.party.select('mira');
    demo.world.spendTokens('mira', 'fixture-lift', 99);
    demo.world.addTokens('mira', 'fixture-lift', tokens);
    return { demo, mira, husk };
  };

  it('counts its tokens off the Sage cards in the loadout', () => {
    const demo = standoff('fane-count');
    carry(demo);
    // Two of its own domain beside it: the card itself, and one more. The card
    // in the other domain is held and not counted.
    hold(demo, 'mira', [LIFT_CARD, 'fixture-card-2', SPELL_CARD]);
    expect(demo.world.tokenCount('mira', 'fixture-lift')).toBe(2);
    hold(demo, 'mira', [LIFT_CARD, SPELL_CARD]);
    expect(demo.world.tokenCount('mira', 'fixture-lift')).toBe(1);
  });

  it('spends the least that saves the roll, and nothing on one that did not need it', () => {
    let saved = false;
    let untouched = false;
    for (let seed = 1; seed < 60 && !(saved && untouched); seed++) {
      const { demo, husk } = fane('fane-' + seed, 6);
      const before = demo.world.tokensOn('mira', 'fixture-lift');

      // Mystic Tether is a Spellcast Roll against the husk's own Difficulty.
      expect(useAbility(demo, 'mira', 'fixture-spellcast', [husk.id]).status).toBe('waiting');
      while (demo.pending !== null) answerPending(demo, { kind: 'roll' });
      const roll = demo.rolls[demo.rolls.length - 1]!.roll;
      const spent = before - demo.world.tokensOn('mira', 'fixture-lift');

      if (spent === 0) {
        // Either it did not need saving, or six tokens could not save it.
        untouched = true;
        continue;
      }
      // What it spent is exactly what it took: one fewer would have fallen short.
      const difficulty = roll.difficulty;
      expect(roll.total).toBeGreaterThanOrEqual(difficulty);
      expect(roll.total - spent).toBeLessThan(difficulty);
      expect(demo.log.some((l) => /Success/.test(l.text))).toBe(true);
      saved = true;
    }
    expect({ saved, untouched }).toEqual({ saved: true, untouched: true });
  });

  it('will not throw tokens at a roll it cannot save', () => {
    for (let seed = 1; seed < 60; seed++) {
      // One token: it can lift a roll by exactly one and no more.
      const { demo, husk } = fane('fane-short-' + seed, 1);
      expect(useAbility(demo, 'mira', 'fixture-spellcast', [husk.id]).status).toBe('waiting');
      while (demo.pending !== null) answerPending(demo, { kind: 'roll' });
      const roll = demo.rolls[demo.rolls.length - 1]!.roll;
      const left = demo.world.tokensOn('mira', 'fixture-lift');
      if (roll.critical) continue;

      // Two or more short: the token stays on the card rather than being
      // thrown at a roll it was never going to reach.
      if (roll.total + 1 < roll.difficulty) {
        expect(left).toBe(1);
        return;
      }
    }
    throw new Error('never found a roll too far gone to save, in sixty tries');
  });

  it('answers a Spellcast Roll and leaves a plain trait check alone', () => {
    // `only: 'spellcast'` is the card's own words, and a chest is not one.
    expect(demo0().world.liftRoll('mira', 'spellcast', 10, 13, false)).toBe(3);
    expect(demo0().world.liftRoll('mira', 'instinct', 10, 13, false)).toBe(0);
    // Nor a roll that already got there, nor a critical.
    expect(demo0().world.liftRoll('mira', 'spellcast', 13, 13, false)).toBe(0);
    expect(demo0().world.liftRoll('mira', 'spellcast', 2, 13, true)).toBe(0);
  });

  const demo0 = (): DemoScene => {
    const demo = standoff('fane-direct');
    carry(demo);
    hold(demo, 'mira', [LIFT_CARD, SPELL_CARD]);
    demo.world.spendTokens('mira', 'fixture-lift', 99);
    demo.world.addTokens('mira', 'fixture-lift', 6);
    return demo;
  };
});


/**
 * The one card that changes what is thrown rather than what is added to it.
 */
describe('a Hope Die that is not a d12', () => {
  const hold = (demo: DemoScene, who: string, cards: string[]): void => {
    const sheet = { ...demo.sheets.get(who)!, domainCards: cards, loadout: cards.slice(0, 5) };
    demo.sheets.set(who, sheet);
    demo.characters.set(who, deriveCharacter(sheet, characterContentFor(demo.project), demo.project.abilities).character);
    refreshWorld(demo);
  };

  const armed = (seed: string): { demo: DemoScene; kara: EntityState; husk: EntityState } => {
    const demo = standoff(seed);
    demo.askDefender = false;
    hold(demo, 'kara', ['signature-move']);
    const kara = demo.state.entity('kara')!;
    kara.stress = { max: 6, marked: 3 };
    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    husk.hitPoints = { max: 90, marked: 0 };
    return { demo, kara, husk };
  };

  it('is twelve until the move is declared, and twenty after', () => {
    const { demo, kara } = armed('signature-sides');
    expect(demo.world.hopeDieSides('kara')).toBe(12);
    expect(useAbility(demo, 'kara', 'signature-move', []).status).not.toBe('refused');
    while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
    expect(kara.conditions.has('signature-move')).toBe(true);
    expect(demo.world.hopeDieSides('kara')).toBe(20);
  });

  it('throws a d20 for Hope on the swing it was declared for, and only that one', () => {
    // Over enough seeds a d12 can never show 13 or more; a d20 can. Finding one
    // face above twelve is the whole proof that a different die was thrown.
    let sawBig = false;
    for (let seed = 1; seed < 60 && !sawBig; seed++) {
      const { demo, husk } = armed('signature-die-' + seed);
      useAbility(demo, 'kara', 'signature-move', []);
      while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });

      demo.party.select('kara');
      attackWithSelected(demo, husk.id);
      while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
      const roll = demo.rolls[demo.rolls.length - 1]!.roll;
      expect(roll.fear).toBeLessThanOrEqual(12);
      if (roll.hope > 12) {
        expect(roll.hopeSides).toBe(20);
        sawBig = true;
      }
    }
    expect(sawBig).toBe(true);
  });

  it('is spent by that roll, whatever it came to, and pays a Stress for a success', () => {
    let onSuccess = false;
    let onFailure = false;
    for (let seed = 1; seed < 80 && !(onSuccess && onFailure); seed++) {
      const { demo, kara, husk } = armed('signature-spent-' + seed);
      useAbility(demo, 'kara', 'signature-move', []);
      while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
      const stress = kara.stress.marked;

      demo.party.select('kara');
      attackWithSelected(demo, husk.id);
      while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
      const roll = demo.rolls[demo.rolls.length - 1]!.roll;

      // Spent either way: the move was made.
      expect(kara.conditions.has('signature-move')).toBe(false);
      expect(demo.world.hopeDieSides('kara')).toBe(12);
      if (roll.success) {
        // One for the card, and a critical clears one of its own on top.
        expect(kara.stress.marked).toBe(stress - (roll.critical ? 2 : 1));
        onSuccess = true;
      } else {
        expect(kara.stress.marked).toBe(stress);
        onFailure = true;
      }
    }
    expect({ onSuccess, onFailure }).toEqual({ onSuccess: true, onFailure: true });
  });
});


/**
 * Bone's two leftovers: a token spent on how you come at somebody, and a long
 * look at a creature that takes the wind out of the room.
 */
describe('coming at them well, and knowing them', () => {
  /**
   * One card, three ways to spend it, and a token pile counted off a trait with
   * a floor under it. The labels are matched by pattern below, so the wording of
   * the three options is behaviour here rather than prose.
   *
   * `around: 'target'` in the middle option is the whole of one test: the band
   * is measured from the creature it was aimed at, not from whoever played it.
   */
  const APPROACH_CARD = 'fixture-card-12';
  const APPROACH = [
    {
      id: 'fixture-approach',
      name: 'Strategic Approach',
      source: { kind: 'domainCard', card: APPROACH_CARD },
      text: 'Come at them in one of three ways, while there is anything left to spend.',
      tokens: { amount: 'knowledge', minimum: 1, refill: 'longRest' },
      target: { kind: 'adversary', range: 'close' },
      action: false,
      inCombatOnly: true,
      available: { kind: 'tokens', ability: 'fixture-approach', op: '>=', value: 1 },
      effects: [
        {
          kind: 'choice',
          title: 'Strategic Approach',
          body: 'How do you come at them?',
          options: [
            {
              label: 'Pick your line: advantage on the attack',
              effects: [
                { kind: 'spendToken', ability: 'fixture-approach', amount: 1 },
                { kind: 'applyCondition', condition: 'strategic-advantage', duration: 'scene', target: { kind: 'actor' } },
              ],
            },
            {
              label: 'Steady an ally standing beside them',
              effects: [
                { kind: 'spendToken', ability: 'fixture-approach', amount: 1 },
                { kind: 'clearStress', amount: 1, target: { kind: 'allies', range: 'melee', around: 'target' } },
              ],
            },
            {
              label: 'Put a d8 behind the blow',
              effects: [
                { kind: 'spendToken', ability: 'fixture-approach', amount: 1 },
                { kind: 'applyCondition', condition: 'strategic-force', duration: 'scene', target: { kind: 'actor' } },
              ],
            },
          ],
        },
      ],
    },
    {
      id: 'fixture-approach-force',
      name: 'Strategic Approach',
      source: { kind: 'domainCard', card: APPROACH_CARD },
      text: 'The d8, put behind the blow at the moment a blow is counted.',
      kind: 'reaction',
      trigger: 'rollingDamage',
      action: false,
      available: { kind: 'hasCondition', condition: 'strategic-force', of: { kind: 'actor' } },
      effects: [
        { kind: 'boostDamage', dice: '1d8' },
        { kind: 'clearCondition', condition: 'strategic-force', target: { kind: 'actor' } },
      ],
    },
  ];

  /**
   * The watching check again, but the one that pays out: the shared card in
   * `cards.ts` resolves into a line of log, and this test is about what the
   * payout costs its holder and what it takes off the GM.
   */
  const WATCH_CARD = 'fixture-card-13';
  const WATCH_AND_PAY = [
    {
      id: 'fixture-watch-pay',
      name: 'Know What It Is',
      source: { kind: 'domainCard', card: WATCH_CARD },
      text: 'Watch something long enough and it costs them to have been seen.',
      target: { kind: 'adversary', range: 'far' },
      action: false,
      effects: [
        {
          kind: 'check',
          check: {
            trait: 'instinct',
            difficulty: 'target',
            prompt: 'Watch them, and see what shows.',
            onCriticalSuccess: WATCHED,
            onSuccessWithHope: WATCHED,
            onSuccessWithFear: WATCHED,
          },
        },
      ],
    },
  ];

  const carry = (demo: DemoScene, abilities: readonly Record<string, unknown>[]): void => {
    demo.project.domainCards.push(...FIXTURE_CARDS);
    for (const ability of abilities) demo.project.abilities.push(abilitySchema.parse(ability));
  };

  const hold = (demo: DemoScene, who: string, cards: string[]): void => {
    const sheet = { ...demo.sheets.get(who)!, domainCards: cards, loadout: cards.slice(0, 5) };
    demo.sheets.set(who, sheet);
    demo.characters.set(who, deriveCharacter(sheet, characterContentFor(demo.project), demo.project.abilities).character);
    refreshWorld(demo);
  };

  const approaching = (seed: string): { demo: DemoScene; kara: EntityState; husk: EntityState } => {
    const demo = standoff(seed);
    demo.askDefender = false;
    carry(demo, APPROACH);
    hold(demo, 'kara', [APPROACH_CARD]);
    const kara = demo.state.entity('kara')!;
    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    husk.hitPoints = { max: 90, marked: 0 };
    demo.world.addTokens('kara', 'fixture-approach', 3);
    demo.party.select('kara');
    return { demo, kara, husk };
  };

  /** Take one of the card's three options by name. */
  const pick = (demo: DemoScene, label: RegExp): void => {
    if (demo.pending?.prompt.kind !== 'choice') throw new Error('expected the three approaches');
    const option = demo.pending.prompt.options.find((o) => label.test(o.label));
    if (option === undefined) throw new Error(`no option matching ${label}`);
    answerPending(demo, { kind: 'choose', index: option.index });
  };

  it('counts its tokens off Knowledge, and offers all three approaches', () => {
    const demo = standoff('approach-tokens');
    carry(demo, APPROACH);
    hold(demo, 'kara', [APPROACH_CARD]);
    // Kara's Knowledge is below one, and the card floors it at one.
    expect(demo.world.tokenCount('kara', 'fixture-approach')).toBe(1);

    const { demo: ready, husk } = approaching('approach-offer');
    expect(useAbility(ready, 'kara', 'fixture-approach', [husk.id]).status).toBe('waiting');
    if (ready.pending?.prompt.kind !== 'choice') throw new Error('expected the three approaches');
    expect(ready.pending.prompt.options).toHaveLength(3);
  });

  it('picks a line, and the next swing is made with advantage', () => {
    const { demo, kara, husk } = approaching('approach-advantage');
    useAbility(demo, 'kara', 'fixture-approach', [husk.id]);
    pick(demo, /advantage/);
    while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });

    expect(kara.conditions.has('strategic-advantage')).toBe(true);
    expect(demo.world.tokensOn('kara', 'fixture-approach')).toBe(2);
    expect(demo.world.advantageFor('kara', husk.id)).toEqual({ advantage: 1, disadvantage: 0 });

    // And it is spent by that swing, hit or miss.
    attackWithSelected(demo, husk.id);
    while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
    expect(kara.conditions.has('strategic-advantage')).toBe(false);
  });

  it('steadies an ally standing beside the one it was aimed at, not beside the caster', () => {
    const { demo, husk } = approaching('approach-ally');
    const finn = demo.state.entity('finn')!;
    finn.stress = { max: 6, marked: 3 };
    const mira = demo.state.entity('mira')!;
    mira.stress = { max: 6, marked: 3 };
    // Finn beside the husk; Mira left where she was, well away from it.
    const blocked = demo.state.blockedFor('finn');
    demo.grid.forEachNeighbor(husk.tile, false, (tile) => {
      if (demo.grid.isPassable(tile) && !blocked(tile) && tile !== demo.state.entity('kara')!.tile) {
        demo.state.moveEntity('finn', tile);
      }
    });

    useAbility(demo, 'kara', 'fixture-approach', [husk.id]);
    pick(demo, /Steady/);
    while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });

    // `around: 'target'` is the whole of this: the band is measured from the
    // adversary, which is why Finn is steadied and Mira is not.
    expect(finn.stress.marked).toBe(2);
    expect(mira.stress.marked).toBe(3);
  });

  it('puts a d8 behind the blow, once', () => {
    for (let seed = 1; seed < 40; seed++) {
      const { demo, kara, husk } = approaching('approach-d8-' + seed);
      useAbility(demo, 'kara', 'fixture-approach', [husk.id]);
      pick(demo, /d8/);
      while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
      expect(kara.conditions.has('strategic-force')).toBe(true);

      attackWithSelected(demo, husk.id);
      while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
      // A miss counts nothing and leaves the d8 waiting; a hit spends it.
      if (husk.hitPoints.marked === 0) continue;
      expect(kara.conditions.has('strategic-force')).toBe(false);
      return;
    }
    throw new Error('Kara never landed a blow in forty tries');
  });

  it('Know Thy Enemy takes a Hope, and offers a Stress for one of the GM\'s Fear', () => {
    for (let seed = 1; seed < 80; seed++) {
      const demo = standoff('know-' + seed);
      demo.askDefender = false;
      // An Instinct Roll, not a Spellcast one, so the Guardian can make it -
      // and she is already stood next to the thing she is watching.
      carry(demo, WATCH_AND_PAY);
      hold(demo, 'kara', [WATCH_CARD]);
      const kara = demo.state.entity('kara')!;
      kara.hope = { max: 6, value: 6 };
      kara.stress = { max: 6, marked: 0 };
      demo.state.fear = { max: 12, value: 5 };
      const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;

      expect(useAbility(demo, 'kara', 'fixture-watch-pay', [husk.id]).status).toBe('waiting');
      answerPending(demo, { kind: 'roll' });
      // A failed roll asks nothing; try again.
      if (demo.pending?.prompt.kind !== 'choice') continue;

      expect(kara.hope!.value).toBe(5);
      // Read after the dice, not before them: a roll with Fear hands the GM one
      // on its way past, and what the card takes is measured off that.
      const pool = demo.state.fear.value;
      answerPending(demo, { kind: 'choose', index: 0 });
      while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
      // A Stress marked, and one off the GM's pool.
      expect(kara.stress.marked).toBeGreaterThanOrEqual(1);
      expect(demo.state.fear.value).toBe(pool - 1);
      return;
    }
    throw new Error('the watch never paid off in eighty tries');
  });
});


/**
 * Grace, which I had written off as social and was not: a spell that takes an
 * ally out of sight, and a taunt that rolls for what it costs.
 */
describe('out of sight, and under the skin', () => {
  /**
   * Two cards: one takes somebody out of sight, the other says the thing that
   * gets under a creature's skin and rolls for what it costs them.
   *
   * The first is the most wired-together specimen here, because its second half
   * is held by somebody other than its holder. The condition lends it to them
   * with `grants` -- whoever is hidden is not whoever cast it -- and the tokens
   * sit on the hidden creature rather than on the caster's card, which is the
   * only reason an ally can spend them at all.
   *
   * The token bucket is a plain label passed as `ability:`, named here after the
   * ability that opens the bucket, the way the catalogue does it.
   */
  const HIDE_CARD = 'fixture-card-30';
  const TAUNT_CARD = 'fixture-card-31';

  /**
   * On whoever was hidden. The die is this; not being seen is the table's. It
   * lends the bearer the other half of the card, because the one who is hidden
   * is not the one holding the spell.
   */
  const HIDDEN_CONDITION = {
    id: 'fixture-hidden',
    name: 'Out of Sight',
    text: 'Not there to look at: attack rolls against you are made with disadvantage.',
    modifiers: [{ stat: 'advantage', bonus: -1, against: true }],
    grants: { ability: 'fixture-hide-spends' },
  };

  /** One creature at a time: it comes off everybody before it goes on anybody. */
  const UNSEEN = [
    { kind: 'markStress', amount: 1, target: { kind: 'actor' } },
    { kind: 'clearCondition', condition: 'fixture-hidden', target: { kind: 'allies', includeSelf: true } },
    { kind: 'log', text: 'They stop being somewhere anyone is looking.', tone: 'hope' },
    { kind: 'applyCondition', condition: 'fixture-hidden', duration: 'scene', target: { kind: 'target' } },
    // On the one who is hidden, not on the caster: the creature spending them
    // is the creature they are about.
    { kind: 'addToken', ability: 'fixture-hide', amount: { trait: 'spellcast' }, target: { kind: 'target' } },
  ];

  /** Rolled rather than written, which is the whole of the taunt's test. */
  const PROVOKED = [
    { kind: 'log', text: 'Whatever they said, it lands somewhere soft.', tone: 'hope' },
    {
      kind: 'markStress',
      amount: { dice: '1d4', using: 'proficiency', pick: 'highest' },
      target: { kind: 'hit' },
    },
  ];

  const UNSEEN_FAMILY = [
    {
      id: 'fixture-hide',
      name: 'Out of Sight',
      source: { kind: 'domainCard', card: HIDE_CARD },
      text: 'Mark a Stress to take somebody beside you out of sight for a while.',
      // An ally rather than herself: a caster who chose themselves would spend
      // the first token on the roll that cast it.
      target: { kind: 'ally', range: 'melee' },
      effects: [
        {
          kind: 'check',
          check: {
            trait: 'spellcast',
            difficulty: 10,
            prompt: 'Take them out of sight?',
            onCriticalSuccess: UNSEEN,
            onSuccessWithHope: UNSEEN,
            onSuccessWithFear: UNSEEN,
          },
        },
      ],
    },
    {
      // The half the hidden creature holds, lent to them by the condition.
      id: 'fixture-hide-spends',
      name: 'Out of Sight',
      source: { kind: 'domainCard', card: HIDE_CARD },
      text: 'Every action taken out of sight spends some of it, and the last one ends it.',
      kind: 'reaction',
      trigger: 'partyRolled',
      action: false,
      available: {
        kind: 'all',
        of: [{ kind: 'self' }, { kind: 'hasCondition', condition: 'fixture-hidden', of: { kind: 'actor' } }],
      },
      effects: [
        { kind: 'spendToken', ability: 'fixture-hide', amount: 1, target: { kind: 'actor' } },
        {
          kind: 'branch',
          when: { kind: 'tokens', ability: 'fixture-hide', of: { kind: 'actor' }, op: '<=', value: 0 },
          then: [
            { kind: 'log', text: 'The last of it goes, and there they are again.', tone: 'combat' },
            { kind: 'clearCondition', condition: 'fixture-hidden', target: { kind: 'actor' } },
          ],
        },
      ],
    },
  ];

  const TAUNT = [
    {
      id: 'fixture-taunt',
      name: 'Under the Skin',
      source: { kind: 'domainCard', card: TAUNT_CARD },
      text: 'Once between rests, say the thing that gets under it and see what it costs them.',
      uses: { count: 1, per: 'rest' },
      target: { kind: 'adversary', range: 'far' },
      effects: [
        {
          kind: 'check',
          check: {
            trait: 'presence',
            difficulty: 'target',
            tags: ['social'],
            prompt: 'Say the thing that gets under it?',
            onCriticalSuccess: PROVOKED,
            onSuccessWithHope: PROVOKED,
            onSuccessWithFear: PROVOKED,
          },
        },
      ],
    },
  ];

  const hold = (demo: DemoScene, who: string, cards: string[]): void => {
    const sheet = { ...demo.sheets.get(who)!, domainCards: cards, loadout: cards.slice(0, 5) };
    demo.sheets.set(who, sheet);
    demo.characters.set(who, deriveCharacter(sheet, characterContentFor(demo.project), demo.project.abilities).character);
    refreshWorld(demo);
  };

  /** Mira beside Kara, holding a Grace card and the spotlight. */
  const casting = (seed: string, card: string): { demo: DemoScene; mira: EntityState; kara: EntityState; husk: EntityState } => {
    const demo = standoff(seed);
    demo.askDefender = false;
    demo.project.domainCards.push(...FIXTURE_CARDS);
    demo.project.conditionDefs.push(conditionDefSchema.parse(HIDDEN_CONDITION));
    for (const ability of [...UNSEEN_FAMILY, ...TAUNT]) demo.project.abilities.push(abilitySchema.parse(ability));
    hold(demo, 'mira', [card]);
    const mira = demo.state.entity('mira')!;
    mira.hope = { max: 6, value: 6 };
    mira.stress = { max: 6, marked: 0 };
    const kara = demo.state.entity('kara')!;
    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    husk.hitPoints = { max: 90, marked: 0 };
    husk.stress = { max: 12, marked: 0 };
    const blocked = demo.state.blockedFor('mira');
    demo.grid.forEachNeighbor(kara.tile, false, (tile) => {
      if (demo.grid.isPassable(tile) && !blocked(tile) && tile !== husk.tile) demo.state.moveEntity('mira', tile);
    });
    demo.party.select('mira');
    return { demo, mira, kara, husk };
  };

  it('Invisibility puts the die on anything aimed at the one it hid', () => {
    for (let seed = 1; seed < 60; seed++) {
      const { demo, mira, kara, husk } = casting('invis-' + seed, HIDE_CARD);
      expect(useAbility(demo, 'mira', 'fixture-hide', ['kara']).status).toBe('waiting');
      while (demo.pending !== null) answerPending(demo, { kind: 'roll' });
      if (!kara.conditions.has('fixture-hidden')) continue;

      // A Stress from the caster, and tokens on the one who is hidden - not on
      // the caster's card, so the creature spending them is the one they are
      // about.
      expect(mira.stress.marked).toBe(1);
      expect(demo.world.tokensOn('kara', 'fixture-hide')).toBe(demo.characters.get('mira')!.traits.knowledge);
      // Attacks against her are made with disadvantage; the caster is untouched.
      expect(demo.world.advantageFor(husk.id, 'kara')).toEqual({ advantage: 0, disadvantage: 1 });
      expect(demo.world.advantageFor(husk.id, 'mira')).toEqual({ advantage: 0, disadvantage: 0 });
      return;
    }
    throw new Error('Invisibility never beat a 10 in sixty tries');
  });

  it('spends a token for every action she takes, and drops when the last one goes', () => {
    for (let seed = 1; seed < 60; seed++) {
      const { demo, kara, husk } = casting('invis-spend-' + seed, HIDE_CARD);
      // The spell put on her by hand rather than cast: casting it is Mira's
      // action, and the spotlight would be hers when Kara came to swing. What
      // this test is about is the spending, which is Kara's own.
      demo.world.applyCondition('kara', 'fixture-hidden', 'scene');
      // Exactly two, so the second swing is the one that ends it.
      demo.world.spendTokens('kara', 'fixture-hide', 99);
      demo.world.addTokens('kara', 'fixture-hide', 2);
      demo.party.select('kara');

      attackWithSelected(demo, husk.id);
      while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
      expect(demo.world.tokensOn('kara', 'fixture-hide')).toBe(1);
      expect(kara.conditions.has('fixture-hidden')).toBe(true);

      // Her turn is spent, so the room takes one before she swings again.
      kara.hitPoints = { max: 20, marked: 0 };
      endTurn(demo);
      while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
      if (demo.encounter?.outcome !== 'ongoing' || !kara.alive) continue;

      demo.party.select('kara');
      attackWithSelected(demo, husk.id);
      while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
      expect(demo.world.tokensOn('kara', 'fixture-hide')).toBe(0);
      expect(kara.conditions.has('fixture-hidden')).toBe(false);
      return;
    }
    throw new Error('Invisibility never beat a 10 in sixty tries');
  });

  it('Troublemaker rolls d4s for the Stress it costs them', () => {
    const marked: number[] = [];
    for (let seed = 1; seed < 60 && marked.length < 6; seed++) {
      const { demo, husk } = casting('trouble-' + seed, TAUNT_CARD);
      // Presence is Mira's, and the taunt is aimed rather than cast.
      expect(useAbility(demo, 'mira', 'fixture-taunt', [husk.id]).status).toBe('waiting');
      while (demo.pending !== null) answerPending(demo, { kind: 'roll' });
      if (husk.stress.marked === 0) continue;
      marked.push(husk.stress.marked);
    }
    expect(marked.length).toBeGreaterThan(0);
    // One d4 at Proficiency 1: between one and four, never nothing and never
    // five. That is the whole of "the highest result rolled".
    for (const n of marked) {
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(4);
    }
    // And it does vary, which a flat number would not.
    expect(new Set(marked).size).toBeGreaterThan(1);
  });
});


/**
 * The one card that goes past the veil, and the one effect that does.
 */
describe('asking for somebody back', () => {
  const hold = (demo: DemoScene, who: string, cards: string[]): void => {
    const sheet = { ...demo.sheets.get(who)!, domainCards: cards, loadout: cards.slice(0, 5) };
    demo.sheets.set(who, sheet);
    demo.characters.set(who, deriveCharacter(sheet, characterContentFor(demo.project), demo.project.abilities).character);
    refreshWorld(demo);
  };

  const mourning = (seed: string): { demo: DemoScene; mira: EntityState; kara: EntityState } => {
    const demo = standoff(seed);
    demo.askDefender = false;
    hold(demo, 'mira', ['resurrection']);
    const mira = demo.state.entity('mira')!;
    const kara = demo.state.entity('kara')!;
    const blocked = demo.state.blockedFor('mira');
    demo.grid.forEachNeighbor(kara.tile, false, (tile) => {
      if (demo.grid.isPassable(tile) && !blocked(tile)) demo.state.moveEntity('mira', tile);
    });
    demo.party.select('mira');
    // Kara gone past the veil: down, and marked as not coming back by a heal.
    kara.hitPoints = { max: kara.hitPoints.max, marked: kara.hitPoints.max };
    kara.alive = false;
    kara.dead = true;
    return { demo, mira, kara };
  };

  it('a heal will not reach past the veil, and this does', () => {
    const { demo, kara } = mourning('raise-heal');
    // The rule the effect exists to break: a heal stands somebody up, but not
    // one who crossed through.
    demo.world.heal({ kind: 'entity', id: 'kara' }, 5);
    expect(kara.alive).toBe(false);

    expect(demo.world.revive({ kind: 'entity', id: 'kara' })).toEqual(['kara']);
    expect(kara.alive).toBe(true);
    expect(kara.dead).toBeUndefined();
    expect(kara.hitPoints.marked).toBe(0);
  });

  it('can be aimed at somebody who is not standing there', () => {
    const { demo } = mourning('raise-aim');
    // Every other card names only what is standing; `fallen` is the opt-in.
    expect(abilityTargets(demo, 'mira', demo.project.abilities.find((a) => a.id === 'resurrection')!)).toContain('kara');
    expect(abilityTargets(demo, 'mira', demo.project.abilities.find((a) => a.id === 'book-of-ava-tavas-armor')!)).not.toContain('kara');
  });

  it('brings her back whole on a 20, and vaults itself for it', () => {
    for (let seed = 1; seed < 200; seed++) {
      const { demo, mira, kara } = mourning('raise-' + seed);
      expect(useAbility(demo, 'mira', 'resurrection', ['kara']).status).toBe('waiting');
      while (demo.pending !== null) answerPending(demo, { kind: 'roll' });
      if (!kara.alive) continue;

      expect(kara.hitPoints.marked).toBe(0);
      expect(kara.dead).toBeUndefined();
      // "Then place this card in your vault permanently."
      expect(demo.sheets.get('mira')!.loadout ?? []).not.toContain('resurrection');
      expect(mira.hitPoints.marked).toBe(0);
      return;
    }
    throw new Error('Resurrection never beat a 20 in two hundred tries');
  });
});


/**
 * The moment a check can be reached in. A swing was always held between its
 * dice and its damage; a check settled in one go, so a card that answers a roll
 * could only ever answer half the rolls in the game.
 */
describe('a check the room can answer', () => {
  const hold = (demo: DemoScene, who: string, cards: string[]): void => {
    const sheet = { ...demo.sheets.get(who)!, domainCards: cards, loadout: cards.slice(0, 5) };
    demo.sheets.set(who, sheet);
    demo.characters.set(who, deriveCharacter(sheet, characterContentFor(demo.project), demo.project.abilities).character);
    refreshWorld(demo);
  };

  /**
   * Kara about to make a check, with Finn holding something to say about it.
   * She always holds the card that stops for its dice to be read; what Finn
   * holds is what the test is about.
   */
  const rolling = (
    seed: string,
    abilities: readonly Record<string, unknown>[],
    card: string | null,
  ): { demo: DemoScene; kara: EntityState; husk: EntityState } => {
    const demo = standoff(seed);
    demo.askDefender = true;
    demo.project.domainCards.push(...FIXTURE_CARDS);
    for (const ability of [...WATCHING_CHECK, ...abilities]) demo.project.abilities.push(abilitySchema.parse(ability));
    hold(demo, 'kara', [WATCHING_CARD]);
    hold(demo, 'finn', card === null ? [] : [card]);
    const finn = demo.state.entity('finn')!;
    finn.hope = { max: 6, value: 6 };
    const kara = demo.state.entity('kara')!;
    kara.hope = { max: 6, value: 6 };
    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    const blocked = demo.state.blockedFor('finn');
    demo.grid.forEachNeighbor(kara.tile, false, (tile) => {
      if (demo.grid.isPassable(tile) && !blocked(tile) && tile !== husk.tile) demo.state.moveEntity('finn', tile);
    });
    return { demo, kara, husk };
  };

  it('stops for nobody when nobody is holding anything', () => {
    // The gate that keeps every chest, door and conversation exactly as it was.
    const { demo, husk } = rolling('check-quiet', [], SILENT_CARD);
    expect(demo.world.answersRoll('kara', { total: 10, outcome: 'failureWithFear' })).toBe(false);
    expect(useAbility(demo, 'kara', 'fixture-watching', [husk.id]).status).toBe('waiting');
    // One answer settles it: the roll goes straight to its arms as it always did.
    answerPending(demo, { kind: 'roll' });
    expect(demo.pending?.prompt.kind).not.toBe('rolled');
  });

  it('puts the roll to an ally holding Reassurance, and throws again when they take it', () => {
    for (let seed = 1; seed < 80; seed++) {
      const { demo, husk } = rolling('check-reassure-' + seed, REASSURANCE, REASSURANCE_CARD);
      expect(demo.world.answersRoll('kara', { total: 10, outcome: 'failureWithFear' })).toBe(true);
      expect(useAbility(demo, 'kara', 'fixture-watching', [husk.id]).status).toBe('waiting');

      // The dice are read, and the question that follows is Finn's, not Kara's.
      answerPending(demo, { kind: 'roll' });
      if (demo.pending?.kind !== 'reaction') continue;
      expect(demo.pending.offers.map((o) => o.ability.id)).toEqual(['fixture-reassurance']);
      expect(demo.pending.offers[0]!.by).toBe('finn');
      // The throw is on the offer, not in the log: nothing has been journalled
      // yet, which is the point - the roll has not decided anything.
      const first = demo.pending.offers[0]!.swing!;

      answerPending(demo, { kind: 'choose', index: 1 });
      while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });

      // A second reading of the same check, on new dice.
      const after = demo.rolls[demo.rolls.length - 1]!.roll;
      expect(after.hope === first.hope && after.fear === first.fear).toBe(false);
      return;
    }
    throw new Error('Reassurance was never put to Finn in eighty tries');
  });

  it('leaves the roll exactly as thrown when the ally lets it pass', () => {
    for (let seed = 1; seed < 80; seed++) {
      const { demo, husk } = rolling('check-pass-' + seed, REASSURANCE, REASSURANCE_CARD);
      useAbility(demo, 'kara', 'fixture-watching', [husk.id]);
      answerPending(demo, { kind: 'roll' });
      if (demo.pending?.kind !== 'reaction') continue;
      const thrown = demo.pending.offers[0]!.swing!;

      answerPending(demo, { kind: 'choose', index: 0 });
      while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
      const after = demo.rolls[demo.rolls.length - 1]!.roll;
      expect({ hope: after.hope, fear: after.fear }).toEqual({ hope: thrown.hope, fear: thrown.fear });
      return;
    }
    throw new Error('Reassurance was never put to Finn in eighty tries');
  });

  it('Support Tank answers a failed check, and only a failed one', () => {
    let asked = false;
    let quiet = false;
    for (let seed = 1; seed < 80 && !(asked && quiet); seed++) {
      const { demo, husk } = rolling('check-tank-' + seed, SUPPORT_TANK, SUPPORT_CARD);
      useAbility(demo, 'kara', 'fixture-watching', [husk.id]);
      answerPending(demo, { kind: 'roll' });

      if (demo.pending?.kind === 'reaction') {
        expect(demo.pending.offers.map((o) => o.ability.id)).toEqual(['fixture-support-tank']);
        // Only a failure: the card says so and the gate is read before asking.
        expect(demo.pending.offers[0]!.swing!.success).toBe(false);
        const before = demo.state.entity('finn')!.hope!.value;
        answerPending(demo, { kind: 'choose', index: 1 });
        while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
        expect(demo.state.entity('finn')!.hope!.value).toBe(before - 2);
        asked = true;
      } else {
        quiet = true;
        while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
      }
    }
    expect({ asked, quiet }).toEqual({ asked: true, quiet: true });
  });
});


/**
 * Arcana and Blade, read at last: two of their thirteen run.
 */
describe('lifting somebody at somebody else, and keeping what you learned', () => {
  const hold = (demo: DemoScene, who: string, cards: string[]): void => {
    const sheet = { ...demo.sheets.get(who)!, domainCards: cards, loadout: cards.slice(0, 5) };
    demo.sheets.set(who, sheet);
    demo.characters.set(who, deriveCharacter(sheet, characterContentFor(demo.project), demo.project.abilities).character);
    refreshWorld(demo);
  };

  const casting = (seed: string, card: string): { demo: DemoScene; mira: EntityState; husk: EntityState } => {
    const demo = standoff(seed);
    demo.askDefender = false;
    hold(demo, 'mira', [card]);
    const mira = demo.state.entity('mira')!;
    mira.hope = { max: 6, value: 6 };
    const kara = demo.state.entity('kara')!;
    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    husk.hitPoints = { max: 90, marked: 0 };
    const blocked = demo.state.blockedFor('mira');
    demo.grid.forEachNeighbor(kara.tile, false, (tile) => {
      if (demo.grid.isPassable(tile) && !blocked(tile) && tile !== husk.tile) demo.state.moveEntity('mira', tile);
    });
    demo.party.select('mira');
    return { demo, mira, husk };
  };

  it('Telekinesis lifts the one it took hold of and throws them at the next along', () => {
    for (let seed = 1; seed < 80; seed++) {
      const { demo, mira, husk } = casting('tk-' + seed, 'telekinesis');
      // A second husk standing up, so there is somebody to be thrown at.
      const spare = demo.state.entitiesOf('adversary').find((e) => !e.alive);
      if (spare === undefined) continue;
      spare.alive = true;
      spare.hitPoints = { max: 90, marked: 0 };
      const blocked = demo.state.blockedFor(spare.id);
      demo.grid.forEachNeighbor(mira.tile, false, (tile) => {
        if (demo.grid.isPassable(tile) && !blocked(tile) && tile !== husk.tile) demo.state.moveEntity(spare.id, tile);
      });
      const stood = husk.tile;

      expect(useAbility(demo, 'mira', 'telekinesis', [husk.id]).status).toBe('waiting');
      while (demo.pending !== null) answerPending(demo, { kind: 'roll' });
      if (husk.tile === stood) continue;

      // The one taken hold of moved; the one holding them did not.
      expect(husk.tile).not.toBe(stood);
      // And the second roll threw them at somebody, whether or not it landed.
      expect(demo.log.some((l) => /come off the ground/.test(l.text))).toBe(true);
      expect(demo.rolls.length).toBeGreaterThanOrEqual(2);
      return;
    }
    throw new Error('Telekinesis never took hold in eighty tries');
  });

  it('Vitality asks twice, never for the same thing, and is kept for good', () => {
    const demo = standoff('vitality');
    demo.askDefender = false;
    hold(demo, 'kara', ['vitality']);
    const kara = demo.state.entity('kara')!;
    const stress = kara.stress.max;

    expect(useAbility(demo, 'kara', 'vitality', []).status).toBe('waiting');
    if (demo.pending?.prompt.kind !== 'choice') throw new Error('expected the three benefits');
    expect(demo.pending.prompt.options).toHaveLength(3);
    answerPending(demo, { kind: 'choose', index: 0 });

    // Asked again, and the one already taken is not offered a second time.
    if (demo.pending?.prompt.kind !== 'choice') throw new Error('expected the second question');
    expect(demo.pending.prompt.options).toHaveLength(2);
    answerPending(demo, { kind: 'choose', index: 2 });
    while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });

    expect(kara.conditions.has('vitality-stress')).toBe(true);
    expect(kara.conditions.has('vitality-thresholds')).toBe(true);
    expect(kara.conditions.has('vitality-hit-points')).toBe(false);

    // What it leaves is read live: a threshold as a blow arrives, a pool when
    // the pools are next squared up.
    const base = deriveCharacter(demo.sheets.get('kara')!, characterContentFor(demo.project), demo.project.abilities).character;
    expect(demo.world.defenderOf(kara).thresholds.major).toBe(base.thresholds.major + 2);
    syncPools(demo);
    expect(kara.stress.max).toBe(stress + 1);

    // "Permanently": it outlives the scene, where every other card's condition does not.
    demo.state.clearConditions('scene');
    expect(kara.conditions.has('vitality-stress')).toBe(true);
    // And the card is in the vault, as it says.
    expect(demo.sheets.get('kara')!.loadout ?? []).not.toContain('vitality');
  });
});


/**
 * The last card that was blocked rather than deliberately text: five Hope to
 * name a roll's total instead of throwing the dice again.
 */
describe('reaching past the dice', () => {
  /**
   * Reaching past the dice: the number becomes exactly what was needed and the
   * throw itself is left alone. Paid for, and only ever offered on a failure —
   * one block wants this, so it lives here rather than in the shared cards.
   */
  const NAME_CARD = 'fixture-card-2';
  const NAME_THE_ROLL = [
    {
      id: 'fixture-name-the-roll',
      name: 'Name the Roll',
      source: { kind: 'domainCard', card: NAME_CARD },
      text: 'Reach past the dice and put the number where it should have been.',
      kind: 'reaction',
      trigger: 'partyRolling',
      cost: { hope: 5 },
      action: false,
      auto: false,
      available: { kind: 'rolled', is: 'failure' },
      effects: [
        { kind: 'log', text: 'They reach past the dice and set the number where it belonged.', tone: 'hope' },
        { kind: 'nameRoll' },
      ],
    },
  ];

  const hold = (demo: DemoScene, who: string, cards: string[]): void => {
    const sheet = { ...demo.sheets.get(who)!, domainCards: cards, loadout: cards.slice(0, 5) };
    demo.sheets.set(who, sheet);
    demo.characters.set(who, deriveCharacter(sheet, characterContentFor(demo.project), demo.project.abilities).character);
    refreshWorld(demo);
  };

  const rolling = (seed: string): { demo: DemoScene; kara: EntityState; mira: EntityState; husk: EntityState } => {
    const demo = standoff(seed);
    demo.askDefender = true;
    demo.project.domainCards.push(...FIXTURE_CARDS);
    for (const ability of [...WATCHING_CHECK, ...NAME_THE_ROLL]) {
      demo.project.abilities.push(abilitySchema.parse(ability));
    }
    hold(demo, 'kara', [WATCHING_CARD]);
    hold(demo, 'mira', [NAME_CARD]);
    const kara = demo.state.entity('kara')!;
    const mira = demo.state.entity('mira')!;
    mira.hope = { max: 6, value: 6 };
    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    const blocked = demo.state.blockedFor('mira');
    demo.grid.forEachNeighbor(kara.tile, false, (tile) => {
      if (demo.grid.isPassable(tile) && !blocked(tile) && tile !== husk.tile) demo.state.moveEntity('mira', tile);
    });
    return { demo, kara, mira, husk };
  };

  it('is offered only on a failure, and turns one into a success for five Hope', () => {
    for (let seed = 1; seed < 80; seed++) {
      const { demo, mira, husk } = rolling('adjust-' + seed);
      expect(useAbility(demo, 'kara', 'fixture-watching', [husk.id]).status).toBe('waiting');
      answerPending(demo, { kind: 'roll' });
      if (demo.pending?.kind !== 'reaction') continue;

      expect(demo.pending.offers.map((o) => o.ability.id)).toEqual(['fixture-name-the-roll']);
      // Never put on a roll that did not need it.
      const thrown = demo.pending.offers[0]!.swing!;
      expect(thrown.success).toBe(false);

      answerPending(demo, { kind: 'choose', index: 1 });
      while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });

      const settled = demo.rolls[demo.rolls.length - 1]!.roll;
      // The number moved to exactly what was needed, and no further.
      expect(settled.success).toBe(true);
      expect(settled.total).toBe(thrown.difficulty);
      // The dice did not: "the numerical result" is the total, not the throw.
      expect({ hope: settled.hope, fear: settled.fear }).toEqual({ hope: thrown.hope, fear: thrown.fear });
      expect(settled.withHope).toBe(thrown.withHope);
      // Five Hope, out of the six she had.
      expect(mira.hope!.value).toBeLessThanOrEqual(1);
      return;
    }
    throw new Error('Adjust Reality was never offered in eighty tries');
  });

  it('leaves the roll alone when the room lets it pass', () => {
    for (let seed = 1; seed < 80; seed++) {
      const { demo, mira, husk } = rolling('adjust-pass-' + seed);
      useAbility(demo, 'kara', 'fixture-watching', [husk.id]);
      answerPending(demo, { kind: 'roll' });
      if (demo.pending?.kind !== 'reaction') continue;
      const thrown = demo.pending.offers[0]!.swing!;

      answerPending(demo, { kind: 'choose', index: 0 });
      while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
      const settled = demo.rolls[demo.rolls.length - 1]!.roll;
      expect(settled.total).toBe(thrown.total);
      expect(settled.success).toBe(false);
      expect(mira.hope!.value).toBe(6);
      return;
    }
    throw new Error('Adjust Reality was never offered in eighty tries');
  });

  it('is not offered to somebody who cannot pay the five', () => {
    for (let seed = 1; seed < 80; seed++) {
      const rich = rolling('adjust-purse-' + seed);
      useAbility(rich.demo, 'kara', 'fixture-watching', [rich.husk.id]);
      answerPending(rich.demo, { kind: 'roll' });
      if (rich.demo.pending?.kind !== 'reaction') continue;

      // The same seed, so the same roll; what changes is the purse.
      const poor = rolling('adjust-purse-' + seed);
      poor.mira.hope = { max: 6, value: 4 };
      useAbility(poor.demo, 'kara', 'fixture-watching', [poor.husk.id]);
      answerPending(poor.demo, { kind: 'roll' });
      expect(poor.demo.pending?.kind).not.toBe('reaction');
      return;
    }
    throw new Error('Adjust Reality was never offered in eighty tries');
  });
});


/**
 * A roll that knows what it was for. `tags` had been on a check since the
 * schema was written and nothing had ever read one.
 */
describe('a roll with a purpose', () => {
  const hold = (demo: DemoScene, who: string, cards: string[]): void => {
    const sheet = { ...demo.sheets.get(who)!, domainCards: cards, loadout: cards.slice(0, 5) };
    demo.sheets.set(who, sheet);
    demo.characters.set(who, deriveCharacter(sheet, characterContentFor(demo.project), demo.project.abilities).character);
    refreshWorld(demo);
  };

  /**
   * Mira holding the reroll that answers her own tagged rolls, and whatever the
   * test wants her to roll with. Every card and ability here is the project's.
   */
  const talking = (seed: string, cards: string[]): { demo: DemoScene; mira: EntityState; husk: EntityState } => {
    const demo = standoff(seed);
    demo.askDefender = true;
    demo.project.domainCards.push(...FIXTURE_CARDS);
    for (const ability of [...OWN_TAGGED_REROLL, ...TAGGED_CHECK, ...WATCHING_CHECK]) {
      demo.project.abilities.push(abilitySchema.parse(ability));
    }
    hold(demo, 'mira', [OWN_REROLL_CARD, ...cards]);
    const mira = demo.state.entity('mira')!;
    // Room above the six: a roll with Hope hands one over after the card has
    // been paid for, and a full pool would swallow the difference.
    mira.hope = { max: 12, value: 6 };
    const kara = demo.state.entity('kara')!;
    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    husk.hitPoints = { max: 90, marked: 0 };
    const blocked = demo.state.blockedFor('mira');
    demo.grid.forEachNeighbor(kara.tile, false, (tile) => {
      if (demo.grid.isPassable(tile) && !blocked(tile) && tile !== husk.tile) demo.state.moveEntity('mira', tile);
    });
    demo.party.select('mira');
    return { demo, mira, husk };
  };

  it('is offered on a taunt and throws the Fear Die again', () => {
    for (let seed = 1; seed < 80; seed++) {
      const { demo, mira, husk } = talking('charisma-' + seed, [TAGGED_CARD]);
      expect(useAbility(demo, 'mira', 'fixture-tagged-check', [husk.id]).status).toBe('waiting');
      answerPending(demo, { kind: 'roll' });
      if (demo.pending?.kind !== 'reaction') continue;

      expect(demo.pending.offers.map((o) => o.ability.id)).toEqual(['fixture-own-tagged-reroll']);
      const thrown = demo.pending.offers[0]!.swing!;

      answerPending(demo, { kind: 'choose', index: 1 });
      while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });

      const settled = demo.rolls[demo.rolls.length - 1]!.roll;
      // The Fear Die alone went back in the cup: "the Hope or Fear Die", and
      // the Fear one is the pick anybody would make.
      expect(settled.hope).toBe(thrown.hope);
      // One Hope for the card, and whatever the settled roll handed back.
      expect(mira.hope!.value).toBe(6 - 1 + settled.hopeGained);
      return;
    }
    throw new Error('Endless Charisma was never offered on a taunt in eighty tries');
  });

  it('says nothing about a roll that was not persuasion', () => {
    // Know Thy Enemy is an Instinct Roll to watch somebody, and carries no tag.
    for (let seed = 1; seed < 40; seed++) {
      const { demo, husk } = talking('charisma-quiet-' + seed, []);
      hold(demo, 'kara', [WATCHING_CARD]);
      expect(useAbility(demo, 'kara', 'fixture-watching', [husk.id]).status).toBe('waiting');
      answerPending(demo, { kind: 'roll' });
      // The card is in Mira's hand and the roll is not one it answers, so the
      // check never stops at all.
      expect(demo.pending?.kind).not.toBe('reaction');
      while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
      return;
    }
    throw new Error('never got a roll away in forty tries');
  });

  it('and nothing about a swing, which carries no tags at all', () => {
    const { demo, husk } = talking('charisma-swing', []);
    demo.party.select('kara');
    const first = attackWithSelected(demo, husk.id);
    // A weapon swing is a swing; a card asking about persuasion should not hear
    // it, and `answersRoll` is what keeps the moment from being raised.
    expect(first?.waiting).not.toBe(true);
    while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
  });
});


/**
 * The one effect that kills without hitting, and the card the audit called the
 * closest miss left.
 */
describe('unmaking what you can reach', () => {
  const hold = (demo: DemoScene, who: string, cards: string[]): void => {
    const sheet = { ...demo.sheets.get(who)!, domainCards: cards, loadout: cards.slice(0, 5) };
    demo.sheets.set(who, sheet);
    demo.characters.set(who, deriveCharacter(sheet, characterContentFor(demo.project), demo.project.abilities).character);
    refreshWorld(demo);
  };

  it('slay takes them past the veil, where a heal cannot follow', () => {
    const demo = standoff('slay');
    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;

    expect(demo.world.slay({ kind: 'entity', id: husk.id })).toEqual([husk.id]);
    expect(husk.alive).toBe(false);
    expect(husk.dead).toBe(true);
    // The line the effect exists to draw: a heal stands somebody up, and stops
    // at the veil.
    demo.world.heal({ kind: 'entity', id: husk.id }, 9);
    expect(husk.alive).toBe(false);
    // And nothing is slain twice.
    expect(demo.world.slay({ kind: 'entity', id: husk.id })).toEqual([]);
  });

  it('Disintegration Wave unmakes what its roll reached, at a Stress apiece', () => {
    for (let seed = 1; seed < 200; seed++) {
      const demo = standoff('wave-' + seed);
      demo.askDefender = false;
      hold(demo, 'mira', ['disintegration-wave']);
      const mira = demo.state.entity('mira')!;
      mira.stress = { max: 12, marked: 0 };
      // Two husks standing, both within Far of the caster.
      const spare = demo.state.entitiesOf('adversary').find((e) => !e.alive);
      if (spare === undefined) continue;
      spare.alive = true;
      spare.hitPoints = { max: 8, marked: 0 };
      const kara = demo.state.entity('kara')!;
      const blocked = demo.state.blockedFor('mira');
      demo.grid.forEachNeighbor(kara.tile, false, (tile) => {
        if (demo.grid.isPassable(tile) && !blocked(tile)) demo.state.moveEntity('mira', tile);
      });
      demo.party.select('mira');
      // Only the ones standing when the wave came: the harness lays the rest
      // out beforehand, and those were never slain by anything.
      const before = demo.state.entitiesOf('adversary').filter((e) => e.alive).map((e) => e.id);

      expect(useAbility(demo, 'mira', 'disintegration-wave', []).status).toBe('waiting');
      while (demo.pending !== null) answerPending(demo, { kind: 'roll' });
      const taken = before.filter((id) => demo.state.entity(id)?.alive !== true);
      if (taken.length === 0) continue;

      // A Stress for each one taken, and each of them past the veil.
      expect(mira.stress.marked).toBe(taken.length);
      for (const id of taken) expect(demo.state.entity(id)!.dead).toBe(true);
      expect(demo.log.some((l) => /not there afterwards/.test(l.text))).toBe(true);
      return;
    }
    throw new Error('the wave never beat an 18 in two hundred tries');
  });

  it('and takes nothing at all on a roll that falls short', () => {
    for (let seed = 1; seed < 200; seed++) {
      const demo = standoff('wave-short-' + seed);
      demo.askDefender = false;
      hold(demo, 'mira', ['disintegration-wave']);
      const mira = demo.state.entity('mira')!;
      mira.stress = { max: 12, marked: 0 };
      demo.party.select('mira');
      const standing = demo.state.entitiesOf('adversary').filter((e) => e.alive).length;

      useAbility(demo, 'mira', 'disintegration-wave', []);
      while (demo.pending !== null) answerPending(demo, { kind: 'roll' });
      const roll = demo.rolls[demo.rolls.length - 1]?.roll;
      if (roll === undefined || roll.success) continue;

      // Nothing unmade, and no Stress spent on a wave that did not come.
      expect(demo.state.entitiesOf('adversary').filter((e) => e.alive).length).toBe(standing);
      expect(mira.stress.marked).toBe(0);
      return;
    }
    throw new Error('the wave never fell short in two hundred tries');
  });
});
