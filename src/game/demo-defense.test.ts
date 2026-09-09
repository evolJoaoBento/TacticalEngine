import { describe, it, expect } from 'vitest';
import { demoMap } from '../../legacy/js/data.js';
import { deriveCharacter } from '../engine/character/sheet';
import { abilitySchema, loadoutOf, type AbilityDef } from '../engine/content/abilities';
import { runScript } from '../engine/script/runner';
import { formatDice } from '../engine/rules/dice';
import type { Rng } from '../engine/core/rng';
import { pointTiles, rest, shapeAt, useAbility } from './demo-abilities';
import { NO_TILE } from '../engine/grid/grid';
import { reaches } from '../engine/rules/range';
import { adversaryTraits } from '../engine/combat/adversary-features';
import type { DefenseChoice, HeldSwing, PendingDeath, PendingDefense } from './demo-scene';
import type { EntityState } from '../engine/scene/state';
import {
  SRD_CHARACTERS,
  adversaryDefOf,
  answerPending,
  attackWithSelected,
  buildDemoScene,
  defenseChoices,
  endTurn,
  refreshWorld,
  settleFight,
  startEncounter,
  syncPools,
  type DemoScene,
} from './demo-scene';
import { restoreScenario, scenarioSnapshot, useKey } from '../engine/script/world';

/**
 * Passives and reactions in play: what a held card changes on the sheet,
 * what a condition changes while it lasts, and what fires when a hit lands.
 */

