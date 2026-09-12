import { describe, it, expect } from 'vitest';
import { demoMap } from '../../legacy/js/data.js';
import { deriveCharacter } from '../engine/character/sheet';
import { NO_TILE } from '../engine/grid/grid';
import { rest, useAbility } from './demo-abilities';
import {
  characterContentFor,
  answerPending,
  attackWithSelected,
  buildDemoScene,
  endTurn,
  refreshWorld,
  startEncounter,
  travelTo,
  type DemoScene,
  type PendingDefense,
} from './demo-scene';
import { PIT_SCENE_ID } from './demo-scenes';
import { abilitySchema } from '../engine/content/abilities';
import {
  FIXTURE_CARDS,
  FIXTURE_RIFT_CARD,
  FIXTURE_RIFT_MARK,
  FIXTURE_SPOT_CARD,
  FIXTURE_SPOT_MARK,
} from '../../tests/fixtures/adversaries';
import { A_RIFT_THAT_OPENS, A_STEP_BACK_TO_A_MARK } from '../../tests/fixtures/cards';
import { loadGameText, saveGame } from './save';
import type { EntityState } from '../engine/scene/state';

/**
 * Cards that remember a place.
 *
 * Rift Walker and Phantom Retreat both mark the ground under the caster and
 * come back to it later. The mark is a tile kept under the caster's name in
 * the campaign's variables - so a save carries it - and it is forgotten by a
 * rest and by leaving the room, a tile meaning nothing in another one.
 */

const scene = (seed: string): DemoScene => buildDemoScene(demoMap(), seed);

/**
 * The cards these tests play, carried into the project once.
 *
 * Guarded: both hand helpers call it, and pushing the pool twice would leave duplicate
 * ability ids, where a card offered twice fires twice.
 */
function carry(demo: DemoScene): void {
  if (demo.project.domainCards.some((c) => c.id === FIXTURE_SPOT_CARD)) return;
  demo.project.domainCards.push(...FIXTURE_CARDS);
  for (const ability of [...A_STEP_BACK_TO_A_MARK, ...A_RIFT_THAT_OPENS]) {
    demo.project.abilities.push(abilitySchema.parse(ability));
  }
}

/** Mira holding these cards, with Hope to spend, out of combat. */
function holding(seed: string, cards: string[]): DemoScene {
  const demo = scene(seed);
  demo.askDefender = false;
  carry(demo);
  const sheet = { ...demo.sheets.get('mira')!, domainCards: cards, loadout: cards.slice(0, 5) };
  demo.sheets.set('mira', sheet);
  demo.characters.set('mira', deriveCharacter(sheet, characterContentFor(demo.project), demo.project.abilities).character);
  refreshWorld(demo);
  demo.state.entity('mira')!.hope = { max: 6, value: 6 };
  demo.party.select('mira');
  return demo;
}

/** A passable tile a few steps from where somebody stands, to walk them to. */
function elsewhere(demo: DemoScene, from: number): number {
  for (let step = 3; step > 0; step--) {
    for (const [dx, dy] of [
      [step, 0],
      [-step, 0],
      [0, step],
      [0, -step],
    ] as const) {
      const tile = demo.grid.indexOf(demo.grid.xOf(from) + dx, demo.grid.yOf(from) + dy);
      if (tile !== NO_TILE && demo.grid.isPassable(tile) && demo.state.occupantsOf(tile).length === 0) return tile;
    }
  }
  throw new Error('nowhere to walk to');
}

