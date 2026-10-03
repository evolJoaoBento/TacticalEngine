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
import { boardOf, rollsOf, type BoardSnapshot } from './board';
import { buildProjectScene } from './demo-scene';
import { LocalGame } from './client';
import { firstDifference, replicaCount, Shadow } from './shadow';
import { talkingAside } from './talks';
import { talkingView } from './ui/play-views';
import { interactablesOf } from '../engine/scene/prop-functions';
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

  it.skipIf(!built)('plays every intent in the engine alone, the page\'s game filled from its board after each', async () => {
    const bytes = readFileSync(WASM);
    const fallback = projectSchema.parse(migrateDocument(JSON.parse(readFileSync(resolve(here, '../../projects/default.json'), 'utf8'))));
    const projects: [string, ProjectDoc][] = [['default', fallback], ['the workshop', barWorkshop(fallback)]];
    const g = createRng('wasm-game');
    const before = replicaCount();
    const said = new Set<string>();
    let checked = 0;
    for (const [name, project] of projects) {
      for (let s = 0; s < 3; s++) {
        const demo = buildProjectScene(projectSchema.parse(JSON.parse(JSON.stringify(project))), `wasm-game:${name}:${s}`);
        const engine = await WasmEngine.load(bytes);
        const game = new Watched(demo, engine, shippedContent());
        for (const member of demo.party.members()) {
          game.select(member);
          for (const ability of game.abilitiesOf(member).filter((a) => a.effects.some((e) => e.kind === 'run') || a.target.kind === 'point')) {
            const tiles = game.pointTiles(member, ability);
            game.useAbility(member, ability.id, [], tiles.length > 0 ? { point: g.pick(tiles) } : undefined);
            game.useAbility(member, ability.id);
            for (let k = 0; k < 4 && demo.pending !== null; k++) game.answerPending(answerFor(demo, g));
          }
        }
        for (let n = 0; n < 60; n++) {
          act(game, demo, g);
          // After every intent the page's game is where the engine's board says: question, asides, log and all.
          const parted = firstDifference(boardOf(demo), engine.board(), 'board');
          expect(parted, `${name} ${s}, step ${n}: ${JSON.stringify(parted)?.slice(0, 300)}`).toBeNull();
          checked++;
        }
        // Nothing played in the page's own game: only the reads answered in the page's shapes ran there.
        expect(game.ran.filter((call) => !MARKING_READS.includes(call)), `${name} ${s}`).toEqual([]);
        // What the engine wrote, read off its own board: it is the one that played.
        for (const line of (engine.board() as BoardSnapshot).log) said.add(line.text);
      }
    }
    const after = replicaCount();
    const partings = after.first.slice(before.first.length);
    expect(partings, JSON.stringify(partings.slice(0, 3), null, 1)).toEqual([]);
    expect(checked).toBe(360);
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
    const engine = await WasmEngine.load(bytes);
    const game = new WasmGame(demo, engine, shippedContent());
    expect((engine.board() as BoardSnapshot).rolls).toEqual(rollsOf(demo));
    game.syncTalks();
    expect(rollsOf(demo).length).toBeGreaterThan(0);
    const after = replicaCount();
    expect(after.first.slice(before.first.length)).toEqual([]);
    expect(after.asked - before.asked).toBe(1);
  });

  it.skipIf(!built)('shows a question the engine holds and plays its answer there; knows a conversation set aside', async () => {
    const bytes = readFileSync(WASM);
    const project = projectSchema.parse(migrateDocument(JSON.parse(readFileSync(resolve(here, '../../projects/default.json'), 'utf8'))));
    const demo = buildProjectScene(project, 'wasm-asked');
    const engine = await WasmEngine.load(bytes);
    const game = new Watched(demo, engine, shippedContent());
    const beside = (thing: string): number => {
      const at = interactablesOf(demo.scene).find((i) => i.id === thing)!.position;
      return at.y * demo.grid.width + at.x - 1;
    };
    const same = (): void => expect(firstDifference(boardOf(demo), engine.board(), 'board')).toBeNull();
    // The vault door: the lock's roll, held by the engine and shown on the page from its board.
    game.placeAt('kara', beside('door-12-7'));
    game.select('kara');
    expect(game.useSelectedOn('door-12-7')).toMatchObject({ status: 'waiting' });
    expect(demo.pending).not.toBeNull();
    expect(boardOf(demo).pending).toEqual((engine.board() as BoardSnapshot).pending);
    same();
    for (let k = 0; k < 6 && demo.pending !== null; k++) game.answerPending(k === 0 ? { kind: 'roll' } : { kind: 'choose', index: 0 });
    // Whatever the roll said, the page says too: the door as the engine has it, the roll's lines in the log.
    expect(demo.pending).toBeNull();
    expect(demo.state.isOpen('door-12-7')).toBe((engine.board() as BoardSnapshot).replica.state.interactables['door-12-7']?.open === true);
    expect(demo.log.some((line) => /vs 1\d/.test(line.text))).toBe(true);
    same();
    // The Warden: a conversation on screen, its lines and options read by the page's own views.
    game.placeAt('kara', beside('pillar-14-7'));
    game.select('kara');
    game.useSelectedOn('pillar-14-7');
    const talking = talkingView(demo);
    expect(talking?.options.map((o) => o.text)).toContain('Who are you?');
    expect(talking!.lines.length).toBeGreaterThan(0);
    same();
    // Somebody else selected: the engine sets it aside, and the page knows who is talking.
    const other = demo.party.members().find((id) => id !== 'kara')!;
    game.select(other);
    game.syncTalks();
    expect(demo.pending).toBeNull();
    expect(talkingAside(demo)).toEqual(['kara']);
    same();
    // Kara again: back on screen, where it was.
    game.select('kara');
    game.syncTalks();
    expect(talkingAside(demo)).toEqual([]);
    expect(talkingView(demo)?.options.map((o) => o.text)).toEqual(talking!.options.map((o) => o.text));
    same();
    expect(game.ran.filter((call) => !MARKING_READS.includes(call))).toEqual([]);
  });
});

/** The reads answered in the page's shapes, read off the page's game: the only intents that run anything there. */
const MARKING_READS = ['abilityList', 'readContainer', 'readThing'];

/** A `WasmGame` that writes down every intent its page's own game was asked to play. */
class Watched extends WasmGame {
  readonly ran: string[] = [];
  protected override play<T>(call: string, args: readonly unknown[], run: () => T, compare: { answer: boolean }): T {
    return super.play(call, args, () => {
      this.ran.push(call);
      return run();
    }, compare);
  }
}