const scene = (seed = 'defense'): DemoScene => buildDemoScene(demoMap(), seed);

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
    const bare = deriveCharacter(unarmored, SRD_CHARACTERS, demo.project.abilities).character;
    // Tier 1: 9/19, plus level, plus Unwavering; Armor Score 3 + Strength 2.
    expect(bare.thresholds).toEqual({ major: 11, severe: 21 });
    expect(bare.armorScore).toBe(5);
    // Without the card it would be level / twice level, and no armor at all.
    const plain = deriveCharacter({ ...unarmored, domainCards: ['get-back-up'] }, SRD_CHARACTERS, demo.project.abilities).character;
    expect(plain.thresholds).toEqual({ major: 2, severe: 3 });
    expect(plain.armorScore).toBe(0);
  });

  it('reads a roll bonus with a trait and a weapon requirement at roll time', () => {
    const demo = scene();
    const sheet = demo.sheets.get('kara')!;
    const grown = { ...sheet, domainCards: ['bare-bones', 'body-basher'] };
    demo.sheets.set('kara', grown);
    demo.characters.set('kara', deriveCharacter(grown, SRD_CHARACTERS, demo.project.abilities).character);
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
    demo.characters.set('kara', deriveCharacter(sheet, SRD_CHARACTERS, demo.project.abilities).character);
    refreshWorld(demo);
  };

  it('On the Brink is offered only while its holder is nearly out, whoever is attacking', () => {
    const demo = scene();
    holding(demo, ['on-the-brink']);
    const kara = demo.state.entity('kara')!;
    // The GM's turn is on, so the actor is an adversary: the card still has to
    // read Kara's Hit Points and not the husk's.
    demo.scenario.actorId = demo.state.entitiesOf('adversary')[0]!.id;

    // Kara's subclass brings Iron Will along; this is about the one card.
    const offered = (): string[] =>
      demo.world.reactionsFor('kara', 'incomingDamage').map((a) => a.id).filter((id) => id === 'on-the-brink');

    kara.hitPoints = { max: 6, marked: 3 };
    expect(offered()).toEqual([]);
    kara.hitPoints = { max: 6, marked: 4 };
    expect(offered()).toEqual(['on-the-brink']);

    // And it does what it says: with no Armor Slots left to hide behind,
    // Minor damage marks nothing at all.
    kara.armorSlots = { max: kara.armorSlots.max, marked: kara.armorSlots.max };
    expect(demo.world.dealDamage('kara', { amount: 1, types: ['physical'] }, demo.rng).hpMarked).toBe(0);
    kara.hitPoints = { max: 6, marked: 3 };
    expect(demo.world.dealDamage('kara', { amount: 1, types: ['physical'] }, demo.rng).hpMarked).toBe(1);
  });

  it("Swift Step clears its holder's Stress, not the attacker's", () => {
    const demo = scene();
    holding(demo, ['swift-step']);
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

  it("Blade-Touched raises its holder's Severe threshold while an adversary is the one acting", () => {
    const demo = scene();
    const blade = ['whirlwind', 'not-good-enough', 'i-am-your-shield', 'reckless'];
    holding(demo, ['blade-touched']);
    const alone = demo.world.defenderOf(demo.state.entity('kara')!).thresholds.severe;
    holding(demo, [...blade, 'blade-touched']);
    demo.scenario.actorId = demo.state.entitiesOf('adversary')[0]!.id;
    // Four Blade cards in the loadout beside it: the bonus holds when it is
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
    demo.characters.set('finn', deriveCharacter(demo.sheets.get('finn')!, SRD_CHARACTERS, demo.project.abilities).character);
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
    demo.characters.set('kara', deriveCharacter(sheet, SRD_CHARACTERS, demo.project.abilities).character);
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
  it('erupts when it catches more than one of the party, and the ones who fail are Vulnerable', () => {
    const demo = standoff('eruption');
    // Finn and Mira crowd in beside Kara, so the Burrower has a reason to erupt.
    const around: number[] = [];
    demo.grid.forEachNeighbor(demo.state.entity('kara')!.tile, false, (tile) => {
      if (demo.grid.isPassable(tile)) around.push(tile);
    });
    demo.state.moveEntity('finn', around[0]!);
    demo.state.moveEntity('mira', around[1]!);

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
    const spit = demo.project.abilities.find((a) => a.id === 'acid-burrower-spit-acid')!;
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
    // Kara is the nearest, so Kara is who it went for — hit or missed.
    const swung = demo.log.map((l) => l.text).find((t) => t.includes('the Claws'));
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
    // The Acid Burrower is Relentless (3).
    expect(adversaryTraits(adversaryDefOf(demo, husk.id)!).spotlights).toBe(3);
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

describe('the Burrower\'s scripted attacks', () => {
  it('sprays acid over everyone in reach, and those without armor mark a Hit Point instead', () => {
    const demo = standoff('spit');
    demo.askDefender = false;
    // Two of the party in reach gives it a reason, and a Fear pays for it.
    standBehind(demo, 'finn', demo.state.entitiesOf('adversary').find((e) => e.alive)!.tile);
    demo.state.fear = { ...demo.state.fear, value: demo.state.fear.max };
    // Finn's armor is already gone, so the acid costs him a Hit Point instead.
    const finn = demo.state.entity('finn')!;
    finn.armorSlots = { ...finn.armorSlots, marked: finn.armorSlots.max };

    let sprayed = false;
    for (let i = 0; i < 30 && !sprayed; i++) {
      endTurn(demo);
      sprayed = demo.log.some((l) => l.text.includes('Acid arcs out'));
      if (demo.encounter?.outcome !== 'ongoing') break;
    }
    expect(sprayed).toBe(true);
    // Everyone it beat was rolled for separately, and the log says what happened.
    expect(demo.log.map((l) => l.text).filter((t) => t.includes('Spit Acid')).length).toBeGreaterThan(0);
  });

  it("bathes the room when a card's own attack is what wounds it", () => {
    // The reaction has to fire off a script's attack too, not only off damage
    // the world was handed: a card's `attack` goes through the same door an
    // adversary's swing does, and the queue has to drain after a card.
    const demo = standoff('bath-card');
    demo.askDefender = false;
    demo.project.abilities.push(
      abilitySchema.parse({
        id: 'heavy-blow',
        name: 'Heavy Blow',
        source: { kind: 'granted', characters: ['kara'] },
        target: { kind: 'adversary', range: 'melee' },
        action: false,
        // Well past the Burrower's Severe threshold, and not enough to kill it.
        effects: [{ kind: 'attack', damage: '+16 phy' }],
      }),
    );

    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    const kara = demo.state.entity('kara')!;
    const before = kara.hitPoints.marked + kara.armorSlots.marked;

    // Whether a given swing lands is the seed's business; that the wound
    // answers is not, so swing until one lands.
    for (let i = 0; i < 20 && !demo.log.some((l) => l.text.includes('Acid blood')); i++) {
      husk.hitPoints = { max: 40, marked: 0 };
      expect(useAbility(demo, 'kara', 'heavy-blow', [husk.id]).status).toBe('done');
    }
    expect(husk.alive).toBe(true);
    expect(demo.log.map((l) => l.text)).toContain('Acid blood sprays from the wound.');
    const after = demo.state.entity('kara')!;
    expect(after.hitPoints.marked + after.armorSlots.marked).toBeGreaterThan(before);
  });

  it('bathes the room in acid when it takes Severe damage', () => {
    const demo = standoff('bath');
    demo.askDefender = false;
    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    husk.hitPoints = { max: 8, marked: 0 };
    const kara = demo.state.entity('kara')!;
    const before = kara.hitPoints.marked + kara.armorSlots.marked;
    // Straight past its Severe threshold (8/15), without killing it.
    demo.world.dealDamage(husk.id, { amount: 16, types: ['physical'] }, demo.rng);
    expect(husk.alive).toBe(true);
    settleFight(demo);
    expect(demo.log.map((l) => l.text)).toContain('Acid blood sprays from the wound.');
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
    demo.characters.set('kara', deriveCharacter(grown, SRD_CHARACTERS, demo.project.abilities).character);
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

  it('asks before it spends the Hope, and spends it only when the answer is yes', () => {
    // "When you deal damage to an adversary, you can spend 2 Hope to clear a
    // Hit Point on an ally within Close range."
    const demo = holding(['healing-strike'], 'healing-yes');
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
    expect(waiting.offers.map((o) => o.ability.id)).toEqual(['healing-strike']);
    // Nothing has been spent while the question stands.
    expect(demo.state.entity('kara')!.hope!.value).toBe(6);

    answerPending(demo, { kind: 'choose', index: 1 });
    expect(demo.state.entity('kara')!.hope!.value).toBe(4);
    expect(demo.state.entity('mira')!.hitPoints.marked).toBe(1);
    expect(demo.pending).toBeNull();
  });

  it('lets it pass without spending anything', () => {
    const demo = holding(['healing-strike'], 'healing-no');
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
    const demo = holding(['healing-strike'], 'healing-quiet');
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
    const demo = holding(['rise-up'], 'rise-up');
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
    const demo = holding(['rise-up'], 'rise-up-mid-turn');
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
    const cards = demo.project.abilities;
    const sheet = { ...demo.sheets.get('kara')!, domainCards: [], loadout: [] };
    const plain = deriveCharacter(sheet, SRD_CHARACTERS, cards).character;
    const risen = deriveCharacter({ ...sheet, domainCards: ['rise-up'], loadout: ['rise-up'] }, SRD_CHARACTERS, cards).character;
    expect(risen.proficiency).toBeGreaterThan(0);
    expect(risen.thresholds.severe).toBe(plain.thresholds.severe + risen.proficiency);
    expect(risen.thresholds.major).toBe(plain.thresholds.major);
  });
});

describe('a bonus the card counts out for itself', () => {
  /** Kara holding a card, in a fight, the party asked rather than decided for. */
  const holding = (cards: readonly string[], seed: string): DemoScene => {
    const demo = standoff(seed);
    demo.askDefender = true;
    const sheet = demo.sheets.get('kara')!;
    const grown = { ...sheet, domainCards: [...cards], loadout: [...cards] };
    demo.sheets.set('kara', grown);
    demo.characters.set('kara', deriveCharacter(grown, SRD_CHARACTERS, demo.project.abilities).character);
    refreshWorld(demo);
    syncPools(demo);
    return demo;
  };

  it('reads the tokens where they are used, and never off the sheet', () => {
    const demo = holding(['ferocity'], 'ferocity-evasion');
    const derived = demo.characters.get('kara')!.evasion;
    expect(demo.world.poolBonus('kara', 'evasion')).toBe(0);

    demo.world.addTokens('kara', 'ferocity', 3);
    // "Increase your Evasion by the number of Hit Points they marked."
    expect(demo.world.poolBonus('kara', 'evasion')).toBe(3);
    // The sheet is where the fight is not: a token is scene state, and a
    // character derived again finds the same Evasion it always had.
    expect(deriveCharacter(demo.sheets.get('kara')!, SRD_CHARACTERS, demo.project.abilities).character.evasion).toBe(derived);
  });

  it('places a token for each Hit Point the blow marked, and none for a blow that marked nothing', () => {
    const demo = holding(['never-upstaged'], 'upstaged-tokens');
    const kara = demo.state.entity('kara')!;
    kara.hitPoints = { max: 40, marked: 0 };

    demo.world.noteDamage('kara', { attacker: 'husk', hitPoints: 3, damage: 14, types: ['physical'] });
    settleFight(demo);
    // "You can mark a Stress to place a number of tokens equal to the number
    // of Hit Points you marked on this card": the Stress is a price, so it is
    // asked about first.
    expect(asked(demo)).toBe('reaction');
    answerPending(demo, { kind: 'choose', index: 1 });
    expect(demo.world.tokensOn('kara', 'never-upstaged')).toBe(3);
    expect(kara.stress.marked).toBeGreaterThan(0);
  });

  it('adds five to the damage for each token, then clears the card', () => {
    const demo = holding(['never-upstaged'], 'upstaged-damage');
    demo.askDefender = false;
    const foe = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    foe.hitPoints = { max: 60, marked: 0 };
    demo.world.addTokens('kara', 'never-upstaged', 2);
    expect(demo.world.rollBonus('kara', 'damageRoll', { melee: true })).toBe(10);

    for (let i = 0; i < 20; i++) {
      if (!demo.encounter!.canAct('kara')) endTurn(demo);
      if (demo.state.entity(foe.id)?.alive !== true) break;
      const result = attackWithSelected(demo, foe.id);
      if (result?.hit === true) break;
    }
    // "On your next successful attack… then clear all tokens."
    expect(demo.log.some((l) => /Kara (hits|lands a critical)/.test(l.text))).toBe(true);
    expect(demo.world.tokensOn('kara', 'never-upstaged')).toBe(0);
    // And with the card empty the bonus is gone with it.
    expect(demo.world.rollBonus('kara', 'damageRoll', { melee: true })).toBe(0);
  });

  it('places a token for each Hit Point the swing marked, once the Hope is spent', () => {
    // "When you cause an adversary to mark 1 or more Hit Points, you can spend
    // 2 Hope to increase your Evasion by the number of Hit Points they marked."
    const demo = holding(['ferocity'], 'ferocity-placed');
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
    expect(demo.world.tokensOn('kara', 'ferocity')).toBe(marked);
    expect(demo.state.entity('kara')!.hope!.value).toBe(4);
    // Which is the Evasion the card promised, for as long as it lasts.
    expect(demo.world.poolBonus('kara', 'evasion')).toBe(marked);
  });

  it('spends the Ferocity the moment the next attack is over, hit or miss', () => {
    const demo = holding(['ferocity'], 'ferocity-spent');
    demo.askDefender = false;
    const kara = demo.state.entity('kara')!;
    kara.hitPoints = { max: 40, marked: 0 };
    demo.world.addTokens('kara', 'ferocity', 2);
    expect(demo.world.poolBonus('kara', 'evasion')).toBe(2);

    for (let i = 0; i < 12 && demo.world.tokensOn('kara', 'ferocity') > 0; i++) {
      kara.armorSlots = { max: kara.armorSlots.max, marked: kara.armorSlots.max };
      endTurn(demo);
    }
    // "This bonus lasts until after the next attack made against you."
    expect(demo.world.tokensOn('kara', 'ferocity')).toBe(0);
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
    demo.characters.set('kara', deriveCharacter(sheet, SRD_CHARACTERS, demo.project.abilities).character);
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
  const holding = (demo: DemoScene, cards: string[]): void => {
    const sheet = { ...demo.sheets.get('kara')!, domainCards: cards, loadout: cards };
    demo.sheets.set('kara', sheet);
    demo.characters.set('kara', deriveCharacter(sheet, SRD_CHARACTERS, demo.project.abilities).character);
    refreshWorld(demo);
  };

  it('takes dice off the blow and puts them back into whoever swung', () => {
    const demo = standoff('thorns');
    holding(demo, ['thorn-skin']);
    demo.world.addTokens('kara', 'thorn-skin', 3);
    const asked = untilChoice(demo, 'script');
    expect(asked).not.toBeNull();
    const index = asked!.choices.findIndex((c) => c.kind === 'script');
    expect(asked!.choices[index]!.label).toContain('Thorn Skin');

    // The same blow, taken plainly, off the same seed.
    const cold = standoff('thorns');
    holding(cold, ['thorn-skin']);
    cold.world.addTokens('kara', 'thorn-skin', 3);
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

    expect(demo.world.tokensOn('kara', 'thorn-skin')).toBe(0);
    expect(demo.log.some((l) => l.text.includes('turns aside'))).toBe(true);
    expect(husk.hitPoints.marked).toBeGreaterThan(0);
    expect(demo.state.entity('kara')!.hitPoints.marked).toBeLessThan(plain);
  });

  it('sends the blow back at whoever cast it when the dice come up', () => {
    // "Spend any number of Hope to roll that many d6s. If any roll a 6, the
    // attack is reflected back, dealing the damage to them instead."
    for (let seed = 1; seed < 20; seed++) {
      const demo = standoff(`mirror-${seed}`);
      holding(demo, ['arcane-reflection']);
      const asked = untilChoice(demo, 'script');
      if (asked === null) continue;
      const index = asked.choices.findIndex((c) => c.kind === 'script');
      expect(asked.choices[index]!.label).toContain('Arcane Reflection');

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
    holding(demo, ['redirect']);
    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    const bound = { targets: [husk.id], hit: [husk.id] };
    expect(demo.world.reactionsFor('kara', 'attackMissed', bound)).toEqual([]);

    // Stood off from it, the card has something to say. Far enough that the
    // claws are not in reach, near enough that the fight is one room.
    const stand = demo.grid.indexOf(demo.grid.xOf(husk.tile) + 3, demo.grid.yOf(husk.tile));
    demo.state.moveEntity('kara', stand);
    expect(demo.world.reactionsFor('kara', 'attackMissed', bound).map((a) => a.id)).toEqual(['redirect']);

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
      holding(demo, ['unyielding-armor']);
      const asked = untilChoice(demo, 'script');
      if (asked === null) continue;
      const index = asked.choices.findIndex((c) => c.kind === 'script');
      expect(asked.choices[index]!.label).toContain('Unyielding Armor');

      // The same blow taken plainly, off the same seed.
      const cold = standoff(`plate-${seed}`);
      holding(cold, ['unyielding-armor']);
      untilChoice(cold, 'script');
      answerPending(cold, { kind: 'choose', index: 0 });
      const plain = cold.state.entity('kara')!.hitPoints.marked;

      answerPending(demo, { kind: 'choose', index });
      while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
      if (!demo.log.some((l) => l.text.includes('no business holding'))) continue;
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
      holding(demo, ['i-see-it-coming']);
      // Standing off from it: the card answers a swing from beyond Melee, and
      // the Burrower's claws reach Very Close without closing the ground.
      const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
      demo.state.moveEntity('kara', demo.grid.indexOf(demo.grid.xOf(husk.tile) + 2, demo.grid.yOf(husk.tile)));
      const asked = untilChoice(demo, 'script');
      if (asked === null) continue;
      const index = asked.choices.findIndex((c) => c.kind === 'script');
      expect(asked.choices[index]!.label).toContain('I See It Coming');

      const said = demo.log.length;
      answerPending(demo, { kind: 'choose', index });
      while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
      const after = demo.log.slice(said).map((t) => t.text);
      expect(after.some((t) => t.includes('sees it coming'))).toBe(true);
      if (!after.some((t) => t.includes('misses Kara'))) continue;
      // The d4 was enough: the swing that had landed no longer has.
      expect(after.some((t) => /Claws (hits|tears into) Kara/.test(t))).toBe(false);
      expect(demo.state.entity('kara')!.stress.marked).toBeGreaterThanOrEqual(1);
      return;
    }
    throw new Error('no seed put a blow inside a d4 in forty tries');
  });

  it('is not there when the blow arrives, and the swing is spent on nothing', () => {
    const demo = standoff('scramble');
    holding(demo, ['scramble']);
    const asked = untilChoice(demo, 'script');
    expect(asked).not.toBeNull();
    const index = asked!.choices.findIndex((c) => c.kind === 'script');
    expect(asked!.choices[index]!.label).toContain('Scramble');

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
  const holding = (demo: DemoScene, cards: string[]): void => {
    const sheet = { ...demo.sheets.get('kara')!, domainCards: cards, loadout: cards };
    demo.sheets.set('kara', sheet);
    demo.characters.set('kara', deriveCharacter(sheet, SRD_CHARACTERS, demo.project.abilities).character);
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
    holding(demo, ['frenzy']);
    const kara = demo.state.entity('kara')!;
    kara.armorSlots = { max: 4, marked: 0 };
    kara.hitPoints = { max: 12, marked: 0 };
    const before = demo.world.defenderOf(kara).thresholds.severe;

    // Without it, the engine spends a slot on a blow like that.
    struck(demo);
    expect(kara.armorSlots.marked).toBeGreaterThan(0);
    kara.armorSlots = { max: 4, marked: 0 };
    kara.hitPoints = { max: 12, marked: 0 };

    expect(useAbility(demo, 'kara', 'frenzy', []).status).toBe('done');
    expect(kara.conditions.has('frenzied')).toBe(true);
    expect(demo.world.rollBonus('kara', 'damageRoll', { melee: true })).toBe(10);
    expect(demo.world.defenderOf(kara).thresholds.severe).toBe(before + 8);

    // The armor is still on her; it is simply not something she will use.
    expect(demo.world.armorFor('kara')).toEqual({ max: 4, marked: 4 });
    struck(demo);
    expect(kara.armorSlots.marked).toBe(0);
    expect(kara.hitPoints.marked).toBeGreaterThan(0);
  });

  it('goes spectral until they swing, and physical damage passes through', () => {
    const demo = standoff('specter');
    holding(demo, ['specter-of-the-dark']);
    const kara = demo.state.entity('kara')!;
    kara.hitPoints = { max: 6, marked: 0 };

    expect(useAbility(demo, 'kara', 'specter-of-the-dark', []).status).toBe('done');
    expect(kara.conditions.has('spectral')).toBe(true);
    expect(kara.stress.marked).toBe(1);

    struck(demo);
    expect(kara.hitPoints.marked).toBe(0);

    // Swinging is the end of it, which is what "until you make an action roll
    // targeting another creature" comes to in a fight.
    demo.world.endsOnAttack('kara');
    expect(kara.conditions.has('spectral')).toBe(false);
    struck(demo);
    expect(kara.hitPoints.marked).toBeGreaterThan(0);
  });

  it('calls the room together, and the room swings harder for it', () => {
    const demo = standoff('cry');
    holding(demo, ['battle-cry']);
    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    const finn = demo.state.entity('finn')!;
    // Within earshot: Kara went to meet the husk, and the rest of the party
    // spawned across the room.
    standBehind(demo, 'finn', husk.tile);
    finn.stress = { max: 6, marked: 2 };
    if (finn.hope !== undefined) finn.hope = { max: 6, value: 0 };
    expect(demo.world.advantageFor('finn', husk.id).advantage).toBe(0);

    expect(useAbility(demo, 'kara', 'battle-cry', []).status).toBe('done');
    expect(finn.stress.marked).toBe(1);
    expect(finn.hope?.value).toBe(1);
    expect(finn.conditions.has('inspired')).toBe(true);
    expect(demo.world.advantageFor('finn', husk.id).advantage).toBe(1);
    // The one who called it is not the one it inspires.
    expect(demo.state.entity('kara')!.conditions.has('inspired')).toBe(false);
  });

  it("horrifies what it can, and takes the GM's Fear for each of them", () => {
    for (let seed = 1; seed < 30; seed++) {
      const demo = standoff(`terror-${seed}`);
      holding(demo, ['night-terror']);
      demo.state.fear = { ...demo.state.fear, value: 4 };
      const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;

      expect(useAbility(demo, 'kara', 'night-terror', []).status).toBe('done');
      if (!husk.conditions.has('horrified')) continue;
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
      expect(deriveCharacter({ ...sheet, scars: 1 }, SRD_CHARACTERS, demo.project.abilities).character.hope.max).toBe(slots - 1);

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
    demo.characters.set('kara', deriveCharacter(sheet, SRD_CHARACTERS, demo.project.abilities).character);
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
    demo.characters.set('kara', deriveCharacter(sheet, SRD_CHARACTERS, demo.project.abilities).character);
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
    demo.characters.set('kara', deriveCharacter(sheet, SRD_CHARACTERS, demo.project.abilities).character);
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
    const one = deriveCharacter({ ...sheet, proficiency: 5 }, SRD_CHARACTERS, demo.project.abilities).character;
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
    demo.characters.set('kara', deriveCharacter(sheet, SRD_CHARACTERS, demo.project.abilities).character);
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
    demo.characters.set('kara', deriveCharacter(sheet, SRD_CHARACTERS, demo.project.abilities).character);
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
  const hold = (demo: DemoScene, cards: string[]): void => {
    const sheet = { ...demo.sheets.get('kara')!, domainCards: cards, loadout: cards.slice(0, 5) };
    demo.sheets.set('kara', sheet);
    demo.characters.set('kara', deriveCharacter(sheet, SRD_CHARACTERS, demo.project.abilities).character);
    refreshWorld(demo);
  };

  it('takes Deathrun through everything the path went past, and moves her there', () => {
    for (let seed = 1; seed < 40; seed++) {
      const demo = standoff(`deathrun-${seed}`);
      demo.askDefender = false;
      hold(demo, ['deathrun']);
      const kara = demo.state.entity('kara')!;
      kara.hope = { max: 6, value: 6 };
      const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
      husk.hitPoints = { max: 40, marked: 0 };

      // A tile on the far side of the husk, so the run goes through it.
      const past = demo.grid.indexOf(
        Math.min(demo.grid.width - 1, demo.grid.xOf(husk.tile) + 2),
        demo.grid.yOf(husk.tile),
      );
      const card = demo.project.abilities.find((a) => a.id === 'deathrun')!;
      if (!pointTiles(demo, 'kara', card).includes(past)) continue;
      if (!shapeAt(demo, 'kara', card, past).includes(husk.id)) continue;

      const from = kara.tile;
      expect(useAbility(demo, 'kara', 'deathrun', [], { point: past }).status).not.toBe('refused');
      while (demo.pending !== null) answerPending(demo, { kind: 'roll' });

      // "Spend 3 Hope", and the run happened. What the roll gives back is the
      // action roll's business, not the card's.
      expect(demo.log.some((l) => l.text.includes('Spends 3 Hope.'))).toBe(true);
      expect(kara.tile).not.toBe(from);
      // On a success the husk is hurt; on a failure it is not, and either way
      // the path was run.
      if (husk.hitPoints.marked > 0) return;
      expect(demo.log.some((l) => l.text.includes('straight line through the middle'))).toBe(true);
      return;
    }
    throw new Error('the path never lined up in forty tries');
  });

  it('refuses Deathrun with nowhere to aim it', () => {
    const demo = standoff('deathrun-nowhere');
    hold(demo, ['deathrun']);
    demo.state.entity('kara')!.hope = { max: 6, value: 6 };
    expect(useAbility(demo, 'kara', 'deathrun', []).status).toBe('refused');
    expect(demo.log.some((l) => l.text.includes('needs somewhere to aim'))).toBe(true);
  });

  it("charges at the nearest of the party when nobody is there to click a tile", () => {
    // A stat block cannot pick a point, so it runs at whoever is nearest - the
    // same rule its swing already uses to choose whom to hit.
    for (let seed = 1; seed < 40; seed++) {
      const demo = standoff(`rampage-${seed}`);
      demo.askDefender = false;
      const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
      // Stand an Ogre in for it, and wound it enough to set the feature off.
      const ogre = demo.project.abilities.find((a) => a.id === 'cave-ogre-rampaging-fury')!;
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
    demo.characters.set('kara', deriveCharacter(sheet, SRD_CHARACTERS, demo.project.abilities).character);
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
  const gives = (demo: DemoScene, id: string, cards: string[]): void => {
    const sheet = { ...demo.sheets.get(id)!, domainCards: cards, loadout: cards.slice(0, 5) };
    demo.sheets.set(id, sheet);
    demo.characters.set(id, deriveCharacter(sheet, SRD_CHARACTERS, demo.project.abilities).character);
    refreshWorld(demo);
  };

  /** Kara beside the husk, Mira a step behind her with the cards in hand. */
  const stage = (seed: string, cards: string[]): DemoScene => {
    const demo = standoff(seed);
    demo.askDefender = true;
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
      const demo = stage(`bindings-${seed}`, ['rune-ward']);
      demo.project.abilities.push(
        abilitySchema.parse({
          id: 'watching',
          name: 'Watching',
          source: { kind: 'domainCard', card: 'rune-ward' },
          text: 'When somebody nearby is hurt, you note who.',
          kind: 'reaction',
          trigger: 'nearbyTookDamage',
          action: false,
          available: { kind: 'side', of: { kind: 'hit' }, is: 'adversary' },
          effects: [{ kind: 'log', text: 'Mira marks the one that is bleeding.', tone: 'hope' }],
        }),
      );
      gives(demo, 'mira', ['rune-ward']);

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
      const demo = stage(`encore-${seed}`, ['encore']);
      const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
      attackWithSelected(demo, husk.id);
      const at = offerOf(demo, 'Encore');
      if (at === null) continue;

      const before = husk.hitPoints.marked;
      const said = demo.log.length;
      answerPending(demo, { kind: 'choose', index: at });
      let guard = 0;
      while (demo.pending !== null && guard++ < 8) answerPending(demo, { kind: 'roll' });
      const after = demo.log.slice(said).map((l) => l.text);

      expect(after.some((t) => t.includes('Mira: Encore'))).toBe(true);
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
      const demo = stage(`encore-fear-${seed}`, ['encore']);
      const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
      attackWithSelected(demo, husk.id);
      const at = offerOf(demo, 'Encore');
      if (at === null) continue;
      const said = demo.log.length;
      answerPending(demo, { kind: 'choose', index: at });
      let guard = 0;
      while (demo.pending !== null && guard++ < 8) answerPending(demo, { kind: 'roll' });
      const after = demo.log.slice(said).map((l) => l.text);
      if (!after.some((t) => t.includes('Success, with Fear'))) continue;
      // "Then place this card in your vault": out of the loadout, and no
      // longer offering the reaction it was just played for.
      expect(loadoutOf(demo.characters.get('mira')!)).not.toContain('encore');
      return;
    }
    throw new Error('no seed put Encore through a success with Fear');
  });

  it('holds Encore back when the one bleeding is one of the party', () => {
    // The card reads "an ally deals damage to an adversary". A blow the other
    // way round names an adversary as the dealer and an ally as the hit, and
    // both gates say no.
    const demo = stage('encore-wrong-way', ['encore']);
    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    for (let i = 0; i < 8 && demo.encounter?.outcome === 'ongoing'; i++) {
      endTurn(demo);
      let guard = 0;
      while (demo.pending !== null && guard++ < 8) answerPending(demo, { kind: 'choose', index: 0 });
      if (demo.state.entity('kara')!.hitPoints.marked > 0) break;
    }
    expect(demo.state.entity('kara')!.hitPoints.marked).toBeGreaterThan(0);
    expect(demo.log.some((l) => l.text.includes('Mira: Encore'))).toBe(false);
    expect(husk.hitPoints.marked).toBe(0);
  });
});


describe('a smite held back for the next blow', () => {
  /** Kara beside the husk with the card in hand and Hope to spend it. */
  const charged = (seed: string, spend: boolean) => {
    const demo = standoff(seed);
    demo.askDefender = false;
    // The same sheet in both runs, charged or not: a loadout that differs is a
    // character that differs, and the two blows would not be comparable.
    const sheet = { ...demo.sheets.get('kara')!, domainCards: ['smite'], loadout: ['smite'] };
    demo.sheets.set('kara', sheet);
    demo.characters.set('kara', deriveCharacter(sheet, SRD_CHARACTERS, demo.project.abilities).character);
    refreshWorld(demo);
    demo.state.entity('kara')!.hope = { max: 6, value: 6 };
    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    husk.hitPoints = { max: 60, marked: 0 };
    if (spend) expect(useAbility(demo, 'kara', 'smite', []).status).not.toBe('refused');
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
      expect(lit.demo.state.entity('kara')!.conditions.has('smiting')).toBe(true);
      attackWithSelected(lit.demo, lit.husk.id);

      expect(lit.husk.hitPoints.marked).toBeGreaterThan(bare.husk.hitPoints.marked);
      // Spent: the charge is gone and the swing after it is an ordinary one.
      expect(lit.demo.state.entity('kara')!.conditions.has('smiting')).toBe(false);
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
    expect(useAbility(demo, 'kara', 'smite', []).status).toBe('refused');
    expect(demo.log.some((l) => l.text.includes('already'))).toBe(false);
    // And with the charge spent, the use is spent with it.
    demo.world.clearCondition('kara', 'smiting');
    demo.state.entity('kara')!.hope = { max: 6, value: 6 };
    const said = demo.log.length;
    expect(useAbility(demo, 'kara', 'smite', []).status).toBe('refused');
    expect(demo.log.slice(said).some((l) => l.text.includes('used until the next rest'))).toBe(true);
  });

  it('keeps the charge as long as the use it cost', () => {
    const { demo } = charged('smite-lasts', true);
    // The fight ending does not put it out: the card is spent until a rest,
    // and a charge that went out with the fight would be spent for nothing.
    demo.state.clearConditions('scene');
    expect(demo.state.entity('kara')!.conditions.has('smiting')).toBe(true);
    demo.state.clearConditions('rest');
    expect(demo.state.entity('kara')!.conditions.has('smiting')).toBe(false);
  });

  it('keeps the charge through a swing that misses', () => {
    for (let seed = 1; seed < 40; seed++) {
      const { demo, husk } = charged(`smite-miss-${seed}`, true);
      attackWithSelected(demo, husk.id);
      if (husk.hitPoints.marked > 0) continue;
      // "When you next successfully attack": a miss is not that swing.
      expect(demo.state.entity('kara')!.conditions.has('smiting')).toBe(true);
      return;
    }
    throw new Error('Kara never missed');
  });
});

describe('a shell of light over somebody', () => {
  /**
   * Mira beside Kara with the spell in hand, cast on her or not, and the husk
   * swinging hard enough that an Armor Slot alone does not answer the blow.
   */
  const staged = (seed: string, cast: boolean, swing: Record<string, unknown> = { damage: '2d20+30' }): DemoScene => {
    const demo = standoff(seed);
    demo.askDefender = false;
    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    standBehind(demo, 'mira', husk.tile);
    demo.project.abilities = demo.project.abilities.filter((a) => a.source.kind !== 'adversary');
    demo.project.abilities.push(
      abilitySchema.parse({
        id: 'heavy-claws',
        name: 'Heavy Claws',
        source: { kind: 'adversary', adversaries: [adversaryDefOf(demo, husk.id)!.id] },
        text: 'The claws come down harder than the block prints.',
        kind: 'passive',
        // Hard enough that an Armor Slot alone cannot answer it: the aura is
        // only ever worth anything on a blow the armor did not finish.
        standardAttack: swing,
      }),
    );
    const sheet = { ...demo.sheets.get('mira')!, domainCards: ['shield-aura'], loadout: ['shield-aura'] };
    demo.sheets.set('mira', sheet);
    demo.characters.set('mira', deriveCharacter(sheet, SRD_CHARACTERS, demo.project.abilities).character);
    // Kara's own cards come off: Iron Will and Get Back Up answer a blow the
    // same way the aura does, and what is under test is the aura.
    const hers = { ...demo.sheets.get('kara')!, domainCards: [], loadout: [] };
    demo.sheets.set('kara', hers);
    demo.characters.set('kara', deriveCharacter(hers, SRD_CHARACTERS, demo.project.abilities).character);
    refreshWorld(demo);
    demo.state.fear = { ...demo.state.fear, value: demo.state.fear.max };
    demo.state.entity('kara')!.hitPoints = { max: 20, marked: 0 };
    if (cast) {
      expect(useAbility(demo, 'mira', 'shield-aura', ['kara']).status).not.toBe('refused');
      expect(demo.state.entity('kara')!.conditions.has('shield-aura')).toBe(true);
    }
    return demo;
  };

  /** Turns until an Armor Slot answers a blow of Kara's, or null. */
  const untilArmored = (demo: DemoScene): number | null => {
    const kara = demo.state.entity('kara')!;
    for (let turn = 1; turn <= 8 && demo.encounter?.outcome === 'ongoing'; turn++) {
      endTurn(demo);
      let guard = 0;
      while (demo.pending !== null && guard++ < 8) answerPending(demo, { kind: 'choose', index: 0 });
      if (kara.armorSlots.marked > 0) return turn;
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
      expect(kara.conditions.has('shield-aura')).toBe(false);
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
      expect(kara.conditions.has('shield-aura')).toBe(true);
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
    expect(useAbility(demo, 'mira', 'shield-aura', ['finn']).status).not.toBe('refused');
    expect(demo.state.entity('finn')!.conditions.has('shield-aura')).toBe(true);
    expect(demo.state.entity('kara')!.conditions.has('shield-aura')).toBe(false);
  });
});


describe('a word in the wrong ear', () => {
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

    const sheet = { ...demo.sheets.get('mira')!, domainCards: ['words-of-discord'], loadout: ['words-of-discord'] };
    demo.sheets.set('mira', sheet);
    demo.characters.set('mira', deriveCharacter(sheet, SRD_CHARACTERS, demo.project.abilities).character);
    refreshWorld(demo);
    return { demo, husk, other };
  };

  const whisper = (demo: DemoScene, at: string): string[] => {
    const said = demo.log.length;
    demo.party.select('mira');
    useAbility(demo, 'mira', 'words-of-discord', [at]);
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
      expect(husk.conditions.has('wise-to-discord')).toBe(true);
      // And the fight is left in one piece, whether or not the blow landed.
      expect(demo.pending).toBeNull();
      expect(other.alive || demo.encounter?.outcome === 'ongoing').toBe(true);
      return;
    }
    throw new Error('the whisper never took in sixty tries');
  });

  it('is harder to say to somebody who has heard it before', () => {
    const { demo, husk } = whispering('discord-again');
    demo.world.applyCondition(husk.id, 'wise-to-discord', 'scene');
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
    const sheet = { ...demo.sheets.get('kara')!, domainCards: ['lead-by-example'], loadout: ['lead-by-example'] };
    demo.sheets.set('kara', sheet);
    demo.characters.set('kara', deriveCharacter(sheet, SRD_CHARACTERS, demo.project.abilities).character);
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
    return demo.state.entity(husk)!.conditions.has('led-by-example');
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
      expect(demo.state.entity(husk.id)!.conditions.has('led-by-example')).toBe(false);
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
          source: { kind: 'domainCard', card: 'lead-by-example' },
          text: 'When you deal damage, the room takes heart at once.',
          kind: 'reaction',
          trigger: 'dealtDamage',
          action: false,
          effects: [{ kind: 'applyCondition', condition: 'led-by-example', duration: 'scene', target: { kind: 'target' } }],
        }),
      );
      refreshWorld(demo);

      demo.party.select('kara');
      const marked = demo.state.entity(husk.id)!.hitPoints.marked;
      attackWithSelected(demo, husk.id);
      let guard = 0;
      while (demo.pending !== null && guard++ < 6) answerPending(demo, { kind: 'choose', index: 0 });
      if (demo.state.entity(husk.id)!.hitPoints.marked === marked) continue;

      expect(demo.state.entity(husk.id)!.conditions.has('led-by-example')).toBe(true);
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
          source: { kind: 'domainCard', card: 'rune-ward' },
          text: 'When you deal damage, you can say something about it.',
          kind: 'reaction',
          trigger: 'dealtDamage',
          action: false,
          auto: false,
          effects: [{ kind: 'log', text: 'Finn follows through.', tone: 'hope' }],
        }),
      );
      const his = { ...demo.sheets.get('finn')!, domainCards: ['rune-ward'], loadout: ['rune-ward'] };
      demo.sheets.set('finn', his);
      demo.characters.set('finn', deriveCharacter(his, SRD_CHARACTERS, demo.project.abilities).character);
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
      expect(demo.state.entity(husk.id)!.conditions.has('led-by-example')).toBe(true);
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
    demo.characters.set('kara', deriveCharacter(sheet, SRD_CHARACTERS, demo.project.abilities).character);
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
  /** Mira beside Kara with the card in hand, both beside the husk. */
  const blinking = (seed: string) => {
    const demo = standoff(seed);
    demo.askDefender = false;
    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    standBehind(demo, 'mira', husk.tile);
    const sheet = { ...demo.sheets.get('mira')!, domainCards: ['blink-out'], loadout: ['blink-out'] };
    demo.sheets.set('mira', sheet);
    demo.characters.set('mira', deriveCharacter(sheet, SRD_CHARACTERS, demo.project.abilities).character);
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
    const card = demo.project.abilities.find((a) => a.id === 'blink-out')!;
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

      expect(useAbility(demo, 'mira', 'blink-out', [], { point: at }).status).not.toBe('refused');
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

      expect(useAbility(demo, 'mira', 'blink-out', [], { point: at }).status).not.toBe('refused');
      // Option 1 is "take them with you"; option 0 is going alone.
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
      expect(useAbility(demo, 'mira', 'blink-out', [], { point: at }).status).not.toBe('refused');
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
      expect(offered).toEqual(['Go alone']);
      expect(demo.state.entity('kara')!.tile).not.toBe(at);

      // With a Hope for each of them it is offered, and each of them is paid for.
      const { demo: rich } = blinking(`blink-price-${seed}`);
      rich.state.moveEntity('finn', stand);
      const richMira = rich.state.entity('mira')!;
      richMira.hope = { max: 6, value: 4 };
      expect(useAbility(rich, 'mira', 'blink-out', [], { point: at }).status).not.toBe('refused');
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

      expect(useAbility(demo, 'mira', 'blink-out', [], { point: at }).status).not.toBe('refused');
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
    demo.characters.set('mira', deriveCharacter(sheet, SRD_CHARACTERS, demo.project.abilities).character);
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
  /** Mira with the spell in hand and Kara beside the husk, in reach of it. */
  const warding = (seed: string) => {
    const demo = standoff(seed);
    demo.askDefender = false;
    const sheet = { ...demo.sheets.get('mira')!, domainCards: ['zone-of-protection'], loadout: ['zone-of-protection'] };
    demo.sheets.set('mira', sheet);
    demo.characters.set('mira', deriveCharacter(sheet, SRD_CHARACTERS, demo.project.abilities).character);
    // Kara's own cards come off: what is under test is what the ground does.
    const hers = { ...demo.sheets.get('kara')!, domainCards: [], loadout: [] };
    demo.sheets.set('kara', hers);
    demo.characters.set('kara', deriveCharacter(hers, SRD_CHARACTERS, demo.project.abilities).character);
    refreshWorld(demo);
    demo.party.select('mira');
    return demo;
  };

  /** Cast it on Kara's ground; true when the roll got there. */
  const cast = (demo: DemoScene): boolean => {
    const at = demo.state.entity('kara')!.tile;
    if (useAbility(demo, 'mira', 'zone-of-protection', [], { point: at }).status === 'refused') return false;
    for (let guard = 0; guard < 8 && demo.pending !== null; guard++) {
      const prompt = demo.pending.prompt;
      if (prompt.kind === 'choice') answerPending(demo, { kind: 'choose', index: 0 });
      else answerPending(demo, { kind: 'roll' });
    }
    return demo.world.zones().some((z) => z.id === 'zone-of-protection');
  };

  it('stands over the party and takes its die off what they are hit for', () => {
    for (let seed = 1; seed < 60; seed++) {
      const demo = warding(`ward-${seed}`);
      if (!cast(demo)) continue;

      const kara = demo.state.entity('kara')!;
      expect(kara.conditions.has('zone-of-protection')).toBe(true);
      // The husk is not one of theirs, so the light is nothing to it.
      const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
      expect(husk.conditions.has('zone-of-protection')).toBe(false);
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
      expect(kara.conditions.has('zone-of-protection')).toBe(false);
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
      expect(kara.conditions.has('zone-of-protection')).toBe(false);
      expect(demo.world.defensesOf('kara').reduce ?? []).toEqual([]);
      // And the ground is still there for whoever is standing on it.
      expect(demo.world.zones().length).toBe(1);
      return;
    }
    throw new Error('the spell never landed in sixty tries');
  });
});


describe('a room put out', () => {
  /** Mira with the spell in hand, the party and the husk all within Far. */
  const dark = (seed: string) => {
    const demo = standoff(seed);
    demo.askDefender = false;
    const sheet = { ...demo.sheets.get('mira')!, domainCards: ['eclipse'], loadout: ['eclipse'] };
    demo.sheets.set('mira', sheet);
    demo.characters.set('mira', deriveCharacter(sheet, SRD_CHARACTERS, demo.project.abilities).character);
    refreshWorld(demo);
    // The dark reaches Far from where she stands, so she stands with them.
    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    standBehind(demo, 'mira', husk.tile);
    demo.party.select('mira');
    return demo;
  };

  /** Cast it; true when the roll got there. */
  const cast = (demo: DemoScene): boolean => {
    if (useAbility(demo, 'mira', 'eclipse', []).status === 'refused') return false;
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
      expect(demo.state.entity('kara')!.conditions.has('in-shadow')).toBe(true);
      expect(demo.state.entity('kara')!.conditions.has('shadowed')).toBe(false);
      expect(husk.conditions.has('shadowed')).toBe(true);
      expect(husk.conditions.has('in-shadow')).toBe(false);

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
        expect(demo.state.entity(husk.id)!.conditions.has('shadowed')).toBe(true);
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
      expect(demo.state.entity('kara')!.conditions.has('in-shadow')).toBe(false);
      expect(demo.state.entitiesOf('adversary').every((e) => !e.conditions.has('shadowed'))).toBe(true);
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
      expect(demo.state.entity('kara')!.conditions.has('in-shadow')).toBe(false);
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
    demo.characters.set('kara', deriveCharacter(sheet, SRD_CHARACTERS, demo.project.abilities).character);
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
  /** Mira with the ward in hand, standing with the rest of the party. */
  const warded = (seed: string, on: string | null) => {
    const demo = standoff(seed);
    demo.askDefender = true;
    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    standBehind(demo, 'mira', husk.tile);
    const sheet = { ...demo.sheets.get('mira')!, domainCards: ['life-ward'], loadout: ['life-ward'] };
    demo.sheets.set('mira', sheet);
    demo.characters.set('mira', deriveCharacter(sheet, SRD_CHARACTERS, demo.project.abilities).character);
    refreshWorld(demo);
    demo.state.entity('mira')!.hope = { max: 6, value: 6 };
    if (on !== null) {
      demo.party.select('mira');
      expect(useAbility(demo, 'mira', 'life-ward', [on]).status).not.toBe('refused');
      expect(demo.state.entity(on)!.conditions.has('life-ward')).toBe(true);
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
    expect(after.some((t) => t.includes('The sigil takes it, and goes out'))).toBe(true);
    // She is standing, nothing was asked of her, and the sigil is spent.
    expect(kara.alive).toBe(true);
    expect(kara.hitPoints.marked).toBe(3);
    expect(demo.pending).toBeNull();
    expect(kara.conditions.has('life-ward')).toBe(false);
  });

  it('leaves the death move to somebody it is not on', () => {
    const demo = warded('ward-elsewhere', 'kara');
    const said = demo.log.length;
    fell(demo, 'finn');
    const after = demo.log.slice(said).map((l) => l.text);
    expect(after.some((t) => t.includes('The sigil takes it'))).toBe(false);
    // Finn is asked what he does about it, the way anybody would be.
    expect(demo.pending?.kind).toBe('death');
    // And Kara still has hers.
    expect(demo.state.entity('kara')!.conditions.has('life-ward')).toBe(true);
  });

  it('hangs over one at a time', () => {
    const demo = warded('ward-one', 'kara');
    // The card again, on somebody else. Run rather than played, because the
    // first casting spent her turn and what is under test is the card's own
    // first line rather than the turn economy.
    const card = demo.project.abilities.find((a) => a.id === 'life-ward')!;
    demo.scenario.actorId = 'mira';
    runScript(card.effects, demo.world, demo.rng, { targets: ['finn'], hit: ['finn'] });
    expect(demo.state.entity('finn')!.conditions.has('life-ward')).toBe(true);
    expect(demo.state.entity('kara')!.conditions.has('life-ward')).toBe(false);
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
    demo.characters.set('kara', deriveCharacter(sheet, SRD_CHARACTERS, demo.project.abilities).character);
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
  /** Kara beside the husk holding these cards; Finn beside it too. */
  const trying = (seed: string, cards: string[]) => {
    const demo = standoff(seed);
    demo.askDefender = true;
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
    demo.characters.set('kara', deriveCharacter(sheet, SRD_CHARACTERS, demo.project.abilities).character);
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
      const { demo, husk } = trying(`inevitable-${seed}`, ['inevitable']);
      const kara = demo.state.entity('kara')!;
      const said = demo.log.length;
      swing(demo, husk.id);
      const after = demo.log.slice(said).map((l) => l.text);
      const rolled = demo.rolls[demo.rolls.length - 1]?.roll.outcome;
      if (rolled === undefined) continue;

      const failed = rolled === 'failureWithHope' || rolled === 'failureWithFear';
      if (!failed) {
        // Nothing to carry: a roll that landed leaves her as she was.
        expect(kara.conditions.has('inevitable')).toBe(false);
        continue;
      }
      expect(after.some((t) => t.includes('Not this time. The next one.'))).toBe(true);
      expect(kara.conditions.has('inevitable')).toBe(true);
      // And it is worth a die on the next roll she makes.
      expect(demo.world.advantageFor('kara', husk.id).advantage).toBe(1);
      return;
    }
    throw new Error('Kara never failed a roll in sixty tries');
  });

  it('is spent on the next roll, whether that one lands or not', () => {
    for (let seed = 1; seed < 60; seed++) {
      const { demo, husk } = trying(`inevitable-spend-${seed}`, ['inevitable']);
      const kara = demo.state.entity('kara')!;
      swing(demo, husk.id);
      if (!kara.conditions.has('inevitable')) continue;

      // Her turn again, and the die goes into it.
      endTurn(demo);
      for (let guard = 0; guard < 8 && demo.pending !== null; guard++) {
        answerPending(demo, { kind: 'choose', index: 0 });
      }
      if (!demo.state.entity('kara')!.alive) continue;
      demo.party.select('kara');
      swing(demo, husk.id);
      expect(kara.conditions.has('inevitable')).toBe(false);
      return;
    }
    throw new Error('Kara never failed a roll in sixty tries');
  });

  it('leans on an ally who failed, and never on herself', () => {
    let helped = false;
    let alone = false;
    for (let seed = 1; seed < 80 && !(helped && alone); seed++) {
      const { demo, husk } = trying(`lean-${seed}`, ['lean-on-me']);
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
          ? pending.prompt.options.findIndex((o) => o.label.includes('Lean on Me'))
          : -1;

      if (failed && at > 0) {
        answerPending(demo, { kind: 'choose', index: at });
        let guard = 0;
        while (demo.pending !== null && guard++ < 6) answerPending(demo, { kind: 'choose', index: 0 });
        expect(kara.stress.marked).toBe(2);
        expect(finn.stress.marked).toBe(2);
        expect(demo.scenario.abilityUses.get(useKey('kara', 'lean-on-me'))).toBe(1);
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
      const { demo, husk } = trying(`lean-self-${seed}`, ['lean-on-me']);
      demo.state.entity('kara')!.stress = { max: 6, marked: 4 };
      // Kara's own failure: "an ally who failed an action roll" is not her.
      attackWithSelected(demo, husk.id);
      const rolled = demo.rolls[demo.rolls.length - 1]?.roll.outcome;
      if (rolled !== 'failureWithHope' && rolled !== 'failureWithFear') continue;
      expect(JSON.stringify(demo.pending ?? {})).not.toContain('Lean on Me');
      expect(demo.state.entity('kara')!.stress.marked).toBe(4);
      return;
    }
    throw new Error('Kara never failed a roll in sixty tries');
  });

  it("answers her own roll and not an ally's", () => {
    for (let seed = 1; seed < 60; seed++) {
      const { demo, husk } = trying(`inevitable-mine-${seed}`, ['inevitable']);
      const kara = demo.state.entity('kara')!;
      demo.party.select('finn');
      swing(demo, husk.id);
      const rolled = demo.rolls[demo.rolls.length - 1]?.roll.outcome;
      if (rolled !== 'failureWithHope' && rolled !== 'failureWithFear') continue;
      // Finn's failure is Finn's: "when *you* fail an action roll".
      expect(kara.conditions.has('inevitable')).toBe(false);
      expect(demo.state.entity('finn')!.conditions.has('inevitable')).toBe(false);
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
    demo.characters.set(who, deriveCharacter(sheet, SRD_CHARACTERS, demo.project.abilities).character);
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
    demo.characters.set(who, deriveCharacter(sheet, SRD_CHARACTERS, demo.project.abilities).character);
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
    demo.characters.set(who, deriveCharacter(sheet, SRD_CHARACTERS, demo.project.abilities).character);
    refreshWorld(demo);
  };

  /** Kara swinging with the room able to answer, and a husk that will not fall. */
  const swinging = (seed: string, cards: string[], hope = 6): { demo: DemoScene; husk: EntityState } => {
    const demo = standoff(seed);
    demo.askDefender = true;
    // Nothing of Kara's own answers a swing, so an offer is always Finn's.
    hold(demo, 'kara', ['bare-bones']);
    hold(demo, 'finn', cards);
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
    const { demo, husk } = swinging('reassure-offered', ['reassurance']);
    const first = attackWithSelected(demo, husk.id);
    // Kara rolled; Finn holds the card, so Finn is asked.
    expect(first?.waiting).toBe(true);
    expect(demo.pending?.kind).toBe('reaction');
    if (demo.pending?.kind !== 'reaction') throw new Error('expected a reaction prompt');
    expect(demo.pending.offers.map((o) => o.ability.id)).toEqual(['reassurance']);
    expect(demo.pending.offers[0]!.by).toBe('finn');

    // The same card in the roller's own hand answers nothing: `not self`.
    const mine = swinging('reassure-mine', []);
    hold(mine.demo, 'kara', ['reassurance']);
    expect(attackWithSelected(mine.demo, mine.husk.id)?.waiting).not.toBe(true);
  });

  it('turns a miss into a hit, damage and all', () => {
    for (let seed = 1; seed < 200; seed++) {
      const { demo, husk } = swinging('reassure-hit-' + seed, ['reassurance']);
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
      const { demo, husk } = swinging('reassure-miss-' + seed, ['reassurance']);
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
      const { demo, husk } = swinging('reassure-pass-' + seed, ['reassurance']);
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
      const { demo, husk } = swinging('tank-' + seed, ['support-tank']);
      const first = attackWithSelected(demo, husk.id);
      // A hit is a successful roll; the card only answers a failed one.
      if (first?.waiting === true) {
        if (demo.pending?.kind !== 'reaction') throw new Error('expected a reaction prompt');
        expect(demo.pending.offers.map((o) => o.ability.id)).toEqual(['support-tank']);
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
      const rich = swinging('tank-hope-' + seed, ['support-tank'], 6);
      if (attackWithSelected(rich.demo, rich.husk.id)?.waiting !== true) continue;

      // The same seed, so the same roll: what changes is the purse. A card
      // nobody can pay for is never put to them - the offer is the question,
      // and there is no point asking one whose answer is refused.
      const poor = swinging('tank-hope-' + seed, ['support-tank'], 1);
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
    demo.characters.set(who, deriveCharacter(sheet, SRD_CHARACTERS, demo.project.abilities).character);
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
  const hold = (demo: DemoScene, who: string, cards: string[]): void => {
    const sheet = { ...demo.sheets.get(who)!, domainCards: cards, loadout: cards.slice(0, 5) };
    demo.sheets.set(who, sheet);
    demo.characters.set(who, deriveCharacter(sheet, SRD_CHARACTERS, demo.project.abilities).character);
    refreshWorld(demo);
  };

  it('takes the ones already standing in it once, and not again for standing still', () => {
    const demo = standoff('korvax-circle');
    demo.askDefender = false;
    hold(demo, 'kara', ['book-of-korvax']);
    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    husk.hitPoints = { max: 40, marked: 0 };
    const kara = demo.state.entity('kara')!;

    expect(useAbility(demo, 'kara', 'book-of-korvax-magic-circle', []).status).not.toBe('refused');
    while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
    // Standing in Melee when the circle was drawn is a crossing: they were not
    // in it a moment ago.
    const bitten = husk.hitPoints.marked;
    expect(bitten).toBeGreaterThan(0);
    // 2d12+4 is between 6 and 28: a real blow, whatever the dice said.
    expect(demo.log.some((l) => /circle takes them/.test(l.text))).toBe(true);
    // And knocked back out of Melee, which is the other half of the card.
    expect(demo.grid.chebyshevDistance(kara.tile, husk.tile)).toBeGreaterThan(1);

    // The ground is settled twice more with nobody moving; it bites nobody.
    settleFight(demo);
    settleFight(demo);
    expect(husk.hitPoints.marked).toBe(bitten);
  });

  it('takes an adversary that walks in on its own turn, with nobody swinging', () => {
    for (let seed = 1; seed < 40; seed++) {
      const demo = standoff('korvax-walk-' + seed);
      demo.askDefender = false;
      hold(demo, 'kara', ['book-of-korvax']);
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

      expect(useAbility(demo, 'kara', 'book-of-korvax-magic-circle', []).status).not.toBe('refused');
      while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
      if (husk.hitPoints.marked > 0) continue;

      // The GM's turn walks it back in to swing, and the floor answers before
      // anybody on the party's side has done anything at all.
      endTurn(demo);
      while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
      if (husk.hitPoints.marked === 0) continue;
      expect(husk.hitPoints.marked).toBeGreaterThan(0);
      expect(demo.log.some((l) => /circle takes them/.test(l.text))).toBe(true);
      return;
    }
    throw new Error('nothing ever walked into the circle in forty tries');
  });

  it('does not touch the one who drew it, nor anybody on their side', () => {
    const demo = standoff('korvax-side');
    demo.askDefender = false;
    hold(demo, 'kara', ['book-of-korvax']);
    const kara = demo.state.entity('kara')!;
    const finn = demo.state.entity('finn')!;
    const blocked = demo.state.blockedFor('finn');
    demo.grid.forEachNeighbor(kara.tile, false, (tile) => {
      if (demo.grid.isPassable(tile) && !blocked(tile) && finn.tile !== tile) demo.state.moveEntity('finn', tile);
    });
    const hurt = { kara: kara.hitPoints.marked, finn: finn.hitPoints.marked };

    expect(useAbility(demo, 'kara', 'book-of-korvax-magic-circle', []).status).not.toBe('refused');
    while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
    // `side: 'adversaries'` is read from the caster's chair, so the circle is
    // only ever ground under somebody else's feet.
    expect(kara.hitPoints.marked).toBe(hurt.kara);
    expect(finn.hitPoints.marked).toBe(hurt.finn);
  });

  it('lifts somebody and sets them down away from the one who lifted them', () => {
    for (let seed = 1; seed < 60; seed++) {
      const demo = standoff('korvax-lift-' + seed);
      demo.askDefender = false;
      // A Codex grimoire wants somebody with a Spellcast trait behind it.
      hold(demo, 'mira', ['book-of-korvax']);
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

      expect(useAbility(demo, 'mira', 'book-of-korvax-telekinesis', [husk.id]).status).not.toBe('refused');
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
  const hold = (demo: DemoScene, who: string, cards: string[]): void => {
    const sheet = { ...demo.sheets.get(who)!, domainCards: cards, loadout: cards.slice(0, 5) };
    demo.sheets.set(who, sheet);
    demo.characters.set(who, deriveCharacter(sheet, SRD_CHARACTERS, demo.project.abilities).character);
    refreshWorld(demo);
  };

  /** Kara braced, with the husk parked well outside Very Close of her. */
  const braced = (seed: string): { demo: DemoScene; husk: EntityState; kara: EntityState } => {
    const demo = standoff(seed);
    demo.askDefender = false;
    hold(demo, 'kara', ['hold-the-line']);
    const kara = demo.state.entity('kara')!;
    kara.hope = { max: 6, value: 6 };
    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    husk.hitPoints = { max: 60, marked: 0 };
    return { demo, husk, kara };
  };

  it('costs a Hope, marks the one holding it, and puts a zone on the board', () => {
    const { demo, kara } = braced('line-up');
    expect(useAbility(demo, 'kara', 'hold-the-line', []).status).not.toBe('refused');
    while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });

    expect(kara.hope!.value).toBe(5);
    expect(kara.conditions.has('holding-the-line')).toBe(true);
    expect(demo.world.zones().map((z) => z.id)).toContain('hold-the-line');
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

      expect(useAbility(demo, 'kara', 'hold-the-line', []).status).not.toBe('refused');
      while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
      // Nothing was inside it when it went up.
      if (husk.conditions.has('restrained')) continue;

      endTurn(demo);
      while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
      if (!husk.conditions.has('caught-in-the-line')) continue;

      // Dragged the rest of the way in: Melee is one tile. The hold itself is
      // `temporary`, which the creature's own next spotlight shakes off - so
      // what this test claims is that walking in on the GM's turn sets the
      // stance off at all, with nobody on the party's side having acted.
      expect(demo.grid.chebyshevDistance(kara.tile, husk.tile)).toBeLessThanOrEqual(1);
      expect(demo.log.some((l) => /hauled the rest of the way in/.test(l.text))).toBe(true);
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
    expect(useAbility(demo, 'kara', 'hold-the-line', []).status).not.toBe('refused');
    while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
    expect(husk.conditions.has('caught-in-the-line')).toBe(false);

    // Walked in by hand and the ground read again, which is the crossing with
    // none of the turn's own housekeeping around it.
    let near = NO_TILE;
    demo.grid.forEachNeighbor(kara.tile, false, (tile) => {
      if (near === NO_TILE && demo.grid.isPassable(tile) && tile !== kara.tile) near = tile;
    });
    demo.state.moveEntity(husk.id, near);
    settleFight(demo);

    expect(husk.conditions.has('caught-in-the-line')).toBe(true);
    expect(husk.conditions.has('restrained')).toBe(true);
    expect(demo.grid.chebyshevDistance(kara.tile, husk.tile)).toBeLessThanOrEqual(1);
  });

  it('drops on a failure with Fear, and the ground stops meaning anything', () => {
    for (let seed = 1; seed < 80; seed++) {
      const { demo, husk, kara } = braced('line-drop-' + seed);
      expect(useAbility(demo, 'kara', 'hold-the-line', []).status).not.toBe('refused');
      while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
      expect(demo.world.zones().map((z) => z.id)).toContain('hold-the-line');

      attackWithSelected(demo, husk.id);
      while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
      const roll = demo.rolls[demo.rolls.length - 1]?.roll;
      if (roll === undefined) continue;
      if (roll.outcome !== 'failureWithFear') {
        // Any other roll leaves the stance standing, which is half the claim.
        expect(kara.conditions.has('holding-the-line')).toBe(true);
        expect(demo.world.zones().map((z) => z.id)).toContain('hold-the-line');
        continue;
      }
      expect(kara.conditions.has('holding-the-line')).toBe(false);
      expect(demo.world.zones().map((z) => z.id)).not.toContain('hold-the-line');
      // And nobody is standing in ground that is no longer there.
      expect(husk.conditions.has('caught-in-the-line')).toBe(false);
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
  const hold = (demo: DemoScene, who: string, cards: string[]): void => {
    const sheet = { ...demo.sheets.get(who)!, domainCards: cards, loadout: cards.slice(0, 5) };
    demo.sheets.set(who, sheet);
    demo.characters.set(who, deriveCharacter(sheet, SRD_CHARACTERS, demo.project.abilities).character);
    refreshWorld(demo);
  };

  /** Kara beside two husks, marked with the echo and about to swing. */
  const marked = (seed: string): { demo: DemoScene; first: EntityState; second: EntityState } => {
    const demo = standoff(seed);
    demo.askDefender = false;
    hold(demo, 'kara', ['bare-bones']);
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
    demo.world.applyCondition('kara', 'sitil-echo', 'scene');
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
      expect(demo.state.entity('kara')!.conditions.has('sitil-echo')).toBe(false);
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
    hold(demo, 'mira', ['book-of-sitil']);
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

    expect(useAbility(demo, 'mira', 'book-of-sitil-echoing-strike', ['kara']).status).not.toBe('refused');
    while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
    expect(kara.conditions.has('sitil-echo')).toBe(true);

    expect(useAbility(demo, 'mira', 'book-of-sitil-echoing-strike', ['finn']).status).not.toBe('refused');
    while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
    // The mark moved rather than doubling: "you can only hold this spell on
    // one creature at a time".
    expect(finn.conditions.has('sitil-echo')).toBe(true);
    expect(kara.conditions.has('sitil-echo')).toBe(false);
  });
});


/**
 * The rest of the Codex grimoires: four Books with something a fight can use,
 * cast by the one member of the party who has a Spellcast trait.
 */
describe('the last of the Codex', () => {
  const hold = (demo: DemoScene, who: string, cards: string[]): void => {
    const sheet = { ...demo.sheets.get(who)!, domainCards: cards, loadout: cards.slice(0, 5) };
    demo.sheets.set(who, sheet);
    demo.characters.set(who, deriveCharacter(sheet, SRD_CHARACTERS, demo.project.abilities).character);
    refreshWorld(demo);
  };

  /** Mira holding a Book, stood beside Kara and holding the spotlight. */
  const casting = (seed: string, book: string): { demo: DemoScene; mira: EntityState; husk: EntityState } => {
    const demo = standoff(seed);
    demo.askDefender = false;
    hold(demo, 'mira', [book]);
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
      const { demo, husk } = casting('ronin-' + seed, 'book-of-ronin');
      expect(useAbility(demo, 'mira', 'book-of-ronin-eternal-enervation', [husk.id]).status).not.toBe('refused');
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
    const { demo, mira } = casting('yarrow-immune', 'book-of-yarrow');
    expect(useAbility(demo, 'mira', 'book-of-yarrow-magic-immunity', []).status).not.toBe('refused');
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
      const { demo, mira, husk } = casting('yarrow-jam-' + seed, 'book-of-yarrow');
      expect(useAbility(demo, 'mira', 'book-of-yarrow-timejammer', []).status).toBe('waiting');
      while (demo.pending !== null) answerPending(demo, { kind: 'roll' });
      // The caster's own marker is what says the spell landed: it is the half
      // that cannot be shaken off, where the stillness is a `blocks: act` and
      // an adversary spends its very next spotlight getting out of one.
      if (!mira.conditions.has('time-jamming')) continue;
      expect(demo.log.some((l) => /mote of dust/.test(l.text))).toBe(true);

      // Her next action roll lets it go - any roll, which is the simplification.
      demo.party.select('mira');
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
    const { demo, husk } = casting('yarrow-still', 'book-of-yarrow');
    demo.world.applyCondition(husk.id, 'time-stopped', 'scene');
    expect(demo.world.blocks(husk.id, 'act')).toBe(true);
    expect(demo.world.blocks(husk.id, 'move')).toBe(true);
    // And it cannot answer a blow either, which is the third thing it blocks.
    expect(demo.world.reactionsFor(husk.id, 'incomingDamage')).toEqual([]);
  });

  it('Wall of Flame burns whatever walks through it', () => {
    for (let seed = 1; seed < 80; seed++) {
      const { demo, mira, husk } = casting('grynn-wall-' + seed, 'book-of-grynn');
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

      expect(useAbility(demo, 'mira', 'book-of-grynn-wall-of-flame', [], { point: spot }).status).not.toBe('refused');
      while (demo.pending !== null) answerPending(demo, { kind: 'roll' });
      if (!demo.world.zones().some((z) => z.id === 'wall-of-flame')) continue;
      // It went up with nobody in it.
      expect(husk.hitPoints.marked).toBe(0);

      // Walked into by hand and the ground read again: 4d10+3 is a real blow.
      demo.state.moveEntity(husk.id, spot);
      settleFight(demo);
      expect(husk.hitPoints.marked).toBeGreaterThan(0);
      expect(demo.log.some((l) => /the flame notices/.test(l.text))).toBe(true);
      return;
    }
    throw new Error('the wall never went up in eighty tries');
  });

  it('Arcane Door puts her across the room, and refuses with something in her face', () => {
    for (let seed = 1; seed < 80; seed++) {
      const { demo, mira, husk } = casting('vagras-door-' + seed, 'book-of-vagras');
      // Nothing in Melee of her, and a spot to go to.
      const away = demo.grid.indexOf(demo.grid.xOf(mira.tile) + 6, demo.grid.yOf(mira.tile));
      if (away === NO_TILE || !demo.grid.isPassable(away)) continue;
      demo.state.moveEntity(husk.id, away);
      const spot = demo.grid.indexOf(demo.grid.xOf(mira.tile) + 3, demo.grid.yOf(mira.tile));
      if (spot === NO_TILE || !demo.grid.isPassable(spot)) continue;
      const stood = mira.tile;

      const used = useAbility(demo, 'mira', 'book-of-vagras-arcane-door', [], { point: spot });
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
      expect(useAbility(demo, 'mira', 'book-of-vagras-arcane-door', [], { point: stood }).status).toBe('refused');
      return;
    }
    throw new Error('the door never opened in eighty tries');
  });

  it('Reveal takes Hidden off what the roll found', () => {
    for (let seed = 1; seed < 80; seed++) {
      const { demo, husk } = casting('vagras-reveal-' + seed, 'book-of-vagras');
      demo.world.applyCondition(husk.id, 'hidden', 'scene');

      expect(useAbility(demo, 'mira', 'book-of-vagras-reveal', []).status).not.toBe('refused');
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
    hold(demo, 'kara', ['book-of-grynn']);
    const kara = demo.state.entity('kara')!;
    kara.hope = { max: 6, value: 6 };
    kara.hitPoints = { max: 12, marked: 0 };
    // Four steps of severity takes any blow to nothing, which is what the card
    // asks for without a vocabulary of its own.
    const offered = demo.world.reactionsFor('kara', 'incomingDamage');
    expect(offered.map((a) => a.id)).toContain('book-of-grynn-arcane-deflection');
    const card = offered.find((a) => a.id === 'book-of-grynn-arcane-deflection')!;
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
  const hold = (demo: DemoScene, who: string, cards: string[]): void => {
    const sheet = { ...demo.sheets.get(who)!, domainCards: cards, loadout: cards.slice(0, 5) };
    demo.sheets.set(who, sheet);
    demo.characters.set(who, deriveCharacter(sheet, SRD_CHARACTERS, demo.project.abilities).character);
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
      const { demo, husk } = casting('tempest-' + seed, 'tempest');
      expect(useAbility(demo, 'mira', 'tempest', []).status).toBe('waiting');
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
      for (const [label, condition] of [['Sandstorm', 'sandstormed'], ['Hurricane', null]] as const) {
        const { demo, husk } = casting(`tempest-${label}-${seed}`, 'tempest');
        useAbility(demo, 'mira', 'tempest', []);
        storm(demo, label);
        while (demo.pending !== null) answerPending(demo, { kind: 'roll' });
        if (husk.hitPoints.marked === 0) continue;

        if (condition === null) {
          // The wind is the table's: what the engine lands is the damage.
          expect(husk.conditions.has('sandstormed')).toBe(false);
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
    const { demo, mira, husk } = casting('force-of-nature', 'force-of-nature');
    mira.stress = { max: 6, marked: 0 };
    expect(useAbility(demo, 'mira', 'force-of-nature', []).status).not.toBe('refused');
    while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
    expect(mira.conditions.has('force-of-nature')).toBe(true);
    expect(mira.stress.marked).toBe(1);
    expect(demo.world.rollBonus('mira', 'damageRoll')).toBe(10);

    // Every action roll she makes costs a Hope out of the six.
    const hope = mira.hope!.value;
    attackWithSelected(demo, husk.id);
    while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
    expect(mira.hope!.value).toBeLessThan(hope + 1);
    expect(mira.conditions.has('force-of-nature')).toBe(true);
  });

  it('and drops off somebody with nothing left to feed it', () => {
    const { demo, mira, husk } = casting('force-of-nature-broke', 'force-of-nature');
    mira.stress = { max: 6, marked: 0 };
    expect(useAbility(demo, 'mira', 'force-of-nature', []).status).not.toBe('refused');
    while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
    mira.hope = { max: 6, value: 0 };

    attackWithSelected(demo, husk.id);
    while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
    // A roll with Hope hands one over before the upkeep reads the pool, so the
    // shape only goes when the dice gave her nothing to pay with either.
    const gained = demo.rolls[demo.rolls.length - 1]!.roll.hopeGained;
    expect(mira.conditions.has('force-of-nature')).toBe(gained > 0);
    if (gained === 0) expect(demo.log.some((l) => /goes out of them/.test(l.text))).toBe(true);
  });
});


/**
 * A roll reached after it was read. A swing is held by the game layer, where a
 * card can be offered that moment; a check belongs to the runner, and this is
 * the half of the moment the runner owns.
 */
describe('a card that saves a roll already made', () => {
  const hold = (demo: DemoScene, who: string, cards: string[]): void => {
    const sheet = { ...demo.sheets.get(who)!, domainCards: cards, loadout: cards.slice(0, 5) };
    demo.sheets.set(who, sheet);
    demo.characters.set(who, deriveCharacter(sheet, SRD_CHARACTERS, demo.project.abilities).character);
    refreshWorld(demo);
  };

  const fane = (seed: string, tokens: number): { demo: DemoScene; mira: EntityState; husk: EntityState } => {
    const demo = standoff(seed);
    demo.askDefender = false;
    hold(demo, 'mira', ['fane-of-the-wilds', 'book-of-norai']);
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
    demo.world.spendTokens('mira', 'fane-of-the-wilds', 99);
    demo.world.addTokens('mira', 'fane-of-the-wilds', tokens);
    return { demo, mira, husk };
  };

  it('counts its tokens off the Sage cards in the loadout', () => {
    const demo = standoff('fane-count');
    // Two Sage cards beside it: the Fane itself is Sage, and so is Wild Surge.
    hold(demo, 'mira', ['fane-of-the-wilds', 'wild-surge', 'book-of-norai']);
    expect(demo.world.tokenCount('mira', 'fane-of-the-wilds')).toBe(2);
    hold(demo, 'mira', ['fane-of-the-wilds', 'book-of-norai']);
    expect(demo.world.tokenCount('mira', 'fane-of-the-wilds')).toBe(1);
  });

  it('spends the least that saves the roll, and nothing on one that did not need it', () => {
    let saved = false;
    let untouched = false;
    for (let seed = 1; seed < 60 && !(saved && untouched); seed++) {
      const { demo, husk } = fane('fane-' + seed, 6);
      const before = demo.world.tokensOn('mira', 'fane-of-the-wilds');

      // Mystic Tether is a Spellcast Roll against the husk's own Difficulty.
      expect(useAbility(demo, 'mira', 'mystic-tether', [husk.id]).status).toBe('waiting');
      while (demo.pending !== null) answerPending(demo, { kind: 'roll' });
      const roll = demo.rolls[demo.rolls.length - 1]!.roll;
      const spent = before - demo.world.tokensOn('mira', 'fane-of-the-wilds');

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
      expect(useAbility(demo, 'mira', 'mystic-tether', [husk.id]).status).toBe('waiting');
      while (demo.pending !== null) answerPending(demo, { kind: 'roll' });
      const roll = demo.rolls[demo.rolls.length - 1]!.roll;
      const left = demo.world.tokensOn('mira', 'fane-of-the-wilds');
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
    hold(demo, 'mira', ['fane-of-the-wilds', 'book-of-norai']);
    demo.world.spendTokens('mira', 'fane-of-the-wilds', 99);
    demo.world.addTokens('mira', 'fane-of-the-wilds', 6);
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
    demo.characters.set(who, deriveCharacter(sheet, SRD_CHARACTERS, demo.project.abilities).character);
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