describe('Phantom Retreat', () => {
  it('marks the ground for a Hope, and comes back to it for another', () => {
    const demo = holding('phantom', [FIXTURE_SPOT_CARD]);
    const mira = demo.state.entity('mira')!;
    const stood = mira.tile;

    expect(useAbility(demo, 'mira', 'fixture-phantom-step', []).status).toBe('done');
    expect(demo.world.marks()).toEqual([{ mark: FIXTURE_SPOT_MARK, owner: 'mira', tile: stood }]);
    expect(mira.hope!.value).toBe(5);
    expect(demo.log.at(-1)?.text).toBe('Mira marks the ground where they stand.');

    const away = elsewhere(demo, stood);
    demo.state.moveEntity('mira', away);
    expect(useAbility(demo, 'mira', 'fixture-phantom-step', []).status).toBe('done');
    expect(mira.tile).toBe(stood);
    expect(mira.hope!.value).toBe(4);
    // The spell ends after they reappear: nothing marked, so the next cast marks again.
    expect(demo.world.marks()).toEqual([]);
    expect(demo.log.some((l) => /where they were/.test(l.text))).toBe(true);
  });

  it('comes back to a mark from across the room, and beside it when somebody is standing on it', () => {
    const demo = holding('phantom-far', [FIXTURE_SPOT_CARD]);
    const mira = demo.state.entity('mira')!;
    const stood = mira.tile;
    useAbility(demo, 'mira', 'fixture-phantom-step', []);
    // Kara on the mark, Mira far away.
    demo.state.moveEntity('kara', stood);
    const far = demo.grid.indexOf(demo.grid.width - 2, demo.grid.height - 2);
    demo.state.moveEntity('mira', demo.grid.isPassable(far) ? far : elsewhere(demo, stood));
    useAbility(demo, 'mira', 'fixture-phantom-step', []);
    expect(demo.grid.chebyshevDistance(mira.tile, stood)).toBe(1);
  });

  it('is forgotten by a rest, and by leaving the room', () => {
    const rested = holding('phantom-rest', [FIXTURE_SPOT_CARD]);
    useAbility(rested, 'mira', 'fixture-phantom-step', []);
    expect(rested.world.marks()).toHaveLength(1);
    expect(rest(rested, 'short', { moves: {} }).ok).toBe(true);
    expect(rested.world.marks()).toEqual([]);

    const left = holding('phantom-travel', [FIXTURE_SPOT_CARD]);
    useAbility(left, 'mira', 'fixture-phantom-step', []);
    expect(travelTo(left, PIT_SCENE_ID)).toBe(true);
    expect(left.world.marks()).toEqual([]);
  });

  it('is carried by a save', () => {
    const demo = holding('phantom-save', [FIXTURE_SPOT_CARD]);
    useAbility(demo, 'mira', 'fixture-phantom-step', []);
    const marked = demo.world.marks();
    const fresh = holding('phantom-save-fresh', [FIXTURE_SPOT_CARD]);
    expect(loadGameText(fresh, JSON.stringify(saveGame(demo))).ok).toBe(true);
    expect(fresh.world.marks()).toEqual(marked);
  });
});

describe('Rift Walker', () => {
  it('marks on a success, and the next success offers the way back', () => {
    for (let seed = 1; seed < 80; seed++) {
      const demo = holding('rift-' + seed, [FIXTURE_RIFT_CARD]);
      const mira = demo.state.entity('mira')!;
      const stood = mira.tile;

      expect(useAbility(demo, 'mira', 'fixture-rift-step', []).status).toBe('waiting');
      answerPending(demo, { kind: 'roll' });
      if (demo.world.marks().length === 0) continue; // the roll failed: nothing marked, nothing offered
      expect(demo.world.marks()).toEqual([{ mark: FIXTURE_RIFT_MARK, owner: 'mira', tile: stood }]);

      demo.state.moveEntity('mira', elsewhere(demo, stood));
      expect(useAbility(demo, 'mira', 'fixture-rift-step', []).status).toBe('waiting');
      answerPending(demo, { kind: 'roll' });
      if (demo.pending === null) continue; // failed again: the mark stands, nobody moved
      // The success put the choice: through the rift, or a new mark here.
      expect(demo.pending.kind).toBe('script');
      answerPending(demo, { kind: 'choose', index: 0 });
      expect(mira.tile).toBe(stood);
      expect(demo.world.marks()).toEqual([]);
      expect(demo.log.some((l) => /walk back through it/.test(l.text))).toBe(true);
      return;
    }
    throw new Error('Rift Walker never succeeded twice in eighty tries');
  });

  it('can drop the mark and lay it where they stand instead', () => {
    for (let seed = 1; seed < 80; seed++) {
      const demo = holding('rift-drop-' + seed, [FIXTURE_RIFT_CARD]);
      const mira = demo.state.entity('mira')!;
      const stood = mira.tile;
      useAbility(demo, 'mira', 'fixture-rift-step', []);
      answerPending(demo, { kind: 'roll' });
      if (demo.world.marks().length === 0) continue;
      const here = elsewhere(demo, stood);
      demo.state.moveEntity('mira', here);
      useAbility(demo, 'mira', 'fixture-rift-step', []);
      answerPending(demo, { kind: 'roll' });
      if (demo.pending === null) continue;
      answerPending(demo, { kind: 'choose', index: 1 });
      expect(mira.tile).toBe(here);
      expect(demo.world.marks()).toEqual([{ mark: FIXTURE_RIFT_MARK, owner: 'mira', tile: here }]);
      return;
    }
    throw new Error('Rift Walker never succeeded twice in eighty tries');
  });
});

