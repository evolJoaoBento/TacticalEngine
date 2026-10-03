/**
 * A board stood back up (`restoreFromBoard`): the page's game told how the game stands by the engine that
 * plays it. A game played at random, and at every step where nothing waits - no question, no conversation set
 * aside, which a board cannot give back - a fresh game, built from the same project, stood where that game's
 * board says, must then say the game stands exactly the same: the same proof the Rust's restore was given.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRng, type Rng } from '../engine/core/rng';
import { NO_TILE } from '../engine/grid/grid';
import { migrateDocument } from '../engine/scene/migrate';
import { interactablesOf } from '../engine/scene/prop-functions';
import { projectSchema, type ProjectDoc } from '../engine/scene/schema';
import { buildProjectScene, type DemoScene } from './demo-scene';
import { boardOf, restoreFromBoard } from './board';
import { LocalGame } from './client';
import { firstDifference } from './shadow';
import { talkingAside } from './talks';
import { barWorkshop } from '../../tests/fixtures/bar-workshop';

const here = dirname(fileURLToPath(import.meta.url));
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** One intent, as the dice fall; a question is answered as it comes. */
function act(game: LocalGame, demo: DemoScene, g: Rng): void {
  if (demo.pending !== null) {
    const p = demo.pending;
    const prompt = p.kind === 'script' ? (p.dialogue?.prompt ?? p.prompt) : p.prompt;
    if (p.kind === 'script' && p.dialogue?.view !== null && p.dialogue?.view !== undefined && p.dialogue.prompt === null) {
      const enabled = p.dialogue.view.options.filter((o) => o.enabled);
      game.answerPending(enabled.length === 0 ? { kind: 'continue' } : { kind: 'choose', index: g.pick(enabled).index });
    } else if (prompt.kind === 'check') game.answerPending({ kind: 'roll' });
    else if (prompt.kind === 'choice') game.answerPending({ kind: 'choose', index: g.pick(prompt.options).index });
    else game.answerPending({ kind: prompt.kind === 'rolled' ? 'answered' : 'continue' });
    return;
  }
  const selected = demo.party.selected;
  const at = selected === null ? NO_TILE : (demo.state.entity(selected)?.tile ?? NO_TILE);
  const near = (): number => (at === NO_TILE ? g.nextInt(demo.grid.size) : demo.grid.indexOf(Math.min(demo.grid.width - 1, Math.max(0, demo.grid.xOf(at) + g.nextInt(13) - 6)), Math.min(demo.grid.height - 1, Math.max(0, demo.grid.yOf(at) + g.nextInt(13) - 6))));
  const kind = g.pick(['move', 'move', 'attack', 'endTurn', 'select', 'use', 'use', 'thing', 'arrive', 'arrived', 'party', 'fight', 'hands'] as const);
  if (kind === 'move') game.moveSelectedTo(near());
  else if (kind === 'attack') {
    const foes = demo.state.entitiesOf('adversary').filter((e) => e.alive).map((e) => e.id);
    if (foes.length > 0) game.attackWithSelected(g.pick(foes));
  } else if (kind === 'endTurn') game.endTurn();
  else if (kind === 'select') {
    game.selectNext();
    game.syncTalks();
  } else if (kind === 'use' && selected !== null) {
    const mine = game.abilitiesOf(selected).filter((a) => a.kind === 'action');
    if (mine.length === 0) return;
    const ability = g.pick(mine);
    const tiles = game.pointTiles(selected, ability);
    if (tiles.length > 0) game.useAbility(selected, ability.id, [], { point: g.pick(tiles) });
    else {
      const valid = game.abilityTargets(selected, ability);
      game.useAbility(selected, ability.id, valid.length === 0 ? [] : [g.pick(valid)]);
    }
  } else if (kind === 'thing') {
    const things = interactablesOf(demo.scene).map((t) => t.id);
    if (things.length > 0) game.approachThenUse(g.pick(things));
  } else if (kind === 'arrive') game.arrive();
  else if (kind === 'arrived') game.arrived();
  else if (kind === 'party') {
    const members = demo.party.members();
    if (members.length > 1) game.dropCard(g.pick(members), { kind: 'onto', id: g.pick(members) });
  } else if (kind === 'fight') {
    const fights = demo.scene.encounters.filter((e) => e.adversaries.length > 0 && e.adversaries.every((a) => a.interaction === undefined)).map((e) => e.id);
    if (fights.length > 0) game.startEncounter(g.pick(fights));
  } else if (kind === 'hands') game.wound(g.pick(demo.party.members()), 1 + g.nextInt(3));
}

