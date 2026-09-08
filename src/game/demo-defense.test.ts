import { describe, it, expect } from 'vitest';
import { demoMap } from '../../legacy/js/data.js';
import { deriveCharacter } from '../engine/character/sheet';
import { abilitySchema, loadoutOf } from '../engine/content/abilities';
import { runScript } from '../engine/script/runner';
import { formatDice } from '../engine/rules/dice';
import type { Rng } from '../engine/core/rng';
import { rest, useAbility } from './demo-abilities';
import { NO_TILE } from '../engine/grid/grid';
import { adversaryTraits } from '../engine/combat/adversary-features';
import type { DefenseChoice, HeldSwing, PendingDeath, PendingDefense } from './demo-scene';
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
import { useKey } from '../engine/script/world';

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
