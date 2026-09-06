import { describe, it, expect } from 'vitest';
import { demoMap } from '../../legacy/js/data.js';
import { deriveCharacter } from '../engine/character/sheet';
import { runScript } from '../engine/script/runner';
import { rest, useAbility } from './demo-abilities';
import { NO_TILE } from '../engine/grid/grid';
import {
  SRD_CHARACTERS,
  answerPending,
  buildDemoScene,
  endTurn,
  refreshWorld,
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

/** Play GM turns until the husk's blow actually lands on someone. */
function untilAsked(demo: DemoScene, limit = 30): boolean {
  for (let i = 0; i < limit; i++) {
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
    const blocked = demo.state.blockedFor('finn');
    let beside = NO_TILE;
    demo.grid.forEachNeighbor(demo.state.entity('kara')!.tile, false, (tile) => {
      if (beside === NO_TILE && demo.grid.isPassable(tile) && !blocked(tile)) beside = tile;
    });
    demo.state.moveEntity('finn', beside);

    expect(untilAsked(demo)).toBe(true);
    const pending = demo.pending!;
    if (pending.kind !== 'defense') throw new Error('expected a defence');
    const shield = pending.choices.findIndex((c) => c.kind === 'redirect');
    expect(shield).toBeGreaterThan(-1);
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
    const blockedForMira = demo.state.blockedFor('mira');
    let watching = NO_TILE;
    demo.grid.forEachNeighbor(demo.state.entity('kara')!.tile, false, (tile) => {
      if (watching === NO_TILE && demo.grid.isPassable(tile) && !blockedForMira(tile)) watching = tile;
    });
    demo.state.moveEntity('mira', watching);

    expect(untilAsked(demo)).toBe(true);
    const pending = demo.pending!;
    if (pending.kind !== 'defense') throw new Error('expected a defence');
    const reroll = pending.choices.findIndex((c) => c.kind === 'reroll');
    expect(reroll).toBeGreaterThan(-1);
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
