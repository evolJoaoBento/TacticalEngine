/**
 * A game played at random through the page's seam (`GameClient`): walks, swings, the GM's turn, cards - the
 * project's own code now and then on purpose - things used, answers, the party linked and set aside, the test
 * driver's hands, fights begun, the view's queues drained. For the tests that hold two games to each other
 * while one is played (`src/game/mirror.test.ts`, `src/game/wasm-game.test.ts`).
 */

import type { Rng } from '../../src/engine/core/rng';
import { NO_TILE } from '../../src/engine/grid/grid';
import { interactablesOf } from '../../src/engine/scene/prop-functions';
import type { Response } from '../../src/engine/script/runner';
import type { DemoScene } from '../../src/game/demo-scene';
import type { LocalGame } from '../../src/game/client';

export function answerFor(demo: DemoScene, g: Rng): Response {
  const p = demo.pending;
  if (p === null) return { kind: 'continue' };
  if (p.kind !== 'script') {
    const options = p.prompt.kind === 'choice' ? p.prompt.options : [];
    return options.length === 0 ? { kind: 'continue' } : { kind: 'choose', index: g.pick(options).index };
  }
  const d = p.dialogue;
  if (d !== null && d.view !== null && d.prompt === null) {
    const enabled = d.view.options.filter((o) => o.enabled);
    return enabled.length === 0 ? { kind: 'continue' } : { kind: 'choose', index: g.pick(enabled).index };
  }
  const prompt = d === null ? p.prompt : d.prompt;
  if (prompt === null) return { kind: 'continue' };
  if (prompt.kind === 'check') return { kind: 'roll' };
  if (prompt.kind === 'choice') return { kind: 'choose', index: g.pick(prompt.options).index };
  if (prompt.kind === 'rolled') return { kind: 'answered' };
  return { kind: 'continue' };
}

/** One intent, as the dice fall, given through the page's seam. */
export function act(game: LocalGame, demo: DemoScene, g: Rng): void {
  if (demo.pending !== null) {
    game.answerPending(answerFor(demo, g));
    return;
  }
  const selected = demo.party.selected;
  const members = demo.party.members();
  const near = (): number => {
    const at = selected === null ? NO_TILE : (demo.state.entity(selected)?.tile ?? NO_TILE);
    if (at === NO_TILE) return g.nextInt(demo.grid.size);
    return demo.grid.indexOf(Math.min(demo.grid.width - 1, Math.max(0, demo.grid.xOf(at) + g.nextInt(13) - 6)), Math.min(demo.grid.height - 1, Math.max(0, demo.grid.yOf(at) + g.nextInt(13) - 6)));
  };
  const kind = g.pick(['move', 'move', 'move', 'attack', 'endTurn', 'select', 'use', 'use', 'use', 'thing', 'arrive', 'arrived', 'party', 'hands', 'fight', 'drain'] as const);
  switch (kind) {
    case 'move':
      game.moveSelectedTo(near());
      return;
    case 'attack': {
      const foes = demo.state.entitiesOf('adversary').filter((e) => e.alive).map((e) => e.id);
      if (foes.length > 0) game.attackWithSelected(g.pick(foes));
      return;
    }
    case 'endTurn':
      game.endTurn();
      return;
    case 'select':
      game.selectNext();
      game.syncTalks();
      return;
    case 'use': {
      if (selected === null) return;
      const mine = game.abilitiesOf(selected).filter((a) => a.kind === 'action');
      if (mine.length === 0) return;
      // The project's own code now and then on purpose: the cards that run it.
      const coded = mine.filter((a) => a.effects.some((e) => e.kind === 'run'));
      const ability = coded.length > 0 && g.nextInt(3) === 0 ? g.pick(coded) : g.pick(mine);
      const tiles = game.pointTiles(selected, ability);
      if (tiles.length > 0) {
        game.useAbility(selected, ability.id, [], { point: g.pick(tiles) });
        return;
      }
      const valid = game.abilityTargets(selected, ability);
      game.useAbility(selected, ability.id, valid.length === 0 ? [] : [g.pick(valid)]);
      return;
    }
    case 'thing': {
      const things = interactablesOf(demo.scene).map((t) => t.id);
      if (things.length > 0) game.approachThenUse(g.pick(things));
      return;
    }
    case 'arrive':
      game.arrive();
      return;
    case 'arrived':
      game.arrived();
      return;
    case 'party': {
      if (members.length < 2) return;
      const [a, b] = g.shuffle([...members]) as [string, string];
      if (g.nextInt(2) === 0) game.dropCard(a, { kind: 'onto', id: b });
      else game.unlink(a);
      return;
    }
    case 'hands': {
      const who = g.pick(members);
      const pick = g.nextInt(4);
      if (pick === 0) game.wound(who, 1 + g.nextInt(3));
      else if (pick === 1) game.setGood(who, g.nextInt(4));
      else if (pick === 2) game.setCondition(who, 'vulnerable', g.nextInt(2) === 0);
      else game.giveItem('gold', 1 + g.nextInt(5));
      return;
    }
    case 'fight': {
      const fights = demo.scene.encounters.filter((e) => e.adversaries.length > 0 && e.adversaries.every((a) => a.interaction === undefined)).map((e) => e.id);
      if (fights.length > 0) game.startEncounter(g.pick(fights));
      return;
    }
    case 'drain':
      game.takeMotions();
      game.takeFloaters();
      game.clearRolls();
      return;
  }
}
