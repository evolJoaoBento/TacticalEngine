import { describe, it, expect } from 'vitest';
import { demoMap } from '../../legacy/js/data.js';
import { deriveCharacter } from '../engine/character/sheet';
import { NO_TILE } from '../engine/grid/grid';
import { rest, useAbility } from './demo-abilities';
import { SRD_CHARACTERS, answerPending, buildDemoScene, refreshWorld, startEncounter, travelTo, type DemoScene } from './demo-scene';
import { PIT_SCENE_ID } from './demo-scenes';
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

/** Mira holding these cards, with Hope to spend, out of combat. */
function holding(seed: string, cards: string[]): DemoScene {
  const demo = scene(seed);
  demo.askDefender = false;
  const sheet = { ...demo.sheets.get('mira')!, domainCards: cards, loadout: cards.slice(0, 5) };
  demo.sheets.set('mira', sheet);
  demo.characters.set('mira', deriveCharacter(sheet, SRD_CHARACTERS, demo.project.abilities).character);
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
    const demo = holding('phantom', ['phantom-retreat']);
    const mira = demo.state.entity('mira')!;
    const stood = mira.tile;

    expect(useAbility(demo, 'mira', 'phantom-retreat', []).status).toBe('done');
    expect(demo.world.marks()).toEqual([{ mark: 'phantom', owner: 'mira', tile: stood }]);
    expect(mira.hope!.value).toBe(5);
    expect(demo.log.at(-1)?.text).toBe('Mira marks the ground where they stand.');

    const away = elsewhere(demo, stood);
    demo.state.moveEntity('mira', away);
    expect(useAbility(demo, 'mira', 'phantom-retreat', []).status).toBe('done');
    expect(mira.tile).toBe(stood);
    expect(mira.hope!.value).toBe(4);
    // The spell ends after they reappear: nothing marked, so the next cast marks again.
    expect(demo.world.marks()).toEqual([]);
    expect(demo.log.some((l) => /where they were/.test(l.text))).toBe(true);
  });

  it('comes back to a mark from across the room, and beside it when somebody is standing on it', () => {
    const demo = holding('phantom-far', ['phantom-retreat']);
    const mira = demo.state.entity('mira')!;
    const stood = mira.tile;
    useAbility(demo, 'mira', 'phantom-retreat', []);
    // Kara on the mark, Mira far away.
    demo.state.moveEntity('kara', stood);
    const far = demo.grid.indexOf(demo.grid.width - 2, demo.grid.height - 2);
    demo.state.moveEntity('mira', demo.grid.isPassable(far) ? far : elsewhere(demo, stood));
    useAbility(demo, 'mira', 'phantom-retreat', []);
    expect(demo.grid.chebyshevDistance(mira.tile, stood)).toBe(1);
  });

  it('is forgotten by a rest, and by leaving the room', () => {
    const rested = holding('phantom-rest', ['phantom-retreat']);
    useAbility(rested, 'mira', 'phantom-retreat', []);
    expect(rested.world.marks()).toHaveLength(1);
    expect(rest(rested, 'short', { moves: {} }).ok).toBe(true);
    expect(rested.world.marks()).toEqual([]);

    const left = holding('phantom-travel', ['phantom-retreat']);
    useAbility(left, 'mira', 'phantom-retreat', []);
    expect(travelTo(left, PIT_SCENE_ID)).toBe(true);
    expect(left.world.marks()).toEqual([]);
  });

  it('is carried by a save', () => {
    const demo = holding('phantom-save', ['phantom-retreat']);
    useAbility(demo, 'mira', 'phantom-retreat', []);
    const marked = demo.world.marks();
    const fresh = holding('phantom-save-fresh', ['phantom-retreat']);
    expect(loadGameText(fresh, JSON.stringify(saveGame(demo))).ok).toBe(true);
    expect(fresh.world.marks()).toEqual(marked);
  });
});

describe('Rift Walker', () => {
  it('marks on a success, and the next success offers the way back', () => {
    for (let seed = 1; seed < 80; seed++) {
      const demo = holding('rift-' + seed, ['rift-walker']);
      const mira = demo.state.entity('mira')!;
      const stood = mira.tile;

      expect(useAbility(demo, 'mira', 'rift-walker', []).status).toBe('waiting');
      answerPending(demo, { kind: 'roll' });
      if (demo.world.marks().length === 0) continue; // the roll failed: nothing marked, nothing offered
      expect(demo.world.marks()).toEqual([{ mark: 'rift', owner: 'mira', tile: stood }]);

      demo.state.moveEntity('mira', elsewhere(demo, stood));
      expect(useAbility(demo, 'mira', 'rift-walker', []).status).toBe('waiting');
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
      const demo = holding('rift-drop-' + seed, ['rift-walker']);
      const mira = demo.state.entity('mira')!;
      const stood = mira.tile;
      useAbility(demo, 'mira', 'rift-walker', []);
      answerPending(demo, { kind: 'roll' });
      if (demo.world.marks().length === 0) continue;
      const here = elsewhere(demo, stood);
      demo.state.moveEntity('mira', here);
      useAbility(demo, 'mira', 'rift-walker', []);
      answerPending(demo, { kind: 'roll' });
      if (demo.pending === null) continue;
      answerPending(demo, { kind: 'choose', index: 1 });
      expect(mira.tile).toBe(here);
      expect(demo.world.marks()).toEqual([{ mark: 'rift', owner: 'mira', tile: here }]);
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
  const sheet = { ...demo.sheets.get('kara')!, domainCards: cards, loadout: cards.slice(0, 5) };
  demo.sheets.set('kara', sheet);
  demo.characters.set('kara', deriveCharacter(sheet, SRD_CHARACTERS, demo.project.abilities).character);
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

describe('Codex-Touched', () => {
  it('puts Proficiency behind a failed Spellcast Roll for a Stress, with four Codex cards held', () => {
    const codex = ['codex-touched', 'book-of-ava', 'book-of-illiat', 'book-of-tyfar', 'rift-walker'];
    for (let seed = 1; seed < 120; seed++) {
      const demo = holding('codex-' + seed, codex);
      const mira = demo.state.entity('mira')!;
      demo.askDefender = true;
      const proficiency = demo.characters.get('mira')!.proficiency;
      expect(useAbility(demo, 'mira', 'rift-walker', []).status).toBe('waiting');
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
      useAbility(demo, 'mira', 'rift-walker', []);
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