/**
 * Cards that put a trait behind a roll.
 *
 * Bold Presence, Codex-Touched and Sage-Touched are offered once the dice are
 * down and the roll has come up short, and the price - a Hope, a Stress, the
 * once-per-rest - buys the trait added to the total. The faces stand: a roll
 * with Fear stays one; only whether it succeeds can change.
 */

/** Kara holding these cards, in a fight, beside a husk to roll against. */
function karaHolding(seed: string, cards: string[]): { demo: DemoScene; kara: EntityState; husk: EntityState } {
  const demo = scene(seed);
  demo.askDefender = true;
  carry(demo);
  const sheet = { ...demo.sheets.get('kara')!, domainCards: cards, loadout: cards.slice(0, 5) };
  demo.sheets.set('kara', sheet);
  demo.characters.set('kara', deriveCharacter(sheet, characterContentFor(demo.project), demo.project.abilities).character);
  refreshWorld(demo);
  const kara = demo.state.entity('kara')!;
  kara.hope = { max: 6, value: 6 };
  const husk = demo.state
    .entitiesOf('adversary')
    .filter((e) => e.alive)
    .sort((a, b) => demo.grid.manhattanDistance(kara.tile, a.tile) - demo.grid.manhattanDistance(kara.tile, b.tile))[0]!;
  const blocked = demo.state.blockedFor('kara');
  let stand = NO_TILE;
  demo.grid.forEachNeighbor(husk.tile, false, (tile) => {
    if (stand === NO_TILE && demo.grid.isPassable(tile) && !blocked(tile)) stand = tile;
  });
  demo.state.moveEntity('kara', stand);
  demo.party.select('kara');
  startEncounter(demo, demo.scene.encounters[0]!.id);
  return { demo, kara, husk };
}

/** Whether a card is on offer right now. */
function offered(demo: DemoScene, id: string): boolean {
  const pending = demo.pending;
  return pending?.kind === 'reaction' && pending.offers.some((o) => o.ability.id === id);
}

describe('Bold Presence', () => {
  it('is offered on a failed Presence Roll, and a Hope puts Strength behind it', () => {
    for (let seed = 1; seed < 120; seed++) {
      const { demo, kara, husk } = karaHolding('bold-' + seed, ['bold-presence', 'troublemaker']);
      const strength = demo.characters.get('kara')!.sheet.traits.strength;
      expect(useAbility(demo, 'kara', 'troublemaker', [husk.id]).status).toBe('waiting');
      answerPending(demo, { kind: 'roll' });
      if (demo.pending?.kind !== 'reaction') continue;

      expect(demo.pending.offers.map((o) => o.ability.id)).toEqual(['bold-presence']);
      const thrown = demo.pending.offers[0]!.swing!;
      expect(thrown.success).toBe(false);

      answerPending(demo, { kind: 'choose', index: 1 });
      while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });

      const settled = demo.rolls[demo.rolls.length - 1]!.roll;
      expect(settled.total).toBe(thrown.total + strength);
      // The dice did not move; only the number behind them did.
      expect({ hope: settled.hope, fear: settled.fear }).toEqual({ hope: thrown.hope, fear: thrown.fear });
      // A Hope for the card, and whatever the roll itself handed over (a failure with Hope is still a roll with Hope).
      expect(kara.hope!.value).toBe(6 - 1 + settled.hopeGained);
      expect(demo.log.some((l) => /shoulders into it/.test(l.text))).toBe(true);
      return;
    }
    throw new Error('Bold Presence was never offered in a hundred and twenty tries');
  });

  it('is not offered on a roll made with another trait, nor on a success', () => {
    let successes = 0;
    for (let seed = 1; seed < 60; seed++) {
      // Know Thy Enemy rolls Instinct: never a Presence Roll, whatever the dice.
      const { demo, husk } = karaHolding('bold-other-' + seed, ['bold-presence', 'know-thy-enemy']);
      expect(useAbility(demo, 'kara', 'know-thy-enemy', [husk.id]).status).toBe('waiting');
      answerPending(demo, { kind: 'roll' });
      expect(offered(demo, 'bold-presence')).toBe(false);
      while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
      if (demo.rolls[demo.rolls.length - 1]!.roll.success) successes++;
    }
    expect(successes).toBeGreaterThan(0);
  });
});