describe('a board stood back up', () => {
  it('stands a fresh game exactly where the board says, step after step', () => {
    const fallback = projectSchema.parse(migrateDocument(JSON.parse(readFileSync(resolve(here, '../../projects/default.json'), 'utf8'))));
    const projects: [string, ProjectDoc][] = [['default', fallback], ['the workshop', barWorkshop(fallback)]];
    const g = createRng('board');
    let restored = 0;
    let fighting = 0;
    for (const [name, project] of projects) {
      for (let s = 0; s < 3; s++) {
        const demo = buildProjectScene(projectSchema.parse(clone(project)), `board:${name}:${s}`);
        const game = new LocalGame(demo);
        for (let n = 0; n < 50; n++) {
          act(game, demo, g);
          if (demo.pending !== null || talkingAside(demo).length > 0) continue;
          const board = clone(boardOf(demo));
          const fresh = buildProjectScene(projectSchema.parse(clone(project)), `board:fresh:${name}:${s}:${n}`);
          fresh.askDefender = true;
          fresh.animated = true;
          restoreFromBoard(fresh, board);
          const parted = firstDifference(boardOf(fresh), board, 'board');
          expect(parted, `${name} ${s}, step ${n}: ${JSON.stringify(parted)?.slice(0, 600)}`).toBeNull();
          restored++;
          if (board.replica.encounter !== null) fighting++;
        }
      }
    }
    expect(restored).toBeGreaterThan(200);
    expect(fighting).toBeGreaterThan(50);
  }, 300_000);
});

describe('a board filled into the page\'s game', () => {
  const project = (): ProjectDoc => projectSchema.parse(migrateDocument(JSON.parse(readFileSync(resolve(here, '../../projects/default.json'), 'utf8'))));

  it('keeps the ground the page holds in the same room, and enters another room afresh', () => {
    const demo = buildProjectScene(project(), 'fill-ground');
    // The editor changes the ground under the game in place (`takeGround`): the page's grid is the one to keep.
    const ground = demo.grid;
    const state = demo.state;
    restoreFromBoard(demo, JSON.parse(JSON.stringify(boardOf(demo))));
    expect(demo.grid).toBe(ground);
    expect(demo.state).toBe(state);
    // Another room on the board: entered as it was left, on that room's own ground.
    const elsewhere = buildProjectScene(project(), 'fill-elsewhere');
    const other = elsewhere.project.scenes.find((s) => s.id !== elsewhere.scene.id)!.id;
    new LocalGame(elsewhere, false).travelTo(other);
    restoreFromBoard(demo, JSON.parse(JSON.stringify(boardOf(elsewhere))));
    expect(demo.scene.id).toBe(other);
    expect(demo.grid).not.toBe(ground);
    expect(firstDifference(boardOf(demo), boardOf(elsewhere), 'board')).toBeNull();
  });

  it('takes the pools as the board has them, not derived again', () => {
    const demo = buildProjectScene(project(), 'fill-pools');
    const board = JSON.parse(JSON.stringify(boardOf(demo))) as ReturnType<typeof boardOf>;
    const kara = (board.replica.state.entities as Record<string, { armorSlots: { max: number; marked: number } }>)['kara']!;
    // An armour score the game whose board it is gave Kara - a card of the project's, say - that the page's
    // own rules would not.
    kara.armorSlots = { max: kara.armorSlots.max + 2, marked: 1 };
    restoreFromBoard(demo, board);
    expect(demo.state.entity('kara')!.armorSlots).toEqual(kara.armorSlots);
  });
});
