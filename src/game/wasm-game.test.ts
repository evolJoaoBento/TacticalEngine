/**
 * The page playing the Rust engine (`wasm-game.ts`): the default project and the bar's workshop played at
 * random through `WasmGame`, the very `.wasm` the page loads answering every intent and the page's own game
 * played beside it, held to it - the project's own cards and those aimed at the ground on purpose. Needs
 * `npm run wasm`, and says so without it.
 */

import { describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRng } from '../engine/core/rng';
import { migrateDocument } from '../engine/scene/migrate';
import { projectSchema, type ProjectDoc } from '../engine/scene/schema';
import type { BoardSnapshot } from './board';
import { buildProjectScene } from './demo-scene';
import { LocalGame } from './client';
import { replicaCount, Shadow } from './shadow';
import { shippedContent } from './shipped';
import { WasmEngine } from './wasm-engine';
import { WasmGame, engineChosen } from './wasm-game';
import { act, answerFor } from '../../tests/fixtures/random-play';
import { barWorkshop } from '../../tests/fixtures/bar-workshop';

const here = dirname(fileURLToPath(import.meta.url));
const WASM = resolve(here, '../../public/wasm/engine.wasm');
const built = existsSync(WASM);

describe('which game the page plays', () => {
  it("is the engine's - always in a build, and in development unless the page's own is asked for", () => {
    expect(engineChosen(false)).toBe('wasm');
    expect(engineChosen(true)).toBe('wasm');
    vi.stubGlobal('location', { search: '?play&engine=ts' });
    try {
      expect(engineChosen(true)).toBe('ts');
      // A build has no page's own game to ask for: the oracle is development's.
      expect(engineChosen(false)).toBe('wasm');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('the page playing the engine', () => {
  if (!built) console.warn(`${WASM} is not built: \`npm run wasm\` builds it, and these are skipped until it is`);

  it.skipIf(!built)('plays every intent in the engine, the page\'s own game beside it and in step', async () => {
    const bytes = readFileSync(WASM);
    const fallback = projectSchema.parse(migrateDocument(JSON.parse(readFileSync(resolve(here, '../../projects/default.json'), 'utf8'))));
    const projects: [string, ProjectDoc][] = [['default', fallback], ['the workshop', barWorkshop(fallback)]];
    const g = createRng('wasm-game');
    const before = replicaCount();
    const said = new Set<string>();
    for (const [name, project] of projects) {
      for (let s = 0; s < 3; s++) {
        const demo = buildProjectScene(projectSchema.parse(JSON.parse(JSON.stringify(project))), `wasm-game:${name}:${s}`);
        const engine = await WasmEngine.load(bytes);
        const game = new WasmGame(demo, engine, shippedContent());
        for (const member of demo.party.members()) {
          game.select(member);
          for (const ability of game.abilitiesOf(member).filter((a) => a.effects.some((e) => e.kind === 'run') || a.target.kind === 'point')) {
            const tiles = game.pointTiles(member, ability);
            game.useAbility(member, ability.id, [], tiles.length > 0 ? { point: g.pick(tiles) } : undefined);
            game.useAbility(member, ability.id);
            for (let k = 0; k < 4 && demo.pending !== null; k++) game.answerPending(answerFor(demo, g));
          }
        }
        for (let n = 0; n < 60; n++) act(game, demo, g);
        // What the engine wrote, read off its own board: it is the one that played.
        for (const line of (engine.board() as BoardSnapshot).log) said.add(line.text);
      }
    }
    const after = replicaCount();
    const partings = after.first.slice(before.first.length);
    expect(partings, JSON.stringify(partings.slice(0, 3), null, 1)).toEqual([]);
    expect(after.asked - before.asked).toBeGreaterThan(300);
    const hooked = ['The place is kept.', 'Back to the place that was kept.', 'Nobody stands close enough to rally.', 'The line steadies.'].filter((line) => said.has(line));
    expect(hooked.length, `the hooks' own lines, in the engine's log: ${hooked.join(' / ')}`).toBeGreaterThanOrEqual(2);
  }, 300_000);

  it.skipIf(!built)('tells an engine brought into step the dice still waiting to be shown', async () => {
    const bytes = readFileSync(WASM);
    const project = projectSchema.parse(migrateDocument(JSON.parse(readFileSync(resolve(here, '../../projects/default.json'), 'utf8'))));
    const g = createRng('rolls-waiting');
    // A game played with no engine beside it - the page's before its shadow has arrived - until dice wait.
    const demo = buildProjectScene(project, 'rolls-waiting');
    const local = new LocalGame(demo, false);
    for (let n = 0; n < 400 && (demo.rolls.length === 0 || demo.pending !== null); n++) act(local, demo, g);
    expect(demo.rolls.length, 'dice waiting').toBeGreaterThan(0);
    expect(demo.pending).toBeNull();
    const before = replicaCount();
    // The shadow arrives, and is brought into step at the next intent; then the page plays the engine.
    local.shadowWith(new Shadow(await WasmEngine.load(bytes), demo, shippedContent(), await WasmEngine.load(bytes)));
    local.syncTalks();
    const game = new WasmGame(demo, await WasmEngine.load(bytes), shippedContent());
    game.syncTalks();
    const after = replicaCount();
    expect(after.first.slice(before.first.length)).toEqual([]);
    expect(after.asked - before.asked).toBe(2);
  });
});