describe('a weapon swing', () => {
  it('is a roll with the weapon\'s trait: Sage-Touched answers Finn\'s Agility shot', () => {
    const sage = ['sage-touched', 'gifted-tracker', 'natures-tongue', 'natural-familiar'];
    for (let seed = 1; seed < 120; seed++) {
      const { demo, husk } = karaHolding('swing-' + seed, []);
      const sheet = { ...demo.sheets.get('finn')!, domainCards: sage, loadout: sage };
      demo.sheets.set('finn', sheet);
      demo.characters.set('finn', deriveCharacter(sheet, characterContentFor(demo.project), demo.project.abilities).character);
      refreshWorld(demo);
      const finn = demo.state.entity('finn')!;
      const agility = demo.characters.get('finn')!.sheet.traits.agility;
      // Finn beside the husk with his shortbow, and the fight is his to act in.
      const blocked = demo.state.blockedFor('finn');
      demo.grid.forEachNeighbor(husk.tile, false, (tile) => {
        if (demo.grid.isPassable(tile) && !blocked(tile)) demo.state.moveEntity('finn', tile);
      });
      demo.party.select('finn');
      attackWithSelected(demo, husk.id);
      if (!offered(demo, 'sage-touched')) {
        while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
        continue;
      }
      const pending = demo.pending;
      if (pending?.kind !== 'reaction') continue;
      const thrown = pending.offers[0]!.swing!;
      expect(thrown.success).toBe(false);
      answerPending(demo, { kind: 'choose', index: 1 });
      while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
      const settled = demo.rolls[demo.rolls.length - 1]!.roll;
      expect(settled.total).toBe(thrown.total + agility);
      expect(finn.alive).toBe(true);
      return;
    }
    throw new Error('Sage-Touched never answered a shot in a hundred and twenty tries');
  });
});

describe('Codex-Touched', () => {
  it('puts Proficiency behind a failed Spellcast Roll for a Stress, with four Codex cards held', () => {
    const codex = ['codex-touched', 'book-of-ava', 'book-of-illiat', 'book-of-tyfar', 'rift-walker'];
    for (let seed = 1; seed < 120; seed++) {
      const demo = holding('codex-' + seed, codex);
      const mira = demo.state.entity('mira')!;
      demo.askDefender = true;
      const proficiency = demo.characters.get('mira')!.proficiency;
      expect(useAbility(demo, 'mira', 'fixture-rift-step', []).status).toBe('waiting');
      answerPending(demo, { kind: 'roll' });
      if (demo.pending?.kind !== 'reaction') continue;

      expect(demo.pending.offers.map((o) => o.ability.id)).toEqual(['codex-touched']);
      const thrown = demo.pending.offers[0]!.swing!;
      answerPending(demo, { kind: 'choose', index: 1 });
      while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });

      const settled = demo.rolls[demo.rolls.length - 1]!.roll;
      expect(settled.total).toBe(thrown.total + proficiency);
      expect(mira.stress.marked).toBe(1);
      // And if the raise carried it over, the spell went off: a mark on the ground.
      expect(demo.world.marks().length).toBe(settled.success ? 1 : 0);
      return;
    }
    throw new Error('Codex-Touched was never offered in a hundred and twenty tries');
  });

  it('is not offered with three Codex cards in the loadout', () => {
    for (let seed = 1; seed < 40; seed++) {
      const demo = holding('codex-few-' + seed, ['codex-touched', 'book-of-ava', 'rift-walker', 'phantom-retreat']);
      demo.askDefender = true;
      useAbility(demo, 'mira', 'fixture-rift-step', []);
      answerPending(demo, { kind: 'roll' });
      expect(demo.pending?.kind === 'reaction').toBe(false);
      while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
    }
  });
});

