/**
 * The game played in step (`shadow.ts`'s `mirror`, slice 3b): the page's game played at random through
 * `LocalGame` - walks, swings, the GM's turn, cards (the project's own code among them: Mark the Page, Rally
 * the Line), things used, answers, the party linked and set aside, the test driver's hands - with the very
 * engine the page loads playing every intent beside it, and the two held to each other after each one.
 * Needs `npm run wasm`, and says so without it.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRng, type Rng } from '../engine/core/rng';
import { NO_TILE } from '../engine/grid/grid';
import { migrateDocument } from '../engine/scene/migrate';
import { interactablesOf } from '../engine/scene/prop-functions';
import { projectSchema, type ProjectDoc } from '../engine/scene/schema';
import type { Response } from '../engine/script/runner';
import { buildProjectScene, type DemoScene } from './demo-scene';
import { LocalGame } from './client';
import { replicaCount, Shadow } from './shadow';
import { shippedContent } from './shipped';
import { WasmEngine } from './wasm-engine';
import { barWorkshop } from '../../tests/fixtures/bar-workshop';

const here = dirname(fileURLToPath(import.meta.url));
const WASM = resolve(here, '../../public/wasm/engine.wasm');
const built = existsSync(WASM);

function answerFor(demo: DemoScene, g: Rng): Response {
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
function act(game: LocalGame, demo: DemoScene, g: Rng): void {
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

describe('the game played in step', () => {
  if (!built) console.warn(`${WASM} is not built: \`npm run wasm\` builds it, and these are skipped until it is`);

  it.skipIf(!built)('plays every intent as the page\'s game plays it, the project\'s code and all', async () => {
    const bytes = readFileSync(WASM);
    const fallback = projectSchema.parse(migrateDocument(JSON.parse(readFileSync(resolve(here, '../../projects/default.json'), 'utf8'))));
    const projects: [string, ProjectDoc][] = [['default', fallback], ['the workshop', barWorkshop(fallback)]];
    const g = createRng('mirror');
    const before = replicaCount();
    const said = new Set<string>();
    for (const [name, project] of projects) {
      for (let s = 0; s < 3; s++) {
        const demo = buildProjectScene(projectSchema.parse(JSON.parse(JSON.stringify(project))), `mirror:${name}:${s}`);
        const game = new LocalGame(demo);
        game.shadowWith(new Shadow(await WasmEngine.load(bytes), demo, shippedContent(), await WasmEngine.load(bytes)));
        // Each member's cards that run the project's code, used once each - Mark the Page twice, to come back.
        for (const member of demo.party.members()) {
          game.select(member);
          for (const ability of game.abilitiesOf(member).filter((a) => a.effects.some((e) => e.kind === 'run'))) {
            game.useAbility(member, ability.id);
            game.useAbility(member, ability.id);
            for (let k = 0; k < 4 && demo.pending !== null; k++) game.answerPending(answerFor(demo, g));
          }
        }
        // And each card aimed at the ground, on a tile it may land on.
        for (const member of demo.party.members()) {
          game.select(member);
          for (const ability of game.abilitiesOf(member).filter((a) => a.target.kind === 'point')) {
            const tiles = game.pointTiles(member, ability);
            if (tiles.length > 0) game.useAbility(member, ability.id, [], { point: g.pick(tiles) });
            for (let k = 0; k < 4 && demo.pending !== null; k++) game.answerPending(answerFor(demo, g));
          }
        }
        for (let n = 0; n < 60; n++) act(game, demo, g);
        for (const line of demo.log) said.add(line.text);
      }
    }
    const after = replicaCount();
    const partings = after.first.slice(before.first.length);
    expect(partings, JSON.stringify(partings.slice(0, 3), null, 1)).toEqual([]);
    expect(after.asked - before.asked).toBeGreaterThan(200);
    // The project's own code ran, in the page's JavaScript for the engine as in the game's own: both its cards.
    const hooked = ['The place is kept.', 'Back to the place that was kept.', 'Nobody stands close enough to rally.', 'The line steadies.'].filter((line) => said.has(line));
    expect(hooked.length, `the hooks' own lines: ${hooked.join(' / ')}`).toBeGreaterThanOrEqual(2);
  }, 300_000);
});
