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
import { createRng } from '../engine/core/rng';
import { migrateDocument } from '../engine/scene/migrate';
import { projectSchema, type ProjectDoc } from '../engine/scene/schema';
import { buildProjectScene } from './demo-scene';
import { LocalGame } from './client';
import { act, answerFor } from '../../tests/fixtures/random-play';
import { replicaCount, Shadow } from './shadow';
import { shippedContent } from './shipped';
import { WasmEngine } from './wasm-engine';
import { barWorkshop } from '../../tests/fixtures/bar-workshop';

const here = dirname(fileURLToPath(import.meta.url));
const WASM = resolve(here, '../../public/wasm/engine.wasm');
const built = existsSync(WASM);

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