describe('Sage-Touched', () => {
  it('doubles Instinct on a failed Instinct Roll, once per rest', () => {
    const sage = ['sage-touched', 'gifted-tracker', 'natures-tongue', 'natural-familiar', 'know-thy-enemy'];
    for (let seed = 1; seed < 120; seed++) {
      const { demo, husk } = karaHolding('sage-' + seed, sage);
      // Know Thy Enemy is a Bone card: four Sage cards remain in the loadout of five.
      const instinct = demo.characters.get('kara')!.sheet.traits.instinct;
      expect(useAbility(demo, 'kara', 'know-thy-enemy', [husk.id]).status).toBe('waiting');
      answerPending(demo, { kind: 'roll' });
      if (demo.pending?.kind !== 'reaction') continue;
      expect(demo.pending.offers.map((o) => o.ability.id)).toEqual(['sage-touched']);
      const thrown = demo.pending.offers[0]!.swing!;
      answerPending(demo, { kind: 'choose', index: 1 });
      while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
      const settled = demo.rolls[demo.rolls.length - 1]!.roll;
      expect(settled.total).toBe(thrown.total + instinct);

      // Spent for the rest: a second failure is not offered it.
      for (let again = 1; again < 60; again++) {
        demo.scenario.abilityUses.delete([...demo.scenario.abilityUses.keys()].find((k) => k.endsWith('/know-thy-enemy')) ?? '');
        useAbility(demo, 'kara', 'know-thy-enemy', [husk.id]);
        answerPending(demo, { kind: 'roll' });
        expect(offered(demo, 'sage-touched')).toBe(false);
        while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
      }
      return;
    }
    throw new Error('Sage-Touched was never offered in a hundred and twenty tries');
  });
});

/**
 * Cards that answer a blow with dice or a price.
 *
 * Confusing Aura keeps its layers as tokens and throws a d6 per layer at a
 * blow that has landed; Bone-Touched spends three Hope to make one miss. Both
 * are script defences, offered beside the plans when the husk's swing lands.
 */

/** Mira holding these cards beside the husk, the others down so the husk swings at her. */
function miraFacing(seed: string, cards: string[]): { demo: DemoScene; mira: EntityState; husk: EntityState } {
  const demo = holding(seed, cards);
  demo.askDefender = true;
  const mira = demo.state.entity('mira')!;
  const husk = demo.state
    .entitiesOf('adversary')
    .filter((e) => e.alive)
    .sort((a, b) => demo.grid.manhattanDistance(mira.tile, a.tile) - demo.grid.manhattanDistance(mira.tile, b.tile))[0]!;
  const blocked = demo.state.blockedFor('mira');
  let stand = NO_TILE;
  demo.grid.forEachNeighbor(husk.tile, false, (tile) => {
    if (stand === NO_TILE && demo.grid.isPassable(tile) && !blocked(tile)) stand = tile;
  });
  demo.state.moveEntity('mira', stand);
  for (const member of demo.state.entitiesOf('party')) {
    if (member.id === 'mira') continue;
    member.hitPoints = { ...member.hitPoints, marked: member.hitPoints.max };
    member.alive = false;
  }
  startEncounter(demo, demo.scene.encounters[0]!.id);
  for (const e of demo.state.entitiesOf('adversary')) {
    if (e.id !== husk.id) {
      e.hitPoints = { ...e.hitPoints, marked: e.hitPoints.max };
      e.alive = false;
    }
  }
  return { demo, mira, husk };
}

/** Let the room swing until a defence prompt offers a script card, healing the defender between swings. */
function untilScriptChoice(demo: DemoScene, who: string, limit = 60): PendingDefense | null {
  for (let i = 0; i < limit; i++) {
    const member = demo.state.entity(who)!;
    member.hitPoints = { ...member.hitPoints, marked: 0 };
    member.stress = { ...member.stress, marked: 0 };
    member.alive = true;
    if (member.hope !== undefined) member.hope = { max: member.hope.max, value: member.hope.max };
    endTurn(demo);
    while (demo.pending !== null) {
      const waiting = demo.pending;
      if (waiting.kind === 'defense' && waiting.choices.some((c) => c.kind === 'script')) return waiting;
      answerPending(demo, { kind: 'choose', index: 0 });
    }
    if (demo.encounter?.outcome !== 'ongoing') return null;
  }
  return null;
}

