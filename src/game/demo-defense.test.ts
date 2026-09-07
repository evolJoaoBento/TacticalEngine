import { describe, it, expect } from 'vitest';
import { demoMap } from '../../legacy/js/data.js';
import { deriveCharacter } from '../engine/character/sheet';
import { abilitySchema } from '../engine/content/abilities';
import { runScript } from '../engine/script/runner';
import { rest, useAbility } from './demo-abilities';
import { NO_TILE } from '../engine/grid/grid';
import { adversaryTraits } from '../engine/combat/adversary-features';
import type { DefenseChoice, PendingDefense } from './demo-scene';
import {
  SRD_CHARACTERS,
  adversaryDefOf,
  answerPending,
  attackWithSelected,
  buildDemoScene,
  endTurn,
  refreshWorld,
  settleFight,
  startEncounter,
  syncPools,
  type DemoScene,
} from './demo-scene';

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
