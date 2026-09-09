import { describe, it, expect } from 'vitest';
import { demoMap } from '../../legacy/js/data.js';
import { deriveCharacter } from '../engine/character/sheet';
import { NO_TILE } from '../engine/grid/grid';
import { rest, useAbility } from './demo-abilities';
import { SRD_CHARACTERS, answerPending, buildDemoScene, refreshWorld, travelTo, type DemoScene } from './demo-scene';
import { PIT_SCENE_ID } from './demo-scenes';
import { loadGameText, saveGame } from './save';

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