describe('Confusing Aura', () => {
  it('lays layers as tokens, one plus the Stress paid, once per long rest', () => {
    for (let seed = 1; seed < 120; seed++) {
      const demo = holding('aura-' + seed, ['confusing-aura']);
      const mira = demo.state.entity('mira')!;
      expect(useAbility(demo, 'mira', 'confusing-aura', []).status).toBe('waiting');
      answerPending(demo, { kind: 'roll' });
      if (demo.pending === null) continue; // the roll failed: no layer, no question
      // How many more: two Stress for two more layers.
      expect(demo.pending.kind).toBe('script');
      answerPending(demo, { kind: 'choose', index: 2 });
      while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
      expect(demo.world.tokensOn('mira', 'confusing-aura')).toBe(3);
      expect(mira.stress.marked).toBe(2);
      expect(useAbility(demo, 'mira', 'confusing-aura', []).status).toBe('refused');
      return;
    }
    throw new Error('the aura never went up in a hundred and twenty tries');
  });

  it('throws a d6 per layer at a blow that landed: a five turns it aside and costs a layer, nothing does and the aura ends', () => {
    let turned = 0;
    let broke = 0;
    for (let seed = 1; seed < 40 && (turned === 0 || broke === 0); seed++) {
      const { demo, mira } = miraFacing('aura-blow-' + seed, ['confusing-aura']);
      demo.world.addTokens('mira', 'confusing-aura', 2);
      const asked = untilScriptChoice(demo, 'mira');
      if (asked === null) continue;
      const index = asked.choices.findIndex((c) => c.kind === 'script');
      expect(asked.choices[index]!.label).toContain('Confusing Aura');
      const said = demo.log.length;
      answerPending(demo, { kind: 'choose', index });
      while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
      const after = demo.log.slice(said).map((l) => l.text);
      if (after.some((t) => t.includes('never there'))) {
        turned++;
        expect(after.some((t) => t.includes('finds nothing where Mira was'))).toBe(true);
        expect(demo.world.tokensOn('mira', 'confusing-aura')).toBe(1);
      } else {
        broke++;
        expect(after.some((t) => t.includes('The aura is gone'))).toBe(true);
        expect(demo.world.tokensOn('mira', 'confusing-aura')).toBe(0);
        expect(mira.hitPoints.marked).toBeGreaterThan(0);
      }
    }
    expect(turned).toBeGreaterThan(0);
    expect(broke).toBeGreaterThan(0);
  });
});

describe('Bone-Touched', () => {
  it('makes a blow that landed miss for three Hope, once per rest, with four Bone cards held', () => {
    const bone = ['bone-touched', 'deft-maneuvers', 'i-see-it-coming', 'untouchable', 'ferocity'];
    for (let seed = 1; seed < 40; seed++) {
      const { demo, mira } = miraFacing('bone-' + seed, bone);
      const asked = untilScriptChoice(demo, 'mira');
      if (asked === null) continue;
      const index = asked.choices.findIndex((c) => c.kind === 'script' && c.label.includes('Bone-Touched'));
      expect(index).toBeGreaterThanOrEqual(0);
      const said = demo.log.length;
      answerPending(demo, { kind: 'choose', index });
      const after = demo.log.slice(said).map((l) => l.text);
      expect(after.some((t) => t.includes('finds nothing where Mira was'))).toBe(true);
      expect(mira.hope!.value).toBe(3);
      expect(mira.hitPoints.marked).toBe(0);
      while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });

      // Spent for the rest: the next blow is not offered it.
      const again = untilScriptChoice(demo, 'mira');
      expect(again === null || !again.choices.some((c) => c.label.includes('Bone-Touched'))).toBe(true);
      return;
    }
    throw new Error('the husk never landed a blow on Mira in forty tries');
  });

  it('is not offered with three Bone cards', () => {
    const { demo } = miraFacing('bone-few', ['bone-touched', 'deft-maneuvers', 'i-see-it-coming', 'rift-walker']);
    const asked = untilScriptChoice(demo, 'mira');
    expect(asked).toBeNull();
  });
});
